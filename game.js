// Kiss the Bricks — renderer, input, UI
import * as THREE from './three.module.min.js';
import * as S from './sim.js';
import { makeSky, makeEnvironment, makePost } from './gfx.js';
import { buildIndyCar, buildPaceCar } from './carmodel.js';
import * as G from './ghost.js';
import { buzz, setHaptics, onUserGesture } from './haptics.js';
import * as D from './daily.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const fmt = (t) => { if (!t) return '--'; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
const fmt1 = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };

// ---------------- settings ----------------
const DEF = { track: 'indy', laps: 10, steer: 'drag', sens: 1, assist: true, throttle: 'auto', difficulty: 'rookie', grid: 11, field: 33, sound: true, coach: true, coachVoice: false, ghost: true, haptics: true, gfx: 'auto', mode: 'race' };
let cfg = Object.assign({}, DEF);
try { Object.assign(cfg, JSON.parse(localStorage.getItem('ktb-settings') || '{}')); } catch (e) {}
for (const k of ['laps', 'grid', 'field', 'sens']) if (Q.has(k)) cfg[k] = +Q.get(k);
if (Q.has('track')) cfg.track = Q.get('track');
if (Q.get('mode') === 'tt' || Q.get('mode') === 'race') cfg.mode = Q.get('mode');
const save = () => { try { localStorage.setItem('ktb-settings', JSON.stringify(cfg)); } catch (e) {} };

// ---------------- renderer ----------------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let dpr = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(dpr);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
// sky: a gradient dome with the sun and drifting clouds (it also lights the cars' reflections)
const SUN_DIR = new THREE.Vector3(0.52, 0.62, 0.36).normalize();
const sky = makeSky({ sunDir: SUN_DIR, zenith: 0x1d4f9c, horizon: 0xa9c6df, ground: 0x6f7468, clouds: 0.75 });
scene.add(sky.mesh);
scene.fog = new THREE.Fog(new THREE.Color(0xa9c6df), 320, 2300);
const camera = new THREE.PerspectiveCamera(60, 1, 0.25, 4000);
const hemi = new THREE.HemisphereLight(0xd9e8ff, 0x4f5a3a, 1.05); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 3.0); sun.position.copy(SUN_DIR).multiplyScalar(500); scene.add(sun); scene.add(sun.target);
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
{ const sc = sun.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 50; sc.far = 900; sc.updateProjectionMatrix(); }
let envRT = null;
try { envRT = makeEnvironment(renderer, sky, {}); scene.environment = envRT.texture; } catch (e) { envRT = null; }
// ---- quality: 2 high (post + 2048 shadows + clear-coat paint), 1 medium (post, 1024 shadows), 0 low (no post / shadows)
const GQ = Q.get('gfx');
let autoTier = 2, tier = -1, post = null, postTried = false;
const tierWanted = () => { const w = GQ || cfg.gfx; return w === 'high' ? 2 : w === 'low' ? 0 : w === 'medium' ? 1 : autoTier; };
const dprMax = () => Math.min(window.devicePixelRatio || 1, tier >= 2 ? 2 : tier === 1 ? 1.6 : 1.25);
const dprMin = () => (tier >= 2 ? 1.5 : 1);
function applyTier(force) {
  const t = tierWanted(); if (t === tier && !force) return; tier = t;
  if (tier >= 1 && !postTried) { postTried = true; try { post = makePost(renderer); } catch (e) { post = null; } }
  sun.castShadow = tier >= 1;
  sun.shadow.mapSize.set(tier >= 2 ? 2048 : 1024, tier >= 2 ? 2048 : 1024); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  if (typeof setCarMaterials === 'function') setCarMaterials();
  dpr = dprMax(); renderer.setPixelRatio(dpr); resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  if (post) post.setSize(w, h, dpr);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  const fx = $('fx'); fx.width = w * Math.min(2, window.devicePixelRatio || 1); fx.height = h * Math.min(2, window.devicePixelRatio || 1);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// ---------------- textures ----------------
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return t;
}
// asphalt: dense aggregate, low-frequency patching and faint longitudinal wear (the tyres' paths)
function vnoise(w, h, cells, seed) {
  // tileable value noise (cells divides the size), returns a Float32Array 0..1
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; const G = []; for (let i = 0; i < cells * cells; i++) G.push(r());
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = x / w * cells, fy = y / h * cells, xi = Math.floor(fx), yi = Math.floor(fy), xf = fx - xi, yf = fy - yi;
    const a = (i, j) => G[((j % cells) * cells) + (i % cells)];
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    out[y * w + x] = (a(xi, yi) * (1 - sx) + a(xi + 1, yi) * sx) * (1 - sy) + (a(xi, yi + 1) * (1 - sx) + a(xi + 1, yi + 1) * sx) * sy;
  }
  return out;
}
const asphaltTex = canvasTex(512, 512, (g, w, h) => {
  const id = g.createImageData(w, h), n1 = vnoise(w, h, 8, 5), n2 = vnoise(w, h, 32, 9);
  let s = 77; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, k = i * 4;
    let v = 112 + (n1[i] - 0.5) * 26 + (n2[i] - 0.5) * 16 + (r() - 0.5) * 44;
    if (r() < 0.018) v += 40 + r() * 40;            // bright aggregate stones
    if (r() < 0.02) v -= 30;                        // pits
    v += Math.sin(x / w * Math.PI * 6) * 3;         // faint wear lanes along the track
    id.data[k] = v * 0.98; id.data[k + 1] = v * 0.99; id.data[k + 2] = v * 1.02; id.data[k + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  g.strokeStyle = 'rgba(20,20,22,0.35)'; g.lineWidth = 1.2;                      // a couple of sealed cracks
  for (let i = 0; i < 3; i++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let j = 0; j < 8; j++) { x += (r() - 0.5) * 30; y += r() * 26; g.lineTo(x, y); } g.stroke(); }
});
// rubber laid down on the racing line: dark in the middle, feathered at the edges, streaky along the track
const rubberTex = canvasTex(128, 256, (g, w, h) => {
  const id = g.createImageData(w, h), n = vnoise(w, h, 16, 21);
  let s = 5; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const streak = []; for (let x = 0; x < w; x++) streak.push(0.75 + r() * 0.5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / (w - 1) * 2 - 1, edge = Math.max(0, 1 - Math.pow(Math.abs(u), 1.6));
    const a = edge * streak[x] * (0.55 + 0.45 * n[y * w + x]);
    const k = (y * w + x) * 4; id.data[k] = 18; id.data[k + 1] = 18; id.data[k + 2] = 20; id.data[k + 3] = Math.round(Math.min(1, a) * 255);
  }
  g.putImageData(id, 0, 0);
});
const fenceTex = canvasTex(64, 64, (g, w, h) => {
  g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.moveTo(-w / 2, h / 2); g.lineTo(w / 2, -h / 2); g.moveTo(w / 2, h * 1.5); g.lineTo(w * 1.5, h / 2); g.moveTo(w / 2, -h / 2); g.lineTo(w * 1.5, h / 2); g.moveTo(-w / 2, h / 2); g.lineTo(w / 2, h * 1.5); g.stroke();
  g.fillStyle = 'rgba(200,205,210,0.9)'; g.fillRect(0, 0, w, 2);
});
const grassTex = canvasTex(256, 256, (g, w, h) => {
  const id = g.createImageData(w, h), n = vnoise(w, h, 8, 3);
  let s = 13; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, k = i * 4, m = x < w / 2 ? 1.07 : 0.95;  // mowing stripes
    const v = (0.82 + (n[i] - 0.5) * 0.3 + (r() - 0.5) * 0.28) * m;
    id.data[k] = 72 * v; id.data[k + 1] = 128 * v; id.data[k + 2] = 50 * v; id.data[k + 3] = 255;
  }
  g.putImageData(id, 0, 0);
});
const brickTex = canvasTex(256, 64, (g, w, h) => {
  g.fillStyle = '#4a3226'; g.fillRect(0, 0, w, h);
  const bw = 32, bh = 16;
  for (let r = 0; r < h / bh; r++) for (let c = -1; c < w / bw + 1; c++) {
    const x = c * bw + (r % 2 ? bw / 2 : 0), y = r * bh;
    const v = 110 + Math.random() * 55; g.fillStyle = `rgb(${v + 40},${v * 0.55},${v * 0.38})`; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 1, y + bh - 4, bw - 2, 3); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 1, y + 1, bw - 2, 2);
  }
});
// grandstands: rows of seated fans (shirts, heads, the odd empty seat), dark risers between rows, stair aisles
const crowdTex = canvasTex(1024, 512, (g, w, h) => {
  g.fillStyle = '#2b2e36'; g.fillRect(0, 0, w, h);
  const shirts = ['#f2f2f2', '#d32f2f', '#1e63c6', '#f5c518', '#1a1a1a', '#e86a1f', '#3f9b4a', '#ffffff', '#f4a6b8', '#8f969e', '#0f2f66', '#b71c1c', '#ffe08a'];
  const skin = ['#f1c7a5', '#d9a07b', '#a86b45', '#6b4429', '#e8b996'];
  const rowH = 32, seatW = 20;
  for (let y = 0; y < h; y += rowH) {
    g.fillStyle = '#4b505a'; g.fillRect(0, y + rowH - 9, w, 9);          // riser / step
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y + rowH - 9, w, 2);
    for (let x = 0; x < w; x += seatW) {
      if ((x / seatW) % 26 === 0) { g.fillStyle = '#6a6f78'; g.fillRect(x, y, seatW, rowH); continue; } // aisle
      if (Math.random() < 0.1) { g.fillStyle = '#26508f'; g.fillRect(x + 3, y + 12, seatW - 6, 10); continue; } // empty seat
      const cx = x + seatW / 2 + (Math.random() - 0.5) * 3;
      g.fillStyle = shirts[(Math.random() * shirts.length) | 0];
      g.beginPath(); g.moveTo(cx - 7, y + rowH - 9); g.lineTo(cx - 6, y + 13); g.quadraticCurveTo(cx, y + 9, cx + 6, y + 13); g.lineTo(cx + 7, y + rowH - 9); g.fill();
      g.fillStyle = skin[(Math.random() * skin.length) | 0]; g.beginPath(); g.arc(cx, y + 8, 4.2, 0, 6.3); g.fill();
      if (Math.random() < 0.35) { g.fillStyle = Math.random() < 0.5 ? '#111' : shirts[(Math.random() * shirts.length) | 0]; g.fillRect(cx - 4.5, y + 3, 9, 3); } // caps
      if (Math.random() < 0.06) { g.fillStyle = skin[0]; g.fillRect(cx + 5, y + 2, 2, 9); } // a raised arm
    }
  }
});
const shadowTex = canvasTex(64, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.65)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.translate(w / 2, h / 2); g.scale(1, 2); g.translate(-w / 2, -h / 2); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.restore();
}, false);
const pylonTex = canvasTex(64, 512, (g, w, h) => {
  g.fillStyle = '#111'; g.fillRect(0, 0, w, h); g.font = 'bold 26px Helvetica, Arial'; g.textAlign = 'center';
  const nums = [1, 2, 3, 8, 10, 12, 14, 20, 21, 26, 27, 28, 29, 45, 60, 77, 98];
  for (let i = 0; i < 15; i++) { g.fillStyle = i < 1 ? '#f5c518' : '#fff'; g.fillText(String(nums[(i * 7) % nums.length]), w / 2, 40 + i * 32); }
}, false);

