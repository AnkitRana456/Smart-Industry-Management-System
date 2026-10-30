import assert from 'node:assert/strict';
import http from 'node:http';
import { freshDb } from './helpers/db.js';
import { after, before, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_users';

const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { createApp } = await import('../src/app.js');
const { io: connect } = await import('socket.io-client');
const { closeSockets, initSockets } = await import('../src/sockets/index.js');
const models = await import('../src/models/index.js');

let server;
let base;
const tokens = {};
const ids = {};

async function call(method, path, { token = tokens.admin, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const login = async (email, password = 'Password@123') => call('POST', '/api/auth/login', { token: null, body: { email, password } });
const settle = () => new Promise((r) => setTimeout(r, 150));

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await freshDb(mongoose);
  const passwordHash = await bcrypt.hash('Password@123', 4);
  const [admin, manager, worker] = await models.User.create([
    { name: 'Admin', email: 'a@t.io', passwordHash, role: 'admin' },
    { name: 'Manager', email: 'm@t.io', passwordHash, role: 'manager' },
    { name: 'Worker', email: 'w@t.io', passwordHash, role: 'worker' },
  ]);
  Object.assign(ids, { admin: String(admin._id), manager: String(manager._id), worker: String(worker._id) });
  server = http.createServer(createApp());
  initSockets(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, email] of [['admin', 'a@t.io'], ['manager', 'm@t.io'], ['worker', 'w@t.io']]) tokens[k] = (await login(email)).body.data.accessToken;
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await closeSockets();
});

