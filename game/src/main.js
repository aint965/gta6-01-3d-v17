// Palkon Auto — Stage B entrypoint: the game now runs on sim.js (driving profiles,
// traffic, headlights, collisions, on-foot + E, missions 1-4). Chase camera,
// arcade drive, HUD + minimap, three lighting presets, staged screenshot scenes
// (?shot=day|sunset|night|plaza), mission autotest (?autotest=missions) and the
// headlight pixel test (?test=headlight). ?seed=N fixes the city; the default
// seed is the competition seed 20261123.
import { generateCity, districtAt, SEED } from './city.js';
import {
  createSim, stepSim, activeTarget, getMarkers, getLightStates, getHeadlights,
  getRenderCars, getRenderPeds, runMissionAutopilot, collect, dropCargo,
  interact, nearestDrivable, nearTarget, MISSIONS, PROFILES,
} from './sim.js';
import { createRenderer, PRESETS } from './render.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const autotest = params.has('autotest');
const headlightTest = params.get('test') === 'headlight';
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : SEED;

const city = generateCity(seed);
const canvas = document.getElementById('game');
const renderer = createRenderer(canvas, city);

const DISTRICT_COLORS = { old: '#c98f5f', glass: '#7fa8b8', citrus: '#e8c46a', market: '#d77f69', canal: '#398e99', marina: '#bcd6de', beach: '#ead8b2' };

const sim = createSim(city, { startInCar: shot || headlightTest || autotest ? true : false });
let preset = 'sunset';
let camPos = [400, 8, 1530];
let camTarget = [400, 4, 1490];

const el = (id) => document.getElementById(id);
const hudDistrict = el('hud-district');
const hudObjective = el('hud-objective');
const hudDialog = el('hud-dialog');
const hudPrompt = el('hud-prompt');
const hudCompass = el('hud-compass');
const hudSpeed = el('hud-speed-num');
const hudPreset = el('hud-preset');
const hudCash = el('hud-cash');
const hudDamage = el('hud-damage');
const hudProfile = el('hud-profile');
const minimap = el('minimap');
const mm = minimap.getContext('2d');

const PROFILE_ORDER = ['compact', 'sedan', 'van', 'coupe'];

function playerPos() {
  const p = sim.player;
  return p.mode === 'car' && p.car ? { x: p.car.x, z: p.car.z, yaw: p.yaw } : { x: p.mara.x, z: p.mara.z, yaw: p.mara.yaw };
}

const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Digit1') preset = 'midday';
  if (e.code === 'Digit2') preset = 'sunset';
  if (e.code === 'Digit3') preset = 'night';
  if (e.code === 'KeyT') preset = preset === 'midday' ? 'sunset' : preset === 'sunset' ? 'night' : 'midday';
  if (e.code === 'Digit4') sim.player.profile = 'compact';
  if (e.code === 'Digit5') sim.player.profile = 'sedan';
  if (e.code === 'Digit6') sim.player.profile = 'van';
  if (e.code === 'Digit7') sim.player.profile = 'coupe';
  if (e.code === 'KeyB') {
    const i = PROFILE_ORDER.indexOf(sim.player.profile);
    sim.player.profile = PROFILE_ORDER[(i + 1) % PROFILE_ORDER.length];
  }
  if (e.code === 'KeyQ') collect(sim);
  if (e.code === 'KeyX') dropCargo(sim);
  if (e.code === 'KeyE') interact(sim);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function readInput() {
  return {
    fwd: keys.has('KeyW') || keys.has('ArrowUp'),
    back: keys.has('KeyS') || keys.has('ArrowDown'),
    left: keys.has('KeyA') || keys.has('ArrowLeft'),
    right: keys.has('KeyD') || keys.has('ArrowRight'),
    handbrake: keys.has('Space'),
  };
}

