# Stage A report — "Palkon Auto" (gta6-01-3d-v17)

## What was built
Handwritten WebGL 2 renderer (one shader program, one merged static buffer,
one dynamic buffer for every car, one sky buffer for sun/moon/stars; no vendored
engine) + the real-city Solmar, seed 20261123, in `game/`:
- `game/src/city.js` — deterministic city data + layout verifier.
- `game/src/render.js` — WebGL 2 renderer, sign texture atlas, sky bodies.
- `game/src/main.js` — chase camera, arcade drive, HUD, minimap, shot staging.
- `game/src/rng.js` — seeded RNG.
- `game/index.html` — canvas + grouped HUD (title/district top-left, compass
  top-centre, minimap bottom-left, speedometer bottom-right, controls bottom-centre).

## City (measured)
- Layout verifier `node checks/layout.mjs`: **0 problems**.
- Buildings **637** (all 7 districts present; Glasspoint glass towers, Old Solmar
  off-grid diagonal avenue + staggered rows, beach huts on Sunstrand Beach).
- Roads: 1 boulevard (64 m wide, x=400) + cross avenue (48 m) + secondaries
  (28 m) + locals (18 m) + canal with **3 bridges** + harbour + beach + park.
- Cars **102** (54 parked + 8 drivable + 40 traffic, 3 yellow taxis) — all drawn
  in the same dynamic-mesh pass; a street-level screenshot shows cars on the road.
- Pedestrians **40** (bright jackets), trees **201**, lamps **140**, boats **5**,
  traffic lights **13**, neon signs **4** (SOLMAR / GLASSPOINT / MARINA / CITRUS),
  benches 8, bins 8. Clock tower + fountain on the central plaza.
- Presets: midday (1), sunset (2, showcase), night (3, moon + 220 stars + lit
  windows); T cycles. No debug overlay anywhere.

## Verification (measured)
- Headless driver `node checks/driver.mjs` (CDP, swiftshader): **4/4 shots ready,
  0 console errors, 0 page errors, 0 failed requests**.
- Screenshots (all 1280x720, under 256 KiB): `1-boulevard-day.jpg` 74,117 B,
  `2-sunset-street.jpg` 74,546 B, `3-night.jpg` 67,921 B, `4-plaza.jpg` 92,190 B.
  Viewed in-session: boulevard vista to the clock tower with cars on the road;
  sunset with the sun disc in frame and the coral player car ahead; night with
  the moon in frame, stars, lit windows, taillights; plaza showing the diagonal
  Old Solmar quarter, the tower + fountain, and the district colour blocks.
- Renderer stats: static mesh **200,142 verts**, sky **1,536 verts**, 103 cars
  drawn per frame (102 city + player).
- Packaging: `MAKEFUN_OUTPUT_DIR=checks/out1 node main.ts` vs `out2` —
  **byte-identical**, dossier 466,832 B, sha256
  `b955532e30fc68519ec1caf5e108ab156238a7cfa9a6048a28a64e793455bcad`.
- Starter check (read-only, before any code): repo `main.ts`, `serve.ts`,
  `shots.json`, `LICENSE` match the kit starter byte-for-byte; LICENSE carries
  the `SPDX-License-Identifier: MIT` line.

## Bugs found and fixed
1. Old Solmar loop extrapolated the diagonal avenue past its end (z>1500),
   scattering buildings across the boulevard and planned blocks — 19 layout
   problems. Fixed: avenue rows only z 300..1500; south-west quarter uses fixed
   staggered columns; flank distance 46 -> 58 m.
2. Bridge approach blocks overlapped the canal bridge decks. Fixed: no
   buildings beside a bridge on either bank (open promenade instead).
3. Marina hotel overlapped a planned block building. Fixed: hotel forecourt
   exclusion rect; hotel sits on open ground by the harbour.
4. Building count 349 < 500. Fixed: per-block split into up to 3x2 buildings
   (was max 2x2) + 12 beach huts. Now 637.
5. Lamp count 126 != 140. Fixed: +7 promenade south-bank lamps + 7 plaza lamps.
6. Stars rendered as black squares in daylight (intensity 0 still drew the quad).
   Fixed: vertex shader clips sky verts with intensity < 0.01.
7. Sun halo was a giant orange blob with a faceted edge. Fixed: 12 -> 24 fan
   segments, halo 2.2x -> 1.5x, dimmer halo colour; halo pushed 8 m behind the
   disc to kill the z-fight moire.
8. Moon was above the frame (night shot). Fixed: moon direction lowered to
   ~20 deg elevation, now in frame clear of the HUD panel.