describe('User administration', () => {
  test('admins and managers can list users, workers cannot; password hashes are never returned', async () => {
    const r = await call('GET', '/api/users', { token: tokens.manager });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.items.length, 3);
    assert.ok(!JSON.stringify(r.body).includes('passwordHash'));
    assert.equal((await call('GET', '/api/users', { token: tokens.worker })).status, 403);
    assert.equal((await call('GET', '/api/users?search=manag')).body.data.items.length, 1);
  });

  test('only admins can change users; managers get 403', async () => {
    assert.equal((await call('PATCH', `/api/users/${ids.worker}`, { token: tokens.manager, body: { role: 'manager' } })).status, 403);
    const r = await call('PATCH', `/api/users/${ids.worker}`, { body: { role: 'manager', name: 'Promoted Worker' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.role, 'manager');
    await call('PATCH', `/api/users/${ids.worker}`, { body: { role: 'worker' } });
  });

  test('admins cannot lock themselves out or remove the last admin', async () => {
    assert.equal((await call('PATCH', `/api/users/${ids.admin}`, { body: { role: 'manager' } })).status, 409);
    assert.equal((await call('PATCH', `/api/users/${ids.admin}`, { body: { isActive: false } })).status, 409);
    const second = await models.User.create({ name: 'Admin Two', email: 'a2@t.io', passwordHash: 'x', role: 'admin' });
    assert.equal((await call('PATCH', `/api/users/${second._id}`, { body: { isActive: false } })).status, 200);
    assert.equal((await call('PATCH', `/api/users/${second._id}`, { body: { role: 'worker' } })).status, 200);
  });

  test('deactivating a user ends their session; resetting a password revokes refresh tokens', async () => {
    const created = await call('POST', '/api/auth/register', { body: { name: 'Temp User', email: 'temp@t.io', password: 'Password@123', role: 'worker' } });
    const id = created.body.data.id;
    assert.equal((await login('temp@t.io')).status, 200);
    await call('PATCH', `/api/users/${id}`, { body: { isActive: false } });
    assert.equal((await login('temp@t.io')).status, 401);
    await call('PATCH', `/api/users/${id}`, { body: { isActive: true } });
    assert.equal((await call('POST', `/api/users/${id}/reset-password`, { body: { password: 'short' } })).status, 400);
    assert.equal((await call('POST', `/api/users/${id}/reset-password`, { body: { password: 'BrandNew@456' } })).status, 200);
    assert.equal((await login('temp@t.io')).status, 401, 'old password no longer works');
    assert.equal((await login('temp@t.io', 'BrandNew@456')).status, 200);
  });
});

describe('Audit log', () => {
  test('records who changed what, but never values such as passwords', async () => {
    await call('POST', '/api/auth/register', { body: { name: 'Audited', email: 'audited@t.io', password: 'SuperSecret@999', role: 'worker' } });
    await call('POST', '/api/machines', { token: tokens.manager, body: { name: 'Press', code: 'AU-1' } });
    await settle();
    const r = await call('GET', '/api/audit-logs?limit=50');
    assert.equal(r.status, 200);
    const actions = r.body.data.items.map((a) => a.action);
    assert.ok(actions.includes('POST /api/auth/register'));
    assert.ok(actions.includes('POST /api/machines'));
    const machineEntry = r.body.data.items.find((a) => a.action === 'POST /api/machines');
    assert.equal(machineEntry.user.name, 'Manager');
    assert.deepEqual(machineEntry.diff.fields.sort(), ['code', 'name']);
    assert.ok(!JSON.stringify(r.body).includes('SuperSecret'));
  });

  test('failed requests, reads and logins are not recorded', async () => {
    const before = await models.AuditLog.countDocuments();
    await call('GET', '/api/machines');
    await call('POST', '/api/machines', { token: tokens.worker, body: { name: 'Nope', code: 'NO-1' } });
    await login('a@t.io');
    await settle();
    assert.equal(await models.AuditLog.countDocuments(), before);
  });

  test('is admin only', async () => {
    assert.equal((await call('GET', '/api/audit-logs', { token: tokens.manager })).status, 403);
  });
});

describe('Revoking access takes effect immediately', () => {
  const makeUser = async (role) => {
    const email = `${role}-${Math.random().toString(36).slice(2, 8)}@t.io`;
    const created = await call('POST', '/api/auth/register', { body: { name: `Temp ${role}`, email, password: 'Password@123', role } });
    const token = (await login(email)).body.data.accessToken;
    return { id: created.body.data.id, email, token };
  };

  test('the access token of a deactivated user stops working at once', async () => {
    const u = await makeUser('manager');
    assert.equal((await call('GET', '/api/machines', { token: u.token })).status, 200);
    await call('PATCH', `/api/users/${u.id}`, { body: { isActive: false } });
    const r = await call('GET', '/api/machines', { token: u.token });
    assert.equal(r.status, 401);
    assert.match(r.body.message, /deactivated|no longer exists/i);
  });

  test('a demotion applies to the token the user already holds', async () => {
    const u = await makeUser('manager');
    assert.equal((await call('GET', '/api/analytics/overview', { token: u.token })).status, 200);
    await call('PATCH', `/api/users/${u.id}`, { body: { role: 'worker' } });
    assert.equal((await call('GET', '/api/analytics/overview', { token: u.token })).status, 403);
  });

  test('a promotion also applies at once', async () => {
    const u = await makeUser('worker');
    assert.equal((await call('GET', '/api/users', { token: u.token })).status, 403);
    await call('PATCH', `/api/users/${u.id}`, { body: { role: 'manager' } });
    assert.equal((await call('GET', '/api/users', { token: u.token })).status, 200);
  });

  test('a user who no longer exists is refused', async () => {
    const u = await makeUser('worker');
    await models.User.deleteOne({ _id: u.id });
    assert.equal((await call('GET', '/api/machines', { token: u.token })).status, 401);
  });

  test('a reactivated user can sign in again and use the new session', async () => {
    const u = await makeUser('worker');
    await call('PATCH', `/api/users/${u.id}`, { body: { isActive: false } });
    await call('PATCH', `/api/users/${u.id}`, { body: { isActive: true } });
    const fresh = (await login(u.email)).body.data.accessToken;
    assert.equal((await call('GET', '/api/machines', { token: fresh })).status, 200);
  });

  test('a live socket is disconnected when the account is deactivated or its role changes', async () => {
    const u = await makeUser('manager');
    const s1 = connect(base, { auth: { token: u.token }, reconnection: false });
    await new Promise((r) => s1.on('connect', r));
    const closed1 = new Promise((r) => s1.on('disconnect', r));
    await call('PATCH', `/api/users/${u.id}`, { body: { isActive: false } });
    await Promise.race([closed1, new Promise((_, rej) => setTimeout(() => rej(new Error('socket stayed connected')), 1500))]);
    assert.equal(s1.connected, false);

    const w = await makeUser('manager');
    const s2 = connect(base, { auth: { token: w.token }, reconnection: false });
    await new Promise((r) => s2.on('connect', r));
    const closed2 = new Promise((r) => s2.on('disconnect', r));
    await call('PATCH', `/api/users/${w.id}`, { body: { role: 'worker' } });
    await Promise.race([closed2, new Promise((_, rej) => setTimeout(() => rej(new Error('socket stayed connected after demotion')), 1500))]);
    s1.close();
    s2.close();
  });

  test('a password reset ends sessions started before it, but not ones started after', async () => {
    const u = await makeUser('manager');
    assert.equal((await call('GET', '/api/machines', { token: u.token })).status, 200);
    await new Promise((r) => setTimeout(r, 1100)); // token timestamps have one-second resolution
    await call('POST', `/api/users/${u.id}/reset-password`, { body: { password: 'BrandNew@456' } });

    const old = await call('GET', '/api/machines', { token: u.token });
    assert.equal(old.status, 401);
    assert.match(old.body.message, /password was reset/);

    const fresh = (await login(u.email, 'BrandNew@456')).body.data.accessToken;
    assert.equal((await call('GET', '/api/machines', { token: fresh })).status, 200);
  });

  test('a deactivated user cannot open a new socket with a token that has not expired', async () => {
    const u = await makeUser('worker');
    await call('PATCH', `/api/users/${u.id}`, { body: { isActive: false } });
    const s = connect(base, { auth: { token: u.token }, reconnection: false });
    const err = await new Promise((r) => s.on('connect_error', r));
    assert.match(err.message, /Unauthorized/);
    s.close();
  });

  test('a password reset ends live sockets too', async () => {
    const u = await makeUser('manager');
    const s = connect(base, { auth: { token: u.token }, reconnection: false });
    await new Promise((r) => s.on('connect', r));
    const closed = new Promise((r) => s.on('disconnect', r));
    await call('POST', `/api/users/${u.id}/reset-password`, { body: { password: 'BrandNew@456' } });
    await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error('socket stayed connected')), 1500))]);
    s.close();
  });
});
