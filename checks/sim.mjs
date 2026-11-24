// Node verification for Palkon Auto Stage B (sim only — no browser).
// Run `node checks/sim.mjs` from the repo root. Exits non-zero on any FAIL.
import { generateCity, layoutCheck, SEED } from '../game/src/city.js';
import {
  createSim, stepSim, collect, interact, nearestDrivable, activeTarget,
  getRenderCars, getRenderPeds, getMarkers, getLightStates, getHeadlights,
  runMissionAutopilot, PROFILES, MISSIONS, lightState,
} from '../game/src/sim.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
const city = generateCity(SEED);
const dt = 1 / 60;
const idle = { fwd: false, back: false, left: false, right: false, handbrake: false };
const full = { ...idle, fwd: true };

// 0. Layout still clean.
{
  const { problems, counts } = layoutCheck(city);
  check('layout 0 problems', problems.length === 0, problems.slice(0, 3).join('; ') || `${counts.buildings} buildings, ${counts.cars} cars`);
}

// 1. Top speeds: all four profiles reach their exact target on a clear straight.
for (const [id, prof] of Object.entries(PROFILES)) {
  const sim = createSim(city, { startInCar: true, traffic: false, profile: id });
  const car = sim.player.car;
  car.x = 400; car.z = 3300; car.yaw = 0;
  sim.player.yaw = 0; sim.player.speed = 0;
  let maxKmh = 0;
  for (let i = 0; i < 30 * 60; i += 1) {
    stepSim(sim, full, dt);
    maxKmh = Math.max(maxKmh, Math.abs(sim.player.speed) * 3.6);
  }
  const err = Math.abs(maxKmh - prof.topKmh);
  check(`top speed ${id} = ${prof.topKmh} km/h`, err <= 0.5, `measured ${maxKmh.toFixed(2)} km/h (err ${err.toFixed(2)})`);
  sim.stats.topSpeeds[id] = maxKmh;
}

// 2. Reverse distance in 2.5 s (report only).
{
  const sim = createSim(city, { startInCar: true, traffic: false, profile: 'sedan' });
  const car = sim.player.car;
  car.x = 400; car.z = 2000; car.yaw = 0;
  sim.player.yaw = 0; sim.player.speed = 0;
  const z0 = car.z;
  for (let i = 0; i < 2.5 * 60; i += 1) stepSim(sim, { ...idle, back: true }, dt);
  const dist = car.z - z0;
  check('reverse 2.5 s', dist > 5, `reversed ${dist.toFixed(1)} m in 2.5 s`);
}

// 3. Red-light stop: brake before the line, report the gap (must stop short).
{
  const sim = createSim(city, { startInCar: true, traffic: false, profile: 'sedan' });
  const car = sim.player.car;
  car.x = 400; car.z = 500; car.yaw = 0;
  sim.player.yaw = 0; sim.player.speed = 0;
  // Wait until the z=320 light is red (LIGHTS[0], offset 0: red during phase 13-26).
  while (sim.time < 14) stepSim(sim, idle, dt);
  const light = sim.lights[0];
  const stateAtStart = lightState(light, sim.time).primary;
  let braking = false, lightAtBrake = '';
  const LINE = 341; // stop line for northbound traffic at the z=320 light
  for (let i = 0; i < 30 * 60; i += 1) {
    if (!braking && car.z <= LINE + 30) { braking = true; lightAtBrake = lightState(light, sim.time).primary; }
    stepSim(sim, braking ? { ...idle, back: true } : full, dt);
    if (braking && Math.abs(sim.player.speed) < 0.1) break;
  }
  const gap = car.z - LINE;
  check('red-light stop before the line', gap > 0.5 && gap < 15, `gap ${gap.toFixed(1)} m, light at brake: ${lightAtBrake} (was ${stateAtStart} at t=14)`);
}

