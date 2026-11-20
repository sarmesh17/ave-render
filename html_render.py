"""HTML/CSS animation -> video, frame-by-frame (Edge browser se).

Har frame pe page ki saari animations ko theek us pal pe rok ke screenshot: browser kitna bhi dheema ho,
koi frame chhoot'ta ya atakta nahi. CSS animations (delay ke saath) apne aap chalti hain; JS se kuch
chalana ho to page mein window.setTime = (seconds) => {...} likh do, har frame pe bulaya jaayega.
setTime async ho (Promise lautaye, jaise img.decode()) to screenshot us ke poora hone ke baad. Page ko shuru mein
kuch load karna ho (3D model, texture) to window.renderReady = Promise: pehle frame se pehle us ka intezaar.

3D (three.js, WebGL): graphics_kit/THREE.md. Page jsDelivr ka URL likhta hai; woh version graphics_kit/vendor mein
ho to file wahin se (internet nahi chahiye, cloud pe bhi wahi file). Cloud (Linux, GPU nahi) pe WebGL CPU pe chalta hai.

Page batata hai woh kis layout ka hai: <meta name="layout" content="overlay|card|full"> (editor.compose).
overlay = transparent (body ka background transparent rakho): .mov ProRes 4444, alpha ke saath.
card/full = poori slide: .mp4. Layout video ke metadata (comment) mein bhi likha jaata hai.

Cloud: render_many() ek saath kai graphics; settings.json "render_cloud": true ho to GitHub ke server pe
(editor.cloud_render), warna yahin ek-ek karke. Wahan bane hue baad ke render() ko turant mil jaate hain.

Chalao: python -m editor.html_render graphic.html --duration 7 [--out graphic]
"""

import argparse
import hashlib
import json
import mimetypes
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

W, H, FPS = 1920, 1080, 30
LAYOUTS = ("overlay", "card", "full")
SETTINGS = Path(__file__).resolve().parent.parent / "settings.json"
# CDN packages ki apni copy: laptop pe graphics_kit/vendor, cloud pe job ke saath aaya vendor/ (html_render ke bagal)
VENDOR_DIRS = (Path(__file__).resolve().parent / "vendor", Path(__file__).resolve().parent.parent / "graphics_kit" / "vendor")
CDN_PKG = re.compile(r"https://cdn\.jsdelivr\.net/npm/([\w.-]+)@([\w.-]+)/")
GL = re.compile(r"webgl|three(\.module|\.min)?\.js|/three@", re.I)  # page WebGL (3D) chalata hai
MIME = {".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm",
        ".css": "text/css", ".glb": "model/gltf-binary", ".hdr": "application/octet-stream"}
_ready: dict[str, Path] = {}  # render_many ke bane: job key -> file (isi process mein)
_laptop_only: set[str] = set()  # render_many mein GitHub pe nahi bane: ab laptop pe hi (dobara GitHub nahi)


def _key(html: Path, out: Path, duration: float, fps: int, size: tuple[int, int]) -> str:
    page = html.read_bytes() if html.exists() else b""
    return hashlib.sha1(b"|".join([page, str(out.resolve()).encode(), f"{duration}|{fps}|{size}".encode()])).hexdigest()


def cloud_on() -> bool:
    try:
        return bool(json.loads(SETTINGS.read_text(encoding="utf-8")).get("render_cloud"))
    except (OSError, ValueError):
        return False


_OWN_FILE = re.compile(r"""<link\b[^>]*?\bhref\s*=\s*["']([^"']+)|<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)"""
                       r"""|@import\s+(?:url\(\s*)?["']?([^"')\s;]+)""", re.I)


def _own_files(text: str, base: Path, seen: set[Path]) -> str:
    """text jin apni .css/.js files ko bulata hai unka text, un files ke @import samet (CDN nahi)."""
    found = []
    for m in _OWN_FILE.finditer(text):
        ref = m.group(m.lastindex).split("?")[0].split("#")[0]
        if ref.lower().startswith("file:"):
            f = Path(url2pathname(urlparse(ref).path))
        elif re.match(r"[a-z][a-z0-9+.-]*:|/", ref, re.I):
            continue
        else:
            f = base / unquote(ref)
        if f.suffix.lower() in (".css", ".js") and f not in seen and f.is_file():
            seen.add(f)
            body = f.read_text(encoding="utf-8", errors="replace")
            found += [body, _own_files(body, f.parent, seen)]
    return "\n".join(found)


