import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { freshDb } from './helpers/db.js';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_planning';
process.env.SCHEDULER_ENABLED = 'false';

const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { createApp } = await import('../src/app.js');
const models = await import('../src/models/index.js');
const { dayKey } = await import('../src/utils/time.js');

const DAY = 86_400_000;
let server;
let base;
const tokens = {};
const w = {};
let seq = 0;

async function call(method, path, { token = tokens.manager, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const item = (quantity, extra = {}) => models.InventoryItem.create({ sku: `PL-${++seq}`, name: `Mat ${seq}`, quantity, unit: 'kg', reorderThreshold: 0, ...extra });
const machine = (status = 'running') => models.Machine.create({ name: `M${++seq}`, code: `PM-${seq}`, status });
const bom = (product, items) => call('POST', '/api/bom', { body: { product, items: items.map(([i, q]) => ({ item: String(i._id), qtyPerUnit: q })) } });

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await freshDb(mongoose);
  const passwordHash = await bcrypt.hash('Password@123', 4);
  const users = await models.User.create([
    { name: 'Manager', email: 'm@t.io', passwordHash, role: 'manager' },
    { name: 'Worker One', email: 'w1@t.io', passwordHash, role: 'worker' },
    { name: 'Worker Two', email: 'w2@t.io', passwordHash, role: 'worker' },
  ]);
  const workers = await models.Worker.create([{ user: users[1]._id, employeeId: 'E-1' }, { user: users[2]._id, employeeId: 'E-2' }]);
  w.one = workers[0]._id;
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of [['manager', 'm@t.io'], ['worker', 'w1@t.io'], ['worker2', 'w2@t.io']]) {
    tokens[k] = (await call('POST', '/api/auth/login', { token: null, body: { email, password: 'Password@123' } })).body.data.accessToken;
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.closeAllConnections?.();
  server.close();
});

describe('Bill of materials', () => {
  test('one per product (case-insensitive), validated, staff-managed but readable by all', async () => {
    const steel = await item(100);
    assert.equal((await bom('Drive shaft', [[steel, 0.5]])).status, 201);
    assert.equal((await bom('drive SHAFT', [[steel, 1]])).status, 409);
    assert.equal((await bom('Dup items', [[steel, 1], [steel, 2]])).status, 400);
    assert.equal((await call('POST', '/api/bom', { body: { product: 'Ghost', items: [{ item: String(new mongoose.Types.ObjectId()), qtyPerUnit: 1 }] } })).status, 400);
    assert.equal((await call('POST', '/api/bom', { body: { product: 'Empty', items: [] } })).status, 400);
    assert.equal((await call('POST', '/api/bom', { token: tokens.worker, body: { product: 'Nope', items: [{ item: String(steel._id), qtyPerUnit: 1 }] } })).status, 403);
    assert.equal((await call('GET', '/api/bom', { token: tokens.worker })).status, 200);
  });

  test('an order without its own materials copies the BOM; one with materials keeps its own', async () => {
    const a = await item(100);
    const b = await item(100);
    await bom('Gear', [[a, 2], [b, 0.25]]);
    const m = await machine();
    const plain = await call('POST', '/api/orders', { body: { product: 'gear', quantity: 10, machines: [String(m._id)] } });
    assert.equal(plain.status, 201);
    assert.deepEqual(plain.body.data.materials.map((x) => [x.item.sku, x.qtyPerUnit]).sort(), [[a.sku, 2], [b.sku, 0.25]].sort());
    const own = await call('POST', '/api/orders', { body: { product: 'Gear', quantity: 10, materials: [{ item: String(a._id), qtyPerUnit: 9 }] } });
    assert.deepEqual(own.body.data.materials.map((x) => x.qtyPerUnit), [9]);
    const none = await call('POST', '/api/orders', { body: { product: 'No BOM product', quantity: 5 } });
    assert.deepEqual(none.body.data.materials, []);
  });
});

describe('Quality checks', () => {
  const startedOrder = async (extra = {}) => models.ProductionOrder.create({ orderNo: `PO-${++seq}`, product: 'Gear', quantity: 100, status: 'in_progress', ...extra });

  test('are logged against started orders and total up', async () => {
    const o = await startedOrder();
    const log = (body) => call('POST', '/api/quality-checks', { body: { order: String(o._id), stage: 'Final', ...body } });
    assert.equal((await log({ inspectedQty: 50, defectCount: 3, scrapQty: 1 })).status, 201);
    assert.equal((await log({ inspectedQty: 30, defectCount: 0, scrapQty: 0 })).status, 201);
    const r = await call('GET', `/api/quality-checks/order/${o._id}`);
    assert.deepEqual(r.body.data.summary, { checks: 2, inspected: 80, defects: 3, scrap: 1 });
    assert.equal(r.body.data.checks.length, 2);
  });

  test('refuse impossible numbers and pending orders', async () => {
    const o = await startedOrder();
    const pending = await startedOrder({ status: 'pending' });
    const log = (order, body) => call('POST', '/api/quality-checks', { body: { order: String(order._id), stage: 'Final', ...body } });
    assert.equal((await log(o, { inspectedQty: 5, defectCount: 6 })).status, 400);
    assert.equal((await log(o, { inspectedQty: 5, scrapQty: 6 })).status, 400);
    assert.equal((await log(o, { inspectedQty: 0 })).status, 400);
    assert.equal((await log(pending, { inspectedQty: 5 })).status, 409);
  });

  test('a worker can log only for an order linked to their tasks', async () => {
    const o = await startedOrder();
    const other = await startedOrder();
    await models.Task.create({ title: 'Inspect', assignedTo: w.one, order: o._id });
    const log = (order, token) => call('POST', '/api/quality-checks', { token, body: { order: String(order._id), stage: 'In-process', inspectedQty: 10 } });
    assert.equal((await log(o, tokens.worker)).status, 201);
    assert.equal((await log(other, tokens.worker)).status, 403);
    assert.equal((await log(o, tokens.worker2)).status, 403);
    assert.equal((await call('GET', `/api/quality-checks/order/${other._id}`, { token: tokens.worker })).status, 403);
  });
});

