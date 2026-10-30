import { vi } from 'vitest';
import { ok } from './utils';

/** Stand-in for lib/api. Tests install it with vi.mock('../lib/api', async () => (await import('../test/mockApi')).module). */
export const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };

export const errorMessage = (err: unknown): string => {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Something went wrong';
};

export const module = { api: apiMock, errorMessage };

export function resetApi() {
  for (const fn of Object.values(apiMock)) fn.mockReset();
}

type Responder = unknown | Error | (() => unknown);

/** Answers GET requests by URL prefix. An Error value (or a function returning one) is thrown instead. */
export function routeGet(routes: Record<string, Responder>) {
  apiMock.get.mockImplementation(async (url: string) => {
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => url.startsWith(k));
    if (key === undefined) throw new Error(`Unmocked GET ${url}`);
    const raw = routes[key];
    const value = typeof raw === 'function' ? (raw as () => unknown)() : raw;
    if (value instanceof Error) throw value;
    return ok(value);
  });
}
