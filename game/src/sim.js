// Palkon Auto — Stage B simulation. Pure logic: no DOM, no WebGL.
// Imported by game/src/main.js (browser) and checks/sim.mjs (Node).
// Coordinates: x east 0..3840, z south 0..3456, y up. yaw 0 = north (-z),
// yaw PI/2 = west (-x), yaw -PI/2 = east (+x), yaw PI = south (+z).
// Forward vector for a yaw is (-sin(yaw), -cos(yaw)).
import { generateCity, SEED, CITY_W, CITY_H } from './city.js';
import { createRandom } from './rng.js';

export const PROFILES = {
  compact: { name: 'Compact', topKmh: 115, accel: 16, brake: 26, revTop: 10, revAccel: 9, steer: 1.9 },
  sedan: { name: 'Sedan', topKmh: 130, accel: 15, brake: 25, revTop: 11, revAccel: 9, steer: 1.8 },
  van: { name: 'Van', topKmh: 108, accel: 13, brake: 24, revTop: 10, revAccel: 8, steer: 1.6 },
  coupe: { name: 'Coupe', topKmh: 158, accel: 18, brake: 28, revTop: 12, revAccel: 10, steer: 2.0 },
};

export const MISSIONS = [
  {
    id: 1, title: 'A Receipt for Sunshine', reward: 250,
    pickup: { x: 1960, z: 2900, label: 'Market stall — collect the receipt' },
    dropoff: { x: 470, z: 1790, label: 'Plaza — deliver to Neri' },
    dialog: { speaker: 'Neri', text: 'Mara, grab the sunshine receipt from the market stall and bring it to the plaza. Bastion\u2019s men watch the boulevard — keep it smooth.' },
  },
  {
    id: 2, title: 'Salt Ledger', reward: 500,
    pickup: { x: 3340, z: 2400, personInCar: true, label: 'Oren, in the teal car — collect the ledger' },
    dropoff: { x: 1120, z: 1728, label: 'Glasspoint — deliver to the courier' },
    dialog: { speaker: 'Oren', text: 'The ledger is with me, in the teal car by the marina road. Take it to the Glasspoint courier — and don\u2019t let Rook\u2019s patrols see the handoff.' },
  },
  {
    id: 3, title: 'After the Shutters', reward: 450,
    pickup: { x: 1520, z: 1080, label: 'Citrus shop — collect the evening goods' },
    dropoff: { x: 3600, z: 1080, label: 'Beach road — deliver after closing time' },
    dialog: { speaker: 'Neri', text: 'The shops are shut but the goods still move. Pick up the crates in Citrus and run them down to the beach road — quiet, after the shutters.' },
  },
  {
    id: 4, title: 'Glass Debt', reward: 800, finale: true,
    pickup: { x: 2400, z: 2080, label: 'Canal Ward — collect the debt papers' },
    dropoff: { x: 400, z: 320, label: 'North boulevard — settle the debt' },
    dialog: { speaker: 'Silas Rook', text: 'So the little courier comes to pay. Bring the papers up the boulevard — when the debt is settled, all of Solmar will hear about it.' },
  },
];

// Hand-driven waypoint routes for the mission autopilot (all on roads).
export const MISSION_ROUTES = [
  // Leg 0/7 pass the central plaza: the clock tower stands in the middle of
  // the boulevard x avenue intersection (x 388-412, z 1716-1740), so the
  // route threads the 20 m west gap (x=380) instead of the centreline.
  [[400, 1500], [380, 1650], [380, 1790], [400, 2900], [1960, 2900]],
  [[1960, 2900], [400, 2900], [400, 1790], [470, 1790]],
  [[470, 1790], [400, 1790], [400, 2900], [3240, 2900], [3240, 2400], [3340, 2400]],
  [[3340, 2400], [1120, 2400], [1120, 1728]],
  [[1120, 1728], [1520, 1728], [1520, 1080]],
  [[1520, 1080], [3600, 1080]],
  [[3600, 1080], [2400, 1080], [2400, 2080]],
  [[2400, 2080], [400, 2080], [380, 1790], [380, 1650], [400, 320]],
];

const TAU = Math.PI * 2;
const wrapAngle = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const kmh = (ms) => ms * 3.6;