describe('Feasibility', () => {
  const ask = (body, token) => call('POST', '/api/production/feasibility', { token, body });

  test('is feasible when stock, a machine and a checked-in worker exist', async () => {
    await freshDb(mongoose);
    const passwordHash = await bcrypt.hash('Password@123', 4);
    const [mgr, wu] = await models.User.create([{ name: 'M', email: 'm@t.io', passwordHash, role: 'manager' }, { name: 'W', email: 'w@t.io', passwordHash, role: 'worker' }]);
    tokens.manager = (await call('POST', '/api/auth/login', { token: null, body: { email: 'm@t.io', password: 'Password@123' } })).body.data.accessToken;
    tokens.worker = (await call('POST', '/api/auth/login', { token: null, body: { email: 'w@t.io', password: 'Password@123' } })).body.data.accessToken;
    assert.ok(mgr);
    const wk = await models.Worker.create({ user: wu._id, employeeId: 'E-9' });
    await models.Attendance.create({ worker: wk._id, date: dayKey(), status: 'present' });
    const steel = await item(500);
    await bom('Shaft', [[steel, 0.5]]);
    await machine('running');
    const r = await ask({ product: 'Shaft', quantity: 400 });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.feasible, true);
    assert.deepEqual([r.body.data.materials[0].needed, r.body.data.materials[0].available, r.body.data.materials[0].short], [200, 500, 0]);
    assert.deepEqual(r.body.data.problems, []);
  });

  test('names every shortage and unavailable machine', async () => {
    const steel = await item(100);
    const bolts = await item(10);
    await bom('Frame', [[steel, 1], [bolts, 2]]);
    const down = await machine('offline');
    const r = await ask({ product: 'Frame', quantity: 100, machines: [String(down._id)] });
    assert.equal(r.body.data.feasible, false);
    const text = r.body.data.problems.join(' | ');
    assert.match(text, /Mat \d+ is short by 190 kg/, 'bolts need 200 and 10 are on hand (steel needs 100, has 100: fine)');
    assert.match(text, /offline or in maintenance/);
    assert.match(text, /No machine is available/);
    assert.equal(r.body.data.materials.filter((m) => !m.enough).length, 1);
  });

  test('says so when there is no BOM, and is staff-only', async () => {
    const r = await ask({ product: 'Mystery part', quantity: 1 });
    assert.equal(r.body.data.hasBom, false);
    assert.match(r.body.data.problems[0], /No bill of materials/);
    assert.equal((await ask({ product: 'Mystery part', quantity: 1 }, tokens.worker)).status, 403);
    assert.equal((await ask({ product: 'x', quantity: 0 })).status, 400);
  });
});

describe('Pareto and OEE', () => {
  test('Pareto orders reasons by lost minutes with a running share', async () => {
    await models.MachineLog.deleteMany({});
    const m = await machine();
    const at = (d) => new Date(Date.now() - d * DAY);
    await models.MachineLog.create([
      { machine: m._id, toStatus: 'offline', startedAt: at(1), endedAt: at(1), durationMins: 60, reason: 'Sensor fault' },
      { machine: m._id, toStatus: 'offline', startedAt: at(2), endedAt: at(2), durationMins: 20, reason: 'Tool change' },
      { machine: m._id, toStatus: 'maintenance', startedAt: at(2), endedAt: at(2), durationMins: 20, reason: 'Tool change' },
      { machine: m._id, toStatus: 'offline', startedAt: at(40), endedAt: at(40), durationMins: 999, reason: 'Old' },
    ]);
    const r = await call('GET', '/api/analytics/downtime-pareto?days=7');
    assert.equal(r.body.data.totalMinutes, 100);
    assert.deepEqual(r.body.data.reasons.map((x) => [x.reason, x.minutes, x.cumulativePct]), [['Sensor fault', 60, 60], ['Tool change', 40, 100]]);
  });

  test('OEE reports availability and quality, and never invents performance', async () => {
    await models.OutputLog.deleteMany({});
    await models.QualityCheck.deleteMany({});
    const machines = await models.Machine.countDocuments();
    const order = await models.ProductionOrder.create({ orderNo: 'PO-OEE', product: 'Gear', quantity: 100, status: 'in_progress' });
    await models.OutputLog.create({ order: order._id, product: 'Gear', qty: 200 });
    await models.QualityCheck.create({ order: order._id, stage: 'Final', inspectedQty: 100, defectCount: 12, scrapQty: 10 });
    const r = (await call('GET', '/api/analytics/oee?days=7')).body.data;
    assert.equal(r.qualityPct, 95);
    assert.equal(r.performancePct, null);
    assert.equal(r.oeePct, null);
    assert.equal(r.availabilityPct, Math.round((1 - 100 / (machines * 7 * 1440)) * 1000) / 10);
    assert.deepEqual([r.unitsProduced, r.scrapUnits, r.defectsFound], [200, 10, 12]);
  });
});
