import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, '..');
const S = await import(path.join(site, 'sim.js'));
const html = readFileSync(path.join(site, 'index.html'), 'utf8');

test('page shell: title, phone viewport, home-screen tags, external module script', () => {
  assert.match(html, /<title>Kiss the Bricks<\/title>/);
  assert.match(html, /name="viewport"[^>]*width=device-width[^>]*viewport-fit=cover/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /rel="apple-touch-icon" href="apple-touch-icon.png"/);
  assert.match(html, /<script type="module" src="game.js(\?v=\w+)?"><\/script>/);
  assert.doesNotMatch(html, /<script>(?!<)/, 'no inline scripts');
  assert.doesNotMatch(html + readFileSync(path.join(site, 'game.js'), 'utf8'), /lorem ipsum|TODO|FIXME|placeholder/i);
});

test('every local asset referenced exists and the theme is a phone-playable m4a', () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1].replace(/\?v=\w+$/, ''));
  const game = readFileSync(path.join(site, 'game.js'), 'utf8');
  for (const m of game.matchAll(/from '\.\/([^']+)'/g)) refs.push(m[1]);
  assert.ok(refs.includes('title.jpg') && refs.includes('theme.m4a') && refs.includes('three.module.min.js'));
  for (const r of refs) assert.ok(existsSync(path.join(site, r)), 'missing ' + r);
  assert.ok(statSync(path.join(site, 'theme.m4a')).size > 100000);
  assert.doesNotMatch(game, /https?:\/\//, 'no remote assets at runtime');
});

test('track is the real Indianapolis layout', () => {
  assert.ok(Math.abs(S.L - 2.5 * 1609.344) < 1, 'lap is 2.5 miles');
  const kinds = S.SEGS.map((s) => s[0]).join('');
  assert.equal(kinds, 'STCTSTCT');
  assert.ok(Math.abs(S.LS - 1005.84) < 0.1 && Math.abs(S.LC - 201.168) < 0.1 && Math.abs(S.LT - 402.336) < 0.1);
  assert.ok(Math.abs(S.BANK * 180 / Math.PI - 9.2) < 0.5, 'turns banked ~9 degrees');
  // the track closes on itself
  const a = S.surface(0, 0), b = S.surface(S.L - 0.01, 0);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.5);
  assert.ok(S.segmentName(S.S_LINE) === 'Front stretch', 'bricks on the front stretch');
});

function runRace(opts, driver, maxT = 400) {
  const r = S.createRace(opts); let t = 0, walls = 0, greenSeen = false; const laps = [];
  const startD = r.cars.map((c) => c.d); let maxLat = 0;
  while (!r.playerFinished && t < maxT) {
    S.stepRace(r, 1 / 60, driver(r, t)); t += 1 / 60;
    for (const e of r.events) { if (e.type === 'wall' && e.car === r.player.id) walls++; if (e.type === 'green') greenSeen = true; if (e.type === 'lap') laps.push(e); }
    r.events.length = 0;
    for (const c of r.cars) if (!c.isPlayer) maxLat = Math.max(maxLat, Math.abs(c.d - startD[c.id]));
  }
  return { r, t, walls, greenSeen, laps, maxLat };
}

test('rolling start goes green, laps count, race finishes, AI moves and racing changes positions', () => {
  const { r, greenSeen, laps, maxLat } = runRace({ laps: 3, seed: 5, difficulty: 'pro' }, (r) => S.autopilotInput(r, r.player));
  assert.ok(greenSeen, 'green flag');
  assert.ok(r.playerFinished, 'player finished');
  assert.equal(laps.length, 2, 'two lap events before the finish of a 3-lap race');
  assert.equal(S.lapOf(r.player), 4);
  assert.ok(r.player.bestLap > 36 && r.player.bestLap < 44, 'lap time ~40 s: ' + r.player.bestLap);
  assert.ok(maxLat > 3, 'AI change lanes');
  const moved = S.standings(r).filter((c, i) => Math.abs(i + 1 - c.grid) >= 2).length;
  assert.ok(moved > 10, 'positions change: ' + moved);
  assert.equal(r.cars.length, 33);
});