// --- Rounded-rectangle traffic loop -------------------------------------------------
// Waypoints go clockwise (x east, z south): top edge east, right edge south,
// bottom edge west, left edge north. Corners are quarter-circle arcs.
function makeRoute(x0, z0, x1, z1, r, cruise) {
  const pts = [];
  const arc = (cx, cz, a0, a1) => {
    const steps = 4;
    for (let i = 1; i <= steps; i += 1) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  };
  pts.push([x0 + r, z0]);
  if (x1 - r !== x0 + r) pts.push([x1 - r, z0]);
  arc(x1 - r, z0 + r, -Math.PI / 2, 0);
  pts.push([x1, z1 - r]);
  arc(x1 - r, z1 - r, 0, Math.PI / 2);
  if (x1 - r !== x0 + r) pts.push([x0 + r, z1]);
  arc(x0 + r, z1 - r, Math.PI / 2, Math.PI);
  pts.push([x0, z0 + r]);
  arc(x0 + r, z0 + r, Math.PI, Math.PI * 1.5);
  // Cumulative lengths + per-sample speed limit from local curvature.
  const cum = [0];
  for (let i = 1; i <= pts.length; i += 1) {
    const a = pts[i - 1], b = pts[i % pts.length];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cum[pts.length];
  // Sample every ~2 m: vmax from the turn angle over the next 6 m (lateral accel 6).
  const samples = [];
  for (let s = 0; s < length; s += 2) {
    const p0 = pointAtRaw(pts, cum, length, s);
    const p1 = pointAtRaw(pts, cum, length, s + 6);
    const p2 = pointAtRaw(pts, cum, length, s + 12);
    const a1 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    const a2 = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
    const turn = Math.abs(wrapAngle(a2 - a1));
    const kappa = turn / 6;
    const vmax = kappa > 0.001 ? Math.sqrt(6 / kappa) : cruise;
    samples.push({ s, vmax: Math.min(cruise, vmax) });
  }
  return { pts, cum, length, cruise, samples };
}

function pointAtRaw(pts, cum, length, s) {
  let d = ((s % length) + length) % length;
  let i = 1;
  while (i < cum.length && cum[i] < d) i += 1;
  const a = pts[(i - 1) % pts.length], b = pts[i % pts.length];
  const segLen = cum[i] - cum[i - 1] || 1;
  const t = (d - cum[i - 1]) / segLen;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function routePoint(route, s) {
  const [x, z] = pointAtRaw(route.pts, route.cum, route.length, s);
  const [x2, z2] = pointAtRaw(route.pts, route.cum, route.length, s + 2);
  const dx = x2 - x, dz = z2 - z;
  const yaw = Math.atan2(-dx, -dz);
  return { x, z, yaw };
}

function routeVmax(route, s) {
  const n = route.samples.length;
  const idx = Math.floor((((s % route.length) + route.length) % route.length) / 2) % n;
  // Look ahead 10 m: the tightest limit in the window governs.
  let v = route.cruise;
  for (let k = 0; k < 6; k += 1) v = Math.min(v, route.samples[(idx + k) % n].vmax);
  return v;
}

// --- Traffic lights -----------------------------------------------------------------
// 26 s cycle: primary axis green 0-11 s, yellow 11-13 s, red 13-26 s; cross axis
// is the opposite (green only while primary is red).
export function lightState(light, t) {
  const phase = (t + light.offset) % 26;
  if (phase < 11) return { primary: 'green', cross: 'red' };
  if (phase < 13) return { primary: 'yellow', cross: 'red' };
  return { primary: 'red', cross: 'green' };
}

function stateForAxis(light, t, axis) {
  const st = lightState(light, t);
  return axis === light.axis ? st.primary : st.cross;
}

// --- Collision ----------------------------------------------------------------------
// OBB (car: half extents 1.0 x 2.2, yaw) vs AABB (building). Returns push-out
// vector {px, pz, depth} or null. SAT on the car axes + world axes.
function obbVsAabb(cx, cz, yaw, hx, hz, b) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // Car axes in world space: forward (-sin, -cos), right (cos, -sin).
  const axes = [[-s, -c], [c, -s], [1, 0], [0, 1]];
  const bcx = (b.x0 + b.x1) / 2, bcz = (b.z0 + b.z1) / 2;
  const bhx = (b.x1 - b.x0) / 2, bhz = (b.z1 - b.z0) / 2;
  const dx = cx - bcx, dz = cz - bcz;
  let minOverlap = Infinity, minAxis = null;
  for (const [ax, az] of axes) {
    // Car OBB radius on the axis: right = (cos, -sin), fwd = (-sin, -cos).
    const rc = hx * Math.abs(ax * c - az * s) + hz * Math.abs(ax * s + az * c);
    const rb = bhx * Math.abs(ax) + bhz * Math.abs(az);
    const dist = Math.abs(dx * ax + dz * az);
    const overlap = rc + rb - dist;
    if (overlap <= 0) return null;
    if (overlap < minOverlap) { minOverlap = overlap; minAxis = [ax, az]; }
  }
  const sign = (dx * minAxis[0] + dz * minAxis[1]) >= 0 ? 1 : -1;
  return { px: minAxis[0] * sign * minOverlap, pz: minAxis[1] * sign * minOverlap, depth: minOverlap };
}

// OBB-vs-OBB (two cars, half-extents 1.0 x 2.2). Circles over-report side-by-side
// passing: two cars 5 m apart laterally do not touch, but r=2.6 circles collide.
export function obbVsObb(ax, az, ayaw, bx, bz, byaw) {
  const axes = [];
  for (const yaw of [ayaw, byaw]) {
    axes.push([Math.cos(yaw), -Math.sin(yaw)]); // right
    axes.push([-Math.sin(yaw), -Math.cos(yaw)]); // forward
  }
  const dx = ax - bx, dz = az - bz;
  let minOverlap = Infinity, minAxis = null;
  for (const [ux, uz] of axes) {
    const dist = Math.abs(dx * ux + dz * uz);
    const ra = 1.0 * Math.abs(ux * Math.cos(ayaw) - uz * Math.sin(ayaw))
      + 2.2 * Math.abs(ux * Math.sin(ayaw) + uz * Math.cos(ayaw));
    const rb = 1.0 * Math.abs(ux * Math.cos(byaw) - uz * Math.sin(byaw))
      + 2.2 * Math.abs(ux * Math.sin(byaw) + uz * Math.cos(byaw));
    const overlap = ra + rb - dist;
    if (overlap <= 0) return null;
    if (overlap < minOverlap) { minOverlap = overlap; minAxis = [ux, uz]; }
  }
  const sign = (dx * minAxis[0] + dz * minAxis[1]) >= 0 ? 1 : -1;
  return { px: minAxis[0] * sign * minOverlap, pz: minAxis[1] * sign * minOverlap, depth: minOverlap };
}

function circleVsAabb(cx, cz, r, b) {
  const nx = clamp(cx, b.x0, b.x1), nz = clamp(cz, b.z0, b.z1);
  const dx = cx - nx, dz = cz - nz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    return { px: (dx / d) * (r - d), pz: (dz / d) * (r - d), depth: r - d };
  }
  // Centre inside the building: push out along the smallest penetration axis.
  const pushes = [
    [b.x0 - cx, 0], [b.x1 - cx, 0], [0, b.z0 - cz], [0, b.z1 - cz],
  ];
  let best = pushes[0], bestLen = Math.abs(best[0]) + Math.abs(best[1]);
  for (const p of pushes) {
    const l = Math.abs(p[0]) + Math.abs(p[1]);
    if (l < bestLen) { best = p; bestLen = l; }
  }
  const sgn = (v) => (v >= 0 ? 1 : -1);
  return { px: best[0] === 0 ? 0 : sgn(best[0]) * (Math.abs(best[0]) + r), pz: best[1] === 0 ? 0 : sgn(best[1]) * (Math.abs(best[1]) + r), depth: bestLen + r };
}

