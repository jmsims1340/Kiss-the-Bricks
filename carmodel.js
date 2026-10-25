// Kiss the Bricks — a modern IndyCar (Dallara IR-18 style) built from smooth lofted sections.
// Local frame: forward is -z, +x is the car's right, y up; ~5 m long, 1.95 m wide. Returns one geometry per material.
import * as THREE from './three.module.min.js';

// loft a closed tube through cross-sections { z, w, h, y, x, n } (half width / height, superellipse exponent n)
function loft(secs, M = 16, capA = true, capB = true) {
  const pos = [], idx = [];
  for (const sc of secs) {
    const n = sc.n || 2.6, x0 = sc.x || 0;
    for (let j = 0; j < M; j++) {
      const a = (j / M) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const ex = Math.sign(c) * Math.pow(Math.abs(c), 2 / n), ey = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      pos.push(x0 + ex * sc.w, sc.y + ey * sc.h + (sc.dy ? sc.dy * (ey < 0 ? 0 : ey) : 0), sc.z);
    }
  }
  const S = secs.length;
  for (let i = 0; i < S - 1; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + (j + 1) % M, c = (i + 1) * M + j, d = (i + 1) * M + (j + 1) % M;
    idx.push(a, b, c, b, d, c);
  }
  const cap = (i, flip) => { const ci = pos.length / 3; const sc = secs[i]; pos.push(sc.x || 0, sc.y, sc.z); for (let j = 0; j < M; j++) { const a = i * M + j, b = i * M + (j + 1) % M; flip ? idx.push(ci, b, a) : idx.push(ci, a, b); } };
  if (capA) cap(0, true); if (capB) cap(S - 1, false);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g.toNonIndexed();
}
function bx(w, h, l, x, y, z, rx = 0, ry = 0, rz = 0) { const g = new THREE.BoxGeometry(w, h, l); if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz); g.translate(x, y, z); return g.toNonIndexed(); }
// a thin swept plate (wing element) with a cambered profile
function wingEl(span, chord, thick, x, y, z, aoa = 0, camber = 0.25) {
  const g = new THREE.BoxGeometry(span, thick, chord, 1, 1, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const zz = p.getZ(i) / (chord / 2); p.setY(i, p.getY(i) * (1 - 0.5 * zz * zz) + camber * thick * (1 - zz * zz)); }
  g.rotateX(aoa); g.translate(x, y, z); g.computeVertexNormals(); return g.toNonIndexed();
}
function rod(a, b, r) { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b); const len = A.distanceTo(B); const g = new THREE.CylinderGeometry(r, r, len, 5, 1, true); g.translate(0, len / 2, 0); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); g.applyQuaternion(q); g.translate(A.x, A.y, A.z); return g.toNonIndexed(); }
function tire(r, w, x, z) {
  // rounded-shoulder tyre profile, revolved
  const pts = [], rIn = r * 0.62, sh = Math.min(0.06, w * 0.18);
  pts.push(new THREE.Vector2(rIn, -w / 2));
  pts.push(new THREE.Vector2(r - sh, -w / 2));
  for (let k = 1; k <= 4; k++) { const a = (k / 4) * Math.PI / 2; pts.push(new THREE.Vector2(r - sh + Math.sin(a) * sh, -w / 2 + sh - Math.cos(a) * sh)); }
  for (let k = 0; k <= 4; k++) { const a = (k / 4) * Math.PI / 2; pts.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, w / 2 - sh + Math.sin(a) * sh)); }
  pts.push(new THREE.Vector2(rIn, w / 2));
  const g = new THREE.LatheGeometry(pts, 20); g.rotateZ(Math.PI / 2); g.translate(x, r, z); return g.toNonIndexed();
}
function rim(r, w, x, z, side) {
  const out = [];
  const disc = new THREE.CylinderGeometry(r * 0.6, r * 0.6, w * 0.82, 18, 1, true); disc.rotateZ(Math.PI / 2); disc.translate(x, r, z); out.push(disc.toNonIndexed());
  const face = new THREE.CircleGeometry(r * 0.6, 18); face.rotateY(side * Math.PI / 2); face.translate(x + side * w * 0.36, r, z); out.push(face.toNonIndexed());
  return out;
}
const merge = (gs) => {
  let n = 0; for (const g of gs) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3); let o = 0;
  for (const g of gs) { if (!g.attributes.normal) g.computeVertexNormals(); P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); return g;
};
// flat-shaded loft normals look faceted; recompute smooth normals by welding positions
function smooth(g) { const ng = g.index ? g : g; ng.deleteAttribute('normal'); const m = mergeVerts(ng); m.computeVertexNormals(); return m.toNonIndexed(); }
function mergeVerts(g) {
  const p = g.attributes.position, map = new Map(), idx = [], pos = [];
  for (let i = 0; i < p.count; i++) { const k = Math.round(p.getX(i) * 1e4) + ',' + Math.round(p.getY(i) * 1e4) + ',' + Math.round(p.getZ(i) * 1e4); let v = map.get(k); if (v === undefined) { v = pos.length / 3; map.set(k, v); pos.push(p.getX(i), p.getY(i), p.getZ(i)); } idx.push(v); }
  const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); o.setIndex(idx); return o;
}

