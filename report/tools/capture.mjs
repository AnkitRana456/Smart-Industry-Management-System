// Takes the application screenshots used in the report by driving a headless Chrome through the DevTools protocol.
// Usage: node capture.mjs <outDir>   (client on :5199 against the report database)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire('C:/Minor Project/Smart Industry Management System/server/package.json');
const WebSocket = require('ws');

const OUT = process.argv[2];
const BASE = 'http://localhost:5199';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9333', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'sims-shot-'))}`, 'about:blank',
], { stdio: 'ignore' });

let targets;
for (let i = 0; i < 40; i++) {
  try { targets = await (await fetch('http://localhost:9333/json')).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* not up yet */ }
  await sleep(250);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
let seq = 0;
const waiting = new Map();
ws.on('message', (m) => {
  const msg = JSON.parse(m);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  waiting.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'script failed');
  return r.result.value;
};
const viewport = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1.5, mobile: false });
const go = async (p, wait = 2600) => { await send('Page.navigate', { url: BASE + p }); await sleep(wait); };
const shot = async (name, quality = 88) => {
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality });
  fs.writeFileSync(path.join(OUT, `${name}.jpg`), Buffer.from(data, 'base64'));
  console.log('saved', name);
};
const click = (selectorOrText) => js(`(() => { const t = ${JSON.stringify(selectorOrText)};
  const el = t.startsWith('css:') ? document.querySelector(t.slice(4)) : [...document.querySelectorAll('button,a,[role=tab],tr')].find((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().startsWith(t));
  if (!el) return false; el.click(); return true; })()`);
const setValue = (selector, value) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const theme = async (want) => { if ((await js('document.documentElement.dataset.theme')) !== want) { await click('Toggle theme'); await sleep(500); } };
const scrollMain = (y) => js(`document.querySelector('main').scrollTo(0, ${y})`);
const signIn = async (email) => {
  await go('/login', 1500);
  await setValue('#email', email);
  await setValue('#password', 'Password@123');
  await click('css:button[type=submit]');
  await sleep(3500);
};

await send('Page.enable');
await viewport(1440, 900);

// ---- signed out ----
await go('/login', 1800);
await js("localStorage.setItem('sims-theme','light'); document.documentElement.dataset.theme='light'; 1");
await sleep(400);
await shot('01-login');

// ---- manager, light theme ----
await signIn('manager@sims.local');
await theme('light');
await go('/', 3200); await theme('light'); await shot('02-dashboard-light');
await theme('dark'); await sleep(600); await shot('03-dashboard-dark');
await theme('light');

await viewport(1440, 1000);
await go('/machines', 2800);
await js("[...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('M-104'))?.click()");
await sleep(2200);
await click('css:[aria-label="Anomaly check"] button'); await sleep(2500);
await shot('04-machines');
await js("(() => { const p = document.querySelector('[aria-label=\"Telemetry and health\"]')?.closest('div.rounded-xl') ?? document.querySelector('main'); return 1; })()");
await scrollMain(1000); await sleep(500);
await click('css:[aria-label="Sensor model"] button'); await sleep(2500);
await shot('05-machine-risk');
await scrollMain(0);

await viewport(1440, 900);
await go('/workers', 2800); await shot('06-workers');
await click('Attendance'); await sleep(2500); await shot('07-attendance');
await go('/production', 3000); await shot('08-production');
await click('New order'); await sleep(900);
await setValue('#o-product', 'Drive shaft'); await sleep(200);
await setValue('#o-qty', '200'); await sleep(200);
await js("[...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.trim() === 'Check')?.click()"); await sleep(2500);
await shot('09-order-form');
await js("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))"); await sleep(400);
await go('/inventory', 3500); await shot('10-inventory');
await go('/purchasing', 3000); await shot('11-purchasing');
await go('/maintenance', 3000); await shot('12-maintenance');
await go('/analytics', 3800); await shot('13-analytics');
await scrollMain(900); await sleep(600); await shot('14-analytics-more');
await go('/alerts', 2600); await shot('15-alerts');
await go('/handover', 2600); await shot('16-handover');

// ---- AI analyst ----
await go('/analyst', 2800);
await setValue('#question', 'Which machine had the most downtime in the last 7 days?');
await click('css:button[type=submit]');
for (let i = 0; i < 40; i++) { await sleep(1500); if (await js("document.querySelector('[aria-label=\"AI Analyst\"], main')?.textContent.includes('Based on')")) break; }
await sleep(800);
await shot('17-analyst');

// ---- worker ----
await go('/', 800);
await click('Sign out'); await sleep(2000);
await signIn('worker@sims.local');
await theme('light');
await go('/workers', 3000); await theme('light'); await shot('18-worker-myday');

ws.close();
chrome.kill();
console.log('done');