9. Player car invisible in shots (too far / inside a building footprint).
   Fixed: staged 45 m ahead of each shot camera, on the boulevard lane (x=410).
10. Compass strip centre showed a dot instead of the heading. Fixed: centre
    always shows the current cardinal.
11. Sunset ambient too dark for the player car. Fixed: ambient raised.
12. `win()` placed east/west windows inside the wall (missing outward offset).
    Fixed: separate branches per facade orientation.
13. Sign atlas rows were vertically flipped. Fixed: FLIP_Y + corrected row UVs.

## Honest limitations (Stage A scope, for later stages)
- Buildings are flat-shaded boxes with window quads — no rooftop detail, no
  varied rooflines; foreground rooftops in the plaza shot read as flat slabs.
- Traffic cars are static at spawn (Stage B animates them); traffic lights are
  fixed red (timing in Stage B); no headlights yet (Stage B).
- The day shot foreground is mostly empty asphalt — the boulevard is 64 m wide
  and the camera sits on it; parked cars line the edges but the centre is bare.
- Fog is mild by design (distant districts keep their colours); the far city
  edge is visible as a hard ground-plane boundary in the plaza shot.

## Files
- `game/index.html`, `game/src/{rng,city,render,main}.js`
- `checks/layout.mjs`, `checks/driver.mjs`, `checks/report.md` (this file)
- `screenshots/{1-boulevard-day,2-sunset-street,3-night,4-plaza}.jpg`
- `shots.json` (4 shots), `package.json` (type: module, kills the Node warning)

---

# Stage B report — driving, traffic, headlights, collisions, E, missions 1–4

## What was built
`game/src/sim.js` is now the single simulation (pure, no DOM/WebGL; imported by
`main.js` and `checks/sim.mjs`): 4 driving profiles, animated traffic on 4 loops
obeying the 26 s light cycle, headlights, OBB collisions, on-foot + E enter/exit,
missions 1–4 ($2,000 total, mission 4 = $800 finale with broadcast). `main.js`
was rewritten on top of it (the Stage A standalone player physics is gone);
`render.js` draws peds, mission markers (ground disc + bobbing diamond + additive
beam), dynamic traffic-light lenses, and headlight cones as an additive pass;
`index.html` gained cash / damage / profile / dialog / prompt HUD.

## Verification (measured)
- Node sim `node checks/sim.mjs`: **33/33 PASS**.
  - Top speeds EXACT: compact 115.00, sedan 130.00, van 108.00, coupe 158.00 km/h.
  - Reverse 20.9 m in 2.5 s; red-light stop 3.7 m before the line.
  - Traffic 90 s: 21 stops, **0 red-runs**, 0 overlaps, all on roads; forced
    tailgating min follow gap **8.8 m** over 30 s (target 8).
  - Missions 1–4 autopilot: **4/4 done, cash $2,000** ($250+$500+$450+$800),
    **0 collisions, 0 red-runs, 826 s**, broadcast fired; timer 0 before first move.
  - E: prompt at 5.0 m, enter/exit works, Mara spawns 3.0 m beside the car.
  - Building collision: damage 26.6, shake 0.97; wreck at 100 damage tows the
    car with a $50 penalty (cash $150 after the test wreck).
  - Render state: 142 cars, 40 peds, 13 light states.
- Headless driver `node checks/driver.mjs`: **4/4 shots ready, 0 console errors,
  0 failed requests** (regression check on the Stage A scenes).
- Browser driver `node checks/drive.mjs`: **drive-day shot + headlight pixel test
  + mission autotest, 0 console errors, 0 failed requests**.
  - Drive-day: E enters the car, midday, W 3 s — car drove 155 m north on the
    boulevard (screenshot: 94 km/h, traffic ahead, HUD complete).
  - Headlight pixel test (night, player at (400,2000), traffic car 15 m ahead):
    **PASS both haze variants** — asphalt mean gain **+51.1** (≥+20), **100%** of
    pixels > +10 (≥90%), roof of the car ahead **+29.9** (≥+20), unlit control
    **0** (within 1).
  - Browser autotest `?autotest=missions`: **done, cash $2,000, 0 collisions,
    0 red-runs** (same result as the Node sim).
  - Shots: `checks/shots/{drive-day,night-headlight,autotest-end}.jpg`.
- Packaging: `MAKEFUN_OUTPUT_DIR=checks/out1 node main.ts` vs `out2` —
  **byte-identical** (`diff -r` clean), dossier 620,269 B, sha256
  `6b94f41f1f5f1421584c738367ee690aabdd3d17f348f617993fa58135327bff`.

