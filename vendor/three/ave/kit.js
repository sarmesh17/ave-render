// AVE 3D kit — graphics ke 3D hisse ke tested building blocks (user, 19 Nov 2026: "3D likhne ka optimised tarika:
// quality same, token kam, fast"). Template nahi: har graphic apna design, bas renderer / roshni / material / text /
// icon / chaal / timeline jaisa har baar ka code yahan ek baar, jaancha hua. Docs: graphics_kit/THREE.md section 0.
//
// Import map (body mein):  "three", "three/addons/" (THREE.md) +  "ave/": "https://cdn.jsdelivr.net/npm/three@0.187.0/ave/"
//   import * as K from 'ave/kit.js';
// Yeh file graphics_kit/vendor/three/ave/ mein hai: html_render use three@0.187.0 ke raaste se laptop aur GitHub dono
// pe deta hai (cloud wala "script src ka naam badalna" iska nahi). Fonts / icons isi ke bagal mein (fonts/, icons/).
//
// Har cheez sirf t se (cloud frames ulte kram mein, kai machines pe): koi Clock / requestAnimationFrame / Math.random
// nahi — K.rng(seed) aur K.prog(t, ...).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export { THREE };
const BASE = new URL('./', import.meta.url).href;

// project ke rang (graphics_kit/slide.css + overlay.css)
export const C = {
  bg: 0x070b14, ink: 0x0c1424, panel: 0x111a2e, muted: 0x5b6577, line: 0xe6e9f2, white: 0xf4f6fb,
  blue: 0x2f6bff, blue1: 0x4ea8ff, blue2: 0x1f6fff, violet: 0x7b5cff, cyan: 0x22d3ee, green: 0x22c55e,
  amber: 0xf5a524, red: 0xef4444,
};

// ---------------------------------------------------------------- stage: renderer + scene + camera + roshni + post
export function stage(o = {}) {
  const W = o.width || innerWidth, H = o.height || innerHeight;
  const alpha = !!o.alpha;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);                               // 1920x1080 theek; >1 sirf dheema
  renderer.setSize(W, H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = o.exposure ?? 1;
  renderer.shadowMap.enabled = o.shadows !== false;
  renderer.shadowMap.type = THREE.PCFShadowMap;            // r187: PCFSoftShadowMap nahi; radius se naram
  const cv = renderer.domElement;
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
  (o.parent || document.body).prepend(cv);                 // canvas neeche, HTML text upar

  const scene = new THREE.Scene();
  const bg = o.bg ?? C.bg;
  if (alpha) { scene.background = null; renderer.setClearColor(0x000000, 0); }
  else scene.background = new THREE.Color(bg);
  if (!alpha && o.fog !== false) scene.fog = new THREE.Fog(bg, o.fogNear ?? 10, o.fogFar ?? 26);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;   // studio reflection, HDR file nahi
  scene.environmentIntensity = o.env ?? 0.6;

  const camera = new THREE.PerspectiveCamera(o.fov ?? 32, W / H, 0.1, 200);
  camera.position.set(...(o.cam ?? [0, 1.6, 9]));
  const target = new THREE.Vector3(...(o.target ?? [0, 0.8, 0]));
  camera.lookAt(target);

  const key = new THREE.DirectionalLight(0xffffff, o.key ?? 2.2);  // peeche-upar se: parchhai camera ki taraf
  key.position.set(...(o.keyPos ?? [-3.5, 6, -2.5]));
  key.castShadow = o.shadows !== false;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 8;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const sb = o.shadowBox ?? 6;
  Object.assign(key.shadow.camera, { left: -sb, right: sb, top: sb, bottom: -sb, near: 0.5, far: 30 });
  const front = new THREE.DirectionalLight(0xdfe8ff, o.front ?? 0.9);     // saamne ki halki roshni (text padhne layak)
  front.position.set(2, 3, 8);
  const rim = new THREE.DirectionalLight(o.rimColor ?? C.blue1, o.rim ?? 1.4);   // peeche ki neeli kinaar
  rim.position.set(5, 3, -6);
  scene.add(key, front, rim);

  let floor = null;
  if (!alpha && o.floor !== false) {
    floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: o.floorColor ?? 0x0d1424, roughness: 0.7, metalness: 0.1, envMapIntensity: 0.12 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = o.floorY ?? 0;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  let bloom = null, dof = null;
  if (o.bloom ?? !alpha) {   // overlay (alpha) pe bloom transparency kha jaata hai: default band
    bloom = new UnrealBloomPass(new THREE.Vector2(W, H), o.bloomStrength ?? 0.55, 0.3, 1.0);
    composer.addPass(bloom);
  }
  if (o.dof) {
    dof = new BokehPass(scene, camera, { focus: o.dof.focus ?? 9, aperture: o.dof.aperture ?? 0.0015, maxblur: o.dof.maxblur ?? 0.006 });
    composer.addPass(dof);
  }
  composer.addPass(new OutputPass());                      // tone mapping + sRGB
  return {
    renderer, scene, camera, target, composer, bloom, dof, floor, lights: { key, front, rim }, W, H,
    add: (...objs) => { scene.add(...objs); return objs[0]; },
    render() { camera.lookAt(target); composer.render(); },
  };
}

// ---------------------------------------------------------------- materials (har call naya: opacity alag-alag chale)
export const mat = {
  glass: (color = C.blue1, o = {}) => new THREE.MeshPhysicalMaterial({
    color, metalness: 0, roughness: o.roughness ?? 0.12, transmission: o.transmission ?? 1, thickness: o.thickness ?? 0.8,
    ior: 1.45, clearcoat: 1, clearcoatRoughness: 0.04, attenuationColor: new THREE.Color(color),
    attenuationDistance: o.tint ?? 2.5, envMapIntensity: 1.2 }),
  frosted: (color = C.white, o = {}) => mat.glass(color, { roughness: 0.38, thickness: 1.2, ...o }),
  plastic: (color = C.blue, o = {}) => new THREE.MeshPhysicalMaterial({
    color, metalness: 0.05, roughness: o.roughness ?? 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }),
  metal: (color = 0xc9d3e6, o = {}) => new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: o.roughness ?? 0.24 }),
  matte: (color = C.panel, o = {}) => new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: o.roughness ?? 0.85 }),
  ink: (color = C.ink, o = {}) => new THREE.MeshPhysicalMaterial({
    color, metalness: 0.3, roughness: o.roughness ?? 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
  // bloom ke liye rang 1 se upar (intensity 3+): neon kinaar, ring, chamakta text
  glow: (color = C.blue1, o = {}) => new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(o.intensity ?? 3), transparent: true, toneMapped: o.toneMapped ?? true }),
};

