import { ApiError } from '../../utils/ApiError.js';

/**
 * Keeps calls to the AI provider under a requests-per-minute quota by making callers wait their turn.
 * A caller that would have to wait longer than `maxWaitMs` is refused straight away with the wait time,
 * so a burst never leaves requests hanging. `perMinute: 0` switches the gate off.
 *
 * `now` and `sleep` can be replaced, so tests run against a virtual clock.
 */
export function createGate({ perMinute, maxWaitMs, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const WINDOW = 60_000;
  const starts = [];
  let turn = Promise.resolve();

  async function waitForSlot(deadline) {
    for (;;) {
      const t = now();
      while (starts.length && t - starts[0] >= WINDOW) starts.shift();
      if (starts.length < perMinute) {
        starts.push(t);
        return;
      }
      const wait = WINDOW - (t - starts[0]) + 25;
      if (t + wait > deadline) {
        const seconds = Math.ceil(wait / 1000);
        throw new ApiError(429, `The AI service is busy right now. Please try again in about ${seconds} seconds.`, null, seconds);
      }
      await sleep(wait);
    }
  }

  return {
    async acquire() {
      if (!perMinute) return;
      const deadline = now() + maxWaitMs;
      // One caller decides at a time, so a burst is served in order and can never overshoot the quota.
      const mine = turn.then(() => waitForSlot(deadline));
      turn = mine.catch(() => undefined);
      return mine;
    },
  };
}