// ---------------- geometry helpers ----------------
const P = {};
function pt(s, d, y = 0) { S.surfaceOn(GT, s, d, P); return [P.x, P.y + y, P.z]; }
// horizontal point offset outward from a base track point (for stands/walls beyond the banking)
function outPt(s, dBase, off, y) { S.surfaceOn(GT, s, dBase, P); return [P.x - P.tz * off, P.y + y, P.z + P.tx * off]; }
function sList(a, b, step) { const out = []; const n = Math.max(1, Math.ceil((b - a) / step)); for (let i = 0; i <= n; i++) out.push(a + (b - a) * i / n); return out; }
// ribbon: for each s two points (A,B); optional per-vertex colour and uv
function ribbon(ss, fa, fb, opt = {}) {
  const pos = [], uv = [], col = [], idx = [];
  const vScale = opt.vScale || 10;
  ss.forEach((s, i) => {
    pos.push(...fa(s), ...fb(s)); uv.push(0, s / vScale, opt.uMax || 1, s / vScale);
    if (opt.color) { const c = opt.color(s); col.push(...c, ...c); }
    if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (opt.color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function merge(geos) {
  // merge non-indexed or indexed geometries with position/normal/(color)/(uv)
  const out = { position: [], normal: [], color: [], uv: [] }; let hasUV = true;
  for (let g of geos) {
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array, c = g.attributes.color ? g.attributes.color.array : null, u = g.attributes.uv ? g.attributes.uv.array : null;
    for (let i = 0; i < p.length; i++) { out.position.push(p[i]); out.normal.push(n[i]); }
    const cnt = p.length / 3;
    for (let i = 0; i < cnt; i++) { if (c) out.color.push(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]); else out.color.push(1, 1, 1); if (u) out.uv.push(u[i * 2], u[i * 2 + 1]); else { out.uv.push(0, 0); } }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(out.color, 3));
  if (hasUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  return g;
}
function tint(g, hex) { const c = new THREE.Color(hex); const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function box(w, h, l, x, y, z, hex, taper) {
  const g = new THREE.BoxGeometry(w, h, l);
  if (taper) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const zz = p.getZ(i); const f = zz < 0 ? taper[0] : taper[1]; p.setX(i, p.getX(i) * f); if (taper[2] && zz < 0) p.setY(i, p.getY(i) * taper[2]); } }
  g.translate(x, y, z); return tint(g, hex);
}
function placeAlong(g, s, d, y, yaw = 0) {
  // orient geometry built with -z = forward-along-track, +x = outside
  S.surfaceOn(GT, s, d, P); const m = new THREE.Matrix4();
  const f = new THREE.Vector3(P.tx, 0, P.tz), r = new THREE.Vector3(-P.tz, 0, P.tx), up = new THREE.Vector3(0, 1, 0);
  if (yaw) { f.applyAxisAngle(up, yaw); r.applyAxisAngle(up, yaw); }
  m.makeBasis(r, up, f.clone().negate()); m.setPosition(P.x, (y === null ? P.y : y), P.z); g.applyMatrix4(m); return g;
}

// ---------------- the tracks ----------------
let L = S.L, SL = S.S_LINE;
const world = new THREE.Group(); scene.add(world);
const checkerTex = canvasTex(64, 64, (g, w, h) => { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f0'; g.fillRect(x * 16, y * 16, 16, 16); } });
const hossTex = canvasTex(512, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1b4e8f'); gr.addColorStop(1, '#0a1e3a'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff'; g.font = 'bold 64px Helvetica, Arial'; g.textAlign = 'center'; g.fillText('TEXAS', w / 2, 110); g.fillStyle = '#f2c230'; g.font = 'bold 40px Helvetica, Arial'; g.fillText('MOTOR SPEEDWAY', w / 2, 170);
  g.fillStyle = '#d71920'; g.fillRect(0, 210, w, 14); g.fillStyle = '#fff'; g.fillRect(0, 224, w, 6);
}, false);
// geometry is built on GT, which may differ from the track being raced (the road course scenery includes the oval)
let GT = S.TRACK, standAt = null;
const lam = (o) => new THREE.MeshLambertMaterial(o);
const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, o));
const recv = (m) => { m.receiveShadow = true; return m; };
// the racing line's lateral offset on any track (GT may be the oval scenery under the road course)
const lineOn = (T, s) => { const u = (((s % T.L) + T.L) % T.L) / T.DS, i = Math.floor(u), t = u - i; return T.LINE[i] + (T.LINE[Math.min(i + 1, T.n)] - T.LINE[i]) * t; };
const rubberMat = () => std({ map: rubberTex, transparent: true, depthWrite: false, opacity: 0.62, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
// rubbered-in racing line: a dark core along the line and a wider, fainter groove
function racingLine(T, ss, dMin, dMax, lift) {
  const core = [], wide = [];
  for (const r of ss) {
    const c = (s) => clamp(lineOn(T, s), dMin(s) + 1.6, dMax(s) - 1.6);
    core.push(ribbon(r, (s) => pt(s, c(s) - 1.7, lift), (s) => pt(s, c(s) + 1.7, lift), { vScale: 22 }));
    wide.push(ribbon(r, (s) => pt(s, c(s) - 3.6, lift * 0.8), (s) => pt(s, c(s) + 3.6, lift * 0.8), { vScale: 40 }));
  }
  const m1 = new THREE.Mesh(merge(wide), rubberMat()); m1.material.opacity = 0.3; m1.renderOrder = 1;
  const m2 = new THREE.Mesh(merge(core), rubberMat()); m2.renderOrder = 2;
  world.add(recv(m1), recv(m2));
}
// consecutive runs of s where keep(s) holds, so a ribbon can skip gaps
function runs(ss, keep) { const out = []; let cur = []; for (const s of ss) { if (keep(s)) cur.push(s); else { if (cur.length > 1) out.push(cur); cur = []; } } if (cur.length > 1) out.push(cur); return out; }

function buildOvalScene(T, o) {
  GT = T;
  const L = T.L, SL = o.sl;
  const dIn = (s) => S.dInOn(T, s), dOut = (s) => S.dOutOn(T, s);
  const keepP = o.keep || (() => true);              // keep(x, z, r): false where the road course runs
  const keepS = (d, r) => (s) => { S.surfaceOn(T, s, d(s), P); return keepP(P.x, P.z, r); };
  const all = sList(0, L, 4);
  // racing surface + apron (vertex colour tints the asphalt texture)
  const surf = ribbon(all, (s) => pt(s, dIn(s)), (s) => pt(s, dOut(s) + 0.35), { vScale: 14, uMax: 1.5 });
  const apron = ribbon(all, (s) => pt(s, dIn(s) - 4.2), (s) => pt(s, dIn(s)), { vScale: 14, uMax: 0.5, color: () => [1.35, 1.33, 1.28] });
  tint(surf, 0xffffff);
  world.add(recv(new THREE.Mesh(merge([surf, apron]), std({ map: asphaltTex, vertexColors: true, roughness: 0.86 }))));
  racingLine(T, runs(all, keepS((s) => lineOn(T, s), 6)), dIn, dOut, 0.02);
  // white lines: inside edge line, outside line near the wall
  const lines = [
    ribbon(all, (s) => pt(s, dIn(s) - 0.05, 0.03), (s) => pt(s, dIn(s) + 0.3, 0.03)),
    ribbon(all, (s) => pt(s, dOut(s) - 0.65, 0.03), (s) => pt(s, dOut(s) - 0.4, 0.03)),
  ];
  world.add(recv(new THREE.Mesh(merge(lines.map((g) => tint(g, 0xf4f4f0))), std({ vertexColors: true, roughness: 0.6 }))));
  // start / finish: the yard of bricks at Indy, a checkered stripe at Texas
  if (o.startLine === 'bricks') {
    const bricks = ribbon(sList(SL - 0.46, SL + 0.46, 0.46), (s) => pt(s, dIn(s) - 4.2, 0.035), (s) => pt(s, dOut(s) + 0.35, 0.035), { vScale: 0.92 / 0.25 });
    const buv = bricks.attributes.uv; for (let i = 0; i < buv.count; i++) { const u = buv.getX(i), v = buv.getY(i); buv.setXY(i, v, u * 16); }
    world.add(new THREE.Mesh(bricks, lam({ map: brickTex })));
  } else if (o.startLine === 'checker') {
    const ck = ribbon(sList(SL - 0.9, SL + 0.9, 0.9), (s) => pt(s, dIn(s), 0.035), (s) => pt(s, dOut(s) + 0.35, 0.035), { vScale: 1.8 });
    const cuv = ck.attributes.uv; for (let i = 0; i < cuv.count; i++) { const u = cuv.getX(i), v = cuv.getY(i); cuv.setXY(i, v * 0.5, u * 8); }
    world.add(new THREE.Mesh(ck, lam({ map: checkerTex })));
  }
  // grass strip between apron and inside wall; infield grass from the inside wall line
  const strip = ribbon(all, (s) => pt(s, dIn(s) - 7.2, -0.01), (s) => pt(s, dIn(s) - 4.2, -0.01), { vScale: 20 });
  const shape = new THREE.Shape();
  sList(0, L, 8).forEach((s, i) => { S.surfaceOn(T, s, dIn(s) - 7.2, P); i ? shape.lineTo(P.x, -P.z) : shape.moveTo(P.x, -P.z); });
  const inf = new THREE.ShapeGeometry(shape, 1); inf.rotateX(-Math.PI / 2); inf.translate(0, -0.02, 0);
  const iuv = inf.attributes.uv; for (let i = 0; i < iuv.count; i++) iuv.setXY(i, iuv.getX(i) / 20, iuv.getY(i) / 20);
  const ground = new THREE.PlaneGeometry(5200, 3800); ground.rotateX(-Math.PI / 2); ground.translate(0, -0.08, 0);
  const guv = ground.attributes.uv; for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * 240, guv.getY(i) * 170);
  world.add(recv(new THREE.Mesh(merge([tint(strip, 0xffffff), tint(inf, o.infieldTint || 0xffffff), tint(ground, o.groundTint || 0xd8e8c8)]), lam({ map: grassTex, vertexColors: true }))));

  // walls & structures (vertex coloured, one mesh)
  const W = [];
  const sw = (fa, fb, hex, ss = all) => W.push(tint(ribbon(ss, fa, fb), hex));
  // outside SAFER barrier + concrete wall + cap
  sw((s) => pt(s, dOut(s) + 0.35, 0), (s) => pt(s, dOut(s) + 0.35, 1.15), 0xf2f2f2);
  sw((s) => pt(s, dOut(s) + 0.35, 1.15), (s) => outPt(s, dOut(s) + 0.35, 0.6, 1.15), 0xcfcfcf);
  sw((s) => pt(s, dOut(s) + 0.3, 0), (s) => pt(s, dOut(s) + 0.3, 0.24), 0x2c58b0); // blue SAFER base stripe
  // inside wall (with gaps where the road course crosses)
  for (const r of runs(all, keepS((s) => dIn(s) - 7.2, 13))) sw((s) => pt(s, dIn(s) - 7.2, 0), (s) => pt(s, dIn(s) - 7.2, 1.0), 0xe8e8e8, r);
  // pit lane + pit wall area on the front stretch (inside)
  const pitS = sList(o.pit[0], o.pit[1], 5);
  for (const r of runs(pitS, keepS((s) => dIn(s) - 13, 14))) {
    sw((s) => pt(s, dIn(s) - 19), (s) => pt(s, dIn(s) - 7.25, 0.005), 0x8a8a8a, r);
    sw((s) => pt(s, dIn(s) - 7.2, 1.0), (s) => pt(s, dIn(s) - 7.2, 1.6), 0xd9d9d9, r);
  }
  // garages behind pit lane
  for (let s = o.pit[0] + 30; s < o.pit[1] - 20; s += 24) {
    S.surfaceOn(T, s, dIn(s) - 25, P); if (!keepP(P.x, P.z, 22)) continue;
    W.push(placeAlong(box(10, 4.2, 22, 0, 2.1, 0, 0xdedad0), s, dIn(s) - 25, 0)); W.push(placeAlong(box(10.4, 0.4, 22.4, 0, 4.3, 0, 0x2a2a2a), s, dIn(s) - 25, 0));
  }
  // grandstands outside
  const stands = [];
  const stand = (a, b, gap, depth, h0, h1, roof) => {
    const ss = sList(a, b, 6);
    stands.push(ribbon(ss, (s) => outPt(s, dOut(s) + 0.35, gap, h0), (s) => outPt(s, dOut(s) + 0.35, gap + depth, h1), { vScale: 26, uMax: depth / 13 }));
    sw((s) => outPt(s, dOut(s) + 0.35, gap + depth, 0), (s) => outPt(s, dOut(s) + 0.35, gap + depth, h1 + (roof ? 5 : 0)), 0x9aa0a8, ss);
    sw((s) => outPt(s, dOut(s) + 0.35, gap, 0), (s) => outPt(s, dOut(s) + 0.35, gap, h0), 0x6d727a, ss);
    if (roof) sw((s) => outPt(s, dOut(s) + 0.35, gap + depth * 0.25, h1 + 5), (s) => outPt(s, dOut(s) + 0.35, gap + depth + 1, h1 + 5), 0x7d838c, ss);
  };
  for (const st of o.stands) stand(...st);
  world.add(new THREE.Mesh(merge(stands.map((g) => tint(g, 0xffffff))), lam({ map: crowdTex, vertexColors: true })));
  if (o.pagoda) {
    // Pagoda (inside, behind pit lane at the bricks)
    const pg = [];
    const pag = (w, h, l, y, hex) => pg.push(box(w, h, l, 0, y, 0, hex));
    pag(26, 8, 40, 4, 0xd8d8d8);
    for (let i = 0; i < 5; i++) { const y = 8 + i * 7; pag(22 - i * 2.4, 6, 34 - i * 3.2, y + 3, 0x1d2b3a); pag(28 - i * 2.4, 0.8, 42 - i * 3.6, y + 6.4, 0xf0f0f0); }
    pag(6, 10, 6, 49, 0x1d2b3a); pag(8, 0.8, 8, 54.4, 0xf0f0f0);
    W.push(...pg.map((g) => placeAlong(g, SL - 40, dIn(SL) - 46, 0)));
  }
  if (o.tower) {
    // Texas: a glass-and-steel suite tower behind pit road, and the giant video board on the back stretch
    W.push(placeAlong(merge([box(30, 34, 60, 0, 17, 0, 0x2f3f52), box(32, 1.2, 62, 0, 34.6, 0, 0xe6e6e6), box(32, 1, 62, 0, 12, 0, 0xc9c9c9), box(32, 1, 62, 0, 23, 0, 0xc9c9c9)]), SL - 30, dIn(SL) - 48, 0));
    const hs = o.tower.board; W.push(placeAlong(merge([box(2, 30, 2, 0, 15, -40, 0x555b63), box(2, 30, 2, 0, 15, 40, 0x555b63)]), hs, dOut(hs) + 40, 0));
    const scr = new THREE.PlaneGeometry(64, 28); scr.rotateY(-Math.PI / 2); scr.translate(0, 31, 0); placeAlong(scr, hs, dOut(hs) + 38.9, 0);
    world.add(new THREE.Mesh(scr, new THREE.MeshBasicMaterial({ map: hossTex })));
  }
  // starter's stand on the outside wall at the line
  W.push(placeAlong(box(3, 3, 4, 0, 4.2, 0, 0xffffff), SL, dOut(SL) + 2.2, null));
  W.push(placeAlong(box(0.4, 3, 0.4, 0, 1.5, 0, 0x777777), SL, dOut(SL) + 2.2, null));
  S.surfaceOn(T, SL, dOut(SL) + 2.2, P); standAt = { x: P.x, y: P.y, z: P.z, tx: P.tx, tz: P.tz };
  // trees (infield + outside)
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // broadleaf trees: a trunk and three overlapping leafy lobes, each tree a slightly different green
  const leafG = new THREE.IcosahedronGeometry(1, 1);
  const tree = (s, d, sc) => {
    S.surfaceOn(T, s, d, P); if (!keepP(P.x, P.z, 10)) return;
    const base = new THREE.Color(o.treeHex || 0x2f6b2a).offsetHSL((rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.15, (rnd() - 0.5) * 0.08);
    const parts = [tint(new THREE.CylinderGeometry(0.3 * sc, 0.45 * sc, 4 * sc, 5).translate(0, 2 * sc, 0), 0x4a3526)];
    for (let k = 0; k < 3; k++) { const lg = leafG.clone(); const r = (2.4 + rnd() * 1.2) * sc; lg.scale(r, r * 0.85, r); lg.translate((rnd() - 0.5) * 2.2 * sc, (5.2 + rnd() * 2) * sc, (rnd() - 0.5) * 2.2 * sc); parts.push(tint(lg, base.clone().offsetHSL(0, 0, (k - 1) * 0.03).getHex())); }
    W.push(placeAlong(merge(parts), s, d, 0));
  };
  for (let i = 0; i < o.trees[0]; i++) { const s = rnd() * L; tree(s, dIn(s) - 40 - rnd() * (o.treeDepth || 160), 0.8 + rnd() * 0.8); }
  for (let i = 0; i < o.trees[1]; i++) { const s = rnd() * L; tree(s, dOut(s) + 60 + rnd() * 140, 0.9 + rnd() * 0.9); }
  world.add(recv(new THREE.Mesh(merge(W), std({ vertexColors: true, roughness: 0.82 }))));
  // ponds in the infield
  if (o.ponds && o.ponds.length) {
    const pond = new THREE.CircleGeometry(1, 20); pond.rotateX(-Math.PI / 2);
    const keepPond = o.ponds.filter(([s, d, a]) => { S.surfaceOn(T, s, dIn(s) + d, P); return keepP(P.x, P.z, a + 12); });
    if (keepPond.length) {
      const ponds = merge(keepPond.map(([s, d, a, b]) => { const g = pond.clone(); g.scale(a, 1, b); return placeAlong(g, s, dIn(s) + d, 0.0); }));
      ponds.translate(0, -0.005, 0); world.add(new THREE.Mesh(ponds, std({ color: 0x24465f, roughness: 0.06, metalness: 0.3 })));
    }
  }
  // scoring pylon
  if (o.pylon) { const py = new THREE.BoxGeometry(5, 34, 2.5); py.translate(0, 19, 0); placeAlong(py, SL + 160, dIn(SL) - 34, 0); world.add(new THREE.Mesh(py, new THREE.MeshBasicMaterial({ map: pylonTex }))); }
  // catch fence (one translucent strip)
  const fence = ribbon(all, (s) => pt(s, dOut(s) + 0.6, 1.15), (s) => outPt(s, dOut(s) + 0.35, -0.6, 5.6), { vScale: 3, uMax: 1.5 });
  world.add(new THREE.Mesh(fence, new THREE.MeshBasicMaterial({ map: fenceTex, color: 0xc8d0d8, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })));
  // fence posts every 6 m, leaning in over the track like the real catch fence
  const postG = new THREE.CylinderGeometry(0.06, 0.07, 4.6, 5); postG.translate(0, 2.3, 0); postG.rotateZ(0.2); postG.translate(0, 1.1, 0); tint(postG, 0x8c939b);
  const posts = []; for (let s = 0; s < L; s += 6) posts.push(placeAlong(postG.clone(), s, dOut(s) + 0.5, null));
  world.add(new THREE.Mesh(merge(posts), std({ vertexColors: true, roughness: 0.4, metalness: 0.6 })));
}

// The road course: asphalt, edge lines, red/white kerbs at the corners, and tyre walls at the edge of the run-off.
function buildRoadCourse(T, onOval) {
  GT = T;
  const L = T.L, all = sList(0, L, 2);
  const dIn = (s) => S.dInOn(T, s), dOut = (s) => S.dOutOn(T, s);
  const lerp = (A, s) => { const u = (((s % L) + L) % L) / T.DS, i = Math.floor(u), t = u - i; return A[i] + (A[Math.min(i + 1, T.n)] - A[i]) * t; };
  const [oa, ob] = onOval;
  const own = (s) => s < oa + 4 || s > ob - 4;          // off the oval's own front stretch
  const ownW = (s) => s < oa - 90 || s > ob + 40;       // walls: clear of the oval's walls
  const ss = runs(all, own);
  const surf = ss.map((r) => tint(ribbon(r, (s) => pt(s, dIn(s) - 0.05, 0.012), (s) => pt(s, dOut(s) + 0.05, 0.012), { vScale: 14, uMax: 1.5 }), 0xf4f4f4));
  world.add(recv(new THREE.Mesh(merge(surf), std({ map: asphaltTex, vertexColors: true, roughness: 0.86, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))));
  racingLine(T, ss, dIn, dOut, 0.026);
  const lines = [];
  for (const r of ss) {
    lines.push(tint(ribbon(r, (s) => pt(s, dIn(s) + 0.15, 0.03), (s) => pt(s, dIn(s) + 0.45, 0.03)), 0xf4f4f0));
    lines.push(tint(ribbon(r, (s) => pt(s, dOut(s) - 0.45, 0.03), (s) => pt(s, dOut(s) - 0.15, 0.03)), 0xf4f4f0));
  }
  // kerbs where the corner is real (F > 0.25), alternating red / white every 3 m
  const kc = (s) => (Math.floor(s / 3) % 2 ? [0.85, 0.1, 0.1] : [0.95, 0.95, 0.95]);
  for (const r of runs(all, (s) => own(s) && lerp(T.F, s) > 0.25)) {
    lines.push(ribbon(r, (s) => pt(s, dIn(s) - 1.0, 0.04), (s) => pt(s, dIn(s), 0.04), { color: kc }));
    lines.push(ribbon(r, (s) => pt(s, dOut(s), 0.04), (s) => pt(s, dOut(s) + 1.0, 0.04), { color: kc }));
  }
  world.add(recv(new THREE.Mesh(merge(lines), std({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }))));
  // tyre walls (dark, with a red / white top band)
  const W = [];
  for (const r of runs(all, ownW)) {
    const wi = (s) => dIn(s) - lerp(T.WIN, s) - 0.4, wo = (s) => dOut(s) + lerp(T.WOUT, s) + 0.4;
    W.push(tint(ribbon(r, (s) => pt(s, wi(s), 0), (s) => pt(s, wi(s), 0.8)), 0x26282c));
    W.push(tint(ribbon(r, (s) => pt(s, wo(s), 0), (s) => pt(s, wo(s), 0.8)), 0x26282c));
    W.push(ribbon(r, (s) => pt(s, wi(s), 0.8), (s) => pt(s, wi(s), 1.05), { color: (s) => (Math.floor(s / 6) % 2 ? [0.85, 0.12, 0.12] : [0.95, 0.95, 0.95]) }));
    W.push(ribbon(r, (s) => pt(s, wo(s), 0.8), (s) => pt(s, wo(s), 1.05), { color: (s) => (Math.floor(s / 6) % 2 ? [0.85, 0.12, 0.12] : [0.95, 0.95, 0.95]) }));
  }
  // corner marker boards before the big brake zones
  world.add(recv(new THREE.Mesh(merge(W), std({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }))));
  // the yard of bricks: the road course starts and finishes on it too
  const sl = S.TRACKS.road.sLine;
  const bricks = ribbon(sList(sl - 0.46, sl + 0.46, 0.46), (s) => pt(s, dIn(s), 0.04), (s) => pt(s, dOut(s) + 4.2, 0.04), { vScale: 0.92 / 0.25 });
  const buv = bricks.attributes.uv; for (let i = 0; i < buv.count; i++) { const u = buv.getX(i), v = buv.getY(i); buv.setXY(i, v, u * 16); }
  world.add(new THREE.Mesh(bricks, lam({ map: brickTex, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 })));
}

// distance test against the road course centreline (spatial hash, 20 m cells)
let rcHash = null;
function nearRoad(x, z, r) {
  if (!rcHash) { rcHash = new Map(); const T = S.TRACKS.road; for (let i = 0; i < T.n; i++) { const k = Math.floor(T.X[i] / 20) + ',' + Math.floor(T.Z[i] / 20); if (!rcHash.has(k)) rcHash.set(k, []); rcHash.get(k).push(T.X[i], T.Z[i]); } }
  const R = r + 7.6, cx = Math.floor(x / 20), cz = Math.floor(z / 20), n = Math.ceil(R / 20);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const a = rcHash.get((cx + i) + ',' + (cz + j)); if (!a) continue; for (let k = 0; k < a.length; k += 2) if (Math.hypot(a[k] - x, a[k + 1] - z) < R) return true; }
  return false;
}

const INDY_STANDS = [[40, 1000, 6, 42, 2.5, 26, true], [1010, 1600, 7, 26, 2.5, 15, false], [1820, 2400, 7, 22, 2.5, 13, false], [2620, 3100, 7, 16, 2.5, 10, false], [3300, 4010, 7, 30, 2.5, 18, true]];
const INDY_PONDS = [[1700, -120, 60, 28], [2100, -150, 40, 22], [3500, -170, 52, 30]];
function buildWorld(id) {
  for (const m of world.children.slice()) { world.remove(m); m.geometry.dispose(); m.material.dispose(); }
  if (id === 'indy') {
    buildOvalScene(S.TRACKS.indy, { sl: 610, startLine: 'bricks', pit: [110, 960], stands: INDY_STANDS, pagoda: true, pylon: true, ponds: INDY_PONDS, trees: [150, 90] });
  } else if (id === 'texas') {
    const T = S.TRACKS.texas;
    buildOvalScene(T, { sl: T.sLine, startLine: 'checker', pit: [60, 640], stands: [[10, 680, 6, 50, 2.5, 32, true], [700, 1130, 7, 30, 2.5, 20, false], [1560, 2400, 7, 30, 2.5, 20, false]],
      tower: { board: 1330 }, pylon: true, trees: [25, 50], treeDepth: 90, treeHex: 0x52702f, groundTint: 0xe8e2b8, infieldTint: 0xf2f2e0 });
  } else {
    // the oval as scenery (its own front stretch is the road course's main straight), with the road course on top
    const O = S.TRACKS.indy, R = S.TRACKS.road;
    S.surfaceOn(R, R.sLine, 0, P); const bx = P.x, bz = P.z; let best = 0, bd = 1e9;
    for (let i = 0; i < O.n; i++) { const d = Math.hypot(O.X[i] - bx, O.Z[i] - bz); if (d < bd) { bd = d; best = i * O.DS; } }
    buildOvalScene(O, { sl: best, startLine: null, pit: [110, 960], stands: INDY_STANDS, pagoda: true, pylon: true, ponds: INDY_PONDS, trees: [150, 90], keep: (x, z, r) => !nearRoad(x, z, r) });
    buildRoadCourse(R, S.ROAD_ON_OVAL);
  }
  GT = S.TRACK;
}

// ---------------- cars ----------------
const MAXC = 33;
// the cars: a modern Indy car built from smooth lofted panels, six instanced meshes (one per material) for the field
const CG = buildIndyCar();
const paintStd = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.18, envMapIntensity: 1.15 });
const paintPhys = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.36, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.25 });
const carbonMat = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.42, metalness: 0.3, envMapIntensity: 0.8 });
const tyreMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.93, metalness: 0 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.26, metalness: 1, envMapIntensity: 1.2 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x0b1016, roughness: 0.04, metalness: 0.6, envMapIntensity: 1.6 });
const bodyMesh = new THREE.InstancedMesh(CG.paint, paintPhys, MAXC);
const accMesh = new THREE.InstancedMesh(CG.accent, paintPhys, MAXC);
const carMeshes = [bodyMesh, accMesh, new THREE.InstancedMesh(CG.carbon, carbonMat, MAXC), new THREE.InstancedMesh(CG.rubber, tyreMat, MAXC), new THREE.InstancedMesh(CG.metal, metalMat, MAXC), new THREE.InstancedMesh(CG.glass, glassMat, MAXC)];
for (const m of carMeshes) { m.frustumCulled = false; m.castShadow = true; m.count = 0; scene.add(m); }
function setCarMaterials() { const m = tier >= 2 ? paintPhys : paintStd; bodyMesh.material = accMesh.material = m; }
const setCarCount = (n) => { for (const m of carMeshes) m.count = n; };
const shGeo = new THREE.PlaneGeometry(2.4, 5.4); shGeo.rotateX(-Math.PI / 2);
const shMesh = new THREE.InstancedMesh(shGeo, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.75 }), MAXC + 1);
shMesh.frustumCulled = false; scene.add(shMesh);
// pace car: a low white coupe with the light bar
const PG = buildPaceCar();
const paceCar = new THREE.Group();
paceCar.add(new THREE.Mesh(PG.body, new THREE.MeshPhysicalMaterial({ color: 0xf2f2f0, roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 })));
paceCar.add(new THREE.Mesh(PG.glass, glassMat), new THREE.Mesh(PG.dark, tyreMat), new THREE.Mesh(PG.metal, metalMat));
paceCar.add(new THREE.Mesh(PG.light, new THREE.MeshStandardMaterial({ color: 0xff3b1f, emissive: 0xff2a10, emissiveIntensity: 2.2 })));
{ const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 4.7), new THREE.MeshStandardMaterial({ color: 0x1e63c6, roughness: 0.35 })); stripe.position.set(0, 0.935, 0); paceCar.add(stripe); }
paceCar.children.forEach((m) => { m.castShadow = true; });
paceCar.matrixAutoUpdate = false; scene.add(paceCar);
// ghost car: your best lap on this track, a translucent blue-white replay
const ghostMat = new THREE.MeshStandardMaterial({ color: 0xa8e4ff, emissive: 0x2f9ae0, emissiveIntensity: 0.7, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.4, depthWrite: false });
const ghostCar = new THREE.Group();
for (const k of ['paint', 'accent', 'carbon', 'rubber']) ghostCar.add(new THREE.Mesh(CG[k], ghostMat));
ghostCar.matrixAutoUpdate = false; ghostCar.visible = false; ghostCar.renderOrder = 4; scene.add(ghostCar);
// sparks
const SPK = 80; const spkPos = new Float32Array(SPK * 3), spkVel = new Float32Array(SPK * 3), spkLife = new Float32Array(SPK);
const spkGeo = new THREE.BufferGeometry(); spkGeo.setAttribute('position', new THREE.BufferAttribute(spkPos, 3));
const sparks = new THREE.Points(spkGeo, new THREE.PointsMaterial({ color: 0xffc04a, size: 0.18, transparent: true, depthWrite: false }));
sparks.frustumCulled = false; scene.add(sparks);
let spkI = 0;
function spawnSparks(x, y, z, vx, vz, n) { for (let i = 0; i < n; i++) { const k = spkI++ % SPK; spkPos[k * 3] = x; spkPos[k * 3 + 1] = y; spkPos[k * 3 + 2] = z; spkVel[k * 3] = vx * (0.6 + Math.random() * 0.4) + (Math.random() - 0.5) * 6; spkVel[k * 3 + 1] = 2 + Math.random() * 4; spkVel[k * 3 + 2] = vz * (0.6 + Math.random() * 0.4) + (Math.random() - 0.5) * 6; spkLife[k] = 0.3 + Math.random() * 0.35; } }
// kiss mark (win celebration)
const kissTex = canvasTex(128, 128, (g, w, h) => { g.font = '100px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('💋', w / 2, h / 2 + 6); }, false);
const kissMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: kissTex, transparent: true, depthWrite: false }));
kissMesh.visible = false; scene.add(kissMesh);

