// Kiss the Bricks — race simulation (no rendering). Units: metres, seconds, m/s.
// Three tracks share one model: a lap is a closed centreline sampled every ~2 m, and a car is (dist along it, d across it).
// Indianapolis oval: 2.5 mi rounded rectangle, counter-clockwise (all left turns).
// Texas Motor Speedway: 1.5 mi high-banked quad-oval, counter-clockwise.
// Indianapolis road course: the 14-turn infield circuit, clockwise, sharing the oval's front stretch.
import { TEXAS, ROAD } from './tracks-data.js';
export const MPH = 2.23694;
const MI = 1609.344;
export const LS = MI * 5 / 8;          // front / back straight
export const LC = MI / 8;              // short chute
export const LT = MI / 4;              // each turn (quarter mile)
export const TR = LT / (Math.PI / 2);  // turn radius (~256 m, ~840 ft)
export const BANK = 9.2 * Math.PI / 180;
export const SEGS = [
  ['S', LS, 'Front stretch'], ['T', LT, 'Turn 1'], ['C', LC, 'Short chute'], ['T', LT, 'Turn 2'],
  ['S', LS, 'Back stretch'], ['T', LT, 'Turn 3'], ['C', LC, 'Short chute'], ['T', LT, 'Turn 4'],
];
const INDY_L = SEGS.reduce((a, s) => a + s[1], 0); // 4023.36 m
export const CAR_LEN = 5.0, CAR_W = 1.95;
const DEG = Math.PI / 180;

// Track facts. lenMi is the official lap length shown to the player (and used for average mph).
export const TRACK_INFO = {
  indy: { id: 'indy', name: 'Indianapolis Oval', short: 'Indy Oval', place: 'Indianapolis Motor Speedway', lenMi: 2.5, kind: 'oval', turns: 4, bank: '9°', bricks: true,
    paceV: 44.7, leadIn: 1000, greenBefore: 260, paceOut: 14, paceSide: -1, scrub: 0.042, brk: [9, 2] },
  texas: { id: 'texas', name: 'Texas Motor Speedway', short: 'Texas', place: 'Fort Worth, Texas', lenMi: 1.5, kind: 'oval', turns: 4, bank: '20–24°', bricks: false,
    paceV: 44.7, leadIn: 900, greenBefore: 230, paceOut: 12, paceSide: -1, scrub: 0.06, brk: [9, 2] },
  road: { id: 'road', name: 'Indianapolis Road Course', short: 'Indy Road Course', place: 'Indianapolis Motor Speedway', lenMi: 2.439, kind: 'road', turns: 14, bank: 'flat', bricks: true,
    paceV: 26, leadIn: 430, greenBefore: 140, paceOut: 7, paceSide: 1, scrub: 0, brk: [16, 12] },
};
export const TRACK_IDS = ['indy', 'texas', 'road'];

// live bindings: importers always see the selected track
export let TRACK_ID = 'indy', INFO = TRACK_INFO.indy;
export let L = INDY_L;
export let S_LINE = 610;            // start / finish (the yard of bricks at Indy), metres from the lap's start
export let DS = L / Math.ceil(L / 2);  // track sample spacing (~2 m, divides the lap exactly)

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const wrap = (s) => ((s % L) + L) % L;
const rel = (s, a) => { let r = wrap(s - a + L / 2) - L / 2; return r; };
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

