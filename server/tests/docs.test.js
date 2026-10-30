import assert from 'node:assert/strict';
import http from 'node:http';
import { freshDb } from './helpers/db.js';
import { after, before, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/sims_test_docs';

const { default: mongoose } = await import('mongoose');
const { createApp } = await import('../src/app.js');
const { buildSpec, routes } = await import('../src/docs/openapi.js');

let server;
let base;

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

describe('API documentation', () => {
  test('every documented route exists (anything but 404 when called without credentials)', async () => {
    const id = '64b64c1f1c9d440000000000';
    const missing = [];
    for (const { method, path } of routes) {
      const url = base + path.replace(/\{\w+\}/g, id);
      const res = await fetch(url, { method: method.toUpperCase(), headers: { 'Content-Type': 'application/json' }, body: method === 'get' || method === 'delete' ? undefined : '{}' });
      if (res.status === 404) missing.push(`${method.toUpperCase()} ${path}`);
    }
    assert.deepEqual(missing, []);
  });

  test('the spec is served as JSON and as Swagger UI', async () => {
    const json = await (await fetch(`${base}/api/openapi.json`)).json();
    assert.equal(json.openapi, '3.0.3');
    assert.ok(Object.keys(json.paths).length > 50);
    const ui = await fetch(`${base}/api/docs/`);
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /swagger-ui/i);
  });

  test('protected operations declare bearer auth; login and health do not', () => {
    const { paths } = buildSpec();
    assert.ok(paths['/machines'].get.security);
    assert.equal(paths['/auth/login'].post.security, undefined);
    assert.equal(paths['/../health'].get.security, undefined);
  });

  test('health reports the database state', async () => {
    const r = await fetch(`${base}/health`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).data.database, 'connected');
  });

  test('other pages keep the strict content security policy', async () => {
    const r = await fetch(`${base}/health`);
    assert.ok(r.headers.get('content-security-policy'));
  });
});
