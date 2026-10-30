import assert from 'node:assert/strict';
import http from 'node:http';
import { freshDb } from './helpers/db.js';
import { after, before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_ml';
process.env.ML_API_KEY = 'test-ml-key';
process.env.ML_TIMEOUT_MS = '400';
process.env.GEMINI_API_KEY = '';
process.env.GEMINI_MODEL = '';

// A stand-in for the Python service that can be told to misbehave.
const fake = { mode: 'ok', requests: [] };
const mlServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    fake.requests.push({ url: req.url, method: req.method, key: req.headers['x-api-key'], body: raw ? JSON.parse(raw) : null });
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    if (fake.mode === 'down') return req.socket.destroy();
    if (fake.mode === '500') return send(500, { detail: 'boom: secret internal detail' });
    if (fake.mode === '422') return send(422, { detail: 'Invalid input' });
    if (fake.mode === 'bad-json') return send(200, '<html>not json');
    if (fake.mode === 'slow') return setTimeout(() => send(200, {}), 2000);

    if (req.url === '/health') return send(200, { status: 'ok', modelLoaded: true, modelVersion: 'fake-v1' });
    if (req.url === '/model') return send(200, { modelVersion: 'fake-v1', algorithm: 'logistic-regression', dataSource: 'synthetic', trainedAt: '2026-10-29T00:00:00Z', metrics: { rocAuc: 0.8 }, bands: { mediumFrom: 0.1, highFrom: 0.3 }, limitations: ['synthetic'], features: [] });
    if (req.url === '/sensor-model') return send(200, { modelVersion: 'sensor-fake', dataSource: 'AI4I 2020 (UCI), public and synthetic', metrics: { rocAuc: 0.94 }, limitations: ['not this plant'] });
    const wear = JSON.parse(raw).toolWearMin;
    const [risk, probability] = wear > 200 ? ['High', 0.61] : wear > 100 ? ['Medium', 0.18] : ['Low', 0.04];
    const body = {
      risk, probability, modelVersion: 'fake-v1', dataSource: 'synthetic',
      topFactors: [{ feature: 'toolWearMin', label: 'Tool wear', value: wear, unit: 'min', effect: 0.2, direction: 'raises' }],
      warnings: wear > 350 ? ['Tool wear is outside the training range'] : [],
    };
    return send(200, fake.mode === 'bad-shape' ? { ...body, risk: 'Severe' } : body);
  });
});
await new Promise((r) => mlServer.listen(0, r));
process.env.ML_SERVICE_URL = `http://127.0.0.1:${mlServer.address().port}`;

const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { io: connect } = await import('socket.io-client');
const { createApp } = await import('../src/app.js');
const { initSockets } = await import('../src/sockets/index.js');
const { env } = await import('../src/config/env.js');
const { runMlJob } = await import('../src/modules/ai/scheduler.js');
const { scoreAll } = await import('../src/modules/ml/ml.service.js');
const models = await import('../src/models/index.js');

let server;
let base;
const tokens = {};
let seq = 0;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function call(method, path, { token = tokens.manager, body } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
const machine = (o = {}) => models.Machine.create({
  name: `Press ${++seq}`, code: `ML-${seq}`, status: 'running', runHours: 1200, toolWearMin: 60, temperatureC: 58, vibrationMms: 1.8,
  lastReadingAt: new Date(Date.now() - HOUR), lastServiceAt: new Date(Date.now() - 40 * DAY), nextServiceDue: new Date(Date.now() + 10 * DAY), ...o,
});
const score = (m) => call('POST', `/api/machines/${m._id}/ml-predict`);
const mlCalls = () => fake.requests.filter((r) => r.url === '/predict');

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await freshDb(mongoose);
  const passwordHash = await bcrypt.hash('Password@123', 4);
  await models.User.create([{ name: 'Manager', email: 'm@t.io', passwordHash, role: 'manager' }, { name: 'Worker', email: 'w@t.io', passwordHash, role: 'worker' }]);
  server = http.createServer(createApp());
  initSockets(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of [['manager', 'm@t.io'], ['worker', 'w@t.io']]) {
    tokens[k] = (await call('POST', '/api/auth/login', { token: null, body: { email, password: 'Password@123' } })).body.data.accessToken;
  }
});

