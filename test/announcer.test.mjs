// The announcer / coach voice: every call the game makes has recordings on disk, every fixed coach line has its
// recording, and the voice never draws from the game's random numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIPS, TEXTS, COACH_BY_TEXT, coachCat } from '../announcer.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const game = fs.readFileSync(path.join(root, 'game.js'), 'utf8');
const ann = fs.readFileSync(path.join(root, 'announcer.js'), 'utf8');
const TRACKS = ['indy', 'texas', 'road'];

test('every announcer call the game makes has recordings on disk', () => {
  const calls = new Set();
  for (const m of game.matchAll(/annSay\('([a-z_]+)'/g)) calls.add(m[1]);
  // ternaries and per-track calls inside annSay(...)
  for (const m of game.matchAll(/annSay\(([^;]*?)\)\s*;/g)) {
    for (const s of m[1].matchAll(/'([a-z_]+)'/g)) { if (s[1].endsWith('_')) TRACKS.forEach((t) => calls.add(s[1] + t)); else calls.add(s[1]); }
  }
  // intros are built from the track id
  assert.match(game, /'intro_' \+ S\.INFO\.id/); TRACKS.forEach((t) => calls.add('intro_' + t)); calls.add('intro_tt'); calls.add('intro_daily');
  for (const c of ['green', 'tt_green', 'lead', 'lostlead', 'pass', 'spin', 'crash', 'pb', 'white', 'podium', 'finish', 'tt_finish', 'daily_done', 'kiss', 'sixshooter']) assert.ok(calls.has(c), 'game never calls ' + c);
  for (const c of calls) {
    assert.ok(CLIPS[c] && CLIPS[c].length >= 2, 'no recordings (or only one take) for call ' + c);
    assert.equal(TEXTS[c].length, CLIPS[c].length, c);
    for (const u of CLIPS[c]) { const f = path.join(root, u); assert.ok(fs.existsSync(f) && fs.statSync(f).size > 2000, 'missing clip ' + u); }
  }
});

test('every fixed coach line has a recording in the same voice', () => {
  const texts = new Set();
  for (const m of game.matchAll(/coachSay\('[a-zA-Z]+', ([^;]*?), \d+/g)) for (const s of m[1].matchAll(/'([^']+)'/g)) if (/^[A-Z]/.test(s[1])) texts.add(s[1]);
  const pulls = ['Pull out now! Go low', 'Pull out now! Go high'];
  pulls.forEach((t) => texts.add(t)); texts.delete('Pull out now! Go '); texts.delete('low'); texts.delete('high');
  let n = 0;
  for (const t of texts) {
    if (/^Lap $| of $|^Nice pass! P$/.test(t)) continue; // the lap count is shown, not spoken; the pass line is matched by prefix
    const c = coachCat(t); assert.ok(c, 'coach line without a recording: ' + t); n++;
    for (const u of CLIPS[c]) assert.ok(fs.existsSync(path.join(root, u)), 'missing clip ' + u);
  }
  assert.ok(n >= 20, 'found ' + n + ' coach lines');
  assert.equal(coachCat('Nice pass! P4'), 'co_pass');
  assert.ok(Object.values(COACH_BY_TEXT).every((c) => CLIPS[c]));
});

test('the voice never touches the game\'s random numbers, and the robot voice is only a fallback', () => {
  assert.ok(!/Math\.random/.test(ann), 'announcer.js must use its own PRNG');
  assert.equal((game.match(/Math\.random/g) || []).length, 49, 'game.js Math.random calls changed');
  assert.ok(!/speechSynthesis/.test(game), 'game.js no longer speaks with the browser voice directly');
  assert.match(ann, /this\.failed\[u\]\) \{ this\.stats\.fallback\+\+; this\.speak/);
});

test('announcer setting, cache tag, and a small download', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /data-key="announcer"/);
  assert.match(game, /announcer: true/);
  let call = 0, coach = 0;
  for (const [c, us] of Object.entries(CLIPS)) for (const u of us) { const s = fs.statSync(path.join(root, u)).size; if (c.startsWith('co_')) coach += s; else call += s; }
  assert.ok(call < 1.4e6, 'announcer clips ' + call + ' bytes');
  assert.ok(coach < 0.5e6, 'coach clips ' + coach + ' bytes');
});