// --- Sim ----------------------------------------------------------------------------
export function createSim(city, opts = {}) {
  // Deep-clone the city: the sim owns its cars/peds and must never mutate the
  // caller's data (tests and the browser share one city object).
  city = JSON.parse(JSON.stringify(city));
  const rng = createRandom(SEED + 31);
  const profileId = opts.profile && PROFILES[opts.profile] ? opts.profile : 'sedan';
  const startInCar = !!opts.startInCar;
  const withTraffic = opts.traffic !== false;

  // Traffic loops: boulevard (A), cross avenue (B), outer rectangle (C), canal rectangle (D).
  const routes = [
    makeRoute(393, 100, 407, 3350, 7, 11),
    makeRoute(500, 1721, 3750, 1735, 7, 11),
    makeRoute(1120, 720, 2840, 2900, 14, 10),
    makeRoute(1960, 2400, 2400, 2900, 14, 9),
  ];
  // Stop points: where a route crosses a signalised intersection. Found by
  // sampling the route and matching the stop-line point to a traffic light.
  const stops = [];
  const LIGHTS = city.lights.map((l, i) => ({
    x: l.x, z: l.z, axis: l.x === 436 ? 'z' : 'x', offset: (i * 5) % 26, index: i,
  }));
  const stopLines = [];
  for (const z of [320, 720, 1080, 1440, 2080, 2400, 2900, 3200]) {
    stopLines.push({ x: 393, z: z + 21, axis: 'z', light: LIGHTS.find((l) => l.x === 436 && Math.abs(l.z - (z - 18)) < 1) });
    stopLines.push({ x: 407, z: z - 21, axis: 'z', light: LIGHTS.find((l) => l.x === 436 && Math.abs(l.z - (z - 18)) < 1) });
  }
  for (const x of [760, 1120, 1960, 2840, 3240]) {
    stopLines.push({ x: x - 21, z: 1721, axis: 'x', light: LIGHTS.find((l) => l.z === 1700 && Math.abs(l.x - (x + 18)) < 1) });
    stopLines.push({ x: x + 21, z: 1735, axis: 'x', light: LIGHTS.find((l) => l.z === 1700 && Math.abs(l.x - (x + 18)) < 1) });
  }
  routes.forEach((route, ri) => {
    for (const sl of stopLines) {
      if (!sl.light) continue;
      // Nearest route distance to the stop-line point.
      let bestS = 0, bestD = Infinity;
      for (let s = 0; s < route.length; s += 2) {
        const p = pointAtRaw(route.pts, route.cum, route.length, s);
        const d = Math.hypot(p[0] - sl.x, p[1] - sl.z);
        if (d < bestD) { bestD = d; bestS = s; }
      }
      if (bestD < 3) stops.push({ route: ri, s: bestS, axis: sl.axis, light: sl.light, x: sl.x, z: sl.z });
    }
  });

  const traffic = [];
  if (withTraffic) {
    const counts = [12, 10, 10, 8];
    routes.forEach((route, ri) => {
      for (let i = 0; i < counts[ri]; i += 1) {
        const s = (i / counts[ri]) * route.length + (ri * 37) % 50;
        const p = routePoint(route, s);
        traffic.push({
          route: ri, s, speed: 0, cruise: route.cruise * (0.9 + rng() * 0.2),
          x: p.x, z: p.z, yaw: p.yaw, kind: 'traffic',
          color: i < 3 && ri === 0 ? '#f2c200' : ['#c23b2e', '#2e5f8a', '#d8d8d8', '#3a3f45', '#7a4a8a', '#2f7d5a'][i % 6],
          taxi: i < 3 && ri === 0, stoppedAt: -1, stopCount: 0, slowUntil: 0,
          committedLight: null,
        });
      }
    });
  }

  // Pedestrians: 40 from the city, each with a short sidewalk patrol; 10 of
  // them cross the boulevard at the plaza crosswalks instead.
  const peds = city.peds.map((p, i) => {
    const cross = i >= 30;
    const from = cross ? { x: 374, z: i % 2 === 0 ? 1702 : 1754 } : { x: p.x, z: Math.max(60, p.z - 55) };
    const to = cross ? { x: 426, z: from.z } : { x: p.x, z: Math.min(3396, p.z + 55) };
    return {
      x: p.x, z: p.z, yaw: p.yaw, jacket: p.jacket,
      from, to, t: rng(), dir: rng() < 0.5 ? 1 : -1, speed: 1.1 + rng() * 0.5, cross,
    };
  });

  // The player starts on foot beside the drivable car at (400, 1500).
  const spawnCar = city.cars.find((c) => c.kind === 'drivable' && Math.abs(c.x - 400) < 1 && Math.abs(c.z - 1500) < 1)
    || city.cars.find((c) => c.kind === 'drivable');
  const sim = {
    city, time: 0, rng,
    player: {
      mode: startInCar ? 'car' : 'foot',
      profile: profileId,
      car: startInCar ? spawnCar : null,
      spawnCar,
      mara: { x: 400, z: 1505, yaw: 0, speed: 0 },
      speed: 0, yaw: 0, cash: 0, damage: 0,
      carrying: false, wrecked: false,
      // Spawn coordinates as values: spawnCar IS the player car object, so
      // reading spawnCar.x after the car has moved returns its current spot.
      spawnX: spawnCar.x, spawnZ: spawnCar.z, spawnYaw: spawnCar.yaw,
    },
    traffic, routes, stops, lights: LIGHTS, peds,
    stopLines,
    // Solmar PD: HEAT 0-5. Patrols cruise the boulevard; follow at HEAT 1-2,
    // chase at HEAT 3+. Arrest = HEAT 3+, player slow, a patrol close, 3 s.
    police: {
      heat: 0, lastInfraction: 0, decayAt: 0, arrestHold: 0, arrests: 0,
      lastRedRun: -999, playerSlowFor: 0,
      prevLine: stopLines.map((s) => lineSigned(s, spawnCar.x, spawnCar.z)),
      patrols: [],
    },
    missions: {
      index: 0, phase: 'pickup', timer: 0, timerRunning: false, done: false,
      dialog: { speaker: 'Neri', text: MISSIONS[0].dialog.text, until: 7 },
      broadcast: false, broadcastUntil: 0, finalTime: 0,
    },
    shake: 0, dust: [], events: [],
    stats: { stops: 0, redRuns: 0, collisions: 0, trafficOverlaps: 0, minFollowGap: Infinity, maxSpeedKmh: 0, topSpeeds: {} },
  };
  createPatrols(sim);
  if (startInCar) {
    sim.player.yaw = spawnCar.yaw;
    sim.player.speed = 0;
  }
  return sim;
}

function activeMission(sim) {
  return MISSIONS[sim.missions.index] || null;
}

export function activeTarget(sim) {
  const m = activeMission(sim);
  if (!m) return null;
  const spot = sim.missions.phase === 'pickup' ? m.pickup : m.dropoff;
  return {
    x: spot.x, z: spot.z, label: spot.label, personInCar: !!spot.personInCar,
    color: sim.missions.phase === 'pickup' ? (spot.personInCar ? '#2fd8c8' : '#ffd21a') : '#37d67a',
    phase: sim.missions.phase, mission: m,
  };
}

function setDialog(sim, speaker, text, secs = 6) {
  sim.missions.dialog = { speaker, text, until: sim.time + secs };
}

export function nearTarget(sim) {
  const t = activeTarget(sim);
  if (!t) return false;
  const p = playerPos(sim);
  return Math.hypot(p.x - t.x, p.z - t.z) <= 6;
}

export function playerPos(sim) {
  return sim.player.mode === 'car' && sim.player.car
    ? { x: sim.player.car.x, z: sim.player.car.z }
    : { x: sim.player.mara.x, z: sim.player.mara.z };
}

export function collect(sim) {
  const m = activeMission(sim);
  if (!m || !nearTarget(sim)) return false;
  if (sim.missions.phase === 'pickup') {
    sim.player.carrying = true;
    sim.missions.phase = 'dropoff';
    // The hot pickups are watched: mission 2 (Rook's patrols) and the finale.
    if (m.id === 2 || m.id === 4) addHeat(sim, 1, 'mission ' + m.id + ' pickup');
    setDialog(sim, 'Neri', 'Got it. Now run it to the drop — same road, no detours.');
    sim.events.push({ type: 'collect', mission: m.id, t: sim.time });
  } else {
    sim.player.cash += m.reward;
    sim.player.carrying = false;
    sim.events.push({ type: 'deliver', mission: m.id, reward: m.reward, cash: sim.player.cash, t: sim.time });
    if (m.finale) {
      sim.missions.done = true;
      sim.missions.finalTime = sim.missions.timer;
      sim.missions.broadcast = true;
      sim.missions.broadcastUntil = sim.time + 8;
      setDialog(sim, 'Solmar Radio', 'BREAKING: the Glass Debt is settled — Mara Venn walks free, and Bastion Civic just lost its grip on the city.', 8);
    } else {
      sim.missions.index += 1;
      sim.missions.phase = 'pickup';
      const next = MISSIONS[sim.missions.index];
      setDialog(sim, next.dialog.speaker, next.dialog.text);
    }
  }
  return true;
}

