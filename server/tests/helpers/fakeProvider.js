/** Scripted stand-in for Gemini. Queue replies per purpose; an unexpected call fails the test. */
export function makeFakeProvider() {
  const queues = {};
  const calls = [];
  return {
    modelId: 'fake-model',
    calls,
    queue(purpose, ...replies) {
      (queues[purpose] ??= []).push(...replies);
    },
    reset() {
      calls.length = 0;
      for (const k of Object.keys(queues)) delete queues[k];
    },
    purposes: () => calls.map((c) => c.purpose),
    async generate(opts) {
      calls.push(opts);
      const q = queues[opts.purpose];
      if (!q?.length) throw new Error(`unexpected provider call: ${opts.purpose}`);
      let reply = q.shift();
      if (typeof reply === 'function') reply = reply(opts);
      if (reply instanceof Error) throw reply;
      return { text: typeof reply === 'string' ? reply : JSON.stringify(reply), usage: { promptTokens: 10, outputTokens: 10 } };
    },
  };
}

export const providerError = (status) => Object.assign(new Error(`provider ${status}`), { status });
export const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