function updateCamera(dt) {
  const pos = playerPos();
  const fx = -Math.sin(pos.yaw), fz = -Math.cos(pos.yaw);
  const speed = Math.abs(sim.player.speed);
  const dist = 13 + speed * 0.12;
  const height = 5.5 + speed * 0.05;
  const want = [pos.x - fx * dist, height, pos.z - fz * dist];
  const k = Math.min(1, dt * 5);
  camPos = [camPos[0] + (want[0] - camPos[0]) * k, camPos[1] + (want[1] - camPos[1]) * k, camPos[2] + (want[2] - camPos[2]) * k];
  camTarget = [pos.x + fx * 10, 2, pos.z + fz * 10];
  // Collision shake: a small random offset scaled by the sim's shake.
  if (sim.shake > 0.01) {
    camPos[0] += (Math.random() - 0.5) * sim.shake * 0.9;
    camPos[1] += (Math.random() - 0.5) * sim.shake * 0.6;
    camPos[2] += (Math.random() - 0.5) * sim.shake * 0.9;
  }
}

function compassText() {
  const dx = camTarget[0] - camPos[0], dz = camTarget[2] - camPos[2];
  const deg = (Math.atan2(-dx, -dz) * 180 / Math.PI + 360) % 360;
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const name = names[Math.round(deg / 45) % 8];
  let strip = '';
  for (let off = -60; off <= 60; off += 15) {
    const d = (Math.round(deg) + off + 360) % 360;
    const card = d % 90 === 0 ? ['N', 'E', 'S', 'W'][Math.round(d / 90) % 4] : '·';
    strip += off === 0 ? `[${name}]` : ` ${card} `;
  }
  return `${name} ${Math.round(deg)}°  ${strip}`;
}

function drawMinimap() {
  const W = minimap.width, H = minimap.height;
  const sx = W / 3840, sz = H / 3456;
  mm.fillStyle = '#142d38';
  mm.fillRect(0, 0, W, H);
  mm.fillStyle = '#2f7d8a';
  mm.fillRect(city.canal.x0 * sx, city.canal.z0 * sz, (city.canal.x1 - city.canal.x0) * sx, (city.canal.z1 - city.canal.z0) * sz);
  mm.fillRect(city.harbour.x0 * sx, city.harbour.z0 * sz, (city.harbour.x1 - city.harbour.x0) * sx, (city.harbour.z1 - city.harbour.z0) * sz);
  mm.fillStyle = '#e8d9a8';
  mm.fillRect(city.beach.x0 * sx, city.beach.z0 * sz, (city.beach.x1 - city.beach.x0) * sx, (city.beach.z1 - city.beach.z0) * sz);
  mm.fillStyle = '#56856b';
  mm.fillRect(city.park.x0 * sx, city.park.z0 * sz, (city.park.x1 - city.park.x0) * sx, (city.park.z1 - city.park.z0) * sz);
  mm.fillStyle = '#4a4f55';
  for (const r of city.roads) mm.fillRect(r.x0 * sx, r.z0 * sz, (r.x1 - r.x0) * sx, (r.z1 - r.z0) * sz);
  for (const b of city.buildings) {
    mm.fillStyle = DISTRICT_COLORS[b.district] || '#888888';
    mm.fillRect(b.x0 * sx, b.z0 * sz, Math.max(1, (b.x1 - b.x0) * sx), Math.max(1, (b.z1 - b.z0) * sz));
  }
  mm.strokeStyle = '#ffd28a';
  mm.lineWidth = 1.5;
  mm.strokeRect(city.plaza.x0 * sx, city.plaza.z0 * sz, (city.plaza.x1 - city.plaza.x0) * sx, (city.plaza.z1 - city.plaza.z0) * sz);
  // Mission marker dot (yellow diamond).
  for (const mk of getMarkers(sim)) {
    mm.fillStyle = mk.color || '#ffd21a';
    mm.save();
    mm.translate(mk.x * sx, mk.z * sz);
    mm.rotate(Math.PI / 4);
    mm.fillRect(-4, -4, 8, 8);
    mm.restore();
  }
  // Player arrow, rotated by heading (yaw 0 = north = up).
  const pos = playerPos();
  mm.save();
  mm.translate(pos.x * sx, pos.z * sz);
  mm.rotate(-pos.yaw);
  mm.fillStyle = sim.player.mode === 'car' ? '#ff5a3c' : '#ffd21a';
  mm.beginPath();
  mm.moveTo(0, -7); mm.lineTo(5, 5); mm.lineTo(-5, 5); mm.closePath();
  mm.fill();
  mm.restore();
}