def _all_text(html: Path) -> str:
    """Page + uski apni CSS/JS ka text."""
    page = html.read_text(encoding="utf-8", errors="replace")
    return page + "\n" + _own_files(page, html.parent, set())


def weight(html: Path) -> float:
    """Ek frame kitna bhaari (1 = saada): browser ko har frame pe kya banana padta hai. Cloud is se machines aur tukde
    baant'ta hai. Page + uski apni CSS/JS: kit wale graphic ke saare effect alag file mein hote hain (8 Nov 2026:
    d07 ka andaza 95 s, asal 207-333 s)."""
    page = html.read_text(encoding="utf-8", errors="replace")
    s = _all_text(html).lower()
    w = 1.0
    w += 0.6 * min(len(re.findall(r"blur\(", s)), 5) / 5 + 0.6 * ("backdrop-filter" in s)
    w += 0.4 * min(s.count("box-shadow") + s.count("drop-shadow"), 10) / 10
    w += 1.0 * bool(re.search(r"perspective|preserve-3d|rotate3d|rotate[xy]\(", s))
    w += 2.0 * bool(re.search(r"<canvas|getcontext\(|webgl|three(\.min)?\.js", s))
    w += 0.5 * min(len(re.findall(r"<img\b", s)), 20) / 20
    w += min(len(re.findall(r"<[a-z]", page.lower())) / 600, 1.0)  # kitne elements (sirf HTML: JS mein a<b bhi milta)
    return w


def vendored(pkg: str, ver: str) -> Path | None:
    """vendor/<pkg> agar theek yahi version hai (SOURCE.txt ki 'version:' line), warna None (CDN se aayega)."""
    for d in VENDOR_DIRS:
        try:
            src = (d / pkg / "SOURCE.txt").read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if re.search(rf"^version:\s*{re.escape(ver)}\s*$", src, re.M):
            return d / pkg
    return None


def _route_vendor(page, text: str) -> None:
    """Page jo jsDelivr package@version maange woh vendor mein ho to file wahin se (CORS header samet)."""
    for pkg, ver in sorted(set(CDN_PKG.findall(text))):
        d = vendored(pkg, ver)
        if not d:
            continue
        prefix = f"https://cdn.jsdelivr.net/npm/{pkg}@{ver}/"
        page.route(prefix + "**", _server(d.resolve(), prefix, pkg))


def _server(d: Path, prefix: str, pkg: str):
    def serve(route):  # Playwright handler: sirf route (default args do to request bhi bhej deta hai)
        rel = unquote(route.request.url[len(prefix):].split("?")[0].split("#")[0])
        f = (d / rel).resolve()
        if f.is_file() and d in f.parents:
            route.fulfill(path=str(f), headers={"Access-Control-Allow-Origin": "*", "Content-Type": MIME.get(
                f.suffix.lower()) or mimetypes.guess_type(f.name)[0] or "application/octet-stream"})
        else:
            print(f"vendor/{pkg} mein nahi: {rel} (CDN se le raha hoon)", flush=True)
            route.continue_()
    return serve


def render_many(jobs: list[dict]) -> None:
    """jobs: {html, out, duration, fps?, size?}. Cloud on ho to sab ek hi GitHub run mein, kai machines pe ek saath.
    Baad ke render() ko bane hue turant milte hain; cloud pe jo na bane woh render() yahin banata hai.
    Cloud off = kuch nahi (har render() khud yahin banata hai)."""
    if not jobs or not cloud_on():
        return
    from editor import cloud_render
    jobs = [{"fps": FPS, "size": (W, H), **j} for j in jobs]
    print(f"Render: {len(jobs)} GitHub pe (ek saath)", flush=True)
    try:
        got = cloud_render.render_batch(jobs)
    except Exception as e:  # internet/GitHub nahi: baad mein render() laptop pe
        got = [None] * len(jobs)
        print(f"Cloud render nahi hua ({e}) — laptop pe bana raha hoon", flush=True)
    for j, path in zip(jobs, got):
        k = _key(Path(j["html"]), Path(j["out"]), float(j["duration"]), j["fps"], tuple(j["size"]))
        if path:
            _ready[k] = path
        else:
            _laptop_only.add(k)