test('speeds read like Indy: ~230 mph flat out, faster in the draft', () => {
  const r = S.createRace({ laps: 2, field: 2, grid: 1, seed: 1 });
  r.phase = 'green';
  const p = r.player, o = r.cars[1];
  // alone on the back stretch
  o.dist = p.dist + 2000; p.dist = 2100; p.v = 60; p.d = 4;
  let vmax = 0; for (let i = 0; i < 60 * 20; i++) { S.stepRace(r, 1 / 60, { steer: 0 }); if (S.turnF(p.dist) < 0.01) vmax = Math.max(vmax, p.v); }
  const clean = vmax * S.MPH;
  assert.ok(clean > 222 && clean < 238, 'clean air top speed ' + clean);
  // tucked 15 m behind a car at the same speed
  const r2 = S.createRace({ laps: 2, field: 2, grid: 2, seed: 1 }); r2.phase = 'green';
  const p2 = r2.player, lead = r2.cars[0];
  lead.dist = 2100; p2.dist = 2085; lead.d = p2.d = 4.9; lead.v = p2.v = 100; lead.pace = 1;
  for (let i = 0; i < 60 * 4; i++) S.stepRace(r2, 1 / 60, { steer: 0 });
  assert.ok(p2.draft > 0.3, 'draft builds behind a car: ' + p2.draft);
  assert.ok(p2.dist - 2085 > lead.dist - 2100 + 1, 'the drafting car gains on the leader');
});

test('hitting the wall scrubs speed but never stops the car', () => {
  const r = S.createRace({ laps: 2, field: 2, grid: 1, seed: 1, assist: false }); r.phase = 'green';
  const p = r.player; r.cars[1].dist = 3000; p.dist = 2200; p.v = 100; p.d = 0;
  let hit = false, vmin = 1e9;
  for (let i = 0; i < 60 * 3; i++) { S.stepRace(r, 1 / 60, { steer: 1 }); for (const e of r.events) if (e.type === 'wall') hit = true; r.events.length = 0; vmin = Math.min(vmin, p.v); }
  assert.ok(hit, 'reached the wall');
  assert.ok(vmin > 70, 'still rolling at ' + vmin * S.MPH + ' mph');
  assert.ok(p.d <= S.dOut(p.dist) - 0.9, 'kept on the track side of the wall');
});

test('a sloppy casual driver gets laps in; hands-off with assist stays off the wall', () => {
  let rnd = 7, noise = 0; const R = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  const casual = runRace({ laps: 2, seed: 9, difficulty: 'rookie' }, (r) => { if (R() < 0.02) noise = (R() - 0.5) * 1.6; noise *= 0.995; const a = S.autopilotInput(r, r.player, 0.2); return { steer: Math.max(-1, Math.min(1, a.steer * 0.6 + noise)) }; });
  assert.ok(casual.r.playerFinished, 'casual driver finishes');
  assert.ok(casual.walls <= 4, 'few wall touches: ' + casual.walls);
  const idle = runRace({ laps: 2, seed: 4, difficulty: 'rookie' }, () => ({ steer: 0 }));
  assert.ok(idle.r.playerFinished && idle.walls <= 1, 'hands off: walls ' + idle.walls);
});


// ---------------- the extra tracks ----------------
const game = readFileSync(path.join(site, 'game.js'), 'utf8');

