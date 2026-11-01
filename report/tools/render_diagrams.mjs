// Renders every Mermaid diagram to SVG and PNG with a headless Chrome (DevTools protocol).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire('C:/Minor Project/Smart Industry Management System/server/package.json');
const WebSocket = require('ws');
const ROOT = 'C:/Minor Project/Smart Industry Management System/report';
const OUT = `${ROOT}/assets/diagrams`;
fs.mkdirSync(OUT, { recursive: true });
const { diagrams } = await import(pathToFileURL(`${ROOT}/diagrams/diagrams.mjs`).href);
const only = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9334', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
  `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'sims-dia-'))}`, 'about:blank',
], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 40; i++) {
  try { targets = await (await fetch('http://localhost:9334/json')).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* starting */ }
  await sleep(250);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
let seq = 0;
const waiting = new Map();
ws.on('message', (m) => { const msg = JSON.parse(m); if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  waiting.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

const page = `<!doctype html><html><head><meta charset="utf-8"><script src="${pathToFileURL(`${ROOT}/assets/lib/mermaid.min.js`).href}"></script>
<style>body{margin:0;background:#fff;font-family:'Times New Roman',serif}#host{display:inline-block;padding:14px;background:#fff}</style></head><body><div id="host"></div></body></html>`;
fs.writeFileSync(`${ROOT}/assets/diagrams/_host.html`, page);
await send('Page.enable');
await send('Page.navigate', { url: pathToFileURL(`${ROOT}/assets/diagrams/_host.html`).href });
await sleep(1500);
await js(`mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'base', fontFamily: 'Times New Roman, serif',
  flowchart: { htmlLabels: true, curve: 'basis', padding: 12, nodeSpacing: 34, rankSpacing: 46 },
  sequence: { actorMargin: 60, messageMargin: 34, mirrorActors: false },
  themeVariables: { fontSize: '17px', primaryColor: '#ffffff', primaryTextColor: '#111111', primaryBorderColor: '#1f2937', lineColor: '#1f2937',
    secondaryColor: '#f3f4f6', tertiaryColor: '#ffffff', clusterBkg: '#f8fafc', clusterBorder: '#6b7280', edgeLabelBackground: '#ffffff',
    actorBkg: '#ffffff', actorBorder: '#1f2937', noteBkgColor: '#fff7e6', noteBorderColor: '#b7791f' } }); 1`);

for (const [name, d] of Object.entries(diagrams)) {
  if (only && !name.includes(only)) continue;
  const built = d.build ? d.build() : null;
  const width = built ? built.width : d.width;
  await send('Emulation.setDeviceMetricsOverride', { width: width + 60, height: 900, deviceScaleFactor: 2, mobile: false });
  const svg = built ? await js(`(() => { document.getElementById('host').innerHTML = ${JSON.stringify(built.svg)}; return ${JSON.stringify(built.svg)}; })()`) : await js(`(async () => { const host = document.getElementById('host'); host.innerHTML = '';
    const { svg } = await mermaid.render('g${Math.floor(Math.random() * 1e6)}', ${JSON.stringify(d.code)}); host.innerHTML = svg;
    const el = host.querySelector('svg'); const vb = el.viewBox.baseVal; el.style.maxWidth = 'none'; el.removeAttribute('height'); el.setAttribute('width', String(Math.min(vb.width, ${d.width}))); el.style.width = Math.min(vb.width, ${d.width}) + 'px'; return svg; })()`);
  await sleep(250);
  const box = await js(`(() => { const r = document.getElementById('host').getBoundingClientRect(); return { x: r.x, y: r.y, width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
  await send('Emulation.setDeviceMetricsOverride', { width: width + 60, height: box.height + 40, deviceScaleFactor: 2, mobile: false });
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: box.width, height: box.height, scale: 1 }, captureBeyondViewport: true });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  fs.writeFileSync(`${OUT}/${name}.svg`, svg);
  console.log('rendered', name, box.width, 'x', box.height);
}
ws.close();
chrome.kill();