// ---------- track samples ----------
// Every track carries the same per-sample arrays (length n+1, the last repeating the first):
// X, Z centreline; TX, TZ unit tangent; K curvature (+ = left turn); F 0..1 "in a corner"; B banking (rad);
// LINE racing line; DIN / DOUT edges of the racing surface; AIN / AOUT paved apron beyond each edge;
// WIN / WOUT how far the walls stand beyond each edge; VP / VPP corner speed limits for the AI / the autopilot.
function alloc(n) {
  const T = { n };
  for (const k of ['X', 'Z', 'TX', 'TZ', 'K', 'F', 'B', 'LINE', 'DIN', 'DOUT', 'AIN', 'AOUT', 'WIN', 'WOUT', 'VP', 'VPP']) T[k] = new Float64Array(n + 1);
  return T;
}
function finish(T, L_) {
  const n = T.n;
  for (const k of ['X', 'Z', 'TX', 'TZ', 'K', 'F', 'B', 'LINE', 'DIN', 'DOUT', 'AIN', 'AOUT', 'WIN', 'WOUT', 'VP', 'VPP']) T[k][n] = T[k][0];
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (let i = 0; i < n; i++) { minx = Math.min(minx, T.X[i]); maxx = Math.max(maxx, T.X[i]); minz = Math.min(minz, T.Z[i]); maxz = Math.max(maxz, T.Z[i]); }
  T.size = [maxx - minx, maxz - minz]; T.center = [(minx + maxx) / 2, (minz + maxz) / 2]; T.L = L_; T.DS = L_ / n;
  return T;
}
function buildIndy() {
  const L_ = INDY_L, DS_ = L_ / Math.ceil(L_ / 2);
  const n = Math.ceil(L_ / DS_);
  const T = alloc(n), { X, Z, TX, TZ, K, F, LINE, DIN, DOUT } = T;
  const turns = []; let acc = 0;
  for (const [t, len] of SEGS) { if (t === 'T') turns.push([acc, len]); acc += len; }
  const relI = (s, a) => (((s - a + L_ / 2) % L_) + L_) % L_ - L_ / 2;
  // exact piecewise geometry: straights and constant-radius arcs; heading h, tangent (cos h, -sin h), +h turns left
  const starts = []; { let x = 0, z = 0, h = 0, a = 0; for (const sg of SEGS) { starts.push({ a, x, z, h, t: sg[0], len: sg[1] }); const e = posIn(starts[starts.length - 1], sg[1]); x = e[0]; z = e[1]; h = e[2]; a += sg[1]; } }
  function posIn(st, u) {
    if (st.t !== 'T') return [st.x + Math.cos(st.h) * u, st.z - Math.sin(st.h) * u, st.h];
    const h1 = st.h + u / TR; // centre of the arc is to the left: left normal = (-sin h, -cos h)
    const cx = st.x - Math.sin(st.h) * TR, cz = st.z - Math.cos(st.h) * TR;
    return [cx + Math.sin(h1) * TR, cz + Math.cos(h1) * TR, h1];
  }
  for (let i = 0; i <= n; i++) {
    const s = Math.min(i * DS_, L_) % L_;
    let st = starts[0]; for (const q of starts) if (s >= q.a) st = q;
    const [px, pz, ph] = posIn(st, s - st.a);
    X[i] = px; Z[i] = pz; TX[i] = Math.cos(ph); TZ[i] = -Math.sin(ph); K[i] = st.t === 'T' ? 1 / TR : 0;
  }
  // centre the track at the origin
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (let i = 0; i <= n; i++) { minx = Math.min(minx, X[i]); maxx = Math.max(maxx, X[i]); minz = Math.min(minz, Z[i]); maxz = Math.max(maxz, Z[i]); }
  const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2;
  for (let i = 0; i <= n; i++) { X[i] -= cx; Z[i] -= cz; }
  for (let i = 0; i < n; i++) {
    const s = i * DS_; let f = 0, bump = 0;
    for (const [a, len] of turns) {
      const r = relI(s, a);
      f = Math.max(f, smooth(-45, 45, r) * (1 - smooth(len - 45, len + 45, r)));
      const xx = (r - len / 2) / (len / 2 + 175);
      if (Math.abs(xx) < 1) bump = Math.max(bump, 0.5 * (1 + Math.cos(Math.PI * xx)));
    }
    F[i] = f; DIN[i] = -7.6 - 1.5 * f; DOUT[i] = 7.6 + 1.5 * f;
    const hi = 4.9, lo = DIN[i] + 1.45;
    LINE[i] = hi - (hi - lo) * bump;
    T.B[i] = BANK * f; T.AIN[i] = 4.2; T.AOUT[i] = 0; T.WIN[i] = 7; T.WOUT[i] = 0; T.VP[i] = 1e9; T.VPP[i] = 1e9;
  }
  easeBank(T, n, 30);
  T.segName = (s) => { let a = 0; for (const sg of SEGS) { if (s < a + sg[1]) return sg[2]; a += sg[1]; } return ''; };
  return finish(T, L_);
}

