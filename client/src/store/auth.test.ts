import { beforeEach, describe, expect, it, vi } from 'vitest';

// auth.ts builds its own axios instance at import time, so replace axios before loading it.
const http = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => http, isAxiosError: () => false } }));

import { useAuth } from './auth';

const user = { id: 'u1', name: 'Manoj', email: 'm@sims.local', role: 'manager' as const };
const reply = (accessToken: string) => ({ data: { data: { user, accessToken } } });

beforeEach(() => {
  http.post.mockReset();
  useAuth.setState({ user: null, accessToken: null, ready: false });
});

describe('sign in and out', () => {
  it('stores the user and access token on login', async () => {
    http.post.mockResolvedValue(reply('tok-1'));
    await useAuth.getState().login('m@sims.local', 'pw');
    expect(http.post).toHaveBeenCalledWith('/auth/login', { email: 'm@sims.local', password: 'pw' });
    expect(useAuth.getState()).toMatchObject({ user, accessToken: 'tok-1', ready: true });
  });

  it('leaves the user signed out when login fails, and lets the error through', async () => {
    http.post.mockRejectedValue(new Error('Invalid email or password'));
    await expect(useAuth.getState().login('m@sims.local', 'bad')).rejects.toThrow('Invalid email');
    expect(useAuth.getState().user).toBeNull();
  });

  it('signs out locally, without an error, even if the server cannot be reached', async () => {
    useAuth.setState({ user, accessToken: 'tok', ready: true });
    http.post.mockRejectedValue(new Error('offline'));
    await expect(useAuth.getState().logout()).resolves.toBeUndefined();
    expect(useAuth.getState().user).toBeNull();
    expect(useAuth.getState().accessToken).toBeNull();
  });

  it('sends the access token when logging out', async () => {
    useAuth.setState({ user, accessToken: 'tok-9', ready: true });
    http.post.mockResolvedValue({});
    await useAuth.getState().logout();
    expect(http.post).toHaveBeenCalledWith('/auth/logout', null, { headers: { Authorization: 'Bearer tok-9' } });
  });
});

describe('refreshing the session', () => {
  it('restores the session from the refresh cookie', async () => {
    http.post.mockResolvedValue(reply('tok-2'));
    expect(await useAuth.getState().refresh()).toBe('tok-2');
    expect(useAuth.getState()).toMatchObject({ user, accessToken: 'tok-2', ready: true });
  });

  // Refresh tokens rotate: a second concurrent request with the old cookie would be rejected and sign the user out.
  it('shares one request between callers that refresh at the same time', async () => {
    let finish!: (v: unknown) => void;
    http.post.mockReturnValue(new Promise((r) => { finish = r; }));
    const a = useAuth.getState().refresh();
    const b = useAuth.getState().refresh();
    const c = useAuth.getState().refresh();
    finish(reply('tok-3'));
    expect(await Promise.all([a, b, c])).toEqual(['tok-3', 'tok-3', 'tok-3']);
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it('allows a new refresh once the previous one has finished', async () => {
    http.post.mockResolvedValueOnce(reply('tok-a')).mockResolvedValueOnce(reply('tok-b'));
    await useAuth.getState().refresh();
    expect(await useAuth.getState().refresh()).toBe('tok-b');
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it('signs the user out, and marks the app ready, when there is no valid cookie', async () => {
    useAuth.setState({ user, accessToken: 'old', ready: false });
    http.post.mockRejectedValue(new Error('401'));
    expect(await useAuth.getState().refresh()).toBeNull();
    expect(useAuth.getState()).toMatchObject({ user: null, accessToken: null, ready: true });
  });

  it('recovers after a failed refresh', async () => {
    http.post.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(reply('tok-4'));
    await useAuth.getState().refresh();
    expect(await useAuth.getState().refresh()).toBe('tok-4');
  });
});
