// Builds docs/sims.postman_collection.json from the OpenAPI spec. Run: npm run docs:postman
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildSpec } from '../src/docs/openapi.js';

const spec = buildSpec();
const toUrl = (path) => `{{baseUrl}}/api${path.replace(/\{(\w+)\}/g, '{{$1}}')}`;

const testScript = (extra = []) => ({
  listen: 'test',
  script: {
    type: 'text/javascript',
    exec: [
      "pm.test('Response uses the standard envelope', () => {",
      "  const b = pm.response.json();",
      "  pm.expect(b).to.have.all.keys('success', 'data', 'message', 'errors');",
      '});',
      ...extra,
    ],
  },
});

const items = {};
for (const [path, ops] of Object.entries(spec.paths)) {
  if (path.startsWith('/../')) continue;
  for (const [method, op] of Object.entries(ops)) {
    const tag = op.tags[0];
    const query = (op.parameters ?? []).filter((p) => p.in === 'query');
    const body = op.requestBody?.content['application/json'].schema.example;
    (items[tag] ??= []).push({
      name: `${method.toUpperCase()} ${path} - ${op.summary}`.slice(0, 110),
      request: {
        method: method.toUpperCase(),
        header: body ? [{ key: 'Content-Type', value: 'application/json' }] : [],
        ...(body && { body: { mode: 'raw', raw: JSON.stringify(body, null, 2) } }),
        url: {
          raw: toUrl(path),
          host: ['{{baseUrl}}'],
          path: ['api', ...path.split('/').filter(Boolean).map((s) => s.replace(/\{(\w+)\}/g, '{{$1}}'))],
          query: query.map((q) => ({ key: q.name, value: '', disabled: true, description: q.description })),
        },
        description: op.description,
        ...(op.security ? {} : { auth: { type: 'noauth' } }),
      },
      event: [testScript()],
    });
  }
}

const loginAs = (name, email, variable) => ({
  name,
  request: {
    method: 'POST', header: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: JSON.stringify({ email, password: '{{password}}' }) },
    url: { raw: '{{baseUrl}}/api/auth/login', host: ['{{baseUrl}}'], path: ['api', 'auth', 'login'] }, auth: { type: 'noauth' },
  },
  event: [testScript([
    "pm.test('Signed in', () => pm.response.to.have.status(200));",
    `pm.collectionVariables.set('${variable}', pm.response.json().data.accessToken);`,
  ])],
});

const mustBe403 = (name, method, path, body) => ({
  name,
  request: {
    method, header: [{ key: 'Content-Type', value: 'application/json' }],
    ...(body && { body: { mode: 'raw', raw: JSON.stringify(body) } }),
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{workerToken}}', type: 'string' }] },
    url: { raw: `{{baseUrl}}/api${path}`, host: ['{{baseUrl}}'], path: ['api', ...path.split('/').filter(Boolean)] },
  },
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: ["pm.test('A worker token is refused (403)', () => pm.response.to.have.status(403));"] } }],
});

const collection = {
  info: {
    name: 'SIMS API',
    description: 'Generated from the OpenAPI spec. Run "0. Sign in" first, then any request. "Role checks" confirms a worker token gets 403 on staff and admin routes.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:5000' },
    { key: 'password', value: 'Password@123' },
    { key: 'token', value: '' }, { key: 'workerToken', value: '' },
    { key: 'id', value: '' }, { key: 'machineId', value: '' },
  ],
  item: [
    { name: '0. Sign in', item: [loginAs('Sign in as manager', 'manager@sims.local', 'token'), loginAs('Sign in as admin', 'admin@sims.local', 'token'), loginAs('Sign in as worker (for role checks)', 'worker@sims.local', 'workerToken')] },
    {
      name: 'Role checks',
      item: [
        mustBe403('Worker cannot create machines', 'POST', '/machines', { name: 'X', code: 'X-1' }),
        mustBe403('Worker cannot read analytics', 'GET', '/analytics/overview'),
        mustBe403('Worker cannot use the AI analyst', 'POST', '/ai/ask', { question: 'How many machines?' }),
        mustBe403('Worker cannot list workers', 'GET', '/workers'),
        mustBe403('Worker cannot use the simulator', 'POST', '/simulate/machine-events', { events: 1 }),
        mustBe403('Worker cannot read the audit log', 'GET', '/audit-logs'),
      ],
    },
    ...Object.entries(items).map(([name, item]) => ({ name, item })),
  ],
};

mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../docs/sims.postman_collection.json', import.meta.url), JSON.stringify(collection, null, 2));
writeFileSync(new URL('../docs/openapi.json', import.meta.url), JSON.stringify(spec, null, 2));
console.log(`Wrote docs/sims.postman_collection.json and docs/openapi.json (${Object.values(items).flat().length} requests)`);
