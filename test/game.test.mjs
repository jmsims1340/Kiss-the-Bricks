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
  assert.match(html, /<script type="module" src="game.js"><\/script>/);
  assert.doesNotMatch(html, /<script>(?!<)/, 'no inline scripts');
  assert.doesNotMatch(html + readFileSync(path.join(site, 'game.js'), 'utf8'), /lorem ipsum|TODO|FIXME|placeholder/i);
});

test('every local asset referenced exists and the theme is a phone-playable m4a', () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
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

test('track switching restores the Indianapolis oval', () => {
  S.setTrack('road'); assert.ok(S.L > 4000 && S.INFO.kind === 'road');
  S.setTrack('indy'); assert.ok(Math.abs(S.L - 2.5 * 1609.344) < 1); assert.equal(S.S_LINE, 610);
});