const M4 = new THREE.Matrix4(), vF = new THREE.Vector3(), vR = new THREE.Vector3(), vU = new THREE.Vector3(), vT = new THREE.Vector3(), vRb = new THREE.Vector3();
function carFrame(s, d, psi, out) {
  S.surface(s, d, P);
  const b = P.bank, cb = Math.cos(b), sb = Math.sin(b);
  vF.set(P.tx, 0, P.tz); vR.set(-P.tz, 0, P.tx);
  vRb.set(vR.x * cb, sb, vR.z * cb);                         // right along the banked surface
  vU.set(-vR.x * sb, cb, -vR.z * sb);                        // surface normal
  const cp = Math.cos(psi), sp = Math.sin(psi);
  const fx = vF.x * cp + vRb.x * sp, fy = vRb.y * sp, fz = vF.z * cp + vRb.z * sp;
  const rx = vRb.x * cp - vF.x * sp, ry = vRb.y * cp, rz = vRb.z * cp - vF.z * sp;
  out.pos.set(P.x, P.y, P.z); out.fwd.set(fx, fy, fz); out.right.set(rx, ry, rz); out.up.copy(vU);
  return out;
}
const tmpF = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
const camF = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
function setInstance(mesh, i, f, lift = 0) {
  vT.copy(f.fwd).negate();
  M4.makeBasis(f.right, f.up, vT); M4.setPosition(f.pos.x + f.up.x * lift, f.pos.y + f.up.y * lift + 0.02, f.pos.z + f.up.z * lift);
  mesh.setMatrixAt(i, M4);
}

// ---------------- audio ----------------
const theme = $('theme'); theme.volume = 0.55;
let actx = null, eng = null;
function initAudio() {
  if (actx || !cfg.sound) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const g = actx.createGain(); g.gain.value = 0; g.connect(actx.destination);
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 3; lp.connect(g);
    const o1 = actx.createOscillator(); o1.type = 'sawtooth'; o1.connect(lp); o1.start();
    const o2 = actx.createOscillator(); o2.type = 'square'; const g2 = actx.createGain(); g2.gain.value = 0.35; o2.connect(g2); g2.connect(lp); o2.start();
    eng = { g, lp, o1, o2 };
  } catch (e) { actx = null; }
}
function engineSound(v, on, draft) {
  if (!eng) return;
  const t = actx.currentTime;
  const target = on && cfg.sound ? 0.075 : 0;
  eng.g.gain.setTargetAtTime(target, t, 0.08);
  // six-speed feel below ~170 mph, then top gear
  const vv = v / 104.2; let r;
  if (vv < 0.72) { const gear = Math.floor(vv / 0.12); r = 0.55 + ((vv - gear * 0.12) / 0.12) * 0.4; } else r = 0.6 + (vv - 0.72) * 1.4;
  const f = 95 + r * 260 + draft * 15;
  eng.o1.frequency.setTargetAtTime(f, t, 0.05); eng.o2.frequency.setTargetAtTime(f * 1.505, t, 0.05);
  eng.lp.frequency.setTargetAtTime(600 + vv * 1600, t, 0.1);
}
function playTheme(on) {
  if (!cfg.sound) on = false;
  if (on) { theme.volume = 0.55; const p = theme.play(); if (p && p.catch) p.catch(() => {}); } else theme.pause();
}

// ---------------- input ----------------
const input = { steer: 0, rawSteer: 0, throttle: 0, brake: 0 };
const keys = {};
let drag = null, tiltNeutral = null, tiltVal = 0, tiltOK = false, liftDown = false, gasDown = false;
window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; if (e.key === 'Escape' || e.key === 'p') togglePause(); if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) e.preventDefault(); });
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
const hudEl = $('hud');
function isControl(t) { return t && t.closest && t.closest('button, .card'); }
document.addEventListener('touchmove', (e) => { if (!e.target.closest || !e.target.closest('.card')) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
window.addEventListener('pointerdown', (e) => {
  onUserGesture();
  initAudio(); if (actx && actx.state === 'suspended') actx.resume();
  if (state !== 'race' || isControl(e.target) || drag) return;
  if (cfg.steer !== 'drag') return;
  drag = { id: e.pointerId, x0: e.clientX, x: e.clientX, y: e.clientY };
  const dot = $('steerDot'); dot.classList.remove('hidden'); dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px';
});
window.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const range = Math.max(60, Math.min(window.innerWidth, 900) * 0.15) / (cfg.sens || 1);
  let dx = e.clientX - drag.x0;
  if (dx > range) { drag.x0 = e.clientX - range; dx = range; } else if (dx < -range) { drag.x0 = e.clientX + range; dx = -range; }
  drag.x = e.clientX; input.rawSteer = dx / range;
  const dot = $('steerDot'); dot.style.left = e.clientX + 'px';
});
const endDrag = (e) => { onUserGesture(); if (drag && e.pointerId === drag.id) { drag = null; input.rawSteer = 0; $('steerDot').classList.add('hidden'); } };
window.addEventListener('pointerup', endDrag); window.addEventListener('pointercancel', endDrag);
function pedal(el, set) {
  const on = (e) => { e.preventDefault(); e.stopPropagation(); onUserGesture(); buzz('tap'); set(true); el.classList.add('down'); try { el.setPointerCapture(e.pointerId); } catch (_) {} };
  const off = (e) => { set(false); el.classList.remove('down'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
}
pedal($('btnLift'), (v) => liftDown = v); pedal($('btnGas'), (v) => gasDown = v);
function onTilt(e) {
  const ang = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
  let v;
  if (ang === 90) v = e.beta; else if (ang === -90 || ang === 270) v = -e.beta; else v = e.gamma;
  if (v == null) return; tiltOK = true; tiltVal = v;
}
async function enableTilt() {
  const note = $('tiltNote');
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') { note.textContent = 'Motion access was declined, so steering stays on thumb drag.'; cfg.steer = 'drag'; syncSettings(); return; }
    }
    window.addEventListener('deviceorientation', onTilt);
    note.textContent = 'Tilt steering on. Hold the phone the way you like before the green flag; that becomes centre.';
  } catch (e) { note.textContent = 'Tilt is not available here, so steering stays on thumb drag.'; cfg.steer = 'drag'; syncSettings(); }
}
function readInput(dt) {
  let target = 0;
  const kL = keys['arrowleft'] || keys['a'], kR = keys['arrowright'] || keys['d'];
  if (kL || kR) {
    const k = (kR ? 1 : 0) - (kL ? 1 : 0);
    input.keySteer = clamp((input.keySteer || 0) + (k ? k * dt * 3.2 : -Math.sign(input.keySteer || 0) * Math.min(Math.abs(input.keySteer || 0), dt * 6)), -1, 1);
    target = input.keySteer;
  } else { input.keySteer = 0; }
  if (!(kL || kR)) {
    if (cfg.steer === 'tilt' && tiltOK) {
      if (tiltNeutral === null) tiltNeutral = tiltVal;
      let dv = tiltVal - tiltNeutral; dv = Math.abs(dv) < 1.5 ? 0 : dv - Math.sign(dv) * 1.5;
      target = clamp(dv / (20 / (cfg.sens || 1)), -1, 1);
    } else target = input.rawSteer;
  }
  // gentle response curve for fine control around centre
  target = Math.sign(target) * Math.pow(Math.abs(target), 1.25);
  input.steer += (target - input.steer) * (1 - Math.exp(-dt / 0.07));
  input.brake = (liftDown || keys['arrowdown'] || keys['s'] || keys[' ']) ? 1 : 0;
  input.throttle = (gasDown || keys['arrowup'] || keys['w']) ? 1 : 0;
}

