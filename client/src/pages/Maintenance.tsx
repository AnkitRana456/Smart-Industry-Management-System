import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import type {
  Machine, Page, ReliabilityReport, Schedule, Worker, WoPriority, WoStatus, WoSummary, WoType, WorkOrder,
} from '../lib/types';
import { RangePicker } from '../components/charts';
import { btn, ConfirmDialog, EmptyState, Field, fmtDate, fmtMins, input, Modal, PageHeader, Skeleton } from '../components/ui';
import { useAuth } from '../store/auth';
import { useToasts } from '../store/toast';

type Tab = 'orders' | 'schedules' | 'reliability';

const PRIORITY_STYLE: Record<WoPriority, string> = {
  low: 'bg-surface-2 text-muted', medium: 'bg-blue/15 text-blue', high: 'bg-amber/15 text-amber', urgent: 'bg-red/15 text-red',
};
const STATUS_STYLE: Record<WoStatus, string> = {
  open: 'bg-blue/15 text-blue', in_progress: 'bg-amber/15 text-amber', done: 'bg-green/15 text-green', cancelled: 'bg-surface-2 text-muted',
};
const label = (s: string) => s.replace('_', ' ');
const Pill = ({ cls, children }: { cls: string; children: string }) => (
  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}>{children}</span>
);
const dateInput = (iso?: string) => (iso ? iso.slice(0, 10) : '');
const toIso = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);