// 4. Traffic 90 s: stops happen, 0 red-runs, follow gap >= 8 m, 0 overlaps, all on roads.
{
  const sim = createSim(city, { startInCar: false, traffic: true });
  for (let i = 0; i < 90 * 60; i += 1) stepSim(sim, idle, dt);
  const { stops, redRuns, trafficOverlaps } = sim.stats;
  const minGap = sim.stats.minFollowGap === Infinity ? null : sim.stats.minFollowGap;
  check('traffic stops at red lights', stops > 0, `${stops} stops in 90 s`);
  check('traffic 0 red-runs', redRuns === 0, `${redRuns} red-runs`);
  // Free flow never bunches cars close enough to measure the gap rule; the
  // forced tailgating test below is the real measurement for it.
  check('traffic min follow gap >= 8 m (if measured)', minGap === null || minGap >= 8, minGap === null ? 'no encounters in free flow (see tailgating test)' : `min gap ${minGap.toFixed(1)} m`);
  check('traffic 0 overlaps', trafficOverlaps === 0, `${trafficOverlaps} overlaps`);
  let offRoad = 0;
  for (const c of sim.traffic) {
    const on = city.roads.some((r) => c.x >= r.x0 - 12 && c.x <= r.x1 + 12 && c.z >= r.z0 - 12 && c.z <= r.z1 + 12);
    if (!on) offRoad += 1;
  }
  check('traffic all on roads', offRoad === 0, `${offRoad} cars off road`);
  const finite = sim.traffic.every((c) => Number.isFinite(c.x) && Number.isFinite(c.z) && Number.isFinite(c.yaw));
  check('traffic positions finite', finite, '');
}

// 4b. Forced tailgating: 5 cars bunched 15 m apart on one route must hold >= 8 m.
{
  const sim = createSim(city, { startInCar: false, traffic: true });
  const lane = sim.traffic.filter((c) => c.route === 0).slice(0, 5);
  lane.forEach((c, i) => { c.s = 1000 + i * 15; c.speed = 11; });
  sim.stats.minFollowGap = Infinity;
  for (let i = 0; i < 30 * 60; i += 1) stepSim(sim, idle, dt);
  const minGap = sim.stats.minFollowGap;
  const overlaps = sim.stats.trafficOverlaps;
  check('tailgating min gap >= 8 m', minGap !== Infinity && minGap >= 8, `min gap ${minGap === Infinity ? 'n/a' : minGap.toFixed(1)} m over 30 s`);
  check('tailgating 0 overlaps', overlaps === 0, `${overlaps} overlaps`);
}

// 5. Timer does not run before the first move.
{
  const sim = createSim(city, { startInCar: true, traffic: false });
  for (let i = 0; i < 5 * 60; i += 1) stepSim(sim, idle, dt);
  const t0 = sim.missions.timer;
  stepSim(sim, full, dt);
  const t1 = sim.missions.timer;
  check('mission timer 0 before first move', t0 === 0 && t1 > 0, `timer ${t0} -> ${t1.toFixed(3)} s`);
}

// 6. Missions 1-4 autopilot: clean-play total $2,000.
{
  const sim = createSim(city, { startInCar: true, traffic: true });
  const res = runMissionAutopilot(sim, 1200);
  check('missions all complete', res.done === true, res.error || `${res.perMission.length}/4 done`);
  check('missions cash $2,000', res.cash === 2000, `$${res.cash} (per mission: ${res.perMission.map((m) => m.id + '=$' + m.reward).join(', ')})`);
  check('missions 0 collisions', res.collisions === 0, `${res.collisions} collisions, ${res.redRuns} red-runs, ${Math.round(res.finalTime)} s`);
  check('mission 4 broadcast fired', sim.missions.broadcast === true, sim.missions.done ? 'broadcast shown' : 'no broadcast');
}

// 7. On-foot + E interaction.
{
  const sim = createSim(city, { startInCar: false, traffic: false });
  const near = nearestDrivable(sim);
  check('E prompt near drivable car', !!near, near ? `nearest drivable ${near.dist.toFixed(1)} m away` : 'none in range');
  const entered = interact(sim);
  check('E enters the car', entered === 'car' && sim.player.mode === 'car', `mode ${sim.player.mode}`);
  const hl = getHeadlights(sim);
  check('headlights present in car mode', !!hl && hl.on === true, hl ? `at ${Math.round(hl.x)},${Math.round(hl.z)}` : 'none');
  const exited = interact(sim);
  check('E exits the car', exited === 'foot' && sim.player.mode === 'foot', `mode ${sim.player.mode}`);
  const mara = sim.player.mara;
  check('Mara spawns beside the car', Math.hypot(mara.x - sim.player.spawnCar.x, mara.z - sim.player.spawnCar.z) <= 6, `dist ${Math.hypot(mara.x - sim.player.spawnCar.x, mara.z - sim.player.spawnCar.z).toFixed(1)} m`);
}

