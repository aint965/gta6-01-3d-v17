// Stage B browser driver: drive-day gameplay shot, headlight pixel test, and the
// mission autotest — all in the headless-shell Chromium via CDP.
// Run `node checks/drive.mjs` from the repo root with the dev server up on :8128.
// Screenshots go to checks/shots/ (NOT screenshots/ — that folder is reserved
// for the four final Stage C shots).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9224;
const BASE = 'http://127.0.0.1:8128';
const OUT = join(fileURLToPath(new URL('.', import.meta.url)), 'shots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}

const chrome = spawn(CHROME, [
  '--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,720', 'about:blank',
], { stdio: 'ignore' });

let exitCode = 0;
const results = {};
try {
  if (!await waitHttp(`http://127.0.0.1:${PORT}/json/version`)) throw new Error('chrome devtools did not come up');
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
  });
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);

  const errors = [];
  const failedReqs = [];
  const drainEvents = () => {
    while (events.length) {
      const e = events.shift();
      if (e.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION: ' + JSON.stringify(e.params.exceptionDetails).slice(0, 400));
      if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') errors.push('CONSOLE: ' + e.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
      if (e.method === 'Network.loadingFailed') failedReqs.push(e.params.errorText);
      if (e.method === 'Network.responseReceived' && e.params.response.status >= 400) failedReqs.push(`${e.params.response.status} ${e.params.response.url}`);
    }
  };
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    if (r.result?.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  };
  const waitFor = async (expression, timeoutMs = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await sleep(500);
      drainEvents();
      if (await evalJs(expression) === true) return true;
    }
    return false;
  };
  const key = async (type, code, k) => {
    await send('Input.dispatchKeyEvent', { type, code, key: k, windowsVirtualKeyCode: 0 }, sessionId);
  };
  const screenshot = async (name, quality = 82) => {
    const cap = await send('Page.captureScreenshot', { format: 'jpeg', quality }, sessionId);
    const file = join(OUT, name);
    writeFileSync(file, Buffer.from(cap.result.data, 'base64'));
    return { file, size: statSync(file).size };
  };

  mkdirSync(OUT, { recursive: true });

  // 1. Gameplay: enter the car, midday, drive north 3 s, screenshot.
  events.length = 0;
  await send('Page.navigate', { url: BASE + '/' }, sessionId);
  if (!await waitFor('window.__ready === true', 30000)) throw new Error('game never became ready');
  await key('keyDown', 'KeyE', 'e'); await key('keyUp', 'KeyE', 'e'); // get in the car
  await sleep(800);
  await key('keyDown', 'Digit1', '1'); await key('keyUp', 'Digit1', '1'); // midday
  await sleep(500);
  await key('keyDown', 'KeyW', 'w');
  await sleep(3000);
  await key('keyUp', 'KeyW', 'w');
  await sleep(800);
  drainEvents();
  const driveShot = await screenshot('drive-day.jpg');
  await sleep(300);
  const driveHud = await evalJs('JSON.stringify(window.__simState ? window.__simState() : {speed: document.getElementById("hud-speed-num").textContent})');
  results.driveDay = { ...driveShot, hud: JSON.parse(driveHud) };

  // 2. Headlight test: screenshot the cones-on night scene FIRST (the test
  // leaves a cones-off frame on screen), then run the pixel test.
  events.length = 0;
  await send('Page.navigate', { url: BASE + '/?test=headlight' }, sessionId);
  if (!await waitFor('window.__headlightReady === true', 30000)) throw new Error('headlight scene never became ready');
  await sleep(1000);
  drainEvents();
  const nightShot = await screenshot('night-headlight.jpg');
  const hlResult = await evalJs('JSON.stringify(window.__headlightTest())');
  results.headlight = { ...nightShot, result: JSON.parse(hlResult) };

  // 3. Mission autotest: synchronous in-page autopilot; the headless shell is
  // slow, so allow up to 240 s.
  events.length = 0;
  await send('Page.navigate', { url: BASE + '/?autotest=missions' }, sessionId);
  const autoReady = await waitFor('window.__autotestDone === true', 240000);
  if (!autoReady) throw new Error('autotest never finished');
  drainEvents();
  const autoResult = await evalJs('JSON.stringify(window.__autotest)');
  results.autotest = JSON.parse(autoResult);
  const autoShot = await screenshot('autotest-end.jpg');
  results.autotest.shot = autoShot;

  drainEvents();
  console.log(JSON.stringify({ results, consoleErrors: errors, failedRequests: failedReqs }, null, 2));
  if (errors.length || failedReqs.length) exitCode = 2;
  if (!results.headlight.result.pass) exitCode = 2;
  if (!results.autotest.done || results.autotest.cash !== 2000 || results.autotest.collisions !== 0) exitCode = 2;
  ws.close();
} catch (e) {
  console.error('DRIVE FAILED: ' + e.message);
  console.log(JSON.stringify({ results }, null, 2));
  exitCode = 2;
} finally {
  try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
}
process.exit(exitCode);