// circular moving average (box filter) of a sample array, radius r samples
function boxSmooth(A, n, r) {
  const out = new Float64Array(n + 1); let acc = 0;
  for (let j = -r; j <= r; j++) acc += A[((j % n) + n) % n];
  for (let i = 0; i < n; i++) { out[i] = acc / (2 * r + 1); acc += A[(i + r + 1) % n] - A[((i - r) % n + n) % n]; }
  out[n] = out[0]; return out;
}
// Ease banking and track width in and out of every corner: two box passes give a long, curvature-continuous
// blend, so the surface height never steps at a corner entry/exit or at the lap's wrap point.
function easeBank(T, n, r) {
  for (const k of ['B', 'DIN', 'DOUT']) { const A = boxSmooth(boxSmooth(T[k], n, r), n, r); for (let i = 0; i <= n; i++) T[k][i] = A[i]; }
}
// Grip model for corners (road course): lateral grip grows with speed (downforce).
export const GRIP0 = 28, GRIP1 = 0.25;
export const gripAt = (v) => GRIP0 + GRIP1 * v;
function cornerSpeed(k) { k = Math.abs(k); if (k < 1e-5) return 1e9; return (GRIP1 + Math.sqrt(GRIP1 * GRIP1 + 4 * k * GRIP0)) / (2 * k); }
const V_TOP = 104.2;          // ~233 mph flat-out on a straight with clean air
export const brakeDecel = (info, v) => info.brk[0] + info.brk[1] * (v / V_TOP);
// speed you can carry at each point: the corner limit, with braking distance worked backwards from it
function speedProfile(T, info, scale, decelScale) {
  const n = T.n, ds = T.DS, Ks = boxSmooth(T.K, n, 2), V = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) V[i] = Math.min(V_TOP * 1.12, cornerSpeed(Ks[i]) * scale);
  for (let pass = 0; pass < 3; pass++) for (let j = 2 * n; j > 0; j--) {
    const i = j % n, p = (j - 1) % n;
    const lim = Math.sqrt(V[i] * V[i] + 2 * brakeDecel(info, V[i]) * decelScale * ds);
    if (V[p] > lim) V[p] = lim;
  }
  V[n] = V[0]; return V;
}
function buildFromCentreline(id, D) {
  const info = TRACK_INFO[id], n = D.n, L_ = D.L, ds = L_ / n;
  const T = alloc(n), { X, Z, TX, TZ, K, F, B, LINE, DIN, DOUT } = T;
  T.DS = ds;
  for (let i = 0; i < n; i++) { X[i] = D.X[i]; Z[i] = D.Z[i]; }
  const H = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i + 1) % n, b = (i - 1 + n) % n;
    let tx = X[a] - X[b], tz = Z[a] - Z[b]; const l = Math.hypot(tx, tz); TX[i] = tx / l; TZ[i] = tz / l;
  }
  // curvature from the heading change over +-4 samples (positions are rounded to 1 cm)
  const w = 4;
  for (let i = 0; i < n; i++) {
    const a = (i + w) % n, b = (i - w + n) % n;
    const ha = Math.atan2(-TZ[a], TX[a]), hb = Math.atan2(-TZ[b], TX[b]);
    let dh = ha - hb; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    K[i] = dh / (2 * w * ds);
  }
  const Kraw = K.slice(); const Ks = boxSmooth(boxSmooth(K, n, 2), n, 2); for (let i = 0; i < n; i++) K[i] = Ks[i];
  if (info.kind === 'oval') {
    const Kw = boxSmooth(boxSmooth(Kraw, n, 10), n, 10);
    for (let i = 0; i < n; i++) F[i] = smooth(1 / 900, 1 / 300, Math.abs(Kw[i]));
    F[n] = F[0];
    const Fw = boxSmooth(boxSmooth(F, n, 45), n, 45); let fm = 0; for (let i = 0; i < n; i++) fm = Math.max(fm, Fw[i]);
    for (let i = 0; i < n; i++) {
      const s = i * ds;
      // Texas: turns 1-2 banked 20°, turns 3-4 24°, the front-stretch dogleg 8°
      const turnBank = (24 - 4 * smooth(-60, 60, X[i])) * DEG;
      const front = s < 700 || s > L_ - 400 ? 1 : 0;   // the whole front stretch (Turn 4 exit to Turn 1) keeps 8°
      B[i] = Math.max(F[i] * turnBank, front * 8 * DEG);
      DIN[i] = -7.6 - 1.5 * F[i]; DOUT[i] = 7.6 + 1.5 * F[i];
      const hi = 4.9, lo = DIN[i] + 1.45, bump = clamp(Fw[i] / fm * 1.25, 0, 1);
      LINE[i] = hi - (hi - lo) * bump;
      T.AIN[i] = 4.2; T.AOUT[i] = 0; T.WIN[i] = 7; T.WOUT[i] = 0; T.VP[i] = 1e9; T.VPP[i] = 1e9;
    }
    easeBank(T, n, 45);
    T.segName = (s) => s < 690 ? 'Front stretch' : s < 1150 ? 'Turns 1-2' : s < 1500 ? 'Back stretch' : s < 2300 ? 'Turns 3-4' : 'Front stretch';
  } else {
    const Kw = boxSmooth(boxSmooth(Kraw, n, 9), n, 9);
    const [oa, ob] = D.onOval;
    for (let i = 0; i < n; i++) {
      const s = i * ds;
      F[i] = smooth(1 / 500, 1 / 120, Math.abs(K[i]));
      B[i] = 0; DIN[i] = -7.6; DOUT[i] = 7.6;
      LINE[i] = -Math.sign(Kw[i]) * clamp(Math.abs(Kw[i]) * 75, 0, 1) * 5.4;
      // on the oval's front stretch: the SAFER wall is on the left (the oval's outside), the apron and pit wall on the right
      const on = smooth(oa - 70, oa + 10, s) * (1 - smooth(ob - 10, ob + 30, s));
      T.WIN[i] = 7 * (1 - on); T.WOUT[i] = 7 + 0.2 * on; T.AIN[i] = 0; T.AOUT[i] = 4.2 * (on > 0.99 ? 1 : 0);
    }
    T.segName = (s) => (s > oa && s < ob) ? 'Front stretch' : 'Infield';
  }
  if (info.kind === 'road') {
    // keep the run-off on the inside of tight corners from folding over itself
    const Kq = boxSmooth(T.K, n, 6);
    for (let i = 0; i < n; i++) {
      const R = 1 / Math.max(1e-4, Math.abs(Kq[i])), room = Math.max(0.6, R - 7.6 - 6);
      if (Kq[i] > 0) T.WIN[i] = Math.min(T.WIN[i], room); else T.WOUT[i] = Math.min(T.WOUT[i], room);
    }
  }
  finish(T, L_);
  if (info.kind === 'road') {
    T.VP = speedProfile(T, info, 1.0, 0.9);   // AI: a touch under the player's braking
    T.VPP = speedProfile(T, info, 0.98, 0.85); // autopilot / brake cue: a safe margin
  }
  T.sLine = D.sLine;
  return T;
}

export const TRACKS = { indy: buildIndy(), texas: buildFromCentreline('texas', TEXAS), road: buildFromCentreline('road', ROAD) };
TRACKS.indy.sLine = 610;
export let TRACK = TRACKS.indy;
export const ROAD_ON_OVAL = ROAD.onOval;

export function setTrack(id) {
  if (!TRACKS[id]) id = 'indy';
  TRACK_ID = id; INFO = TRACK_INFO[id]; TRACK = TRACKS[id];
  L = TRACK.L; DS = TRACK.DS; S_LINE = TRACK.sLine;
}

function lerpArr(A, s) { const u = wrap(s) / DS, i = Math.floor(u), t = u - i; return A[i] + (A[Math.min(i + 1, TRACK.n)] - A[i]) * t; }
export const kappaAt = (s) => TRACK.K[Math.round(wrap(s) / DS) % TRACK.n];
export const turnF = (s) => lerpArr(TRACK.F, s);
export const lineAt = (s) => lerpArr(TRACK.LINE, s);
export const dIn = (s) => lerpArr(TRACK.DIN, s);
export const dOut = (s) => lerpArr(TRACK.DOUT, s);
export const wallIn = (s) => lerpArr(TRACK.DIN, s) - lerpArr(TRACK.WIN, s);   // d of the left-hand wall
export const wallOut = (s) => lerpArr(TRACK.DOUT, s) + lerpArr(TRACK.WOUT, s); // d of the right-hand wall
export const apronIn = (s) => lerpArr(TRACK.AIN, s);
export const apronOut = (s) => lerpArr(TRACK.AOUT, s);
export const bankAt = (s) => lerpArr(TRACK.B, s);
export const profAt = (s) => lerpArr(TRACK.VP, s);
export const safeSpeedAt = (s) => lerpArr(TRACK.VPP, s);
export function segmentName(s) { return TRACK.segName(wrap(s)); }

