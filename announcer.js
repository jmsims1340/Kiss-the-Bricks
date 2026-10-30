// Race-day voice: the track announcer (a pre-recorded US broadcaster, the same "Rollin" voice as Pocket Presence)
// and the radio coach's lines in that same voice. Clips are fetched at load and decoded once the game's AudioContext
// exists (the first tap unlocks it on iPhone). The browser's speech voice is used only if a recording really fails
// to download/decode, or there is no Web Audio at all. The announcer has its own random numbers and never draws
// from the game's random stream, so races and leaderboards are exactly as before.
export const CLIPS = {"intro_indy": ["vo/intro_indy0.mp3", "vo/intro_indy1.mp3"], "intro_texas": ["vo/intro_texas0.mp3", "vo/intro_texas1.mp3"], "intro_road": ["vo/intro_road0.mp3", "vo/intro_road1.mp3"], "intro_tt": ["vo/intro_tt0.mp3", "vo/intro_tt1.mp3"], "intro_daily": ["vo/intro_daily0.mp3", "vo/intro_daily1.mp3"], "green": ["vo/green0.mp3", "vo/green1.mp3", "vo/green2.mp3", "vo/green3.mp3"], "tt_green": ["vo/tt_green0.mp3", "vo/tt_green1.mp3"], "lead": ["vo/lead0.mp3", "vo/lead1.mp3", "vo/lead2.mp3", "vo/lead3.mp3"], "lostlead": ["vo/lostlead0.mp3", "vo/lostlead1.mp3", "vo/lostlead2.mp3"], "pass": ["vo/pass0.mp3", "vo/pass1.mp3", "vo/pass2.mp3", "vo/pass3.mp3", "vo/pass4.mp3"], "spin": ["vo/spin0.mp3", "vo/spin1.mp3", "vo/spin2.mp3"], "crash": ["vo/crash0.mp3", "vo/crash1.mp3", "vo/crash2.mp3"], "pb": ["vo/pb0.mp3", "vo/pb1.mp3", "vo/pb2.mp3"], "white": ["vo/white0.mp3", "vo/white1.mp3", "vo/white2.mp3"], "win_indy": ["vo/win_indy0.mp3", "vo/win_indy1.mp3", "vo/win_indy2.mp3"], "win_texas": ["vo/win_texas0.mp3", "vo/win_texas1.mp3"], "win_road": ["vo/win_road0.mp3", "vo/win_road1.mp3"], "podium": ["vo/podium0.mp3", "vo/podium1.mp3"], "finish": ["vo/finish0.mp3", "vo/finish1.mp3", "vo/finish2.mp3"], "tt_finish": ["vo/tt_finish0.mp3", "vo/tt_finish1.mp3"], "daily_done": ["vo/daily_done0.mp3", "vo/daily_done1.mp3"], "kiss": ["vo/kiss0.mp3", "vo/kiss1.mp3"], "sixshooter": ["vo/sixshooter0.mp3", "vo/sixshooter1.mp3"], "co_spin": ["vo/co_spin0.mp3"], "co_spinend": ["vo/co_spinend0.mp3"], "co_last": ["vo/co_last0.mp3"], "co_wallr": ["vo/co_wallr0.mp3"], "co_wallo": ["vo/co_wallo0.mp3"], "co_pacer": ["vo/co_pacer0.mp3"], "co_paceo": ["vo/co_paceo0.mp3"], "co_ready": ["vo/co_ready0.mp3"], "co_slide": ["vo/co_slide0.mp3"], "co_smooth": ["vo/co_smooth0.mp3"], "co_brake2": ["vo/co_brake20.mp3"], "co_brake1": ["vo/co_brake10.mp3"], "co_brake": ["vo/co_brake0.mp3"], "co_left": ["vo/co_left0.mp3"], "co_right": ["vo/co_right0.mp3"], "co_turnin": ["vo/co_turnin0.mp3"], "co_apex": ["vo/co_apex0.mp3"], "co_out": ["vo/co_out0.mp3"], "co_pulllow": ["vo/co_pulllow0.mp3"], "co_pullhigh": ["vo/co_pullhigh0.mp3"], "co_draft": ["vo/co_draft0.mp3"], "co_low": ["vo/co_low0.mp3"], "co_up": ["vo/co_up0.mp3"], "co_lift": ["vo/co_lift0.mp3"], "co_pass": ["vo/co_pass0.mp3"]};
export const TEXTS = {"intro_indy": ["Welcome to the Indianapolis Motor Speedway! The greatest spectacle in racing!", "Back home again in Indiana... and the field is rolling!"], "intro_texas": ["Welcome to Texas Motor Speedway! High banks and big speed!", "Everything's bigger in Texas... including the speed!"], "intro_road": ["Welcome to the road course at the Brickyard! Fourteen turns, and the bricks waiting at the end!", "The Indianapolis road course! Hard braking, and no room for mistakes!"], "intro_tt": ["Just you and the clock. Let's see what you've got.", "Time trial. Clean laps... nothing else matters."], "intro_daily": ["It's the daily challenge! One run counts, so make it a good one!", "Daily challenge time! Same race for everybody... let's see what you've got!"], "green": ["Green flag! Green flag! And they're racing!", "And there's the green! Here we go!", "Green, green, green! The race is on!", "Down comes the green flag... and they're off!"], "tt_green": ["And the clock is running!", "He's on a hot lap... the clock is running!"], "lead": ["And there's a new leader!", "He takes the lead!", "Into the lead! What a move!", "Out front! He's leading the race!"], "lostlead": ["Oh, he's lost the lead!", "Passed for the lead!", "And there's a change at the front!"], "pass": ["Makes the pass!", "Picks off another one!", "Gets by him... clean pass!", "He's moving forward!", "Another spot gained!"], "spin": ["Oh, he's around! He's spinning!", "Spin! Spin! He's lost it!", "Loses the rear... and around he goes!"], "crash": ["Into the wall! Hard contact!", "Oh, he's hit the wall!", "Ooh, that's gonna leave a mark!"], "pb": ["New personal best! What a lap!", "That's the fastest he's ever been around here!", "Personal best! He is flying!"], "white": ["White flag! One lap to go!", "There's the white flag! Final lap!", "One to go... this is it!"], "win_indy": ["He wins at Indianapolis! Go kiss those bricks!", "Checkered flag! Victory at the Brickyard!", "Into Victory Lane... he's gonna drink the milk!"], "win_texas": ["He wins in Texas! Fire up those six-shooters!", "Checkered flag! Texas belongs to him!"], "win_road": ["Checkered flag! He wins the Grand Prix at the Brickyard!", "Victory on the road course! Go kiss those bricks!"], "podium": ["Checkered flag! A podium finish!", "Crosses the line on the podium! Great drive!"], "finish": ["Checkered flag! He brings it home.", "There's the checkered flag. This one's in the books.", "Takes the checkered flag! Good run."], "tt_finish": ["And that's the session. Let's see the times.", "Session's over! Check out that lap time!"], "daily_done": ["That's your daily challenge in the books!", "The run is in! Let's see where it ranks today!"], "kiss": ["Pucker up! He's kissing the bricks!", "A Brickyard tradition! Smack!"], "sixshooter": ["Yee-haw! Fire 'em up!", "Bang, bang! That's how they do it in Texas!"], "co_spin": ["Hold on... let it stop rotating."], "co_spinend": ["Gather it up. Smooth on the throttle."], "co_last": ["Last lap! Bring it home!"], "co_wallr": ["Stay off the tires. Brake a touch earlier."], "co_wallo": ["Easy, off the wall. Give it room."], "co_pacer": ["Brake when the brake button glows."], "co_paceo": ["Hold your spot. Go on the green."], "co_ready": ["Get ready..."], "co_slide": ["Sliding! Lift and catch it!"], "co_smooth": ["Smooth on the throttle."], "co_brake2": ["Brake now! Earlier than last lap."], "co_brake1": ["Brake now!"], "co_brake": ["Brake."], "co_left": ["Move left for a better line."], "co_right": ["Move right for a better line."], "co_turnin": ["Turn in."], "co_apex": ["Apex. Clip the curb."], "co_out": ["Track out. Power on."], "co_pulllow": ["Pull out now! Go low!"], "co_pullhigh": ["Pull out now! Go high!"], "co_draft": ["In the draft. Stay tucked in."], "co_low": ["Go low. Hug the bottom of the turn."], "co_up": ["Move up. Set up high for the turn."], "co_lift": ["Lift! Wall!"], "co_pass": ["Nice pass!"]};
export const COACH_CATS = Object.keys(CLIPS).filter((c) => c.startsWith('co_'));
export const CALL_CATS = Object.keys(CLIPS).filter((c) => !c.startsWith('co_'));
// the coach's fixed lines -> their recordings ("Lap 3 of 10" style counts are shown, not spoken)
export const COACH_BY_TEXT = {
  'Hold on… let it stop rotating': 'co_spin', 'Gather it up. Smooth on the throttle': 'co_spinend', 'Last lap! Bring it home': 'co_last',
  'Stay off the tyres. Brake a touch earlier': 'co_wallr', 'Easy, off the wall. Give it room': 'co_wallo',
  'Brake when the BRAKE button glows': 'co_pacer', 'Hold your spot. Go on the green': 'co_paceo', 'Get ready…': 'co_ready',
  'Sliding! Lift and catch it': 'co_slide', 'Smooth on the throttle': 'co_smooth', 'Brake now. Earlier than last lap': 'co_brake2',
  'Brake now!': 'co_brake1', 'Brake': 'co_brake', 'Move left for a better line': 'co_left', 'Move right for a better line': 'co_right',
  'Turn in': 'co_turnin', 'Apex. Clip the kerb': 'co_apex', 'Track out. Power on': 'co_out', 'Pull out now! Go low': 'co_pulllow',
  'Pull out now! Go high': 'co_pullhigh', 'In the draft. Stay tucked in…': 'co_draft', 'Go low. Hug the bottom of the turn': 'co_low',
  'Move up. Set up high for the turn': 'co_up', 'Lift! Wall!': 'co_lift',
};
export function coachCat(text) { return COACH_BY_TEXT[text] || (/^Nice pass!/.test(text) ? 'co_pass' : null); }

