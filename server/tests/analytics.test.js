import assert from 'node:assert/strict';
import http from 'node:http';
import { freshDb } from './helpers/db.js';
import { after, before, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_analytics';
process.env.FACTORY_TIMEZONE = 'Asia/Kolkata';

const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { createApp } = await import('../src/app.js');
const models = await import('../src/models/index.js');
const { dayKey } = await import('../src/utils/time.js');

let server;
let base;
const tokens = {};
const m = {};
const DAY = 86_400_000;
const at = (daysAgo, hour = 10) => new Date(Date.now() - daysAgo * DAY - (new Date().getUTCHours() - hour) * 3_600_000);

async function call(path, token) {
  const res = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await freshDb(mongoose);
  const passwordHash = await bcrypt.hash('Password@123', 4);
  await models.User.create([
    { name: 'Manager', email: 'm@t.io', passwordHash, role: 'manager' },
    { name: 'Worker', email: 'w@t.io', passwordHash, role: 'worker' },
  ]);
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of [['manager', 'm@t.io'], ['worker', 'w@t.io']]) {
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password@123' }),
    });
    tokens[k] = (await r.json()).data.accessToken;
  }

  const [a, b, c] = await models.Machine.create([
    { name: 'A', code: 'A-1', status: 'running' },
    { name: 'B', code: 'B-1', status: 'offline' },
    { name: 'C', code: 'C-1', status: 'idle', riskLevel: 'HIGH' },
  ]);
  Object.assign(m, { a: a._id, b: b._id, c: c._id });

  // Known downtime: A = 60 + 30 min (two days), B = 120 min, plus an old event outside a 7-day window.
  await models.MachineLog.create([
    { machine: a._id, toStatus: 'offline', startedAt: at(1), endedAt: at(1), durationMins: 60, reason: 'Tool change' },
    { machine: a._id, toStatus: 'maintenance', startedAt: at(2), endedAt: at(2), durationMins: 30, reason: 'Tool change' },
    { machine: b._id, toStatus: 'offline', startedAt: at(1), endedAt: at(1), durationMins: 120, reason: 'Sensor fault' },
    { machine: b._id, toStatus: 'offline', startedAt: at(20), endedAt: at(20), durationMins: 500, reason: 'Old' },
    { machine: a._id, toStatus: 'running', startedAt: at(1), endedAt: at(1), durationMins: 999 },
  ]);

  const order = await models.ProductionOrder.create({ orderNo: 'PO-1', product: 'Gear', quantity: 100, status: 'in_progress', bottleneckFlag: true });
  await models.ProductionOrder.create({ orderNo: 'PO-2', product: 'Shaft', quantity: 10, status: 'pending' });
  await models.OutputLog.create([
    { order: order._id, product: 'Gear', qty: 40, at: at(1) },
    { order: order._id, product: 'Gear', qty: 25, at: at(1) },
    { order: order._id, product: 'Shaft', qty: 5, at: at(3) },
    { order: order._id, product: 'Gear', qty: 999, at: at(20) },
  ]);

  const item = await models.InventoryItem.create({ sku: 'S-1', name: 'Steel', quantity: 50, unit: 'kg', reorderThreshold: 60 });
  await models.InventoryItem.create({ sku: 'S-2', name: 'Bolts', quantity: 500, reorderThreshold: 10 });
  m.item = item._id;
  // Current level 50. Day -2: +20 in, day -1: -15 out. Level at end of day -2 = 50 + 15 = 65; day -3 = 65 - 20 = 45.
  await models.StockTransaction.create([
    { item: item._id, type: 'in', qty: 20, createdAt: at(2) },
    { item: item._id, type: 'out', qty: 15, createdAt: at(1) },
  ]);
  await models.Alert.create([
    { type: 'x', severity: 'critical', source: 't', message: 'c', status: 'open' },
    { type: 'y', severity: 'warning', source: 't', message: 'w', status: 'open' },
    { type: 'z', severity: 'warning', source: 't', message: 'resolved', status: 'resolved' },
  ]);
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.closeAllConnections?.();
  server.close();
});

describe('Analytics access', () => {
  test('workers and anonymous callers are rejected', async () => {
    for (const p of ['overview', 'downtime', 'production-output', 'stock-trends']) {
      assert.equal((await call(`/api/analytics/${p}`, tokens.worker)).status, 403, p);
      assert.equal((await call(`/api/analytics/${p}`)).status, 401, p);
    }
  });
  test('range and item inputs are validated', async () => {
    assert.equal((await call('/api/analytics/downtime?days=500', tokens.manager)).status, 400);
    assert.equal((await call('/api/analytics/stock-trends?item=nope', tokens.manager)).status, 400);
  });
});

describe('Overview', () => {
  test('counts machines, risk, orders, inventory and open alerts', async () => {
    const { body } = await call('/api/analytics/overview', tokens.manager);
    const d = body.data;
    assert.deepEqual([d.machines.total, d.machines.running, d.machines.offline, d.machines.idle], [3, 1, 1, 1]);
    assert.equal(d.risk.HIGH, 1);
    assert.deepEqual([d.orders.in_progress, d.orders.pending, d.orders.bottlenecks], [1, 1, 1]);
    assert.deepEqual([d.inventory.items, d.inventory.lowStock], [2, 1]);
    assert.deepEqual([d.alerts.open, d.alerts.critical, d.alerts.warning], [2, 1, 1]);
  });
});

