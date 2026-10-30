import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { api, errorMessage } from '../lib/api';
import type { DowntimeReport, DowntimeRow, Machine, MachineLog, MachineStatus, Page } from '../lib/types';
import {
  btn, ConfirmDialog, EmptyState, Field, fmtDate, fmtMins, input, MlBadge, Modal, PageHeader, RiskBadge, Skeleton, StatusBadge,
} from '../components/ui';
import { axis, fmtDay, tooltip } from '../components/charts';
import MlRiskPanel from '../components/MlRisk';
import TelemetryPanel from '../components/TelemetryPanel';
import RiskAssessmentDialog, { RiskAssessmentSummary } from '../components/RiskAssessment';
import { useAuth } from '../store/auth';
import { useToasts } from '../store/toast';

const STATUSES: MachineStatus[] = ['running', 'idle', 'maintenance', 'offline'];

export default function Machines() {
  const canEdit = useAuth((s) => s.user?.role !== 'worker');
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [status, setStatus] = useState<MachineStatus | ''>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Machine | null>(null);
  const [adding, setAdding] = useState(false);

  const machines = useQuery({
    queryKey: ['machines', status, search],
    queryFn: async () =>
      (await api.get<{ data: Page<Machine> }>('/machines', { params: { status: status || undefined, search: search || undefined, limit: 100 } })).data.data,
  });

  const downtime = useQuery({
    queryKey: ['downtime', 7],
    queryFn: async () => (await api.get<{ data: { rows: DowntimeRow[] } }>('/machines/downtime-summary', { params: { days: 7 } })).data.data.rows,
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, to }: { id: string; to: MachineStatus }) => api.patch(`/machines/${id}/status`, { status: to }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['machines'] }); qc.invalidateQueries({ queryKey: ['downtime'] }); },
    onError: (e) => push({ tone: 'critical', title: 'Status not changed', body: errorMessage(e) }),
  });

  const items = machines.data?.items ?? [];
  const maxDown = Math.max(1, ...(downtime.data ?? []).map((r) => r.downtimeMins));

  return (
    <div>
      <PageHeader
        title="Machines"
        subtitle="Live status, downtime and condition for every machine on the floor."
        actions={canEdit && <button className={btn.primary} onClick={() => setAdding(true)}><Plus size={15} className="mr-1 inline" />Add machine</button>}
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <section className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                aria-label="Search machines" placeholder="Search name, code or type" value={search}
                onChange={(e) => setSearch(e.target.value)} className={`${input} pl-9`}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['', ...STATUSES] as const).map((s) => (
                <button
                  key={s || 'all'} onClick={() => setStatus(s)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    status === s ? 'border-amber bg-amber/15 text-amber' : 'border-line text-muted hover:text-fg'
                  }`}
                >
                  {s || 'all'}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 font-medium">Machine</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">AI risk</th>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 text-right font-medium">Health</th>
                  <th className="px-4 py-3 text-right font-medium">Run hours</th>
                  <th className="px-4 py-3 font-medium">Next service</th>
                </tr>
              </thead>
              <tbody>
                {machines.isLoading && Array.from({ length: 6 }, (_, i) => (
                  <tr key={i}><td colSpan={6} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>
                ))}
                {items.map((m) => (
                  <tr
                    key={m._id} onClick={() => setSelected(m)}
                    className={`cursor-pointer border-b border-line last:border-0 hover:bg-surface-2 ${selected?._id === m._id ? 'bg-surface-2' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{m.name}</div>
                      <div className="font-mono text-xs text-muted">{m.code} · {m.type ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => canEdit && e.stopPropagation()}>
                      {canEdit ? (
                        <select
                          aria-label={`Status of ${m.code}`} value={m.status}
                          onChange={(e) => changeStatus.mutate({ id: m._id, to: e.target.value as MachineStatus })}
                          className="rounded-md border border-line bg-bg px-2 py-1 text-xs capitalize"
                        >
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : <StatusBadge status={m.status} />}
                    </td>
                    <td className="px-4 py-3"><RiskBadge risk={m.riskLevel} /></td>
                    <td className="px-4 py-3"><MlBadge risk={m.mlRisk} probability={m.mlProbability} /></td>
                    <td className={`px-4 py-3 text-right font-mono tabular-nums ${m.healthScore == null ? "text-muted" : m.healthScore >= 75 ? "text-green" : m.healthScore >= 50 ? "text-amber" : "text-red"}`}>{m.healthScore ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{m.runHours.toLocaleString()}</td>
                    <td className="px-4 py-3 text-muted">{m.nextServiceDue ? new Date(m.nextServiceDue).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!machines.isLoading && items.length === 0 && <div className="p-4"><EmptyState title="No machines match" hint="Try a different status or search." /></div>}
          </div>
        </section>

        <aside className="flex min-w-0 flex-col gap-5">
          <div className="rounded-xl border border-line bg-surface p-4">
            <h2 className="font-display text-sm font-semibold">Downtime, last 7 days</h2>
            <div className="mt-3 flex flex-col gap-2.5">
              {downtime.isLoading && <Skeleton className="h-24" />}
              {(downtime.data ?? []).slice(0, 6).map((r) => (
                <div key={r.machineId}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-mono">{r.code}</span>
                    <span className="tabular-nums text-muted">{fmtMins(r.downtimeMins)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-red" style={{ width: `${(r.downtimeMins / maxDown) * 100}%` }} />
                  </div>
                </div>
              ))}
              {downtime.data?.length === 0 && <p className="text-xs text-muted">No downtime recorded.</p>}
            </div>
          </div>
          <MachineDetail machine={items.find((m) => m._id === selected?._id) ?? selected} onDeleted={() => setSelected(null)} />
        </aside>
      </div>

      {adding && <AddMachine onClose={() => setAdding(false)} />}
    </div>
  );
}

function MachineDetail({ machine, onDeleted }: { machine: Machine | null; onDeleted: () => void }) {
  const canAssess = useAuth((s) => s.user?.role !== 'worker');
  const [assessing, setAssessing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const logs = useQuery({
    queryKey: ['machines', 'logs', machine?._id],
    enabled: !!machine,
    queryFn: async () => (await api.get<{ data: Page<MachineLog> }>(`/machines/${machine!._id}/logs`, { params: { limit: 8 } })).data.data.items,
  });

  const trend = useQuery({
    queryKey: ['analytics', 'downtime', 30, machine?._id],
    enabled: !!machine && canAssess,
    queryFn: async () => (await api.get<{ data: DowntimeReport }>('/analytics/downtime', { params: { days: 30, machine: machine!._id } })).data.data,
  });

  if (!machine) {
    return <div className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">Select a machine to see its readings and status history.</div>;
  }
  const readings: [string, string][] = [
    ['Temperature', machine.temperatureC != null ? `${machine.temperatureC} °C` : '—'],
    ['Vibration', machine.vibrationMms != null ? `${machine.vibrationMms} mm/s` : '—'],
    ['Tool wear', machine.toolWearMin != null ? `${machine.toolWearMin} min` : '—'],
    ['Last service', machine.lastServiceAt ? new Date(machine.lastServiceAt).toLocaleDateString() : '—'],
  ];
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold">{machine.name}</h2>
          <p className="font-mono text-xs text-muted">{machine.code}</p>
        </div>
        <StatusBadge status={machine.status} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        {readings.map(([k, v]) => (
          <div key={k}><dt className="text-muted">{k}</dt><dd className="font-mono tabular-nums">{v}</dd></div>
        ))}
      </dl>
      {canAssess && (
        <div className="mt-3 flex gap-2">
          <button className={`${btn.ghost} flex flex-1 items-center justify-center gap-1.5 !py-1.5 text-xs`} onClick={() => setEditing(true)}><Pencil size={12} />Edit</button>
          <button className={`${btn.ghost} flex flex-1 items-center justify-center gap-1.5 !py-1.5 text-xs text-red`} onClick={() => setDeleting(true)}><Trash2 size={12} />Delete</button>
        </div>
      )}
      <TelemetryPanel machine={machine} />
      {canAssess && <RiskAssessmentSummary machine={machine} onOpen={() => setAssessing(true)} />}
      {canAssess && <MlRiskPanel machine={machine} />}
      {assessing && <RiskAssessmentDialog machine={machine} onClose={() => setAssessing(false)} />}
      {editing && <EditMachine machine={machine} onClose={() => setEditing(false)} />}
      {deleting && <DeleteMachine machine={machine} onClose={() => setDeleting(false)} onDeleted={onDeleted} />}
      {canAssess && (
        <section className="mt-4" aria-label="Downtime, last 30 days">
          <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Downtime, last 30 days</h3>
          {trend.isLoading && <Skeleton className="h-24" />}
          {trend.data && (trend.data.totalMinutes === 0
            ? <p className="rounded-lg bg-surface-2 px-3 py-4 text-center text-xs text-muted">No downtime in the last 30 days.</p>
            : (
              <>
                <p className="mb-1 text-xs text-muted">{fmtMins(trend.data.totalMinutes)} lost, {trend.data.byMachine.find((m) => m.machineId === machine._id)?.events ?? 0} events</p>
                <div className="h-24">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trend.data.series} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                      <XAxis dataKey="date" tickFormatter={fmtDay} {...axis} interval="preserveStartEnd" />
                      <Tooltip {...tooltip} labelFormatter={(l) => fmtDay(String(l))} formatter={(v) => [fmtMins(Number(v)), 'Downtime']} />
                      <Bar dataKey="minutes" fill="var(--red)" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            ))}
        </section>
      )}
      <h3 className="mb-2 mt-4 text-[11px] font-medium uppercase tracking-wider text-muted">Status history</h3>
      <ul className="flex flex-col gap-2">
        {logs.isLoading && <Skeleton className="h-16" />}
        {logs.data?.map((l) => (
          <li key={l._id} className="rounded-lg bg-bg px-3 py-2 text-xs">
            <div className="flex justify-between gap-2">
              <span className="capitalize">{l.fromStatus ? `${l.fromStatus} → ` : ''}{l.toStatus}</span>
              <span className="tabular-nums text-muted">{l.durationMins != null ? fmtMins(l.durationMins) : 'ongoing'}</span>
            </div>
            <div className="text-muted">{fmtDate(l.startedAt)}{l.reason ? ` · ${l.reason}` : ''}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddMachine({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', code: '', type: '' });
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => api.post('/machines', { name: form.name, code: form.code, type: form.type || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['machines'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <Modal title="Add machine" onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); create.mutate(); }} className="flex flex-col gap-3">
        <Field label="Name" htmlFor="m-name"><input id="m-name" required className={input} value={form.name} onChange={set('name')} /></Field>
        <Field label="Code" htmlFor="m-code"><input id="m-code" required placeholder="M-111" className={input} value={form.code} onChange={set('code')} /></Field>
        <Field label="Type" htmlFor="m-type"><input id="m-type" placeholder="CNC Lathe" className={input} value={form.type} onChange={set('type')} /></Field>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={create.isPending}>Create</button>
        </div>
      </form>
    </Modal>
  );
}

const dateInput = (iso?: string) => (iso ? iso.slice(0, 10) : '');

function EditMachine({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: machine.name, type: machine.type ?? '', runHours: String(machine.runHours),
    toolWearMin: machine.toolWearMin != null ? String(machine.toolWearMin) : '', temperatureC: machine.temperatureC != null ? String(machine.temperatureC) : '',
    vibrationMms: machine.vibrationMms != null ? String(machine.vibrationMms) : '', lastServiceAt: dateInput(machine.lastServiceAt), nextServiceDue: dateInput(machine.nextServiceDue),
  });
  const [error, setError] = useState('');
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const save = useMutation({
    mutationFn: () => api.patch(`/machines/${machine._id}`, {
      name: f.name, type: f.type || undefined, runHours: num(f.runHours), toolWearMin: num(f.toolWearMin), temperatureC: num(f.temperatureC), vibrationMms: num(f.vibrationMms),
      lastServiceAt: f.lastServiceAt ? new Date(`${f.lastServiceAt}T00:00:00`).toISOString() : undefined,
      nextServiceDue: f.nextServiceDue ? new Date(`${f.nextServiceDue}T00:00:00`).toISOString() : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['machines'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal title={`Edit ${machine.code}`} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); save.mutate(); }} className="grid grid-cols-2 gap-3">
        <Field label="Name" htmlFor="em-name"><input id="em-name" required className={input} value={f.name} onChange={set('name')} /></Field>
        <Field label="Type" htmlFor="em-type"><input id="em-type" className={input} value={f.type} onChange={set('type')} /></Field>
        <Field label="Run hours" htmlFor="em-hours"><input id="em-hours" type="number" min="0" step="any" className={input} value={f.runHours} onChange={set('runHours')} /></Field>
        <Field label="Tool wear (min)" htmlFor="em-wear"><input id="em-wear" type="number" min="0" step="any" className={input} value={f.toolWearMin} onChange={set('toolWearMin')} /></Field>
        <Field label="Temperature (°C)" htmlFor="em-temp"><input id="em-temp" type="number" step="any" className={input} value={f.temperatureC} onChange={set('temperatureC')} /></Field>
        <Field label="Vibration (mm/s)" htmlFor="em-vib"><input id="em-vib" type="number" min="0" step="any" className={input} value={f.vibrationMms} onChange={set('vibrationMms')} /></Field>
        <Field label="Last service" htmlFor="em-last"><input id="em-last" type="date" className={input} value={f.lastServiceAt} onChange={set('lastServiceAt')} /></Field>
        <Field label="Next service due" htmlFor="em-next"><input id="em-next" type="date" className={input} value={f.nextServiceDue} onChange={set('nextServiceDue')} /></Field>
        <p className="col-span-2 text-xs text-muted">The code and status cannot be edited here. Change status from the table so the downtime log stays accurate.</p>
        {error && <p role="alert" className="col-span-2 text-sm text-red">{error}</p>}
        <div className="col-span-2 flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={save.isPending}>Save changes</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteMachine({ machine, onClose, onDeleted }: { machine: Machine; onClose: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const del = useMutation({
    mutationFn: () => api.delete(`/machines/${machine._id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['machines'] }); qc.invalidateQueries({ queryKey: ['downtime'] }); onDeleted(); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <ConfirmDialog
      title={`Delete ${machine.code}?`} busy={del.isPending} error={error} onCancel={onClose} onConfirm={() => del.mutate()}
      message={<>This removes <strong className="text-fg">{machine.name}</strong> and its status history. Assessments already saved for it stay in the database. This cannot be undone.</>}
    />
  );
}
