// Headless screenshot + console-error driver for Palkon Auto.
// Run `node checks/driver.mjs` from the repo root with the dev server up on :8128.
// Uses the Playwright headless-shell Chromium via CDP (Node's built-in WebSocket).
// Writes screenshots/*.jpg and prints console errors, failed requests, and sizes.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const PORT = 9223;
const BASE = 'http://127.0.0.1:8128';
const OUT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'screenshots');

const SHOTS = [
  { name: '1-title.jpg', query: '?shot=title&seed=1' },
  { name: '2-day-busy.jpg', query: '?shot=daybusy&seed=1' },
  { name: '3-sunset.jpg', query: '?shot=sunset&seed=1' },
  { name: '4-night-police.jpg', query: '?shot=nightpolice&seed=1' },
];

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

  mkdirSync(OUT, { recursive: true });
  const results = [];
  for (const shot of SHOTS) {
    events.length = 0;
    await send('Page.navigate', { url: BASE + '/' + shot.query }, sessionId);
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      await sleep(500);
      drainEvents();
      const r = await send('Runtime.evaluate', { expression: 'window.__shotReady === true', returnByValue: true }, sessionId);
      if (r.result?.result?.value === true) { ready = true; break; }
    }
    if (!ready) { results.push({ ...shot, ready: false, error: 'shot never became ready' }); continue; }
    await sleep(1500);
    drainEvents();
    const stats = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__stats || {})', returnByValue: true }, sessionId);
    let quality = 82;
    let file;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const cap = await send('Page.captureScreenshot', { format: 'jpeg', quality }, sessionId);
      file = join(OUT, shot.name);
      writeFileSync(file, Buffer.from(cap.result.data, 'base64'));
      const size = statSync(file).size;
      if (size <= 262144 || quality <= 50) { results.push({ ...shot, ready: true, size, quality, stats: stats.result?.result?.value }); break; }
      quality -= 15;
    }
  }
  drainEvents();
  console.log(JSON.stringify({ results, consoleErrors: errors, failedRequests: failedReqs }, null, 2));
  if (errors.length || failedReqs.length) exitCode = 2;
  if (results.some((r) => !r.ready)) exitCode = 2;
  ws.close();
} catch (e) {
  console.error('DRIVER FAILED: ' + e.message);
  exitCode = 2;
} finally {
  try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
}
process.exit(exitCode);
