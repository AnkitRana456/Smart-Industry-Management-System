import assert from 'node:assert/strict';
import http from 'node:http';
import { freshDb } from './helpers/db.js';
import { after, before, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_ai_limits';
process.env.AI_RATE_LIMIT_PER_MIN = '3';
process.env.GEMINI_API_KEY = '';
process.env.GEMINI_MODEL = '';

const { default: bcrypt } = await import('bcryptjs');
const { default: mongoose } = await import('mongoose');
const { createApp } = await import('../src/app.js');
const { normalizeProviderError } = await import('../src/modules/ai/gemini.client.js');
const { ApiError } = await import('../src/utils/ApiError.js');
const { User } = await import('../src/models/index.js');

let server;
let base;
let token;

before(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await freshDb(mongoose);
  await User.create({ name: 'Manager', email: 'm@t.io', passwordHash: await bcrypt.hash('Password@123', 4), role: 'manager' });
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'm@t.io', password: 'Password@123' }) });
  token = (await res.json()).data.accessToken;
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.closeAllConnections?.();
  server.close();
});

describe('AI rate limit', () => {
  test('requests beyond the limit get 429 in the standard envelope', async () => {
    const hit = () => fetch(`${base}/api/ai/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: 'hi' }) });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await hit()).status);
    assert.deepEqual(statuses, [400, 400, 400, 429, 429]);
    const limited = await (await hit()).json();
    assert.deepEqual(Object.keys(limited).sort(), ['data', 'errors', 'message', 'success']);
    assert.equal(limited.success, false);
  });
});

describe('Provider error mapping', () => {
  const map = (e) => normalizeProviderError(e);
  test('maps provider statuses to the API contract without leaking provider text', () => {
    assert.equal(map(Object.assign(new Error('quota exceeded for key AIzaSyFAKE'), { status: 429 })).status, 429);
    for (const s of [400, 401, 403, 404]) assert.equal(map(Object.assign(new Error('bad key AIzaSyFAKE'), { status: s })).status, 503);
    assert.equal(map(Object.assign(new Error('boom'), { status: 500 })).status, 503);
    assert.equal(map(Object.assign(new Error('aborted'), { name: 'AbortError' })).status, 503);
    assert.equal(map(new Error('ECONNRESET')).status, 503);
    const mapped = map(Object.assign(new Error('bad key AIzaSyFAKE'), { status: 401 }));
    assert.ok(!mapped.message.includes('AIzaSyFAKE'));
    assert.ok(mapped instanceof ApiError);
  });
});