// World point on the racing surface of track T (default: the selected one). Banking pivots on the inside edge of the
// racing surface; the apron and everything inside it is flat.
export function surfaceOn(T, s, d, out) {
  const n = T.n, ds = T.DS, LL = T.L;
  const u = (((s % LL) + LL) % LL) / ds, i = Math.floor(u), t = u - i, j = Math.min(i + 1, n);
  const x = T.X[i] + (T.X[j] - T.X[i]) * t, z = T.Z[i] + (T.Z[j] - T.Z[i]) * t;
  let tx = T.TX[i] + (T.TX[j] - T.TX[i]) * t, tz = T.TZ[i] + (T.TZ[j] - T.TZ[i]) * t; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
  const rx = -tz, rz = tx; // right / outside
  const b = T.B[i] + (T.B[j] - T.B[i]) * t, din = T.DIN[i] + (T.DIN[j] - T.DIN[i]) * t;
  let px, py, pz;
  if (d <= din || b === 0) { px = x + rx * d; pz = z + rz * d; py = 0; }
  else { const e = d - din, c = Math.cos(b), sn = Math.sin(b); px = x + rx * (din + e * c); pz = z + rz * (din + e * c); py = e * sn; }
  out = out || {};
  out.x = px; out.y = py; out.z = pz; out.tx = tx; out.tz = tz; out.bank = d > din ? b : 0; return out;
}
export function surface(s, d, out) { return surfaceOn(TRACK, s, d, out); }
export const dInOn = (T, s) => { const u = (((s % T.L) + T.L) % T.L) / T.DS, i = Math.floor(u), t = u - i; return T.DIN[i] + (T.DIN[Math.min(i + 1, T.n)] - T.DIN[i]) * t; };
export const dOutOn = (T, s) => { const u = (((s % T.L) + T.L) % T.L) / T.DS, i = Math.floor(u), t = u - i; return T.DOUT[i] + (T.DOUT[Math.min(i + 1, T.n)] - T.DOUT[i]) * t; };

// ---------- field ----------
export const DRIVERS = [
  ['Rocco Vance', 0xd71920, 0xffffff], ['Mika Laurent', 0xffd200, 0x111111], ['Dez Okafor', 0x0b3d91, 0xff6a13],
  ['Sam Kowalski', 0xff7a00, 0x1d6fd8], ['Ana Ribeiro', 0x00a651, 0xffffff], ['Tate Brennan', 0xffffff, 0xd71920],
  ['Kenji Arai', 0x111111, 0xffd200], ['Lou Marchetti', 0x7a1fa2, 0xffffff], ['Bo Hendricks', 0x00b5e2, 0x111111],
  ['Gus Pruett', 0xe4002b, 0x0b3d91], ['Riley Shaw', 0xff4fa3, 0xffffff], ['Nico Duval', 0x2e7d32, 0xffd200],
  ['Jett Castillo', 0x1565c0, 0xffffff], ['Hank Doyle', 0xb71c1c, 0x111111], ['Ines Holm', 0x00897b, 0xffffff],
  ['Wade Tully', 0xf57f17, 0x111111], ['Cruz Medina', 0x283593, 0xd4af37], ['Pip Larkin', 0x8bc34a, 0x111111],
  ['Otto Strand', 0x546e7a, 0xff6a13], ['Vic Romano', 0xc62828, 0xffd200], ['Lena Fox', 0x6a1b9a, 0x00e5ff],
  ['Ty Beaumont', 0x0d47a1, 0xff1744], ['Ray Quill', 0xfafafa, 0x0b3d91], ['Max Ferreira', 0x212121, 0x00e676],
  ['Jody Pike', 0xef6c00, 0xffffff], ['Cal Winters', 0x1e88e5, 0xffd200], ['Sully Graves', 0x4e342e, 0xffffff],
  ['Indy Rhodes', 0xd50000, 0xffffff], ['Moe Bancroft', 0x00695c, 0xffd200], ['Rae Lindqvist', 0xad1457, 0xffffff],
  ['Dutch Varga', 0x37474f, 0xffeb3b], ['Ollie Sato', 0x0277bd, 0xff9100],
];
export const PLAYER_COLORS = [0xf2b705, 0x1a1a1a];

const DIFF = { rookie: [0.97, 1.0], pro: [0.981, 1.009], veteran: [0.99, 1.018] };
const ACC = 12.0;
const DRAFT_MAX = 0.06, DRAFT_RANGE = 70, DRAFT_W = 2.3;
const ROW_GAP = 15;

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function createRace(o = {}) {
  const opts = Object.assign({ laps: 10, field: 33, grid: 11, difficulty: 'pro', assist: true, autoThrottle: true, seed: 7 }, o);
  if (opts.track) setTrack(opts.track);
  const R = rng(opts.seed);
  const n = Math.max(2, Math.min(33, opts.field | 0));
  const pIdx = clamp((opts.grid | 0) - 1, 0, n - 1);
  const [lo, hi] = DIFF[opts.difficulty] || DIFF.pro;
  const cars = [];
  const leaderDist = S_LINE - INFO.leadIn;
  let di = 0;
  for (let g = 0; g < n; g++) {
    const isP = g === pIdx;
    const drv = isP ? ['You', PLAYER_COLORS[0], PLAYER_COLORS[1]] : DRIVERS[di++ % DRIVERS.length];
    const row = Math.floor(g / 3), col = g % 3;
    // qualifying order: faster cars start nearer the front (with some noise)
    const q = 1 - g / Math.max(1, n - 1);
    const pace = isP ? 1 : lo + (hi - lo) * clamp(0.65 * q + 0.35 * R(), 0, 1);
    const slotD = [-4.2, 0, 4.2][col];
    cars.push({
      id: g, name: drv[0], color: drv[1], accent: drv[2], isPlayer: isP, grid: g + 1,
      pace, wob: R() * 6.28, wobF: 0.15 + R() * 0.2, aggr: 0.3 + R() * 0.7,
      dist: leaderDist - row * ROW_GAP, d: slotD, slotD, row, psi: 0, v: INFO.paceV, latV: 0,
      draft: 0, wall: 0, wallHit: 0, onApron: false, finished: false, finishTime: 0, finishPos: 0,
      lapStart: null, lastLap: 0, bestLap: 0, laps: 0, passSide: 0, passTarget: -1, passTimer: 0, thinkT: R() * 0.1,
      tgtD: slotD, sideNear: 0, yaw: 0, yawRate: 0, slip: 0, slipR: 0, recover: 0, spin: null, skid: 0, slide: 0,
    });
  }
  return {
    opts, cars, player: cars[pIdx], t: 0, raceT: 0, phase: 'pace', pace: { dist: leaderDist + 45, d: 0, v: INFO.paceV, out: false },
    finishers: 0, events: [], greenAt: S_LINE - INFO.greenBefore, leaderDistStart: leaderDist, track: TRACK_ID,
  };
}