beforeEach(() => { fake.mode = 'ok'; fake.requests.length = 0; });

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.closeAllConnections?.();
  server.close();
  mlServer.closeAllConnections?.();
  mlServer.close();
});

describe('Access and inputs', () => {
  test('workers and anonymous callers are rejected; unknown machines are 404; bad ids are 400', async () => {
    const m = await machine();
    assert.equal((await call('POST', `/api/machines/${m._id}/ml-predict`, { token: tokens.worker })).status, 403);
    assert.equal((await call('POST', `/api/machines/${m._id}/ml-predict`, { token: null })).status, 401);
    assert.equal((await call('POST', '/api/machines/64b64c1f1c9d440000000000/ml-predict')).status, 404);
    assert.equal((await call('POST', '/api/machines/nope/ml-predict')).status, 400);
    assert.equal((await call('GET', `/api/machines/${m._id}/ml-predictions`, { token: tokens.worker })).status, 403);
    assert.equal((await call('GET', '/api/machines', { token: tokens.worker })).status, 200, 'workers can still read machines');
  });

  test('when no service is configured the feature says so and nothing is called', async () => {
    const saved = env.mlServiceUrl;
    env.mlServiceUrl = '';
    try {
      const r = await score(await machine());
      assert.equal(r.status, 503);
      assert.match(r.body.message, /not configured/i);
      assert.deepEqual((await call('GET', '/api/ml/status')).body.data, { enabled: false, reachable: false });
      assert.deepEqual(await runMlJob(), { skipped: true });
    } finally {
      env.mlServiceUrl = saved;
    }
    assert.equal(fake.requests.length, 0);
  });
});

describe('Features and scoring', () => {
  test('the six inputs come from the database, and the API key is sent', async () => {
    const m = await machine({ runHours: 1234, toolWearMin: 75, temperatureC: 61, vibrationMms: 2.2 });
    await models.MachineLog.create([
      { machine: m._id, toStatus: 'offline', startedAt: new Date(Date.now() - 3 * DAY), durationMins: 20 },
      { machine: m._id, toStatus: 'maintenance', startedAt: new Date(Date.now() - 9 * DAY), durationMins: 60 },
      { machine: m._id, toStatus: 'offline', startedAt: new Date(Date.now() - 60 * DAY), durationMins: 500 },
    ]);
    const r = await score(m);
    assert.equal(r.status, 201);
    const sent = mlCalls()[0];
    assert.equal(sent.key, 'test-ml-key');
    assert.deepEqual(sent.body, { runHours: 1234, daysSinceService: 40, downtimeCount30d: 2, toolWearMin: 75, temperatureC: 61, vibrationMms: 2.2 });
  });

  test('a machine with missing inputs is reported, never guessed, and the service is not called', async () => {
    const m = await machine({ vibrationMms: undefined, lastServiceAt: undefined });
    const r = await score(m);
    assert.equal(r.status, 422);
    assert.match(r.body.message, /Missing: daysSinceService, vibrationMms/);
    assert.equal(fake.requests.length, 0);
  });

  test('implausible readings are treated as missing instead of being sent to the model', async () => {
    const r = await score(await machine({ temperatureC: 5000 }));
    assert.equal(r.status, 422);
    assert.match(r.body.message, /temperatureC/);
  });

  test('the result is saved, labelled as synthetic-trained, and shown on the machine', async () => {
    const m = await machine({ toolWearMin: 250 });
    const r = await score(m);
    const d = r.body.data;
    assert.equal(d.risk, 'High');
    assert.equal(d.probability, 0.61);
    assert.equal(d.modelVersion, 'fake-v1');
    assert.equal(d.dataSource, 'synthetic');
    assert.equal(d.topFactors[0].feature, 'toolWearMin');
    const doc = await models.Machine.findById(m._id).lean();
    assert.deepEqual([doc.mlRisk, doc.mlProbability], ['High', 0.61]);
    assert.equal(doc.riskLevel, 'INSUFFICIENT_DATA', 'the Gemini assessment field is untouched');
    assert.equal(await models.MlPrediction.countDocuments({ machine: m._id }), 1);
  });

  test('a repeat with unchanged data reuses the saved result; changed data scores again', async () => {
    const m = await machine({ toolWearMin: 120 });
    await score(m);
    const again = await score(m);
    assert.equal(again.body.data.reused, true);
    assert.equal(mlCalls().length, 1);
    await models.Machine.updateOne({ _id: m._id }, { toolWearMin: 130 });
    assert.equal((await score(m)).body.data.reused, false);
    assert.equal(mlCalls().length, 2);
  });

  test('stale readings and the service\'s own warnings are both returned', async () => {
    const r = await score(await machine({ toolWearMin: 380, lastReadingAt: new Date(Date.now() - 3 * DAY) }));
    assert.ok(r.body.data.warnings.some((w) => /hours old/.test(w)));
    assert.ok(r.body.data.warnings.some((w) => /outside the training range/.test(w)));
  });

  test('history is newest first', async () => {
    const m = await machine({ toolWearMin: 50 });
    await score(m);
    await models.Machine.updateOne({ _id: m._id }, { toolWearMin: 150 });
    await score(m);
    const h = await call('GET', `/api/machines/${m._id}/ml-predictions`);
    assert.deepEqual(h.body.data.map((p) => p.risk), ['Medium', 'Low']);
  });
});