export function buildIndyCar() {
  const paint = [], accent = [], carbon = [], rubber = [], metal = [], glass = [];
  // nose + tub (monocoque), smooth
  paint.push(smooth(loft([
    { z: -2.62, w: 0.05, h: 0.045, y: 0.31 }, { z: -2.45, w: 0.11, h: 0.08, y: 0.32 }, { z: -2.1, w: 0.17, h: 0.12, y: 0.35 },
    { z: -1.6, w: 0.22, h: 0.16, y: 0.4 }, { z: -1.1, w: 0.27, h: 0.2, y: 0.44 }, { z: -0.6, w: 0.32, h: 0.23, y: 0.46 },
    { z: -0.1, w: 0.34, h: 0.24, y: 0.46 }, { z: 0.35, w: 0.33, h: 0.24, y: 0.46 },
  ], 18)));
  // engine cover sweeping down to the gearbox, with the airbox above the driver's head
  paint.push(smooth(loft([
    { z: -0.05, w: 0.2, h: 0.2, y: 0.74, n: 2.2 }, { z: 0.25, w: 0.27, h: 0.28, y: 0.68 }, { z: 0.8, w: 0.26, h: 0.25, y: 0.62 },
    { z: 1.35, w: 0.19, h: 0.19, y: 0.54 }, { z: 1.85, w: 0.1, h: 0.12, y: 0.44 }, { z: 2.05, w: 0.06, h: 0.08, y: 0.4 },
  ], 18)));
  accent.push(smooth(loft([
    { z: -0.12, w: 0.1, h: 0.08, y: 0.97, n: 2.2 }, { z: 0.05, w: 0.13, h: 0.11, y: 0.98 }, { z: 0.35, w: 0.12, h: 0.1, y: 0.93 }, { z: 0.6, w: 0.08, h: 0.06, y: 0.84 },
  ], 14)));
  carbon.push(bx(0.15, 0.12, 0.04, 0, 0.98, -0.13)); // airbox intake mouth
  // sidepods, each side
  for (const s of [-1, 1]) {
    paint.push(smooth(loft([
      { z: -0.42, w: 0.14, h: 0.15, y: 0.37, x: s * 0.56, n: 3 }, { z: -0.2, w: 0.22, h: 0.2, y: 0.38, x: s * 0.57, n: 3.2 }, { z: 0.4, w: 0.24, h: 0.19, y: 0.37, x: s * 0.55, n: 3 },
      { z: 1.0, w: 0.18, h: 0.14, y: 0.32, x: s * 0.48 }, { z: 1.55, w: 0.1, h: 0.08, y: 0.26, x: s * 0.4 },
    ], 16)));
    carbon.push(bx(0.36, 0.3, 0.03, s * 0.57, 0.38, -0.43)); // radiator inlet
    accent.push(bx(0.02, 0.32, 0.5, s * 0.83, 0.36, -0.15)); // sidepod bargeboard / livery panel
    paint.push(bx(0.06, 0.04, 0.12, s * 0.42, 0.77, -0.75)); // mirror
    carbon.push(rod([s * 0.33, 0.62, -0.75], [s * 0.42, 0.75, -0.75], 0.012));
  }
  // engine fin
  accent.push(bx(0.02, 0.2, 1.1, 0, 0.8, 1.05, 0.22));
  // floor, plank, diffuser
  carbon.push(bx(1.55, 0.04, 2.6, 0, 0.09, 0.45));
  carbon.push(bx(1.1, 0.05, 0.9, 0, 0.09, -0.9));
  carbon.push(bx(1.2, 0.18, 0.5, 0, 0.17, 2.05, -0.35));
  // front wing: main plane + two flaps + endplates
  accent.push(wingEl(1.95, 0.42, 0.035, 0, 0.11, -2.45, 0.04));
  carbon.push(wingEl(0.78, 0.2, 0.025, 0.56, 0.17, -2.38, -0.28)); carbon.push(wingEl(0.78, 0.2, 0.025, -0.56, 0.17, -2.38, -0.28));
  carbon.push(wingEl(0.7, 0.14, 0.02, 0.6, 0.23, -2.27, -0.55)); carbon.push(wingEl(0.7, 0.14, 0.02, -0.6, 0.23, -2.27, -0.55));
  for (const s of [-1, 1]) accent.push(bx(0.025, 0.24, 0.55, s * 0.98, 0.17, -2.42));
  carbon.push(bx(0.06, 0.18, 0.12, 0.2, 0.22, -2.35)); carbon.push(bx(0.06, 0.18, 0.12, -0.2, 0.22, -2.35)); // wing pillars
  // rear wing: main plane, flap, endplates, centre pylon, beam wing
  accent.push(wingEl(1.0, 0.36, 0.04, 0, 0.92, 2.17, -0.08));
  carbon.push(wingEl(1.0, 0.18, 0.03, 0, 1.01, 2.38, -0.5));
  for (const s of [-1, 1]) accent.push(bx(0.025, 0.5, 0.66, s * 0.51, 0.8, 2.22));
  carbon.push(bx(0.05, 0.42, 0.18, 0, 0.66, 2.12));
  carbon.push(wingEl(0.9, 0.2, 0.03, 0, 0.42, 2.25, -0.2));
  // rear crash structure + rain light
  carbon.push(bx(0.16, 0.12, 0.35, 0, 0.36, 2.3));
  metal.push(bx(0.1, 0.05, 0.02, 0, 0.36, 2.48));
  // cockpit: aeroscreen (glass) in a titanium frame, the driver's helmet
  const scr = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 16, 1, true, -Math.PI * 0.42, Math.PI * 0.84);
  scr.rotateX(-0.5); scr.translate(0, 0.78, -0.3); glass.push(scr.toNonIndexed());
  const halo = new THREE.TorusGeometry(0.36, 0.022, 6, 18, Math.PI); halo.rotateX(-Math.PI / 2 + 0.06); halo.rotateY(Math.PI); halo.translate(0, 0.83, -0.25);
  metal.push(halo.toNonIndexed());
  metal.push(rod([0, 0.55, -0.68], [0, 0.85, -0.6], 0.02));
  const hel = new THREE.SphereGeometry(0.135, 14, 10); hel.scale(1, 1.05, 1.15); hel.translate(0, 0.82, -0.12); accent.push(hel.toNonIndexed());
  const visor = new THREE.SphereGeometry(0.137, 12, 6, -Math.PI * 0.35 - Math.PI / 2, Math.PI * 0.7, Math.PI * 0.38, Math.PI * 0.2); visor.scale(1, 1.05, 1.15); visor.translate(0, 0.82, -0.12); glass.push(visor.toNonIndexed());
  // wheels: tyres, rims, uprights and pushrod suspension
  for (const [x, z, r, w] of [[0.83, -1.6, 0.31, 0.3], [-0.83, -1.6, 0.31, 0.3], [0.82, 1.45, 0.34, 0.38], [-0.82, 1.45, 0.34, 0.38]]) {
    rubber.push(tire(r, w, x, z));
    metal.push(...rim(r, w, x, z, Math.sign(x)));
    const ix = Math.sign(x) * 0.3, hx = x - Math.sign(x) * 0.08;
    carbon.push(rod([ix, 0.42, z - 0.25], [hx, r + 0.05, z], 0.022)); carbon.push(rod([ix, 0.42, z + 0.25], [hx, r + 0.05, z], 0.022));
    carbon.push(rod([ix, 0.24, z - 0.22], [hx, r - 0.08, z], 0.02)); carbon.push(rod([ix, 0.24, z + 0.22], [hx, r - 0.08, z], 0.02));
    // tyre-wall lettering band (subtle)
  }
  return { paint: merge(paint), accent: merge(accent), carbon: merge(carbon), rubber: merge(rubber), metal: merge(metal), glass: merge(glass) };
}