export function lapOf(car) { return car.dist < S_LINE ? 0 : Math.floor((car.dist - S_LINE) / L) + 1; }
export function progress(car) { return car.dist - S_LINE; }

export function standings(race) {
  return race.cars.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishPos - b.finishPos;
    if (a.finished) return -1; if (b.finished) return 1;
    return b.dist - a.dist;
  });
}
export function positionOf(race, car) { return standings(race).indexOf(car) + 1; }

// distance from a to b going forward along the track, in [0, L)
const gapAhead = (a, b) => wrap(b.dist - a.dist);

function computeDraft(race, c) {
  let best = 0;
  for (const o of race.cars) {
    if (o === c) continue;
    const g = gapAhead(c, o);
    if (g > 4 && g < DRAFT_RANGE) {
      const w = DRAFT_W + g * 0.012;
      const dd = Math.abs(o.d - c.d);
      if (dd < w) {
        const s = Math.pow(1 - g / DRAFT_RANGE, 0.75) * (1 - 0.5 * dd / w);
        if (s > best) best = s;
      }
    }
  }
  return best;
}

function vMaxFor(race, c) {
  const s = wrap(c.dist);
  const f = turnF(s);
  let v = V_TOP * c.pace;
  if (!c.isPlayer && !race.finishedAll) v *= 1 + 0.004 * Math.sin(race.t * c.wobF + c.wob);
  v *= 1 - INFO.scrub * f;                  // cornering scrub on the ovals (~222 mph in Indy's turns)
  v *= 1 + DRAFT_MAX * c.draft;
  const din = dIn(s), dout = dOut(s), road = INFO.kind === 'road';
  const kerb = road ? 1.0 : 0.3, grass = road ? 0.3 : 0.55;
  if (c.d < din - kerb) v *= c.d < din - apronIn(s) - kerb + 0.3 ? grass : 0.975; // apron / grass
  else if (c.d > dout + kerb) v *= c.d > dout + apronOut(s) + kerb ? grass : 0.975;
  if (c.finished) v *= 0.72;
  return v;
}

// Default input for a car that should drive itself along the racing line (used by tests, ?autopilot, finish cool-down).
export function autopilotInput(race, c, look = 0.45) {
  const s = wrap(c.dist);
  const tgt = lineAt(s + c.v * look);
  const latWanted = clamp((tgt - c.d) * 1.6, -6, 6);
  const psiMax = steerMax(c.v);
  const u = clamp(Math.asin(clamp(latWanted / Math.max(c.v, 5), -0.99, 0.99)) / psiMax, -1, 1);
  const brake = INFO.kind === 'road' && c.v > safeSpeedAt(s + c.v * 0.12) + 0.3 ? 1 : 0;
  return { steer: u, throttle: 1, brake };
}

// true when the car is carrying more speed than it can brake down from for what's coming (the HUD's BRAKE cue)
export function needBrake(c) { return INFO.kind === 'road' && c.v > safeSpeedAt(wrap(c.dist) + c.v * 0.25) + 1.5; }
// the same test looking a little further ahead: true `lead` seconds before the BRAKE cue lights (the coach's early call)
export function brakeSoon(c, lead) { return INFO.kind === 'road' && c.v > safeSpeedAt(wrap(c.dist) + c.v * (0.25 + lead)) + 1.5; }
// debugging / screenshots: spin the player now
export function forceSpin(race, dir = 1) { const c = race.player; if (!c.spin) startSpin(race, c, dir); }

export function steerMax(v) { return 0.068 + 0.26 * clamp(1 - v / 55, 0, 1); }

// Road-course handling. r = cornering demand / grip. Past 1 the car slides: it runs a little wide, scrubs speed and
// the tail steps out (a warning you can feel and see). A spin takes a big, sustained overshoot: the slip meter only
// fills past spinR and drains fast when you lift or brake, so catching a slide works and a missed brake zone doesn't.
export const HANDLING = { slideWide: 0.3, scrub: 0.6, scrubK: 1.5, scrubCap: 0.45, tcR: 0.99, falloff: 0.12, punt: 16, spinDecel: 11, spinDrag: 0.17, spinCarry: 0.75, spinR: 1.25, fill: 3.2, drain: 0.9, drainLift: 2.6, liftGrip: 1.08, assistFill: 0.7, liftFill: 0.45 };
const SPIN_TURN = 2 * Math.PI;

