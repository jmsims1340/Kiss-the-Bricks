// Kiss the Bricks — Daily Challenge: one seeded race a day, the same for everyone.
// The day is the America/New_York date (YYYYMMDD); the seed is that date, so every phone builds the same
// track, laps, grid, opponents, time of day, wind and grip. The score is the best lap of the run, in seconds
// (lower is better), exactly like the main per-track boards; it posts to board "daily-YYYYMMDD".
// Pure module (no DOM): the tests import it in Node.

export const TZ = 'America/New_York';

// YYYYMMDD in New York for a given instant
export function nyDateKey(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const v = (t) => p.find((x) => x.type === t).value;
  return v('year') + v('month') + v('day');
}
export const validKey = (k) => typeof k === 'string' && /^\d{8}$/.test(k) && !isNaN(keyDate(k));
// noon UTC of that calendar day (only used for weekday / month names and day arithmetic)
export function keyDate(k) { return Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), 12); }
export function shiftKey(k, days) {
  const d = new Date(keyDate(k) + days * 86400000);
  return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
}
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function keyLabel(k) { const d = new Date(keyDate(k)); return WD[d.getUTCDay()] + ', ' + MO[d.getUTCMonth()] + ' ' + d.getUTCDate(); }

// milliseconds until the next New York midnight (when the next challenge unlocks)
export function msToNext(now = Date.now()) {
  const k = nyDateKey(new Date(now));
  // binary-search the instant the NY date flips (DST-proof, no tz maths)
  let lo = now, hi = now + 26 * 3600000;
  while (nyDateKey(new Date(hi)) === k) hi += 3600000;
  while (hi - lo > 1000) { const m = Math.floor((lo + hi) / 2); if (nyDateKey(new Date(m)) === k) lo = m; else hi = m; }
  return hi - now;
}
export function fmtCountdown(ms) {
  const m = Math.max(0, Math.ceil(ms / 60000)), h = Math.floor(m / 60), mm = m % 60;
  return h ? h + 'h ' + String(mm).padStart(2, '0') + 'm' : mm + 'm';
}

// small seeded PRNG (mulberry32) from the date key
function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function seedOf(k, salt) { let h = 2166136261 ^ salt; for (const ch of 'ktb-daily-' + k) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const pick = (R, arr) => arr[Math.floor(R() * arr.length) % arr.length];

export const TRACKS = ['indy', 'texas', 'road'];
const TRACK_NAME = { indy: 'Indianapolis Oval', texas: 'Texas Motor Speedway', road: 'Indy Road Course' };
const LAPS = { indy: [4, 5, 6], texas: [6, 8, 10], road: [3, 4] };
// time of day is a look (sky, sun, light); grip and wind change the car
export const LOOKS = { day: 'Midday sun', golden: 'Golden hour', overcast: 'Overcast' };
const GRIPS = [
  { g: 0.95, name: 'Green track', words: 'green track, low grip' },
  { g: 1.0, name: 'Normal grip', words: 'normal grip' },
  { g: 1.0, name: 'Normal grip', words: 'normal grip' },
  { g: 1.03, name: 'Rubbered in', words: 'rubbered-in track, extra grip' },
];
function rawTrack(k) { return TRACKS[Math.floor(rng(seedOf(k, 1))() * 3) % 3]; }
// the track never repeats two days running: walk the chain from a fixed anchor day (cheap, and the same everywhere)
const ANCHOR = '20261001', memo = new Map();
export function trackOn(k) {
  if (k <= ANCHOR) return rawTrack(k);
  if (memo.has(k)) return memo.get(k);
  let prev = rawTrack(ANCHOR), d = ANCHOR;
  while (d < k) {
    d = shiftKey(d, 1);
    let t = memo.get(d);
    if (!t) { t = rawTrack(d); if (t === prev) { const alt = TRACKS.filter((x) => x !== prev); t = alt[Math.floor(rng(seedOf(d, 2))() * 2) % 2]; } memo.set(d, t); }
    prev = t;
  }
  return prev;
}

// The day's challenge. Never changes for a given key.
export function dailySpec(k) {
  if (!validKey(k)) k = nyDateKey();
  const track = trackOn(k);
  const R = rng(seedOf(k, 3));
  const tt = R() < 0.25;                                   // about one day in four: time trial, just you and the clock
  const laps = pick(R, LAPS[track]);
  const field = pick(R, [22, 33, 33]);
  const grid = tt ? 1 : Math.min(field, 4 + Math.floor(R() * (field - 3)));
  const difficulty = pick(R, ['rookie', 'pro', 'pro', 'veteran']);
  const look = pick(R, ['day', 'day', 'golden', 'overcast']);
  let gi = Math.floor(R() * GRIPS.length) % GRIPS.length;
  if (look === 'overcast' && gi === 0) gi = 1;            // a cool, cloudy day doesn't leave a slippery green track
  const grip = GRIPS[gi];
  // wind: speed in mph and where it blows relative to the front stretch (0° = tailwind down the front stretch,
  // 180° = headwind). Gusts make it rise and fall.
  const windMph = Math.round(4 + R() * 16);
  const wr = R(), wo = (R() - 0.5) * 70;                     // mostly up or down the front stretch, sometimes across
  const windDeg = Math.round(((wr < 0.36 ? 180 : wr < 0.72 ? 0 : (R() < 0.5 ? 90 : 270)) + wo + 360) % 360);
  const gust = Math.round((0.15 + R() * 0.35) * 100) / 100;
  const cond = { grip: grip.g, windMph, windDeg, gust };
  const spec = { key: k, label: keyLabel(k), track, trackName: TRACK_NAME[track], mode: tt ? 'tt' : 'race', laps, field: tt ? 2 : field, grid,
    difficulty, look, lookName: LOOKS[look], gripName: grip.name, gripWords: grip.words, cond };
  spec.windWords = windWords(windMph, windDeg, track);
  spec.title = TRACK_NAME[track] + ' · ' + laps + ' laps';
  spec.setup = tt ? 'Time trial · just you and the clock' : 'Start P' + grid + ' of ' + field + ' · ' + cap(difficulty) + ' field';
  spec.conds = LOOKS[look] + ' · ' + spec.windWords + ' · ' + grip.words;
  spec.desc = spec.title + '. ' + spec.setup + '. ' + cap(spec.conds) + '. Best lap counts.';
  return spec;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export function windWords(mph, deg, track) {
  const a = ((deg % 360) + 360) % 360, where = track === 'road' ? 'down the front straight' : 'down the front stretch';
  const g = mph >= 14 ? 'gusty ' : '';
  if (a <= 40 || a >= 320) return mph + ' mph ' + g + 'tailwind ' + where;
  if (a >= 140 && a <= 220) return mph + ' mph ' + g + 'headwind ' + where;
  return mph + ' mph ' + g + 'crosswind';
}
