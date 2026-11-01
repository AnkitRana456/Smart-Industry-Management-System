// Measures API latency and Socket.io propagation delay on the local report instance (API :5100). Writes JSON to argv[2].
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('C:/Minor Project/Smart Industry Management System/server/package.json');
const { io } = require('socket.io-client');
const base = 'http://localhost:5100';
const j = (r) => r.json();
const login = async (email) => (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password@123' }) }).then(j)).data.accessToken;
const token = await login('manager@sims.local');
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const round = (n) => Math.round(n * 10) / 10;

const endpoints = [
  ['GET /api/machines', '/api/machines?limit=100'], ['GET /api/orders', '/api/orders?limit=50'], ['GET /api/inventory', '/api/inventory?limit=100'],
  ['GET /api/analytics/overview', '/api/analytics/overview'], ['GET /api/analytics/downtime', '/api/analytics/downtime?days=7'], ['GET /api/alerts', '/api/alerts?limit=50'],
];
const N = 40;
const api = [];
for (const [label, path] of endpoints) {
  for (let i = 0; i < 3; i++) await fetch(base + path, { headers: H }).then((r) => r.arrayBuffer()); // warm-up
  const t = [];
  for (let i = 0; i < N; i++) { const s = performance.now(); const r = await fetch(base + path, { headers: H }); await r.arrayBuffer(); t.push(performance.now() - s); }
  api.push({ endpoint: label, requests: N, medianMs: round(pct(t, 50)), p95Ms: round(pct(t, 95)), maxMs: round(Math.max(...t)) });
}

// Socket.io: change a machine's status over REST and time its arrival on a second, independent client.
const machines = (await fetch(`${base}/api/machines?limit=100`, { headers: H }).then(j)).data.items;
const m = machines.find((x) => x.code === 'M-101');
const listener = io(base, { auth: { token }, transports: ['websocket'], reconnection: false });
await new Promise((r) => listener.on('connect', r));
const lat = [];
let current = m.status;
for (let i = 0; i < 20; i++) {
  const next = current === 'idle' ? 'running' : 'idle';
  const got = new Promise((resolve) => listener.once('machine:statusChanged', () => resolve(performance.now())));
  const s = performance.now();
  const res = await fetch(`${base}/api/machines/${m._id}/status`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: next }) });
  const arrived = await Promise.race([got, new Promise((r) => setTimeout(() => r(null), 3000))]);
  if (res.ok && arrived) lat.push(arrived - s);
  current = next;
}
listener.close();
const socket = { trials: 20, delivered: lat.length, medianMs: round(pct(lat, 50)), p95Ms: round(pct(lat, 95)), maxMs: round(Math.max(...lat)) };

fs.writeFileSync(process.argv[2], JSON.stringify({ measuredAt: new Date().toISOString(), environment: 'local development machine, API and MongoDB on the same host, sequential requests', api, socket }, null, 2));
console.log(JSON.stringify({ api, socket }, null, 1));
