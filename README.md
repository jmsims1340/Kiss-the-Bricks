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

## Online leaderboard
Top 10 per board, arcade style. After a finished race (one board per track: `indy`, `texas`, `road`; best lap of the race, faster is better) that makes the top 10, the game asks for 3-letter initials (big ▲/▼ spinners, or type on a keyboard), submits, and shows the board with your entry highlighted. There's also a 🏆 Leaderboard button on the title screen and the finish card (🏆). `leaderboard.js` is the shared client (the same file in all three games). It talks to the Game Day Garage API at `https://gamedaygarage.sites.tab.bot/api`. If the API can't be reached, nothing in the game breaks: no entry screen shows, and the button says the board is offline. The local best score is still kept on the phone as before.

## Ghost car & Time Trial
Your best lap on each track is recorded (position + heading 15 times a second, delta-packed, about 4 KB) and saved on the phone under `ktb-ghost-<track>`. On that track a translucent blue ghost car replays it, the HUD shows the gap to it (green when you're ahead), and it shows as a dot on the minimap. Settings → Ghost car turns it off. The track picker has a Race / Time Trial switch: Time Trial is you and your ghost alone, no traffic; laps still count for the same best-lap leaderboard. `ghost.js` holds the recorder/player.

## Haptics
`haptics.js` buzzes on wall hits and spins, taking the lead, a new personal-best lap, and the finish / win. It uses `navigator.vibrate` where it exists (Android) and, on iPhone (iOS 18+ Safari), the hidden `<input type="checkbox" switch>` label-click trick, which only fires inside a touch, so a buzz from a race event is replayed on the next touch within ~0.45 s. Settings → Haptics turns it off. Fails silently everywhere else.

## Graphics
- `carmodel.js`: lofted Indy car and pace car with separate paint (clearcoat), carbon, rubber, metal and glass materials; the field is drawn with instanced meshes.
- `gfx.js`: sky dome with sun and clouds, a PMREM environment for reflections, and a post pass (4x MSAA, speed blur at the edges, heat shimmer, vignette, ACES tone mapping).
- In `game.js`: textured asphalt with a rubbered-in racing line, brick yard, catch fences with posts, a textured crowd, trees, a sun with soft shadows that follows the action, tire smoke on wall and car contact, and a broadcast-style HUD.
- Settings → Graphics: Auto (default), Max, Fast. Auto drops resolution first, then effects, to stay near 60 fps. `?gfx=high|medium|low` and `?mode=tt|race` work in the URL too.

The race physics (`sim.js`) are unchanged, so lap times and the leaderboard compare with earlier versions.

## Build
The live site serves a single bundled `game.js`, made with `esbuild game.js --bundle --minify --format=iife --target=es2020 --outfile=dist/game.js`. Put `leaderboard.js`, `index.html`, `styles.css`, `gdg-badge.png` and the media next to it (`carmodel.js`, `gfx.js`, `ghost.js` and `haptics.js` are bundled into `game.js`). The unbundled files in this repo also run as-is from any static server.
