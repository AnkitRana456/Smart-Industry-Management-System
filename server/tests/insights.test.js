import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';
import { freshDb } from './helpers/db.js';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_insights';
process.env.SCHEDULER_ENABLED = 'false';
process.env.ML_TIMEOUT_MS = '800';
process.env.GEMINI_API_KEY = '';
process.env.GEMINI_MODEL = '';

// Stand-in for the Python service: a flat-rate forecast so the arithmetic in the tests is checkable.
const fake = { mode: 'ok', requests: [] };
const mlServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    fake.requests.push({ url: req.url, body });
    const send = (status, b) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (fake.mode === 'down') return req.socket.destroy();
    if (fake.mode === 'bad-shape') return send(200, { nope: true });
    if (req.url === '/forecast') {
      const rate = body.series.slice(-7).reduce((a, b) => a + b, 0) / 7;
      const amount = body.level ?? body.target;
      const days = rate > 0 ? Math.round((amount / rate) * 10) / 10 : null;
      return send(200, {
        daysOfHistory: body.series.length, averagePerDay: rate, recentPerDay: rate, trendPerDay: 0, noise: 0,
        forecast: [{ day: 1, expected: rate, low: rate, high: rate }], confidence: 'ok',
        expectedDays: days != null && days <= body.horizon ? days : null, earliestDays: days, latestDays: days,
        withinHorizon: days != null && days <= body.horizon, usesLevel: body.level != null,
      });
    }
    if (req.url === '/anomaly') {
      return send(200, {
        historyPoints: body.history.length, flagged: 1, baseline: { temperatureC: 60 },
        points: body.recent.map((_, i) => ({ anomalous: i === body.recent.length - 1, score: i === body.recent.length - 1 ? 0.9 : 0.1, mostUnusual: { feature: 'temperatureC', value: 90, typical: 60, deviation: 9 } })),
      });
    }
    return send(404, {});
  });
});
await new Promise((r) => mlServer.listen(0, r));
process.env.ML_SERVICE_URL = `http://127.0.0.1:${mlServer.address().port}`;

const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { createApp } = await import('../src/app.js');
const models = await import('../src/models/index.js');
const { runTool } = await import('../src/modules/ai/tools.js');
const { rangeFromDays } = await import('../src/modules/analytics/analytics.service.js');

const DAY = 86_400_000;
let server;
let base;
const tokens = {};
let seq = 0;

async function call(method, path, { token = tokens.manager } = {}) {
  const res = await fetch(base + path, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: await res.json() };
}
const machine = () => models.Machine.create({ name: `Mach ${++seq}`, code: `IN-${seq}`, status: 'running' });
const item = (quantity, extra = {}) => models.InventoryItem.create({ sku: `IS-${++seq}`, name: `Part ${seq}`, quantity, unit: 'kg', reorderThreshold: 0, ...extra });
/** Uses `perDay` units on each of the last `days` days. */
const use = async (it, perDay, days = 10) => {
  for (let d = 0; d < days; d++) {
    const tx = await models.StockTransaction.create({ item: it._id, type: 'out', qty: perDay });
    await models.StockTransaction.collection.updateOne({ _id: tx._id }, { $set: { createdAt: new Date(Date.now() - (d + 0.5) * DAY) } });
  }
};

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
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Password@123' }) });
    tokens[k] = (await r.json()).data.accessToken;
  }
});
beforeEach(() => { fake.mode = 'ok'; fake.requests.length = 0; });
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.closeAllConnections?.();
  server.close();
  mlServer.close();
});

