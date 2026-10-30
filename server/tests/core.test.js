import assert from 'node:assert/strict';
import http from 'node:http';
import { freshDb } from './helpers/db.js';
import { after, before, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_core';

const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { io: connect } = await import('socket.io-client');
const { createApp } = await import('../src/app.js');
const { initSockets } = await import('../src/sockets/index.js');
const models = await import('../src/models/index.js');

let server;
let base;
const tokens = {};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await freshDb(mongoose);
  const passwordHash = await bcrypt.hash('Password@123', 4);
  await models.User.create([
    { name: 'Admin', email: 'a@t.io', passwordHash, role: 'admin' },
    { name: 'Manager', email: 'm@t.io', passwordHash, role: 'manager' },
    { name: 'Worker', email: 'w@t.io', passwordHash, role: 'worker' },
  ]);
  server = http.createServer(createApp());
  initSockets(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of [['admin', 'a@t.io'], ['manager', 'm@t.io'], ['worker', 'w@t.io']]) {
    const r = await call('POST', '/api/auth/login', { body: { email, password: 'Password@123' } });
    tokens[k] = r.body.data.accessToken;
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.closeAllConnections?.();
  server.close();
});

describe('RBAC', () => {
  test('worker can read machines but not create them', async () => {
    assert.equal((await call('GET', '/api/machines', { token: tokens.worker })).status, 200);
    const r = await call('POST', '/api/machines', { token: tokens.worker, body: { name: 'X1', code: 'X-1' } });
    assert.equal(r.status, 403);
  });
  test('missing token is 401 and invalid body is 400', async () => {
    assert.equal((await call('GET', '/api/machines')).status, 401);
    const r = await call('POST', '/api/machines', { token: tokens.manager, body: { name: 'a' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.success, false);
  });
});

describe('Machines', () => {
  let id;
  test('status change writes a log, raises one alert, and rejects no-op changes', async () => {
    const created = await call('POST', '/api/machines', { token: tokens.manager, body: { name: 'Lathe', code: 'L-1', status: 'running' } });
    assert.equal(created.status, 201);
    id = created.body.data._id;

    assert.equal((await call('PATCH', `/api/machines/${id}/status`, { token: tokens.manager, body: { status: 'running' } })).status, 409);

    await call('PATCH', `/api/machines/${id}/status`, { token: tokens.manager, body: { status: 'offline', reason: 'Sensor fault' } });
    await call('PATCH', `/api/machines/${id}/status`, { token: tokens.manager, body: { status: 'running' } });
    await call('PATCH', `/api/machines/${id}/status`, { token: tokens.manager, body: { status: 'offline' } });

    const logs = await call('GET', `/api/machines/${id}/logs`, { token: tokens.manager });
    const closed = logs.body.data.items.filter((l) => l.endedAt);
    assert.ok(closed.length >= 2, 'previous logs are closed with an end time');
    assert.ok(closed.every((l) => typeof l.durationMins === 'number'));

    const alerts = await call('GET', '/api/alerts?status=open', { token: tokens.manager });
    const offline = alerts.body.data.items.filter((a) => a.type === 'machine_offline');
    assert.equal(offline.length, 1, 'alert is de-duplicated while one is unresolved');
  });

  test('downtime summary is aggregated per machine', async () => {
    const r = await call('GET', '/api/machines/downtime-summary?days=7', { token: tokens.manager });
    assert.equal(r.status, 200);
    assert.ok(r.body.data.rows.some((row) => row.code === 'L-1'));
  });
});

describe('Inventory', () => {
  let id;
  test('concurrent stock-outs can never make stock negative', async () => {
    const created = await call('POST', '/api/inventory', { token: tokens.manager, body: { sku: 'BOLT-1', name: 'Bolt', quantity: 10, reorderThreshold: 3 } });
    id = created.body.data._id;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => call('POST', `/api/inventory/${id}/transactions`, { token: tokens.manager, body: { type: 'out', qty: 3 } })),
    );
    const okCount = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 409).length;
    assert.equal(okCount, 3);
    assert.equal(rejected, 5);
    const item = await call('GET', `/api/inventory/${id}`, { token: tokens.manager });
    assert.equal(item.body.data.quantity, 1);
  });

  test('dropping below threshold raises one low-stock alert; restocking resolves it', async () => {
    const open = await call('GET', '/api/alerts?status=open', { token: tokens.manager });
    assert.equal(open.body.data.items.filter((a) => a.type === 'low_stock').length, 1);

    await call('POST', `/api/inventory/${id}/transactions`, { token: tokens.manager, body: { type: 'in', qty: 50 } });
    const after = await call('GET', '/api/alerts?status=open', { token: tokens.manager });
    assert.equal(after.body.data.items.filter((a) => a.type === 'low_stock').length, 0);
  });

  test('worker cannot record transactions', async () => {
    const r = await call('POST', `/api/inventory/${id}/transactions`, { token: tokens.worker, body: { type: 'in', qty: 1 } });
    assert.equal(r.status, 403);
  });
});

describe('Socket.io', () => {
  test('rejects unauthenticated handshakes', async () => {
    const s = connect(base, { auth: { token: 'nope' }, reconnection: false });
    const err = await new Promise((r) => s.on('connect_error', r));
    assert.match(err.message, /Unauthorized/);
    s.close();
  });

  test('a status change reaches another client in under 2 seconds', async () => {
    const m = await call('POST', '/api/machines', { token: tokens.manager, body: { name: 'Press', code: 'P-1', status: 'running' } });
    const s = connect(base, { auth: { token: tokens.worker }, reconnection: false });
    await new Promise((r) => s.on('connect', r));
    const got = new Promise((r) => s.on('machine:statusChanged', (p) => r({ p, at: Date.now() })));
    const start = Date.now();
    await call('PATCH', `/api/machines/${m.body.data._id}/status`, { token: tokens.manager, body: { status: 'idle' } });
    const { p, at } = await got;
    assert.equal(p.to, 'idle');
    assert.ok(at - start < 2000);
    s.close();
  });

  test('workers do not receive staff-only alert events', async () => {
    const s = connect(base, { auth: { token: tokens.worker }, reconnection: false });
    await new Promise((r) => s.on('connect', r));
    let leaked = false;
    s.on('alert:new', () => { leaked = true; });
    const m = await call('POST', '/api/machines', { token: tokens.manager, body: { name: 'Weld', code: 'W-1', status: 'running' } });
    await call('PATCH', `/api/machines/${m.body.data._id}/status`, { token: tokens.manager, body: { status: 'offline' } });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(leaked, false);
    s.close();
  });
});