function shadowy(m) { m.castShadow = true; m.receiveShadow = true; return m; }

// ---------------------------------------------------------------- shapes
export function panel(w, h, o = {}) {           // gol kono wala patla dabba (card / tile / screen)
  const d = o.depth ?? 0.1;
  return shadowy(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 6, Math.min(o.radius ?? 0.12, d / 2, w / 2, h / 2)),
    o.material ?? mat.ink()));
}
export function box(w, h, d, o = {}) {
  return shadowy(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 6, o.radius ?? Math.min(w, h, d) * 0.15), o.material ?? mat.plastic()));
}
export function ring(radius = 1.5, o = {}) {    // patli chamakti ring (zameen pe ya kisi cheez ke gird)
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, o.tube ?? 0.025, 16, 256), o.material ?? mat.glow(o.color ?? C.blue1));
  if (o.flat !== false) m.rotation.x = Math.PI / 2;
  return m;
}
export function line(points, o = {}) {          // patli chamakti lakeer (jodne wali): [[x,y,z], ...]
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, points.length * 24), o.width ?? 0.015, 8, false),
    o.material ?? mat.glow(o.color ?? C.blue1, { intensity: o.intensity ?? 2.5 }));
}

// ---------------------------------------------------------------- 3D text (Inter Tight 600/700/800, fonts/)
const fonts = {};
export function font(weight = 800) {
  return (fonts[weight] ??= new FontLoader().loadAsync(`${BASE}fonts/intertight_${weight}.typeface.json`));
}
// align: 'center' | 'left' | 'right' (x), baseline: neeche wala kinaara y = 0 pe (zameen pe rakhne layak)
export async function text3d(str, o = {}) {
  const size = o.size ?? 1;
  const g = new TextGeometry(String(str), {
    font: await font(o.weight ?? 800), size, depth: o.depth ?? size * 0.18, curveSegments: 8,
    bevelEnabled: o.bevel !== false, bevelThickness: size * 0.02, bevelSize: size * 0.012, bevelSegments: 3 });
  g.computeBoundingBox();
  const b = g.boundingBox;
  const x = o.align === 'left' ? -b.min.x : o.align === 'right' ? -b.max.x : -(b.min.x + b.max.x) / 2;
  g.translate(x, -b.min.y, -(b.min.z + b.max.z) / 2);
  return shadowy(new THREE.Mesh(g, o.material ?? mat.plastic(C.white)));
}