// ---------------- UI ----------------
let state = 'title', race = null, camMode = 0, msgT = 0, lastTs = 0, timeScale = +(Q.get('timescale') || 1), winCam = 0, kissed = false, finishShown = false;
const banner = $('banner'), hint = $('hint');
function showBanner(text, cls = 'white', dur = 1.6) { banner.textContent = text; banner.className = 'banner on ' + cls; msgT = dur; }
function show(id, on) { $(id).classList.toggle('hidden', !on); }
function syncSettings() {
  document.querySelectorAll('.seg[data-key]').forEach((sg) => { const k = sg.dataset.key; sg.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', String(cfg[k]) === b.dataset.v)); });
  $('segLaps').querySelectorAll('button').forEach((b) => b.classList.toggle('sel', String(cfg.laps) === b.dataset.v));
  document.body.classList.toggle('manual', cfg.throttle === 'manual');
  $('btnGas').classList.toggle('hidden', cfg.throttle !== 'manual');
  $('btnLift').textContent = (cfg.throttle === 'manual' || S.INFO.kind === 'road') ? 'BRAKE' : 'LIFT';
  save();
}
document.querySelectorAll('.seg[data-key] button').forEach((b) => b.addEventListener('click', () => {
  const k = b.parentElement.dataset.key; let v = b.dataset.v;
  if (v === 'true') v = true; else if (v === 'false') v = false; else if (!isNaN(+v)) v = +v;
  cfg[k] = v; syncSettings();
  if (k === 'haptics') { setHaptics(v); if (v) buzz('tap'); }
  if (k === 'gfx') { autoTier = 2; applyTier(); }
  if (k === 'mode' && !$('tracks').classList.contains('hidden')) buildTrackCards();
  if (k === 'steer' && v === 'tilt') enableTilt(); else if (k === 'steer') $('tiltNote').textContent = '';
  if (k === 'sound') { if (!v) { playTheme(false); if (eng) eng.g.gain.value = 0; } else if (state === 'title') { initAudio(); playTheme(true); } }
}));
$('segLaps').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { cfg.laps = +b.dataset.v; syncSettings(); initAudio(); if (state === 'title') playTheme(true); }));
// the leaderboard knows today's Daily board too (re-read each time: the day can roll over while the page is open)
function lbBoards() {
  if (!window.GDGBoard) return;
  const key = race && race.daily ? race.daily.key : dailyKey();
  window.GDGBoard.init({ game: 'kissthebricks', title: 'Kiss the Bricks', boards: { indy: 'Indy Oval', texas: 'Texas', road: 'Road Course', ['daily-' + key]: 'Daily · ' + D.keyLabel(key).replace(/^\w+, /, '') }, order: 'asc', fmt: fmt, unit: 'Best lap per track. Faster is better. Daily: best lap in today\'s challenge.', accent: '#f2c230' });
}
lbBoards();
$('btnBoard').addEventListener('click', () => { lbBoards(); if (window.GDGBoard) window.GDGBoard.show(cfg.track); });
$('btnFBoard').addEventListener('click', () => { lbBoards(); if (window.GDGBoard) window.GDGBoard.show(race && race.daily ? 'daily-' + race.daily.key : S.INFO.id); });
let settingsFrom = 'title';
$('btnSettings').addEventListener('click', () => { settingsFrom = 'title'; show('settings', true); });
$('btnPauseSettings').addEventListener('click', () => { settingsFrom = 'pause'; show('pause', false); show('settings', true); });
$('btnSetDone').addEventListener('click', () => { show('settings', false); if (settingsFrom === 'pause') show('pause', true); });
$('btnRace').addEventListener('click', () => { daily = null; initAudio(); if (actx && actx.state === 'suspended') actx.resume(); buildTrackCards(); show('title', false); show('tracks', true); });
$('btnPause').addEventListener('click', () => togglePause());
$('btnCam').addEventListener('click', () => { camMode = (camMode + 1) % 3; });
$('btnResume').addEventListener('click', () => togglePause(false));
$('btnRestart').addEventListener('click', () => { show('pause', false); startRace(); });
$('btnQuit').addEventListener('click', () => { show('pause', false); toTitle(); });
$('btnAgain').addEventListener('click', () => { show('finish', false); startRace(); });
$('btnMenu').addEventListener('click', () => { show('finish', false); toTitle(); });
// fire on touchend (iOS) or click, never twice for one tap
function onTap(el, fn) {
  let last = 0; const go = (e) => { const now = performance.now(); if (now - last < 350) return; last = now; fn(e); };
  el.addEventListener('touchend', (e) => { if (e.cancelable) e.preventDefault(); go(e); }, { passive: false });
  el.addEventListener('click', go);
}
onTap($('btnKiss'), () => {
  buzz('win'); initAudio(); if (actx && actx.state === 'suspended') actx.resume();
  if (S.INFO.bricks) { $('btnKiss').classList.add('hidden'); burst(160); kissed = true; winCam = 0; $('fSub').innerHTML = 'Smack. A Brickyard tradition. 🥛 Milk is on the way.'; }
  else { fireSixShooters(); $('btnKiss').textContent = '🤠 Fire again!'; $('fSub').innerHTML = 'Bang! Bang! Cowboy hat on, six-shooters in the air. That\'s how they celebrate in Texas Victory Lane. 🤠'; }
});
$('title').addEventListener('pointerdown', () => { initAudio(); if (state === 'title') playTheme(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (state === 'race') togglePause(true); playTheme(false); if (actx) actx.suspend(); } });

// ---------------- tracks: select, apply, best laps ----------------
let bests = {}; try { bests = JSON.parse(localStorage.getItem('ktb-best') || '{}') || {}; } catch (e) {}
const saveBest = (id, t) => { if (!t) return false; if (bests[id] && bests[id] <= t) return false; bests[id] = t; try { localStorage.setItem('ktb-best', JSON.stringify(bests)); } catch (e) {} return true; };
let builtTrack = null;
function applyTrack(id, keepCfg) {
  if (!S.TRACK_INFO[id]) id = 'indy';
  if (!keepCfg) { cfg.track = id; save(); }
  S.setTrack(id); L = S.L; SL = S.S_LINE;
  if (builtTrack !== id) { buildWorld(id); builtTrack = id; }
  drawMapBg();
  document.body.classList.toggle('road', S.INFO.kind === 'road');
  $('spotL').innerHTML = S.INFO.kind === 'road' ? '&#9664; CAR LEFT' : '&#9664; CAR LOW'; $('spotR').innerHTML = S.INFO.kind === 'road' ? 'CAR RIGHT &#9654;' : 'CAR HIGH &#9654;';
  syncSettings();
}
// thumbnail of a track's real outline, start/finish marked
function drawThumb(cv, id) {
  const T = S.TRACKS[id], w = cv.width, h = cv.height, g = cv.getContext('2d');
  const B = id === 'road' ? S.TRACKS.indy : T;  // the road course is framed inside the oval it sits in
  const k = Math.min((w - 16) / B.size[0], (h - 16) / B.size[1]), C = B.center;
  const X = (i) => w / 2 + (T.X[i] - C[0]) * k, Y = (i) => h / 2 + (T.Z[i] - C[1]) * k;
  g.clearRect(0, 0, w, h);
  if (id === 'road') { // the oval around it, faint
    const O = S.TRACKS.indy; g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = Math.max(3, w / 40); g.beginPath();
    for (let i = 0; i <= O.n; i += 4) { const x = w / 2 + (O.X[i] - C[0]) * k, y = h / 2 + (O.Z[i] - C[1]) * k; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.stroke();
  }
  g.strokeStyle = '#f2c230'; g.lineWidth = Math.max(3, w / 30); g.lineJoin = 'round'; g.beginPath();
  for (let i = 0; i <= T.n; i += 2) i ? g.lineTo(X(i), Y(i)) : g.moveTo(X(i), Y(i)); g.closePath(); g.stroke();
  const j = Math.round(T.sLine / T.DS) % T.n; g.save(); g.translate(X(j), Y(j)); g.rotate(Math.atan2(T.TZ[j], T.TX[j]));
  g.fillStyle = S.TRACK_INFO[id].bricks ? '#c0573a' : '#fff'; g.fillRect(-2.5, -w / 18, 5, w / 9); g.restore();
}
function buildTrackCards() {
  const box = $('trackList'); box.innerHTML = '';
  for (const id of S.TRACK_IDS) {
    const I = S.TRACK_INFO[id];
    const b = document.createElement('button'); b.className = 'tcard' + (cfg.track === id ? ' sel' : ''); b.dataset.track = id;
    b.setAttribute('aria-label', I.name + ', ' + I.lenMi + ' miles');
    b.innerHTML = `<canvas width="240" height="132" aria-hidden="true"></canvas><span class="tinfo"><b>${I.name}</b><span class="tlen">${I.lenMi} mi · ${I.turns} turns · ${I.kind === 'road' ? 'flat' : I.bank + ' banking'}</span><span class="tbest">${bests[id] ? 'Your best lap ' + fmt(bests[id]) : (id === 'road' ? 'Brake zones. Use BRAKE.' : 'No lap yet')}${G.loadGhost(id) ? ' · <i class="gh">👻 ghost</i>' : ''}</span></span>`;
    b.addEventListener('click', () => { initAudio(); if (actx && actx.state === 'suspended') actx.resume(); daily = null; applyTrack(id); show('tracks', false); startRace(); });
    box.appendChild(b); drawThumb(b.querySelector('canvas'), id);
  }
}
$('btnTrackBack').addEventListener('click', () => { show('tracks', false); show('title', true); });

// ---------------- Car setup: one TIGHT <-> LOOSE slider, saved per track ----------------
// -10 (full tight) .. 0 (neutral, the car as it always was) .. +10 (full loose). sim.js does the physics.
// The slider has a detent: the middle few positions of the input all read NEUTRAL, so it snaps to center.
const SETUP_STORE = 'ktb-setup-v1';
let setups = {};
try { const v = JSON.parse(localStorage.getItem(SETUP_STORE) || '{}'); if (v && typeof v === 'object') setups = v; } catch (e) {}
function setupOf(id) { const n = Math.round(+setups[id] || 0); return n < -10 ? -10 : n > 10 ? 10 : n; }
function setupSave(id, n) { if (n) setups[id] = n; else delete setups[id]; try { localStorage.setItem(SETUP_STORE, JSON.stringify(setups)); } catch (e) {} }
const SU_DET = 3;                                   // detent half-width, in input steps
const suToN = (raw) => { const a = Math.abs(raw); return a <= SU_DET ? 0 : Math.sign(raw) * (a - SU_DET); };
const nToSu = (n) => n === 0 ? 0 : Math.sign(n) * (Math.abs(n) + SU_DET);
const suLabel = (n) => S.setupLabel(n / 10);
const SU_TIP = {
  indy: 'Engineer: Indy\u2019s four turns are flat and fast. Most drivers run it a touch tight here so it sticks flat out.',
  texas: 'Engineer: the 24\u00b0 banking holds the car down, so you can run Texas near neutral, even a click or two loose.',
  road: 'Engineer: the slow infield corners like a bit of loose for rotation. Too loose and it\u2019ll spin when you brake late.',
};
function suDesc(n) {
  const a = Math.abs(n);
  if (!n) return 'Neutral: the car you\u2019ve always raced. Front and rear let go together.';
  if (n < 0) return a <= 3 ? 'A touch tight: the nose washes out a little in the turns, the rear stays planted. Safe on corner exit.'
    : a <= 7 ? 'Tight: pushes up the track in the turns. Lazier turn-in and it needs more wheel, but the rear won\u2019t come around.'
    : 'Very tight: heavy push. It plows toward the wall unless you hold it down, and it\u2019s nearly impossible to spin.';
  return a <= 3 ? 'A touch loose: sharper turn-in and the car rotates nicely through slow corners. The rear is a little lighter.'
    : a <= 7 ? 'Loose: quick to turn and the tail hangs out. Traction is shorter off the corners, so be smooth on the wheel.'
    : 'Very loose: the rear steps out under load. Lifting or yanking the wheel mid-corner can spin it.';
}
function suKind(n) { const a = Math.abs(n); return !n ? 'Balanced' : (a <= 3 ? 'A touch ' : a <= 7 ? '' : 'Very ') + (n < 0 ? 'tight' : 'loose'); }
function setupSummary() { return S.TRACK_IDS.map((id) => (id === 'indy' ? 'Indy ' : id === 'texas' ? 'Texas ' : 'Road ') + (setupOf(id) ? suLabel(setupOf(id)) : 'N')).join(' \u00b7 '); }
let suTrack = 'indy', suFrom = 'tracks';
function renderSetup() {
  const n = setupOf(suTrack), I = S.TRACK_INFO[suTrack];
  const rng = $('suRange'); if (suToN(+rng.value) !== n) rng.value = nToSu(n);
  const v = $('suVal'); v.textContent = suLabel(n); v.className = n < 0 ? 't' : n > 0 ? 'l' : '';
  $('suKind').textContent = suKind(n);
  $('suTrack').textContent = I.name;
  $('suDesc').textContent = suDesc(n);
  $('suTip').textContent = SU_TIP[suTrack] || '';
  rng.setAttribute('aria-valuetext', suKind(n) + (n ? ', ' + suLabel(n) : ''));
  // fill from center to the thumb
  const f = $('suFill'), x = nToSu(n) / 13 * 50;
  f.style.left = (x < 0 ? 50 + x : 50) + '%'; f.style.width = Math.abs(x) + '%';
  // graphic: push arrow and front tyres for tight, tail-out arc and rear tyres for loose, body yaw
  const t = Math.max(0, -n) / 10, l = Math.max(0, n) / 10;
  $('suPush').style.opacity = (0.08 + 0.92 * t).toFixed(2);
  $('suRot').style.opacity = (0.08 + 0.92 * l).toFixed(2);
  const ft = `rgb(${22 + 60 * t | 0},${23 + 120 * t | 0},${26 + 200 * t | 0})`, rt = `rgb(${22 + 230 * l | 0},${23 + 100 * l | 0},${26 + 30 * l | 0})`;
  $('suTFL').style.fill = ft; $('suTFR').style.fill = ft; $('suTRL').style.fill = rt; $('suTRR').style.fill = rt;
  $('suCarG').setAttribute('transform', `rotate(${(-n * 1.1).toFixed(1)} 104 116)`);
  $('suTracks').querySelectorAll('button').forEach((b) => { const on = b.dataset.t === suTrack; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.setAttribute('role', 'radio'); });
  const fromPause = suFrom === 'pause';
  $('suTracks').classList.toggle('hidden', fromPause);
  const changed = fromPause && race && race.setupN !== n;
  $('suNote').textContent = fromPause ? (changed ? 'Saved for ' + I.short + '. It takes effect when you restart; this race keeps ' + suLabel(race.setupN) + '.' : 'Changes take effect when you restart the race.') : 'Saved for ' + I.short + ' on this phone. Leaderboards stay open to any setup.';
  $('suRestart').classList.toggle('hidden', !changed);
  updateSetupLabels();
}
function suFinishLine() { const n = race ? race.setupN : 0; return n ? '<br><span class="dsmall">Car setup ' + suLabel(n) + ' (' + suKind(n).toLowerCase() + ')</span>' : ''; }
function updateSetupLabels() {
  $('setupSum').textContent = setupSummary();
  if (race) $('pauseSetup').textContent = suLabel(setupOf(S.TRACK_ID));
}
function openSetup(from, track) {
  suFrom = from; suTrack = S.TRACK_INFO[track] ? track : 'indy';
  renderSetup(); show('setup', true);
}
let suLast = 0;
$('suRange').addEventListener('input', (e) => {
  const n = suToN(+e.target.value);
  if (n === setupOf(suTrack)) return;
  if (n === 0 || suLast === 0) buzz('tap');           // a click as it drops into (or out of) the center detent
  suLast = n; setupSave(suTrack, n); renderSetup();
});
$('suRange').addEventListener('change', (e) => { e.target.value = nToSu(setupOf(suTrack)); renderSetup(); });  // settle the thumb in the detent
$('suTracks').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { suTrack = b.dataset.t; suLast = setupOf(suTrack); renderSetup(); }));
$('suReset').addEventListener('click', () => { setupSave(suTrack, 0); suLast = 0; renderSetup(); buzz('tap'); });
$('suDone').addEventListener('click', () => { show('setup', false); if (suFrom === 'pause') { show('pause', true); updateSetupLabels(); } else if (suFrom === 'tracks') buildTrackCards(); });
$('suRestart').addEventListener('click', () => { show('setup', false); show('pause', false); startRace(); });
$('btnSetup').addEventListener('click', () => openSetup('tracks', cfg.track));
$('btnTitleSetup').addEventListener('click', () => openSetup('title', cfg.track));
$('btnPauseSetup').addEventListener('click', () => { show('pause', false); openSetup('pause', S.TRACK_ID); });
updateSetupLabels();


// ---------------- Daily Challenge ----------------
// One seeded race a day (daily.js): same track, laps, grid, field, time of day, wind and grip for everyone.
// The first run of the day counts (once the green flag drops) and its best lap can go on today's board;
// every run after that is practice and never posts. Normal races, their bests, ghosts and boards are untouched.
let daily = null;                                   // { spec, official } while a daily run is set up
const DAILY_STORE = 'ktb-daily-v1';                 // { key: 'YYYYMMDD', used, best }
function dailyKey() { const q = Q.get('daily'); return D.validKey(q) ? q : D.nyDateKey(); }
function dailyRec() { try { const v = JSON.parse(localStorage.getItem(DAILY_STORE) || 'null'); return v && typeof v.key === 'string' ? v : null; } catch (e) { return null; } }
function dailySave(v) { try { localStorage.setItem(DAILY_STORE, JSON.stringify(v)); } catch (e) {} }
// a run counts only on today's real date (a ?daily= preview of another day is always practice) and only once
function dailyCanCount(key) { const r = dailyRec(); return key === D.nyDateKey() && !(r && r.key === key && r.used); }
function dailyMarkUsed(key) { const r = dailyRec(); if (!r || r.key !== key || !r.used) dailySave({ key, used: true, best: null, at: Date.now() }); }
function dailySetBest(key, lap) { const r = dailyRec() || { key, used: true }; if (r.key !== key) return; r.best = lap || null; r.done = true; dailySave(r); }
function ghostId() { return race && race.daily ? 'daily-' + race.daily.key : S.INFO.id; }
// old days' ghosts are dead weight in localStorage: keep today's only
(() => { try { const keep = 'ktb-ghost-daily-' + dailyKey(); for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('ktb-ghost-daily-') && k !== keep) localStorage.removeItem(k); } } catch (e) {} })();

// time of day: a look only (sky, sun, fog, light); 'day' is exactly the normal game's lighting
const LOOK = {
  day: { sun: [0.52, 0.62, 0.36], zen: 0x1d4f9c, hor: 0xa9c6df, gnd: 0x6f7468, clouds: 0.75, fog: 0xa9c6df, fogN: 320, fogF: 2300, hs: 0xd9e8ff, hg: 0x4f5a3a, hi: 1.05, sc: 0xfff1dc, si: 3.0, exp: 1.0 },
  golden: { sun: [0.78, 0.2, 0.42], zen: 0x2b4f86, hor: 0xf2b886, gnd: 0x5d5446, clouds: 0.55, fog: 0xd9a888, fogN: 300, fogF: 2100, hs: 0xffdcb8, hg: 0x4a4031, hi: 0.85, sc: 0xffc27f, si: 2.7, exp: 1.02 },
  overcast: { sun: [0.3, 0.8, 0.5], zen: 0x5d6874, hor: 0xb4bcc5, gnd: 0x5f645c, clouds: 1.15, fog: 0xadb5be, fogN: 240, fogF: 1800, hs: 0xe1e7ee, hg: 0x4d5546, hi: 1.45, sc: 0xe6ebf2, si: 1.15, exp: 1.04 },
};
let lookNow = 'day';
function applyLook(name) {
  const L0 = LOOK[name] || LOOK.day; if (name === lookNow || !LOOK[name]) return; lookNow = name;
  SUN_DIR.set(L0.sun[0], L0.sun[1], L0.sun[2]).normalize();
  const u = sky.uniforms; u.uSun.value.copy(SUN_DIR); u.uZen.value.set(L0.zen); u.uHor.value.set(L0.hor); u.uGround.value.set(L0.gnd); u.uCloudAmt.value = L0.clouds;
  scene.fog.color.set(L0.fog); scene.fog.near = L0.fogN; scene.fog.far = L0.fogF;
  hemi.color.set(L0.hs); hemi.groundColor.set(L0.hg); hemi.intensity = L0.hi;
  sun.color.set(L0.sc); sun.intensity = L0.si; renderer.toneMappingExposure = L0.exp;
  try { const rt = makeEnvironment(renderer, sky, {}); if (envRT) envRT.dispose(); envRT = rt; scene.environment = rt.texture; } catch (e) {}
}