describe('Stock cover', () => {
  test('turns recorded usage into days of cover, a run-out date and a reorder size that spans the lead time', async () => {
    const sup = await models.Supplier.create({ name: 'Slow Co', leadTimeDays: 10 });
    const it = await item(100, { supplierRef: sup._id });
    await use(it, 10);
    const r = (await call('GET', '/api/insights/stock')).body.data.find((x) => x.sku === it.sku);
    assert.equal(r.enoughHistory, true);
    assert.equal(r.daysOfCover, 10, '100 on hand at 10 a day');
    assert.equal(r.leadTimeDays, 10);
    assert.equal(r.suggestedOrderQty, 10 * (10 + 7) - 100, 'lead time plus a week of usage, less what is on hand');
    const sent = fake.requests.filter((q) => q.url === '/forecast').at(-1).body;
    assert.equal(sent.level, 100);
    assert.equal(sent.series.length, 30);
    assert.equal(sent.series.reduce((a, b) => a + b, 0), 100, 'ten days of 10, the rest zero-filled');
  });

  test('items with no usage are listed without a guess and never reach the model', async () => {
    await Promise.all([models.InventoryItem.deleteMany({}), models.StockTransaction.deleteMany({})]);
    fake.requests.length = 0;
    const idle = await item(50);
    const r = (await call('GET', '/api/insights/stock')).body.data;
    assert.equal(r[0].sku, idle.sku);
    assert.equal(r[0].enoughHistory, false);
    assert.equal(fake.requests.length, 0);
  });

  test('the item that runs out first is listed first', async () => {
    const slow = await item(1000);
    const fast = await item(30);
    await use(slow, 5);
    await use(fast, 10);
    const rows = (await call('GET', '/api/insights/stock')).body.data.filter((x) => x.enoughHistory);
    assert.deepEqual(rows.map((x) => x.sku), [fast.sku, slow.sku]);
  });

  test('is staff-only, and a down or confused ML service gives a clean 503 or 502', async () => {
    assert.equal((await call('GET', '/api/insights/stock', { token: tokens.worker })).status, 403);
    assert.equal((await call('GET', '/api/insights/stock', { token: null })).status, 401);
    const it = await item(40);
    await use(it, 4);
    fake.mode = 'down';
    const down = await call('GET', '/api/insights/stock');
    assert.equal(down.status, 503);
    assert.ok(!JSON.stringify(down.body).includes('127.0.0.1'));
    fake.mode = 'bad-shape';
    assert.equal((await call('GET', '/api/insights/stock')).status, 502);
  });
});

describe('Order projection', () => {
  const order = (extra = {}) => models.ProductionOrder.create({ orderNo: `PO-${++seq}`, product: 'Gear', quantity: 1000, producedQty: 400, status: 'in_progress', ...extra });
  const output = async (o, qty, days) => {
    for (let d = 0; d < days; d++) {
      const l = await models.OutputLog.create({ order: o._id, product: 'Gear', qty });
      await models.OutputLog.collection.updateOne({ _id: l._id }, { $set: { at: new Date(Date.now() - (d + 0.5) * DAY) } });
    }
  };

  test('projects the finish from the recent pace and flags an order that will miss its due date', async () => {
    const o = await order({ dueDate: new Date(Date.now() + 3 * DAY) });
    await output(o, 50, 10); // 600 left at 50 a day = 12 days, due in 3
    const r = (await call('GET', `/api/insights/orders/${o._id}`)).body.data;
    assert.equal(r.status, 'late');
    assert.equal(r.remaining, 600);
    assert.equal(r.pacePerDay, Math.round((50 * 7) / 7));
    assert.ok(r.expectedFinish > r.dueDate.slice(0, 10));
  });

  test('an order with a comfortable margin is on track, and one with no output is unknown, not guessed', async () => {
    const fine = await order({ dueDate: new Date(Date.now() + 30 * DAY) });
    await output(fine, 100, 10);
    assert.equal((await call('GET', `/api/insights/orders/${fine._id}`)).body.data.status, 'on_track');
    const stuck = await order({ dueDate: new Date(Date.now() + 5 * DAY) });
    const r = (await call('GET', `/api/insights/orders/${stuck._id}`)).body.data;
    assert.equal(r.status, 'unknown');
    assert.match(r.message, /Not enough output/);
  });

  test('the list covers in-progress orders only; unknown ids are 404 or 400', async () => {
    await order({ status: 'pending' });
    const rows = (await call('GET', '/api/insights/orders')).body.data;
    assert.ok(rows.every((x) => ['late', 'on_track', 'unknown', 'done'].includes(x.status)));
    assert.equal((await call('GET', `/api/insights/orders/${new mongoose.Types.ObjectId()}`)).status, 404);
    assert.equal((await call('GET', '/api/insights/orders/nope')).status, 400);
  });
});

