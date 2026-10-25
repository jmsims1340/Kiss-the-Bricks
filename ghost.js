// Kiss the Bricks — ghost car: records the player's laps and replays the best one per track.
// A lap is stored as fixed-rate samples (15 Hz) of lap distance (dm, delta-coded), lateral offset (cm) and heading
// (mrad), all relative to the start/finish line, so a 40 s Indy lap is ~600 samples / a few KB in localStorage.
export const HZ = 15;
const KEY = (id) => 'ktb-ghost-' + id;

export function loadGhost(id) {
  try {
    const g = JSON.parse(localStorage.getItem(KEY(id)) || 'null');
    if (!g || g.v !== 1 || !g.t || !g.s || g.s.length < 4) return null;
    const n = g.s.length, s = new Float32Array(n), d = new Float32Array(n), h = new Float32Array(n);
    let acc = 0; for (let i = 0; i < n; i++) { acc += g.s[i]; s[i] = acc / 10; d[i] = g.d[i] / 100; h[i] = g.h[i] / 1000; }
    // lap distance as a non-decreasing function, for the time-at-distance lookup (live delta)
    const sm = new Float32Array(n); let m = -1e9; for (let i = 0; i < n; i++) { m = Math.max(m, s[i]); sm[i] = m; }
    return { t: g.t, n, s, d, h, sm, when: g.when || 0 };
  } catch (e) { return null; }
}
function saveGhost(id, lap) {
  const n = lap.s.length, S = new Array(n), D = new Array(n), H = new Array(n); let prev = 0;
  for (let i = 0; i < n; i++) { const q = Math.round(lap.s[i] * 10); S[i] = q - prev; prev = q; D[i] = Math.round(lap.d[i] * 100); H[i] = Math.round(lap.h[i] * 1000); }
  try { localStorage.setItem(KEY(id), JSON.stringify({ v: 1, t: +lap.t.toFixed(3), when: Date.now(), s: S, d: D, h: H })); return true; } catch (e) { return false; }
}
export function clearGhost(id) { try { localStorage.removeItem(KEY(id)); } catch (e) {} }

// pose of the ghost at lap time t: { s, d, h } or null once its lap is over
export function ghostAt(g, t, out) {
  if (!g || t < 0 || t > g.t) return null;
  const u = t * HZ, i = Math.min(g.n - 2, Math.floor(u)), f = Math.min(1, u - i);
  out.s = g.s[i] + (g.s[i + 1] - g.s[i]) * f; out.d = g.d[i] + (g.d[i + 1] - g.d[i]) * f;
  let dh = g.h[i + 1] - g.h[i]; if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI;
  out.h = g.h[i] + dh * f; return out;
}
// ghost's lap time at lap distance s (for the live gap); null before the line / after its lap
export function ghostTimeAt(g, s) {
  if (!g || s <= 0) return null;
  const a = g.sm; if (s >= a[g.n - 1]) return null;
  let lo = 0, hi = g.n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= s) lo = m; else hi = m; }
  const f = a[hi] > a[lo] ? (s - a[lo]) / (a[hi] - a[lo]) : 0;
  return (lo + f) / HZ;
}

// recorder: feed it the player's state once per frame (lap time t, lap distance s, d, heading h)
export function createRecorder() {
  return { cur: null, prev: null };
}
export function recStart(rec, t, s, d, h) { rec.cur = { s: [], d: [], h: [], k: 0 }; rec.prev = { t, s, d, h }; push(rec, t, s, d, h); }
function push(rec, t, s, d, h) {
  const c = rec.cur, p = rec.prev; if (!c) return;
  // resample onto the fixed 1/HZ grid between the previous frame and this one
  while (c.k / HZ <= t + 1e-9) {
    const tk = c.k / HZ, span = t - p.t, f = span > 1e-6 ? Math.max(0, Math.min(1, (tk - p.t) / span)) : 1;
    let dh = h - p.h; if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI;
    c.s.push(p.s + (s - p.s) * f); c.d.push(p.d + (d - p.d) * f); c.h.push(p.h + dh * f); c.k++;
    if (c.k > HZ * 600) { rec.cur = null; return; } // ten minutes: give up on this lap
  }
  rec.prev = { t, s, d, h };
}
export function recFrame(rec, t, s, d, h) { if (rec.cur) push(rec, t, s, d, h); }
// close the lap at its exact time; returns the finished lap or null
export function recEnd(rec, lapT, endS, d, h) {
  if (!rec.cur) return null;
  push(rec, lapT, endS, d, h);
  const c = rec.cur; rec.cur = null;
  // one extra sample past the line keeps the interpolation valid right up to lapT
  c.s.push(endS + 1); c.d.push(d); c.h.push(h);
  return c.s.length > HZ * 5 ? { t: lapT, s: c.s, d: c.d, h: c.h } : null;
}
// keep the lap if it beats the stored ghost (or there is none); returns the new ghost or null
export function offerLap(id, lap, current) {
  if (!lap) return null;
  if (current && current.t <= lap.t) return null;
  saveGhost(id, lap);
  return loadGhost(id);
}