// title-screen card: today's challenge, whether the counted run is used, and the countdown to the next one
function renderDailyCard() {
  const key = dailyKey(), sp = D.dailySpec(key), r = dailyRec(), today = key === D.nyDateKey();
  const used = r && r.key === key && r.used;
  $('dDate').textContent = sp.label.replace(/^(\w{3})\w*, /, '$1 · ').toUpperCase();
  $('dTitle').textContent = sp.title;
  $('dSetup').textContent = sp.setup;
  $('dCond').textContent = sp.conds;
  const next = 'New challenge in ' + D.fmtCountdown(D.msToNext());
  $('dSub').textContent = !today ? 'Preview of another day · practice only' : used ? ((r.best ? 'Your counted lap ' + fmt(r.best) : r.done ? 'Counted run done' : 'Counted run used') + ' · replays are practice · ' + next) : 'One counted run · ' + next;
  $('btnDaily').classList.toggle('done', !!used || !today);
  $('btnDaily').setAttribute('aria-label', 'Daily Challenge, ' + sp.label + '. ' + sp.desc);
}
setInterval(() => { if (state === 'title') renderDailyCard(); }, 20000);
function startDaily() {
  initAudio(); if (actx && actx.state === 'suspended') actx.resume();
  daily = { spec: D.dailySpec(dailyKey()), official: false };
  show('title', false); startRace();
}
$('btnDaily').addEventListener('click', startDaily);
$('btnDailyBoard').addEventListener('click', (e) => { e.stopPropagation(); lbBoards(); if (window.GDGBoard) window.GDGBoard.show('daily-' + dailyKey()); });

function showDailyFinish(p) {
  const d = race.daily, sp = daily && daily.spec && daily.spec.key === d.key ? daily.spec : D.dailySpec(d.key), I = S.INFO;
  const lap = p.bestLap || 0;
  if (d.official) dailySetBest(d.key, lap);
  $('fHead').textContent = (d.official ? 'DAILY CHALLENGE · ' : 'DAILY PRACTICE · ') + sp.label.replace(/^\w+, /, '').toUpperCase();
  $('fPos').textContent = lap ? fmt(lap) : '--'; $('fPos').classList.add('time');
  const mph = lap ? ' (' + (Math.round(I.lenMi * 3600 / lap * 10) / 10) + ' mph)' : '';
  const r = dailyRec(), counted = r && r.key === d.key && r.best;
  $('fSub').innerHTML = (lap ? 'Best lap' + mph : 'No timed lap') + (race.tt ? '' : ' · finished P' + p.finishPos + ' of ' + race.cars.length) +
    '<br>' + (d.official ? (lap ? '<b class="pb">Counted for today\'s board</b>' : 'Counted run used') : 'Practice · doesn\'t post' + (counted ? ' · your counted lap ' + fmt(r.best) : '')) +
    '<br><span class="dsmall">' + sp.trackName + ' · ' + sp.conds + '</span>' + suFinishLine();
  $('fTable').innerHTML = lapTimes.map((t, i) => `<li class="${t === p.bestLap ? 'me' : ''}"><span class="p">${i + 1}</span><span class="sw" style="background:${t === p.bestLap ? '#f2c230' : '#5c6470'}"></span><span class="n">Lap ${i + 1}</span><span>${fmt(t)}</span></li>`).join('');
  $('btnKiss').classList.add('hidden'); $('finish').classList.remove('side');
  $('btnAgain').textContent = 'Practice';
  lbBoards();
  // counted run: a top-10 lap gets the initials entry; a lap that doesn't make it still shows today's top 10
  if (window.GDGBoard && d.official && lap) { const b = 'daily-' + d.key; setTimeout(() => { if (!finishShown || $('finish').classList.contains('hidden')) return;
    let asked = false; const watch = setInterval(() => { if (window.GDGBoard.isOpen()) asked = true; }, 200);
    window.GDGBoard.afterRound(b, lap).then((ok) => { clearInterval(watch); if (!ok && !asked && finishShown && !$('finish').classList.contains('hidden') && !window.GDGBoard.isOpen()) window.GDGBoard.show(b); }); }, 1300); }
  else if (window.GDGBoard) { const b = 'daily-' + d.key; setTimeout(() => { if (finishShown && !$('finish').classList.contains('hidden') && !window.GDGBoard.isOpen()) window.GDGBoard.show(b); }, 1600); }
  buzz('finish'); playTheme(true); theme.volume = 0.45;
  show('finish', true); hudEl.classList.add('hidden');
}
// HUD wind arrow (daily only): which way the wind blows relative to your car right now, and how hard
const windEl = $('hWind'), WIN = {};
function updateWindHUD() {
  if (!race || !race.daily || !S.COND || !S.COND.mph) { windEl.classList.remove('on'); return; }
  const p = race.player; S.windAt(p.dist, race.t, WIN);
  const mph = Math.hypot(WIN.along, WIN.across) * S.MPH, ang = Math.atan2(WIN.across, WIN.along) * 180 / Math.PI;
  windEl.classList.add('on');
  windEl.querySelector('i').style.transform = 'rotate(' + ang.toFixed(0) + 'deg)';
  windEl.querySelector('b').textContent = Math.round(mph);
  windEl.querySelector('em').textContent = Math.abs(ang) < 50 ? 'TAIL' : Math.abs(ang) > 130 ? 'HEAD' : 'CROSS';
}
renderDailyCard();

function toTitle() {
  state = 'title'; show('title', true); renderDailyCard(); $('btnAgain').textContent = 'Race again'; document.body.classList.remove('isdaily'); hudEl.classList.add('hidden'); playTheme(true); engineSound(0, false, 0);
  race = null; kissMesh.visible = false; stopConfetti(); clearSkids(); coachEl.classList.remove('on'); flagbar.classList.remove('on'); flagObj.visible = false; if (skidA) skidA.g.gain.value = 0;
}
function togglePause(force) {
  if (state !== 'race' && state !== 'paused') return;
  const p = force === undefined ? state === 'race' : force;
  if (p && state === 'race') { state = 'paused'; show('pause', true); engineSound(0, false, 0); }
  else if (!p && state === 'paused') { state = 'race'; show('pause', false); show('settings', false); show('setup', false); if (actx) actx.resume(); }
}
function startRace() {
  const dly = daily, sp = dly && dly.spec;
  if (dly) dly.official = dailyCanCount(sp.key);  // the first run of the day counts; every run after it is practice
  applyTrack(sp ? sp.track : cfg.track, !!sp);
  applyLook(sp ? sp.look : 'day');
  const tt = sp ? sp.mode === 'tt' : cfg.mode === 'tt';
  race = sp
    ? S.createRace({ track: sp.track, laps: sp.laps, field: tt ? 2 : sp.field, grid: tt ? 1 : sp.grid, difficulty: sp.difficulty, assist: cfg.assist, autoThrottle: cfg.throttle === 'auto', seed: +sp.key, cond: sp.cond, setup: setupOf(sp.track) / 10 })
    : S.createRace({ track: cfg.track, laps: cfg.laps, field: tt ? 2 : cfg.field, grid: tt ? 1 : Math.min(cfg.grid, cfg.field), difficulty: cfg.difficulty, assist: cfg.assist, autoThrottle: cfg.throttle === 'auto', seed: (Math.random() * 1e9) | 0, setup: setupOf(cfg.track) / 10 });
  race.setupN = setupOf(S.TRACK_ID);
  race.daily = dly ? { key: sp.key, official: dly.official } : null;
  document.body.classList.toggle('isdaily', !!dly);
  // time trial: just you, the pace car to the green, and your ghost
  if (tt) { race.cars = [race.player]; race.tt = true; }
  race.autopilot = Q.has('autopilot');
  document.body.classList.toggle('tt', tt);
  resetGhost();
  window.KTB.race = race;
  state = 'race'; finishShown = false; kissed = false; winCam = 0; kissMesh.visible = false; stopConfetti();
  show('title', false); show('tracks', false); show('finish', false); show('pause', false); hudEl.classList.remove('hidden');
  $('hField').textContent = '/' + race.cars.length; $('hLaps').textContent = '/' + race.opts.laps;
  tiltNeutral = null; input.steer = 0; input.rawSteer = 0;
  theme.volume = 0.3;
  banner.classList.remove('on'); msgT = 0;
  resetCoach(); clearSkids(); flagPhase = ''; flagState = ''; setFlag('yellow'); placeFlag(); spinCam = 0;
  const how = cfg.steer === 'tilt' ? 'Tilt the phone to steer.' : (matchMedia('(pointer:fine)').matches && !('ontouchstart' in window) ? 'Arrow keys to steer, ↓ to lift.' : 'Drag a thumb left/right anywhere to steer.');
  const road = S.INFO.kind === 'road';
  hint.textContent = road ? how + ' ' + (cfg.throttle === 'auto' ? 'Gas is automatic. Hold BRAKE before the corners; it glows when you need it.' : 'Hold GAS to go, BRAKE before the corners.')
    : how + (tt ? ' ' : ' Tuck in behind a car to draft, pull out to pass. ') + (cfg.throttle === 'auto' ? 'Gas is automatic; hold LIFT to slow.' : 'Hold GAS to go.');
  if (tt) hint.textContent = 'TIME TRIAL · ' + (ghost && cfg.ghost ? 'Beat your ghost: ' + fmt(ghost.t) + '. ' : 'Set a lap and your ghost races you on the next one. ') + hint.textContent;
  if (sp) hint.textContent = (race.daily.official ? 'DAILY CHALLENGE · your counted run. Best lap goes on today\'s board. ' : 'DAILY PRACTICE · doesn\'t post. ') + sp.windWords.charAt(0).toUpperCase() + sp.windWords.slice(1) + ', ' + sp.gripWords + '. ' + how;
  hint.classList.add('on');
  for (let i = 0; i < MAXC; i++) { bodyMesh.setColorAt(i, new THREE.Color(0x000000)); accMesh.setColorAt(i, new THREE.Color(0x000000)); }
  race.cars.forEach((c, i) => { bodyMesh.setColorAt(i, new THREE.Color(c.color)); accMesh.setColorAt(i, new THREE.Color(c.accent)); });
  bodyMesh.instanceColor.needsUpdate = accMesh.instanceColor.needsUpdate = true;
  setCarCount(race.cars.length); shMesh.count = race.cars.length + 1;
}

// ---------------- minimap ----------------
const map = $('map'), mctx = map.getContext('2d');
const mapBg = document.createElement('canvas'); mapBg.width = 160; mapBg.height = 80;
let mapK = 1, mapC = [0, 0];
const mapXY = (x, z) => [80 + (x - mapC[0]) * mapK, 40 + (z - mapC[1]) * mapK];
function drawMapBg() {
  const T = S.TRACK; mapK = Math.min(144 / T.size[0], 66 / T.size[1]); mapC = T.center;
  const g = mapBg.getContext('2d'); g.clearRect(0, 0, 160, 80); g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 5; g.lineJoin = 'round'; g.beginPath();
  sList(0, S.L, 10).forEach((s, i) => { S.surface(s, 0, P); const [x, y] = mapXY(P.x, P.z); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke();
  S.surface(S.S_LINE, 0, P); const [bx, by] = mapXY(P.x, P.z); g.save(); g.translate(bx, by); g.rotate(Math.atan2(P.tz, P.tx)); g.fillStyle = S.INFO.bricks ? '#c0573a' : '#ffffff'; g.fillRect(-1.5, -6, 3, 12); g.restore();
}
function drawMap() {
  mctx.clearRect(0, 0, 160, 80); mctx.drawImage(mapBg, 0, 0);
  if (ghostOn) { S.surface(ghostBase + gpose.s, gpose.d, P); const [x, y] = mapXY(P.x, P.z); mctx.fillStyle = 'rgba(150,220,255,0.95)'; mctx.beginPath(); mctx.arc(x, y, 3.2, 0, 6.3); mctx.fill(); }
  for (const c of race.cars) { S.surface(c.dist, c.d, P); const [x, y] = mapXY(P.x, P.z); mctx.fillStyle = c.isPlayer ? '#f2c230' : '#' + c.color.toString(16).padStart(6, '0'); mctx.beginPath(); mctx.arc(x, y, c.isPlayer ? 4 : 2.2, 0, 6.3); mctx.fill(); if (c.isPlayer) { mctx.strokeStyle = '#000'; mctx.lineWidth = 1; mctx.stroke(); } }
}

// ---------------- confetti (win) ----------------
const fx = $('fx'), fctx = fx.getContext('2d'); let conf = [], confOn = false;
function burst(n) { const w = fx.width, h = fx.height; const cols = ['#f2c230', '#c0573a', '#ffffff', '#d71920', '#1e63c6', '#111']; for (let i = 0; i < n; i++) conf.push({ x: Math.random() * w, y: -20 - Math.random() * h * 0.5, vx: (Math.random() - 0.5) * 60, vy: 80 + Math.random() * 160, r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 8, s: 6 + Math.random() * 8, c: cols[(Math.random() * cols.length) | 0] }); confOn = true; }
function stopConfetti() { conf = []; confOn = false; fxp = []; fctx.clearRect(0, 0, fx.width, fx.height); }

// ---------------- six-shooters (Texas victory lane) ----------------
let fxp = [], guns = [], shotN = 0;
const rnd = (a, b) => a + Math.random() * (b - a);
function bangSound() {
  if (!actx || !cfg.sound) return;
  try {
    const t = actx.currentTime, len = Math.floor(actx.sampleRate * 0.5), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = actx.createBufferSource(); src.buffer = buf;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(7000, t); lp.frequency.exponentialRampToValueAtTime(400, t + 0.35);
    const g = actx.createGain(); g.gain.setValueAtTime(1.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    src.connect(lp); lp.connect(g); g.connect(actx.destination); src.start(t);
    const o = actx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    const og = actx.createGain(); og.gain.setValueAtTime(1.2, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(og); og.connect(actx.destination); o.start(t); o.stop(t + 0.3);
  } catch (e) {}
}
function restartAnim(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function shot(side) {
  const k = fx.width / window.innerWidth, w = fx.width, h = fx.height;
  const gun = guns[side < 0 ? 0 : 1]; gun.kick = 1;
  const x = gun.x + Math.sin(gun.a) * 95 * k, y = gun.y - Math.cos(gun.a) * 95 * k; // muzzle
  fxp.push({ t: 'flash', x, y, age: 0, life: 0.2, r: rnd(95, 125) * k, rot: Math.random() * 6.3 });
  for (let i = 0; i < 7; i++) fxp.push({ t: 'smoke', x: x + rnd(-14, 14) * k, y: y + rnd(-10, 10) * k, vx: rnd(-30, 30) * k + side * 12 * k, vy: rnd(-95, -40) * k, age: 0, life: rnd(1.4, 2.2), r0: rnd(14, 24) * k, r1: rnd(60, 95) * k, g: (rnd(170, 225)) | 0 });
  for (let i = 0; i < 16; i++) { const a = gun.a + rnd(-0.7, 0.7), v = rnd(320, 760) * k; fxp.push({ t: 'spark', x, y, vx: Math.sin(a) * v, vy: -Math.cos(a) * v, age: 0, life: rnd(0.25, 0.5) }); }
  fxp.push({ t: 'bang', x: Math.min(w - 90 * k, Math.max(90 * k, x)), y: y - 70 * k, age: 0, life: 0.75, rot: rnd(-0.25, 0.25) });
  restartAnim($('bangFlash'), 'on'); restartAnim(document.documentElement, 'shake');
  shake = 0.6; bangSound(); if (navigator.vibrate) navigator.vibrate(35);
}
function fireSixShooters() {
  const k = fx.width / window.innerWidth, w = fx.width, h = fx.height, portrait = h > w;
  const gy = h * (portrait ? 0.34 : 0.42);
  guns = [{ x: w * 0.2, y: gy, a: 0.32, kick: 0 }, { x: w * 0.8, y: gy, a: -0.32, kick: 0 }];
  guns.forEach((g) => { g.age = 0; g.life = 3.4; });
  for (let i = 0; i < 6; i++) setTimeout(() => shot(i % 2 ? 1 : -1), 60 + i * 230);
  setTimeout(() => burst(220), 700);
  confOn = true; shotN++; window.KTB.shots = (window.KTB.shots || 0) + 6;
}
function drawGun(g, k) {
  const a = Math.min(1, g.age * 6, (g.life - g.age) * 3); if (a <= 0) return;
  fctx.save(); fctx.globalAlpha = a; fctx.translate(g.x, g.y + g.kick * 14 * k); fctx.rotate(g.a - g.kick * 0.35 * Math.sign(g.a || 1)); fctx.scale(1.35 * k * (g.a < 0 ? -1 : 1), 1.35 * k);
  fctx.lineJoin = 'round'; fctx.strokeStyle = '#000'; fctx.lineWidth = 3;
  // barrel (pointing up), cylinder, frame, grip
  fctx.fillStyle = '#9aa3ad'; fctx.beginPath(); fctx.rect(-6, -70, 12, 52); fctx.fill(); fctx.stroke();
  fctx.fillStyle = '#6d757e'; fctx.beginPath(); fctx.rect(-14, -22, 28, 26); fctx.fill(); fctx.stroke();
  fctx.fillStyle = '#7d8790'; fctx.beginPath(); fctx.moveTo(-10, 4); fctx.lineTo(12, 4); fctx.lineTo(16, 16); fctx.lineTo(-8, 16); fctx.closePath(); fctx.fill(); fctx.stroke();
  fctx.fillStyle = '#8a4b1f'; fctx.beginPath(); fctx.moveTo(-8, 14); fctx.lineTo(16, 14); fctx.quadraticCurveTo(30, 40, 34, 64); fctx.lineTo(12, 66); fctx.quadraticCurveTo(6, 40, -8, 14); fctx.closePath(); fctx.fill(); fctx.stroke();
  fctx.beginPath(); fctx.arc(-14, 18, 9, 0.3, 2.6); fctx.stroke(); // trigger guard
  fctx.restore();
}
function drawFx(dt, k) {
  for (const g of guns) { g.age += dt; g.kick = Math.max(0, g.kick - dt * 7); drawGun(g, k); }
  guns = guns.filter((g) => g.age < g.life);
  for (const p of fxp) {
    p.age += dt; const u = p.age / p.life; if (u >= 1) continue;
    if (p.t === 'smoke') {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy *= 0.985; const r = p.r0 + (p.r1 - p.r0) * Math.sqrt(u);
      fctx.globalAlpha = 0.55 * (1 - u); fctx.fillStyle = `rgb(${p.g},${p.g},${p.g})`; fctx.beginPath(); fctx.arc(p.x, p.y, r, 0, 6.3); fctx.fill();
    } else if (p.t === 'spark') {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900 * k * dt;
      fctx.globalAlpha = 1 - u; fctx.strokeStyle = '#ffd34d'; fctx.lineWidth = 3 * k; fctx.beginPath(); fctx.moveTo(p.x, p.y); fctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); fctx.stroke();
    } else if (p.t === 'flash') {
      const r = p.r * (0.6 + 0.6 * u); fctx.globalAlpha = 1 - u * u;
      const gr = fctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, '#fff3a0'); gr.addColorStop(0.55, 'rgba(255,150,20,0.9)'); gr.addColorStop(1, 'rgba(255,80,0,0)');
      fctx.fillStyle = gr; fctx.beginPath();
      for (let i = 0; i < 20; i++) { const a = p.rot + i * Math.PI / 10, rr = i % 2 ? r * 0.45 : r * 1.25; i ? fctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr) : fctx.moveTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr); }
      fctx.closePath(); fctx.fill();
    } else if (p.t === 'bang') {
      const s = (0.6 + 0.7 * Math.min(1, u * 5)) * k; fctx.globalAlpha = u < 0.7 ? 1 : (1 - u) / 0.3;
      fctx.save(); fctx.translate(p.x, p.y - u * 30 * k); fctx.rotate(p.rot); fctx.scale(s, s);
      fctx.font = '900 46px system-ui, -apple-system, sans-serif'; fctx.textAlign = 'center'; fctx.textBaseline = 'middle';
      fctx.lineWidth = 8; fctx.strokeStyle = '#3a1500'; fctx.strokeText('BANG!', 0, 0); fctx.fillStyle = '#ffcf33'; fctx.fillText('BANG!', 0, 0); fctx.restore();
    }
  }
  fctx.globalAlpha = 1; fxp = fxp.filter((p) => p.age < p.life);
}
function drawConfetti(dt) {
  if (!confOn && !fxp.length && !guns.length) return; fctx.clearRect(0, 0, fx.width, fx.height); const k = fx.width / window.innerWidth;
  drawFx(dt, k);
  for (const p of conf) { p.x += p.vx * dt * k; p.y += p.vy * dt * k; p.r += p.vr * dt; fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.r); fctx.fillStyle = p.c; fctx.fillRect(-p.s * k / 2, -p.s * k / 4, p.s * k, p.s * k / 2); fctx.restore(); }
  conf = conf.filter((p) => p.y < fx.height + 30); if (!conf.length && !fxp.length && !guns.length) { confOn = false; fctx.clearRect(0, 0, fx.width, fx.height); }
}