export default function Maintenance() {
  const staff = useAuth((s) => s.user?.role !== 'worker');
  const [tab, setTab] = useState<Tab>('orders');
  const [adding, setAdding] = useState(false);
  const tabs: Tab[] = staff ? ['orders', 'schedules', 'reliability'] : ['orders'];

  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle={staff ? 'Work orders, recurring schedules and how reliably each machine runs.' : 'Maintenance jobs assigned to you.'}
        actions={staff && tab === 'orders' && <button className={btn.primary} onClick={() => setAdding(true)}><Plus size={15} className="mr-1 inline" />New work order</button>}
      />
      {tabs.length > 1 && (
        <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
          {tabs.map((t) => (
            <button
              key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize ${tab === t ? 'border-amber text-amber' : 'border-transparent text-muted hover:text-fg'}`}
            >
              {t === 'orders' ? 'Work orders' : t}
            </button>
          ))}
        </div>
      )}
      {tab === 'orders' && <OrdersTab staff={staff} />}
      {tab === 'schedules' && <SchedulesTab />}
      {tab === 'reliability' && <ReliabilityTab />}
      {adding && <OrderForm onClose={() => setAdding(false)} />}
    </div>
  );
}

function OrdersTab({ staff }: { staff: boolean }) {
  const [status, setStatus] = useState<WoStatus | ''>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkOrder | null>(null);
  const [deleting, setDeleting] = useState<WorkOrder | null>(null);

  const summary = useQuery({
    queryKey: ['work-orders', 'summary'], enabled: staff,
    queryFn: async () => (await api.get<{ data: WoSummary }>('/maintenance/summary')).data.data,
  });
  const orders = useQuery({
    queryKey: ['work-orders', status, overdueOnly],
    queryFn: async () => (await api.get<{ data: Page<WorkOrder> }>('/maintenance/work-orders', {
      params: { limit: 100, status: status || undefined, overdue: overdueOnly ? 'true' : undefined },
    })).data.data.items,
  });
  const s = summary.data;
  const items = orders.data ?? [];

  return (
    <div>
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {([['Open', s.open, 'text-blue'], ['In progress', s.inProgress, 'text-amber'], ['Overdue', s.overdue, s.overdue ? 'text-red' : 'text-green'], ['Urgent', s.urgent, s.urgent ? 'text-red' : 'text-green']] as const).map(([k, v, tone]) => (
            <div key={k} className="rounded-xl border border-line bg-surface p-4">
              <p className="text-[11px] uppercase tracking-wider text-muted">{k}</p>
              <p className={`mt-1 font-display text-3xl font-bold tabular-nums ${tone}`}>{v}</p>
            </div>
          ))}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select aria-label="Filter by status" className={`${input} !w-auto`} value={status} onChange={(e) => setStatus(e.target.value as WoStatus | '')}>
          <option value="">All statuses</option>
          {(['open', 'in_progress', 'done', 'cancelled'] as const).map((x) => <option key={x} value={x}>{label(x)}</option>)}
        </select>
        <button
          aria-pressed={overdueOnly} onClick={() => setOverdueOnly((v) => !v)}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium ${overdueOnly ? 'border-red bg-red/10 text-red' : 'border-line text-muted hover:text-fg'}`}
        >
          Overdue only
        </button>
      </div>

      {orders.isLoading && <Skeleton className="h-40" />}
      {!orders.isLoading && items.length === 0 && (
        <EmptyState title="No work orders" hint={staff ? 'Create one, or set a machine offline to open one automatically.' : 'Nothing is assigned to you right now.'} />
      )}
      <ul className="flex flex-col gap-2.5">
        {items.map((o) => (
          <li key={o._id} className={`rounded-xl border bg-surface p-4 ${o.overdue ? 'border-red/50' : 'border-line'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-xs text-muted">{o.woNo} · {o.machine.code} {o.machine.name}</p>
                <button className="text-left font-medium hover:text-amber" onClick={() => setOpen(o._id)}>{o.title}</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Pill cls={PRIORITY_STYLE[o.priority]}>{o.priority}</Pill>
                <Pill cls="bg-surface-2 text-muted">{o.type}</Pill>
                <Pill cls={STATUS_STYLE[o.status]}>{label(o.status)}</Pill>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>
                {o.assignedTo ? `Assigned to ${o.assignedTo.user.name}` : 'Unassigned'}
                {o.dueAt && <> · due {new Date(o.dueAt).toLocaleDateString()}</>}
                {o.source === 'downtime' && ' · opened by downtime'}
                {o.source === 'schedule' && ' · recurring'}
              </span>
              {o.overdue && <span className="inline-flex items-center gap-1 font-medium text-red"><AlertTriangle size={12} />Overdue</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusButtons order={o} staff={staff} />
              <button className={`${btn.ghost} !py-1.5 text-xs`} onClick={() => setOpen(o._id)}>Details &amp; notes</button>
              {staff && o.status !== 'done' && o.status !== 'cancelled' && (
                <button aria-label={`Edit ${o.woNo}`} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => setEditing(o)}><Pencil size={14} /></button>
              )}
              {staff && <button aria-label={`Delete ${o.woNo}`} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-red" onClick={() => setDeleting(o)}><Trash2 size={14} /></button>}
            </div>
          </li>
        ))}
      </ul>
      {open && <OrderDetail id={open} onClose={() => setOpen(null)} />}
      {editing && <OrderForm order={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteOrder order={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function useMove() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  return useMutation({
    mutationFn: ({ id, status, resolution }: { id: string; status: WoStatus; resolution?: string }) =>
      api.patch(`/maintenance/work-orders/${id}/status`, { status, resolution: resolution || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['work-orders'] }); qc.invalidateQueries({ queryKey: ['machines'] }); },
    onError: (e) => push({ tone: 'warning', title: 'Work order not updated', body: errorMessage(e) }),
  });
}

function StatusButtons({ order, staff }: { order: WorkOrder; staff: boolean }) {
  const move = useMove();
  const [finishing, setFinishing] = useState(false);
  const [note, setNote] = useState('');
  if (order.status === 'done' || order.status === 'cancelled') return null;
  return (
    <>
      {order.status === 'open' && <button className={`${btn.primary} !py-1.5 text-xs`} disabled={move.isPending} onClick={() => move.mutate({ id: order._id, status: 'in_progress' })}>Start</button>}
      {order.status === 'in_progress' && <button className={`${btn.primary} !py-1.5 text-xs`} onClick={() => setFinishing(true)}>Complete</button>}
      {staff && <button className={`${btn.ghost} !py-1.5 text-xs`} disabled={move.isPending} onClick={() => move.mutate({ id: order._id, status: 'cancelled' })}>Cancel</button>}
      {finishing && (
        <Modal title={`Complete ${order.woNo}`} onClose={() => setFinishing(false)}>
          <form onSubmit={(e) => { e.preventDefault(); move.mutate({ id: order._id, status: 'done', resolution: note }, { onSuccess: () => setFinishing(false) }); }}>
            <Field label="What was done? (optional)" htmlFor="wo-res">
              <textarea id="wo-res" rows={3} maxLength={1000} className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Replaced the spindle bearing and ran a test cycle" />
            </Field>
            {order.type !== 'inspection' && <p className="mt-2 text-xs text-muted">The machine&apos;s last-service date will be set to now.</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={btn.ghost} onClick={() => setFinishing(false)}>Cancel</button>
              <button type="submit" className={btn.primary} disabled={move.isPending}>Mark complete</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [text, setText] = useState('');
  const wo = useQuery({
    queryKey: ['work-orders', 'one', id],
    queryFn: async () => (await api.get<{ data: WorkOrder }>(`/maintenance/work-orders/${id}`)).data.data,
  });
  const add = useMutation({
    mutationFn: () => api.post(`/maintenance/work-orders/${id}/notes`, { text }),
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['work-orders'] }); },
    onError: (e) => push({ tone: 'critical', title: 'Note not added', body: errorMessage(e) }),
  });
  const o = wo.data;
  return (
    <Modal title={o ? `${o.woNo}: ${o.title}` : 'Work order'} onClose={onClose} wide>
      {!o && <Skeleton className="h-32" />}
      {o && (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
            {([['Machine', `${o.machine.code} ${o.machine.name}`], ['Status', label(o.status)], ['Priority', o.priority], ['Type', o.type], ['Due', o.dueAt ? new Date(o.dueAt).toLocaleDateString() : '—'], ['Assigned to', o.assignedTo?.user.name ?? 'Unassigned'], ['Started', fmtDate(o.startedAt)], ['Completed', fmtDate(o.completedAt)]] as const).map(([k, v]) => (
              <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="capitalize">{v}</dd></div>
            ))}
          </dl>
          {o.description && <p className="mb-3 text-sm text-muted">{o.description}</p>}
          {o.resolution && <p className="mb-3 rounded-lg bg-green/10 px-3 py-2 text-sm"><span className="font-medium">Resolution: </span>{o.resolution}</p>}
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">Notes</h3>
          <ul className="mb-3 flex max-h-56 flex-col gap-2 overflow-y-auto">
            {o.notes.length === 0 && <li className="text-sm text-muted">No notes yet.</li>}
            {o.notes.map((n, i) => (
              <li key={i} className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <p>{n.text}</p><p className="mt-0.5 text-[11px] text-muted">{n.by} · {fmtDate(n.at)}</p>
              </li>
            ))}
          </ul>
          <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }} className="flex gap-2">
            <input aria-label="Add a note" className={input} maxLength={500} placeholder="Add a note for whoever picks this up next" value={text} onChange={(e) => setText(e.target.value)} />
            <button className={btn.primary} disabled={add.isPending || !text.trim()}>Add</button>
          </form>
        </>
      )}
    </Modal>
  );
}

function OrderForm({ order, onClose }: { order?: WorkOrder; onClose: () => void }) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const editing = !!order;
  const [f, setF] = useState({
    machine: order?.machine._id ?? '', title: order?.title ?? '', description: order?.description ?? '',
    type: (order?.type ?? 'corrective') as WoType, priority: (order?.priority ?? 'medium') as WoPriority,
    assignedTo: order?.assignedTo?._id ?? '', dueAt: dateInput(order?.dueAt),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const machines = useQuery({ queryKey: ['machines', 'all'], queryFn: async () => (await api.get<{ data: Page<Machine> }>('/machines', { params: { limit: 100 } })).data.data.items });
  const workers = useQuery({ queryKey: ['workers'], queryFn: async () => (await api.get<{ data: Page<Worker> }>('/workers', { params: { limit: 100 } })).data.data.items });
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: (): Promise<unknown> => {
      const body = { title: f.title, description: f.description || undefined, type: f.type, priority: f.priority, assignedTo: f.assignedTo || undefined, dueAt: toIso(f.dueAt) };
      return editing ? api.patch(`/maintenance/work-orders/${order!._id}`, body) : api.post('/maintenance/work-orders', { ...body, machine: f.machine });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['work-orders'] }); push({ tone: 'success', title: editing ? 'Work order saved' : 'Work order created' }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(''); save.mutate(); };

  return (
    <Modal title={editing ? `Edit ${order!.woNo}` : 'New work order'} onClose={onClose} wide>
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <Field label="Machine" htmlFor="wo-machine">
          <select id="wo-machine" required disabled={editing} className={input} value={f.machine} onChange={set('machine')}>
            <option value="">Choose a machine</option>
            {machines.data?.map((m) => <option key={m._id} value={m._id}>{m.code} {m.name}</option>)}
          </select>
        </Field>
        <Field label="Title" htmlFor="wo-title"><input id="wo-title" required minLength={3} maxLength={120} className={input} value={f.title} onChange={set('title')} placeholder="Replace spindle bearing" /></Field>
        <Field label="Type" htmlFor="wo-type">
          <select id="wo-type" className={input} value={f.type} onChange={set('type')}><option value="corrective">Corrective (fix)</option><option value="preventive">Preventive</option><option value="inspection">Inspection</option></select>
        </Field>
        <Field label="Priority" htmlFor="wo-priority">
          <select id="wo-priority" className={input} value={f.priority} onChange={set('priority')}>{(['low', 'medium', 'high', 'urgent'] as const).map((p) => <option key={p} value={p}>{p}</option>)}</select>
        </Field>
        <Field label="Assign to" htmlFor="wo-assignee">
          <select id="wo-assignee" className={input} value={f.assignedTo} onChange={set('assignedTo')}>
            <option value="">Unassigned</option>
            {workers.data?.filter((w) => w.status === 'active').map((w) => <option key={w._id} value={w._id}>{w.user.name} ({w.employeeId})</option>)}
          </select>
        </Field>
        <Field label="Due date" htmlFor="wo-due"><input id="wo-due" type="date" className={input} value={f.dueAt} onChange={set('dueAt')} /></Field>
        <div className="md:col-span-2"><Field label="Description" htmlFor="wo-desc"><textarea id="wo-desc" rows={3} maxLength={1000} className={input} value={f.description} onChange={set('description')} /></Field></div>
        {error && <p role="alert" className="text-sm text-red md:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 md:col-span-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={save.isPending}>{editing ? 'Save changes' : 'Create work order'}</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteOrder({ order, onClose }: { order: WorkOrder; onClose: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api.delete(`/maintenance/work-orders/${order._id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['work-orders'] }); onClose(); },
  });
  return (
    <ConfirmDialog
      title={`Delete ${order.woNo}?`} message="The work order and its notes are removed for good." busy={del.isPending}
      error={del.isError ? errorMessage(del.error) : undefined} onConfirm={() => del.mutate()} onCancel={onClose}
    />
  );
}

function SchedulesTab() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  const list = useQuery({ queryKey: ['schedules'], queryFn: async () => (await api.get<{ data: Schedule[] }>('/maintenance/schedules')).data.data });
  const runDue = useMutation({
    mutationFn: async () => (await api.post<{ data: { created: number } }>('/maintenance/schedules/run-due')).data.data,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      push({ tone: 'info', title: r.created ? `${r.created} work order${r.created === 1 ? '' : 's'} opened` : 'Nothing is due yet', body: 'Jobs get their work order three days before they are due.' });
    },
    onError: (e) => push({ tone: 'critical', title: 'Check failed', body: errorMessage(e) }),
  });
  const toggle = useMutation({
    mutationFn: (s: Schedule) => api.patch(`/maintenance/schedules/${s._id}`, { active: !s.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
    onError: (e) => push({ tone: 'critical', title: 'Not updated', body: errorMessage(e) }),
  });
  const items = list.data ?? [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">A work order opens three days before each job is due and the next date moves forward when it is completed.</p>
        <div className="flex gap-2">
          <button className={`${btn.ghost} !py-1.5 text-xs`} disabled={runDue.isPending} onClick={() => runDue.mutate()}><CalendarClock size={13} className="mr-1 inline" />Check now</button>
          <button className={btn.primary} onClick={() => setEditing('new')}><Plus size={15} className="mr-1 inline" />New schedule</button>
        </div>
      </div>
      {list.isLoading && <Skeleton className="h-32" />}
      {!list.isLoading && items.length === 0 && <EmptyState title="No recurring schedules" hint="Add one for jobs like lubrication or filter changes." />}
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
              {['Job', 'Machine', 'Every', 'Next due', 'Active', ''].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {items.map((s) => (
                <tr key={s._id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{s.title}</td>
                  <td className="px-4 py-3"><span className="font-mono text-xs">{s.machine.code}</span> <span className="text-muted">{s.machine.name}</span></td>
                  <td className="px-4 py-3 tabular-nums">{s.everyDays} days</td>
                  <td className="px-4 py-3 tabular-nums">{new Date(s.nextDueAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <input type="checkbox" aria-label={`${s.title} active`} checked={s.active} disabled={toggle.isPending} onChange={() => toggle.mutate(s)} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button aria-label={`Edit ${s.title}`} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => setEditing(s)}><Pencil size={14} /></button>
                    <button aria-label={`Delete ${s.title}`} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-red" onClick={() => setDeleting(s)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ScheduleForm schedule={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteSchedule schedule={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function ScheduleForm({ schedule, onClose }: { schedule?: Schedule; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!schedule;
  const [f, setF] = useState({
    machine: schedule?.machine._id ?? '', title: schedule?.title ?? '', everyDays: String(schedule?.everyDays ?? 30),
    nextDueAt: dateInput(schedule?.nextDueAt), priority: (schedule?.priority ?? 'medium') as WoPriority,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const machines = useQuery({ queryKey: ['machines', 'all'], queryFn: async () => (await api.get<{ data: Page<Machine> }>('/machines', { params: { limit: 100 } })).data.data.items });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: (): Promise<unknown> => {
      const body = { title: f.title, everyDays: Number(f.everyDays), nextDueAt: toIso(f.nextDueAt), priority: f.priority };
      return editing ? api.patch(`/maintenance/schedules/${schedule!._id}`, body) : api.post('/maintenance/schedules', { ...body, machine: f.machine });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['schedules'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal title={editing ? 'Edit schedule' : 'New recurring schedule'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); setError(''); save.mutate(); }} className="grid gap-3">
        <Field label="Machine" htmlFor="sc-machine">
          <select id="sc-machine" required disabled={editing} className={input} value={f.machine} onChange={set('machine')}>
            <option value="">Choose a machine</option>
            {machines.data?.map((m) => <option key={m._id} value={m._id}>{m.code} {m.name}</option>)}
          </select>
        </Field>
        <Field label="Job" htmlFor="sc-title"><input id="sc-title" required minLength={3} maxLength={120} className={input} value={f.title} onChange={set('title')} placeholder="Monthly lubrication" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Repeat every (days)" htmlFor="sc-days"><input id="sc-days" required type="number" min={1} max={730} className={input} value={f.everyDays} onChange={set('everyDays')} /></Field>
          <Field label="Next due" htmlFor="sc-due"><input id="sc-due" required type="date" className={input} value={f.nextDueAt} onChange={set('nextDueAt')} /></Field>
        </div>
        <Field label="Priority" htmlFor="sc-pri">
          <select id="sc-pri" className={input} value={f.priority} onChange={set('priority')}>{(['low', 'medium', 'high', 'urgent'] as const).map((p) => <option key={p} value={p}>{p}</option>)}</select>
        </Field>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={save.isPending}>{editing ? 'Save' : 'Create schedule'}</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteSchedule({ schedule, onClose }: { schedule: Schedule; onClose: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api.delete(`/maintenance/schedules/${schedule._id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['schedules'] }); onClose(); },
  });
  return (
    <ConfirmDialog
      title={`Delete "${schedule.title}"?`} message="No more work orders will be opened for it. Work orders already opened stay." busy={del.isPending}
      error={del.isError ? errorMessage(del.error) : undefined} onConfirm={() => del.mutate()} onCancel={onClose}
    />
  );
}

function ReliabilityTab() {
  const [days, setDays] = useState(30);
  const r = useQuery({
    queryKey: ['analytics', 'reliability', days],
    queryFn: async () => (await api.get<{ data: ReliabilityReport }>('/analytics/reliability', { params: { days } })).data.data,
  });
  const fmt = (v: number | null, unit: string) => (v == null ? '—' : `${v.toLocaleString()} ${unit}`);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted">
          A failure is a trip to offline. Planned maintenance counts as downtime but not as a failure. MTTR is the average time offline per failure; MTBF is running time divided by failures.
        </p>
        <div className="flex items-center gap-2">
          {r.data && (
            <button className={`${btn.ghost} !py-1.5 text-xs`} onClick={() => downloadCsv(`reliability-${days}d.csv`, ['machine', 'name', 'failures', 'downtime_min', 'mttr_min', 'mtbf_hours', 'availability_pct'], r.data!.machines.map((m) => [m.code, m.name, m.failures, m.downtimeMins, m.mttrMins ?? '', m.mtbfHours ?? '', m.availabilityPct]))}>CSV</button>
          )}
          <RangePicker value={days} onChange={setDays} />
        </div>
      </div>
      {r.isLoading && <Skeleton className="h-48" />}
      {r.data && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
              {['Machine', 'Failures', 'Downtime', 'MTTR', 'MTBF', 'Availability'].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {r.data.machines.map((m) => (
                <tr key={m.machineId} className="border-b border-line last:border-0">
                  <td className="px-4 py-3"><span className="font-mono text-xs">{m.code}</span> <span className="text-muted">{m.name}</span></td>
                  <td className={`px-4 py-3 tabular-nums ${m.failures ? 'font-semibold text-red' : 'text-muted'}`}>{m.failures}</td>
                  <td className="px-4 py-3 tabular-nums">{fmtMins(m.downtimeMins)}</td>
                  <td className="px-4 py-3 tabular-nums">{fmt(m.mttrMins, 'min')}</td>
                  <td className="px-4 py-3 tabular-nums">{fmt(m.mtbfHours, 'h')}</td>
                  <td className="px-4 py-3 tabular-nums">{m.availabilityPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