describe('Alert policy', () => {
  test('High raises one warning alert; scoring again does not duplicate it; Low resolves it', async () => {
    const m = await machine({ toolWearMin: 250 });
    await score(m);
    await models.Machine.updateOne({ _id: m._id }, { toolWearMin: 260 });
    await score(m);
    const open = await models.Alert.find({ type: 'ml_risk', sourceId: String(m._id), status: 'open' }).lean();
    assert.equal(open.length, 1);
    assert.equal(open[0].severity, 'warning');
    assert.match(open[0].message, /synthetic data/);

    await models.Machine.updateOne({ _id: m._id }, { toolWearMin: 20 });
    await score(m);
    assert.equal(await models.Alert.countDocuments({ type: 'ml_risk', sourceId: String(m._id), status: 'open' }), 0);
  });

  test('Medium leaves alerts alone', async () => {
    const m = await machine({ toolWearMin: 150 });
    await score(m);
    assert.equal(await models.Alert.countDocuments({ type: 'ml_risk', sourceId: String(m._id) }), 0);
  });
});

describe('When the model service misbehaves', () => {
  for (const [mode, status] of [['500', 503], ['down', 503], ['slow', 503], ['bad-json', 502], ['bad-shape', 502], ['422', 422]]) {
    test(`${mode} gives ${status}, saves nothing, and leaks no internals`, async () => {
      const m = await machine({ toolWearMin: 250 });
      fake.mode = mode;
      const started = Date.now();
      const r = await score(m);
      assert.equal(r.status, status);
      assert.ok(!JSON.stringify(r.body).includes('secret internal detail'));
      assert.equal(await models.MlPrediction.countDocuments({ machine: m._id }), 0);
      assert.equal((await models.Machine.findById(m._id).lean()).mlRisk, undefined);
      if (mode === 'slow') assert.ok(Date.now() - started < 1500, 'the timeout bounds the wait');
    });
  }

  test('the rest of the API keeps working while the model service is down', async () => {
    fake.mode = 'down';
    assert.equal((await call('GET', '/api/machines')).status, 200);
    assert.equal((await call('GET', '/api/analytics/overview')).status, 200);
    assert.equal((await call('GET', '/health', { token: null })).status, 200);
  });

  test('status reports an unreachable service without throwing', async () => {
    fake.mode = 'down';
    const s = (await call('GET', '/api/ml/status')).body.data;
    assert.equal(s.enabled, true);
    assert.equal(s.reachable, false);
  });

  test('status reports the model version, metrics and limitations when healthy', async () => {
    const s = (await call('GET', '/api/ml/status')).body.data;
    assert.deepEqual([s.reachable, s.modelLoaded, s.modelVersion, s.dataSource], [true, true, 'fake-v1', 'synthetic']);
    assert.ok(s.metrics.rocAuc && s.limitations.length);
  });
});

describe('Hourly scoring', () => {
  test('scores what it can, skips machines with missing inputs, and writes scheduled predictions', async () => {
    await models.Machine.deleteMany({});
    await models.MlPrediction.deleteMany({});
    await machine({ toolWearMin: 50 });
    await machine({ toolWearMin: 250 });
    await machine({ temperatureC: undefined });
    const r = await runMlJob();
    assert.deepEqual([r.scored, r.skipped, r.unavailable], [2, 1, false]);
    assert.equal(await models.MlPrediction.countDocuments({ source: 'scheduled' }), 2);
  });

  test('stops at the first outage instead of failing once per machine', async () => {
    await models.Machine.deleteMany({});
    for (let i = 0; i < 5; i++) await machine();
    fake.mode = 'down';
    const r = await scoreAll();
    assert.equal(r.unavailable, true);
    assert.equal(r.scored, 0);
    assert.equal(fake.requests.length, 1, 'only one request was attempted');
  });
});