def render(html: Path, out: Path, duration: float, fps: int = FPS, size: tuple[int, int] = (W, H),
           frames: tuple[int, int] | None = None, where: str = "auto") -> Path:
    """out ka suffix layout se (.mov / .mp4); bani hui file lautao. size: canvas (Shorts: 1080x1920).
    frames: sirf yeh frames [a, b) (cloud ek graphic ko tukdon mein kai machines pe banata hai).
    where: "auto" = "Graphics GitHub pe" on ho to GitHub, off ho to yahin (koi bhi script bulaye: AI chat ka build.py,
    pop-ups, shorts…). "laptop" = yahin. "cloud" = setting off ho tab bhi GitHub. GitHub pe na bane to laptop."""
    key = _key(html, out, duration, fps, tuple(size))
    got = _ready.pop(key, None)
    if got and got.exists():
        return got
    if (where == "cloud" or (where == "auto" and cloud_on())) and frames is None and os.name == "nt" \
            and key not in _laptop_only:
        print(f"GitHub pe render: {html.name}", flush=True)
        from editor import cloud_render
        try:
            got = cloud_render.render_batch([{"html": html, "out": out, "duration": duration, "fps": fps,
                                              "size": tuple(size)}])[0]
        except Exception as e:
            got = None
            print(f"Cloud nahi chala ({e})", flush=True)
        if got:
            return got
        print("Laptop pe render (cloud se nahi bana)", flush=True)
    if os.name == "nt":
        print(f"Laptop pe render: {html.name}", flush=True)
    return _local(html, out, duration, fps, size, frames)


# renderReady (3D model/texture load) ka intezaar; 2 min mein na ho to ruk jao (kaale frame mat banao)
READY_JS = """() => Promise.race([Promise.resolve(window.renderReady).then(() => 'ok'),
                                 new Promise(r => setTimeout(() => r('timeout'), 120000))])"""
# har frame: CSS animations us pal pe, setTime(t); setTime Promise lautaye to us ka intezaar (30 s tak)
FRAME_JS = """(t) => {
    document.getAnimations().forEach(a => a.currentTime = t * 1000);
    const r = window.setTime ? window.setTime(t) : null;
    if (!(r instanceof Promise)) return null;
    return Promise.race([r, new Promise(ok => setTimeout(ok, 30000))]).then(() => null);
}"""


def _local(html: Path, out: Path, duration: float, fps: int, size: tuple[int, int],
           frames: tuple[int, int] | None) -> Path:
    from playwright.sync_api import sync_playwright
    text = _all_text(html)
    # file:// page apni files fetch/texture kar sake (3D model, texture, JSON); bina is ke CORS rok deta hai
    args = ["--allow-file-access-from-files"]
    if GL.search(text) and os.name != "nt":  # cloud (Linux, GPU nahi): WebGL CPU pe (SwiftShader)
        args += ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
    with sync_playwright() as p:
        # Windows ka apna Edge (alag browser download nahi); cloud (Linux) pe Playwright ka Chromium
        browser = p.chromium.launch(channel="msedge" if os.name == "nt" else None, headless=True, args=args)
        page = browser.new_page(viewport={"width": size[0], "height": size[1]})
        page.on("pageerror", lambda e: print(f"{html.name}: JS error: {str(e)[:300]!a}", flush=True))
        _route_vendor(page, text)
        page.goto(html.resolve().as_uri())
        try:
            page.wait_for_load_state("networkidle", timeout=60000)  # fonts, icons (CDN)
        except Exception as e:  # CDN dheema / koi request latki: fonts.ready + READY_JS phir bhi rukte hain
            print(f"{html.name}: networkidle nahi mila ({type(e).__name__}), aage badh rahe hain", flush=True)
        page.evaluate("document.fonts.ready")
        if page.evaluate(READY_JS) != "ok":
            browser.close()
            raise SystemExit(f"{html.name}: window.renderReady 2 min mein poora nahi hua")
        layout = page.evaluate("document.querySelector('meta[name=layout]')?.content || 'full'")
        if layout not in LAYOUTS:
            raise SystemExit(f'{html.name}: <meta name="layout" content="{layout}"> galat; {"/".join(LAYOUTS)} mein se')
        alpha = layout == "overlay"
        out = out.with_suffix(".mov" if alpha else ".mp4")
        codec = (["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le"] if alpha else
                 ["-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p"])
        page.evaluate("document.getAnimations().forEach(a => a.pause())")
        enc = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-c:v", "png",
                                "-framerate", str(fps), "-i", "-", *codec, "-metadata", f"comment=layout={layout}",
                                str(out)], stdin=subprocess.PIPE)
        # 3D page GitHub pe CPU (SwiftShader) pe: ek bhaari frame ka screenshot 30 s (Playwright default) se upar
        # chala jaata tha aur poora tukda fail (19 Nov 2026 raat ke runs). 3D pe 3 min, phir ek baar dobara.
        shot_ms = 180_000 if GL.search(text) else 30_000
        for i in range(*(frames or (0, round(duration * fps)))):
            page.evaluate(FRAME_JS, i / fps)
            try:
                png = page.screenshot(type="png", omit_background=alpha, timeout=shot_ms)
            except Exception as e:  # noqa: BLE001 — Playwright TimeoutError
                print(f"{html.name}: frame {i} ka screenshot dheema ({type(e).__name__}) — dobara", flush=True)
                page.evaluate(FRAME_JS, i / fps)
                png = page.screenshot(type="png", omit_background=alpha, timeout=shot_ms * 2)
            enc.stdin.write(png)
        enc.stdin.close()
        enc.wait()
        browser.close()
    return out