export function dropCargo(sim) {
  if (!sim.player.carrying) return false;
  sim.player.carrying = false;
  sim.missions.phase = 'pickup';
  setDialog(sim, 'Neri', 'You dropped it. Go back and pick it up again — carefully this time.');
  sim.events.push({ type: 'cargoDropped', t: sim.time });
  return true;
}

export function interact(sim) {
  const p = sim.player;
  if (p.mode === 'car') {
    // Exit: Mara steps out to the right of the car.
    const car = p.car;
    const rx = Math.cos(car.yaw), rz = -Math.sin(car.yaw);
    p.mara.x = clamp(car.x + rx * 3, 20, CITY_W - 20);
    p.mara.z = clamp(car.z + rz * 3, 20, CITY_H - 20);
    p.mara.yaw = car.yaw;
    p.mode = 'foot';
    p.car = null;
    p.speed = 0;
    sim.events.push({ type: 'exitCar', t: sim.time });
    return 'foot';
  }
  // Enter the nearest drivable car within 6 m.
  let best = null, bestD = 6;
  for (const c of sim.city.cars) {
    if (c.kind !== 'drivable') continue;
    const d = Math.hypot(c.x - p.mara.x, c.z - p.mara.z);
    if (d < bestD) { best = c; bestD = d; }
  }
  if (!best) return null;
  p.car = best;
  p.yaw = best.yaw;
  p.speed = 0;
  p.mode = 'car';
  sim.events.push({ type: 'enterCar', t: sim.time });
  return 'car';
}