## Bugs found and fixed
1. Red-light stop gap −13.8 m (car overshot the line): sedan stops from 36 m/s
   in 26 m, but the test braked from 12 m. Fixed: brake from 30 m (test change).
2. Autopilot drove into parked cars: the overtake aim shifted the FAR waypoint
   by 8 m (a 0.35° correction at 1,300 m). Fixed: aim at a near point (20 m
   ahead, 8 m to the side).
3. Autopilot U-turn drifted 36 m west off the boulevard (10 s reversing) and
   then hugged the curb into parked cars: two causes — the far-waypoint aim gave
   a 0.03 rad lateral correction, and car-vs-car circles (r=2.6) collided cars
   5 m apart side-by-side. Fixed: pure-pursuit aim (30 m lookahead), reverse
   phase only until |yawDiff| < 2.2, and OBB-vs-OBB car collision (new
   `obbVsObb`).
4. Autopilot crashed on `route[wp]` undefined: the last waypoint (dist 5.5–6 m)
   fell through the arrival branch into the advance branch. Fixed: guard
   `wp >= route.length` + don't advance past the last waypoint.
5. "Leg timeout at final waypoint": `legTime` measures the whole leg (147 s for
   a 2,960 m leg), so the 120 s branch budget fired on arrival. Fixed: separate
   `finalWpTime`; per-leg timeout from route length (length/15 + 60 s); cruise
   22 -> 30 m/s; total budget 600 -> 1,200 s (all 8 legs total ~22,300 m).
6. Mission 4 missing from `perMission` (finale leaves phase at 'dropoff').
   Fixed: record on delivery legs (`leg % 2 === 1`).
7. Tower in the middle of the plaza intersection (x 388–412, z 1716–1740)
   blocked the boulevard route — the car clipped it at (413,1725). Fixed:
   legs 0 and 7 route around it through the 20 m west gap (x=380).
8. Traffic red-runs 23 in 855 s (0 in 90 s): the cross axis flips green->red
   with no yellow, and red braking at 6 m/s² needed 10.1 m from 11 m/s.
   Fixed: committed-light detection (a red-run counts only if the car was
   committed while the light was already red), 8 m/s² red braking, conservative
   yellow stop, and a green time-to-clear check. Now 0 in 855 s.
9. Autopilot T-boned a traffic car turning at the avenue + blew past a turn
   while overtaking (5 collisions). Fixed: traffic gives the player a 6 m
   lateral follow-gap window (was 3 m); no new overtake within 40 m of a
   waypoint turn, active overtake cancelled within 25 m.
10. Browser autotest timed out on leg 0: the `?autotest` page built the sim
    on foot (`startInCar: false`). Fixed: autotest/headlight pages start in a car.
11. Headlight test gains 0: crossed-trapezoid cones are edge-on from the chase
    camera (the vertical one covers ~0 pixels), and the asphalt patch sat
    beyond the cone/pool reach. Fixed: cones are a stack of camera-facing
    additive discs; asphalt patch moved to (400,1980), inside the pool.
12. First headlight discs blew out to a white blob (+202 gain). Fixed:
    brightnesses cut ~5x (summed centre ~0.5), elliptical discs (taller than
    wide) so they still reach the roof. Now +51.1 / +29.9.
13. HUD: the `#hud-controls` rule was lost in the index.html edit (bar floated
    to the top and overlapped the title/compass/dialog). Fixed: rule restored,
    dialog moved to top 125 px, prompt to 190 px.
14. `drive.mjs` wrote to repo-root `shots/` instead of `checks/shots/`
    (wrong `..` in the OUT path). Fixed; stray dir removed.

## Honest limitations (Stage B scope, for Stage C)
- The headlight discs read as faint concentric arcs on the road in daylight if
  you look closely; at night they read as a proper beam.
- The day-shot foreground is still mostly empty asphalt (Stage A chase view);
  Stage C's final screenshots should frame busier stretches.
- The moon is still a big flat white disc (Stage A sky); the traffic car ahead
  is only lit by the headlights, not by the street lamps.
- The player car does not stop at red lights (GTA-style: running them is
  allowed); only traffic red-runs are counted.

---

# Stage C report — police, radio, title screen, README, final screenshots

