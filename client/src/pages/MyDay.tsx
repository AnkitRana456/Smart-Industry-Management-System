import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogIn, LogOut } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import type { AttendanceRecord, Page, Task, TaskStatus, Worker } from '../lib/types';
import LeavePanel from '../components/LeavePanel';
import { btn, EmptyState, fmtDate, PageHeader, Skeleton } from '../components/ui';
import { useAuth } from '../store/auth';
import { useToasts } from '../store/toast';

const ATT_STYLE = { present: 'bg-green/15 text-green', late: 'bg-amber/15 text-amber', absent: 'bg-red/15 text-red' } as const;
const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

const NEXT: Record<TaskStatus, { label: string; to: TaskStatus } | null> = {
  todo: { label: 'Start', to: 'in_progress' },
  in_progress: { label: 'Mark done', to: 'done' },
  done: null,
};

export default function MyDay() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);

  const me = useQuery({ queryKey: ['workers', 'me'], queryFn: async () => (await api.get<{ data: Worker }>('/workers/me')).data.data });
  const today = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: async () => (await api.get<{ data: AttendanceRecord[] }>('/attendance')).data.data[0] ?? null,
  });
  const recent = useQuery({
    queryKey: ['attendance', 'recent'],
    queryFn: async () => {
      const from = new Intl.DateTimeFormat('en-CA').format(new Date(Date.now() - 13 * 86_400_000));
      return (await api.get<{ data: AttendanceRecord[] }>('/attendance', { params: { from } })).data.data;
    },
  });
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: async () => (await api.get<{ data: Page<Task> }>('/tasks', { params: { limit: 50 } })).data.data.items,
  });

  const refreshAttendance = () => qc.invalidateQueries({ queryKey: ['attendance'] });
  const checkIn = useMutation({
    mutationFn: () => api.post('/attendance/check-in'), onSuccess: refreshAttendance,
    onError: (e) => push({ tone: 'warning', title: 'Could not check in', body: errorMessage(e) }),
  });
  const checkOut = useMutation({
    mutationFn: () => api.post('/attendance/check-out'), onSuccess: refreshAttendance,
    onError: (e) => push({ tone: 'warning', title: 'Could not check out', body: errorMessage(e) }),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => api.patch(`/tasks/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (e) => push({ tone: 'critical', title: 'Update failed', body: errorMessage(e) }),
  });

  const rec = today.data;
  const open = (tasks.data ?? []).filter((t) => t.status !== 'done');
  const done = (tasks.data ?? []).filter((t) => t.status === 'done');

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Hello, ${user?.name.split(' ')[0] ?? ''}`} subtitle={me.data?.shift ? `${me.data.shift.name} shift, ${me.data.shift.startTime}–${me.data.shift.endTime}` : 'Your day at a glance.'} />

      <section className="mb-5 rounded-2xl border border-line bg-surface p-5" aria-label="Attendance today">
        {today.isLoading ? <Skeleton className="h-16" /> : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted">Today</p>
              {!rec && <p className="font-display text-xl font-semibold">You haven't checked in</p>}
              {rec && (
                <p className="font-display text-xl font-semibold">
                  In at {time(rec.checkIn)}{rec.checkOut ? `, out at ${time(rec.checkOut)}` : ''}
                  <span className={`ml-2 rounded-full px-2.5 py-0.5 align-middle text-xs font-medium capitalize ${ATT_STYLE[rec.status]}`}>{rec.status}</span>
                </p>
              )}
            </div>
            {!rec && <button className={`${btn.primary} flex items-center gap-2 !px-5 !py-2.5`} disabled={checkIn.isPending} onClick={() => checkIn.mutate()}><LogIn size={16} />Check in</button>}
            {rec && !rec.checkOut && <button className={`${btn.ghost} flex items-center gap-2 !px-5 !py-2.5`} disabled={checkOut.isPending} onClick={() => checkOut.mutate()}><LogOut size={16} />Check out</button>}
          </div>
        )}
      </section>

      <section className="mb-5" aria-label="My tasks">
        <h2 className="mb-2 font-display text-sm font-semibold">My tasks</h2>
        <div className="flex flex-col gap-2.5">
          {tasks.isLoading && <Skeleton className="h-20" />}
          {open.map((t) => {
            const next = NEXT[t.status];
            return (
              <article key={t._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    <span className="capitalize">{t.status.replace('_', ' ')}</span>
                    {t.machine ? ` · ${t.machine.code}` : ''}{t.order ? ` · ${t.order.orderNo}` : ''}{t.dueAt ? ` · due ${fmtDate(t.dueAt)}` : ''}
                  </p>
                </div>
                {next && <button className={btn.ghost} disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: t._id, status: next.to })}>{next.label}</button>}
              </article>
            );
          })}
          {!tasks.isLoading && open.length === 0 && <EmptyState title="No open tasks" hint={done.length ? `${done.length} finished.` : 'Your manager will assign work here.'} />}
        </div>
      </section>

      <LeavePanel staff={false} />

      <section aria-label="Recent attendance">
        <h2 className="mb-2 font-display text-sm font-semibold">Last two weeks</h2>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {(recent.data ?? []).map((r) => (
            <div key={r._id} className="flex items-center justify-between border-b border-line px-4 py-2.5 text-sm last:border-0">
              <span className="tabular-nums">{r.date}</span>
              <span className="tabular-nums text-muted">{time(r.checkIn)} – {time(r.checkOut)}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${ATT_STYLE[r.status]}`}>{r.status}</span>
            </div>
          ))}
          {!recent.isLoading && recent.data?.length === 0 && <p className="p-4 text-sm text-muted">No attendance recorded yet.</p>}
        </div>
      </section>
    </div>
  );
}
