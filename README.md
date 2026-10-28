# Kiss the Bricks

A phone-first 3D IndyCar racer. Open `index.html` from any static web server (it is plain HTML, CSS and JavaScript, with Three.js included as a file).

**Tracks**
- **Indianapolis Oval**: 2.5 mi, four turns banked 9°, 33-car field, drafting, and the yard of bricks.
- **Texas Motor Speedway**: 1.5 mi high-banked quad-oval with turns banked 20° and 24° and the front-stretch dogleg. Laps take about 24 s.
- **Indianapolis Road Course**: 2.439 mi, 14 turns, run clockwise through the infield and onto the oval's front stretch. You start and finish on the bricks, and braking matters.

**Controls**: drag a thumb left or right to steer. Gas is automatic. Hold LIFT on the ovals, or BRAKE on the road course, to slow down. The BRAKE button glows when you are coming into a corner too fast. Arrow keys work on desktop. Settings has tilt steering, opponent level, starting spot and field size.

Your best lap is saved separately for each track.

Track shapes come from OpenStreetMap raceway geometry (© OpenStreetMap contributors, ODbL).

`npm test` runs the race-simulation tests (Node 20+).

## Car setup: tight ↔ loose
One slider, per track, saved on the phone (`localStorage` key `ktb-setup-v1`). Open it from the title screen (⚙ Setup), the track picker (Car setup) or the pause menu (changes made from pause take effect when you restart; there's a "Restart with this setup" button). It runs from **T10** (full tight) through **NEUTRAL** to **L10** (full loose), with a detent that snaps to center, a Reset to neutral button, a live description and a top-down graphic of push vs tail-out.

- **Tight** (understeer / push): less front bite. Lazier, slower turn-in, the nose pushes up the track in the turns and runs wide when you overdrive it, but the rear stays planted: very hard to spin and better traction off the corner.
- **Loose** (oversteer): more front bite. Quick turn-in and very little push, but the rear is light: the tail hangs out, traction control cuts in sooner on exit, lifting or yanking the wheel mid-corner on an oval can snap it round, and past about 60% loose it spins if you overdrive it.
- **Corner speed**: every corner has an ideal balance. Fast, high-load corners (Indy's flat turns, the sweepers) want a touch of tight; slow corners want a bit of loose for rotation. The further the slider is from a corner's ideal, the more speed that corner costs, so no setting is fastest everywhere.
- All of it lives in `sim.js` (`SETUP`, `makeSetup`, `setupGrip`). It applies only to your car. At NEUTRAL `SETUP` is `null` and every line of the old handling runs untouched: normal races are bit-for-bit the same as before (a test checks it).
- Leaderboards stay open to any setup, Daily Challenge included: everyone gets the same slider, so it's part of driving skill. The finish card shows the setup you raced.

Bot laps (`npm test` checks the shape), 3-lap time trial, Pro, best lap in seconds. "Clean" = autopilot on the racing line, braking on the cue. "Hard charger" = steering noise plus the odd mid-corner lift on the ovals, braking a full second late on the road course; average best lap over 6 runs (spins / wall hits in brackets).

| Track | T10 | T5 | NEUTRAL | L5 | L10 | Fastest setting |
|---|---|---|---|---|---|---|
| Indy oval, clean | 39.28 | 38.96 | 38.98 | 39.32 | 40.05 | T3 (38.93) |
| Texas, clean | 24.75 | 23.93 | 23.59 | 23.66 | 24.13 | L1–L2 (23.57) |
| Road course, clean | 74.31 | 72.67 | 71.88 | 71.92 | 72.70 | L2 (71.80) |
| Indy oval, hard charger | 39.84 (0/0) | 39.47 (0/0) | 39.43 (0/0) | 39.88 (0/0) | 42.75 (12/19) | |
| Texas, hard charger | 25.21 (0/0) | 24.54 (0/0) | 24.18 (0/0) | 24.26 (0/0) | 24.82 (4/7) | |
| Road course, hard charger | 68.24 (0/0) | 66.04 (0/0) | 64.78 (0/0) | 64.47 (3/0) | 89.52 (89/31) | |

## Online leaderboard
Top 10 per board, arcade style. After a finished race (one board per track: `indy`, `texas`, `road`; best lap of the race, faster is better) that makes the top 10, the game asks for 3-letter initials (big ▲/▼ spinners, or type on a keyboard), submits, and shows the board with your entry highlighted. There's also a 🏆 Leaderboard button on the title screen and the finish card (🏆). `leaderboard.js` is the shared client (the same file in all three games). It talks to the Game Day Garage API at `https://gamedaygarage.sites.tab.bot/api`. If the API can't be reached, nothing in the game breaks: no entry screen shows, and the button says the board is offline. The local best score is still kept on the phone as before.

## Daily Challenge
One seeded race a day, the same for everyone, picked from the New York date (`daily.js`, seed = YYYYMMDD; it rolls over at midnight ET):
- **Track** (one of the three, never the same two days running), **laps**, **mode** (race the field, or about one day in four a time trial), **grid spot**, **field size** and **opponent level**.
- **Conditions**: time of day (midday sun, golden hour or overcast: a look only), **wind** (speed and direction relative to the front stretch, with gusts; a headwind lowers top speed, a tailwind raises it, and the HUD shows a WIND arrow) and **grip** (green track, normal, or rubbered in). These live in `sim.js` as `COND`, which is `null` in every normal race, so normal-mode physics, lap times and the per-track boards are exactly as before (a test checks a normal race is bit-for-bit unchanged after a daily one).
- **Score**: your best lap of the run in seconds, lower is better, like the main boards. It posts to board `daily-YYYYMMDD` on the Game Day Garage API.
- **One counted run per day per phone** (`localStorage` key `ktb-daily-v1`): the run counts once the green flag drops. Every run after that is practice and never posts. Daily laps never touch your normal personal bests or track ghosts; the day has its own ghost (`ktb-ghost-daily-YYYYMMDD`, older days are cleaned up).
- The title screen shows the date, today's challenge, whether your counted run is used, and a countdown to the next one. 🏆 on the card opens today's top 10; the Leaderboard has a Daily tab too.
- `?daily=YYYYMMDD` previews another day (practice only).

## Ghost car & Time Trial
Your best lap on each track is recorded (position + heading 15 times a second, delta-packed, about 4 KB) and saved on the phone under `ktb-ghost-<track>`. On that track a translucent blue ghost car replays it, the HUD shows the gap to it (green when you're ahead), and it shows as a dot on the minimap. Settings → Ghost car turns it off. The track picker has a Race / Time Trial switch: Time Trial is you and your ghost alone, no traffic; laps still count for the same best-lap leaderboard. `ghost.js` holds the recorder/player.

## Haptics
`haptics.js` buzzes on wall hits and spins, taking the lead, a new personal-best lap, and the finish / win. It uses `navigator.vibrate` where it exists (Android) and, on iPhone (iOS 18+ Safari), the hidden `<input type="checkbox" switch>` label-click trick, which only fires inside a touch, so a buzz from a race event is replayed on the next touch within ~0.45 s. Settings → Haptics turns it off. Fails silently everywhere else.

## Graphics
- `carmodel.js`: lofted Indy car and pace car with separate paint (clearcoat), carbon, rubber, metal and glass materials; the field is drawn with instanced meshes.
- `gfx.js`: sky dome with sun and clouds, a PMREM environment for reflections, and a post pass (4x MSAA, speed blur at the edges, heat shimmer, vignette, ACES tone mapping).
- In `game.js`: textured asphalt with a rubbered-in racing line, brick yard, catch fences with posts, a textured crowd, trees, a sun with soft shadows that follows the action, tire smoke on wall and car contact, and a broadcast-style HUD.
- Settings → Graphics: Auto (default), Max, Fast. Auto drops resolution first, then effects, to stay near 60 fps. `?gfx=high|medium|low` and `?mode=tt|race` work in the URL too.

The race physics (`sim.js`) are unchanged at a NEUTRAL setup, so lap times and the leaderboard compare with earlier versions.

## Build
The live site serves a single bundled `game.js`, made with `esbuild game.js --bundle --minify --format=iife --target=es2020 --outfile=dist/game.js`. Put `leaderboard.js`, `index.html`, `styles.css`, `gdg-badge.png` and the media next to it (`carmodel.js`, `gfx.js`, `ghost.js`, `haptics.js` and `daily.js` are bundled into `game.js`). The unbundled files in this repo also run as-is from any static server.
