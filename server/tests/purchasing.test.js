import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { freshDb } from './helpers/db.js';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_purchasing';
process.env.SCHEDULER_ENABLED = 'false';

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
const supplier = async (name = `Supplier ${++seq}`) => (await call('POST', '/api/suppliers', { body: { name } })).body.data;
const item = (extra = {}) => models.InventoryItem.create({ sku: `PU-${++seq}`, name: `Part ${seq}`, quantity: 100, unit: 'kg', reorderThreshold: 50, ...extra });
const qty = async (id) => (await models.InventoryItem.findById(id).lean()).quantity;
const po = async (body) => (await call('POST', '/api/purchase-orders', { body })).body.data;

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

describe('Suppliers', () => {
  test('are managed by staff, names are unique, and one with open orders cannot be deleted', async () => {
    const s = await supplier('Acme Steel');
    assert.equal((await call('POST', '/api/suppliers', { body: { name: 'acme steel' } })).status, 409, 'case-insensitive');
    assert.equal((await call('GET', '/api/suppliers', { token: tokens.worker })).status, 403);
    assert.equal((await call('POST', '/api/suppliers', { body: { name: 'X', email: 'bad' } })).status, 400);
    const it = await item();
    await po({ supplier: s._id, lines: [{ item: String(it._id), qty: 10, unitCost: 2 }] });
    assert.equal((await call('DELETE', `/api/suppliers/${s._id}`)).status, 409);
  });
});

describe('Purchase orders', () => {
  test('draft, approve, receive: receiving posts stock-in and a total is computed', async () => {
    const s = await supplier();
    const a = await item({ quantity: 10 });
    const b = await item({ quantity: 5 });
    const draft = await po({ supplier: s._id, lines: [{ item: String(a._id), qty: 100, unitCost: 2.5 }, { item: String(b._id), qty: 20, unitCost: 10 }] });
    assert.match(draft.poNo, /^PUR-\d+$/);
    assert.equal(draft.status, 'draft');
    assert.equal(draft.total, 450);

    assert.equal((await call('PATCH', `/api/purchase-orders/${draft._id}/receive`)).status, 409, 'must be approved first');
    const approved = await call('PATCH', `/api/purchase-orders/${draft._id}/approve`);
    assert.equal(approved.body.data.status, 'approved');
    assert.equal(approved.body.data.approvedBy.name, 'Manager');
    assert.equal((await call('PATCH', `/api/purchase-orders/${draft._id}`, { body: { notes: 'x' } })).status, 409, 'approved orders are not editable');

    assert.equal((await call('PATCH', `/api/purchase-orders/${draft._id}/receive`)).status, 200);
    assert.deepEqual([await qty(a._id), await qty(b._id)], [110, 25]);
    assert.equal((await call('PATCH', `/api/purchase-orders/${draft._id}/receive`)).status, 409, 'a second receive adds nothing');
    assert.deepEqual([await qty(a._id), await qty(b._id)], [110, 25]);
    assert.equal(await models.StockTransaction.countDocuments({ item: a._id, type: 'in' }), 1);
  });

  test('cannot be approved without a supplier or lines, and workers have no access', async () => {
    const empty = await po({});
    assert.equal((await call('PATCH', `/api/purchase-orders/${empty._id}/approve`)).status, 400);
    const a = await item();
    const noSupplier = await po({ lines: [{ item: String(a._id), qty: 5 }] });
    assert.equal((await call('PATCH', `/api/purchase-orders/${noSupplier._id}/approve`)).status, 400);
    assert.equal((await call('GET', '/api/purchase-orders', { token: tokens.worker })).status, 403);
    assert.equal((await call('PATCH', `/api/purchase-orders/${noSupplier._id}/approve`, { token: tokens.worker })).status, 403);
  });

  test('rejects duplicate items, unknown items and bad quantities', async () => {
    const a = await item();
    assert.equal((await call('POST', '/api/purchase-orders', { body: { lines: [{ item: String(a._id), qty: 1 }, { item: String(a._id), qty: 2 }] } })).status, 400);
    assert.equal((await call('POST', '/api/purchase-orders', { body: { lines: [{ item: String(new mongoose.Types.ObjectId()), qty: 1 }] } })).status, 400);
    assert.equal((await call('POST', '/api/purchase-orders', { body: { lines: [{ item: String(a._id), qty: 0 }] } })).status, 400);
  });

  test('cancelling works on open orders only', async () => {
    const d = await po({});
    assert.equal((await call('PATCH', `/api/purchase-orders/${d._id}/cancel`)).body.data.status, 'cancelled');
    assert.equal((await call('PATCH', `/api/purchase-orders/${d._id}/cancel`)).status, 409);
  });
});

