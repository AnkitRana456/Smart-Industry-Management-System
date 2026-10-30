import assert from 'node:assert/strict';
import http from 'node:http';
import { freshDb } from './helpers/db.js';
import { after, before, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_simulator';

const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { createApp } = await import('../src/app.js');
const sim = await import('../src/modules/simulator/simulator.service.js');
const models = await import('../src/models/index.js');

let server;
let base;
const tokens = {};

async function call(method, path, { token = tokens.admin, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

// A repeatable "random" stream so assertions don't depend on luck.
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await freshDb(mongoose);
  const passwordHash = await bcrypt.hash('Password@123', 4);
  await models.User.create([
    { name: 'Admin', email: 'a@t.io', passwordHash, role: 'admin' },
    { name: 'Manager', email: 'm@t.io', passwordHash, role: 'manager' },
  ]);
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of [['admin', 'a@t.io'], ['manager', 'm@t.io']]) {
    tokens[k] = (await call('POST', '/api/auth/login', { token: null, body: { email, password: 'Password@123' } })).body.data.accessToken;
  }
  const mk = (i, status) => ({ name: `M${i}`, code: `S-${i}`, status, runHours: 100, toolWearMin: 50, temperatureC: 60, vibrationMms: 2, lastReadingAt: new Date(Date.now() - 5 * 86_400_000) });
  const machines = await models.Machine.create([mk(1, 'running'), mk(2, 'running'), mk(3, 'idle'), mk(4, 'maintenance'), mk(5, 'offline')]);
  await models.ProductionOrder.create({ orderNo: 'PO-S1', product: 'Gear', quantity: 1000, producedQty: 100, status: 'in_progress', machines: [machines[0]._id] });
});

after(async () => {
  sim.stop();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.closeAllConnections?.();
  server.close();
});

describe('Simulator', () => {
  test('only admins can use it', async () => {
    assert.equal((await call('POST', '/api/simulate/machine-events', { token: tokens.manager, body: {} })).status, 403);
    assert.equal((await call('GET', '/api/simulate/status', { token: null })).status, 401);
    assert.equal((await call('POST', '/api/simulate/machine-events', { body: { events: 99 } })).status, 400);
  });

  test('a tick writes real downtime logs through the normal status path', async () => {
    const before = await models.MachineLog.countDocuments();
    const r = await call('POST', '/api/simulate/machine-events', { body: { events: 3 } });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.changes.length, 3);
    assert.ok(r.body.data.changes.every((c) => c.from !== c.to));
    assert.equal(await models.MachineLog.countDocuments(), before + 3);
  });

  test('readings are refreshed so they are never stale after a tick', async () => {
    await sim.tick({ events: 1 }, seeded(7));
    const stale = await models.Machine.countDocuments({ lastReadingAt: { $lt: new Date(Date.now() - 60_000) } });
    assert.equal(stale, 0);
    const m = await models.Machine.findOne({ code: 'S-1' }).lean();
    assert.ok(m.temperatureC >= 25 && m.temperatureC <= 130);
    assert.ok(m.vibrationMms >= 0.2 && m.vibrationMms <= 12);
  });

  test('output advances only while every machine of an order is running, and never completes the order', async () => {
    await models.Machine.updateMany({}, { status: 'running' });
    await models.Machine.updateOne({ code: 'S-1' }, { status: 'running' });
    // events: 0 would be invalid via the API, so call the service directly with a rng that never picks a machine twice.
    const orderBefore = await models.ProductionOrder.findOne({ orderNo: 'PO-S1' }).lean();
    await sim.tick({ events: 0 }, seeded(3));
    const orderAfter = await models.ProductionOrder.findOne({ orderNo: 'PO-S1' }).lean();
    assert.ok(orderAfter.producedQty > orderBefore.producedQty);
    assert.ok(orderAfter.producedQty < orderAfter.quantity);
    assert.equal(orderAfter.status, 'in_progress');
    assert.ok(await models.OutputLog.countDocuments({ order: orderAfter._id }) >= 1);

    await models.Machine.updateOne({ code: 'S-1' }, { status: 'offline' });
    const frozen = (await models.ProductionOrder.findOne({ orderNo: 'PO-S1' }).lean()).producedQty;
    await sim.tick({ events: 0 }, seeded(4));
    assert.equal((await models.ProductionOrder.findOne({ orderNo: 'PO-S1' }).lean()).producedQty, frozen);
  });

  test('finished maintenance resets tool wear and service dates', async () => {
    await models.Machine.updateOne({ code: 'S-4' }, { status: 'maintenance', toolWearMin: 300 });
    await models.Machine.updateMany({ code: { $ne: 'S-4' } }, { status: 'idle' });
    // With only one transition available from maintenance, forcing every machine into the sample guarantees S-4 moves.
    await sim.tick({ events: 5 }, seeded(11));
    const m = await models.Machine.findOne({ code: 'S-4' }).lean();
    assert.equal(m.status, 'running');
    assert.ok(m.toolWearMin < 300);
    assert.ok(m.nextServiceDue > new Date());
  });

  test('start and stop control a background run', async () => {
    const started = await call('POST', '/api/simulate/start', { body: { intervalSec: 2 } });
    assert.equal(started.body.data.running, true);
    assert.equal((await call('GET', '/api/simulate/status')).body.data.running, true);
    const stopped = await call('POST', '/api/simulate/stop', { body: {} });
    assert.equal(stopped.body.data.running, false);
  });
});
