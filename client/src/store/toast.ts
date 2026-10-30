import { create } from 'zustand';

type Tone = 'info' | 'success' | 'warning' | 'critical';

export interface Toast { id: number; title: string; body?: string; tone: Tone }
export interface Notice extends Toast { at: number; read: boolean; serverId?: string }

let nextId = 1;
const MAX_NOTICES = 30;

interface State {
  toasts: Toast[];
  notices: Notice[];
  /** `keep` also stores the message in the notification center. Use it for events, not for form errors. */
  push: (t: Omit<Toast, 'id'> & { keep?: boolean }) => void;
  dismiss: (id: number) => void;
  markAllRead: () => void;
  clearNotices: () => void;
  /** Replaces the list with the user's stored notifications (called once after sign-in). */
  hydrate: (items: Omit<Notice, 'id'>[]) => void;
}

export const useToasts = create<State>((set, get) => ({
  toasts: [],
  notices: [],
  push({ keep, ...t }) {
    const id = nextId++;
    set({
      toasts: [...get().toasts.slice(-3), { ...t, id }],
      ...(keep && { notices: [{ ...t, id, at: Date.now(), read: false }, ...get().notices].slice(0, MAX_NOTICES) }),
    });
    setTimeout(() => get().dismiss(id), 6000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
  markAllRead: () => set({ notices: get().notices.map((n) => ({ ...n, read: true })) }),
  clearNotices: () => set({ notices: [] }),
  hydrate: (items) => set({ notices: items.slice(0, MAX_NOTICES).map((n) => ({ ...n, id: nextId++ })) }),
}));