// ---------------------------------------------------------------- 3D icon (Phosphor filled, icons/<naam>.svg)
const svgs = {};
export async function icons() { return (await fetch(`${BASE}icons/index.json`)).json(); }   // naamon ki list
function svgData(name) {
  return svgs[name] ??= new SVGLoader().loadAsync(`${BASE}icons/${name}.svg`).catch(() => {
    throw new Error(`kit: icon nahi mila: ${name} (icons/index.json dekho)`);
  });
}
export async function icon3d(name, o = {}) {   // purana, flat (2D icon thoda mota) — naye kaam mein K.icon / K.iconTile
  const data = await svgData(name);
  const size = o.size ?? 1, s = size / 256;               // Phosphor viewBox 256
  const shapes = data.paths.flatMap(p => SVGLoader.createShapes(p));
  const g = new THREE.ExtrudeGeometry(shapes, {
    depth: (o.depth ?? size * 0.14) / s, bevelEnabled: o.bevel !== false, bevelThickness: 4, bevelSize: 3, bevelSegments: 3, curveSegments: 10 });
  g.center();
  g.rotateX(Math.PI);                                      // SVG ka y neeche: ulta (rotation, negative scale nahi —
  g.scale(s, s, s);                                        // woh faces andar-bahar ulat deta)
  return shadowy(new THREE.Mesh(g, o.material ?? mat.plastic(o.color ?? C.blue)));
}
export function tile(iconMesh, o = {}) {        // icon + uske peeche gol kono wala kaanch / ink tile (overlay jaisa)
  const s = o.size ?? 1.4;
  const grp = new THREE.Group();
  const back = panel(s, s, { depth: o.depth ?? 0.16, radius: s * 0.22, material: o.material ?? mat.ink() });
  iconMesh.position.z = (o.depth ?? 0.16) / 2 + 0.04;
  grp.add(back, iconMesh);
  return grp;
}

