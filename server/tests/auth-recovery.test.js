import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { freshDb } from './helpers/db.js';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_recovery';
process.env.SCHEDULER_ENABLED = 'false';
process.env.AUTH_RATE_LIMIT_PER_15MIN = '10000';

const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { createApp } = await import('../src/app.js');
const models = await import('../src/models/index.js');
const { setTransport } = await import('../src/utils/mailer.js');

let server;
let base;
const mails = [];
setTransport(async (m) => { mails.push(m); });

async function post(path, body) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
const login = (email, password) => post('/api/auth/login', { email, password });
const tokenFrom = (mail) => /token=([a-f0-9]{64})/.exec(mail.text)[1];
const makeUser = (email) => models.User.create({ name: 'T', email, passwordHash: bcrypt.hashSync('Password@123', 4), role: 'worker' });

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await freshDb(mongoose);
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.closeAllConnections?.();
  server.close();
});

describe('Account lockout', () => {
  test('five wrong passwords lock the account, even for the right password, until the lock ends', async () => {
    await makeUser('lock@t.io');
    for (let i = 0; i < 4; i++) assert.equal((await login('lock@t.io', 'wrong-password')).status, 401);
    assert.equal((await login('lock@t.io', 'Password@123')).status, 200, 'four misses and then the right password still works');
    for (let i = 0; i < 5; i++) await login('lock@t.io', 'wrong-password');
    const locked = await login('lock@t.io', 'Password@123');
    assert.equal(locked.status, 429);
    assert.match(locked.body.message, /Try again in \d+ minutes?/);

    await models.User.updateOne({ email: 'lock@t.io' }, { lockedUntil: new Date(Date.now() - 1000) });
    assert.equal((await login('lock@t.io', 'Password@123')).status, 200, 'the lock expires');
    const u = await models.User.findOne({ email: 'lock@t.io' }).lean();
    assert.deepEqual([u.failedLogins, u.lockedUntil], [0, undefined]);
  });

  test('misses on one account never lock another, and unknown emails are not tracked', async () => {
    await makeUser('a@t.io');
    await makeUser('b@t.io');
    for (let i = 0; i < 6; i++) await login('a@t.io', 'nope-nope');
    assert.equal((await login('b@t.io', 'Password@123')).status, 200);
    const r = await login('ghost@t.io', 'nope-nope');
    assert.equal(r.status, 401);
    assert.equal(r.body.message, 'Invalid email or password');
  });
});

describe('Password reset', () => {
  test('forgot-password answers the same for real and unknown emails, and only mails real ones', async () => {
    await makeUser('reset@t.io');
    mails.length = 0;
    const real = await post('/api/auth/forgot-password', { email: 'reset@t.io' });
    const ghost = await post('/api/auth/forgot-password', { email: 'nobody@t.io' });
    assert.deepEqual([real.status, ghost.status], [200, 200]);
    assert.equal(real.body.message, ghost.body.message);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'reset@t.io');
    const u = await models.User.findOne({ email: 'reset@t.io' }).select('+resetTokenHash').lean();
    assert.ok(u.resetTokenHash);
    assert.ok(!mails[0].text.includes(u.resetTokenHash), 'only the hash is stored, never the token itself');
  });

  test('the link sets a new password once, ends old sessions and clears a lockout', async () => {
    await makeUser('flow@t.io');
    const before = await login('flow@t.io', 'Password@123');
    await new Promise((r) => setTimeout(r, 1100)); // token times are whole seconds, so the reset must land in a later second
    for (let i = 0; i < 5; i++) await login('flow@t.io', 'wrong-pass');
    assert.equal((await login('flow@t.io', 'Password@123')).status, 429);

    mails.length = 0;
    await post('/api/auth/forgot-password', { email: 'flow@t.io' });
    const token = tokenFrom(mails[0]);
    assert.equal((await post('/api/auth/reset-password', { token, password: 'short' })).status, 400, 'weak password refused');
    const r = await post('/api/auth/reset-password', { token, password: 'BrandNew@456' });
    assert.equal(r.status, 200);
    assert.equal((await login('flow@t.io', 'BrandNew@456')).status, 200, 'the new password works and the lockout is gone');
    assert.equal((await login('flow@t.io', 'Password@123')).status, 401, 'the old one does not');
    assert.equal((await post('/api/auth/reset-password', { token, password: 'Another@789' })).status, 400, 'the link works once');

    const me = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${before.body.data.accessToken}` } });
    assert.equal(me.status, 401, 'a session from before the reset is ended');
  });

  test('an expired or made-up token is refused', async () => {
    await makeUser('late@t.io');
    mails.length = 0;
    await post('/api/auth/forgot-password', { email: 'late@t.io' });
    const token = tokenFrom(mails[0]);
    await models.User.updateOne({ email: 'late@t.io' }, { resetTokenExpires: new Date(Date.now() - 1000) });
    assert.equal((await post('/api/auth/reset-password', { token, password: 'BrandNew@456' })).status, 400);
    assert.equal((await post('/api/auth/reset-password', { token: 'f'.repeat(64), password: 'BrandNew@456' })).status, 400);
    assert.equal((await post('/api/auth/reset-password', { token: 'not-hex', password: 'BrandNew@456' })).status, 400);
  });

  test('a deactivated account gets no email', async () => {
    const u = await makeUser('off@t.io');
    await models.User.updateOne({ _id: u._id }, { isActive: false });
    mails.length = 0;
    assert.equal((await post('/api/auth/forgot-password', { email: 'off@t.io' })).status, 200);
    assert.equal(mails.length, 0);
  });
});