// ---------------- tyre smoke, skid marks, skid sound (spins and slides) ----------------
const SMK = 260;
const smkPos = new Float32Array(SMK * 3), smkVel = new Float32Array(SMK * 3), smkAge = new Float32Array(SMK).fill(99), smkLife = new Float32Array(SMK).fill(1);
const smkSize = new Float32Array(SMK), smkAlpha = new Float32Array(SMK), smkR0 = new Float32Array(SMK), smkR1 = new Float32Array(SMK), smkA0 = new Float32Array(SMK);
const smkGeo = new THREE.BufferGeometry();
smkGeo.setAttribute('position', new THREE.BufferAttribute(smkPos, 3)); smkGeo.setAttribute('aSize', new THREE.BufferAttribute(smkSize, 1)); smkGeo.setAttribute('aAlpha', new THREE.BufferAttribute(smkAlpha, 1));
const smkMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 800 } }, transparent: true, depthWrite: false,
  vertexShader: 'attribute float aSize; attribute float aAlpha; uniform float uScale; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(aSize * uScale / max(0.5, -mv.z), 0.0, 480.0); vA = aAlpha; }',
  fragmentShader: 'varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; float a = vA * smoothstep(0.5, 0.05, r); gl_FragColor = vec4(0.88, 0.88, 0.9, a); }',
});
const smoke = new THREE.Points(smkGeo, smkMat); smoke.frustumCulled = false; smoke.renderOrder = 3; scene.add(smoke);
let smkI = 0, smkAcc = 0;
function puff(x, y, z, vx, vy, vz, k) {
  const i = smkI++ % SMK;
  smkPos[i * 3] = x; smkPos[i * 3 + 1] = y; smkPos[i * 3 + 2] = z;
  smkVel[i * 3] = vx; smkVel[i * 3 + 1] = vy; smkVel[i * 3 + 2] = vz;
  smkAge[i] = 0; smkLife[i] = 1.3 + Math.random() * 0.9; smkR0[i] = 0.9 + Math.random() * 0.5; smkR1[i] = 3.6 + Math.random() * 2.2; smkA0[i] = 0.22 + 0.33 * k;
}
const MARKS = 500;
const markMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), MARKS);
markMesh.frustumCulled = false; markMesh.count = 0; markMesh.renderOrder = 1; scene.add(markMesh);
let markI = 0; const lastWheel = [null, null];
const mA = new THREE.Vector3(), mB = new THREE.Vector3(), mX = new THREE.Vector3(), mZ = new THREE.Vector3();
function skidMark(w, pos, up, k) {
  const last = lastWheel[w];
  if (!last) { lastWheel[w] = pos.clone(); return; }
  const len = last.distanceTo(pos);
  if (len < 0.7) return;
  if (len < 8) {
    mZ.copy(pos).sub(last).normalize(); mX.crossVectors(up, mZ).normalize();
    M4.makeBasis(mX, up, mZ); M4.scale(vT.set(0.34, 1, len + 0.05));
    M4.setPosition((pos.x + last.x) / 2 + up.x * 0.03, (pos.y + last.y) / 2 + up.y * 0.03, (pos.z + last.z) / 2 + up.z * 0.03);
    markMesh.setMatrixAt(markI % MARKS, M4); markI++; markMesh.count = Math.min(MARKS, markI); markMesh.instanceMatrix.needsUpdate = true;
  }
  last.copy(pos);
}
// tyre smoke on contact: a wall hit or a bump / rub with another car
function wallSmoke(e) {
  const p = race.player; carFrame(p.dist, p.d + (e.inside ? -0.9 : 0.9), 0, tmpF);
  const n = 4 + Math.min(10, Math.round(e.impact * 2)), k = clamp(0.35 + e.impact * 0.15, 0.35, 1);
  for (let i = 0; i < n; i++) puff(tmpF.pos.x + (Math.random() - 0.5) * 1.2, tmpF.pos.y + 0.3, tmpF.pos.z + (Math.random() - 0.5) * 1.2, tmpF.fwd.x * p.v * 0.3 + (Math.random() - 0.5) * 3, 0.8 + Math.random() * 1.5, tmpF.fwd.z * p.v * 0.3 + (Math.random() - 0.5) * 3, k);
}
let rubT = 0;
function contactSmoke(bump) {
  const now = performance.now(); if (!bump && now - rubT < 140) return; rubT = now;
  const p = race.player; carFrame(p.dist, p.d, p.psi, tmpF);
  for (let i = 0; i < (bump ? 5 : 2); i++) { const w = Math.random() < 0.5 ? 1 : -1; mB.copy(tmpF.pos).addScaledVector(tmpF.fwd, bump ? -1.6 : (Math.random() - 0.5) * 3).addScaledVector(tmpF.right, 0.85 * w).addScaledVector(tmpF.up, 0.3);
    puff(mB.x, mB.y, mB.z, tmpF.fwd.x * p.v * 0.35 + (Math.random() - 0.5) * 2, 0.6 + Math.random(), tmpF.fwd.z * p.v * 0.35 + (Math.random() - 0.5) * 2, bump ? 0.55 : 0.3); }
}
function clearSkids() { markI = 0; markMesh.count = 0; lastWheel[0] = lastWheel[1] = null; smkAge.fill(99); smkAlpha.fill(0); }
const wheelF = { pos: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
function updateSkids(dt) {
  const p = race && race.player; const k = p && state === 'race' ? (p.skid || 0) : 0;
  if (p && k > 0.12) {
    carFrame(p.dist, p.d, p.psi + (p.yaw || 0), wheelF);
    const tf = { x: 0, z: 0 }; carFrame(p.dist, p.d, p.psi, tmpF); // direction of travel, for the smoke's drift
    for (let w = 0; w < 2; w++) {
      mA.copy(wheelF.pos).addScaledVector(wheelF.fwd, -1.65).addScaledVector(wheelF.right, w ? 0.82 : -0.82);
      skidMark(w, mA, wheelF.up, k);
    }
    smkAcc += dt * (12 + 46 * k);
    while (smkAcc > 1) {
      smkAcc -= 1; const w = Math.random() < 0.5 ? 1 : -1;
      mB.copy(wheelF.pos).addScaledVector(wheelF.fwd, -1.65).addScaledVector(wheelF.right, 0.82 * w).addScaledVector(wheelF.up, 0.35);
      const carry = 0.18;
      puff(mB.x, mB.y, mB.z, tmpF.fwd.x * p.v * carry + (Math.random() - 0.5) * 2.4, 0.9 + Math.random() * 1.3, tmpF.fwd.z * p.v * carry + (Math.random() - 0.5) * 2.4, k);
    }
  } else { lastWheel[0] = lastWheel[1] = null; }
  let any = false;
  for (let i = 0; i < SMK; i++) {
    if (smkAge[i] >= smkLife[i]) { smkAlpha[i] = 0; continue; }
    any = true; smkAge[i] += dt; const x = Math.min(1, smkAge[i] / smkLife[i]);
    const drag = Math.exp(-dt * 1.6); smkVel[i * 3] *= drag; smkVel[i * 3 + 2] *= drag; smkVel[i * 3 + 1] *= Math.exp(-dt * 0.8);
    smkPos[i * 3] += smkVel[i * 3] * dt; smkPos[i * 3 + 1] += smkVel[i * 3 + 1] * dt; smkPos[i * 3 + 2] += smkVel[i * 3 + 2] * dt;
    smkSize[i] = smkR0[i] + (smkR1[i] - smkR0[i]) * Math.sqrt(x);
    smkAlpha[i] = smkA0[i] * Math.min(1, x * 8) * (1 - x) * (1 - x);
  }
  smoke.visible = any;
  if (any) { smkGeo.attributes.position.needsUpdate = true; smkGeo.attributes.aSize.needsUpdate = true; smkGeo.attributes.aAlpha.needsUpdate = true; smkMat.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)); }
  skidSound(k);
}
let skidA = null;
function skidSound(k) {
  if (!actx || !cfg.sound) return;
  if (!skidA) {
    try {
      const buf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 2.2;
      const g = actx.createGain(); g.gain.value = 0; src.connect(bp); bp.connect(g); g.connect(actx.destination); src.start();
      skidA = { g, bp };
    } catch (e) { skidA = false; }
  }
  if (!skidA) return;
  const t = actx.currentTime, on = state === 'race' && k > 0.15;
  skidA.g.gain.setTargetAtTime(on ? 0.05 + 0.13 * k : 0, t, on ? 0.04 : 0.12);
  skidA.bp.frequency.setTargetAtTime(1050 + 700 * k + Math.sin(t * 23) * 120, t, 0.05);
}

// ---------------- starter's flag (yellow before the start, green at the drop, white, checkered) ----------------
const flagGeo = new THREE.PlaneGeometry(4.4, 2.9, 12, 5); flagGeo.translate(2.2 + 0.15, 0, 0);
const flagBase = flagGeo.attributes.position.array.slice();
const flagMat = new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide });
const flagCheck = canvasTex(64, 64, (g2, w, h) => { for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g2.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f0'; g2.fillRect(x * 16, y * 16, 16, 16); } }, false);
const flagArm = new THREE.Group(), flagObj = new THREE.Group();
const flagMesh = new THREE.Mesh(flagGeo, flagMat); flagArm.add(flagMesh);
const stick = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.0, 0.12).translate(0, -0.6, 0), lam({ color: 0x8a6a3a })); flagArm.add(stick);
flagObj.add(flagArm); scene.add(flagObj); flagObj.visible = false;
let flagState = 'yellow';
function placeFlag() {
  if (!standAt) { flagObj.visible = false; return; }
  const inX = standAt.tz, inZ = -standAt.tx;  // toward the track (the stand is on the outside)
  const m = new THREE.Matrix4(); const xA = new THREE.Vector3(inX, 0, inZ), yA = new THREE.Vector3(0, 1, 0), zA = new THREE.Vector3(standAt.tx, 0, standAt.tz);
  m.makeBasis(xA, yA, zA); m.setPosition(standAt.x + inX * 1.0, standAt.y + 7.4, standAt.z + inZ * 1.0);
  flagObj.matrixAutoUpdate = false; flagObj.matrix.copy(m); flagObj.visible = true;
}
function setFlag(kind) {
  if (flagState === kind) return; flagState = kind;
  flagMat.map = kind === 'checker' ? flagCheck : null;
  flagMat.color.set(kind === 'yellow' ? 0xffd400 : kind === 'green' ? 0x1fd14a : 0xffffff); flagMat.needsUpdate = true;
}
function updateFlag(t) {
  if (!flagObj.visible) return;
  // the starter waves it: a big swing plus a ripple running out along the cloth
  flagArm.rotation.z = 0.35 + Math.sin(t * 5.2) * 0.45; flagArm.rotation.x = Math.sin(t * 5.2 + 1.1) * 0.25;
  const a = flagGeo.attributes.position.array;
  for (let i = 0; i < a.length; i += 3) { const x = flagBase[i]; a[i + 2] = flagBase[i + 2] + Math.sin(x * 1.7 - t * 11) * 0.28 * (x / 4.5); }
  flagGeo.attributes.position.needsUpdate = true;
}


