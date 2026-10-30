import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { freshDb } from './helpers/db.js';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_leave';
process.env.SCHEDULER_ENABLED = 'false';

const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { createApp } = await import('../src/app.js');
const models = await import('../src/models/index.js');
const { dayKey } = await import('../src/utils/time.js');
const { escalateStale } = await import('../src/modules/alerts/alert.service.js');

const DAY = 86_400_000;
let server;
let base;
const tokens = {};
const ids = {};
const key = (n) => dayKey(new Date(Date.now() + n * DAY));

async function call(method, path, { token = tokens.manager, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const ask = (from, to, extra = {}) => call('POST', '/api/leave', { token: tokens.worker, body: { from, to, reason: 'Family event', ...extra } });

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await freshDb(mongoose);
  const passwordHash = await bcrypt.hash('Password@123', 4);
  const users = await models.User.create([
    { name: 'Manager', email: 'm@t.io', passwordHash, role: 'manager' },
    { name: 'Admin', email: 'a@t.io', passwordHash, role: 'admin' },
    { name: 'Worker One', email: 'w1@t.io', passwordHash, role: 'worker' },
    { name: 'Worker Two', email: 'w2@t.io', passwordHash, role: 'worker' },
  ]);
  const workers = await models.Worker.create([
    { user: users[2]._id, employeeId: 'E-1' },
    { user: users[3]._id, employeeId: 'E-2' },
  ]);
  Object.assign(ids, { manager: String(users[0]._id), admin: String(users[1]._id), worker: String(users[2]._id), w1: String(workers[0]._id) });
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of [['manager', 'm@t.io'], ['admin', 'a@t.io'], ['worker', 'w1@t.io'], ['worker2', 'w2@t.io']]) {
    tokens[k] = (await call('POST', '/api/auth/login', { token: null, body: { email, password: 'Password@123' } })).body.data.accessToken;
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.closeAllConnections?.();
  server.close();
});

describe('Leave requests', () => {
  test('a worker asks for leave, managers are notified, and the request starts pending', async () => {
    const r = await ask(key(10), key(12));
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.data.status, r.body.data.days], ['pending', 3]);
    const n = await models.Notification.find({ user: ids.manager, kind: 'leave' }).lean();
    assert.equal(n.length, 1);
    assert.match(n[0].title, /Worker One/);
    assert.equal(await models.Notification.countDocuments({ user: ids.worker }), 0, 'the worker is not notified of their own request');
  });

  test('rejects bad ranges, past dates, over-long leave and overlaps', async () => {
    assert.equal((await ask(key(20), key(18))).status, 400, 'ends before it starts');
    assert.equal((await ask(key(-3), key(-2))).status, 400, 'in the past');
    assert.equal((await ask(key(20), key(60))).status, 400, 'over 30 days');
    assert.equal((await ask('2026-13-45', key(20))).status, 400, 'not a date');
    assert.equal((await ask(key(11), key(14))).status, 409, 'overlaps the pending request from the first test');
    assert.equal((await ask(key(13), key(14))).status, 201, 'adjacent is fine');
  });

  test('workers see only their own requests; staff see all', async () => {
    await call('POST', '/api/leave', { token: tokens.worker2, body: { from: key(30), to: key(31) } });
    const mine = await call('GET', '/api/leave', { token: tokens.worker });
    assert.ok(mine.body.data.items.every((x) => x.worker.employeeId === 'E-1'));
    const all = await call('GET', '/api/leave');
    assert.ok(new Set(all.body.data.items.map((x) => x.worker.employeeId)).size === 2);
  });

  test('only staff review; the worker is told the decision; a decided request cannot be decided again', async () => {
    const r = await ask(key(40), key(41));
    const id = r.body.data._id;
    assert.equal((await call('PATCH', `/api/leave/${id}/review`, { token: tokens.worker, body: { status: 'approved' } })).status, 403);
    const done = await call('PATCH', `/api/leave/${id}/review`, { body: { status: 'approved', note: 'Enjoy' } });
    assert.equal(done.status, 200);
    assert.equal(done.body.data.reviewedBy.name, 'Manager');
    const told = await models.Notification.findOne({ user: ids.worker, title: /approved/ }).lean();
    assert.ok(told);
    assert.match(told.body, /Enjoy/);
    assert.equal((await call('PATCH', `/api/leave/${id}/review`, { body: { status: 'rejected' } })).status, 409);
    assert.equal((await call('PATCH', `/api/leave/${id}/cancel`, { token: tokens.worker })).status, 409, 'approved leave cannot be withdrawn here');
  });

  test('a worker can withdraw their own pending request but not someone else\'s', async () => {
    const r = await ask(key(50), key(51));
    assert.equal((await call('PATCH', `/api/leave/${r.body.data._id}/cancel`, { token: tokens.worker2 })).status, 403);
    assert.equal((await call('PATCH', `/api/leave/${r.body.data._id}/cancel`, { token: tokens.worker })).body.data.status, 'cancelled');
  });

  test('approved leave shows as leave, not absence, in the attendance report', async () => {
    await models.LeaveRequest.deleteMany({});
    await models.Attendance.deleteMany({});
    const w2 = await models.Worker.findOne({ employeeId: 'E-2' });
    const yesterday = key(-1);
    await models.Attendance.create({ worker: w2._id, date: yesterday, status: 'present' });
    await models.LeaveRequest.create({ worker: ids.w1, from: yesterday, to: yesterday, status: 'approved' });
    const r = await call('GET', '/api/analytics/worker-attendance?days=3');
    const one = r.body.data.rows.find((x) => x.employeeId === 'E-1');
    assert.equal(one.days[yesterday], 'leave');
    const s = r.body.data.series.find((x) => x.date === yesterday);
    assert.equal(s.absent, 0, 'on leave is not counted absent');
  });
});

