import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { isLocalMongo, mongoHosts, seedRefusal } from '../src/utils/seedGuard.js';

// Each case runs config in a fresh process so environment variables can't leak between cases.
function check(env) {
  const code = "import('./src/config/env.js').then((m) => { m.assertProductionConfig(); console.log('OK'); }).catch((e) => { console.log(e.message); process.exit(3); })";
  const r = spawnSync(process.execPath, ['-e', code], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DOTENV_CONFIG_PATH: 'no-such.env', ...env },
  });
  return { ok: r.status === 0, out: r.stdout };
}

const strong = 'a'.repeat(40);
const good = { NODE_ENV: 'production', JWT_SECRET: strong, JWT_REFRESH_SECRET: 'b'.repeat(40), MONGO_URI: 'mongodb://x/y', CLIENT_URL: 'https://app.example.com' };

describe('Production configuration', () => {
  test('a complete configuration starts', () => {
    assert.equal(check(good).ok, true);
  });
  test('development is never blocked', () => {
    assert.equal(check({ NODE_ENV: 'development' }).ok, true);
  });
  test('default, short, placeholder and duplicated secrets are refused', () => {
    assert.match(check({ ...good, JWT_SECRET: undefined }).out, /JWT_SECRET/);
    assert.match(check({ ...good, JWT_SECRET: 'short' }).out, /JWT_SECRET/);
    assert.match(check({ ...good, JWT_REFRESH_SECRET: 'change-me-refresh-secret-change-me-please' }).out, /JWT_REFRESH_SECRET/);
    assert.match(check({ ...good, JWT_REFRESH_SECRET: strong }).out, /must differ/);
  });
  test('a missing database or client origin is refused', () => {
    assert.match(check({ ...good, MONGO_URI: undefined }).out, /MONGO_URI/);
    assert.match(check({ ...good, CLIENT_URL: undefined }).out, /CLIENT_URL/);
  });
  test('several client origins can be listed', () => {
    const r = spawnSync(process.execPath, ['-e', "import('./src/config/env.js').then((m) => console.log(JSON.stringify(m.env.clientOrigins)))"], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DOTENV_CONFIG_PATH: 'no-such.env', CLIENT_URL: 'https://a.com/, https://b.com' },
    });
    assert.deepEqual(JSON.parse(r.stdout), ['https://a.com', 'https://b.com']);
  });
});

describe('Seed safety', () => {
  test('local databases are recognised, with or without credentials and ports', () => {
    for (const uri of ['mongodb://127.0.0.1:27017/sims', 'mongodb://localhost/sims', 'mongodb://user:pw@localhost:27017/sims?authSource=admin', 'mongodb://[::1]/sims']) {
      assert.equal(isLocalMongo(uri), true, uri);
    }
  });

  test('anything else is treated as remote, including a local host mixed into a replica set', () => {
    for (const uri of ['mongodb+srv://u:pw@cluster0.abc.mongodb.net/sims', 'mongodb://db.example.com/sims', 'mongodb://localhost,db.example.com/sims', '', undefined, 'not a uri']) {
      assert.equal(isLocalMongo(uri), false, String(uri));
    }
  });

  test('only host names are ever extracted, never credentials', () => {
    assert.deepEqual(mongoHosts('mongodb+srv://admin:s3cret@cluster0.abc.mongodb.net/db'), ['cluster0.abc.mongodb.net']);
  });

  test('refuses remote and production databases unless confirmed', () => {
    assert.equal(seedRefusal({ uri: 'mongodb://127.0.0.1/sims', nodeEnv: 'development' }), null);
    assert.match(seedRefusal({ uri: 'mongodb://db.example.com/sims', nodeEnv: 'development' }), /not local/);
    assert.match(seedRefusal({ uri: 'mongodb://127.0.0.1/sims', nodeEnv: 'production' }), /production/);
    assert.equal(seedRefusal({ uri: 'mongodb://db.example.com/sims', nodeEnv: 'production', confirm: 'yes' }), null);
    assert.match(seedRefusal({ uri: 'mongodb://db.example.com/sims', nodeEnv: 'development', confirm: 'true' }), /not local/, 'only the exact word yes counts');
  });

  test('the script itself exits before connecting, and never prints the password', () => {
    const r = spawnSync(process.execPath, ['src/seed.js'], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 15000,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DOTENV_CONFIG_PATH: 'no-such.env', MONGO_URI: 'mongodb+srv://admin:TopSecret99@cluster0.abc.mongodb.net/prod' },
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Refusing to seed/);
    assert.match(r.stderr, /cluster0.abc.mongodb.net/);
    assert.match(r.stderr, /SEED_CONFIRM=yes/);
    assert.doesNotMatch(r.stdout + r.stderr, /TopSecret99/);
  });
});