def stills(html: Path, times: list[float], out_dir: Path, size: tuple[int, int] = (W, H), width: int = 960) -> Path:
    """Sasti jaanch (user, 19 Nov 2026: "token bhi bache aur fast"): poora video nahi, sirf in pal (s) ke JPG
    (width px) + ek contact sheet (1024 px tak). Laptop pe, ek page load. Lautata hai sheet ka path."""
    from playwright.sync_api import sync_playwright
    if not times:
        raise SystemExit("--stills mein koi pal nahi (jaise 0.5,1.4,3)")
    text = _all_text(html)
    out_dir.mkdir(parents=True, exist_ok=True)
    shots = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge" if os.name == "nt" else None, headless=True,
                                    args=["--allow-file-access-from-files"])
        page = browser.new_page(viewport={"width": size[0], "height": size[1]})
        page.on("pageerror", lambda e: print(f"{html.name}: JS error: {str(e)[:300]!a}", flush=True))
        _route_vendor(page, text)
        page.goto(html.resolve().as_uri())
        try:
            page.wait_for_load_state("networkidle", timeout=60000)
        except Exception:
            pass
        page.evaluate("document.fonts.ready")
        if page.evaluate(READY_JS) != "ok":
            browser.close()
            raise SystemExit(f"{html.name}: window.renderReady 2 min mein poora nahi hua")
        page.evaluate("document.getAnimations().forEach(a => a.pause())")
        for t in times:
            page.evaluate(FRAME_JS, t)
            f = out_dir / f"{html.stem}_{t:06.2f}.jpg"
            full = f.with_suffix(".png")
            full.write_bytes(page.screenshot(type="png"))
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(full), "-vf", f"scale={width}:-2", "-q:v", "3",
                            str(f)], check=True)
            full.unlink()
            shots.append(f)
        browser.close()
    from PIL import Image
    sheet = out_dir / f"{html.stem}_sheet.jpg"
    cols = max(1, min(len(shots), 4))
    tw = 1024 // cols
    ims = [Image.open(s).convert("RGB") for s in shots]
    th = round(tw * size[1] / size[0])
    grid = Image.new("RGB", (tw * cols, th * (-(-len(ims) // cols))), "black")
    for i, im in enumerate(ims):
        grid.paste(im.resize((tw, th)), ((i % cols) * tw, (i // cols) * th))
    grid.save(sheet, quality=85)
    return sheet


def main() -> None:
    p = argparse.ArgumentParser(description="HTML animation ko video banao")
    p.add_argument("html", type=Path)
    p.add_argument("--duration", type=float, help="kitne second (--stills ke saath zaroori nahi)")
    p.add_argument("--stills", help="sirf in pal ke JPG + contact sheet, jaise 0.5,1.4,3 (sasti jaanch, video nahi)")
    p.add_argument("--out", type=Path, help="default: html ke naam se (.mov overlay, warna .mp4)")
    p.add_argument("--fps", type=int, default=FPS)
    p.add_argument("--size", default=f"{W}x{H}", help="canvas, jaise 1080x1920")
    p.add_argument("--frames", help="sirf yeh frames, jaise 0:90")
    args = p.parse_args()
    size = tuple(int(v) for v in args.size.lower().split("x"))
    if args.stills:
        times = [float(v) for v in args.stills.split(",") if v.strip()]
        sheet = stills(args.html, times, args.out or args.html.parent / "_stills", size)
        print(f"Stills: {len(times)} frame, sheet: {sheet}")
        return
    if args.duration is None:
        p.error("--duration zaroori (ya --stills)")
    frames = tuple(int(v) for v in args.frames.split(":")) if args.frames else None
    out = render(args.html, args.out or args.html.with_suffix(""), args.duration, args.fps, size, frames)
    print(f"Saved: {out}")


if __name__ == "__main__":
    main()