// 8. Collision: building hit gives damage + shake; wreck at 100 damage.
{
  const sim = createSim(city, { startInCar: true, traffic: false, profile: 'sedan' });
  const car = sim.player.car;
  car.x = 400; car.z = 2000; car.yaw = -Math.PI / 2; // face east, off the boulevard into a block
  sim.player.yaw = -Math.PI / 2; sim.player.speed = 0;
  let hitAt = -1;
  for (let i = 0; i < 10 * 60; i += 1) {
    stepSim(sim, full, dt);
    if (sim.player.damage > 0) { hitAt = sim.time; break; }
  }
  check('building collision damages the car', sim.player.damage > 0 && sim.shake > 0, `damage ${sim.player.damage.toFixed(1)}, shake ${sim.shake.toFixed(2)}, hit at ${hitAt.toFixed(1)} s`);
  check('collision event recorded', sim.events.some((e) => e.type === 'collision'), `${sim.events.filter((e) => e.type === 'collision').length} collision events`);
  // Wreck path: damage already near 100 -> one more hit wrecks the car.
  sim.player.damage = 99;
  sim.player.cash = 200;
  car.x = 400; car.z = 2000; car.yaw = -Math.PI / 2;
  sim.player.yaw = -Math.PI / 2; sim.player.speed = 0;
  for (let i = 0; i < 10 * 60; i += 1) {
    stepSim(sim, full, dt);
    if (sim.player.mode === 'foot') break;
  }
  check('wreck at 100 damage tows the car', sim.player.mode === 'foot' && sim.player.cash === 150, `mode ${sim.player.mode}, cash $${sim.player.cash}`);
}

// 9. Render getters: cars, peds, markers, lights all present.
{
  const sim = createSim(city, { startInCar: true, traffic: true });
  stepSim(sim, idle, dt);
  const cars = getRenderCars(sim);
  const peds = getRenderPeds(sim);
  const markers = getMarkers(sim);
  const lights = getLightStates(sim);
  check('render cars = city + traffic + patrols', cars.length === city.cars.length + sim.traffic.length + sim.police.patrols.length, `${cars.length} cars`);
  check('render peds = 40', peds.length === 40, `${peds.length} peds`);
  check('mission marker present', markers.length === 1 && markers[0].phase === 'pickup', markers.length ? `${markers[0].label}` : 'none');
  check('traffic light states = 13', lights.length === 13 && lights.every((l) => ['red', 'yellow', 'green'].includes(l.state)), lights.map((l) => l.state[0]).join(''));
  const t = activeTarget(sim);
  check('mission 2 pickup is a person in a car', MISSIONS[1].pickup.personInCar === true, 'marker must point at the car, never a building');
  void t;
}