function startSpin(race, c, dir) {
  const T = clamp(1.6 + c.v / 30, 2.0, 3.2);
  c.spin = { t: 0, T, dir, y0: c.yaw || 0, v0: c.v };
  c.slip = 0;
  race.events.push({ type: 'spin', car: c.id, t: race.t, v: c.v, dir, s: wrap(c.dist) });
}
// One full, decaying rotation: the tail whips round, the rotation bleeds off and the car settles facing the right way,
// still rolling, sliding and scrubbing speed the whole time (no speed cap, no jump in position).
function stepSpin(race, c, dt, k, s) {
  const sp = c.spin; sp.t += dt;
  const x = Math.min(1, sp.t / sp.T), e = 1 - Math.pow(1 - x, 2.3);
  // the car carries on roughly where it was pointed: as the track bends away it drifts across, toward the outside
  c.psi = clamp(c.psi + k * c.v * dt * HANDLING.spinCarry - c.psi * dt * 0.7, -0.9, 0.9);
  // heading = psi + yaw ends exactly one turn round, pointing down the track
  const end = sp.dir * SPIN_TURN - c.psi;
  c.yaw = sp.y0 + (end - sp.y0) * e;
  c.yawRate = (end - sp.y0) * 2.3 * Math.pow(1 - x, 1.3) / sp.T;
  const off = c.d > dOut(s) + 1.0 || c.d < dIn(s) - 1.0;
  c.v = Math.max(0, c.v - (HANDLING.spinDecel + HANDLING.spinDrag * c.v + (off ? 5 : 0)) * dt);
  c.latV = c.v * Math.sin(c.psi);
  c.d += c.latV * dt;
  c.dist += c.v * Math.cos(c.psi) / (1 + k * c.d) * dt;
  c.skid = clamp(c.v / 25, 0.3, 1) * (1 - 0.6 * x * x);
  if (x >= 1) { c.spin = null; c.yaw = sp.dir * SPIN_TURN - c.psi - sp.dir * SPIN_TURN; c.yawRate = 0; c.recover = 1.4; race.events.push({ type: 'spinEnd', car: c.id, t: race.t }); }
}

function stepPlayer(race, c, dt, inp) {
  const s = wrap(c.dist), k = kappaAt(s), din = dIn(s), dout = dOut(s);
  const road = INFO.kind === 'road', H = HANDLING;
  if (c.yaw === undefined) { c.yaw = 0; c.slip = 0; c.recover = 0; c.spin = null; c.skid = 0; c.slipR = 0; }
  if (c.spin) { c.slide = 0; stepSpin(race, c, dt, k, s); walls(race, c, dt, s); return; }
  if (c.recover) c.recover = Math.max(0, c.recover - dt);
  const u = clamp(inp.steer || 0, -1, 1);
  const psiT = u * steerMax(c.v);
  c.psi += (psiT - c.psi) * (1 - Math.exp(-dt / 0.11));
  // longitudinal
  const vmax = vMaxFor(race, c);
  const thr = race.opts.autoThrottle ? (inp.brake ? 0 : 1) : (inp.throttle ? 1 : 0);
  const lifting = !!inp.brake || !thr;
  let grip = 0, demand = 0, r = 0;
  if (road) {
    grip = gripAt(c.v) * (lifting ? H.liftGrip : 1) * (c.recover ? 1.12 : 1);
    demand = Math.abs(k) * c.v * c.v; r = demand / grip;
  }
  let a;
  if (inp.brake) a = -brakeDecel(INFO, c.v);
  else if (thr) {
    a = ACC * (1 - (c.v / vmax) * (c.v / vmax)) * (c.v > vmax ? 0.8 : 1);
    if (c.recover && a > 0) a *= 0.55;                                            // smooth back on the power after a spin
    // traction control (auto throttle or assist): don't power the car past the grip it has mid-corner
    if (road && a > 0 && (race.opts.autoThrottle || race.opts.assist)) a *= clamp((H.tcR - r) / 0.08, 0, 1);
  }
  else a = -2.2 - 2.2 * (c.v / V_TOP) * (c.v / V_TOP);
  c.v = Math.max(0, c.v + a * dt);
  // lateral: steering, push (understeer) in the turns, light assist
  const push = k * c.v * c.v * 0.06;
  let lat = c.v * Math.sin(c.psi) + push;
  if (race.opts.assist) {
    const idle = 1 - Math.min(1, Math.abs(u) * 1.6);
    lat -= push * (0.5 + 0.25 * idle);
    lat += idle * clamp((lineAt(s + c.v * 0.5) - c.d) * 0.22, -0.6, 0.6);
    // keep off the wall (on the road course: off the grass) unless steering there on purpose
    const gw = road ? dout - 1.0 : dout - 1.0 - 1.8;
    if (c.d > gw && lat > 0) lat *= 1 - clamp((c.d - gw) / 1.8, 0, 1) * (u > 0.6 ? 0.3 : 0.9);
    const gi = road ? din + 1.0 : din - 4.2 + 1.0 + 1.5;
    if (c.d < gi && lat < 0) lat *= 1 - clamp((gi - c.d) / 1.5, 0, 1) * (u < -0.6 ? 0.3 : 0.9);
  }
  // too fast for the corner: the tyres let go, the car runs wide and scrubs speed; a big overshoot spins it
  c.slide = 0; c.skid = 0; c.slipR = r;
  let yawT = 0;
  if (road) {
    const excess = demand - grip * (1 - H.falloff * clamp((r - 1) / 0.5, 0, 1));   // gentle fall-off past the limit
    if (excess > 0) {
      lat += Math.sign(k) * excess * H.slideWide * (race.opts.assist ? 0.8 : 1);
      c.v = Math.max(0, c.v - Math.min(H.scrubCap * grip, excess * (H.scrub + H.scrubK * Math.min(1, r - 1))) * (lifting ? 1.3 : 1) * dt); c.slide = excess;
    }
    if (r > H.spinR && !c.recover) c.slip += dt * (r - H.spinR) * H.fill * (lifting ? H.liftFill : 1) * (race.opts.assist ? H.assistFill : 1);
    else c.slip = Math.max(0, c.slip - dt * (lifting ? H.drainLift : H.drain));
    if (c.slip >= 1) { startSpin(race, c, -Math.sign(k) || 1); c.latV = lat; c.d += lat * dt; c.dist += c.v * dt; walls(race, c, dt, s); return; }
    // the tail steps out as the slide grows (the renderer draws the heading as psi + yaw)
    if (r > 1.04) yawT = -Math.sign(k) * Math.min(0.34, (r - 1.04) * 0.8 + c.slip * 0.18);
    c.skid = clamp((r - 1.06) * 2.2 + c.slip * 0.6, 0, 1) * clamp(c.v / 20, 0, 1);
  }
  c.yaw += (yawT - c.yaw) * (1 - Math.exp(-dt / 0.14));
  c.latV = lat;
  c.d += lat * dt;
  c.dist += c.v * Math.cos(c.psi) / (1 + k * c.d) * dt;
  walls(race, c, dt, s);
}