## What was built
- **Police (`game/src/sim.js`)**: a HEAT wanted system (0–5) + 2 Solmar PD
  patrol cars on the boulevard from the start (black body, white roof,
  flashing red/blue light bar). HEAT +1 on a red-light run (stop-line
  crossing on red, 5 s cooldown per intersection), +1 on a hard crash
  (impact > 12 m/s), +1 on the mission 2 and mission 4 pickups; −1 per
  25 s clean and out of sight of every patrol. HEAT 1–2: patrols follow
  (hold 25 m behind); HEAT 3+: chase (hold 12 m, pull up to 4.5 m — right
  on the bumper — once the player has sat still 1.5 s). Arrest (HEAT 3+,
  player < 3 m/s, a patrol within 5 m, held 3 s): $100 fine, active
  mission fails back to pickup, car towed to the spawn, Mara walks to the
  park centre (2410, 710). HEAT is on the HUD at all times (stars +
  "PD is watching / PD IS CHASING"). Patrols never ram: proportional
  approach controller, hard brake before sharp turns, hold-in-place when
  already inside the hold distance, match-a-traffic-car's speed instead
  of stopping dead. Patrols are collidable, in the autopilot's obstacle
  scan, and in the traffic follow-gap check.
- **Radio (`game/src/radio.js`, new)**: SOLMAR FM — 3 original loops
  (Boulevard Cruise, Neon Nights, Sunset Drive; pad + bass + pluck,
  WebAudio oscillators only, no audio files), a 5-note jingle on
  switch-on, auto-advance after 4 cycles, M mutes, R cycles the loop,
  now-playing line on the HUD. Starts on the Enter keypress that
  dismisses the title (a user gesture); `start()` is a no-op where
  AudioContext is unavailable and never throws.
- **Title screen (`game/index.html` + `main.js`)**: full-screen overlay —
  big PALKON AUTO logo, SOLMAR, tagline, the 4 missions with rewards,
  "PRESS ENTER TO START", controls — over a slow camera dolly along the
  boulevard at sunset. The sim waits on the title; Enter starts the game
  and the radio. HUD panels are hidden while the title is up.
- **README.md**: written in-session with the 3 make.fun badges, a
  2-sentence description, `node serve.ts` + http://localhost:8080, and
  the make.fun footer; description revised once with measured specifics.
- **Visual debt**: rooftop props (AC boxes, water tanks, antenna masts
  with red tips) on ~45% of buildings ≥ 15 m (static mesh 200,142 ->
  217,170 verts); moon disc 1.0 -> 0.7 with a dim halo (sky 1,536 ->
  1,608 verts); headlight beams scaled by preset (midday 0.35, sunset
  0.7, night 1.0) so the daytime arcs fade; fog density raised
  (midday 0.00016 -> 0.0002, sunset 0.00022 -> 0.00026, night
  0.00028 -> 0.00032) so the far city edge fades instead of ending hard.

## Verification (measured)
- Node sim `node checks/sim.mjs`: **43/43 PASS** (33 Stage B checks +
  9 police checks + render-cars count updated for the patrols).
  - Patrols: 2, kind 'patrol', on the boulevard (407,396 | 407,2796).
  - Red-light run: heat **0 -> 1** (crossed z=1461 on red at t=2.3),
    'heatUp: red light' event recorded.
  - Hard crash: heat **1** after a 26.6-damage building hit.
  - HEAT decay: **2 -> 1** after 30 s out of sight on the beach road.
  - Chase: HEAT 3, player cruising 15 m/s, patrol **100 -> 29.1 m** in
    10 s, mode 'chase'.
  - Arrest: after 3 s stopped at HEAT 3+, mode foot, arrests **1**,
    cash **$500 -> $400**, carrying false, phase back to 'pickup',
    Mara at (2410,710), car towed to (400,1500), 'arrested' event.
  - Regression: missions 1–4 autopilot **4/4 done, cash $2,000**
    ($250+$500+$450+$800), **0 collisions, 0 red-runs, 831 s**,
    broadcast fired; top speeds still EXACT 115/130/108/158;
    traffic 90 s still 21 stops, 0 red-runs, 0 overlaps.
- Browser driver `node checks/drive.mjs`: **exit 0, 0 console errors,
  0 failed requests**.
  - Drive-day: Enter dismisses the title, E enters the car, midday,
    W 3 s — car drove (400,1500) -> (400,1447); screenshot shows
    **44 km/h**, HEAT ★☆☆☆☆ "PD is watching", radio "Boulevard Cruise".
  - Radio: on, ctxState **running**, analyser level **0.030** (jingle +
    loop 1 scheduled, 14 notes), M mutes to level **0.000**, M again
    unmutes to **0.033**, HUD "SOLMAR FM — Boulevard Cruise · M mute ·
    R next loop".
  - Headlight pixel test: **PASS both haze variants** — asphalt mean
    gain **+51.1** (≥+20), **100%** pixels > +10, roof **+29.9**,
    control **0** (identical to Stage B: the night beam is unscaled).
  - Browser autotest `?autotest=missions`: **done, cash $2,000,
    0 collisions, 0 red-runs**, finalTime 830.8 s.
