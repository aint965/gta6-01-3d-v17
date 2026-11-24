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
