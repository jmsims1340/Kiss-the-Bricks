// Kiss the Bricks — renderer, input, UI
import * as THREE from './three.module.min.js';
import * as S from './sim.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const fmt = (t) => { if (!t) return '--'; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
const fmt1 = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };

// ---------------- settings ----------------
const DEF = { track: 'indy', laps: 10, steer: 'drag', sens: 1, assist: true, throttle: 'auto', difficulty: 'rookie', grid: 11, field: 33, sound: true, coach: true, coachVoice: false };
let cfg = Object.assign({}, DEF);
try { Object.assign(cfg, JSON.parse(localStorage.getItem('ktb-settings') || '{}')); } catch (e) {}
for (const k of ['laps', 'grid', 'field', 'sens']) if (Q.has(k)) cfg[k] = +Q.get(k);
if (Q.has('track')) cfg.track = Q.get('track');
const save = () => { try { localStorage.setItem('ktb-settings', JSON.stringify(cfg)); } catch (e) {} };

// ---------------- renderer ----------------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let dpr = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(dpr);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const SKY = 0x86bff0;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(0xbcdcf2, 300, 1700);
const camera = new THREE.PerspectiveCamera(60, 1, 0.25, 4000);
scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x5a7a3a, 1.5));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.2); sun.position.set(400, 700, 250); scene.add(sun);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
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
const asphaltTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, w, h);
  const id = g.getImageData(0, 0, w, h);
  for (let i = 0; i < id.data.length; i += 4) { const n = (Math.random() - 0.5) * 34; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
  g.putImageData(id, 0, 0);
  g.fillStyle = 'rgba(0,0,0,0.05)'; for (let i = 0; i < 40; i++) g.fillRect(Math.random() * w, 0, 1 + Math.random() * 3, h);
});
const grassTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#4f8a35'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(30,70,20,0.25)' : 'rgba(140,190,90,0.18)'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, 0, w / 2, h);
});
const brickTex = canvasTex(256, 64, (g, w, h) => {
  g.fillStyle = '#5a3a2a'; g.fillRect(0, 0, w, h);
  const bw = 32, bh = 16;
  for (let r = 0; r < h / bh; r++) for (let c = -1; c < w / bw + 1; c++) {
    const x = c * bw + (r % 2 ? bw / 2 : 0), y = r * bh;
    const v = 120 + Math.random() * 50; g.fillStyle = `rgb(${v + 40},${v * 0.55},${v * 0.38})`; g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
  }
});
const crowdTex = canvasTex(512, 256, (g, w, h) => {
  g.fillStyle = '#3a3d48'; g.fillRect(0, 0, w, h);
  const cols = ['#f2f2f2', '#d32f2f', '#1e63c6', '#f5c518', '#111', '#e86a1f', '#4caf50', '#ffffff', '#ffb6c1', '#9e9e9e'];
  for (let y = 0; y < h; y += 8) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y + 6, w, 2); for (let x = 0; x < w; x += 4) { if (Math.random() < 0.82) { g.fillStyle = cols[(Math.random() * cols.length) | 0]; g.fillRect(x, y + 1, 3, 5); } } }
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
  world.add(new THREE.Mesh(merge([surf, apron]), lam({ map: asphaltTex, vertexColors: true })));
  // white lines: inside edge line, outside line near the wall
  const lines = [
    ribbon(all, (s) => pt(s, dIn(s) - 0.05, 0.03), (s) => pt(s, dIn(s) + 0.3, 0.03)),
    ribbon(all, (s) => pt(s, dOut(s) - 0.65, 0.03), (s) => pt(s, dOut(s) - 0.4, 0.03)),
  ];
  world.add(new THREE.Mesh(merge(lines.map((g) => tint(g, 0xf4f4f0))), lam({ vertexColors: true })));
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
  world.add(new THREE.Mesh(merge([tint(strip, 0xffffff), tint(inf, o.infieldTint || 0xffffff), tint(ground, o.groundTint || 0xd8e8c8)]), lam({ map: grassTex, vertexColors: true })));

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
  const tree = (s, d, sc) => { S.surfaceOn(T, s, d, P); if (!keepP(P.x, P.z, 10)) return; W.push(placeAlong(merge([tint(new THREE.CylinderGeometry(0.4 * sc, 0.5 * sc, 3 * sc, 5).translate(0, 1.5 * sc, 0), 0x5b4130), tint(new THREE.ConeGeometry(3.2 * sc, 8 * sc, 6).translate(0, 6.5 * sc, 0), o.treeHex || 0x2f6b2a)]), s, d, 0)); };
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < o.trees[0]; i++) { const s = rnd() * L; tree(s, dIn(s) - 40 - rnd() * (o.treeDepth || 160), 0.8 + rnd() * 0.8); }
  for (let i = 0; i < o.trees[1]; i++) { const s = rnd() * L; tree(s, dOut(s) + 60 + rnd() * 140, 0.9 + rnd() * 0.9); }
  world.add(new THREE.Mesh(merge(W), lam({ vertexColors: true })));
  // ponds in the infield
  if (o.ponds && o.ponds.length) {
    const pond = new THREE.CircleGeometry(1, 20); pond.rotateX(-Math.PI / 2);
    const keepPond = o.ponds.filter(([s, d, a]) => { S.surfaceOn(T, s, dIn(s) + d, P); return keepP(P.x, P.z, a + 12); });
    if (keepPond.length) {
      const ponds = merge(keepPond.map(([s, d, a, b]) => { const g = pond.clone(); g.scale(a, 1, b); return placeAlong(g, s, dIn(s) + d, 0.0); }));
      ponds.translate(0, -0.005, 0); world.add(new THREE.Mesh(ponds, lam({ color: 0x3f7fb5 })));
    }
  }
  // scoring pylon
  if (o.pylon) { const py = new THREE.BoxGeometry(5, 34, 2.5); py.translate(0, 19, 0); placeAlong(py, SL + 160, dIn(SL) - 34, 0); world.add(new THREE.Mesh(py, new THREE.MeshBasicMaterial({ map: pylonTex }))); }
  // catch fence (one translucent strip)
  const fence = ribbon(all, (s) => pt(s, dOut(s) + 0.6, 1.15), (s) => outPt(s, dOut(s) + 0.35, -0.6, 5.6));
  world.add(new THREE.Mesh(fence, new THREE.MeshBasicMaterial({ color: 0x9aa4ad, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide })));
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
  world.add(new THREE.Mesh(merge(surf), lam({ map: asphaltTex, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
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
  world.add(new THREE.Mesh(merge(lines), lam({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })));
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
  world.add(new THREE.Mesh(merge(W), lam({ vertexColors: true, side: THREE.DoubleSide })));
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
function carGeometry() {
  const body = [], acc = [];
  const W1 = 0xffffff, DK = 0x161616, CF = 0x2a2a2a;
  // chassis tub & nose (forward is -z)
  body.push(box(0.62, 0.42, 2.4, 0, 0.42, 0.1, W1, [0.95, 1.0]));
  body.push(box(0.46, 0.3, 1.5, 0, 0.32, -1.85, W1, [0.45, 1.0, 0.6]));
  body.push(box(0.5, 0.5, 1.7, 0, 0.62, 0.95, W1, [0.75, 0.9]));       // engine cover
  body.push(box(0.36, 0.45, 0.5, 0, 0.95, 0.25, W1, [0.8, 1.0]));      // airbox
  body.push(box(0.5, 0.36, 1.5, 0.62, 0.36, 0.25, W1, [0.75, 1.0]));   // sidepods
  body.push(box(0.5, 0.36, 1.5, -0.62, 0.36, 0.25, W1, [0.75, 1.0]));
  body.push(box(1.5, 0.05, 3.0, 0, 0.1, 0.2, DK));                     // floor
  body.push(box(0.55, 0.22, 0.55, 0, 0.78, -0.45, 0x0d1520));          // aeroscreen
  body.push(box(0.12, 0.25, 0.4, 0, 0.88, -0.2, DK));                   // helmet
  // tyres
  for (const [x, z, r, w] of [[0.83, -1.6, 0.31, 0.3], [-0.83, -1.6, 0.31, 0.3], [0.82, 1.45, 0.34, 0.38], [-0.82, 1.45, 0.34, 0.38]]) {
    const g = new THREE.CylinderGeometry(r, r, w, 10); g.rotateZ(Math.PI / 2); g.translate(x, r, z); body.push(tint(g, DK));
    body.push(box(0.05, 0.03, 0.03, x, r, z, 0xb0b0b0));
  }
  // wings (accent colour)
  acc.push(box(1.9, 0.05, 0.42, 0, 0.12, -2.45, W1));
  acc.push(box(0.04, 0.2, 0.5, 0.95, 0.18, -2.45, W1)); acc.push(box(0.04, 0.2, 0.5, -0.95, 0.18, -2.45, W1));
  acc.push(box(1.0, 0.06, 0.34, 0, 0.92, 2.15, W1)); acc.push(box(1.0, 0.05, 0.22, 0, 0.8, 2.12, W1));
  acc.push(box(0.04, 0.42, 0.55, 0.5, 0.75, 2.12, W1)); acc.push(box(0.04, 0.42, 0.55, -0.5, 0.75, 2.12, W1));
  acc.push(box(0.12, 0.3, 0.14, 0, 0.62, 2.0, CF));
  acc.push(box(0.08, 0.06, 1.3, 0, 0.66, 0.3, W1));                    // stripe on the cover
  return [merge(body), merge(acc)];
}
const MAXC = 33;
const [cgB, cgA] = carGeometry();
const carMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const bodyMesh = new THREE.InstancedMesh(cgB, carMat, MAXC);
const accMesh = new THREE.InstancedMesh(cgA, carMat, MAXC);
bodyMesh.frustumCulled = accMesh.frustumCulled = false;
scene.add(bodyMesh, accMesh);
const shGeo = new THREE.PlaneGeometry(2.6, 5.6); shGeo.rotateX(-Math.PI / 2);
const shMesh = new THREE.InstancedMesh(shGeo, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }), MAXC + 1);
shMesh.frustumCulled = false; scene.add(shMesh);
// pace car
const paceGeo = merge([box(1.9, 0.6, 4.6, 0, 0.5, 0, 0xf4f4f4, [0.9, 1]), box(1.5, 0.45, 2.0, 0, 1.0, 0.3, 0x1b2430), box(1.2, 0.12, 0.25, 0, 1.28, 0.1, 0xff3b1f),
  ...[[0.9, -1.4], [-0.9, -1.4], [0.9, 1.4], [-0.9, 1.4]].map(([x, z]) => { const g = new THREE.CylinderGeometry(0.34, 0.34, 0.3, 10); g.rotateZ(Math.PI / 2); g.translate(x, 0.34, z); return tint(g, 0x111111); }),
  box(1.92, 0.1, 4.62, 0, 0.62, 0, 0x1e63c6)]);
const paceCar = new THREE.Mesh(paceGeo, carMat); scene.add(paceCar);
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
const endDrag = (e) => { if (drag && e.pointerId === drag.id) { drag = null; input.rawSteer = 0; $('steerDot').classList.add('hidden'); } };
window.addEventListener('pointerup', endDrag); window.addEventListener('pointercancel', endDrag);
function pedal(el, set) {
  const on = (e) => { e.preventDefault(); e.stopPropagation(); set(true); el.classList.add('down'); try { el.setPointerCapture(e.pointerId); } catch (_) {} };
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
  if (k === 'steer' && v === 'tilt') enableTilt(); else if (k === 'steer') $('tiltNote').textContent = '';
  if (k === 'sound') { if (!v) { playTheme(false); if (eng) eng.g.gain.value = 0; } else if (state === 'title') { initAudio(); playTheme(true); } }
}));
$('segLaps').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { cfg.laps = +b.dataset.v; syncSettings(); initAudio(); if (state === 'title') playTheme(true); }));
let settingsFrom = 'title';
$('btnSettings').addEventListener('click', () => { settingsFrom = 'title'; show('settings', true); });
$('btnPauseSettings').addEventListener('click', () => { settingsFrom = 'pause'; show('pause', false); show('settings', true); });
$('btnSetDone').addEventListener('click', () => { show('settings', false); if (settingsFrom === 'pause') show('pause', true); });
$('btnRace').addEventListener('click', () => { initAudio(); if (actx && actx.state === 'suspended') actx.resume(); buildTrackCards(); show('title', false); show('tracks', true); });
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
  initAudio(); if (actx && actx.state === 'suspended') actx.resume();
  if (S.INFO.bricks) { $('btnKiss').classList.add('hidden'); burst(160); kissed = true; winCam = 0; $('fSub').innerHTML = 'Smack. A Brickyard tradition. 🥛 Milk is on the way.'; }
  else { fireSixShooters(); $('btnKiss').textContent = '🤠 Fire again!'; $('fSub').innerHTML = 'Bang! Bang! Cowboy hat on, six-shooters in the air. That\'s how they celebrate in Texas Victory Lane. 🤠'; }
});
$('title').addEventListener('pointerdown', () => { initAudio(); if (state === 'title') playTheme(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (state === 'race') togglePause(true); playTheme(false); if (actx) actx.suspend(); } });