test('three tracks with real lengths, closed loops, and a track select screen', () => {
  assert.deepEqual(S.TRACK_IDS, ['indy', 'texas', 'road']);
  assert.equal(S.TRACK_INFO.texas.lenMi, 1.5); assert.equal(S.TRACK_INFO.road.lenMi, 2.439); assert.equal(S.TRACK_INFO.road.turns, 14);
  assert.match(html, /id="tracks"/); assert.match(html, /id="trackList"/);
  assert.match(game, /ktb-best/, 'best laps saved per track');
  for (const id of S.TRACK_IDS) {
    const T = S.TRACKS[id];
    let turn = 0; for (let i = 0; i < T.n; i++) turn += T.K[i] * T.DS;
    assert.ok(Math.abs(Math.abs(turn) - 2 * Math.PI) < 0.05, id + ' closes on itself, total turning ' + turn);
    assert.ok(Math.hypot(T.X[0] - T.X[T.n - 1], T.Z[0] - T.Z[T.n - 1]) < T.DS * 1.5, id + ' last sample meets the first');
  }
  const tx = S.TRACKS.texas; assert.ok(Math.abs(tx.L - 1.5 * 1609.344) < 1, 'Texas is a 1.5 mile lap');
  assert.ok(Math.max(...tx.B) * 180 / Math.PI > 23, 'Texas turns banked ~24 degrees');
  let kTex = 0; for (let i = 0; i < tx.n; i++) if (tx.K[i] > 0) kTex += tx.K[i] * tx.DS;
  assert.ok(kTex > 6, 'Texas is all left turns');
  const rc = S.TRACKS.road; let minR = 1e9, rights = 0;
  for (let i = 0; i < rc.n; i++) { minR = Math.min(minR, 1 / Math.abs(rc.K[i] || 1e-9)); if (rc.K[i] < 0) rights++; }
  assert.ok(minR > 15 && minR < 40, 'road course has tight corners: min radius ' + minR);
  assert.ok(rights > rc.n * 0.3, 'road course runs clockwise with right-handers');
  // the road course runs on the oval's front stretch, through the yard of bricks
  const a = S.surfaceOn(rc, rc.sLine, 0), O = S.TRACKS.indy;
  let best = 1e9; for (let i = 0; i < O.n; i++) best = Math.min(best, Math.hypot(O.X[i] - a.x, O.Z[i] - a.z));
  assert.ok(best < 1, 'road course start/finish sits on the oval front stretch: ' + best);
});

function raceOn(track, laps, driver, maxT = 600) {
  const r = S.createRace({ track, laps, seed: 11, difficulty: 'pro', field: 22 }); let t = 0, walls = 0, spins = 0, off = 0; const lapsSeen = [];
  while (!r.playerFinished && t < maxT) {
    S.stepRace(r, 1 / 60, driver(r)); t += 1 / 60;
    const p = r.player, s = S.wrap(p.dist);
    if (r.phase === 'green' && (p.d < S.dIn(s) - 1 || p.d > S.dOut(s) + 1)) off += 1 / 60;
    for (const e of r.events) { if (e.type === 'wall' && e.car === p.id) walls++; if (e.type === 'spin' && e.car === p.id) spins++; if (e.type === 'lap') lapsSeen.push(e.time); }
    r.events.length = 0;
  }
  return { r, walls, spins, off, lapsSeen };
}

test('Texas: laps count, ~24 s laps that are faster and tighter than Indy', () => {
  const { r, walls, off, lapsSeen } = raceOn('texas', 3, (r) => S.autopilotInput(r, r.player));
  assert.ok(r.playerFinished); assert.equal(lapsSeen.length, 2); assert.equal(walls, 0); assert.ok(off < 0.5);
  assert.ok(r.player.bestLap > 21 && r.player.bestLap < 27, 'Texas lap ' + r.player.bestLap);
  S.setTrack('indy');
});

test('Indy road course: laps count, braking matters, and skipping the brakes costs time', () => {
  const good = raceOn('road', 2, (r) => S.autopilotInput(r, r.player));
  assert.ok(good.r.playerFinished); assert.equal(good.lapsSeen.length, 1);
  assert.equal(good.walls, 0, 'clean laps stay off the walls'); assert.ok(good.off < 0.5, 'clean laps stay on the asphalt'); assert.equal(good.spins, 0);
  assert.ok(good.r.player.bestLap > 64 && good.r.player.bestLap < 80, 'road course lap ' + good.r.player.bestLap);
  const aiBest = Math.min(...good.r.cars.filter((c) => !c.isPlayer && c.bestLap).map((c) => c.bestLap));
  assert.ok(aiBest > 64 && aiBest < 80, 'AI brake for the corners and lap in ' + aiBest);
  const reckless = raceOn('road', 2, (r) => { const a = S.autopilotInput(r, r.player); a.brake = 0; return a; });
  assert.ok(reckless.spins > 0, 'flat out into the corners spins the car');
  assert.ok(reckless.r.player.bestLap > good.r.player.bestLap + 4, 'no brakes is slower: ' + reckless.r.player.bestLap);
  S.setTrack('indy');
});

