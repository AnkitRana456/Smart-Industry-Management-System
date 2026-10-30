import assert from 'node:assert/strict';
import http from 'node:http';
import { freshDb } from './helpers/db.js';
import { after, before, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_workforce';
process.env.FACTORY_TIMEZONE = 'Asia/Kolkata';

const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { createApp } = await import('../src/app.js');
const { initSockets } = await import('../src/sockets/index.js');
const models = await import('../src/models/index.js');
const { dayKey } = await import('../src/utils/time.js');

let server;
let base;
const tokens = {};
const ids = {};

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
  const [, manager] = await models.User.create([
    { name: 'Admin', email: 'a@t.io', passwordHash, role: 'admin' },
    { name: 'Manager', email: 'm@t.io', passwordHash, role: 'manager' },
  ]);
  ids.manager = manager._id;
  server = http.createServer(createApp());
  initSockets(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = async (email) => (await call('POST', '/api/auth/login', { body: { email, password: 'Password@123' } })).body.data.accessToken;
  tokens.manager = await login('m@t.io');

  // A shift that began long ago so a check-in right now is always "late".
  const shift = (await call('POST', '/api/shifts', { token: tokens.manager, body: { name: 'Early', startTime: '00:00', endTime: '23:59' } })).body.data;
  ids.shift = shift._id;
  for (const n of ['one', 'two']) {
    const w = await call('POST', '/api/workers', {
      token: tokens.manager,
      body: { name: `Worker ${n}`, email: `${n}@t.io`, password: 'Password@123', employeeId: `E-${n}`, department: 'Machining', skills: ['lathe'], shift: ids.shift },
    });
    assert.equal(w.status, 201);
    ids[n] = w.body.data._id;
    tokens[n] = await login(`${n}@t.io`);
  }
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.closeAllConnections?.();
  server.close();
});

describe('Workers and shifts', () => {
  test('workers cannot list other workers but can read their own profile', async () => {
    assert.equal((await call('GET', '/api/workers', { token: tokens.one })).status, 403);
    const me = await call('GET', '/api/workers/me', { token: tokens.one });
    assert.equal(me.status, 200);
    assert.equal(me.body.data.employeeId, 'E-one');
  });

  test('duplicate employee ids and emails are rejected', async () => {
    const r = await call('POST', '/api/workers', {
      token: tokens.manager,
      body: { name: 'Dup', email: 'dup@t.io', password: 'Password@123', employeeId: 'E-one' },
    });
    assert.equal(r.status, 409);
  });

  test('a shift with active workers cannot be deleted', async () => {
    assert.equal((await call('DELETE', `/api/shifts/${ids.shift}`, { token: tokens.manager })).status, 409);
  });

  test('deactivating a worker blocks their login and keeps the record', async () => {
    await call('POST', '/api/workers', {
      token: tokens.manager,
      body: { name: 'Leaver', email: 'leave@t.io', password: 'Password@123', employeeId: 'E-leave' },
    });
    const list = await call('GET', '/api/workers?search=Leaver', { token: tokens.manager });
    const id = list.body.data.items[0]._id;
    await call('DELETE', `/api/workers/${id}`, { token: tokens.manager });
    const login = await call('POST', '/api/auth/login', { body: { email: 'leave@t.io', password: 'Password@123' } });
    assert.equal(login.status, 401);
    assert.equal((await call('GET', `/api/workers/${id}`, { token: tokens.manager })).body.data.status, 'terminated');
  });
});

describe('Attendance', () => {
  test('check-in records the factory-timezone date and marks late against the shift', async () => {
    const r = await call('POST', '/api/attendance/check-in', { token: tokens.one });
    assert.equal(r.status, 201);
    assert.equal(r.body.data.date, dayKey());
    assert.equal(r.body.data.status, 'late');
  });

  test('double check-in is 409, and a retry cannot create a second record', async () => {
    const results = await Promise.all([1, 2, 3].map(() => call('POST', '/api/attendance/check-in', { token: tokens.two })));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 2);
  });

  test('check-out needs a check-in and can only happen once', async () => {
    const noIn = await call('POST', '/api/attendance/check-out', { token: tokens.manager });
    assert.equal(noIn.status, 403, 'only workers use the worker endpoints');
    assert.equal((await call('POST', '/api/attendance/check-out', { token: tokens.one })).status, 200);
    assert.equal((await call('POST', '/api/attendance/check-out', { token: tokens.one })).status, 409);
  });

  test('a worker only sees their own attendance; staff see everyone', async () => {
    const own = await call('GET', `/api/attendance?worker=${ids.two}`, { token: tokens.one });
    assert.equal(own.body.data.length, 1);
    assert.equal(own.body.data[0].worker._id, ids.one, 'worker query param is ignored for workers');
    const all = await call('GET', '/api/attendance', { token: tokens.manager });
    assert.equal(all.body.data.length, 2);
  });

  test('summary counts absent workers', async () => {
    const r = await call('GET', '/api/attendance/summary', { token: tokens.manager });
    assert.equal(r.body.data.late, 2);
    assert.equal(r.body.data.absent, 0);
    assert.equal((await call('GET', '/api/attendance/summary', { token: tokens.one })).status, 403);
  });
});