// ---------------- tracks: select, apply, best laps ----------------
let bests = {}; try { bests = JSON.parse(localStorage.getItem('ktb-best') || '{}') || {}; } catch (e) {}
const saveBest = (id, t) => { if (!t) return false; if (bests[id] && bests[id] <= t) return false; bests[id] = t; try { localStorage.setItem('ktb-best', JSON.stringify(bests)); } catch (e) {} return true; };
let builtTrack = null;
function applyTrack(id) {
  if (!S.TRACK_INFO[id]) id = 'indy';
  cfg.track = id; save();
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
    b.innerHTML = `<canvas width="240" height="132" aria-hidden="true"></canvas><span class="tinfo"><b>${I.name}</b><span class="tlen">${I.lenMi} mi · ${I.turns} turns · ${I.kind === 'road' ? 'flat' : I.bank + ' banking'}</span><span class="tbest">${bests[id] ? 'Your best lap ' + fmt(bests[id]) : (id === 'road' ? 'Brake zones. Use BRAKE.' : 'No lap yet')}</span></span>`;
    b.addEventListener('click', () => { initAudio(); if (actx && actx.state === 'suspended') actx.resume(); applyTrack(id); show('tracks', false); startRace(); });
    box.appendChild(b); drawThumb(b.querySelector('canvas'), id);
  }
}
$('btnTrackBack').addEventListener('click', () => { show('tracks', false); show('title', true); });

