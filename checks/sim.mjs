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
  check('render cars = city + traffic', cars.length === city.cars.length + sim.traffic.length, `${cars.length} cars`);
  check('render peds = 40', peds.length === 40, `${peds.length} peds`);
  check('mission marker present', markers.length === 1 && markers[0].phase === 'pickup', markers.length ? `${markers[0].label}` : 'none');
  check('traffic light states = 13', lights.length === 13 && lights.every((l) => ['red', 'yellow', 'green'].includes(l.state)), lights.map((l) => l.state[0]).join(''));
  const t = activeTarget(sim);
  check('mission 2 pickup is a person in a car', MISSIONS[1].pickup.personInCar === true, 'marker must point at the car, never a building');
  void t;
}

// Summary.
const failed = results.filter((r) => !r.ok);
console.log(`\nSIM: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