let lastHud = 0;
function updateHud(now) {
  if (now - lastHud < 120) return;
  lastHud = now;
  const pos = playerPos();
  const d = districtAt(pos.x, pos.z);
  hudDistrict.textContent = `${d.name} — ${d.tagline} · Standing ${d.standing}`;
  hudCompass.textContent = compassText();
  const kmh = sim.player.mode === 'car' ? Math.abs(sim.player.speed) * 3.6 : 0;
  hudSpeed.textContent = `${Math.round(kmh)}`;
  hudPreset.textContent = `${PRESETS[preset].name} · 1/2/3 or T to change light`;
  hudCash.textContent = `$${sim.player.cash.toLocaleString('en-US')}`;
  hudDamage.textContent = sim.player.damage > 0 ? `Damage ${Math.round(sim.player.damage)}%` : '';
  hudProfile.textContent = sim.player.mode === 'car'
    ? `${PROFILES[sim.player.profile].name} · 4/5/6/7 or B to change car`
    : 'On foot · E near a car to get in';
  // Objective: current mission + target (dialog + HUD + world marker, all three).
  const m = MISSIONS[sim.missions.index];
  if (sim.missions.done) {
    hudObjective.textContent = 'All missions complete — Solmar is yours. The Glass Debt is settled.';
  } else if (m) {
    const t = activeTarget(sim);
    hudObjective.textContent = `Mission ${m.id}: ${m.title} — ${sim.missions.phase === 'pickup' ? 'collect' : 'deliver'}: ${t ? t.label : ''} · $${m.reward}`;
  }
  // Mission dialog banner (speaker + text while it is live).
  const dlg = sim.missions.dialog;
  if (dlg && sim.time < dlg.until) {
    hudDialog.style.display = 'block';
    hudDialog.textContent = `${dlg.speaker}: ${dlg.text}`;
  } else {
    hudDialog.style.display = 'none';
  }
  // Context prompt: E / Q / X.
  let prompt = '';
  if (sim.player.mode === 'foot') {
    const near = nearestDrivable(sim);
    if (near) prompt = 'E — Get in the car';
  } else {
    if (nearTarget(sim)) prompt = 'Q — Collect / deliver';
    else if (sim.player.carrying) prompt = 'X — Drop cargo · E — Get out';
    else prompt = 'E — Get out';
  }
  hudPrompt.textContent = prompt;
  hudPrompt.style.display = prompt ? 'block' : 'none';
  drawMinimap();
}

function renderFrame() {
  const view = {
    cam: camPos, target: camTarget, preset,
    cars: getRenderCars(sim),
    peds: getRenderPeds(sim),
    mara: sim.player.mode === 'foot' ? { x: sim.player.mara.x, z: sim.player.mara.z, yaw: sim.player.mara.yaw } : null,
    markers: getMarkers(sim),
    lights: getLightStates(sim),
    headlights: getHeadlights(sim),
    time: sim.time,
  };
  renderer.draw(view);
  return view;
}