describe('Sockets', () => {
  test('staff hear about a new score; workers do not', async () => {
    const m = await machine({ toolWearMin: 250 });
    const staff = connect(base, { auth: { token: tokens.manager }, reconnection: false });
    const worker = connect(base, { auth: { token: tokens.worker }, reconnection: false });
    await Promise.all([new Promise((r) => staff.on('connect', r)), new Promise((r) => worker.on('connect', r))]);
    let workerGot = false;
    worker.on('ml:scored', () => { workerGot = true; });
    const got = new Promise((r) => staff.on('ml:scored', r));
    await score(m);
    assert.equal((await got).risk, 'High');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(workerGot, false);
    staff.close();
    worker.close();
  });
});

describe('Sensor model second opinion', () => {
  const sensorCalls = () => fake.requests.filter((r) => r.url === '/predict-sensor');
  const reading = (m, o = {}) => models.SensorReading.create({ machine: m._id, rpm: 1500, powerKw: 6.3, temperatureC: 60, at: new Date(Date.now() - 60_000), ...o });
  const ask = (m, token) => call('POST', `/api/machines/${m._id}/sensor-risk`, { token });

  test('turns power and rpm into torque and scores the newest reading, without storing anything or raising an alert', async () => {
    const m = await machine({ toolWearMin: 250 });
    await reading(m, { rpm: 1000, powerKw: 1 }); // older, ignored
    await reading(m, { rpm: 1500, powerKw: 6.3, at: new Date() });
    const r = await ask(m);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.risk, 'High');
    assert.deepEqual(r.body.data.inputs, { rpm: 1500, torqueNm: 40.1, toolWearMin: 250 });
    assert.equal(r.body.data.torqueIsDerived, true);
    assert.equal(sensorCalls().length, 1);
    assert.deepEqual(sensorCalls()[0].body, { rpm: 1500, torqueNm: 40.1, toolWearMin: 250 });
    assert.equal(sensorCalls()[0].key, 'test-ml-key');
    assert.equal(await models.MlPrediction.countDocuments({ machine: m._id }), 0);
    assert.equal(await models.Alert.countDocuments({ sourceId: String(m._id) }), 0);
  });

  test('says what is missing instead of guessing', async () => {
    const noReading = await machine();
    const a = await ask(noReading);
    assert.equal(a.status, 422);
    assert.match(a.body.message, /No sensor reading with rpm and power/);
    const stopped = await machine();
    await reading(stopped, { rpm: 0, powerKw: 0.2 });
    assert.equal((await ask(stopped)).status, 422, 'a stopped machine has no torque to derive');
    const noWear = await machine({ toolWearMin: undefined });
    await reading(noWear);
    assert.match((await ask(noWear)).body.message, /no tool wear/);
    const old = await machine();
    await reading(old, { at: new Date(Date.now() - 30 * HOUR) });
    assert.equal((await ask(old)).status, 422, 'a day-old reading is too old');
    assert.equal(sensorCalls().length, 0, 'the Python service is never called without real inputs');
  });

  test('is staff-only, 404s for an unknown machine, and fails softly when the service is down', async () => {
    const m = await machine();
    await reading(m);
    assert.equal((await ask(m, tokens.worker)).status, 403);
    assert.equal((await call('POST', `/api/machines/${new mongoose.Types.ObjectId()}/sensor-risk`)).status, 404);
    fake.mode = 'down';
    const r = await ask(m);
    assert.equal(r.status, 503);
    assert.ok(!JSON.stringify(r.body).includes('127.0.0.1'), 'no internal address in the reply');
  });

  test('the status endpoint now reports the sensor model too, and survives it being absent', async () => {
    const r = await call('GET', '/api/ml/status');
    assert.equal(r.body.data.sensor.modelVersion, 'sensor-fake');
    assert.equal(r.body.data.sensor.dataSource, 'AI4I 2020 (UCI), public and synthetic');
  });
});