// ---------------- coach (short, timely callouts beside the spotter) ----------------
// Priority (high wins, and may cut in after half a second): brake 100 > lift/wall 95 > spin 90 > slide 85 > laps 70 >
// draft 60 > line 45 > turn in / apex / track out 40 > encouragement 25. Every line has its own cooldown, there is a
// short gap between lines, and nothing below "laps" talks over a banner (GREEN, LAP, WHITE FLAG).
const coachEl = $('coach'), coachTxt = $('coachTxt');
let coach = null, corners = [];
function resetCoach() {
  coach = { t: 0, cur: null, until: 0, lastEnd: -9, cool: {}, lastPos: 0, posT: 0, slid: 0, calmT: 0, trouble: {}, lapOf: {}, done: {}, highT: 0, paceSaid: 0 };
  coachEl.classList.remove('on', 'urgent');
  buildCorners();
}
function buildCorners() {
  const T = S.TRACK, n = T.n, ds = T.DS, road = S.INFO.kind === 'road'; corners = [];
  if (!road) return;
  const thr = 1 / 230; let i0 = -1;
  // start the scan on a straight so no corner is split by the lap's wrap
  let start = 0; for (let i = 0; i < n; i++) if (Math.abs(T.K[i]) < thr / 3) { start = i; break; }
  const raw = [];
  for (let j = 0; j <= n; j++) {
    const i = (start + j) % n, on = Math.abs(T.K[i]) > thr && j < n;
    if (on && i0 < 0) i0 = j;
    if (!on && i0 >= 0) { raw.push([i0, j - 1]); i0 = -1; }
  }
  for (const [a, b] of raw) {
    if ((b - a) * ds < 12) continue;
    let ap = a, km = 0, vmin = 1e9; for (let j = a; j <= b; j++) { const i = (start + j) % n; if (Math.abs(T.K[i]) > km) { km = Math.abs(T.K[i]); ap = j; } vmin = Math.min(vmin, T.VPP[i]); }
    const ia = (start + a) % n, iap = (start + ap) % n, ib = (start + b) % n;
    const vBefore = T.VPP[(ia - Math.round(160 / ds) + n) % n];
    corners.push({ entry: ia * ds, apex: iap * ds, exit: ib * ds, sign: Math.sign(T.K[iap]), vmin, big: vmin < 38, brake: vBefore - vmin > 8, id: corners.length });
  }
}
const relS = (a, b) => { let r = S.wrap(a - b); if (r > L / 2) r -= L; return r; }; // a relative to b, -L/2..L/2
function coachSay(key, text, pri, dur = 1.5, cool = 5) {
  if (!cfg.coach || !coach) return false;
  const now = coach.t;
  if ((coach.cool[key] || -99) > now) return false;
  if (pri < 70 && msgT > 0.15) return false;
  if (coach.cur) { if (pri <= coach.cur.pri || now - coach.cur.t0 < 0.5) return false; }
  else if (now - coach.lastEnd < (pri >= 90 ? 0 : 0.7)) return false;
  coach.cur = { key, pri, t0: now }; coach.until = now + dur; coach.cool[key] = now + cool;
  coachTxt.textContent = text; coachEl.classList.toggle('urgent', pri >= 90);
  restartAnim(coachEl, 'pop'); coachEl.classList.add('on');
  if (cfg.coachVoice && window.speechSynthesis) { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/[!.…]+$/, '')); u.rate = 1.2; u.pitch = 0.9; speechSynthesis.speak(u); } catch (e) {} }
  window.KTB.coachLog.push({ t: +now.toFixed(2), key, text, pri });
  return true;
}
function coachEvent(e) {
  if (!coach) return;
  const p = race.player;
  if (e.type === 'spin') {
    const c = cornerAt(S.wrap(p.dist), 60); if (c) coach.trouble[c.id] = 2;
    coach.cur = null; coachSay('spin', 'Hold on… let it stop rotating', 92, 1.8, 3);
  } else if (e.type === 'spinEnd') { coach.cur = null; coachSay('spinEnd', 'Gather it up. Smooth on the throttle', 91, 2.0, 3); coach.slid = 0; }
  else if (e.type === 'lap') {
    const left = race.opts.laps - e.lap;
    if (left === 1) coachSay('lap', 'Last lap! Bring it home', 75, 2.0, 3);
    else if (left > 1) coachSay('lap', 'Lap ' + (e.lap + 1) + ' of ' + race.opts.laps, 70, 1.6, 3);
  } else if (e.type === 'wall') coachSay('wall', S.INFO.kind === 'road' ? 'Stay off the tyres. Brake a touch earlier' : 'Easy, off the wall. Give it room', 60, 1.6, 8);
}
function cornerAt(s, back = 0) { for (const c of corners) { const a = relS(s, c.entry), len = relS(c.exit, c.entry); if (a > -back && a < len + 20) return c; } return null; }
function nextCorner(s) { let best = null, bd = 1e9; for (const c of corners) { const d = S.wrap(c.entry - s); if (d < bd) { bd = d; best = c; } } return [best, bd]; }
function coachTick(dt) {
  if (!coach || !race) return;
  coach.t += dt * timeScale;
  if (coach.cur && coach.t > coach.until) { coachEl.classList.remove('on'); coach.cur = null; coach.lastEnd = coach.t; }
  if (!cfg.coach || state !== 'race') return;
  const p = race.player; if (p.finished) return;
  const s = S.wrap(p.dist), road = S.INFO.kind === 'road', lap = S.lapOf(p) || 1;
  if (race.phase === 'pace') {
    const tg = (race.greenAt - race.paceLeader) / S.INFO.paceV;
    if (race.t > 3.5 && tg > 5 && !coach.paceSaid) { if (coachSay('pace', road ? 'Brake when the BRAKE button glows' : 'Hold your spot. Go on the green', 30, 2.4, 99)) coach.paceSaid = 1; }
    else if (tg < 3.2 && tg > 2.2) coachSay('ready', 'Get ready…', 40, 1.6, 99);
    return;
  }
  // spotter on? then no "move over" advice toward that side
  const sideBusy = (dir) => { for (const c of race.cars) { if (c === p) continue; const g = relS(c.dist, p.dist); if (Math.abs(g) < 9 && Math.sign(c.d - p.d) === dir && Math.abs(c.d - p.d) < 5) return true; } return false; };
  if (p.spin) return;
  if (road) {
    // slide: warn, then remind once it's caught
    if (p.slip > 0.25 || p.slipR > 1.16) { coach.slid = Math.max(coach.slid, p.slip + 0.3); coach.calmT = 0; if (!input.brake) coachSay('slide', 'Sliding! Lift and catch it', 85, 1.3, 3); }
    else if (coach.slid > 0) { coach.calmT += dt; if (coach.calmT > 0.5) { coachSay('smooth', 'Smooth on the throttle', 80, 1.6, 8); coach.slid = 0; } }
    const [c, dist] = nextCorner(s);
    if (c) {
      const key = c.id + ':' + lap;
      // brake call ~0.45 s before the BRAKE button lights, so a thumb has time to get there
      if (c.brake && !input.brake && S.brakeSoon(p, 0.45) && dist < 260 && !coach.done['b' + key]) {
        const t = coach.trouble[c.id];
        if (coachSay('brake', t ? 'Brake now. Earlier than last lap' : (c.vmin < 30 ? 'Brake now!' : 'Brake'), 100, 1.2, 1.5)) coach.done['b' + key] = 1;
      }
      // line: set up on the outside before the big corners
      const want = c.sign < 0 ? -1 : 1; // right-hander: come in from the left
      if (c.big && dist > p.v * 1.4 && dist < p.v * 3.2 && !coach.done['l' + key]) {
        const tgt = want * 4.0;
        if (Math.abs(p.d - tgt) > 4.6 && !sideBusy(want)) { if (coachSay('line', want < 0 ? 'Move left for a better line' : 'Move right for a better line', 45, 1.6, 10)) coach.done['l' + key] = 1; }
      }
    }
    // turn in / apex / track out for the big corners: first two laps, or where you got it wrong last time
    const cc = cornerAt(s, 30);
    if (cc && cc.big && (lap <= 2 || coach.trouble[cc.id])) {
      const k2 = cc.id + ':' + lap, a = relS(s, cc.entry), toApex = relS(cc.apex, s), toExit = relS(cc.exit, s);
      if (a > -p.v * 0.35 && a < 4 && !coach.done['i' + k2]) { if (coachSay('turnin', 'Turn in', 40, 0.9, 1.5)) coach.done['i' + k2] = 1; }
      else if (toApex < p.v * 0.25 && toApex > -4 && !coach.done['a' + k2]) { if (coachSay('apex', 'Apex. Clip the kerb', 40, 1.0, 1.5)) coach.done['a' + k2] = 1; }
      else if (toExit < p.v * 0.3 && toExit > -10 && !coach.done['o' + k2]) { if (coachSay('out', 'Track out. Power on', 40, 1.0, 1.5)) { coach.done['o' + k2] = 1; if (coach.trouble[cc.id] && coach.trouble[cc.id] > 0) coach.trouble[cc.id]--; } }
    }
  } else {
    // ovals: draft and pass, the line through the turns, the wall
    let ahead = null, ag = 1e9;
    for (const o of race.cars) { if (o === p) continue; const g2 = S.wrap(o.dist - p.dist); if (g2 > 4 && g2 < 80 && Math.abs(o.d - p.d) < 2.4 && g2 < ag) { ahead = o; ag = g2; } }
    if (ahead && p.draft > 0.45 && ag < 18 && p.v > ahead.v + 0.5) {
      const din2 = S.dIn(s), dout2 = S.dOut(s);
      const hiRoom = ahead.d + 3.3 < dout2 - 1 && !sideBusy(1), loRoom = ahead.d - 3.3 > din2 + 1 && !sideBusy(-1);
      if (hiRoom || loRoom) coachSay('pull', 'Pull out now! Go ' + (loRoom && (!hiRoom || p.d < S.lineAt(s)) ? 'low' : 'high'), 65, 1.5, 5);
    } else if (ahead && p.draft > 0.3 && ag > 22) coachSay('draft', 'In the draft. Stay tucked in…', 55, 1.6, 14);
    const F = S.turnF(s), Fa = S.turnF(s + p.v * 1.6);
    if (F > 0.6 && p.d > S.lineAt(s) + 3.5) { coach.highT += dt; if (coach.highT > 1.0) coachSay('low', 'Go low. Hug the bottom of the turn', 45, 1.6, 12); } else coach.highT = 0;
    if (F < 0.15 && Fa > 0.5 && p.d < S.lineAt(s) - 4 && !sideBusy(1)) coachSay('up', 'Move up. Set up high for the turn', 45, 1.6, 12);
    if (F > 0.3 && p.d > S.wallOut(s) - 2.6 && p.latV > 1.2 && !input.brake) coachSay('lift', 'Lift! Wall!', 95, 1.0, 3);
  }
  // encouragement on a pass
  const pos = S.positionOf(race, p);
  if (coach.lastPos && pos < coach.lastPos && coach.t - coach.posT > 1.2 && race.raceT > 4) coachSay('pass', 'Nice pass! P' + pos, 25, 1.3, 7);
  if (pos !== coach.lastPos) { coach.lastPos = pos; coach.posT = coach.t; }
}

// ---------------- pre-race yellow, then green ----------------
const flagbar = $('flagbar'), flagTxt = $('flagTxt'), flagSub = $('flagSub');
let flagPhase = '';
function updateStartFlags() {
  if (!race) return;
  if (race.phase === 'pace') {
    const tg = Math.max(0, (race.greenAt - race.paceLeader) / S.INFO.paceV);
    if (flagPhase !== 'yellow') { flagPhase = 'yellow'; flagbar.className = 'flagbar yellow on'; flagTxt.textContent = 'YELLOW FLAG'; setFlag('yellow'); }
    flagSub.textContent = tg > 3 ? 'Field coming to the green' : 'Green in ' + Math.ceil(tg) + '…';
    flagbar.classList.toggle('soon', tg <= 3);
  } else if (flagPhase === 'yellow') {
    flagPhase = 'green'; flagbar.className = 'flagbar green on'; flagTxt.textContent = 'GREEN  GREEN  GREEN!'; flagSub.textContent = ''; setFlag('green');
    setTimeout(() => { if (flagPhase === 'green') { flagbar.classList.remove('on'); flagPhase = 'off'; } }, 2600);
  }
  if (race.player && flagState !== 'checker') {
    const lap = S.lapOf(race.player);
    if (race.phase === 'green' && lap >= race.opts.laps) setFlag('white');
    if (race.finishers > 0) setFlag('checker');
  }
}

// ---------------- ghost car: record every lap, replay your best one on this track ----------------
let ghostOn = false, rec = G.createRecorder(), ghost = null, ghostBase = 0, lapTimes = [], pbLap = 0, leadPos = 0, leadT = 0;
const gpose = { s: 0, d: 0, h: 0 };
function resetGhost() {
  rec = G.createRecorder(); ghostBase = 0; lapTimes = []; pbLap = 0; leadPos = 0; leadT = 0;
  ghost = G.loadGhost(ghostId()); ghostCar.visible = false;
}
function ghostTick(lsBefore, finBefore) {
  const p = race.player; if (!p) return;
  const h = p.psi + (p.yaw || 0);
  if (p.lapStart !== lsBefore) {
    if (lsBefore !== null && p.lastLap && !finBefore) {
      G.recFrame(rec, race.raceT - lsBefore, p.dist - ghostBase, p.d, h);
      const lap = G.recEnd(rec, p.lastLap, L, p.d, h);
      lapTimes.push(p.lastLap);
      const ng = G.offerLap(ghostId(), lap, ghost);
      if (ng) { ghost = ng; pbLap = p.lastLap; }
    }
    ghostBase = SL + Math.floor((p.dist - SL) / L) * L;
    if (!p.finished) G.recStart(rec, race.raceT - p.lapStart, p.dist - ghostBase, p.d, h);
  } else if (p.lapStart !== null && !p.finished) G.recFrame(rec, race.raceT - p.lapStart, p.dist - ghostBase, p.d, h);
}
function updateGhost() {
  ghostCar.visible = false; ghostOn = false;
  const p = race && race.player;
  if (!p || !ghost || !cfg.ghost || p.finished || p.lapStart === null || race.phase !== 'green' || (state !== 'race' && state !== 'paused')) return;
  if (!G.ghostAt(ghost, race.raceT - p.lapStart, gpose)) return;
  ghostOn = true;
  carFrame(ghostBase + gpose.s, gpose.d, gpose.h, tmpF);
  vT.copy(tmpF.fwd).negate(); M4.makeBasis(tmpF.right, tmpF.up, vT); M4.setPosition(tmpF.pos.x + tmpF.up.x * 0.02, tmpF.pos.y + tmpF.up.y * 0.02 + 0.02, tmpF.pos.z + tmpF.up.z * 0.02);
  ghostCar.matrix.copy(M4);
  const dc = camera.position.distanceTo(tmpF.pos);
  ghostMat.opacity = 0.42 * clamp((dc - 3.5) / 8, 0, 1);
  ghostCar.visible = ghostMat.opacity > 0.02;
}
// live gap to the ghost at the same point of the lap (negative = you're ahead)
function ghostDelta() {
  const p = race.player;
  if (!ghost || !cfg.ghost || p.finished || p.lapStart === null || race.phase !== 'green') return null;
  const tg = G.ghostTimeAt(ghost, p.dist - ghostBase);
  return tg === null ? null : (race.raceT - p.lapStart) - tg;
}
// taking the lead: a buzz and a banner (once it sticks for a moment)
function leadTick() {
  if (race.tt || race.phase !== 'green' || race.player.finished) return;
  const pos = S.positionOf(race, race.player);
  if (pos === 1 && leadPos > 1 && race.raceT > 3 && race.raceT - leadT > 4) { leadT = race.raceT; buzz('lead'); if (msgT <= 0) showBanner('P1 · YOU LEAD', 'gold', 1.5); }
  leadPos = pos;
}

// ---------------- frame ----------------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camUp = new THREE.Vector3(0, 1, 0);
let shake = 0, lastPos = 0, perf = { acc: 0, n: 0, t: 0, low: 0 }, spotT = 0, hudT = 0, mapT = 0, camPsi = 0, spinCam = 0;
function updateScene(dt) {
  if (!race) return;
  // cars
  race.cars.forEach((c, i) => {
    // winner turns to face the camera on the bricks
    carFrame(c.dist, c.d, c.psi + (c.yaw || 0) + (state === 'win' && c.isPlayer ? Math.PI : 0), tmpF);
    for (const m of carMeshes) setInstance(m, i, tmpF);
    vT.copy(tmpF.fwd).negate(); M4.makeBasis(tmpF.right, tmpF.up, vT); M4.setPosition(tmpF.pos.x + tmpF.up.x * 0.04, tmpF.pos.y + tmpF.up.y * 0.04, tmpF.pos.z + tmpF.up.z * 0.04); shMesh.setMatrixAt(i, M4);
  });
  const pc = race.pace; paceCar.visible = !pc.out;
  if (paceCar.visible) {
    carFrame(pc.dist, pc.d, pc.d < -1 ? -0.05 : 0, tmpF); vT.copy(tmpF.fwd).negate(); M4.makeBasis(tmpF.right, tmpF.up, vT); M4.setPosition(tmpF.pos.x, tmpF.pos.y + 0.02, tmpF.pos.z); paceCar.matrixAutoUpdate = false; paceCar.matrix.copy(M4);
    M4.setPosition(tmpF.pos.x, tmpF.pos.y + 0.04, tmpF.pos.z); shMesh.setMatrixAt(race.cars.length, M4);
  } else { M4.makeScale(0, 0, 0); shMesh.setMatrixAt(race.cars.length, M4); }
  for (const m of carMeshes) m.instanceMatrix.needsUpdate = true; shMesh.instanceMatrix.needsUpdate = true;
  // sparks
  let any = false;
  for (let k = 0; k < SPK; k++) { if (spkLife[k] > 0) { any = true; spkLife[k] -= dt; spkVel[k * 3 + 1] -= 20 * dt; spkPos[k * 3] += spkVel[k * 3] * dt; spkPos[k * 3 + 1] += spkVel[k * 3 + 1] * dt; spkPos[k * 3 + 2] += spkVel[k * 3 + 2] * dt; if (spkLife[k] <= 0) spkPos[k * 3 + 1] = -100; } }
  sparks.visible = any; if (any) spkGeo.attributes.position.needsUpdate = true;
  // camera
  const p = race.player;
  if (window.KTB.debugCam) { const d = window.KTB.debugCam; camera.position.set(...d.pos); camera.up.set(0, 1, 0); camera.lookAt(...d.look); camera.fov = d.fov || 60; camera.updateProjectionMatrix(); return; }
  if (state === 'win') {
    winCam += dt;
    if (kissed) {
      kissMesh.scale.setScalar(Math.min(1, Math.max(0.001, (winCam - 1.2) * 3)));
      const k = Math.min(1, winCam / 1.5), e = k * k * (3 - 2 * k);
      carFrame(SL - 4.5 + e * 2.2, 1.2, 0, camF); camPos.copy(camF.pos).addScaledVector(camF.up, 3.2 - e * 1.6);
      carFrame(SL, 0.4, 0, tmpF); camLook.copy(tmpF.pos);
    } else {
      carFrame(SL + 3.4, 0, 0, camF);
      const a = winCam * 0.22 + 2.2, rad = 9.5;
      camPos.set(camF.pos.x + Math.cos(a) * rad, camF.pos.y + 3.0, camF.pos.z + Math.sin(a) * rad);
      camLook.set(camF.pos.x, camF.pos.y + 0.6, camF.pos.z);
    }
    if (shake > 0) { shake -= dt; camPos.x += (Math.random() - 0.5) * shake * 1.2; camPos.y += (Math.random() - 0.5) * shake * 1.2; }
    camera.position.copy(camPos); camera.up.set(0, 1, 0); camera.lookAt(camLook); camera.fov = 55; camera.updateProjectionMatrix();
    return;
  }
  camPsi += (p.psi * 0.55 - camPsi) * (1 - Math.exp(-dt * 6));
  carFrame(p.dist, p.d, camPsi, camF);
  // during a spin the camera eases up and back to a chase view and keeps following the direction of travel (not the
  // car's rotation), so you watch the car come round in front of you; in-car views rise first, so nothing clips
  const spinning = !!p.spin;
  spinCam += ((spinning ? 1 : 0) - spinCam) * (1 - Math.exp(-dt * (spinning ? 3.2 : 1.4)));
  const setups = [[7.6, 2.35, 14, 0.9], [4.6, 1.55, 18, 0.95], [-0.4, 1.05, 30, 0.95]];
  let [back, up, ahead, look] = setups[camMode];
  if (spinCam > 0.001) {
    const eu = Math.sqrt(spinCam), eb = camMode === 2 ? spinCam * spinCam : spinCam;
    back += (8.2 - back) * eb; up += (4.6 - up) * eu; ahead += (2 - ahead) * spinCam; look += (0.3 - look) * spinCam;
  }
  camPos.copy(camF.pos).addScaledVector(camF.fwd, -back).addScaledVector(camF.up, up);
  camLook.copy(camF.pos).addScaledVector(camF.fwd, ahead).addScaledVector(camF.up, look);
  if (shake > 0) { shake -= dt; camPos.x += (Math.random() - 0.5) * shake * 0.6; camPos.y += (Math.random() - 0.5) * shake * 0.6; }
  camUp.set(0, 1, 0).lerp(camF.up, 0.7);
  camera.position.copy(camPos); camera.up.copy(camUp); camera.lookAt(camLook);
  const aspect = camera.aspect, hfov = (82 + (p.v / 104) * 6 + p.draft * 5) * (1 - spinCam) + 64 * spinCam;
  let vfov = 2 * Math.atan(Math.tan(hfov * Math.PI / 360) / aspect) * 180 / Math.PI; vfov = clamp(vfov, 46, 88);
  camera.fov = vfov; camera.updateProjectionMatrix();
}