// ---------------------------------------------------------------- premium icon (user, 19 Nov 2026: icon3d "cheap"
// laga: 2D sticker jaisa, ek rang, tez kinaare). Naya: phoola gol kinaara (pillow bevel, naram normals), upar se neeche
// halka rang-gradient, icon ke chhed (aankh / muh / check) alag material se bhare (inlay: chamakta ya gehra),
// naram tile jiske kinaare icon ke rang mein chamakte hain + peeche halka halo, badge = mota sikka + ubhra nishaan.
// Sab 126 Phosphor icons pe chalta hai; hero icon (bada, beech mein) ke liye Blender model (BLENDER.md section 6).
function puffy(shapes, depth, r, bt, seg = 10) {                 // SVG units (viewBox 256)
  return new THREE.ExtrudeGeometry(shapes, { depth, curveSegments: 24, bevelEnabled: true,
    bevelThickness: bt, bevelSize: r, bevelOffset: -r, bevelSegments: seg });   // offset -r: silhouette wahi rahe
}
function placeIcon(g, cx, cy, s) {     // SVG -> 3D: beech mein, y upar (rotation; negative scale faces ulat deta)
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-cx, -cy, -(b.min.z + b.max.z) / 2);
  g.rotateX(Math.PI);
  g.scale(s, s, s);
  return toCreasedNormals(g, Math.PI / 3);                        // gol hisse smooth, asli kone tez
}
function halfZ(g) { g.computeBoundingBox(); return g.boundingBox.max.z; }
function tone(color, dl, ds = 1, dh = 0) {                       // HSL mein halka/gehra (gradient, tile, inlay)
  const c = new THREE.Color(color), h = {};
  c.getHSL(h);
  return new THREE.Color().setHSL((h.h + dh + 1) % 1, Math.min(h.s * ds, 1), THREE.MathUtils.clamp(h.l + dl, 0.02, 0.95));
}
function gradient(g, top, bottom) {                              // vertex colours: upar halka, neeche gehra
  g.computeBoundingBox();
  const b = g.boundingBox, pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(bottom).lerp(top, (pos.getY(i) - b.min.y) / (b.max.y - b.min.y || 1)).toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
function softMat(color, o = {}) {      // naram chamakdar plastic; gradient = geometry ke vertex colours
  return new THREE.MeshPhysicalMaterial({
    color: o.vertex ? 0xffffff : color, vertexColors: !!o.vertex, metalness: 0, roughness: o.roughness ?? 0.4,
    clearcoat: o.clearcoat ?? 0.3, clearcoatRoughness: 0.22, sheen: o.sheen ?? 0.15, sheenRoughness: 0.45,
    sheenColor: new THREE.Color(color), envMapIntensity: o.env ?? 0.4 });
  // saamne wala chapta chehra room ki tez roshni poori reflect karta hai: zyada clearcoat / env / sheen = rang dhula
  // (safed-gulabi) lage. Chamak gol kinaaron pe hi aaye, chehra apne rang ka rahe.
}
mat.soft = (color = C.blue, o = {}) => softMat(color, o);
function inlayMat(color, o) {
  if (o.inlay && typeof o.inlay === 'object') return o.inlay;    // apna material
  if (o.inlay === 'glow') return mat.glow(o.inlayColor ?? tone(color, 0.32, 0.8), { intensity: o.inlayGlow ?? 1.25 });
  return new THREE.MeshPhysicalMaterial({ color: o.inlayColor ?? tone(color, -0.38, 0.7), metalness: 0.2,
    roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 });   // 'dark': gehra chamakta khaana
}
// o: size, color, depth, round (kinaara, SVG units), puff (kitna phoola), gradient (false = ek rang), material,
//    inlay: 'dark' (default) | 'glow' | false (chhed khule) | material, inlayColor, inlayGlow
export async function icon(name, o = {}) {
  const shapes = (await svgData(name)).paths.flatMap(p => SVGLoader.createShapes(p));
  const size = o.size ?? 1, s = size / 256, color = o.color ?? C.blue;
  const depth = (o.depth ?? size * 0.1) / s, r = o.round ?? 6, bt = o.puff ?? 11;
  const raw = puffy(shapes, depth, r, bt);
  raw.computeBoundingBox();
  const bb = raw.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2;
  const g = placeIcon(raw, cx, cy, s);
  const grad = o.gradient !== false && !o.material;
  if (grad) gradient(g, tone(color, 0.06, 1, 0.015), tone(color, -0.13, 1.05));
  const grp = new THREE.Group();
  grp.add(shadowy(new THREE.Mesh(g, o.material ?? softMat(color, { vertex: grad }))));
  const front = halfZ(g);
  if (o.inlay !== false) {
    const holes = shapes.flatMap(sh => sh.holes.map(h => new THREE.Shape(h.getPoints(24))));
    if (holes.length) {
      const m = inlayMat(color, o);
      const ig = placeIcon(puffy(holes, depth * 0.7, 2, 2.5, 4), cx, cy, s);
      // chhed jitna hi, saamne se 0.7 * puff neeche (gol rim ke andar baitha; apne gol kinaare se patli seam)
      const im = new THREE.Mesh(ig, m);
      im.position.z = front - 0.7 * bt * s - halfZ(ig);
      im.receiveShadow = true;
      grp.add(im);
    }
  }
  grp.userData.half = front;           // saamne ka chehra z = half (tile pe rakhne ke liye)
  return grp;
}

// gol sikka (badge): icon ka bahari roop mota sikka, chhed (X / tick / !) ubhre hue safed — x-circle, check-circle,
// info, question, warning jaise icons ke liye
export async function badge(name = 'x-circle', o = {}) {
  const shapes = (await svgData(name)).paths.flatMap(p => SVGLoader.createShapes(p));
  const size = o.size ?? 0.5, s = size / 256, color = o.color ?? C.red;
  const outer = shapes.map(sh => new THREE.Shape(sh.getPoints(48)));
  const raw = puffy(outer, (o.depth ?? size * 0.12) / s, 8, 12);
  raw.computeBoundingBox();
  const bb = raw.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2;
  const g = placeIcon(raw, cx, cy, s);
  gradient(g, tone(color, 0.06, 1, 0.015), tone(color, -0.13, 1.05));
  const grp = new THREE.Group();
  grp.add(shadowy(new THREE.Mesh(g, softMat(color, { vertex: true }))));
  const holes = shapes.flatMap(sh => sh.holes.map(h => new THREE.Shape(h.getPoints(24))));
  if (holes.length) {
    const sg = placeIcon(puffy(holes, 10, 3, 5, 6), cx, cy, s);
    gradient(sg, new THREE.Color(o.symbolColor ?? 0xffffff), tone(o.symbolColor ?? 0xffffff, -0.14));
    const sm = shadowy(new THREE.Mesh(sg, softMat(0xffffff, { vertex: true, roughness: 0.28 })));
    sm.position.z = halfZ(g) + 5 * s - halfZ(sg);              // sikke se 5 unit ubhra
    grp.add(sm);
  }
  return grp;
}

// naram tile + icon: gol squircle slab (icon ke rang ka gehra roop), kinaaron pe usi rang ki sheen, icon ke peeche
// halka halo. o: size, depth, color, radius, halo (false = nahi), haloIntensity, tileMaterial, icon: {...icon() o}
let haloTex = null;
function haloPlane(size, color, intensity) {
  haloTex ??= (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d'), gr = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.4)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  return new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({
    map: haloTex, color: new THREE.Color(color).multiplyScalar(intensity), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false }));
}
export function slab(w, h, o = {}) {   // gol kono wala mota slab, naram kinaara (panel se bada radius chal sakta hai)
  const d = o.depth ?? 0.24, r = Math.min(o.radius ?? Math.min(w, h) * 0.25, w / 2, h / 2), sh = new THREE.Shape();
  sh.moveTo(-w / 2 + r, -h / 2);
  sh.lineTo(w / 2 - r, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  sh.lineTo(w / 2, h / 2 - r); sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  sh.lineTo(-w / 2 + r, h / 2); sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  sh.lineTo(-w / 2, -h / 2 + r); sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const e = Math.min(d * 0.32, r * 0.5);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d - 2 * e, curveSegments: 24, bevelEnabled: true,
    bevelThickness: e, bevelSize: e, bevelOffset: -e, bevelSegments: 8 });
  g.translate(0, 0, -(d - 2 * e) / 2);
  return shadowy(new THREE.Mesh(toCreasedNormals(g, Math.PI / 3), o.material ?? mat.ink()));
}
export async function iconTile(name, o = {}) {
  const s = o.size ?? 1.4, d = o.depth ?? s * 0.18, color = o.color ?? C.blue;
  const grp = new THREE.Group();
  grp.add(slab(s, s, { depth: d, radius: o.radius ?? s * 0.25, material: o.tileMaterial ?? new THREE.MeshPhysicalMaterial({
    color: tone(color, -0.5, 0.55), metalness: 0.1, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1,
    sheen: 1, sheenRoughness: 0.32, sheenColor: tone(color, -0.1), envMapIntensity: 0.9 }) }));
  if (o.halo !== false) {
    const hp = haloPlane(s * 1.0, color, o.haloIntensity ?? 0.5);
    hp.position.z = d / 2 + 0.003;
    grp.add(hp);
  }
  const ic = await icon(name, { size: s * 0.56, color, ...o.icon });
  ic.position.z = d / 2 + ic.userData.half + s * 0.035;          // tile se thoda upar tairta
  grp.add(ic);
  grp.userData.icon = ic;
  return grp;
}