- Headless driver `node checks/driver.mjs`: **4/4 shots ready,
  0 console errors, 0 failed requests**.
- Packaging: `MAKEFUN_OUTPUT_DIR=out1 node main.ts` vs `out2` —
  **byte-identical** (`diff -r` clean), dossier 599,913 B, sha256
  `4f53eb561e02e699f7b3a863de6ef8c02db42065d896a2879db4d997b8727ee8`.
- Final screenshots (all 1280x720, under 256 KiB):
  `1-title.jpg` 70,143 B, `2-day-busy.jpg` 94,176 B,
  `3-sunset.jpg` 91,845 B, `4-night-police.jpg` 92,262 B.
  Viewed in-session: (1) title — big PALKON AUTO logo, SOLMAR, 4
  missions $250/$500/$450/$800, PRESS ENTER TO START, sunset boulevard
  + tower behind; (2) day-busy — player car centre on the cross avenue,
  a patrol with its light bar ahead, yellow taxis further east, avenue
  buildings both sides; (3) sunset — sun disc in frame with halo, clock
  tower ahead, player car + a red car on the boulevard, warm glow;
  (4) night-police — player car centre with red taillights, headlight
  cones + pool lighting the road and the car ahead, two patrol cars
  with red/blue light bars left and right, lit tower clock, smaller
  moon with halo top of frame, stars + lit windows.

## Bugs found and fixed
1. Patrol hold point was AHEAD of the player, not behind: `pos -
   (sin,cos)*back` is the forward direction. The patrols cut the player
   off and sat in the middle of the boulevard, and the autopilot hit a
   parked car overtaking them (2 collisions). Fixed: `pos +
   (sin,cos)*back`.
2. `movePatrol` moved the patrol BACKWARDS: `pt += (sin,cos)*speed`
   contradicts the forward vector `(-sin,-cos)` (same sign error in the
   traffic-ahead check). With the hold point fixed, patrols drove away
   (chase dist 100 -> 481 m). Fixed: `pt -= (sin,cos)*speed` and the
   forward component negated. Chase now 100 -> 29.1 m.
3. `movePatrol` target yaw used `atan2(dx,dz)` — 180° off the game's
   yaw convention (`routePoint` uses `atan2(-dx,-dz)`). Fixed.
4. Arrest/tow never moved the car: `spawnCar` IS the player car object,
   so `car.x = spawn.x` is a no-op (same latent bug in the wreck path —
   the car was never actually towed). Fixed: spawn coordinates stored as
   values (`spawnX/spawnZ/spawnYaw`) at creation; arrest and wreck both
   use them. Arrest test now verifies the car at (400,1500).
5. Arrest radius 3.5 m was unreachable: the OBB push-out separates
   overlapping cars to 4.4 m, so a patrol on the bumper could never hold
   the arrest. Fixed: radius 5 m, pull-up hold point 4.5 m (right on the
   bumper, just outside the 4.4 m overlap).
6. Chase lag: proportional gain 0.6 left the patrol ~40 m behind a
   15 m/s player (test margin 39.9 vs 40). Fixed: gain 1.0, now 29.1 m.
7. Day-busy shot framing: first version cut the player car off at the
   bottom-right edge and the patrol was out of frame; second version
   (camera further back) lost the player car entirely. Fixed: camera
   22 m behind the player at 5 m height, patrol staged 50 m ahead in
   the right lane, four traffic cars spread east down the avenue.
8. Two diagnostic trace scripts were written to /tmp (against the
   brief's NO /tmp rule). Deleted; all deliverables live in the repo.

## Honest limitations
- The autopilot's HEAT never exceeds 1 (red runs decay between
  infractions, missions add +1 each), so the chase mode is exercised by
  the dedicated test, not by the autopilot run.
- The radio's 3 loops are simple chord pads (4 chords x 4 s each) — a
  station ident, not a produced track; the jingle is 5 notes.
- The title screen's camera dolly is a slow ping-pong along the
  boulevard; it never shows the plaza or the harbour.
- Rooftop props are only clearly visible from high angles (the title
  and plaza views); the low chase views still read mostly flat roofs.
- The fog fade softens the far city edge but the ground plane still
  ends at the map border — there is no terrain beyond Solmar.