export function nearestDrivable(sim) {
  const p = sim.player;
  if (p.mode !== 'foot') return null;
  let best = null, bestD = 6;
  for (const c of sim.city.cars) {
    if (c.kind !== 'drivable') continue;
    const d = Math.hypot(c.x - p.mara.x, c.z - p.mara.z);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best ? { car: best, dist: bestD } : null;
}

function stepPlayerCar(sim, input, dt) {
  const p = sim.player;
  const prof = PROFILES[p.profile];
  const top = prof.topKmh / 3.6;
  const car = p.car;
  if (!car) return;
  const steerIn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  if (input.fwd) p.speed += prof.accel * dt;
  else if (input.back) p.speed -= (p.speed > 0.5 ? prof.brake : prof.revAccel) * dt;
  else p.speed -= Math.sign(p.speed) * Math.min(Math.abs(p.speed), 7 * dt);
  if (input.handbrake) {
    p.speed -= Math.sign(p.speed) * Math.min(Math.abs(p.speed), 20 * dt);
  }
  p.speed = clamp(p.speed, -prof.revTop, top);
  const steerRate = prof.steer * (input.handbrake ? 1.6 : 1);
  p.yaw += steerIn * clamp(p.speed / 12, -1, 1) * steerRate * dt;
  car.yaw = p.yaw;
  const nx = car.x - Math.sin(p.yaw) * p.speed * dt;
  const nz = car.z - Math.cos(p.yaw) * p.speed * dt;
  car.x = clamp(nx, 20, CITY_W - 20);
  car.z = clamp(nz, 20, CITY_H - 20);
  sim.stats.maxSpeedKmh = Math.max(sim.stats.maxSpeedKmh, kmh(Math.abs(p.speed)));
  // Building collision (OBB vs nearby AABBs).
  const impact = Math.abs(p.speed);
  for (const b of sim.city.buildings) {
    if (Math.abs(b.x0 + (b.x1 - b.x0) / 2 - car.x) > (b.x1 - b.x0) / 2 + 6) continue;
    if (Math.abs(b.z0 + (b.z1 - b.z0) / 2 - car.z) > (b.z1 - b.z0) / 2 + 6) continue;
    const hit = obbVsAabb(car.x, car.z, p.yaw, 1.0, 2.2, b);
    if (!hit) continue;
    car.x += hit.px; car.z += hit.pz;
    if (impact > 2) {
      const dmg = impact * 0.8;
      p.damage = Math.min(100, p.damage + dmg);
      sim.shake = Math.min(1, impact / 18);
      spawnDust(sim, car.x - Math.sin(p.yaw) * 2.2, car.z - Math.cos(p.yaw) * 2.2);
      sim.events.push({ type: 'collision', what: 'building', speed: impact, damage: dmg, t: sim.time });
      sim.stats.collisions += 1;
      if (impact > 12) addHeat(sim, 1, 'crash');
    }
    p.speed *= impact > 2 ? -0.15 : 0.5;
    break;
  }
  // Car-vs-car collision (OBB vs OBB — circles over-report side-by-side
  // passing) with parked / drivable / traffic / patrol cars.
  const others = [...sim.city.cars, ...sim.traffic, ...sim.police.patrols];
  for (const o of others) {
    if (o === car) continue;
    const dx = car.x - o.x, dz = car.z - o.z;
    if (Math.abs(dx) > 5 || Math.abs(dz) > 5) continue;
    const hit = obbVsObb(car.x, car.z, p.yaw, o.x, o.z, o.yaw);
    if (!hit) continue;
    car.x += hit.px; car.z += hit.pz;
    if (Math.abs(p.speed) > 2) {
      const dmg = Math.abs(p.speed) * 0.7;
      p.damage = Math.min(100, p.damage + dmg);
      sim.shake = Math.min(1, Math.abs(p.speed) / 18);
      spawnDust(sim, car.x, car.z);
      sim.events.push({ type: 'collision', what: 'car', speed: Math.abs(p.speed), damage: dmg, t: sim.time });
      sim.stats.collisions += 1;
      if (Math.abs(p.speed) > 12) addHeat(sim, 1, 'crash');
      if (o.kind === 'traffic') o.slowUntil = sim.time + 1;
    }
    p.speed *= 0.4;
    break;
  }
  // Running a red light adds HEAT (one count per intersection: 5 s cooldown).
  const pol = sim.police;
  for (let i = 0; i < sim.stopLines.length; i += 1) {
    const s = sim.stopLines[i];
    const d = lineSigned(s, car.x, car.z);
    const lat = s.axis === 'z' ? Math.abs(car.x - s.x) : Math.abs(car.z - s.z);
    const prev = pol.prevLine[i];
    pol.prevLine[i] = d;
    if (prev === 0 || prev * d > 0) continue; // no crossing
    if (lat > 10) continue;
    if (Math.abs(p.speed) < 3) continue;
    if (stateForAxis(s.light, sim.time, s.axis) !== 'red') continue;
    if (sim.time - pol.lastRedRun < 5) continue;
    pol.lastRedRun = sim.time;
    addHeat(sim, 1, 'red light');
  }
  // Wrecked at 100 damage: Mara is forced out, the car is towed back to its
  // spawn spot repaired, cash penalty $50.
  if (p.damage >= 100) {
    p.damage = 0;
    p.cash = Math.max(0, p.cash - 50);
    car.x = p.spawnX; car.z = p.spawnZ; car.yaw = p.spawnYaw;
    p.yaw = p.spawnYaw; p.speed = 0;
    p.mara.x = clamp(p.spawnX + 3, 20, CITY_W - 20);
    p.mara.z = clamp(p.spawnZ + 3, 20, CITY_H - 20);
    p.mara.yaw = p.spawnYaw;
    p.mode = 'foot';
    p.car = null;
    setDialog(sim, 'Neri', 'That car is wrecked — I had it towed back to the boulevard. Fifty bucks for the tow. Walk to it and get back in.');
    sim.events.push({ type: 'wrecked', t: sim.time });
  }
}

function stepMara(sim, input, dt) {
  const m = sim.player.mara;
  const fwd = (input.fwd ? 1 : 0) - (input.back ? 1 : 0);
  const turn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  m.yaw += turn * 2.2 * dt;
  const sp = 4;
  m.speed = fwd * sp;
  const nx = m.x - Math.sin(m.yaw) * m.speed * dt;
  const nz = m.z - Math.cos(m.yaw) * m.speed * dt;
  m.x = clamp(nx, 20, CITY_W - 20);
  m.z = clamp(nz, 20, CITY_H - 20);
  for (const b of sim.city.buildings) {
    if (Math.abs(b.x0 + (b.x1 - b.x0) / 2 - m.x) > (b.x1 - b.x0) / 2 + 2) continue;
    if (Math.abs(b.z0 + (b.z1 - b.z0) / 2 - m.z) > (b.z1 - b.z0) / 2 + 2) continue;
    const hit = circleVsAabb(m.x, m.z, 0.5, b);
    if (hit) { m.x += hit.px; m.z += hit.pz; }
  }
}

function spawnDust(sim, x, z) {
  for (let i = 0; i < 8; i += 1) {
    sim.dust.push({
      x, y: 0.6, z,
      vx: (sim.rng() - 0.5) * 4, vy: 1 + sim.rng() * 2, vz: (sim.rng() - 0.5) * 4,
      life: 0.6, maxLife: 0.6,
    });
  }
}

function stepTraffic(sim, dt) {
  for (const car of sim.traffic) {
    const route = sim.routes[car.route];
    let desired = Math.min(car.cruise, routeVmax(route, car.s + 12));
    // Nearest signalised stop ahead on this route.
    let nearest = null, nearestDist = Infinity;
    for (const st of sim.stops) {
      if (st.route !== car.route) continue;
      const dist = (st.s - car.s + route.length) % route.length;
      if (dist < nearestDist) { nearestDist = dist; nearest = st; }
    }
    // Crossing detection: the nearest stop changed identity while the car was
    // right at the previous stop's line -> the car crossed that line. A
    // red-run counts only if the car was COMMITTED to crossing while the
    // light was already red (committedLight): a car that entered on green or
    // yellow and had the light change mid-crossing did not run the red. The
    // cross axis flips green->red with no yellow, so without this the
    // detector fires on every car caught by the flip.
    if (car.nearStop && nearest && car.nearStop.key !== nearest.route + ':' + nearest.s && car.nearStop.dist < 3) {
      if (car.committedLight === 'red') {
        sim.stats.redRuns += 1;
        sim.events.push({ type: 'redRun', route: car.route, t: sim.time });
      }
    }
    car.nearStop = nearest ? { key: nearest.route + ':' + nearest.s, dist: nearestDist, light: nearest.light, axis: nearest.axis } : null;
    if (!nearest || nearestDist > 10) car.stoppedAt = -1; // left the stop area: allow a fresh stop count next lap
    if (nearest && nearestDist < 45) {
      const ls = stateForAxis(nearest.light, sim.time, nearest.axis);
      // Commitment tracking: the light state at the moment the car can no
      // longer stop before the line. Reset when the car stops or the light
      // is not red (a fresh approach, or the light turned green mid-approach).
      const stopNeed = (car.speed * car.speed) / (2 * 8) + 0.5;
      if (!nearest || car.speed < 0.3 || ls !== 'red') car.committedLight = null;
      else if (car.committedLight === null && nearestDist < stopNeed) car.committedLight = 'red';
      if (ls === 'red') {
        // Brake to stop ~2 m before the line (stopDist measured to that point).
        // Full 8 m/s^2 braking: the old 6 m/s^2 needed 10.1 m from 11 m/s and
        // overshot the line whenever the light flipped with < 10 m to go.
        const stopDist = Math.max(0, nearestDist - 2);
        desired = Math.min(desired, Math.sqrt(2 * 8 * stopDist));
        if (nearestDist < 3.5) desired = 0;
        if (car.speed < 0.3 && nearestDist < 4 && car.stoppedAt !== nearest.s) {
          car.stoppedAt = nearest.s;
          car.stopCount += 1;
          sim.stats.stops += 1;
          sim.events.push({ type: 'trafficStop', route: car.route, t: sim.time });
        }
      } else if (ls === 'yellow') {
        // Dilemma zone: stop whenever it physically can (8 m/s^2 + 0.5 m),
        // else proceed — a car that enters on yellow clears it in < 0.8 s.
        if (nearestDist > stopNeed) {
          const stopDist = Math.max(0, nearestDist - 2);
          desired = Math.min(desired, Math.sqrt(2 * 8 * stopDist));
          if (nearestDist < 3.5) desired = 0;
        }
      } else {
        // Green: do not enter if the light will be red before the car clears
        // the line and the car can still stop. The cross axis has no yellow,
        // so without this a car 8 m out at 11 m/s is caught by the flip.
        const phase = (sim.time + nearest.light.offset) % 26;
        const isPrimary = nearest.axis === nearest.light.axis;
        const timeToRed = isPrimary ? 13 - phase : 26 - phase;
        const timeToLine = nearestDist / Math.max(car.speed, 0.5);
        if (timeToRed > 0 && timeToLine > timeToRed - 0.5 && nearestDist > stopNeed) {
          const stopDist = Math.max(0, nearestDist - 2);
          desired = Math.min(desired, Math.sqrt(2 * 8 * stopDist));
          if (nearestDist < 3.5) desired = 0;
        }
      }
    }
    // Follow gap: nearest car ahead in the same lane (local frame). The
    // player gets a wider lateral window (6 m vs 3 m): a player turning
    // across the lane is still a hazard the traffic car must brake for.
    const all = [...sim.traffic, sim.player.car, ...sim.police.patrols].filter(Boolean);
    for (const o of all) {
      if (o === car) continue;
      const dx = o.x - car.x, dz = o.z - car.z;
      const fwdX = -Math.sin(car.yaw), fwdZ = -Math.cos(car.yaw);
      const rightX = Math.cos(car.yaw), rightZ = -Math.sin(car.yaw);
      const long = dx * fwdX + dz * fwdZ;
      const lat = dx * rightX + dz * rightZ;
      const latWindow = o === sim.player.car ? 6 : 3;
      if (long > 0 && long < 22 && Math.abs(lat) < latWindow) {
        const gap = long - 4.4; // bumper to bumper
        if (gap < 22) desired = Math.min(desired, Math.max(0, (gap - 10) * 1.8));
        if (gap < 8.5) desired = 0;
        if (gap < sim.stats.minFollowGap) sim.stats.minFollowGap = gap;
      }
    }
    if (sim.time < car.slowUntil) desired = Math.min(desired, 2);
    // Approach the desired speed with limited accel / stronger braking.
    if (desired < car.speed) car.speed = Math.max(desired, car.speed - 8 * dt);
    else car.speed = Math.min(desired, car.speed + 3 * dt);
    car.s = (car.s + car.speed * dt) % route.length;
    const p = routePoint(route, car.s);
    car.x = p.x; car.z = p.z; car.yaw = p.yaw;
  }
  // Traffic-traffic overlaps (should stay 0).
  for (let i = 0; i < sim.traffic.length; i += 1) {
    for (let j = i + 1; j < sim.traffic.length; j += 1) {
      const a = sim.traffic[i], b = sim.traffic[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) < 4.5) sim.stats.trafficOverlaps += 1;
    }
  }
}

