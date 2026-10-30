import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import AttendanceHeatmap from '../components/AttendanceHeatmap';
import LeavePanel from '../components/LeavePanel';
import type { AttendanceRecord, AttendanceReport, AttendanceSummary, Machine, Page, Shift, Task, TaskStatus, Worker } from '../lib/types';
import { RangePicker } from '../components/charts';
import { btn, ConfirmDialog, EmptyState, Field, fmtDate, input, Modal, PageHeader, Skeleton } from '../components/ui';
import { useAuth } from '../store/auth';
import { useToasts } from '../store/toast';
import MyDay from './MyDay';

type Tab = 'roster' | 'attendance' | 'leave' | 'tasks' | 'shifts';

const ATT_STYLE = { present: 'bg-green/15 text-green', late: 'bg-amber/15 text-amber', absent: 'bg-red/15 text-red' } as const;
const WORKER_STATUS = { active: 'text-green', on_leave: 'text-amber', terminated: 'text-muted' } as const;

const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

export default function Workers() {
  const role = useAuth((s) => s.user?.role);
  return role === 'worker' ? <MyDay /> : <StaffWorkers />;
}

function StaffWorkers() {
  const [tab, setTab] = useState<Tab>('roster');
  const [adding, setAdding] = useState(false);
  const [addingTask, setAddingTask] = useState(false);

  const workers = useQuery({
    queryKey: ['workers'],
    queryFn: async () => (await api.get<{ data: Page<Worker> }>('/workers', { params: { limit: 100 } })).data.data.items,
  });
  const summary = useQuery({
    queryKey: ['attendance', 'summary'],
    queryFn: async () => (await api.get<{ data: AttendanceSummary }>('/attendance/summary')).data.data,
  });

  // The Shifts tab carries its own "Add shift" button, so the header action only covers the other tabs.
  const action = tab === 'shifts' ? undefined : tab === 'tasks'
    ? <button className={btn.primary} onClick={() => setAddingTask(true)}><Plus size={15} className="mr-1 inline" />New task</button>
    : <button className={btn.primary} onClick={() => setAdding(true)}><Plus size={15} className="mr-1 inline" />Add worker</button>;

  const s = summary.data;
  return (
    <div>
      <PageHeader title="Workers" subtitle="Roster, daily attendance and task assignments." actions={action} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          ['Active workers', s?.total, 'text-fg'], ['Present', s?.present, 'text-green'], ['Late', s?.late, 'text-amber'], ['Absent', s?.absent, 'text-red'],
        ] as const).map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border border-line bg-surface px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-muted">{label}</p>
            <p className={`font-display text-2xl font-bold tabular-nums ${tone}`}>{value ?? '–'}</p>
          </div>
        ))}
      </div>

      <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
        {(['roster', 'attendance', 'leave', 'tasks', 'shifts'] as const).map((t) => (
          <button
            key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors ${tab === t ? 'border-amber text-amber' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'roster' && <Roster workers={workers.data} loading={workers.isLoading} />}
      {tab === 'attendance' && <AttendanceTab workers={workers.data ?? []} today={s?.date} />}
      {tab === 'leave' && <LeavePanel staff />}
      {tab === 'tasks' && <TasksTab />}
      {tab === 'shifts' && <ShiftsTab />}

      {adding && <AddWorker onClose={() => setAdding(false)} />}
      {addingTask && <AddTask workers={workers.data ?? []} onClose={() => setAddingTask(false)} />}
    </div>
  );
}

function Roster({ workers, loading }: { workers?: Worker[]; loading: boolean }) {
  const [editing, setEditing] = useState<Worker | null>(null);
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const today = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: async () => (await api.get<{ data: AttendanceRecord[] }>('/attendance')).data.data,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Worker['status'] }) => api.patch(`/workers/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workers'] }),
    onError: (e) => push({ tone: 'critical', title: 'Update failed', body: errorMessage(e) }),
  });
  const byWorker = new Map((today.data ?? []).map((r) => [r.worker._id, r]));

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="px-4 py-3 font-medium">Worker</th>
            <th className="px-4 py-3 font-medium">Department</th>
            <th className="px-4 py-3 font-medium">Shift</th>
            <th className="px-4 py-3 font-medium">Today</th>
            <th className="px-4 py-3 font-medium">Employment</th>
          </tr>
        </thead>
        <tbody>
          {loading && Array.from({ length: 5 }, (_, i) => <tr key={i}><td colSpan={5} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>)}
          {workers?.map((w) => {
            const rec = byWorker.get(w._id);
            return (
              <tr key={w._id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{w.user.name}</div>
                  <div className="font-mono text-xs text-muted">{w.employeeId} · {w.skills.join(', ') || 'no skills listed'}</div>
                </td>
                <td className="px-4 py-3 text-muted">{w.department ?? '—'}</td>
                <td className="px-4 py-3 text-muted">{w.shift ? `${w.shift.name} ${w.shift.startTime}–${w.shift.endTime}` : '—'}</td>
                <td className="px-4 py-3">
                  {w.status !== 'active' ? <span className="text-xs text-muted">—</span>
                    : rec ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${ATT_STYLE[rec.status]}`}>{rec.status} · {time(rec.checkIn)}</span>
                      : <span className="rounded-full bg-red/15 px-2.5 py-0.5 text-xs font-medium text-red">Not in yet</span>}
                </td>
                <td className="px-4 py-3">
                  <select
                    aria-label={`Employment status of ${w.user.name}`} value={w.status}
                    onChange={(e) => setStatus.mutate({ id: w._id, status: e.target.value as Worker['status'] })}
                    className={`rounded-md border border-line bg-bg px-2 py-1 text-xs capitalize ${WORKER_STATUS[w.status]}`}
                  >
                    <option value="active">active</option>
                    <option value="on_leave">on leave</option>
                    <option value="terminated">terminated</option>
                  </select>
                  <button aria-label={`Edit ${w.user.name}`} title="Edit worker" className="ml-1.5 rounded-md p-1.5 align-middle text-muted hover:bg-surface-2 hover:text-fg" onClick={() => setEditing(w)}><Pencil size={13} /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!loading && workers?.length === 0 && <div className="p-4"><EmptyState title="No workers yet" hint="Add the first worker to get started." /></div>}
      {editing && <EditWorker worker={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AttendanceTab({ workers, today }: { workers: Worker[]; today?: string }) {
  const [date, setDate] = useState('');
  const records = useQuery({
    queryKey: ['attendance', 'day', date],
    queryFn: async () => (await api.get<{ data: AttendanceRecord[] }>('/attendance', { params: { date: date || undefined } })).data.data,
  });
  const role = useAuth((s) => s.user?.role);
  const [span, setSpan] = useState(30);
  const report = useQuery({
    queryKey: ['analytics', 'attendance', span],
    enabled: role !== 'worker',
    queryFn: async () => (await api.get<{ data: AttendanceReport }>('/analytics/worker-attendance', { params: { days: span } })).data.data,
  });
  const present = new Set((records.data ?? []).map((r) => r.worker._id));
  const absent = workers.filter((w) => w.status === 'active' && !present.has(w._id));

  return (
    <div>
      {role !== 'worker' && (
        <section className="mb-5 rounded-2xl border border-line bg-surface p-4" aria-label="Attendance heatmap">
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-sm font-semibold">Attendance heatmap</h2>
              <p className="text-xs text-muted">{report.data?.attendancePct != null ? `${report.data.attendancePct}% attendance on days the plant was open` : 'Who came in, day by day'}</p>
            </div>
            <RangePicker value={span} onChange={setSpan} />
          </header>
          {report.isLoading ? <Skeleton className="h-40" /> : report.data && <AttendanceHeatmap report={report.data} />}
        </section>
      )}
      <div className="mb-3 flex items-end gap-3">
        <Field label="Date" htmlFor="att-date">
          <input id="att-date" type="date" className={`${input} w-44`} value={date || today || ''} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="px-4 py-3 font-medium">Worker</th>
              <th className="px-4 py-3 font-medium">Check in</th>
              <th className="px-4 py-3 font-medium">Check out</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {records.isLoading && <tr><td colSpan={4} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>}
            {records.data?.map((r) => (
              <tr key={r._id} className="border-b border-line">
                <td className="px-4 py-3"><div className="font-medium">{r.worker.user.name}</div><div className="font-mono text-xs text-muted">{r.worker.employeeId}</div></td>
                <td className="px-4 py-3 tabular-nums">{time(r.checkIn)}</td>
                <td className="px-4 py-3 tabular-nums text-muted">{time(r.checkOut)}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${ATT_STYLE[r.status]}`}>{r.status}</span></td>
              </tr>
            ))}
            {!records.isLoading && absent.map((w) => (
              <tr key={w._id} className="border-b border-line last:border-0">
                <td className="px-4 py-3"><div className="font-medium">{w.user.name}</div><div className="font-mono text-xs text-muted">{w.employeeId}</div></td>
                <td className="px-4 py-3 text-muted">—</td>
                <td className="px-4 py-3 text-muted">—</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ATT_STYLE.absent}`}>absent</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TASK_COLS: { status: TaskStatus; title: string }[] = [
  { status: 'todo', title: 'To do' }, { status: 'in_progress', title: 'In progress' }, { status: 'done', title: 'Done' },
];

function TasksTab() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: async () => (await api.get<{ data: Page<Task> }>('/tasks', { params: { limit: 100 } })).data.data.items,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) => api.patch(`/tasks/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (e) => push({ tone: 'critical', title: 'Update failed', body: errorMessage(e) }),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {TASK_COLS.map((col) => {
        const list = (tasks.data ?? []).filter((t) => t.status === col.status);
        return (
          <section key={col.status} aria-label={col.title} className="min-w-0 rounded-2xl border border-line bg-surface-2/40 p-3">
            <header className="mb-3 flex items-center justify-between px-1">
              <h2 className="font-display text-sm font-semibold">{col.title}</h2>
              <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-xs tabular-nums text-muted">{list.length}</span>
            </header>
            <div className="flex flex-col gap-2.5">
              {tasks.isLoading && <Skeleton className="h-20" />}
              {list.map((t) => (
                <article key={t._id} className="rounded-xl border border-line bg-surface p-3">
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="mt-1 text-xs text-muted">{t.assignedTo ? t.assignedTo.user.name : 'Unassigned'}{t.machine ? ` · ${t.machine.code}` : ''}{t.order ? ` · ${t.order.orderNo}` : ''}</p>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted">{t.dueAt ? `Due ${fmtDate(t.dueAt)}` : 'No due date'}</span>
                    <select
                      aria-label={`Status of ${t.title}`} value={t.status}
                      onChange={(e) => setStatus.mutate({ id: t._id, status: e.target.value as TaskStatus })}
                      className="rounded-md border border-line bg-bg px-2 py-1 text-xs"
                    >
                      <option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option>
                    </select>
                  </div>
                  <div className="mt-1.5 flex justify-end">
                    <button aria-label={`Delete ${t.title}`} title="Delete task" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-red" onClick={() => setDeleting(t)}><Trash2 size={13} /></button>
                  </div>
                </article>
              ))}
              {!tasks.isLoading && list.length === 0 && <EmptyState title="No tasks" />}
            </div>
          </section>
        );
      })}
      {deleting && <DeleteTask task={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function AddWorker({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const shifts = useQuery({ queryKey: ['shifts'], queryFn: async () => (await api.get<{ data: Shift[] }>('/shifts')).data.data });
  const [f, setF] = useState({ name: '', email: '', password: '', employeeId: '', department: '', skills: '', shift: '' });
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => api.post('/workers', {
      name: f.name, email: f.email, password: f.password, employeeId: f.employeeId,
      department: f.department || undefined, shift: f.shift || undefined,
      skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workers'] }); qc.invalidateQueries({ queryKey: ['attendance'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal title="Add worker" onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); create.mutate(); }} className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Full name" htmlFor="w-name"><input id="w-name" required className={input} value={f.name} onChange={set('name')} /></Field></div>
        <Field label="Email" htmlFor="w-email"><input id="w-email" type="email" required className={input} value={f.email} onChange={set('email')} /></Field>
        <Field label="Temporary password" htmlFor="w-pass"><input id="w-pass" type="password" minLength={8} required className={input} value={f.password} onChange={set('password')} /></Field>
        <Field label="Employee ID" htmlFor="w-eid"><input id="w-eid" required className={input} value={f.employeeId} onChange={set('employeeId')} /></Field>
        <Field label="Department" htmlFor="w-dept"><input id="w-dept" className={input} value={f.department} onChange={set('department')} /></Field>
        <Field label="Shift" htmlFor="w-shift">
          <select id="w-shift" className={input} value={f.shift} onChange={set('shift')}>
            <option value="">None</option>
            {shifts.data?.map((s) => <option key={s._id} value={s._id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
          </select>
        </Field>
        <Field label="Skills (comma separated)" htmlFor="w-skills"><input id="w-skills" className={input} placeholder="lathe, welding" value={f.skills} onChange={set('skills')} /></Field>
        {error && <p role="alert" className="col-span-2 text-sm text-red">{error}</p>}
        <div className="col-span-2 flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={create.isPending}>Create worker</button>
        </div>
      </form>
    </Modal>
  );
}

function AddTask({ workers, onClose }: { workers: Worker[]; onClose: () => void }) {
  const qc = useQueryClient();
  const machines = useQuery({
    queryKey: ['machines', 'all'],
    queryFn: async () => (await api.get<{ data: Page<Machine> }>('/machines', { params: { limit: 100 } })).data.data.items,
  });
  const [f, setF] = useState({ title: '', assignedTo: '', machine: '', dueAt: '' });
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => api.post('/tasks', {
      title: f.title, assignedTo: f.assignedTo || undefined, machine: f.machine || undefined,
      dueAt: f.dueAt ? new Date(`${f.dueAt}T18:00:00`).toISOString() : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal title="New task" onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); create.mutate(); }} className="flex flex-col gap-3">
        <Field label="Title" htmlFor="t-title"><input id="t-title" required className={input} value={f.title} onChange={set('title')} /></Field>
        <Field label="Assign to" htmlFor="t-who">
          <select id="t-who" className={input} value={f.assignedTo} onChange={set('assignedTo')}>
            <option value="">Unassigned</option>
            {workers.filter((w) => w.status === 'active').map((w) => <option key={w._id} value={w._id}>{w.user.name} ({w.employeeId})</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Machine" htmlFor="t-machine">
            <select id="t-machine" className={input} value={f.machine} onChange={set('machine')}>
              <option value="">None</option>
              {machines.data?.map((m) => <option key={m._id} value={m._id}>{m.code}</option>)}
            </select>
          </Field>
          <Field label="Due date" htmlFor="t-due"><input id="t-due" type="date" className={input} value={f.dueAt} onChange={set('dueAt')} /></Field>
        </div>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={create.isPending}>Create task</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteTask({ task, onClose }: { task: Task; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const del = useMutation({
    mutationFn: () => api.delete(`/tasks/${task._id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return <ConfirmDialog title="Delete this task?" busy={del.isPending} error={error} onCancel={onClose} onConfirm={() => del.mutate()} message={<>Remove <strong className="text-fg">{task.title}</strong>. This cannot be undone.</>} />;
}

function EditWorker({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  const qc = useQueryClient();
  const shifts = useQuery({ queryKey: ['shifts'], queryFn: async () => (await api.get<{ data: Shift[] }>('/shifts')).data.data });
  const [f, setF] = useState({ name: worker.user.name, department: worker.department ?? '', skills: worker.skills.join(', '), shift: worker.shift?._id ?? '' });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => api.patch(`/workers/${worker._id}`, {
      name: f.name, department: f.department || undefined, shift: f.shift || null,
      skills: f.skills.split(',').map((x) => x.trim()).filter(Boolean),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workers'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={`Edit ${worker.employeeId}`} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); save.mutate(); }} className="flex flex-col gap-3">
        <Field label="Full name" htmlFor="ew-name"><input id="ew-name" required className={input} value={f.name} onChange={set('name')} /></Field>
        <Field label="Department" htmlFor="ew-dept"><input id="ew-dept" className={input} value={f.department} onChange={set('department')} /></Field>
        <Field label="Shift" htmlFor="ew-shift">
          <select id="ew-shift" className={input} value={f.shift} onChange={set('shift')}>
            <option value="">None</option>
            {shifts.data?.map((x) => <option key={x._id} value={x._id}>{x.name} ({x.startTime}–{x.endTime})</option>)}
          </select>
        </Field>
        <Field label="Skills (comma separated)" htmlFor="ew-skills"><input id="ew-skills" className={input} value={f.skills} onChange={set('skills')} /></Field>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={save.isPending}>Save changes</button>
        </div>
      </form>
    </Modal>
  );
}

function ShiftsTab() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<Shift | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Shift | null>(null);
  const shifts = useQuery({ queryKey: ['shifts'], queryFn: async () => (await api.get<{ data: Shift[] }>('/shifts')).data.data });
  const workers = useQuery({
    queryKey: ['workers'],
    queryFn: async () => (await api.get<{ data: Page<Worker> }>('/workers', { params: { limit: 100 } })).data.data.items,
  });
  const headcount = (id: string) => (workers.data ?? []).filter((w) => w.shift?._id === id && w.status !== 'terminated').length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">A worker is marked late more than 15 minutes after their shift starts.</p>
        <button className={btn.primary} onClick={() => setModal('new')}><Plus size={15} className="mr-1 inline" />Add shift</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shifts.isLoading && <Skeleton className="h-24" />}
        {shifts.data?.map((x) => (
          <article key={x._id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-semibold">{x.name}</h3>
                <p className="font-mono text-sm tabular-nums text-muted">{x.startTime} to {x.endTime}</p>
              </div>
              <div className="flex gap-1">
                <button aria-label={`Edit ${x.name}`} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => setModal(x)}><Pencil size={14} /></button>
                <button aria-label={`Delete ${x.name}`} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-red" onClick={() => setDeleting(x)}><Trash2 size={14} /></button>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">{headcount(x._id)} active worker{headcount(x._id) === 1 ? '' : 's'}</p>
          </article>
        ))}
      </div>
      {!shifts.isLoading && shifts.data?.length === 0 && <EmptyState title="No shifts yet" hint="Add a shift, then assign workers to it." />}
      {modal && <ShiftForm shift={modal === 'new' ? undefined : modal} onClose={() => setModal(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['shifts'] }); qc.invalidateQueries({ queryKey: ['workers'] }); }} />}
      {deleting && <DeleteShift shift={deleting} onClose={() => setDeleting(null)} onDone={() => qc.invalidateQueries({ queryKey: ['shifts'] })} />}
    </div>
  );
}

function ShiftForm({ shift, onClose, onSaved }: { shift?: Shift; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: shift?.name ?? '', startTime: shift?.startTime ?? '06:00', endTime: shift?.endTime ?? '14:00' });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => (shift ? api.patch(`/shifts/${shift._id}`, f) : api.post('/shifts', f)),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={shift ? `Edit ${shift.name}` : 'Add shift'} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); save.mutate(); }} className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Name" htmlFor="sh-name"><input id="sh-name" required className={input} value={f.name} onChange={set('name')} /></Field></div>
        <Field label="Starts" htmlFor="sh-start"><input id="sh-start" type="time" required className={input} value={f.startTime} onChange={set('startTime')} /></Field>
        <Field label="Ends" htmlFor="sh-end"><input id="sh-end" type="time" required className={input} value={f.endTime} onChange={set('endTime')} /></Field>
        {error && <p role="alert" className="col-span-2 text-sm text-red">{error}</p>}
        <div className="col-span-2 flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={save.isPending}>{shift ? 'Save changes' : 'Create shift'}</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteShift({ shift, onClose, onDone }: { shift: Shift; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState('');
  const del = useMutation({ mutationFn: () => api.delete(`/shifts/${shift._id}`), onSuccess: () => { onDone(); onClose(); }, onError: (e) => setError(errorMessage(e)) });
  return <ConfirmDialog title={`Delete ${shift.name}?`} busy={del.isPending} error={error} onCancel={onClose} onConfirm={() => del.mutate()} message={<>A shift that still has active workers cannot be deleted. Move them to another shift first.</>} />;
}