function walls(race, c, dt, s) {
  const lim = wallOut(s) - CAR_W / 2 - 0.15;
  c.wall = Math.max(0, c.wall - dt);
  if (c.d > lim) {
    const impact = Math.max(0, c.latV);
    if (c.wallHit <= 0) { c.v *= 1 - Math.min(0.2, 0.015 + impact * 0.03); race.events.push({ type: 'wall', car: c.id, impact, t: race.t }); }
    c.v *= 1 - 0.12 * dt;       // grinding along the SAFER barrier scrubs speed
    c.d = lim; c.psi = -Math.abs(c.psi) * 0.35; c.latV = 0; c.wall = 0.25; c.wallHit = 0.35;
  }
  const ilim = wallIn(s) + CAR_W / 2 + 0.15; // inside wall
  if (c.d < ilim) {
    const impact = Math.max(0, -c.latV);
    if (c.wallHit <= 0) { c.v *= 1 - Math.min(0.2, 0.015 + impact * 0.03); race.events.push({ type: 'wall', car: c.id, impact, t: race.t, inside: true }); }
    c.v *= 1 - 0.12 * dt;
    c.d = ilim; c.psi = Math.abs(c.psi) * 0.35; c.latV = 0; c.wall = 0.25; c.wallHit = 0.35;
  }
  if (c.wall <= 0) c.wallHit = Math.max(0, c.wallHit - dt);
  c.onApron = c.d < dIn(s) - 0.3;
}

function laneFree(race, c, target, ahead) {
  for (const o of race.cars) {
    if (o === c || o === ahead) continue;
    const g = wrap(o.dist - c.dist + 20) - 20; // -20..L-20
    if (g > -9 && g < 28 && Math.abs(o.d - target) < 2.3) return false;
  }
  return true;
}

function thinkAI(race, c) {
  const s = wrap(c.dist), din = dIn(s), dout = dOut(s);
  let target = lineAt(s + c.v * 0.6);
  // car ahead in my lane?
  let ahead = null, ag = 1e9;
  for (const o of race.cars) {
    if (o === c) continue;
    const g = gapAhead(c, o);
    if (g > 0 && g < 55 && Math.abs(o.d - c.d) < 2.4 && g < ag) { ahead = o; ag = g; }
  }
  if (c.passTimer > 0 && c.passTarget >= 0) {
    const o = race.cars[c.passTarget];
    const g = wrap(o.dist - c.dist + 30) - 30;
    if (g < -9) { c.passTimer = 0; c.passTarget = -1; }
    else target = clamp(o.d + c.passSide * 3.1, din + 1.1, dout - 1.2);
  } else if (ahead && (c.v > ahead.v + 0.4 || ag < 18)) {
    const opts = [];
    for (const side of [-1, 1]) {
      const t = ahead.d + side * 3.1;
      if (t < din + 1.0 || t > dout - 1.2) continue;
      if (laneFree(race, c, t, ahead)) opts.push(side);
    }
    if (opts.length) {
      let side = opts[0];
      if (opts.length === 2) side = (turnF(s + 150) > 0.2 || c.aggr > 0.65) ? -1 : 1;
      c.passSide = side; c.passTarget = ahead.id; c.passTimer = 5;
      target = ahead.d + side * 3.1;
    } else target = ahead.d; // sit in the draft
  }
  // side-by-side: never squeeze a car alongside
  c.sideNear = 0;
  for (const o of race.cars) {
    if (o === c) continue;
    const g = wrap(o.dist - c.dist + 30) - 30;
    if (Math.abs(g) < 6.5) {
      const dd = c.d - o.d;
      if (Math.abs(dd) < 3.0) {
        const side = dd >= 0 ? 1 : -1;
        const keep = o.d + side * 2.6;
        if (side > 0) target = Math.max(target, keep); else target = Math.min(target, keep);
        c.sideNear = side;
      }
    }
  }
  c.tgtD = clamp(target, din - 0.2, dout - 1.15);
  c.ahead = ahead ? ahead.id : -1; c.aheadGap = ag;
}

function stepAI(race, c, dt) {
  const s = wrap(c.dist), k = kappaAt(s);
  c.thinkT -= dt; c.passTimer = Math.max(0, c.passTimer - dt);
  if (c.thinkT <= 0) { thinkAI(race, c); c.thinkT = 0.1; }
  const vmax = vMaxFor(race, c);
  let a = ACC * (1 - (c.v / vmax) * (c.v / vmax)) * (c.v > vmax ? 0.8 : 1);
  // road course: brake for the corner coming up (the profile already holds the braking distance)
  if (INFO.kind === 'road') {
    const vp = profAt(s + c.v * 0.08) * (0.985 + 0.5 * (c.pace - 1)) * (1 + 0.02 * c.draft);
    if (c.v > vp) a = Math.min(a, -brakeDecel(INFO, c.v) * clamp((c.v - vp) / 1.5, 0.2, 1));
  }
  // don't rear-end the car ahead when boxed in
  if (c.ahead >= 0) {
    const o = race.cars[c.ahead]; const g = gapAhead(c, o);
    if (Math.abs(o.d - c.d) < 2.0 && g < 9 && c.v > o.v) a = Math.min(a, -((c.v - o.v) * (c.v - o.v)) / Math.max(1, 2 * (g - 5.5)) - 1);
  }
  c.v = Math.max(0, c.v + a * dt);
  const latMax = 3.6;
  const want = clamp((c.tgtD - c.d) * 1.4, -latMax, latMax);
  c.latV += clamp(want - c.latV, -10 * dt, 10 * dt);
  c.psi = Math.asin(clamp(c.latV / Math.max(c.v, 5), -0.5, 0.5));
  c.d += c.latV * dt;
  c.dist += c.v * Math.cos(c.psi) / (1 + k * c.d) * dt;
  walls(race, c, dt, s);
}

