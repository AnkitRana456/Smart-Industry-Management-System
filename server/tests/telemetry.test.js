import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { freshDb } from './helpers/db.js';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_telemetry';
process.env.SCHEDULER_ENABLED = 'false';

const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { createApp } = await import('../src/app.js');
const models = await import('../src/models/index.js');
const { breaches, computeHealth } = await import('../src/modules/telemetry/telemetry.service.js');

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
const machine = (extra = {}) => models.Machine.create({ name: `Mach ${++seq}`, code: `TM-${seq}`, status: 'running', ...extra });
const send = (m, values, opts) => call('POST', '/api/telemetry', { body: { machine: String(m._id), ...values }, ...opts });

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

describe('Telemetry ingestion', () => {
  test('stores a reading, updates the machine and returns a health score', async () => {
    const m = await machine();
    const r = await send(m, { temperatureC: 60, vibrationMms: 2, rpm: 1800, powerKw: 7 });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.healthScore, 100);
    const fresh = await models.Machine.findById(m._id).lean();
    assert.deepEqual([fresh.temperatureC, fresh.vibrationMms, fresh.healthScore], [60, 2, 100]);
    assert.ok(fresh.lastReadingAt);
    assert.equal(await models.SensorReading.countDocuments({ machine: m._id }), 1);
  });

  test('is staff-only and validated', async () => {
    const m = await machine();
    assert.equal((await send(m, { temperatureC: 60 }, { token: tokens.worker })).status, 403);
    assert.equal((await send(m, {})).status, 400, 'needs at least one reading');
    assert.equal((await send(m, { temperatureC: 99999 })).status, 400);
    assert.equal((await send(m, { vibrationMms: -1 })).status, 400);
    assert.equal((await call('POST', '/api/telemetry', { body: { machine: String(new mongoose.Types.ObjectId()), temperatureC: 50 } })).status, 404);
  });

  test('a reading over the limit raises one alert, escalates, and clears when it returns to normal', async () => {
    const m = await machine();
    const open = () => models.Alert.find({ sourceId: String(m._id), type: 'telemetry_temperatureC', status: { $in: ['open', 'acknowledged'] } }).lean();
    await send(m, { temperatureC: 90 });
    await send(m, { temperatureC: 91 });
    let alerts = await open();
    assert.equal(alerts.length, 1, 'repeat readings do not stack alerts');
    assert.equal(alerts[0].severity, 'warning');
    assert.match(alerts[0].message, /above the warning limit of 85/);
    await send(m, { temperatureC: 70 });
    assert.equal((await open()).length, 0, 'back in range resolves it');
    await send(m, { temperatureC: 105 });
    alerts = await open();
    assert.equal(alerts[0].severity, 'critical');
  });

  test('a reading that omits a field does not clear that field\'s alert', async () => {
    const m = await machine();
    await send(m, { vibrationMms: 8 });
    await send(m, { temperatureC: 50 });
    const n = await models.Alert.countDocuments({ sourceId: String(m._id), type: 'telemetry_vibrationMms', status: 'open' });
    assert.equal(n, 1);
  });
});

describe('History and health score', () => {
  test('history is oldest first, limited to the window, and readable by workers', async () => {
    const m = await machine();
    const at = (h) => new Date(Date.now() - h * 3_600_000);
    await models.SensorReading.create([
      { machine: m._id, temperatureC: 50, at: at(1) },
      { machine: m._id, temperatureC: 52, at: at(0.5) },
      { machine: m._id, temperatureC: 99, at: at(30) },
    ]);
    const r = await call('GET', `/api/machines/${m._id}/telemetry?hours=2`, { token: tokens.worker });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.map((x) => x.temperatureC), [50, 52]);
    assert.equal((await call('GET', `/api/machines/${m._id}/telemetry?hours=999`)).status, 400);
  });

  test('health score explains every deduction', async () => {
    const m = await machine({ status: 'offline', riskLevel: 'HIGH', temperatureC: 105 });
    const r = await call('GET', `/api/machines/${m._id}/health-score`);
    assert.equal(r.status, 200);
    const labels = r.body.data.factors.map((f) => f.label);
    assert.ok(labels.includes('Currently offline') && labels.includes('AI assessment rates it HIGH risk') && labels.some((l) => /critical limit/.test(l)));
    assert.equal(r.body.data.score, 100 - 20 - 25 - 20);
  });

  test('computeHealth is clamped, and a healthy machine scores 100', () => {
    assert.equal(computeHealth({ status: 'running' }).score, 100);
    const bad = computeHealth(
      { status: 'offline', riskLevel: 'HIGH', mlRisk: 'High', temperatureC: 120, vibrationMms: 9, nextServiceDue: new Date(Date.now() - 40 * 86_400_000) },
      { downtimeMins7d: 5000 },
    );
    assert.equal(bad.score, 0);
    assert.ok(bad.factors.length >= 6);
  });

  test('breaches reports severity per field and ignores missing values', () => {
    assert.deepEqual(breaches({ temperatureC: 100, vibrationMms: 5 }).map((b) => [b.field, b.severity]), [['temperatureC', 'critical'], ['vibrationMms', 'warning']]);
    assert.deepEqual(breaches({ temperatureC: 84.9 }), []);
    assert.deepEqual(breaches({}), []);
  });
});
