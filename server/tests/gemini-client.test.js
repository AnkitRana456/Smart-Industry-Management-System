import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';
process.env.GEMINI_MODEL = '';

const { generateJson, setProvider } = await import('../src/modules/ai/gemini.client.js');

afterEach(() => setProvider(null));

/** A provider that returns scripted raw replies, so finish reasons and token limits can be controlled. */
function scripted(...replies) {
  const calls = [];
  setProvider({
    modelId: 'scripted',
    async generate(opts) {
      calls.push(opts);
      return replies.shift() ?? (() => { throw new Error('unexpected call'); })();
    },
  });
  return calls;
}

const ask = (extra = {}) => generateJson({ purpose: 'test', system: 's', prompt: 'p', jsonSchema: {}, validate: (x) => x, maxOutputTokens: 100, ...extra });

describe('replies cut off by the token limit', () => {
  // With thinking models, hidden reasoning tokens count against the limit and can truncate a reply mid-sentence.
  test('are retried once with twice the room, and the retry is used', async () => {
    const calls = scripted(
      { text: 'Here is the', finishReason: 'MAX_TOKENS', usage: {} },
      { text: '{"ok":true}', finishReason: 'STOP', usage: {} },
    );
    const r = await ask();
    assert.deepEqual(r.data, { ok: true });
    assert.deepEqual(calls.map((c) => c.maxOutputTokens), [100, 200]);
    assert.match(calls[1].prompt, /cut off/);
  });

  test('a reply that is cut off even after the retry fails cleanly instead of returning half an answer', async () => {
    scripted(
      { text: '{"a":', finishReason: 'MAX_TOKENS', usage: {} },
      { text: '{"a":', finishReason: 'MAX_TOKENS', usage: {} },
    );
    await assert.rejects(ask(), (e) => e.status === 502);
  });

  test('a truncated reply is rejected even if what survived happens to be valid JSON', async () => {
    scripted({ text: '{"ok":true}', finishReason: 'MAX_TOKENS', usage: {} }, { text: '{"ok":true}', finishReason: 'STOP', usage: {} });
    const calls = [];
    setProvider({ modelId: 's', async generate(o) { calls.push(o); return calls.length === 1 ? { text: '{"ok":true}', finishReason: 'MAX_TOKENS' } : { text: '{"ok":true}', finishReason: 'STOP' }; } });
    await ask();
    assert.equal(calls.length, 2, 'the first, truncated reply was not trusted');
  });

  test('normal replies are used on the first attempt with the requested limit', async () => {
    const calls = scripted({ text: '{"ok":1}', finishReason: 'STOP', usage: {} });
    await ask();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].maxOutputTokens, 100);
  });
});

describe('thinking budget setting', () => {
  const budget = (value) => {
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DOTENV_CONFIG_PATH: 'no-such.env' };
    if (value !== undefined) env.GEMINI_THINKING_BUDGET = value;
    const r = spawnSync(process.execPath, ['-e', "import('./src/config/env.js').then((m) => console.log(JSON.stringify(m.env.geminiThinkingBudget)))"], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env });
    return JSON.parse(r.stdout);
  };

  test('is off by default, can be set to a number, or left to the model', () => {
    assert.equal(budget(undefined), 0);
    assert.equal(budget(''), 0);
    assert.equal(budget('512'), 512);
    assert.equal(budget('default'), null);
    assert.equal(budget('lots'), 0);
  });
});

const { normalizeProviderError } = await import('../src/modules/ai/gemini.client.js');
const { createGate } = await import('../src/modules/ai/rateGate.js');

describe('provider rate limit', () => {
  test('passes Google\'s retry delay on to the caller, rounded up', () => {
    const err = normalizeProviderError(Object.assign(new Error('{"error":{"message":"quota exceeded. Please retry in 30.60645827s."}}'), { status: 429 }));
    assert.equal(err.status, 429);
    assert.equal(err.retryAfterSec, 31);
    assert.match(err.message, /about 31 seconds/);
  });

  test('understands a daily-quota delay of hours and says so in plain words', () => {
    const err = normalizeProviderError(Object.assign(new Error('limit: 20 per day. Please retry in 20h56m41.48s.'), { status: 429 }));
    assert.equal(err.retryAfterSec, 20 * 3600 + 56 * 60 + 42);
    assert.match(err.message, /about 21 hours/);
  });

  test('uses minutes for mid-sized delays and seconds for short ones', () => {
    assert.match(normalizeProviderError(Object.assign(new Error('retry in 4m10.2s'), { status: 429 })).message, /about 4 minutes/);
    assert.match(normalizeProviderError(Object.assign(new Error('retry in 12s'), { status: 429 })).message, /about 12 seconds/);
  });

  test('falls back to a minute when the provider gives no delay', () => {
    assert.equal(normalizeProviderError(Object.assign(new Error('quota'), { status: 429 })).retryAfterSec, 60);
  });
});

describe('rate gate', () => {
  /** A virtual clock: sleeping just moves time forward. */
  const clock = () => {
    let t = 1_000_000;
    return { now: () => t, sleep: async (ms) => { t += ms; }, advance: (ms) => { t += ms; } };
  };

  test('lets calls through up to the limit with no waiting, then makes the next one wait for the window', async () => {
    const c = clock();
    const gate = createGate({ perMinute: 5, maxWaitMs: 120_000, ...c });
    const start = c.now();
    for (let i = 0; i < 5; i++) await gate.acquire();
    assert.equal(c.now(), start, 'the first five did not wait');
    await gate.acquire();
    assert.ok(c.now() - start >= 60_000, 'the sixth waited for the first to leave the window');
  });

  test('never lets more than the limit start inside any 60-second window, even for a burst', async () => {
    const c = clock();
    const gate = createGate({ perMinute: 5, maxWaitMs: 10 * 60_000, ...c });
    const times = [];
    await Promise.all(Array.from({ length: 17 }, async () => { await gate.acquire(); times.push(c.now()); }));
    times.sort((a, b) => a - b);
    for (let i = 5; i < times.length; i++) assert.ok(times[i] - times[i - 5] >= 60_000, `call ${i} started too soon`);
  });

  test('refuses, with the wait time, instead of hanging when the wait would be too long', async () => {
    const c = clock();
    const gate = createGate({ perMinute: 2, maxWaitMs: 10_000, ...c });
    await gate.acquire();
    await gate.acquire();
    await assert.rejects(gate.acquire(), (e) => e.status === 429 && e.retryAfterSec >= 59 && /about \d+ seconds/.test(e.message));
  });

  test('a refused caller does not block the ones behind it, and later calls succeed once the window passes', async () => {
    const c = clock();
    const gate = createGate({ perMinute: 1, maxWaitMs: 5_000, ...c });
    await gate.acquire();
    await assert.rejects(gate.acquire());
    c.advance(61_000);
    await gate.acquire();
  });

  test('is off when the limit is zero', async () => {
    const c = clock();
    const gate = createGate({ perMinute: 0, maxWaitMs: 1, ...c });
    const start = c.now();
    for (let i = 0; i < 50; i++) await gate.acquire();
    assert.equal(c.now(), start);
  });
});
