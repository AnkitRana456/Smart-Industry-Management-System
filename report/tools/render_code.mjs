// Renders syntax-highlighted code windows (from the real source files) and terminal captures to PNG.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire('C:/Minor Project/Smart Industry Management System/server/package.json');
const WebSocket = require('ws');
const ROOT = 'C:/Minor Project/Smart Industry Management System';
const REP = `${ROOT}/report`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every snippet is read from the working tree, so what the report shows is what the project contains.
export const SNIPPETS = [
  { id: 'code-auth', file: 'server/src/middleware/auth.js', ranges: [[35, 58]], lang: 'javascript' },
  { id: 'code-status', file: 'server/src/modules/machines/machine.service.js', ranges: [[54, 70], [72, 80]], lang: 'javascript' },
  { id: 'code-socket', file: 'server/src/sockets/index.js', ranges: [[12, 28], [60, 63]], lang: 'javascript' },
  { id: 'code-stock', file: 'server/src/modules/inventory/inventory.service.js', ranges: [[55, 69]], lang: 'javascript' },
  { id: 'code-order', file: 'server/src/modules/production/order.service.js', ranges: [[10, 10], [125, 127], [130, 136]], lang: 'javascript' },
  { id: 'code-ml', file: 'server/src/modules/ml/ml.service.js', ranges: [[16, 25], [71, 80]], lang: 'javascript' },
  { id: 'code-grounding', file: 'server/src/modules/ai/analyst.service.js', ranges: [[17, 24]], lang: 'javascript' },
  { id: 'code-live', file: 'client/src/hooks/useLiveUpdates.ts', ranges: [[26, 36]], lang: 'typescript' },
];
const SECRET = /api[_-]?key|gemini|google|process.env|['"][A-Za-z0-9_-]{32,}['"]/i;

const pages = [];
for (const s of SNIPPETS) {
  const lines = fs.readFileSync(`${ROOT}/${s.file}`, 'utf8').split(/\r?\n/);
  const parts = s.ranges.map(([a, b]) => lines.slice(a - 1, b).map((t, i) => ({ n: a + i, t: t.replace(/env\.jwtSecret/g, 'SIGNING_KEY') })));
  for (const p of parts) for (const l of p) if (SECRET.test(l.t)) throw new Error(`${s.id}: line ${l.n} looks sensitive: ${l.t}`);
  pages.push({ id: s.id, kind: 'code', title: s.file, parts, lang: s.lang });
}
for (const f of ['purchasing']) pages.push({ id: `term-${f}`, kind: 'term', title: `server$ node --test tests/${f}.test.js`, text: fs.readFileSync(`${REP}/assets/terminal/${f}.txt`, 'utf8').trimEnd() });
if (fs.existsSync(`${REP}/assets/terminal/pytest.txt`)) pages.push({ id: 'term-pytest', kind: 'term', title: 'ml-service$ python -m pytest tests/test_insights.py -v', text: fs.readFileSync(`${REP}/assets/terminal/pytest.txt`, 'utf8').trimEnd() });

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9335', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
  `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'sims-code-'))}`, 'about:blank',
], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 40; i++) { try { targets = await (await fetch('http://localhost:9335/json')).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* starting */ } await sleep(250); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
let seq = 0; const waiting = new Map();
ws.on('message', (m) => { const msg = JSON.parse(m); if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const js = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const host = `${REP}/assets/code/_host.html`;
fs.writeFileSync(host, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(`${REP}/assets/lib/github-dark.min.css`).href}">
<script src="${pathToFileURL(`${REP}/assets/lib/highlight.min.js`).href}"></script>
<style>body{margin:0;background:#fff}#w{display:inline-block;padding:10px;background:#fff}
.win{width:1000px;background:#0d1117;border-radius:9px;overflow:hidden;border:1px solid #30363d;font-family:Consolas,'Cascadia Mono','Courier New',monospace}
.bar{display:flex;align-items:center;gap:7px;background:#161b22;padding:8px 12px;border-bottom:1px solid #30363d;color:#8b949e;font-size:13px}
.dot{width:11px;height:11px;border-radius:50%}pre{margin:0;padding:12px 0;font-size:13px;line-height:1.5;color:#c9d1d9}
.row{display:flex}.ln{width:46px;text-align:right;padding-right:14px;color:#6e7681;user-select:none;flex:none}.cd{white-space:pre-wrap;overflow-wrap:anywhere;flex:1;padding-right:12px}
.gap{color:#6e7681;padding:2px 0 2px 60px;font-style:italic}.hljs{background:transparent;padding:0}
.term pre{padding:12px 16px;color:#d1d5db;white-space:pre-wrap}.ok{color:#3fb950}</style></head><body><div id="w"></div></body></html>`);
await send('Page.enable');
await send('Page.navigate', { url: pathToFileURL(host).href });
await sleep(1200);
await send('Emulation.setDeviceMetricsOverride', { width: 1060, height: 800, deviceScaleFactor: 2, mobile: false });

for (const p of pages) {
  let html;
  if (p.kind === 'code') {
    const rows = p.parts.map((part, i) => (i ? '<div class="gap">...</div>' : '') + part.map((l) => `<div class="row"><span class="ln">${l.n}</span><span class="cd">${esc(l.t) || ' '}</span></div>`).join('')).join('');
    html = `<div class="win"><div class="bar"><span class="dot" style="background:#ff5f56"></span><span class="dot" style="background:#ffbd2e"></span><span class="dot" style="background:#27c93f"></span><span style="margin-left:8px">${p.title}</span></div><pre>${rows}</pre></div>`;
  } else {
    const body = esc(p.text).replace(/✔/g, '<span class="ok">✔</span>');
    html = `<div class="win term"><div class="bar"><span class="dot" style="background:#ff5f56"></span><span class="dot" style="background:#ffbd2e"></span><span class="dot" style="background:#27c93f"></span><span style="margin-left:8px">${esc(p.title)}</span></div><pre>${body}</pre></div>`;
  }
  await js(`document.getElementById('w').innerHTML = ${JSON.stringify(html)}; ${p.kind === 'code' ? `document.querySelectorAll('.cd').forEach((el) => { el.innerHTML = hljs.highlight(el.textContent, { language: ${JSON.stringify(p.lang)}, ignoreIllegals: true }).value; });` : ''} 1`);
  await sleep(200);
  const box = await js(`(() => { const r = document.getElementById('w').getBoundingClientRect(); return { w: Math.ceil(r.width), h: Math.ceil(r.height) }; })()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1060, height: box.h + 20, deviceScaleFactor: 2, mobile: false });
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: box.w, height: box.h, scale: 1 }, captureBeyondViewport: true });
  fs.writeFileSync(`${REP}/assets/code/${p.id}.png`, Buffer.from(data, 'base64'));
  console.log('rendered', p.id, box.w, 'x', box.h);
}
ws.close(); chrome.kill();