// ---------------------------------------------------------------- chaal: sirf t se
export const ease = {
  linear: x => x,
  out: x => 1 - (1 - x) ** 3,                                          // slide.css --ease jaisa
  inOut: x => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  pop: x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; },   // --pop jaisa
};
export const clamp01 = x => Math.min(Math.max(x, 0), 1);
// start se dur second mein 0 -> 1 (ease ke saath); point k ke "ready" time se pehle khatam rakho
export function prog(t, start, dur = 0.6, e = ease.out) { return e(clamp01((t - start) / dur)); }

function setOpacity(obj, k) {
  obj.traverse(o => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      m.userData.baseOpacity ??= m.opacity;
      m.transparent = m.transparent || k < 1;
      m.opacity = m.userData.baseOpacity * k;
    }
  });
}
// k (0..1) se entrance: neeche se utha, chhota se bada, fade. from: {x, y, z, scale, rotX, rotY, rotZ, fade}
export function enter(obj, k, from = {}) {
  const b = (obj.userData.base ??= { p: obj.position.clone(), s: obj.scale.clone(), r: obj.rotation.clone() });
  const f = { y: -0.5, scale: 0.85, fade: true, ...from }, u = 1 - k;
  obj.visible = k > 0.001;
  obj.position.set(b.p.x + (f.x ?? 0) * u, b.p.y + (f.y ?? 0) * u, b.p.z + (f.z ?? 0) * u);
  obj.scale.copy(b.s).multiplyScalar(THREE.MathUtils.lerp(f.scale ?? 1, 1, k));
  obj.rotation.set(b.r.x + (f.rotX ?? 0) * u, b.r.y + (f.rotY ?? 0) * u, b.r.z + (f.rotZ ?? 0) * u);
  if (f.fade) setOpacity(obj, k);
}
export function float(obj, t, o = {}) {         // halka tairna (hero cheez zinda lage)
  const b = (obj.userData.floatBase ??= obj.position.y);
  obj.position.y = b + Math.sin(t * (o.speed ?? 1.1) + (o.phase ?? 0)) * (o.amp ?? 0.05);
}
export const cam = {
  // from -> to (dolly / push-in / crane), k = prog(...)
  move(camera, k, from, to) { camera.position.set(...from.map((v, i) => THREE.MathUtils.lerp(v, to[i], k))); },
  orbit(camera, target, t, o = {}) {           // target ke gird dheere ghoomna
    const a = (o.start ?? 0) + (o.speed ?? 0.12) * t, r = o.radius ?? 9;
    camera.position.set(target.x + Math.sin(a) * r, target.y + (o.height ?? 1.2), target.z + Math.cos(a) * r);
  },
};

