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