function toTitle() {
  state = 'title'; show('title', true); hudEl.classList.add('hidden'); playTheme(true); engineSound(0, false, 0);
  race = null; kissMesh.visible = false; stopConfetti(); clearSkids(); coachEl.classList.remove('on'); flagbar.classList.remove('on'); flagObj.visible = false; if (skidA) skidA.g.gain.value = 0;
}
function togglePause(force) {
  if (state !== 'race' && state !== 'paused') return;
  const p = force === undefined ? state === 'race' : force;
  if (p && state === 'race') { state = 'paused'; show('pause', true); engineSound(0, false, 0); }
  else if (!p && state === 'paused') { state = 'race'; show('pause', false); show('settings', false); if (actx) actx.resume(); }
}
function startRace() {
  applyTrack(cfg.track);
  race = S.createRace({ track: cfg.track, laps: cfg.laps, field: cfg.field, grid: Math.min(cfg.grid, cfg.field), difficulty: cfg.difficulty, assist: cfg.assist, autoThrottle: cfg.throttle === 'auto', seed: (Math.random() * 1e9) | 0 });
  race.autopilot = Q.has('autopilot');
  window.KTB.race = race;
  state = 'race'; finishShown = false; kissed = false; winCam = 0; kissMesh.visible = false; stopConfetti();
  show('title', false); show('tracks', false); show('finish', false); show('pause', false); hudEl.classList.remove('hidden');
  $('hField').textContent = '/' + race.cars.length; $('hLaps').textContent = '/' + cfg.laps;
  tiltNeutral = null; input.steer = 0; input.rawSteer = 0;
  theme.volume = 0.3;
  banner.classList.remove('on'); msgT = 0;
  resetCoach(); clearSkids(); flagPhase = ''; flagState = ''; setFlag('yellow'); placeFlag(); spinCam = 0;
  const how = cfg.steer === 'tilt' ? 'Tilt the phone to steer.' : (matchMedia('(pointer:fine)').matches && !('ontouchstart' in window) ? 'Arrow keys to steer, ↓ to lift.' : 'Drag a thumb left/right anywhere to steer.');
  const road = S.INFO.kind === 'road';
  hint.textContent = road ? how + ' ' + (cfg.throttle === 'auto' ? 'Gas is automatic. Hold BRAKE before the corners; it glows when you need it.' : 'Hold GAS to go, BRAKE before the corners.')
    : how + ' Tuck in behind a car to draft, pull out to pass. ' + (cfg.throttle === 'auto' ? 'Gas is automatic; hold LIFT to slow.' : 'Hold GAS to go.');
  hint.classList.add('on');
  for (let i = 0; i < MAXC; i++) { bodyMesh.setColorAt(i, new THREE.Color(0x000000)); accMesh.setColorAt(i, new THREE.Color(0x000000)); }
  race.cars.forEach((c, i) => { bodyMesh.setColorAt(i, new THREE.Color(c.color)); accMesh.setColorAt(i, new THREE.Color(c.accent)); });
  bodyMesh.instanceColor.needsUpdate = accMesh.instanceColor.needsUpdate = true;
  bodyMesh.count = accMesh.count = race.cars.length; shMesh.count = race.cars.length + 1;
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

// ---------------- frame ----------------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camUp = new THREE.Vector3(0, 1, 0);
let shake = 0, lastPos = 0, perf = { acc: 0, n: 0, t: 0 }, spotT = 0, hudT = 0, mapT = 0, camPsi = 0, spinCam = 0;
function updateScene(dt) {
  if (!race) return;
  // cars
  race.cars.forEach((c, i) => {
    // winner turns to face the camera on the bricks
    carFrame(c.dist, c.d, c.psi + (c.yaw || 0) + (state === 'win' && c.isPlayer ? Math.PI : 0), tmpF);
    setInstance(bodyMesh, i, tmpF); setInstance(accMesh, i, tmpF);
    vT.copy(tmpF.fwd).negate(); M4.makeBasis(tmpF.right, tmpF.up, vT); M4.setPosition(tmpF.pos.x + tmpF.up.x * 0.04, tmpF.pos.y + tmpF.up.y * 0.04, tmpF.pos.z + tmpF.up.z * 0.04); shMesh.setMatrixAt(i, M4);
  });
  const pc = race.pace; paceCar.visible = !pc.out;
  if (paceCar.visible) {
    carFrame(pc.dist, pc.d, pc.d < -1 ? -0.05 : 0, tmpF); vT.copy(tmpF.fwd).negate(); M4.makeBasis(tmpF.right, tmpF.up, vT); M4.setPosition(tmpF.pos.x, tmpF.pos.y + 0.02, tmpF.pos.z); paceCar.matrixAutoUpdate = false; paceCar.matrix.copy(M4);
    M4.setPosition(tmpF.pos.x, tmpF.pos.y + 0.04, tmpF.pos.z); shMesh.setMatrixAt(race.cars.length, M4);
  } else { M4.makeScale(0, 0, 0); shMesh.setMatrixAt(race.cars.length, M4); }
  bodyMesh.instanceMatrix.needsUpdate = accMesh.instanceMatrix.needsUpdate = shMesh.instanceMatrix.needsUpdate = true;
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
  $('hMph').textContent = Math.round(p.v * S.MPH);
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
    if (e.type === 'green') { if (!flagbar.classList.contains('on')) showBanner('GREEN  GREEN  GREEN!', 'green', 2.2); setTimeout(() => hint.classList.remove('on'), 4000); theme.volume = 0.0; playTheme(false); }
    else if (e.type === 'wall' && e.car === race.player.id) { shake = 0.25 + Math.min(0.4, e.impact * 0.1); carFrame(race.player.dist, race.player.d + (e.inside ? -1 : 1), 0, tmpF); spawnSparks(tmpF.pos.x, tmpF.pos.y + 0.3, tmpF.pos.z, tmpF.fwd.x * race.player.v * 0.8, tmpF.fwd.z * race.player.v * 0.8, 24); if (navigator.vibrate) navigator.vibrate(30); coachEvent(e); }
    else if ((e.type === 'bump' || e.type === 'rub')) { shake = Math.max(shake, 0.12); }
    else if (e.type === 'spin' && e.car === race.player.id) { showBanner('SPIN!', 'gold', 1.4); if (navigator.vibrate) navigator.vibrate([40, 60, 40]); coachEvent(e); }
    else if (e.type === 'spinEnd' && e.car === race.player.id) coachEvent(e);
    else if (e.type === 'lap') {
      coachEvent(e);
      const p = race.player, left = race.opts.laps - e.lap;
      const best = p.bestLap === e.time; if (best) saveBest(S.INFO.id, e.time);
      if (left === 1) showBanner('WHITE FLAG · FINAL LAP', 'white', 2.2);
      else showBanner('LAP ' + e.lap + '  ' + fmt(e.time) + (best ? '  BEST' : ''), best ? 'gold' : 'white', 1.8);
    } else if (e.type === 'finish' && e.car === race.player.id) {
      showBanner('CHECKERED FLAG!', 'white', 2.5);
      setTimeout(showFinish, 1400);
    }
  }
  race.events.length = 0;
}