function stepPeds(sim, dt) {
  for (const p of sim.peds) {
    p.t += (p.dir * p.speed * dt) / 110;
    if (p.t >= 1) { p.t = 1; p.dir = -1; }
    if (p.t <= 0) { p.t = 0; p.dir = 1; }
    const x = p.from.x + (p.to.x - p.from.x) * p.t;
    const z = p.from.z + (p.to.z - p.from.z) * p.t;
    const dx = x - p.x, dz = z - p.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.001) p.yaw = Math.atan2(-dx, -dz);
    p.x = x; p.z = z;
  }
}

// --- Solmar PD ----------------------------------------------------------------------
// Signed distance from a point to a stop line along the line's axis.
function lineSigned(s, x, z) {
  return s.axis === 'z' ? z - s.z : x - s.x;
}

function addHeat(sim, n, why) {
  const pol = sim.police;
  pol.heat = Math.min(5, pol.heat + n);
  pol.lastInfraction = sim.time;
  pol.decayAt = sim.time + 25;
  sim.events.push({ type: 'heatUp', heat: pol.heat, why, t: sim.time });
}

function createPatrols(sim) {
  const route = sim.routes[0]; // the boulevard loop
  for (let i = 0; i < 2; i += 1) {
    const s = (i * 2400 + 300) % route.length;
    const p = routePoint(route, s);
    sim.police.patrols.push({
      kind: 'patrol', x: p.x, z: p.z, yaw: p.yaw, speed: 0, s,
      mode: 'patrol', color: '#1a1d24',
    });
  }
}

// Nearest route distance to a point (used when a patrol returns to its loop
// after a chase: the loop position it left is stale).
function nearestRouteS(route, x, z) {
  let bestS = 0, bestD = Infinity;
  for (let s = 0; s < route.length; s += 5) {
    const p = pointAtRaw(route.pts, route.cum, route.length, s);
    const d = Math.hypot(p[0] - x, p[1] - z);
    if (d < bestD) { bestD = d; bestS = s; }
  }
  return bestS;
}

function stepPolice(sim, dt) {
  const pol = sim.police;
  const p = sim.player;
  const pos = playerPos(sim);
  const pSpeed = p.mode === 'car' ? Math.abs(p.speed) : Math.abs(p.mara.speed);
  // How long the player has been slow (< 3 m/s): the chase only pulls up
  // close after 1.5 s stopped, so a 3-point turn or a waypoint stop never
  // gets a patrol in the player's face.
  pol.playerSlowFor = pSpeed < 3 ? pol.playerSlowFor + dt : 0;
  // HEAT decay: 1 level per 25 s clean and out of sight of every patrol.
  if (pol.heat > 0 && sim.time >= pol.decayAt) {
    const seen = pol.patrols.some((pt) => Math.hypot(pt.x - pos.x, pt.z - pos.z) < 60);
    if (!seen) {
      pol.heat = Math.max(0, pol.heat - 1);
      sim.events.push({ type: 'heatDown', heat: pol.heat, t: sim.time });
    }
    pol.decayAt = sim.time + 25;
  }
  const route = sim.routes[0];
  for (const pt of pol.patrols) {
    const mode = pol.heat >= 3 ? 'chase' : pol.heat >= 1 ? 'follow' : 'patrol';
    if (mode === 'patrol' && pt.mode !== 'patrol') pt.s = nearestRouteS(route, pt.x, pt.z);
    pt.mode = mode;
    const dPlayer = Math.hypot(pt.x - pos.x, pt.z - pos.z);
    let tx, tz, maxSpeed;
    if (mode === 'patrol') {
      const rp = routePoint(route, (pt.s + 12) % route.length);
      tx = rp.x; tz = rp.z; maxSpeed = 8;
    } else {
      // Hold a point behind the player: 25 m in follow, 12 m in chase, and
      // 4.5 m once the player has sat still 1.5 s (the arrest pull-up: right
      // on the bumper, just outside the 4.4 m OBB overlap, so the patrol
      // never shoves the player's car around). A patrol already inside its
      // hold distance stays put — it never turns around and drives away
      // from the player it is watching.
      const back = mode === 'chase' ? (pol.playerSlowFor > 1.5 ? 4.5 : 12) : 25;
      if (dPlayer <= back) {
        tx = pt.x; tz = pt.z; maxSpeed = 0;
      } else {
        // Behind the player: forward is (-sin yaw, -cos yaw), so behind is
        // (+sin yaw, +cos yaw).
        const pyaw = p.mode === 'car' ? p.yaw : p.mara.yaw;
        tx = pos.x + Math.sin(pyaw) * back;
        tz = pos.z + Math.cos(pyaw) * back;
        maxSpeed = mode === 'chase' ? 26 : 20;
      }
    }
    movePatrol(sim, pt, tx, tz, maxSpeed, dt);
    if (mode === 'patrol') pt.s = (pt.s + pt.speed * dt) % route.length;
  }
  // Arrest: HEAT 3+, player slow, a patrol within 5 m, held 3 s.
  const nearest = Math.min(...pol.patrols.map((pt) => Math.hypot(pt.x - pos.x, pt.z - pos.z)));
  if (pol.heat >= 3 && pSpeed < 3 && nearest < 5) {
    pol.arrestHold += dt;
    if (pol.arrestHold >= 3) doArrest(sim);
  } else pol.arrestHold = 0;
}