describe('Downtime', () => {
  test('totals match the logged durations and ignore running periods and old events', async () => {
    const { body } = await call('/api/analytics/downtime?days=7', tokens.manager);
    const d = body.data;
    assert.equal(d.totalMinutes, 210);
    assert.equal(d.series.length, 7);
    assert.equal(d.series.reduce((s, x) => s + x.minutes, 0), 210);
    const byCode = Object.fromEntries(d.byMachine.map((x) => [x.code, x]));
    assert.equal(byCode['A-1'].minutes, 90);
    assert.equal(byCode['B-1'].minutes, 120);
    assert.equal(byCode['C-1'].minutes, 0);
    assert.equal(d.byMachine[0].code, 'B-1', 'sorted by downtime, highest first');
    assert.equal(byCode['C-1'].availabilityPct, 100);
    assert.equal(byCode['B-1'].availabilityPct, Math.round((1 - 120 / (7 * 1440)) * 1000) / 10);
  });
  test('a wider range includes older events', async () => {
    const { body } = await call('/api/analytics/downtime?days=30', tokens.manager);
    assert.equal(body.data.totalMinutes, 710);
  });
  test('reasons are grouped', async () => {
    const { body } = await call('/api/analytics/downtime?days=7', tokens.manager);
    const reasons = Object.fromEntries(body.data.byReason.map((r) => [r.reason, r.minutes]));
    assert.deepEqual(reasons, { 'Sensor fault': 120, 'Tool change': 90 });
  });
});

describe('Production output', () => {
  test('sums units per day and per product inside the range', async () => {
    const { body } = await call('/api/analytics/production-output?days=7', tokens.manager);
    const d = body.data;
    assert.equal(d.totalUnits, 70);
    assert.equal(d.series.find((x) => x.date === dayKey(at(1))).units, 65);
    assert.deepEqual(Object.fromEntries(d.byProduct.map((p) => [p.product, p.units])), { Gear: 65, Shaft: 5 });
    assert.equal(d.series.length, 7);
  });
});

describe('Stock trends', () => {
  test('rebuilds end-of-day levels backwards from the current quantity', async () => {
    const { body } = await call(`/api/analytics/stock-trends?days=5&item=${m.item}`, tokens.manager);
    const level = Object.fromEntries(body.data.series.map((x) => [x.date, x.level]));
    assert.equal(level[dayKey(at(0))], 50, 'today equals the current quantity');
    assert.equal(level[dayKey(at(1))], 50, 'end of the day the -15 happened');
    assert.equal(level[dayKey(at(2))], 50 + 15, 'end of the day the +20 happened');
    assert.equal(level[dayKey(at(3))], 65 - 20, 'before the +20');
    assert.equal(body.data.totalIn, 20);
    assert.equal(body.data.totalOut, 15);
  });
  test('without an item it returns movement for all items and no levels', async () => {
    const { body } = await call('/api/analytics/stock-trends?days=5', tokens.manager);
    assert.equal(body.data.totalIn, 20);
    assert.equal('level' in body.data.series[0], false);
  });
});

describe('worker attendance report and per-machine downtime', () => {
  // Attendance days are factory-calendar days counted back from now; at() pins 10:00 UTC, which is the previous factory day late in the evening.
  const ago = (n) => dayKey(new Date(Date.now() - n * DAY));
  test('downtime can be limited to one machine, leaving the totals of that machine only', async () => {
    const { body } = await call(`/api/analytics/downtime?days=7&machine=${m.b}`, tokens.manager);
    assert.equal(body.data.totalMinutes, 120);
    assert.equal(body.data.byReason.length, 1);
  });

  test('worker-attendance marks absent, late and non-working days, and is staff-only', async () => {
    const users = await models.User.create([
      { name: 'Asha', email: 'a@t.io', passwordHash: 'x', role: 'worker' },
      { name: 'Ravi', email: 'r@t.io', passwordHash: 'x', role: 'worker' },
    ]);
    const [asha, ravi] = await models.Worker.create([
      { user: users[0]._id, employeeId: 'E-1', status: 'active' },
      { user: users[1]._id, employeeId: 'E-2', status: 'active' },
    ]);
    // Day -1: Asha present, Ravi late. Day -2: only Asha present, so Ravi is absent. Day -3: nobody came (closed).
    await models.Attendance.create([
      { worker: asha._id, date: ago(1), status: 'present' },
      { worker: ravi._id, date: ago(1), status: 'late' },
      { worker: asha._id, date: ago(2), status: 'present' },
    ]);
    const { status, body } = await call('/api/analytics/worker-attendance?days=4', tokens.manager);
    assert.equal(status, 200);
    const [d3, d2, d1, d0] = [3, 2, 1, 0].map((n) => ago(n));
    const ravi_ = body.data.rows.find((r) => r.employeeId === 'E-2');
    assert.deepEqual([d3, d2, d1, d0].map((d) => ravi_.days[d]), ['none', 'absent', 'late', 'none']);
    const s = Object.fromEntries(body.data.series.map((x) => [x.date, x]));
    assert.deepEqual([s[d1].present, s[d1].late, s[d1].absent], [1, 1, 0]);
    assert.deepEqual([s[d2].present, s[d2].late, s[d2].absent], [1, 0, 1]);
    assert.deepEqual([s[d3].present, s[d3].late, s[d3].absent], [0, 0, 0], 'a closed day counts nobody absent');
    assert.equal(body.data.attendancePct, 75, '3 of the 4 expected attendances');
    assert.equal((await call('/api/analytics/worker-attendance?days=4', tokens.worker)).status, 403);
  });
});