function showFinish() {
  if (!race || finishShown) return; finishShown = true;
  const p = race.player, pos = p.finishPos;
  const ord = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
  $('fPos').textContent = 'P' + pos;
  const gained = p.grid - pos;
  const I = S.INFO, pb = saveBest(I.id, p.bestLap);
  $('fSub').innerHTML = `${ord(pos)} of ${race.cars.length} · started ${ord(p.grid)}${gained > 0 ? ' · +' + gained + ' spots' : ''}<br>Race ${fmt(p.finishTime)}${p.bestLap ? ' · ' : ''}${p.bestLap ? 'Best lap ' + fmt(p.bestLap) + ' (' + (Math.round(I.lenMi * 3600 / p.bestLap * 10) / 10) + ' mph)' : ''}${pb ? '<br><b class="pb">New personal best at ' + I.short + '</b>' : (bests[I.id] ? '<br>Your best here: ' + fmt(bests[I.id]) : '')}`;
  const st = S.standings(race);
  const rows = st.slice(0, 5); if (!rows.includes(p)) rows.push(p);
  $('fTable').innerHTML = rows.map((c) => `<li class="${c.isPlayer ? 'me' : ''}"><span class="p">${st.indexOf(c) + 1}</span><span class="sw" style="background:#${c.color.toString(16).padStart(6, '0')}"></span><span class="n">${c.name}</span><span>${c.bestLap ? fmt(c.bestLap) : ''}</span></li>`).join('');
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
  if (perf.acc > 2.5) { const fps = perf.n / perf.acc; perf.acc = 0; perf.n = 0; window.KTB.fps = fps; if (fps < 48 && dpr > 1.1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); resize(); } }
  if (state === 'race' || state === 'done') {
    readInput(dtRaw);
    for (let left = dtRaw * timeScale; left > 1e-6; left -= 0.1) S.stepRace(race, Math.min(0.1, left), input);
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
  renderer.render(scene, camera);
}
function idleCam(t) {
  // slow fly-by behind the title screen
  const s = (t * 60) % L; carFrame(s, 2, 0, camF);
  camera.position.copy(camF.pos).addScaledVector(camF.up, 6).addScaledVector(camF.right, 4);
  camera.up.set(0, 1, 0); camera.lookAt(camF.pos.clone().addScaledVector(camF.fwd, 60)); camera.fov = 60; camera.updateProjectionMatrix();
}

// ---------------- boot ----------------
window.KTB = { S, camera, get standAt() { return standAt; }, get state() { return state; }, race: null, fps: 0, coachLog: [], coachSay: (...a) => coachSay(...a), get coachCfg() { return cfg.coach; }, startRace, applyTrack, buildTrackCards, setTimeScale: (x) => { timeScale = x; }, renderer };
applyTrack(cfg.track);
bodyMesh.count = accMesh.count = 0; shMesh.count = 0;
resize(); syncSettings();
$('loading').classList.add('hidden');
requestAnimationFrame(frame);
if (Q.has('autostart')) startRace();
