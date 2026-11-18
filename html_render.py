"""HTML/CSS animation -> video, frame-by-frame (Edge browser se).

Har frame pe page ki saari animations ko theek us pal pe rok ke screenshot: browser kitna bhi dheema ho,
koi frame chhoot'ta ya atakta nahi. CSS animations (delay ke saath) apne aap chalti hain; JS se kuch
chalana ho to page mein window.setTime = (seconds) => {...} likh do, har frame pe bulaya jaayega.

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
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

W, H, FPS = 1920, 1080, 30
LAYOUTS = ("overlay", "card", "full")
SETTINGS = Path(__file__).resolve().parent.parent / "settings.json"
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


def weight(html: Path) -> float:
    """Ek frame kitna bhaari (1 = saada): browser ko har frame pe kya banana padta hai. Cloud is se machines aur tukde
    baant'ta hai. Page + uski apni CSS/JS: kit wale graphic ke saare effect alag file mein hote hain (8 Nov 2026:
    d07 ka andaza 95 s, asal 207-333 s)."""
    page = html.read_text(encoding="utf-8", errors="replace")
    s = (page + "\n" + _own_files(page, html.parent, set())).lower()
    w = 1.0
    w += 0.6 * min(len(re.findall(r"blur\(", s)), 5) / 5 + 0.6 * ("backdrop-filter" in s)
    w += 0.4 * min(s.count("box-shadow") + s.count("drop-shadow"), 10) / 10
    w += 1.0 * bool(re.search(r"perspective|preserve-3d|rotate3d|rotate[xy]\(", s))
    w += 2.0 * bool(re.search(r"<canvas|getcontext\(|webgl|three(\.min)?\.js", s))
    w += 0.5 * min(len(re.findall(r"<img\b", s)), 20) / 20
    w += min(len(re.findall(r"<[a-z]", page.lower())) / 600, 1.0)  # kitne elements (sirf HTML: JS mein a<b bhi milta)
    return w


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


def _local(html: Path, out: Path, duration: float, fps: int, size: tuple[int, int],
           frames: tuple[int, int] | None) -> Path:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        # Windows ka apna Edge (alag browser download nahi); cloud (Linux) pe Playwright ka Chromium
        browser = p.chromium.launch(channel="msedge" if os.name == "nt" else None, headless=True)
        page = browser.new_page(viewport={"width": size[0], "height": size[1]})
        page.goto(html.resolve().as_uri())
        page.wait_for_load_state("networkidle")  # fonts, icons (CDN)
        page.evaluate("document.fonts.ready")
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
        for i in range(*(frames or (0, round(duration * fps)))):
            t = i / fps
            page.evaluate(f"""() => {{
                document.getAnimations().forEach(a => a.currentTime = {t * 1000});
                if (window.setTime) window.setTime({t});
            }}""")
            enc.stdin.write(page.screenshot(type="png", omit_background=alpha))
        enc.stdin.close()
        enc.wait()
        browser.close()
    return out


def main() -> None:
    p = argparse.ArgumentParser(description="HTML animation ko video banao")
    p.add_argument("html", type=Path)
    p.add_argument("--duration", type=float, required=True, help="kitne second")
    p.add_argument("--out", type=Path, help="default: html ke naam se (.mov overlay, warna .mp4)")
    p.add_argument("--fps", type=int, default=FPS)
    p.add_argument("--size", default=f"{W}x{H}", help="canvas, jaise 1080x1920")
    p.add_argument("--frames", help="sirf yeh frames, jaise 0:90")
    args = p.parse_args()
    size = tuple(int(v) for v in args.size.lower().split("x"))
    frames = tuple(int(v) for v in args.frames.split(":")) if args.frames else None
    out = render(args.html, args.out or args.html.with_suffix(""), args.duration, args.fps, size, frames)
    print(f"Saved: {out}")


if __name__ == "__main__":
    main()