describe('Auto-drafting from low stock', () => {
  test('stock falling under the threshold drafts one order and never approves it', async () => {
    const s = await supplier();
    const a = await item({ quantity: 60, reorderThreshold: 50, unitCost: 4, supplierRef: s._id });
    const out = await call('POST', `/api/inventory/${a._id}/transactions`, { body: { type: 'out', qty: 30 } });
    assert.equal(out.status, 201);
    const drafts = await models.PurchaseOrder.find({ 'lines.item': a._id }).lean();
    assert.equal(drafts.length, 1);
    assert.deepEqual([drafts[0].status, drafts[0].createdFromAlert, String(drafts[0].supplier)], ['draft', true, String(s._id)]);
    assert.deepEqual([drafts[0].lines[0].qty, drafts[0].lines[0].unitCost], [70, 4], 'topped up to twice the threshold');
    await call('POST', `/api/inventory/${a._id}/transactions`, { body: { type: 'out', qty: 5 } });
    assert.equal(await models.PurchaseOrder.countDocuments({ 'lines.item': a._id }), 1, 'no second draft for the same item');
  });

  test('items from the same supplier share a draft, and receiving restores stock and clears the alert', async () => {
    const s = await supplier();
    const a = await item({ quantity: 40, reorderThreshold: 50, supplierRef: s._id });
    const b = await item({ quantity: 40, reorderThreshold: 50, supplierRef: s._id });
    await call('POST', `/api/inventory/${a._id}/transactions`, { body: { type: 'out', qty: 1 } });
    await call('POST', `/api/inventory/${b._id}/transactions`, { body: { type: 'out', qty: 1 } });
    const drafts = await models.PurchaseOrder.find({ supplier: s._id }).lean();
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].lines.length, 2);
    await call('PATCH', `/api/purchase-orders/${drafts[0]._id}/approve`);
    await call('PATCH', `/api/purchase-orders/${drafts[0]._id}/receive`);
    assert.ok((await qty(a._id)) >= 50);
    assert.equal(await models.Alert.countDocuments({ sourceId: String(a._id), type: 'low_stock', status: 'open' }), 0);
  });

  test('draft-from-low-stock covers items that were already low', async () => {
    const a = await item({ quantity: 1, reorderThreshold: 50 });
    const r = await call('POST', '/api/purchase-orders/draft-from-low-stock');
    assert.equal(r.status, 200);
    assert.ok(r.body.data.drafted >= 1);
    assert.equal(await models.PurchaseOrder.countDocuments({ 'lines.item': a._id }), 1);
    assert.equal((await call('POST', '/api/purchase-orders/draft-from-low-stock')).body.data.drafted, 0, 'idempotent');
  });
});

describe('Valuation and CSV import', () => {
  test('values stock at cost and counts items without a cost separately', async () => {
    await freshDb(mongoose);
    const passwordHash = await bcrypt.hash('Password@123', 4);
    await models.User.create({ name: 'Manager', email: 'm@t.io', passwordHash, role: 'manager' });
    tokens.manager = (await call('POST', '/api/auth/login', { token: null, body: { email: 'm@t.io', password: 'Password@123' } })).body.data.accessToken;
    await item({ quantity: 10, unitCost: 2.5 });
    await item({ quantity: 4, unitCost: 100 });
    await item({ quantity: 50 });
    const r = await call('GET', '/api/inventory/valuation');
    assert.equal(r.body.data.totalValue, 425);
    assert.equal(r.body.data.itemsWithoutCost, 1);
  });

  test('import creates new SKUs, updates existing ones with an adjust transaction, and reports bad rows', async () => {
    const old = await item({ quantity: 10, unitCost: 1 });
    const r = await call('POST', '/api/inventory/import', {
      body: { rows: [
        { sku: 'NEW-1', name: 'New part', quantity: 25, unit: 'pcs', reorderThreshold: 5, unitCost: 3 },
        { sku: old.sku, name: 'Renamed', quantity: 15, unit: 'kg', reorderThreshold: 50, unitCost: 2 },
      ] },
    });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.data.created, r.body.data.updated, r.body.data.errors.length], [1, 1, 0]);
    const updated = await models.InventoryItem.findById(old._id).lean();
    assert.deepEqual([updated.name, updated.quantity, updated.unitCost], ['Renamed', 15, 2]);
    assert.equal(await models.StockTransaction.countDocuments({ item: old._id, type: 'adjust', qty: 5 }), 1);

    assert.equal((await call('POST', '/api/inventory/import', { body: { rows: [{ sku: 'X', name: 'Too short sku', quantity: -1 }] } })).status, 400);
    assert.equal((await call('POST', '/api/inventory/import', { body: { rows: [] } })).status, 400);
    assert.equal((await call('POST', '/api/inventory/import', { token: tokens.worker, body: { rows: [{ sku: 'ZZ-1', name: 'Nope', quantity: 1 }] } })).status, 403);
  });
});