describe('Anomaly detection', () => {
  const readings = async (m, n) => {
    await models.SensorReading.insertMany(Array.from({ length: n }, (_, i) => ({
      machine: m._id, temperatureC: 60, vibrationMms: 2, rpm: 1800, powerKw: 7, at: new Date(Date.now() - (n - i) * 60_000),
    })));
  };

  test('asks for more readings instead of fitting on too little', async () => {
    const m = await machine();
    await readings(m, 12);
    const r = await call('GET', `/api/insights/machines/${m._id}/anomalies`);
    assert.equal(r.status, 422);
    assert.match(r.body.message, /Not enough telemetry/);
    assert.equal(fake.requests.length, 0);
  });

  test('splits the readings into what is normal and what is recent, and stamps each score with its time', async () => {
    const m = await machine();
    await readings(m, 80);
    const r = await call('GET', `/api/insights/machines/${m._id}/anomalies`);
    assert.equal(r.status, 200);
    assert.equal(fake.requests[0].body.history.length, 70);
    assert.equal(fake.requests[0].body.recent.length, 10);
    assert.equal(r.body.data.points.length, 10);
    assert.ok(r.body.data.points.every((p) => p.at));
    assert.equal(r.body.data.points.at(-1).anomalous, true);
    assert.equal(r.body.data.machine.code, m.code);
  });

  test('readings missing a sensor are left out rather than filled in; unknown machine is 404; workers are refused', async () => {
    const m = await machine();
    await readings(m, 40);
    await models.SensorReading.create({ machine: m._id, temperatureC: 99, at: new Date() });
    await call('GET', `/api/insights/machines/${m._id}/anomalies`);
    assert.ok(fake.requests[0].body.recent.every((x) => x.rpm === 1800));
    assert.equal((await call('GET', `/api/insights/machines/${new mongoose.Types.ObjectId()}/anomalies`)).status, 404);
    assert.equal((await call('GET', `/api/insights/machines/${m._id}/anomalies`, { token: tokens.worker })).status, 403);
  });
});

describe('Analyst tools backed by the model service', () => {
  test('stock and order figures come from the forecasts, and an out-of-stock warning is counted', async () => {
    await Promise.all([models.InventoryItem.deleteMany({}), models.StockTransaction.deleteMany({}), models.ProductionOrder.deleteMany({})]);
    const it = await item(20, { name: 'Cutting fluid' });
    await use(it, 5);
    const stock = await runTool({ name: 'getStockForecast', args: {} }, rangeFromDays(7));
    const fig = (r, label) => r.keyFigures.find((f) => f.label === label)?.value;
    assert.equal(fig(stock, 'Items forecast'), 1);
    assert.equal(fig(stock, 'Items running out within 14 days'), 1);
    assert.equal(stock.keyFigures.find((f) => /Days of cover/.test(f.label)).value, 4);
    const filtered = await runTool({ name: 'getStockForecast', args: { search: 'nothing-like-this' } }, rangeFromDays(7));
    assert.equal(fig(filtered, 'Items forecast'), 0);

    await models.ProductionOrder.create({ orderNo: 'PO-T', product: 'Gear', quantity: 100, producedQty: 10, status: 'in_progress', dueDate: new Date(Date.now() + DAY) });
    const orders = await runTool({ name: 'getOrderProjections', args: {} }, rangeFromDays(7));
    assert.equal(fig(orders, 'Orders in progress'), 1);
  });
});