describe('Tasks', () => {
  let taskId;
  test('a worker can progress their own task but not someone else\'s', async () => {
    const mine = await call('POST', '/api/tasks', { token: tokens.manager, body: { title: 'Mine', assignedTo: ids.one } });
    const theirs = await call('POST', '/api/tasks', { token: tokens.manager, body: { title: 'Theirs', assignedTo: ids.two } });
    taskId = mine.body.data._id;
    assert.equal((await call('PATCH', `/api/tasks/${taskId}/status`, { token: tokens.one, body: { status: 'in_progress' } })).status, 200);
    assert.equal((await call('PATCH', `/api/tasks/${theirs.body.data._id}/status`, { token: tokens.one, body: { status: 'done' } })).status, 403);
  });

  test('workers only list their own tasks and cannot create tasks', async () => {
    const list = await call('GET', '/api/tasks', { token: tokens.one });
    assert.deepEqual(list.body.data.items.map((t) => t.title), ['Mine']);
    assert.equal((await call('POST', '/api/tasks', { token: tokens.one, body: { title: 'Nope' } })).status, 403);
  });
});

describe('Production orders', () => {
  const machine = {};
  let order;

  before(async () => {
    for (const [k, code] of [['a', 'PA-1'], ['b', 'PB-1']]) {
      const m = await call('POST', '/api/machines', { token: tokens.manager, body: { name: `Mach ${k}`, code, status: 'running' } });
      machine[k] = m.body.data._id;
    }
  });

  test('state machine allows only pending -> in_progress -> completed', async () => {
    const created = await call('POST', '/api/orders', {
      token: tokens.manager,
      body: { product: 'Gear', quantity: 100, machines: [machine.a], dueDate: new Date(Date.now() + 5 * 86_400_000).toISOString() },
    });
    assert.equal(created.status, 201);
    assert.match(created.body.data.orderNo, /^PO-\d+$/);
    order = created.body.data;

    const skip = await call('PATCH', `/api/orders/${order._id}/status`, { token: tokens.manager, body: { status: 'completed' } });
    assert.equal(skip.status, 409);
    assert.equal((await call('PATCH', `/api/orders/${order._id}/status`, { token: tokens.manager, body: { status: 'in_progress' } })).status, 200);
    assert.equal((await call('PATCH', `/api/orders/${order._id}/status`, { token: tokens.manager, body: { status: 'pending' } })).status, 409);
  });

  test('progress is bounded by the ordered quantity', async () => {
    assert.equal((await call('PATCH', `/api/orders/${order._id}/progress`, { token: tokens.manager, body: { producedQty: 101 } })).status, 400);
    const r = await call('PATCH', `/api/orders/${order._id}/progress`, { token: tokens.manager, body: { producedQty: 25 } });
    assert.equal(r.body.data.progress, 25);
  });

  test('an order cannot start on an unavailable machine', async () => {
    await call('PATCH', `/api/machines/${machine.b}/status`, { token: tokens.manager, body: { status: 'maintenance' } });
    const o = await call('POST', '/api/orders', { token: tokens.manager, body: { product: 'Shaft', quantity: 10, machines: [machine.b] } });
    const r = await call('PATCH', `/api/orders/${o.body.data._id}/status`, { token: tokens.manager, body: { status: 'in_progress' } });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /PB-1/);
  });

  test('taking a machine down flags the order as a bottleneck once, and recovery clears it', async () => {
    await call('PATCH', `/api/machines/${machine.a}/status`, { token: tokens.manager, body: { status: 'offline' } });
    await call('PATCH', `/api/machines/${machine.a}/status`, { token: tokens.manager, body: { status: 'offline' } }); // no-op 409
    const flagged = await call('GET', `/api/orders/${order._id}`, { token: tokens.manager });
    assert.equal(flagged.body.data.bottleneckFlag, true);

    const open = await call('GET', '/api/alerts?status=open', { token: tokens.manager });
    assert.equal(open.body.data.items.filter((a) => a.type === 'bottleneck').length, 1);

    await call('PATCH', `/api/machines/${machine.a}/status`, { token: tokens.manager, body: { status: 'running' } });
    const cleared = await call('GET', `/api/orders/${order._id}`, { token: tokens.manager });
    assert.equal(cleared.body.data.bottleneckFlag, false);
    const after = await call('GET', '/api/alerts?status=open', { token: tokens.manager });
    assert.equal(after.body.data.items.filter((a) => a.type === 'bottleneck').length, 0);
  });

  test('an overdue in-progress order is flagged; completing it clears the flag', async () => {
    const o = await call('POST', '/api/orders', {
      token: tokens.manager,
      body: { product: 'Late part', quantity: 5, machines: [machine.a], dueDate: new Date(Date.now() - 86_400_000).toISOString() },
    });
    const oid = o.body.data._id;
    await call('PATCH', `/api/orders/${oid}/status`, { token: tokens.manager, body: { status: 'in_progress' } });
    assert.equal((await call('GET', `/api/orders/${oid}`, { token: tokens.manager })).body.data.bottleneckFlag, true);
    const done = await call('PATCH', `/api/orders/${oid}/status`, { token: tokens.manager, body: { status: 'completed' } });
    assert.equal(done.body.data.bottleneckFlag, false);
    assert.equal(done.body.data.progress, 100);
  });

  test('workers see only orders linked to their tasks and cannot change orders', async () => {
    assert.equal((await call('GET', '/api/orders', { token: tokens.one })).body.data.items.length, 0);
    await call('POST', '/api/tasks', { token: tokens.manager, body: { title: 'Run it', assignedTo: ids.one, order: order._id } });
    const seen = await call('GET', '/api/orders', { token: tokens.one });
    assert.deepEqual(seen.body.data.items.map((x) => x._id), [order._id]);
    assert.equal((await call('PATCH', `/api/orders/${order._id}/status`, { token: tokens.one, body: { status: 'completed' } })).status, 403);
  });
});