function updateHUD(dt) {
  const p = race.player;
  hudT -= dt; if (hudT > 0) return; hudT = 0.08;
  const pos = S.positionOf(race, p);
  $('hPos').textContent = pos;
  const lap = clamp(S.lapOf(p) || 1, 1, race.opts.laps); $('hLap').textContent = lap;
  $('hTime').textContent = p.lapStart === null ? fmt1(0) : fmt1(race.raceT - p.lapStart);
  $('hLast').textContent = fmt(p.lastLap); $('hBest').textContent = fmt(p.bestLap);
  const gd = ghostDelta(), ge = $('hGhost');
  if (gd === null) ge.classList.remove('on');
  else { ge.classList.add('on'); ge.lastChild.textContent = (gd < 0 ? '−' : '+') + Math.abs(gd).toFixed(2); ge.classList.toggle('ahead', gd < 0); }
  $('hMph').textContent = Math.round(p.v * S.MPH);
  updateWindHUD();
  $('btnLift').classList.toggle('cue', race.phase === 'green' && !p.finished && S.needBrake(p));
  $('hDraft').style.width = Math.round(clamp(p.draft * 1.15, 0, 1) * 100) + '%';
  // spotter
  let low = false, high = false;
  for (const c of race.cars) { if (c === p) continue; let g = S.wrap(c.dist - p.dist); if (g > L / 2) g -= L; if (Math.abs(g) < 7.5) { if (c.d < p.d - 0.5 && p.d - c.d < 5) low = true; if (c.d > p.d + 0.5 && c.d - p.d < 5) high = true; } }
  if (race.phase === 'pace') low = high = false;
  $('spotL').classList.toggle('on', low); $('spotR').classList.toggle('on', high);
}

function handleEvents() {
  for (const e of race.events) {
    if (e.type === 'green') { if (race.daily && race.daily.official) dailyMarkUsed(race.daily.key); if (!flagbar.classList.contains('on')) showBanner('GREEN  GREEN  GREEN!', 'green', 2.2); setTimeout(() => hint.classList.remove('on'), 4000); theme.volume = 0.0; playTheme(false); }
    else if (e.type === 'wall' && e.car === race.player.id) { shake = 0.25 + Math.min(0.4, e.impact * 0.1); carFrame(race.player.dist, race.player.d + (e.inside ? -1 : 1), 0, tmpF); spawnSparks(tmpF.pos.x, tmpF.pos.y + 0.3, tmpF.pos.z, tmpF.fwd.x * race.player.v * 0.8, tmpF.fwd.z * race.player.v * 0.8, 24); buzz(e.impact > 2.5 ? 'crash' : 'wall'); wallSmoke(e); coachEvent(e); }
    else if ((e.type === 'bump' || e.type === 'rub')) { shake = Math.max(shake, 0.12); contactSmoke(e.type === 'bump'); if (e.type === 'bump') buzz('wall'); }
    else if (e.type === 'spin' && e.car === race.player.id) { showBanner('SPIN!', 'gold', 1.4); buzz('crash'); coachEvent(e); }
    else if (e.type === 'spinEnd' && e.car === race.player.id) coachEvent(e);
    else if (e.type === 'lap') {
      coachEvent(e);
      const p = race.player, left = race.opts.laps - e.lap;
      const best = p.bestLap === e.time, pb = best && !race.daily && saveBest(S.INFO.id, e.time);
      if (pb || pbLap === e.time) buzz('best');
      if (left === 1) showBanner((pb ? 'PERSONAL BEST ' + fmt(e.time) + ' · ' : '') + 'WHITE FLAG · FINAL LAP', pb ? 'gold' : 'white', 2.2);
      else showBanner('LAP ' + e.lap + '  ' + fmt(e.time) + (pb ? '  PERSONAL BEST' : best ? '  BEST' : ''), best ? 'gold' : 'white', 1.8);
    } else if (e.type === 'finish' && e.car === race.player.id) {
      showBanner('CHECKERED FLAG!', 'white', 2.5); buzz(e.pos === 1 && !race.tt ? 'win' : 'finish');
      setTimeout(showFinish, 1400);
    }
  }
  race.events.length = 0;
}

function showFinish() {
  if (!race || finishShown) return; finishShown = true;
  const p = race.player, pos = p.finishPos;
  if (race.daily) { showDailyFinish(p, pos); return; }
  $('btnAgain').textContent = 'Race again';
  if (race.tt) {
    // time trial result: your best lap, every lap, and the ghost
    const I = S.INFO, pb = saveBest(I.id, p.bestLap);
    $('fHead').textContent = 'TIME TRIAL · ' + (I.id === 'texas' ? 'TEXAS' : I.id === 'road' ? 'INDY ROAD COURSE' : 'INDIANAPOLIS');
    $('fPos').textContent = p.bestLap ? fmt(p.bestLap) : '--';
    $('fSub').innerHTML = (p.bestLap ? 'Best lap · ' + (Math.round(I.lenMi * 3600 / p.bestLap * 10) / 10) + ' mph' : 'No timed lap') + (pb ? '<br><b class="pb">New personal best at ' + I.short + '</b>' : (bests[I.id] ? '<br>Your best here: ' + fmt(bests[I.id]) : '')) + (ghost && cfg.ghost ? '<br>👻 Your ghost now runs ' + fmt(ghost.t) : '') + suFinishLine();
    $('fTable').innerHTML = lapTimes.map((t, i) => `<li class="${t === p.bestLap ? 'me' : ''}"><span class="p">${i + 1}</span><span class="sw" style="background:${t === p.bestLap ? '#f2c230' : '#5c6470'}"></span><span class="n">Lap ${i + 1}</span><span>${fmt(t)}</span></li>`).join('');
    if (window.GDGBoard && p.bestLap) { const tid = I.id, lap = p.bestLap; setTimeout(() => { if (finishShown && !$('finish').classList.contains('hidden')) window.GDGBoard.afterRound(tid, lap); }, 1200); }
    $('btnKiss').classList.add('hidden'); $('finish').classList.remove('side'); $('fPos').classList.add('time');
    playTheme(true); theme.volume = 0.45;
    show('finish', true); hudEl.classList.add('hidden');
    return;
  }
  $('fPos').classList.remove('time');
  const ord = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
  $('fPos').textContent = 'P' + pos;
  const gained = p.grid - pos;
  const I = S.INFO, pb = saveBest(I.id, p.bestLap);
  $('fSub').innerHTML = `${ord(pos)} of ${race.cars.length} · started ${ord(p.grid)}${gained > 0 ? ' · +' + gained + ' spots' : ''}<br>Race ${fmt(p.finishTime)}${p.bestLap ? ' · ' : ''}${p.bestLap ? 'Best lap ' + fmt(p.bestLap) + ' (' + (Math.round(I.lenMi * 3600 / p.bestLap * 10) / 10) + ' mph)' : ''}${pb ? '<br><b class="pb">New personal best at ' + I.short + '</b>' : (bests[I.id] ? '<br>Your best here: ' + fmt(bests[I.id]) : '')}${suFinishLine()}`;
  const st = S.standings(race);
  const rows = st.slice(0, 5); if (!rows.includes(p)) rows.push(p);
  $('fTable').innerHTML = rows.map((c) => `<li class="${c.isPlayer ? 'me' : ''}"><span class="p">${st.indexOf(c) + 1}</span><span class="sw" style="background:#${c.color.toString(16).padStart(6, '0')}"></span><span class="n">${c.name}</span><span>${c.bestLap ? fmt(c.bestLap) : ''}</span></li>`).join('');
  // online leaderboard: best lap per track; a lap that makes the top 10 gets the initials entry (never blocks the race flow)
  if (window.GDGBoard && p.bestLap) { const tid = I.id, lap = p.bestLap; setTimeout(() => { if (finishShown && !$('finish').classList.contains('hidden')) window.GDGBoard.afterRound(tid, lap); }, pos === 1 ? 2600 : 1200); }
  const win = pos === 1;
  $('fHead').textContent = win ? 'WINNER · ' + (I.id === 'texas' ? 'TEXAS' : I.id === 'road' ? 'INDY ROAD COURSE' : 'INDIANAPOLIS') : 'CHECKERED FLAG';
  $('btnKiss').classList.toggle('hidden', !win);
  $('btnKiss').textContent = I.bricks ? '💋 Kiss the bricks' : '🤠 Fire the six-shooters';
  $('btnKiss').classList.toggle('texas', !I.bricks);
  if (win) {
    const line = I.id === 'texas' ? 'You won in Texas. Hat on, cowboy.' : I.id === 'road' ? 'You won the Grand Prix at the Brickyard. Now go kiss the bricks.' : 'You won at the Brickyard. Now go kiss the bricks.';
    $('fSub').innerHTML = line + '<br>' + $('fSub').innerHTML;
    state = 'win'; winCam = 0; kissMesh.visible = I.bricks; S.surface(SL, 0.4, P); kissMesh.position.set(P.x, P.y + 0.06, P.z); kissMesh.rotation.y = Math.atan2(-P.tz, P.tx) + Math.PI / 2; kissMesh.scale.setScalar(0.001);
    // park the winner on the line (the yard of bricks at Indy)
    p.dist = Math.floor((p.dist - SL) / L) * L + SL + 3.4; p.d = 0; p.psi = 0; p.v = 0;
    const road = I.kind === 'road';
    race.cars.forEach((c) => { if (!c.isPlayer) { c.dist = p.dist - 30 - c.id * 9; c.d = road ? 9 + (c.id % 3) * 2.5 : -14 + (c.id % 3) * 2.5; c.v = 0; } });
    paceCar.visible = false;
    burst(220); playTheme(true); theme.volume = 0.6; engineSound(0, false, 0);
  } else { playTheme(true); theme.volume = 0.45; }
  $('finish').classList.toggle('side', win);
  show('finish', true); hudEl.classList.add('hidden');
}

function frame(ts) {
  requestAnimationFrame(frame);
  const dtRaw = Math.min(0.05, Math.max(0, (ts - (lastTs || ts)) / 1000)); lastTs = ts;
  // adaptive resolution: keep 60fps on phones
  perf.acc += dtRaw; perf.n++;
  if (perf.acc > 2.5) {
    const fps = perf.n / perf.acc; perf.acc = 0; perf.n = 0; window.KTB.fps = fps;
    // keep ~60fps on phones: shed resolution first, then (on Auto) post effects and shadows
    if (fps < 50 && !document.hidden && (state === 'race' || state === 'title')) {
      if (dpr > dprMin() + 0.01) { dpr = Math.max(dprMin(), dpr - 0.25); renderer.setPixelRatio(dpr); resize(); }
      else if (!GQ && cfg.gfx === 'auto' && autoTier > 0 && ++perf.low >= 2) { perf.low = 0; autoTier--; applyTier(); }
    } else perf.low = 0;
  }
  if (state === 'race' || state === 'done') {
    readInput(dtRaw);
    const lsBefore = race.player.lapStart, finBefore = race.player.finished;
    for (let left = dtRaw * timeScale; left > 1e-6; left -= 0.1) S.stepRace(race, Math.min(0.1, left), input);
    ghostTick(lsBefore, finBefore);
    leadTick();
    handleEvents();
    updateHUD(dtRaw);
    coachTick(dtRaw); updateStartFlags(); updateSkids(dtRaw);
    mapT -= dtRaw; if (mapT <= 0) { drawMap(); mapT = 0.1; }
    const p = race.player;
    engineSound(p.v, race.phase !== 'pace' || true, p.draft);
    if (race.playerFinished && state === 'race' && finishShown) state = 'done';
  }
  if (msgT > 0) { msgT -= dtRaw; if (msgT <= 0) banner.classList.remove('on'); }
  if (race) { updateScene(dtRaw); updateFlag(ts / 1000); } else idleCam(ts / 1000);
  drawConfetti(dtRaw);
  updateLook(dtRaw, ts / 1000);
  if (post && tier >= 1) post.render(scene, camera); else renderer.render(scene, camera);
}
// per-frame look: sky follows the camera, the sun's shadow box follows the action, speed blur / heat shimmer
const lookV = new THREE.Vector3();
function updateLook(dt, t) {
  sky.mesh.position.copy(camera.position); sky.uniforms.uTime.value = t;
  if (sun.castShadow) {
    if (race && race.player) { carFrame(race.player.dist, race.player.d, 0, tmpF); lookV.copy(tmpF.pos).addScaledVector(tmpF.fwd, 14); }
    else camera.getWorldDirection(lookV).multiplyScalar(30).add(camera.position);
    // snap to the shadow-map texel grid so the shadows don't shimmer as the box moves
    const step = 68 / sun.shadow.mapSize.x; lookV.x = Math.round(lookV.x / step) * step; lookV.z = Math.round(lookV.z / step) * step;
    sun.target.position.copy(lookV); sun.position.copy(lookV).addScaledVector(SUN_DIR, 400); sun.target.updateMatrixWorld();
  }
  updateGhost();
  if (post) {
    const p = race && race.player, racing = p && (state === 'race' || state === 'done') && race.phase === 'green';
    const v = racing ? p.v : 0, kv = clamp((v - 55) / 50, 0, 1);
    const blurT = racing ? kv * (0.55 + 0.45 * (p.draft || 0)) * (1 - spinCam * 0.6) : 0;
    post.uni.uBlur.value += (blurT - post.uni.uBlur.value) * (1 - Math.exp(-dt * 3));
    post.uni.uShim.value += ((racing ? 0.35 + 0.65 * kv : 0.25) - post.uni.uShim.value) * (1 - Math.exp(-dt * 2));
    post.uni.uTime.value = t;
    // the horizon sits a little above the screen's centre in the chase views
    post.uni.uCenter.value.set(0.5, camMode === 2 ? 0.6 : 0.56);
  }
}
function idleCam(t) {
  // slow fly-by behind the title screen
  const s = (t * 60) % L; carFrame(s, 2, 0, camF);
  camera.position.copy(camF.pos).addScaledVector(camF.up, 6).addScaledVector(camF.right, 4);
  camera.up.set(0, 1, 0); camera.lookAt(camF.pos.clone().addScaledVector(camF.fwd, 60)); camera.fov = 60; camera.updateProjectionMatrix();
}

// ---------------- boot ----------------
window.KTB = { S, camera, G, get ghost() { return ghost; }, ghostDelta: () => (race ? ghostDelta() : null), get ghostVisible() { return ghostCar.visible; }, get tier() { return tier; }, get post() { return !!post; }, get lapTimes() { return lapTimes; }, get standAt() { return standAt; }, get state() { return state; }, race: null, fps: 0, coachLog: [], coachSay: (...a) => coachSay(...a), get coachCfg() { return cfg.coach; }, startRace, applyTrack, buildTrackCards, setTimeScale: (x) => { timeScale = x; }, renderer,
  // test hook: run the race simulation (and the ghost recorder / events) without rendering
  ff: (sec) => { if (!race) return; for (let t = 0; t < sec; t += 0.05) { const lb = race.player.lapStart, fb = race.player.finished; S.stepRace(race, 0.05, input); ghostTick(lb, fb); leadTick(); handleEvents(); } },
  tris: () => { const o = {}; for (const [k, v] of Object.entries(CG)) o[k] = v.attributes.position.count / 3; return o; } };
applyTrack(cfg.track);
setCarCount(0); shMesh.count = 0;
setHaptics(cfg.haptics); applyTier(true);
resize(); syncSettings();
$('loading').classList.add('hidden');
requestAnimationFrame(frame);
if (Q.has('autostart')) startRace();