// ---------------------------------------------------------------- seeded random + dhool ke kan
export function rng(seed = 1) {                 // mulberry32: har machine pe same
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
export function dust(o = {}) {                  // tairte kan (gehrai): { points, update(t) }
  const n = o.count ?? 500, [sx, sy, sz] = o.spread ?? [18, 7, 12], r = rng(o.seed ?? 7);
  const base = new Float32Array(n * 3), vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    base.set([(r() - 0.5) * sx, r() * sy, (r() - 0.5) * sz - 2], i * 3);
    vel.set([(r() - 0.5) * 0.05, 0.02 + r() * 0.05, (r() - 0.5) * 0.03], i * 3);
  }
  const pos = base.slice();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(g, new THREE.PointsMaterial({
    color: o.color ?? C.blue1, size: o.size ?? 0.035, transparent: true, opacity: o.opacity ?? 0.7, depthWrite: false }));
  return {
    points,
    update(t) {                                  // sirf t se (frame akela ban sake)
      for (let i = 0; i < n * 3; i += 3) {
        pos[i] = base[i] + vel[i] * t;
        pos[i + 1] = (base[i + 1] + vel[i + 1] * t) % sy;
        pos[i + 2] = base[i + 2] + vel[i + 2] * t;
      }
      g.attributes.position.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------- HTML label 3D cheez ke saath (titles HTML mein rakho)
const _v = new THREE.Vector3();
export function pin(el, obj, s, o = {}) {      // el ko obj ki screen jagah pe (px); update(t) mein, chaal ke baad
  s.camera.lookAt(s.target);
  s.camera.updateMatrixWorld();
  obj.updateWorldMatrix(true, false);
  _v.set(...(o.offset ?? [0, 0, 0])).applyMatrix4(obj.matrixWorld).project(s.camera);
  el.style.left = `${((_v.x + 1) / 2) * s.W + (o.dx ?? 0)}px`;
  el.style.top = `${((1 - _v.y) / 2) * s.H + (o.dy ?? 0)}px`;
}

// ---------------------------------------------------------------- chalao: window.setTime + renderReady
// Module ke shuru mein:  window.renderReady = (async () => { const s = K.stage(); ...await K.text3d(...)...;
//                         K.run(s, t => { ... }); })();
export function run(s, update) {
  window.setTime = t => { update(t); s.render(); };
  window.setTime(0);
}
