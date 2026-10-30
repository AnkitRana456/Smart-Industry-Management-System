import axios from 'axios';
import { create } from 'zustand';
import { API_ORIGIN } from '../lib/config';

export type Role = 'admin' | 'manager' | 'worker';
export interface User { id: string; name: string; email: string; role: Role }

interface AuthState {
  user: User | null;
  accessToken: string | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  refresh: () => Promise<string | null>;
  logout: () => Promise<void>;
}

const plain = axios.create({ baseURL: `${API_ORIGIN}/api`, withCredentials: true });
let inflight: Promise<string | null> | null = null;

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  ready: false,

  async login(email, password) {
    const { data } = await plain.post('/auth/login', { email, password });
    set({ user: data.data.user, accessToken: data.data.accessToken, ready: true });
  },

  // Refresh tokens rotate, so concurrent callers must share a single request.
  refresh() {
    inflight ??= plain.post('/auth/refresh')
      .then(({ data }) => {
        set({ user: data.data.user, accessToken: data.data.accessToken, ready: true });
        return data.data.accessToken as string;
      })
      .catch(() => {
        set({ user: null, accessToken: null, ready: true });
        return null;
      })
      .finally(() => { inflight = null; });
    return inflight;
  },

  async logout() {
    const token = get().accessToken;
    try {
      await plain.post('/auth/logout', null, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
      // Signing out must always work locally, even if the server cannot be reached.
    } finally {
      set({ user: null, accessToken: null });
    }
  },
}));
