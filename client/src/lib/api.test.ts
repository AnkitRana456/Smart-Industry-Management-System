import type { InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../store/auth';
import { api, errorMessage } from './api';

type Handler = (config: InternalAxiosRequestConfig) => { status: number; data?: unknown };

/** Replaces the network with a function so the interceptors run for real. */
function network(handler: Handler) {
  // Snapshot the header per call: the interceptor reuses and mutates one config object when it replays a request.
  const seen: { sentAuth?: string }[] = [];
  api.defaults.adapter = async (config) => {
    seen.push({ sentAuth: config.headers.Authorization as string | undefined });
    const { status, data = {} } = handler(config);
    const response = { data, status, statusText: '', headers: {}, config };
    if (status >= 400) throw Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, config, response });
    return response;
  };
  return seen;
}

const auth = (token: string | null) => useAuth.setState({ accessToken: token });
let originalAdapter: typeof api.defaults.adapter;

beforeEach(() => { originalAdapter = api.defaults.adapter; });
afterEach(() => { api.defaults.adapter = originalAdapter; useAuth.setState({ refresh: useAuth.getInitialState().refresh }); });

describe('request headers', () => {
  it('sends the access token as a bearer header', async () => {
    auth('tok-1');
    const seen = network(() => ({ status: 200 }));
    await api.get('/machines');
    expect(seen[0].sentAuth).toBe('Bearer tok-1');
  });

  it('sends no header when signed out', async () => {
    auth(null);
    const seen = network(() => ({ status: 200 }));
    await api.get('/machines');
    expect(seen[0].sentAuth).toBeUndefined();
  });
});

describe('expired access tokens', () => {
  it('refreshes once and replays the request with the new token', async () => {
    auth('old');
    const refresh = vi.fn(async () => { auth('new'); return 'new'; });
    useAuth.setState({ refresh });
    const seen = network((c) => (c.headers.Authorization === 'Bearer new' ? { status: 200, data: { ok: true } } : { status: 401 }));
    const res = await api.get('/machines');
    expect(res.data).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(seen.map((c) => c.sentAuth)).toEqual(['Bearer old', 'Bearer new']);
  });

  it('gives up with the original 401 when the session cannot be refreshed', async () => {
    auth('old');
    useAuth.setState({ refresh: vi.fn(async () => null) });
    const seen = network(() => ({ status: 401 }));
    await expect(api.get('/machines')).rejects.toMatchObject({ response: { status: 401 } });
    expect(seen).toHaveLength(1);
  });

  it('does not loop: a replay that is still 401 fails after one retry', async () => {
    auth('old');
    const refresh = vi.fn(async () => 'new');
    useAuth.setState({ refresh });
    const seen = network(() => ({ status: 401 }));
    await expect(api.get('/machines')).rejects.toMatchObject({ response: { status: 401 } });
    expect(seen).toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('never tries to refresh for auth endpoints, so a wrong password is just an error', async () => {
    const refresh = vi.fn(async () => 'new');
    useAuth.setState({ refresh });
    network(() => ({ status: 401 }));
    await expect(api.post('/auth/login', {})).rejects.toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('leaves other errors alone', async () => {
    const refresh = vi.fn(async () => 'new');
    useAuth.setState({ refresh });
    network(() => ({ status: 403 }));
    await expect(api.get('/users')).rejects.toMatchObject({ response: { status: 403 } });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('shares one refresh between requests that fail together', async () => {
    auth('old');
    let resolve!: (t: string) => void;
    const refresh = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    useAuth.setState({ refresh });
    network((c) => (c.headers.Authorization === 'Bearer new' ? { status: 200 } : { status: 401 }));
    const calls = Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    auth('new');
    resolve('new');
    await calls;
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('errorMessage', () => {
  it('prefers the server\'s own message', () => {
    expect(errorMessage({ isAxiosError: true, message: 'Request failed', response: { data: { message: 'Not enough steel' } } })).toBe('Not enough steel');
  });
  it('falls back to the error text, then to a generic line', () => {
    expect(errorMessage(new Error('Network Error'))).toBe('Network Error');
    expect(errorMessage('weird')).toBe('Something went wrong');
  });
});
