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

## Build
The live site serves a single bundled `game.js`, made with `esbuild game.js --bundle --minify --format=iife --target=es2020 --outfile=dist/game.js`. Put `leaderboard.js`, `index.html`, `styles.css` and the media next to it. The unbundled files in this repo also run as-is from any static server.