// own PRNG (mulberry32), seeded from the clock: picking a take never draws from the game's random stream
let seed = (Date.now() ^ ((typeof performance !== 'undefined' ? performance.now() : 0) * 1000)) >>> 0;
function rnd() { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

export class Announcer {
  constructor(base = '') {
    this.base = base; this.ctx = null; this.out = null; this.raw = {}; this.buf = {}; this.failed = {}; this.fetching = {}; this.decoding = {};
    this.last = {}; this.voice = null; this.voiceEnd = 0; this.pendingUntil = 0; this.onStart = null; this.onEnd = null;
    this.stats = { calls: [], played: [], fallback: 0, late: 0, dropped: 0 };
  }
  // fetch the clips for these calls now (bytes only; decoding waits for the AudioContext)
  preload(cats) {
    for (const c of cats) for (const u of CLIPS[c] || []) {
      if (this.fetching[u]) continue;
      this.fetching[u] = fetch(this.base + u).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then((ab) => { this.raw[u] = ab; if (this.ctx) return this.decode(u); })
        .catch(() => { this.failed[u] = true; });
    }
  }
  attach(ctx) {
    if (!ctx || this.ctx === ctx) return;
    this.ctx = ctx; this.out = ctx.createGain(); this.out.gain.value = 1; this.out.connect(ctx.destination);
    for (const u in this.raw) this.decode(u);
  }
  // iPhone: play through the silent switch like a media app, and wake the context inside the tap
  unlock() {
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) {}
    const ctx = this.ctx; if (!ctx || this._unlocked) return;
    try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); this._unlocked = true; } catch (e) {}
  }
  decode(u) {
    if (this.buf[u] || !this.ctx || !this.raw[u]) return Promise.resolve(this.buf[u]);
    if (this.decoding[u]) return this.decoding[u];
    const ab = this.raw[u].slice(0);
    this.decoding[u] = new Promise((res) => {
      let done = false; const ok = (b) => { if (done) return; done = true; this.buf[u] = b; res(b); }, bad = () => { if (done) return; done = true; this.failed[u] = true; res(null); };
      try { const p = this.ctx.decodeAudioData(ab, ok, bad); if (p && p.then) p.then(ok, bad); } catch (e) { bad(); }
    });
    return this.decoding[u];
  }
  pick(cat) {
    const n = CLIPS[cat].length; if (n === 1) return 0;
    let i = Math.floor(rnd() * n); if (i === this.last[cat]) i = (i + 1 + Math.floor(rnd() * (n - 1))) % n;
    return i;
  }
  speaking() { return !!(this.ctx && this.voice && this.ctx.currentTime < this.voiceEnd); }
  stop() { if (this.voice) { try { this.voice.stop(); } catch (e) {} this.voice = null; } this.voiceEnd = 0; this.pendingUntil = 0; if (this.onEnd) this.onEnd(); }
  // pri 3 cuts in over whatever is playing; lower waits if the current line is nearly done, otherwise it is dropped
  say(cat, pri = 1) {
    const urls = CLIPS[cat]; if (!urls) return false;
    let i = this.pick(cat), u = urls[i];
    if (this.ctx && !this.buf[u]) { const ready = urls.findIndex((x) => this.buf[x]); if (ready >= 0) { i = ready; u = urls[i]; } }
    this.last[cat] = i; this.stats.calls.push(cat);
    const text = TEXTS[cat][i];
    if (this.ctx && this.buf[u]) return this.play(u, cat, pri);
    if (!this.ctx) { if (typeof window !== 'undefined' && !(window.AudioContext || window.webkitAudioContext)) { this.stats.fallback++; this.speak(text); } return false; }
    const asked = performance.now();
    Promise.resolve(this.fetching[u]).then(() => this.decode(u)).then(() => {
      if (this.buf[u]) { if (performance.now() - asked < 1500) this.play(u, cat, pri); else this.stats.late++; }
      else if (this.failed[u]) { this.stats.fallback++; this.speak(text); }
    });
    if (!this.fetching[u]) this.preload([cat]);
    return true;
  }
  play(u, cat, pri) {
    const ctx = this.ctx, b = this.buf[u]; if (!b) return false;
    const now = ctx.currentTime; let at = now + 0.02;
    if (this.voice && this.voiceEnd > now) {
      if (pri >= 3) { try { this.voice.stop(); } catch (e) {} this.voice = null; this.pendingUntil = 0; }
      else if (this.voiceEnd - now < 1.6 && this.pendingUntil <= now) { at = this.voiceEnd + 0.12; this.pendingUntil = at; }
      else { this.stats.dropped++; return false; }
    }
    const s = ctx.createBufferSource(); s.buffer = b; s.connect(this.out); s.start(at);
    this.voice = s; this.voiceEnd = at + b.duration; this.stats.played.push(cat);
    if (this.onStart) this.onStart();
    s.onended = () => { if (this.voice === s) { this.voice = null; if (this.onEnd) this.onEnd(); } };
    return true;
  }
  speak(text) {
    if (typeof window === 'undefined' || !window.speechSynthesis || !text) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; u.pitch = 0.9; speechSynthesis.speak(u); } catch (e) {}
  }
}