test('road course handling: a late braker is forgiven, the spin is one smooth decaying turn, and the car comes back', () => {
  // a human-ish driver: sees the BRAKE cue 0.4 s late and lets go as soon as it goes out
  let since = -1, t = 0;
  const late = (r) => { t += 1 / 60; const p = r.player, cue = r.phase === 'green' && S.needBrake(p); if (cue && since < 0) since = t; if (!cue) since = -1; const a = S.autopilotInput(r, p); a.brake = cue && t - since > 0.4 ? 1 : 0; return a; };
  const L2 = S.createRace({ track: 'road', laps: 2, seed: 4, field: 2, grid: 1 }); let spins = 0, tt = 0;
  while (!L2.playerFinished && tt < 400) { S.stepRace(L2, 1 / 60, late(L2)); tt += 1 / 60; for (const e of L2.events) if (e.type === 'spin' && e.car === L2.player.id) spins++; L2.events.length = 0; }
  assert.ok(L2.playerFinished); assert.equal(spins, 0, 'braking 0.4 s late should slide, not spin');
  // a spin: no jumps in position, heading or speed; one full turn; the car ends pointing down the track and drives on
  const r = S.createRace({ track: 'road', laps: 3, seed: 2, field: 2, grid: 1 });
  while (r.raceT < 4) S.stepRace(r, 1 / 60, S.autopilotInput(r, r.player));
  const p = r.player; S.forceSpin(r, 1);
  let prev = { dist: p.dist, d: p.d, h: p.psi + p.yaw, v: p.v }, n = 0, maxJump = 0, maxTurn = 0, maxDv = 0, total = 0;
  while (p.spin && n < 600) {
    S.stepRace(r, 1 / 60, { steer: 0, brake: 0 }); n++;
    const h = p.psi + p.yaw;
    maxJump = Math.max(maxJump, Math.hypot(p.dist - prev.dist, p.d - prev.d) * 60 - prev.v);
    let dh = h - prev.h; dh -= Math.round(dh / (2 * Math.PI)) * 2 * Math.PI; // the same heading, one turn apart, is no jump
    maxTurn = Math.max(maxTurn, Math.abs(dh)); total += dh; maxDv = Math.max(maxDv, prev.v - p.v);
    prev = { dist: p.dist, d: p.d, h, v: p.v };
  }
  assert.ok(n > 100 && n < 220, 'spin lasts ~2-3.5 s: ' + n);
  assert.ok(Math.abs(Math.abs(total) - 2 * Math.PI) < 0.35, 'about one full turn: ' + total);
  assert.ok(maxTurn < 0.2, 'no heading snap per frame: ' + maxTurn);
  assert.ok(maxDv < 0.5, 'speed bleeds off, no sudden cut: ' + maxDv);
  assert.ok(maxJump < 2, 'no teleport: ' + maxJump);
  assert.ok(Math.abs(p.yaw) < 0.9, 'ends pointing roughly down the track');
  const d0 = p.dist; for (let i = 0; i < 300; i++) S.stepRace(r, 1 / 60, S.autopilotInput(r, p));
  assert.ok(p.dist - d0 > 40 && !p.spin, 'drives away afterwards');
  S.setTrack('indy');
});

test('coach and yellow-flag start are wired into the page', () => {
  assert.match(html, /id="coach"/); assert.match(html, /data-key="coach"/); assert.match(html, /data-key="coachVoice"/);
  assert.match(html, /id="flagbar"/); assert.match(html, /YELLOW FLAG/);
  const game = readFileSync(path.join(site, 'game.js'), 'utf8');
  assert.match(game, /coach: true, coachVoice: false/);
});

test('track switching restores the Indianapolis oval', () => {
  S.setTrack('road'); assert.ok(S.L > 4000 && S.INFO.kind === 'road');
  S.setTrack('indy'); assert.ok(Math.abs(S.L - 2.5 * 1609.344) < 1); assert.equal(S.S_LINE, 610);
});


// ---------------- Daily Challenge ----------------
const D = await import(path.join(site, 'daily.js'));