function movePatrol(sim, pt, tx, tz, maxSpeed, dt) {
  const dx = tx - pt.x, dz = tz - pt.z;
  const d = Math.hypot(dx, dz);
  // Yaw convention (same as routePoint): forward is (-sin yaw, -cos yaw),
  // so the yaw toward (dx, dz) is atan2(-dx, -dz).
  const targetYaw = Math.atan2(-dx, -dz);
  const dy = wrapAngle(targetYaw - pt.yaw);
  // Proportional approach: the patrol slows as it nears its hold point, so
  // it never overshoots into the player's bumper at 26 m/s. Gain 1.0 keeps
  // the steady-state lag behind a 15 m/s player near 16 m, not 40 m.
  let want = Math.min(maxSpeed, Math.max(0, (d - 1.5) * 1.0));
  // Brake hard before a sharp turn: a fast car that turns 180 deg while
  // still moving arcs straight into whatever it was chasing.
  if (Math.abs(dy) > 1.0) want = Math.min(want, 4);
  if (d < 1.5) want = 0;
  // Do not rear-end a traffic car ahead: match its speed, never stop dead.
  // Forward is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw).
  if (want > 0) {
    for (const o of sim.traffic) {
      const ox = o.x - pt.x, oz = o.z - pt.z;
      const fwd = -(ox * Math.sin(pt.yaw) + oz * Math.cos(pt.yaw));
      const lat = Math.abs(ox * Math.cos(pt.yaw) - oz * Math.sin(pt.yaw));
      if (fwd > 0 && fwd < 12 && lat < 3) { want = Math.min(want, o.speed); break; }
    }
  }
  pt.yaw = wrapAngle(pt.yaw + clamp(dy, -1.9 * dt, 1.9 * dt));
  if (pt.speed < want) pt.speed = Math.min(want, pt.speed + 14 * dt);
  else if (pt.speed > want) pt.speed = Math.max(want, pt.speed - 25 * dt);
  // Forward is (-sin yaw, -cos yaw), same as the player car.
  pt.x -= Math.sin(pt.yaw) * pt.speed * dt;
  pt.z -= Math.cos(pt.yaw) * pt.speed * dt;
  for (const b of sim.city.buildings) {
    if (Math.abs((b.x0 + b.x1) / 2 - pt.x) > (b.x1 - b.x0) / 2 + 6) continue;
    if (Math.abs((b.z0 + b.z1) / 2 - pt.z) > (b.z1 - b.z0) / 2 + 6) continue;
    const hit = obbVsAabb(pt.x, pt.z, pt.yaw, 1.0, 2.2, b);
    if (hit) { pt.x += hit.px; pt.z += hit.pz; }
  }
}

function doArrest(sim) {
  const pol = sim.police;
  pol.arrests += 1;
  pol.heat = 0;
  pol.arrestHold = 0;
  pol.decayAt = 0;
  pol.playerSlowFor = 0;
  const fine = 100;
  sim.player.cash = Math.max(0, sim.player.cash - fine);
  const wasCarrying = sim.player.carrying;
  const m = activeMission(sim);
  if (!sim.missions.done && m) {
    sim.missions.phase = 'pickup';
    sim.missions.timer = 0;
    sim.missions.timerRunning = false;
  }
  sim.player.carrying = false;
  // Tow the car to the spawn and put Mara on foot at the park centre.
  const car = sim.player.car;
  if (car) { car.x = sim.player.spawnX; car.z = sim.player.spawnZ; car.yaw = sim.player.spawnYaw; }
  sim.player.yaw = sim.player.spawnYaw;
  sim.player.speed = 0;
  sim.player.mara.x = 2410;
  sim.player.mara.z = 710;
  sim.player.mara.yaw = 0;
  sim.player.mode = 'foot';
  sim.player.car = null;
  setDialog(sim, 'Neri', `BUSTED — $${fine} fine, mission blown. Walk it off. The car is back at the depot and the money is gone.`, 6);
  sim.events.push({ type: 'arrested', fine, wasCarrying, cash: sim.player.cash, t: sim.time });
}

export function getPolice(sim) {
  return {
    heat: sim.police.heat,
    arrests: sim.police.arrests,
    patrols: sim.police.patrols.map((p) => ({ x: p.x, z: p.z, yaw: p.yaw, mode: p.mode })),
  };
}

export function stepSim(sim, input, dt) {
  sim.time += dt;
  const moving = input.fwd || input.back || input.left || input.right;
  if (moving && !sim.missions.done && !sim.missions.timerRunning) {
    sim.missions.timerRunning = true;
  }
  if (sim.missions.timerRunning && !sim.missions.done) sim.missions.timer += dt;
  if (sim.player.mode === 'car') stepPlayerCar(sim, input, dt);
  else stepMara(sim, input, dt);
  stepTraffic(sim, dt);
  stepPolice(sim, dt);
  stepPeds(sim, dt);
  sim.shake = Math.max(0, sim.shake - 2 * dt);
  for (const d of sim.dust) {
    d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    d.vy -= 9 * dt; d.life -= dt;
  }
  sim.dust = sim.dust.filter((d) => d.life > 0 && d.y > 0);
}

// --- Render getters (plain data for the renderer) ------------------------------------
export function getRenderCars(sim) {
  // City cars (parked + drivable + traffic at their live positions) + the
  // player car when Mara is on foot (it is one of the city cars already, so
  // nothing extra is needed — the player car IS a city car entry).
  return [...sim.city.cars, ...sim.traffic, ...sim.police.patrols];
}

export function getRenderPeds(sim) {
  return sim.peds.map((p) => ({ x: p.x, z: p.z, yaw: p.yaw, jacket: p.jacket }));
}

export function getMarkers(sim) {
  const t = activeTarget(sim);
  if (!t) return [];
  return [{ x: t.x, z: t.z, color: t.color, phase: t.phase, personInCar: t.personInCar, label: t.label }];
}

export function getLightStates(sim) {
  return sim.lights.map((l) => ({ x: l.x, z: l.z, state: stateForAxis(l, sim.time, l.axis) }));
}

export function getHeadlights(sim) {
  if (sim.player.mode !== 'car' || !sim.player.car) return null;
  const c = sim.player.car;
  return { x: c.x, z: c.z, yaw: sim.player.yaw, on: true };
}

