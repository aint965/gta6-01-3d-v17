// Palkon Auto — Stage A entrypoint: chase camera, arcade drive, HUD + minimap,
// three lighting presets, and staged screenshot scenes (?shot=day|sunset|night|plaza).
// ?seed=N fixes the city; the default seed is the competition seed 20261123.
import { generateCity, districtAt, SEED } from './city.js';
import { createRenderer, PRESETS } from './render.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : SEED;

const city = generateCity(seed);
const canvas = document.getElementById('game');
const renderer = createRenderer(canvas, city);

const DISTRICT_COLORS = { old: '#c98f5f', glass: '#7fa8b8', citrus: '#e8c46a', market: '#d77f69', canal: '#398e99', marina: '#bcd6de', beach: '#ead8b2' };

const player = { x: 400, z: 2900, yaw: 0, speed: 0, color: '#d77f69', kind: 'drivable', taxi: false };
let preset = 'sunset';
let camPos = [400, 8, 2930];
let camTarget = [400, 4, 2800];

const el = (id) => document.getElementById(id);
const hudDistrict = el('hud-district');
const hudObjective = el('hud-objective');
const hudCompass = el('hud-compass');
const hudSpeed = el('hud-speed-num');
const hudPreset = el('hud-preset');
const minimap = el('minimap');
const mm = minimap.getContext('2d');

const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Digit1') preset = 'midday';
  if (e.code === 'Digit2') preset = 'sunset';
  if (e.code === 'Digit3') preset = 'night';
  if (e.code === 'KeyT') preset = preset === 'midday' ? 'sunset' : preset === 'sunset' ? 'night' : 'midday';
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function stepPlayer(dt) {
  const fwd = keys.has('KeyW') || keys.has('ArrowUp');
  const back = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  if (fwd) player.speed += 14 * dt;
  else if (back) player.speed -= (player.speed > 0.5 ? 22 : 9) * dt;
  else player.speed -= Math.sign(player.speed) * Math.min(Math.abs(player.speed), 7 * dt);
  player.speed = Math.max(-10, Math.min(40, player.speed));
  const steer = (left ? 1 : 0) - (right ? 1 : 0);
  player.yaw += steer * Math.max(-1, Math.min(1, player.speed / 12)) * 1.7 * dt;
  player.x += -Math.sin(player.yaw) * player.speed * dt;
  player.z += -Math.cos(player.yaw) * player.speed * dt;
  player.x = Math.max(20, Math.min(3820, player.x));
  player.z = Math.max(20, Math.min(3436, player.z));
}

function updateCamera(dt) {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  // The camera pulls back and rises slightly with speed, so fast driving still reads.
  const dist = 13 + Math.abs(player.speed) * 0.12;
  const height = 5.5 + Math.abs(player.speed) * 0.05;
  const want = [player.x - fx * dist, height, player.z - fz * dist];
  const k = Math.min(1, dt * 5);
  camPos = [camPos[0] + (want[0] - camPos[0]) * k, camPos[1] + (want[1] - camPos[1]) * k, camPos[2] + (want[2] - camPos[2]) * k];
  camTarget = [player.x + fx * 10, 2, player.z + fz * 10];
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
  // Player arrow, rotated by heading (yaw 0 = north = up).
  mm.save();
  mm.translate(player.x * sx, player.z * sz);
  mm.rotate(-player.yaw);
  mm.fillStyle = '#ff5a3c';
  mm.beginPath();
  mm.moveTo(0, -7); mm.lineTo(5, 5); mm.lineTo(-5, 5); mm.closePath();
  mm.fill();
  mm.restore();
}

let lastHud = 0;
function updateHud(now) {
  if (now - lastHud < 120) return;
  lastHud = now;
  const d = districtAt(player.x, player.z);
  hudDistrict.textContent = `${d.name} — ${d.tagline} · Standing ${d.standing}`;
  hudCompass.textContent = compassText();
  hudSpeed.textContent = `${Math.round(Math.abs(player.speed) * 3.6)}`;
  hudPreset.textContent = `${PRESETS[preset].name} · 1/2/3 or T to change light`;
  drawMinimap();
}

const SHOTS = {
  day: { preset: 'midday', cam: [400, 10, 3050], target: [400, 12, 1700], player: { x: 410, z: 3005, yaw: 0 } },
  sunset: { preset: 'sunset', cam: [430, 4, 2200], target: [250, 12, 1300], player: { x: 415, z: 2155, yaw: 0 } },
  night: { preset: 'night', cam: [372, 4, 1950], target: [380, 14, 1500], player: { x: 410, z: 1905, yaw: 0 } },
  plaza: { preset: 'sunset', cam: [900, 220, 2400], target: [400, 0, 1728], player: { x: 410, z: 1900, yaw: 0 } },
};

function renderFrame() {
  const cars = [...city.cars, player];
  renderer.draw({ cam: camPos, target: camTarget, preset, cars });
}

function runShot(name) {
  const s = SHOTS[name] || SHOTS.day;
  preset = s.preset;
  camPos = [...s.cam];
  camTarget = [...s.target];
  player.x = s.player.x; player.z = s.player.z; player.yaw = s.player.yaw; player.speed = 0;
  hudObjective.textContent = 'Drive to the plaza — follow the boulevard north';
  updateHud(performance.now());
  let painted = 0;
  function paint() {
    renderFrame();
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else {
      window.__shotReady = true;
      window.__stats = { ...renderer.stats, cars: city.cars.length + 1, buildings: city.buildings.length };
    }
  }
  requestAnimationFrame(paint);
}

function runGame() {
  hudObjective.textContent = 'Drive to the plaza — follow the boulevard north';
  let last = performance.now();
  let acc = 0;
  let ready = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    acc += dt;
    while (acc >= 1 / 60) { stepPlayer(1 / 60); acc -= 1 / 60; }
    updateCamera(dt);
    renderFrame();
    updateHud(now);
    if (!ready) {
      ready = true;
      window.__ready = true;
      window.__stats = { ...renderer.stats, cars: city.cars.length + 1, buildings: city.buildings.length };
    }
  }
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