// 10. Solmar PD: patrols exist, HEAT rises on a red run and on a hard crash,
// decays when clean and out of sight, patrols chase, and a 3 s stop at
// HEAT 3+ with a patrol on the bumper ends in an arrest.
{
  const sim = createSim(city, { startInCar: true, traffic: true });
  const patrols = sim.police.patrols;
  check('patrols: 2 Solmar PD cars on the boulevard',
    patrols.length === 2 && patrols.every((p) => p.kind === 'patrol' && p.mode === 'patrol' && p.x >= 380 && p.x <= 420),
    patrols.map((p) => `${Math.round(p.x)},${Math.round(p.z)}`).join(' | '));

  // Red run: wait for the 1440-row light to go red, then drive north through
  // the z=1461 stop line from the spawn (400, 1500).
  {
    const s = createSim(city, { startInCar: true, traffic: false });
    const line = s.stopLines.find((l) => l.z === 1461);
    const light = line.light;
    let guard = 0;
    while (lightState(light, s.time).primary !== 'red' && guard < 40 * 60) { stepSim(s, idle, dt); guard += 1; }
    const heat0 = s.police.heat;
    let crossed = false;
    for (let i = 0; i < 20 * 60; i += 1) {
      stepSim(s, full, dt);
      if (s.player.car.z < 1461) { crossed = true; break; }
    }
    check('red-light run raises HEAT +1', crossed && s.police.heat >= heat0 + 1,
      `crossed=${crossed} heat ${heat0} -> ${s.police.heat} (light red at t=${s.time.toFixed(1)})`);
    check('red-run event recorded', s.events.some((e) => e.type === 'heatUp' && e.why === 'red light'),
      s.events.filter((e) => e.type === 'heatUp').map((e) => e.why).join(', ') || 'none');
  }

  // Hard crash: same setup as the building-collision test, HEAT must rise.
  {
    const s = createSim(city, { startInCar: true, traffic: false, profile: 'sedan' });
    const car = s.player.car;
    car.x = 400; car.z = 2000; car.yaw = -Math.PI / 2;
    s.player.yaw = -Math.PI / 2; s.player.speed = 0;
    for (let i = 0; i < 10 * 60; i += 1) {
      stepSim(s, full, dt);
      if (s.player.damage > 0) break;
    }
    check('hard crash raises HEAT +1', s.police.heat >= 1, `heat ${s.police.heat}, damage ${s.player.damage.toFixed(1)}`);
  }

  // Decay: HEAT 2, player far from every patrol (beach road), 30 s idle.
  {
    const s = createSim(city, { startInCar: true, traffic: true });
    s.police.heat = 2;
    s.police.decayAt = 25;
    s.player.car.x = 3600; s.player.car.z = 1080; // beach road, far from the boulevard loop
    for (let i = 0; i < 30 * 60; i += 1) stepSim(s, idle, dt);
    check('HEAT decays 1 level per 25 s out of sight', s.police.heat === 1, `heat ${s.police.heat} after 30 s`);
  }

  // Chase: HEAT 3, player cruising 15 m/s north, a patrol 100 m behind.
  {
    const s = createSim(city, { startInCar: true, traffic: false });
    s.police.heat = 3;
    s.police.decayAt = 1e9;
    const car = s.player.car;
    car.x = 400; car.z = 2000; car.yaw = 0;
    s.player.yaw = 0; s.player.speed = 0;
    const pt = s.police.patrols[0];
    pt.x = 400; pt.z = 2100; pt.yaw = 0; pt.speed = 0;
    const d0 = Math.hypot(pt.x - car.x, pt.z - car.z);
    for (let i = 0; i < 10 * 60; i += 1) {
      stepSim(s, full, dt);
      if (s.player.speed > 15) s.player.speed = 15;
    }
    const d1 = Math.hypot(pt.x - car.x, pt.z - car.z);
    check('patrol switches to chase at HEAT 3 and closes in', pt.mode === 'chase' && d1 < d0 && d1 < 40,
      `mode ${pt.mode}, dist ${d0.toFixed(0)} -> ${d1.toFixed(1)} m, player ${s.player.speed.toFixed(1)} m/s`);
  }

  // Arrest: HEAT 3, player stopped, a patrol on the bumper, 6 s idle.
  {
    const s = createSim(city, { startInCar: true, traffic: false });
    s.police.heat = 3;
    s.police.decayAt = 1e9;
    s.player.cash = 500;
    s.player.carrying = true;
    s.missions.phase = 'dropoff';
    const car = s.player.car;
    car.x = 400; car.z = 2000; car.yaw = 0;
    s.player.yaw = 0; s.player.speed = 0;
    const pt = s.police.patrols[0];
    pt.x = 400; pt.z = 2004.5; pt.yaw = 0; pt.speed = 0;
    for (let i = 0; i < 6 * 60; i += 1) stepSim(s, idle, dt);
    check('arrest after 3 s stopped at HEAT 3+', s.player.mode === 'foot' && s.police.arrests === 1,
      `mode ${s.player.mode}, arrests ${s.police.arrests}, heat ${s.police.heat}`);
    check('arrest fines $100 and fails the mission',
      s.player.cash === 400 && s.player.carrying === false && s.missions.phase === 'pickup',
      `cash $${s.player.cash}, carrying ${s.player.carrying}, phase ${s.missions.phase}`);
    check('arrest tows the car and walks Mara to the park',
      Math.hypot(s.player.mara.x - 2410, s.player.mara.z - 710) < 1 && Math.hypot(car.x - 400, car.z - 1500) < 1,
      `mara ${Math.round(s.player.mara.x)},${Math.round(s.player.mara.z)} car ${Math.round(car.x)},${Math.round(car.z)}`);
    check('arrested event recorded', s.events.some((e) => e.type === 'arrested'), `${s.events.filter((e) => e.type === 'arrested').length} arrested events`);
  }
}

// Summary.
const failed = results.filter((r) => !r.ok);
console.log(`\nSIM: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