// --- Autopilot (tests + browser ?autotest=missions) ----------------------------------
export function runMissionAutopilot(sim, maxSeconds = 1200, trace = null) {
  const dt = 1 / 60;
  const result = { cash: 0, perMission: [], collisions: 0, redRuns: 0, steps: 0, done: false, error: null, finalTime: 0 };
  let leg = 0;
  let wp = 0;
  let legTime = 0;
  let finalWpTime = 0; // time spent stopped at the final waypoint (NOT the whole leg)
  let overtakeSide = 0; // -1 pass left, +1 pass right, 0 not overtaking
  let overtakeObj = null; // the car being overtaken, until it is behind us
  const legs = MISSION_ROUTES;
  const totalSteps = Math.floor(maxSeconds / dt);
  for (let step = 0; step < totalSteps; step += 1) {
    result.steps = step;
    const target = activeTarget(sim);
    if (!target && sim.missions.done) { result.done = true; break; }
    if (!target) { result.error = 'no active target'; break; }
    const route = legs[leg];
    if (!route) { result.error = 'no route for leg ' + leg; break; }
    if (wp >= route.length) { result.error = 'waypoint overrun leg ' + leg; break; }
    const [tx, tz] = route[wp];
    const pos = playerPos(sim);
    const dx = tx - pos.x, dz = tz - pos.z;
    const dist = Math.hypot(dx, dz);
    const lastWp = wp === route.length - 1;
    // Arrived at the final waypoint: stop, then Q.
    if (lastWp && dist < 5.5) {
      const input = { fwd: false, back: Math.abs(sim.player.speed) > 1, left: false, right: false, handbrake: false };
      stepSim(sim, input, dt);
      legTime += dt;
      finalWpTime += dt;
      if (Math.abs(sim.player.speed) < 1.5) {
        const before = sim.player.cash;
        if (collect(sim)) {
          if (leg % 2 === 1) {
            // A delivery leg: record the mission (the finale leaves phase at
            // 'dropoff', so the phase check would miss mission 4).
            const m = MISSIONS[Math.floor(leg / 2)];
            result.perMission.push({ id: m.id, title: m.title, reward: m.reward, cash: sim.player.cash });
          }
          leg += 1; wp = 0; legTime = 0;
          if (sim.missions.done) { result.done = true; break; }
        } else if (finalWpTime > 10) {
          result.error = 'Q did not collect/deliver at leg ' + leg;
          break;
        }
      }
      if (finalWpTime > 30) { result.error = 'leg timeout at final waypoint ' + leg; break; }
      continue;
    }
    finalWpTime = 0;
    if (dist < 6 && !lastWp) { wp += 1; continue; }
    // Steer toward the waypoint. A parked car (or slow traffic) ahead gets
    // overtaken: shift the aim point 8 m to the side opposite the obstacle
    // and keep the shift until the obstacle is behind us.
    const car = sim.player.car;
    let aimX = tx, aimZ = tz;
    let obstacle = null;
    if (car) {
      const frame = (o) => {
        const ox = o.x - car.x, oz = o.z - car.z;
        const fwdX = -Math.sin(sim.player.yaw), fwdZ = -Math.cos(sim.player.yaw);
        const rightX = Math.cos(sim.player.yaw), rightZ = -Math.sin(sim.player.yaw);
        return { long: ox * fwdX + oz * fwdZ, lat: ox * rightX + oz * rightZ };
      };
      if (overtakeObj) {
        const f = frame(overtakeObj);
        if (f.long < -6 || dist < 25) { overtakeObj = null; overtakeSide = 0; }
        else obstacle = f;
      }
      if (!overtakeObj) {
        // Scan range grows with speed: at 30 m/s a 16 m scan is 0.5 s of warning.
        // No new overtake near a waypoint turn: the overtake aim (20 m ahead)
        // would carry the car past the turn and off the road.
        const scan = dist > 40 ? Math.max(16, Math.abs(sim.player.speed) * 1.5) : 0;
        for (const o of [...sim.traffic, ...sim.city.cars, ...sim.police.patrols]) {
          if (o === car) continue;
          const f = frame(o);
          if (f.long > 0 && f.long < scan && Math.abs(f.lat) < 3.5) {
            overtakeObj = o;
            overtakeSide = f.lat >= 0 ? -1 : 1;
            obstacle = f;
            break;
          }
        }
      }
    }
    if (overtakeObj && overtakeSide !== 0 && car) {
      // Aim at a NEAR point (20 m ahead, 8 m to the side): shifting the far
      // waypoint by 8 m barely changes the steering angle and the car would
      // drive straight into the obstacle.
      const fwdX = -Math.sin(sim.player.yaw), fwdZ = -Math.cos(sim.player.yaw);
      const rightX = Math.cos(sim.player.yaw), rightZ = -Math.sin(sim.player.yaw);
      aimX = car.x + fwdX * 20 + rightX * overtakeSide * 8;
      aimZ = car.z + fwdZ * 20 + rightZ * overtakeSide * 8;
    } else {
      // Pure pursuit: steer at a point 30 m ahead toward the waypoint, not at
      // the far waypoint itself — a 30 m lateral error at a 1,000 m lookahead
      // is a 0.03 rad correction, so the car would hug the curb for hundreds
      // of metres instead of returning to the road centre.
      const d = Math.hypot(tx - pos.x, tz - pos.z);
      const look = Math.min(30, d);
      aimX = pos.x + ((tx - pos.x) / (d || 1)) * look;
      aimZ = pos.z + ((tz - pos.z) / (d || 1)) * look;
    }
    const adx = aimX - pos.x, adz = aimZ - pos.z;
    const desiredYaw = Math.atan2(-adx, -adz);
    const yawDiff = wrapAngle(desiredYaw - sim.player.yaw);
    const speed = Math.abs(sim.player.speed);
    let input;
    if (Math.abs(yawDiff) > 2.2 && speed < 5) {
      // 3-point turn, reverse phase only: reverse while steering the opposite
      // way rotates the car toward the target. Reverse for ~1 s only — a long
      // reverse drifts the car tens of metres off the road; the forward phase
      // below completes the rotation while moving toward the target.
      input = { fwd: false, back: true, left: yawDiff < 0, right: yawDiff > 0, handbrake: false };
    } else {
      const steer = clamp(yawDiff * 2.2, -1, 1);
      const wantSpeed = Math.abs(yawDiff) > 0.5 ? 8 : Math.abs(yawDiff) > 0.25 ? 12 : dist < 30 ? 10 : 30;
      let capped = wantSpeed;
      if (obstacle) capped = Math.min(capped, 6);
      input = {
        fwd: speed < capped,
        back: speed > capped + 3,
        left: steer > 0.05,
        right: steer < -0.05,
        handbrake: false,
      };
    }
    stepSim(sim, input, dt);
    legTime += dt;
    // Per-leg timeout from the route length (all 8 legs total ~22,300 m; a
    // 150 s flat budget is shorter than the longest leg's drive alone).
    let legLen = 0;
    for (let i = 1; i < route.length; i += 1) legLen += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
    const legTimeout = legLen / 15 + 60;
    if (trace) {
      const car = sim.player.car;
      trace({
        t: sim.time, leg, wp, x: car ? car.x : sim.player.mara.x, z: car ? car.z : sim.player.mara.z,
        yaw: sim.player.yaw, speed: sim.player.speed, dist, aimX, aimZ,
        overtake: overtakeObj ? overtakeSide : 0, damage: sim.player.damage,
      });
    }
    if (legTime > legTimeout) { result.error = 'leg timeout ' + leg + ' (wp ' + wp + ', dist ' + dist.toFixed(1) + ')'; break; }
  }
  result.cash = sim.player.cash;
  result.collisions = sim.stats.collisions;
  result.redRuns = sim.stats.redRuns;
  result.finalTime = sim.missions.timer;
  if (!result.done && !result.error) result.error = 'max time reached';
  return result;
}

export { SEED, CITY_W, CITY_H, generateCity };