const SHOTS = {
  day: { preset: 'midday', cam: [400, 10, 3050], target: [400, 12, 1700], player: { x: 410, z: 3005, yaw: 0 } },
  sunset: { preset: 'sunset', cam: [430, 4, 2200], target: [250, 12, 1300], player: { x: 415, z: 2155, yaw: 0 } },
  night: { preset: 'night', cam: [372, 4, 1950], target: [380, 14, 1500], player: { x: 410, z: 1905, yaw: 0 } },
  plaza: { preset: 'sunset', cam: [900, 220, 2400], target: [400, 0, 1728], player: { x: 410, z: 1900, yaw: 0 } },
};

function runShot(name) {
  const s = SHOTS[name] || SHOTS.day;
  preset = s.preset;
  camPos = [...s.cam];
  camTarget = [...s.target];
  const car = sim.player.car;
  if (car) { car.x = s.player.x; car.z = s.player.z; car.yaw = s.player.yaw; sim.player.yaw = s.player.yaw; sim.player.speed = 0; }
  updateHud(performance.now());
  let painted = 0;
  function paint() {
    renderFrame();
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else {
      window.__shotReady = true;
      window.__stats = { ...renderer.stats, cars: getRenderCars(sim).length, buildings: city.buildings.length, peds: getRenderPeds(sim).length };
    }
  }
  requestAnimationFrame(paint);
}

// --- Headlight pixel test (?test=headlight) -------------------------------------
// Night scene: player in a car at (400,2000) facing north, a traffic car 15 m
// ahead at (400,1985). __headlightTest() renders cones on/off x haze on/off and
// samples the asphalt ahead, the roof of the car ahead, and an unlit control
// patch — all via canvas readback in the same JS task (the drawing buffer is
// only guaranteed valid until the task ends).
function setupHeadlightScene() {
  preset = 'night';
  const car = sim.player.car;
  if (car) { car.x = 400; car.z = 2000; car.yaw = 0; sim.player.yaw = 0; sim.player.speed = 0; }
  const ahead = sim.traffic[0];
  if (ahead) { ahead.x = 400; ahead.z = 1985; ahead.yaw = 0; ahead.speed = 0; }
  camPos = [400, 5.5, 2013];
  camTarget = [400, 2, 1990];
  updateHud(performance.now());
  renderFrame();
  window.__headlightReady = true;
}

function samplePatch(gl, view, point, size = 16) {
  const p = renderer.projectWorld(view, point);
  if (p.behind) return { mean: [0, 0, 0], pixels: [] };
  const w = canvas.width, h = canvas.height;
  const cx = Math.round(p.x), cy = Math.round(p.y); // top-left origin
  const x0 = Math.max(0, cx - size / 2), y0 = Math.max(0, cy - size / 2);
  const rw = Math.min(size, w - x0), rh = Math.min(size, h - y0);
  // readPixels uses a bottom-left origin.
  const buf = new Uint8Array(rw * rh * 4);
  gl.readPixels(x0, h - y0 - rh, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const pixels = [];
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < rw * rh; i += 1) {
    const pr = buf[i * 4], pg = buf[i * 4 + 1], pb = buf[i * 4 + 2];
    pixels.push([pr, pg, pb]);
    r += pr; g += pg; b += pb;
  }
  const n = rw * rh || 1;
  return { mean: [r / n, g / n, b / n], pixels };
}

