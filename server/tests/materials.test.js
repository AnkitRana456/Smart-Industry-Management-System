import assert from 'node:assert/strict';
import http from 'node:http';
import { freshDb } from './helpers/db.js';
import { after, before, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_materials';

const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { createApp } = await import('../src/app.js');
const models = await import('../src/models/index.js');

let server;
let base;
const tokens = {};
let seq = 0;

async function call(method, path, { token = tokens.manager, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const qty = async (id) => (await models.InventoryItem.findById(id).lean()).quantity;
const item = (quantity, extra = {}) => models.InventoryItem.create({ sku: `MAT-${++seq}`, name: `Material ${seq}`, quantity, unit: 'kg', reorderThreshold: 0, ...extra });
const machine = (status = 'running') => models.Machine.create({ name: `M${++seq}`, code: `MM-${seq}`, status });
const order = async (materials, extra = {}) => (await call('POST', '/api/orders', {
  body: { product: `Part ${++seq}`, quantity: 100, machines: [String((await machine())._id)], materials: materials.map(([i, q]) => ({ item: String(i._id), qtyPerUnit: q })), ...extra },
})).body.data;
const start = (o) => call('PATCH', `/api/orders/${o._id}/status`, { body: { status: 'in_progress' } });

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
    tokens[k] = (await call('POST', '/api/auth/login', { token: null, body: { email, password: 'Password@123' } })).body.data.accessToken;
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.closeAllConnections?.();
  server.close();
});

describe('Order materials', () => {
  test('starting an order takes quantity x per-unit of every material and records transactions', async () => {
    const steel = await item(500);
    const bolts = await item(1000);
    const o = await order([[steel, 0.5], [bolts, 2]]);
    assert.equal(o.materials.length, 2);

    const r = await start(o);
    assert.equal(r.status, 200);
    assert.equal(await qty(steel._id), 450);
    assert.equal(await qty(bolts._id), 800);
    assert.equal(r.body.data.materialsConsumed, true);

    const txs = await models.StockTransaction.find({ order: o._id }).lean();
    assert.deepEqual(txs.map((t) => [t.type, t.qty]).sort((a, b) => a[1] - b[1]), [['out', 50], ['out', 200]]);
  });

  test('fractional needs round up so the order never starts short', async () => {
    const m = await item(100);
    const o = await order([[m, 0.333]]);
    await start(o);
    assert.equal(await qty(m._id), 100 - 34);
  });

  test('a shortage refuses the start, names the material, and leaves all stock untouched', async () => {
    const plenty = await item(1000);
    const scarce = await item(10, { name: 'Scarce alloy' });
    const o = await order([[plenty, 1], [scarce, 1]]);
    const r = await start(o);
    assert.equal(r.status, 409);
    assert.match(r.body.message, /Not enough Scarce alloy.*needs 100 kg, 10 available/);
    assert.equal(await qty(plenty._id), 1000, 'the material taken first is put back');
    assert.equal(await qty(scarce._id), 10);
    assert.equal(await models.StockTransaction.countDocuments({ order: o._id }), 0);
    assert.equal((await call('GET', `/api/orders/${o._id}`)).body.data.status, 'pending');
  });

  test('restocking lets the same order start', async () => {
    const m = await item(10);
    const o = await order([[m, 1]]);
    assert.equal((await start(o)).status, 409);
    await call('POST', `/api/inventory/${m._id}/transactions`, { body: { type: 'in', qty: 200 } });
    assert.equal((await start(o)).status, 200);
    assert.equal(await qty(m._id), 110);
  });

  test('two orders racing for the same limited stock can never overdraw it', async () => {
    const m = await item(150);
    const [a, b, c] = [await order([[m, 1]]), await order([[m, 1]]), await order([[m, 1]])];
    const results = await Promise.all([a, b, c].map(start));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 2);
    assert.equal(await qty(m._id), 50);
  });

  test('consuming below the reorder threshold raises one low-stock alert', async () => {
    const m = await item(130, { reorderThreshold: 50 });
    const o = await order([[m, 1]]);
    await start(o);
    assert.equal(await models.Alert.countDocuments({ type: 'low_stock', sourceId: String(m._id), status: 'open' }), 1);
  });

  test('materials are taken once: a started order cannot start again or be changed', async () => {
    const m = await item(500);
    const o = await order([[m, 1]]);
    await start(o);
    assert.equal((await start(o)).status, 409);
    assert.equal(await qty(m._id), 400);
    assert.equal((await call('PATCH', `/api/orders/${o._id}`, { body: { materials: [] } })).status, 409);
    assert.equal((await call('PATCH', `/api/orders/${o._id}`, { body: { quantity: 500 } })).status, 409);
  });

  test('a pending order can edit its materials; bad materials are rejected', async () => {
    const a = await item(500);
    const b = await item(500);
    const o = await order([[a, 1]]);
    const edited = await call('PATCH', `/api/orders/${o._id}`, { body: { materials: [{ item: String(b._id), qtyPerUnit: 2 }] } });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data.materials[0].item._id, String(b._id));
    const dup = await call('PATCH', `/api/orders/${o._id}`, { body: { materials: [{ item: String(a._id), qtyPerUnit: 1 }, { item: String(a._id), qtyPerUnit: 2 }] } });
    assert.equal(dup.status, 400);
    const ghost = await call('PATCH', `/api/orders/${o._id}`, { body: { materials: [{ item: '64b64c1f1c9d440000000000', qtyPerUnit: 1 }] } });
    assert.equal(ghost.status, 400);
    assert.equal((await call('POST', '/api/orders', { body: { product: 'X', quantity: 1, materials: [{ item: String(a._id), qtyPerUnit: 0 }] } })).status, 400);
  });

  test('orders without materials start as before, and workers cannot start orders', async () => {
    const o = await order([]);
    assert.equal((await start(o)).status, 200);
    const m = await item(100);
    const p = await order([[m, 1]]);
    assert.equal((await call('PATCH', `/api/orders/${p._id}/status`, { token: tokens.worker, body: { status: 'in_progress' } })).status, 403);
    assert.equal(await qty(m._id), 100);
  });
});

describe('Order output history', () => {
  test('lists logged output newest first, to staff only', async () => {
    const o = await order([]);
    await start(o);
    await models.OutputLog.create([
      { order: o._id, product: o.product, qty: 10, at: new Date(Date.now() - 3_600_000) },
      { order: o._id, product: o.product, qty: 25, at: new Date() },
    ]);
    const r = await call('GET', `/api/orders/${o._id}/output`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.map((x) => x.qty), [25, 10]);
    assert.equal((await call('GET', `/api/orders/${o._id}/output`, { token: tokens.worker })).status, 403);
    assert.equal((await call('GET', '/api/orders/64b000000000000000000000/output')).status, 404);
  });
});