// pace car: a low, wide sports coupe
export function buildPaceCar() {
  const body = [], dark = [], glass = [], light = [], metal = [];
  body.push(smooth(loft([
    { z: -2.35, w: 0.82, h: 0.18, y: 0.42, n: 4 }, { z: -2.0, w: 0.92, h: 0.27, y: 0.5, n: 4 }, { z: -0.9, w: 0.96, h: 0.3, y: 0.58, n: 4.5 },
    { z: 0.6, w: 0.98, h: 0.33, y: 0.6, n: 4.5 }, { z: 1.9, w: 0.95, h: 0.32, y: 0.62, n: 4 }, { z: 2.3, w: 0.88, h: 0.27, y: 0.62, n: 4 },
  ], 20)));
  glass.push(smooth(loft([
    { z: -0.55, w: 0.72, h: 0.06, y: 0.9, n: 3 }, { z: -0.1, w: 0.7, h: 0.22, y: 1.02, n: 3 }, { z: 0.5, w: 0.66, h: 0.24, y: 1.04, n: 3 },
    { z: 1.25, w: 0.6, h: 0.14, y: 0.98, n: 3 }, { z: 1.7, w: 0.55, h: 0.04, y: 0.92, n: 3 },
  ], 16)));
  light.push(bx(1.2, 0.1, 0.22, 0, 1.24, 0.25));
  for (const [x, z] of [[0.86, -1.4], [-0.86, -1.4], [0.86, 1.4], [-0.86, 1.4]]) { dark.push(tire(0.34, 0.3, x, z)); metal.push(...rim(0.34, 0.3, x, z, Math.sign(x))); }
  dark.push(bx(1.7, 0.12, 0.08, 0, 0.32, -2.36)); dark.push(bx(1.5, 0.1, 0.06, 0, 0.44, 2.34));
  return { body: merge(body), dark: merge(dark), glass: merge(glass), light: merge(light), metal: merge(metal) };
}