function contacts(race) {
  const cs = race.cars;
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const a = cs[i], b = cs[j];
    let g = wrap(b.dist - a.dist); if (g > L / 2) g -= L; // b ahead of a by g
    if (Math.abs(g) >= CAR_LEN) continue;
    const dd = b.d - a.d;
    if (Math.abs(dd) >= CAR_W) continue;
    const front = g >= 0 ? b : a, rear = g >= 0 ? a : b;
    const latOverlap = CAR_W - Math.abs(dd), lonOverlap = CAR_LEN - Math.abs(g);
    if (latOverlap > 1.3 * lonOverlap / CAR_LEN * CAR_W || Math.abs(dd) < 0.6) {
      // nose-to-tail: rear car is pushed back and matched to the front car's speed
      rear.dist -= lonOverlap;
      if (rear.v > front.v) {
        const dv = rear.v - front.v;
        // a big hit from behind on the road course spins the player round instead of using the car ahead as a brake
        if (rear.isPlayer && !rear.spin && INFO.kind === 'road' && dv > HANDLING.punt && race.phase === 'green') { rear.v = front.v + dv * 0.25; front.v += dv * 0.15; rear.yaw = rear.yaw || 0; startSpin(race, rear, dd >= 0 ? -1 : 1); }
        else { rear.v = front.v - 0.3; front.v += dv * 0.15; }
      }
      if (rear.isPlayer || front.isPlayer) race.events.push({ type: 'bump', t: race.t });
    } else {
      // side contact: shove apart, small scrub
      const push = latOverlap / 2 + 0.02, sgn = dd >= 0 ? 1 : -1;
      a.d -= sgn * push; b.d += sgn * push; a.v *= 1 - 0.04 / 120; b.v *= 1 - 0.04 / 120;
      if (a.isPlayer || b.isPlayer) race.events.push({ type: 'rub', t: race.t });
    }
  }
}

function stepPace(race, dt) {
  // the field rolls in formation behind the pace car; the pace car ducks off the racing line to the pits
  const PV = INFO.paceV;
  const lead = race.leaderDistStart + (race.t * PV);
  race.paceLeader = lead;
  for (const c of race.cars) {
    c.dist = lead - c.row * ROW_GAP; c.v = PV;
    const sw = Math.sin(race.t * 1.3 + c.id) * 0.15; c.d = c.slotD + sw; c.psi = 0;
  }
  const p = race.pace, t0 = INFO.paceOut * 0.43; p.dist = lead + 45 + Math.max(0, race.t - t0) * 3;
  if (race.t > t0) { p.d = INFO.paceSide * Math.min(16, (race.t - t0) * 2.4); p.out = race.t > INFO.paceOut; }
  if (lead >= race.greenAt) {
    race.phase = 'green'; race.raceT = 0; race.events.push({ type: 'green', t: race.t }); p.out = true;
    for (const c of race.cars) { c.tgtD = c.d; c.passTimer = 0; }
  }
}

function lapBook(race, c, prevDist) {
  if (prevDist < S_LINE && c.dist >= S_LINE) { c.lapStart = race.raceT; return; }
  if (prevDist < S_LINE) return;
  const lp = Math.floor((prevDist - S_LINE) / L), ln = Math.floor((c.dist - S_LINE) / L);
  if (ln > lp) {
    c.laps = ln;
    if (c.lapStart !== null) { c.lastLap = race.raceT - c.lapStart; if (!c.bestLap || c.lastLap < c.bestLap) c.bestLap = c.lastLap; }
    c.lapStart = race.raceT;
    if (!c.finished && ln >= race.opts.laps) {
      c.finished = true; c.finishTime = race.raceT; c.finishPos = ++race.finishers;
      race.events.push({ type: 'finish', car: c.id, pos: c.finishPos, t: race.t });
      if (c.isPlayer) race.playerFinished = true;
    } else if (c.isPlayer) race.events.push({ type: 'lap', lap: ln, time: c.lastLap, t: race.t });
  }
}

export function stepRace(race, dt, input = {}) {
  const H = 1 / 120;
  let left = Math.min(dt, 0.1);
  while (left > 1e-6) {
    const h = Math.min(H, left); left -= h;
    race.t += h;
    if (race.phase === 'pace') { stepPace(race, h); continue; }
    race.raceT += h;
    for (const c of race.cars) c.draft += (computeDraftCached(race, c) - c.draft) * (1 - Math.exp(-h / 0.35));
    for (const c of race.cars) {
      const prev = c.dist;
      if (c.isPlayer && !c.finished && !race.autopilot) stepPlayer(race, c, h, input);
      else if (c.isPlayer) stepPlayer(race, c, h, autopilotInput(race, c));
      else stepAI(race, c, h);
      lapBook(race, c, prev);
    }
    contacts(race);
  }
}
// draft is cheap but O(n^2); refresh it at 30 Hz
function computeDraftCached(race, c) {
  if (!c._dt || race.t - c._dt > 1 / 30) { c._dv = computeDraft(race, c); c._dt = race.t; }
  return c._dv;
}
