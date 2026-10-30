import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { api } from '../lib/api';
import { API_ORIGIN } from '../lib/config';
import type { ServerNotification } from '../lib/types';
import { useAuth } from '../store/auth';
import { useToasts } from '../store/toast';

/** Connects the authenticated socket and refreshes cached lists when the server pushes changes. */
export function useLiveUpdates() {
  const token = useAuth((s) => s.accessToken);
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const hydrate = useToasts((s) => s.hydrate);

  useEffect(() => {
    if (!token) return;
    // Bring back what was missed while signed out, with its read state.
    api.get<{ data: { items: ServerNotification[] } }>('/notifications').then((r) => hydrate(r.data.data.items.map((n) => ({
      title: n.title, body: n.body, tone: n.tone, at: Date.parse(n.createdAt), read: !!n.readAt, serverId: n._id,
    })))).catch(() => undefined);

    const socket = io(API_ORIGIN || undefined, { auth: { token }, transports: ['websocket'] });

    // Any change can move a KPI, so cached analytics are refreshed alongside the data that changed.
    const refresh = (...keys: string[]) => [...keys, 'analytics'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

    socket.on('machine:statusChanged', (p: { name: string; code: string; to: string }) => {
      refresh('machines', 'downtime');
      push({ tone: p.to === 'offline' ? 'critical' : 'info', title: `${p.code} is now ${p.to}`, body: p.name, keep: true });
    });
    socket.on('machine:created', () => refresh('machines'));
    socket.on('machine:updated', () => refresh('machines'));
    socket.on('machine:deleted', () => refresh('machines'));
    socket.on('inventory:updated', () => refresh('inventory'));
    socket.on('alert:new', (a: { message: string; severity: 'warning' | 'critical' | 'info' }) => {
      refresh('alerts');
      push({ tone: a.severity === 'info' ? 'info' : a.severity, title: 'New alert', body: a.message, keep: true });
    });
    socket.on('alert:updated', () => refresh('alerts'));
    socket.on('order:updated', () => refresh('orders'));
    socket.on('attendance:updated', () => refresh('attendance', 'workers'));
    socket.on('task:updated', () => refresh('tasks'));
    socket.on('telemetry:reading', () => qc.invalidateQueries({ queryKey: ['telemetry'] }));
    // Alerts already arrive as alert:new above, so only the other kinds are added here.
    socket.on('notification:new', (n: ServerNotification) => {
      if (n.kind === 'alert') return;
      push({ tone: n.tone, title: n.title, body: n.body, keep: true });
    });
    socket.on('leave:updated', () => { qc.invalidateQueries({ queryKey: ['leave'] }); qc.invalidateQueries({ queryKey: ['analytics'] }); });
    socket.on('workorder:updated', () => refresh('work-orders', 'schedules', 'machines'));
    socket.on('purchase:updated', () => refresh('purchase-orders', 'inventory'));
    socket.on('handover:updated', () => refresh('handover'));
    socket.on('assessment:new', () => refresh('assessments', 'machines', 'alerts'));
    socket.on('ml:scored', () => refresh('ml', 'machines', 'alerts'));

    return () => { socket.disconnect(); };
  }, [token, qc, push, hydrate]);
}