test('daily: same challenge for everyone on a date, New York calendar, valid ranges', () => {
  assert.deepEqual(D.dailySpec('20261026'), D.dailySpec('20261026'));
  // 03:30 UTC on Oct 26 is still Oct 25 in New York; 05:00 UTC is Oct 26
  assert.equal(D.nyDateKey(new Date('2026-10-26T03:30:00Z')), '20261025');
  assert.equal(D.nyDateKey(new Date('2026-10-26T05:00:00Z')), '20261026');
  const ms = D.msToNext(Date.parse('2026-10-26T03:30:00Z'));
  assert.ok(Math.abs(ms - 30 * 60000) < 2000, 'next challenge at NY midnight: ' + ms);
  let k = '20261025', prev = null; const seen = new Set();
  for (let i = 0; i < 120; i++, k = D.shiftKey(k, 1)) {
    const s = D.dailySpec(k);
    assert.equal(s.key, k); assert.ok(D.TRACKS.includes(s.track)); seen.add(s.track);
    assert.notEqual(s.track, prev, 'no track two days running (' + k + ')'); prev = s.track;
    assert.ok(s.laps >= 3 && s.laps <= 10); assert.ok(['race', 'tt'].includes(s.mode));
    assert.ok(s.grid >= 1 && s.grid <= s.field || s.mode === 'tt');
    assert.ok(['rookie', 'pro', 'veteran'].includes(s.difficulty)); assert.ok(['day', 'golden', 'overcast'].includes(s.look));
    assert.ok(s.cond.grip >= 0.95 && s.cond.grip <= 1.03 && s.cond.windMph >= 4 && s.cond.windMph <= 20);
    assert.ok(s.desc.length > 40 && !/undefined|NaN/.test(s.desc), s.desc);
  }
  assert.equal(seen.size, 3);
});

test('daily conditions never leak into a normal race (normal physics unchanged)', () => {
  const run = (o) => { const r = S.createRace(Object.assign({ track: 'indy', laps: 2, field: 11, grid: 6, difficulty: 'pro', seed: 99 }, o)); r.autopilot = true;
    for (let i = 0; i < 60 * 120 && !r.playerFinished; i++) S.stepRace(r, 1 / 60, {}); return r; };
  const a = run({});
  assert.equal(S.COND, null);
  run({ cond: { grip: 0.95, windMph: 18, windDeg: 180, gust: 0.4 } });
  assert.ok(S.COND && S.COND.mph === 18, 'daily race sets its conditions');
  const b = run({});
  assert.equal(S.COND, null, 'the next normal race clears them');
  assert.deepEqual(b.cars.map((c) => [c.dist, c.d, c.bestLap]), a.cars.map((c) => [c.dist, c.d, c.bestLap]));
});

test('daily wind and grip change lap times the expected way', () => {
  const lap = (track, cond) => { const r = S.createRace({ track, laps: 2, field: 2, grid: 1, seed: 5, cond }); r.cars = [r.player]; r.autopilot = true;
    for (let i = 0; i < 60 * 300 && !r.playerFinished; i++) S.stepRace(r, 1 / 60, {}); return r.player.bestLap; };
  const base = lap('road', null), slick = lap('road', { grip: 0.95 }), sticky = lap('road', { grip: 1.03 });
  assert.ok(slick > base + 0.3 && sticky < base - 0.2, [base, slick, sticky].join(' '));
  const calm = lap('indy', null), windy = lap('indy', { grip: 1, windMph: 18, windDeg: 180, gust: 0 });
  assert.ok(windy > calm, 'wind costs time on the oval overall: ' + calm + ' ' + windy);
  for (const t of [base, slick, sticky, calm, windy]) assert.ok(t > 18 && t < 900, 'inside the board range');
  S.createRace({ track: 'indy' }); S.setTrack('indy');
});

test('daily challenge is wired into the page and posts to daily-YYYYMMDD', () => {
  for (const id of ['btnDaily', 'btnDailyBoard', 'dDate', 'dTitle', 'dSetup', 'dCond', 'dSub', 'hWind']) assert.match(html, new RegExp('id="' + id + '"'));
  const game = readFileSync(path.join(site, 'game.js'), 'utf8');
  assert.match(game, /from '\.\/daily\.js'/);
  assert.match(game, /'daily-' \+ d\.key/);
  assert.match(game, /pb = best && !race\.daily && saveBest/, 'daily laps never touch the normal personal bests');
});


// ---------- car setup: tight <-> loose ----------
const tt = (track, setup, driver, seed = 5) => { const r = S.createRace({ track, laps: 3, field: 2, grid: 1, difficulty: 'pro', seed, setup }); r.cars = [r.player];
  let spins = 0; for (let i = 0; i < 60 * 400 && !r.playerFinished; i++) { S.stepRace(r, 1 / 60, driver ? driver(r) : S.autopilotInput(r, r.player)); for (const e of r.events.splice(0)) if (e.type === 'spin') spins++; }
  return { lap: r.player.bestLap, spins }; };