window.__headlightTest = function () {
  const gl = renderer.gl;
  const patches = {
    asphalt: [400, 0.1, 1980], // road 20 m ahead of the player car (inside the pool)
    roof: [400, 2.0, 1985], // roof of the traffic car 15 m ahead
    control: [430, 0.1, 1980], // off to the side: outside the cones
  };
  const combos = {};
  for (const cones of [true, false]) {
    for (const haze of [true, false]) {
      const view = {
        cam: camPos, target: camTarget, preset: 'night',
        cars: getRenderCars(sim), peds: [], mara: null, markers: [],
        lights: getLightStates(sim),
        headlights: cones ? getHeadlights(sim) : null,
        haze, time: 0,
      };
      renderer.draw(view);
      const key = `cones${cones ? 'On' : 'Off'}_haze${haze ? 'On' : 'Off'}`;
      combos[key] = {};
      for (const [name, point] of Object.entries(patches)) combos[key][name] = samplePatch(gl, view, point);
    }
  }
  const gain = (on, off) => [on[0] - off[0], on[1] - off[1], on[2] - off[2]];
  const meanGain = (g) => (g[0] + g[1] + g[2]) / 3;
  const fracAbove = (pxOn, pxOff, thresh) => {
    let n = 0;
    for (let i = 0; i < pxOn.length; i += 1) {
      const d = ((pxOn[i][0] + pxOn[i][1] + pxOn[i][2]) - (pxOff[i][0] + pxOff[i][1] + pxOff[i][2])) / 3;
      if (d > thresh) n += 1;
    }
    return pxOn.length ? n / pxOn.length : 0;
  };
  const result = { combos: {}, checks: {} };
  for (const haze of ['On', 'Off']) {
    const on = combos[`conesOn_haze${haze}`], off = combos[`conesOff_haze${haze}`];
    const aGain = gain(on.asphalt.mean, off.asphalt.mean);
    const rGain = gain(on.roof.mean, off.roof.mean);
    const cGain = gain(on.control.mean, off.control.mean);
    result.checks[`haze${haze}`] = {
      asphaltMeanGain: meanGain(aGain),
      asphaltFracAbove10: fracAbove(on.asphalt.pixels, off.asphalt.pixels, 10),
      roofMeanGain: meanGain(rGain),
      controlMeanGain: meanGain(cGain),
      pass: meanGain(aGain) >= 20 && fracAbove(on.asphalt.pixels, off.asphalt.pixels, 10) >= 0.9
        && meanGain(rGain) >= 20 && Math.abs(meanGain(cGain)) <= 1,
    };
  }
  // Keep only means in the compact result; the pixel arrays stay on the combos.
  for (const [k, v] of Object.entries(combos)) {
    result.combos[k] = {};
    for (const [name, s] of Object.entries(v)) result.combos[k][name] = { mean: s.mean.map((x) => +x.toFixed(1)) };
  }
  result.pass = result.checks.hazeOn.pass && result.checks.hazeOff.pass;
  window.__headlightResult = result;
  return result;
};

// --- Mission autotest (?autotest=missions) --------------------------------------
// Runs the sim autopilot synchronously, then renders one frame of the end state.
function runAutotest() {
  const res = runMissionAutopilot(sim, 1200);
  updateHud(performance.now());
  renderFrame();
  window.__autotest = res;
  window.__autotestDone = true;
  window.__ready = true;
}

function runGame() {
  let last = performance.now();
  let acc = 0;
  let ready = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    acc += dt;
    while (acc >= 1 / 60) { stepSim(sim, readInput(), 1 / 60); acc -= 1 / 60; }
    updateCamera(dt);
    renderFrame();
    updateHud(now);
    if (!ready) {
      ready = true;
      window.__ready = true;
      window.__stats = { ...renderer.stats, cars: getRenderCars(sim).length, buildings: city.buildings.length, peds: getRenderPeds(sim).length };
    }
  }
  requestAnimationFrame(frame);
}

// Debug hook for the driver: authoritative sim state (the HUD text lags the sim).
window.__simState = function () {
  const pos = playerPos();
  return {
    mode: sim.player.mode, speedKmh: Math.round(Math.abs(sim.player.speed) * 3.6),
    x: +pos.x.toFixed(1), z: +pos.z.toFixed(1), yaw: +pos.yaw.toFixed(2),
    cash: sim.player.cash, damage: Math.round(sim.player.damage),
    mission: sim.missions.index + 1, phase: sim.missions.phase,
    objective: document.getElementById('hud-objective').textContent,
  };
};

if (headlightTest) setupHeadlightScene();
else if (autotest) runAutotest();
else if (shot) runShot(shot);
else runGame();