describe('Notifications', () => {
  test('are private to each user and can be marked read one at a time or all at once', async () => {
    await models.Notification.deleteMany({});
    const { notify } = await import('../src/modules/notifications/notification.service.js');
    const [mine] = await notify([ids.manager], { title: 'First' });
    await notify([ids.manager], { title: 'Second' });
    await notify([ids.admin], { title: 'Not yours' });

    const list = await call('GET', '/api/notifications');
    assert.deepEqual(list.body.data.items.map((x) => x.title), ['Second', 'First']);
    assert.equal(list.body.data.unread, 2);
    assert.equal((await call('PATCH', `/api/notifications/${mine._id}/read`, { token: tokens.admin })).status, 404, 'someone else\'s');
    assert.equal((await call('PATCH', `/api/notifications/${mine._id}/read`)).status, 200);
    assert.equal((await call('GET', '/api/notifications')).body.data.unread, 1);
    assert.equal((await call('PATCH', '/api/notifications/read-all')).body.data.updated, 1);
    assert.equal((await call('GET', '/api/notifications')).body.data.unread, 0);
    assert.equal((await call('GET', '/api/notifications', { token: tokens.admin })).body.data.unread, 1, 'the admin still has theirs');
  });

  test('a raised alert reaches every manager and admin, info alerts do not', async () => {
    await models.Notification.deleteMany({});
    const alerts = await import('../src/modules/alerts/alert.service.js');
    await alerts.create({ type: 't1', severity: 'critical', source: 'test', sourceId: 'x1', message: 'Press C failed' });
    await alerts.create({ type: 't2', severity: 'info', source: 'test', sourceId: 'x2', message: 'FYI' });
    const got = await models.Notification.find({ kind: 'alert' }).lean();
    assert.deepEqual(got.map((n) => String(n.user)).sort(), [ids.admin, ids.manager].sort());
    assert.ok(got.every((n) => n.tone === 'critical' && /Press C failed/.test(n.body)));
  });
});

describe('Alert escalation', () => {
  test('a critical alert left unacknowledged is escalated once, to admins only', async () => {
    await models.Notification.deleteMany({});
    await models.Alert.deleteMany({});
    const old = await models.Alert.create({ type: 'e1', severity: 'critical', source: 't', message: 'Old and ignored', createdAt: new Date(Date.now() - 45 * 60_000) });
    await models.Alert.collection.updateOne({ _id: old._id }, { $set: { createdAt: new Date(Date.now() - 45 * 60_000) } });
    await models.Alert.create({ type: 'e2', severity: 'critical', source: 't', message: 'Fresh' });
    const acked = await models.Alert.create({ type: 'e3', severity: 'critical', source: 't', message: 'Acknowledged', status: 'acknowledged' });
    await models.Alert.collection.updateOne({ _id: acked._id }, { $set: { createdAt: new Date(Date.now() - 90 * 60_000) } });

    assert.deepEqual(await escalateStale(), { escalated: 1 });
    assert.deepEqual(await escalateStale(), { escalated: 0 }, 'a second run does nothing');
    const n = await models.Notification.find().lean();
    assert.equal(n.length, 1);
    assert.equal(String(n[0].user), ids.admin);
    assert.match(n[0].title, /Escalated/);
    assert.match(n[0].body, /Old and ignored/);
  });
});