test('setup at center is the exact car from before (normal races bit-identical)', () => {
  const run = (o) => { const r = S.createRace(Object.assign({ track: 'road', laps: 2, field: 11, grid: 6, difficulty: 'pro', seed: 41 }, o)); r.autopilot = true;
    for (let i = 0; i < 60 * 200 && !r.playerFinished; i++) S.stepRace(r, 1 / 60, {}); return r.cars.map((c) => [c.dist, c.d, c.v, c.bestLap]); };
  const a = run({}), b = run({ setup: 0 });
  assert.equal(S.SETUP, null);
  run({ setup: 0.7 }); assert.ok(S.SETUP && S.SETUP.bal === 0.7, 'a setup race carries its balance');
  const c = run({});
  assert.equal(S.SETUP, null, 'the next race without a setup clears it');
  assert.deepEqual(b, a); assert.deepEqual(c, a);
  S.setTrack('indy');
});

test('tight pushes and resists spins, loose turns in faster and spins sooner', () => {
  S.createRace({ track: 'road', setup: -1 }); const T = S.SETUP; S.createRace({ track: 'road', setup: 1 }); const Lo = S.SETUP;
  assert.ok(T.push > 1.4 && Lo.push < 0.6, 'tight drifts up the track more in the turns');
  assert.ok(T.tau > 0.13 && Lo.tau < 0.09 && Lo.steer > T.steer, 'loose turns in quicker and sharper');
  assert.ok(T.spinR > 1.3 && Lo.spinR < 1.15, 'loose lets go sooner');
  // overdriving the road course (braking a full second late): tight hits walls, loose spins
  const late = () => { let t = 0, since = -1; return (r) => { t += 1 / 60; const p = r.player, cue = r.phase === 'green' && S.needBrake(p); if (cue && since < 0) since = t; if (!cue) since = -1; const a = S.autopilotInput(r, p); a.brake = cue && t - since > 1.0 ? 1 : 0; return a; }; };
  const tight = tt('road', -1, late(), 11), loose = tt('road', 1, late(), 11);
  assert.equal(tight.spins, 0); assert.ok(loose.spins >= 3, 'full loose spins when overdriven: ' + loose.spins);
  S.createRace({ track: 'indy' }); S.setTrack('indy');
});

test('no setup is fastest everywhere: each track rewards a different balance', () => {
  const POS = [-1, -0.5, -0.3, 0, 0.15, 0.3, 0.5, 1], best = {};
  for (const track of ['indy', 'texas', 'road']) {
    const laps = POS.map((b) => tt(track, b).lap);
    for (const l of laps) assert.ok(l > 18 && l < 900);
    best[track] = POS[laps.indexOf(Math.min(...laps))];
    assert.ok(laps[0] > Math.min(...laps) + 0.2 && laps[POS.length - 1] > Math.min(...laps) + 0.2, track + ': both extremes cost time ' + laps.join(' '));
  }
  assert.ok(best.indy < 0, 'Indy likes it a touch tight: ' + best.indy);
  assert.ok(best.road > 0, 'the road course likes it a bit loose: ' + best.road);
  assert.ok(best.texas > best.indy, 'Texas runs freer than Indy');
  S.createRace({ track: 'indy' }); S.setTrack('indy');
});

test('car setup screen is wired: slider with detent, per-track save, reachable before a race and from pause', () => {
  for (const id of ['setup', 'suRange', 'suVal', 'suDesc', 'suTracks', 'suReset', 'suDone', 'btnSetup', 'btnTitleSetup', 'btnPauseSetup', 'suPush', 'suRot']) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /id="suRange" type="range" min="-13" max="13"/);
  const game = readFileSync(path.join(site, 'game.js'), 'utf8');
  assert.match(game, /'ktb-setup-v1'/);
  assert.equal((game.match(/setup: setupOf\(/g) || []).length, 2, 'normal and daily races both pass the saved setup');
  assert.equal(S.setupLabel(0), 'NEUTRAL'); assert.equal(S.setupLabel(-0.3), 'T3'); assert.equal(S.setupLabel(1), 'L10');
});
