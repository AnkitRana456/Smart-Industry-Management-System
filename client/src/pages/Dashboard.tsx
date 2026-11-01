import { useQuery } from '@tanstack/react-query';
import { Boxes, Cog, Factory, Package, Timer, Users, type LucideIcon } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import type { Alert, DowntimeReport, Machine, MachineStatus, OutputReport, Overview, Page } from '../lib/types';
import { axis, ChartCard, fmtDay, grid, tooltip } from '../components/charts';
import SimulatorControl from '../components/SimulatorControl';
import { useOrderProjections, useStockCover } from '../hooks/useInsights';
import { fmtDate, fmtMins, PageHeader, Skeleton } from '../components/ui';
import { useAuth } from '../store/auth';

const STATUS_TILE: Record<MachineStatus, string> = {
  running: 'border-green/40 bg-green/10',
  idle: 'border-blue/40 bg-blue/10',
  maintenance: 'border-amber/50 bg-amber/10',
  offline: 'border-red/50 bg-red/10',
};
const STATUS_TEXT: Record<MachineStatus, string> = { running: 'text-green', idle: 'text-blue', maintenance: 'text-amber', offline: 'text-red' };
const STRIPE = { critical: 'bg-red', warning: 'bg-amber', info: 'bg-blue' } as const;

export default function Dashboard() {
  const role = useAuth((s) => s.user?.role);
  if (role === 'worker') return <Navigate to="/workers" replace />;
  return <StaffDashboard />;
}

function StaffDashboard() {
  const role = useAuth((s) => s.user?.role);
  const overview = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: async () => (await api.get<{ data: Overview }>('/analytics/overview')).data.data,
  });
  const machines = useQuery({
    queryKey: ['machines', 'all'],
    queryFn: async () => (await api.get<{ data: Page<Machine> }>('/machines', { params: { limit: 100 } })).data.data.items,
  });
  const alerts = useQuery({
    queryKey: ['alerts', 'dashboard'],
    queryFn: async () => (await api.get<{ data: Page<Alert> }>('/alerts', { params: { status: 'open', limit: 6 } })).data.data.items,
  });
  const output = useQuery({
    queryKey: ['analytics', 'output', 7],
    queryFn: async () => (await api.get<{ data: OutputReport }>('/analytics/production-output', { params: { days: 7 } })).data.data,
  });
  const downtime = useQuery({
    queryKey: ['analytics', 'downtime', 7],
    queryFn: async () => (await api.get<{ data: DowntimeReport }>('/analytics/downtime', { params: { days: 7 } })).data.data,
  });

  const cover = useStockCover();
  const projections = useOrderProjections();
  const runningOut = (cover.data ?? []).filter((c) => c.enoughHistory && c.daysOfCover != null && c.daysOfCover <= 14).slice(0, 4);
  const lateOrders = (projections.data ?? []).filter((p) => p.status === 'late').slice(0, 4);
  const o = overview.data;
  const present = o ? o.attendance.present + o.attendance.late : 0;

  const tiles: { label: string; value: string; note: string; tone: string; to: string; icon: LucideIcon }[] = o ? [
    { label: 'Machines running', value: `${o.machines.running}/${o.machines.total}`, note: o.machines.offline ? `${o.machines.offline} offline` : 'None offline', tone: o.machines.total === 0 || o.machines.running / o.machines.total >= 0.8 ? 'text-green' : o.machines.running / o.machines.total >= 0.5 ? 'text-amber' : 'text-red', to: '/machines', icon: Cog },
    { label: 'Downtime today', value: fmtMins(o.today.downtimeMins), note: `${o.machines.maintenance} in maintenance`, tone: 'text-amber', to: '/analytics', icon: Timer },
    { label: 'Orders in progress', value: String(o.orders.in_progress), note: o.orders.bottlenecks ? `${o.orders.bottlenecks} bottleneck${o.orders.bottlenecks > 1 ? 's' : ''}` : `${o.orders.pending} pending`, tone: o.orders.bottlenecks ? 'text-amber' : 'text-blue', to: '/production', icon: Factory },
    { label: 'Units today', value: o.today.unitsProduced.toLocaleString(), note: `${o.orders.completed} order${o.orders.completed === 1 ? '' : 's'} completed`, tone: 'text-cyan', to: '/analytics', icon: Package },
    { label: 'Workers in', value: `${present}/${o.attendance.total}`, note: o.attendance.late ? `${o.attendance.late} late` : `${o.attendance.absent} not in yet`, tone: 'text-green', to: '/workers', icon: Users },
    { label: 'Low stock', value: String(o.inventory.lowStock), note: `of ${o.inventory.items} items`, tone: o.inventory.lowStock ? 'text-red' : 'text-green', to: '/inventory', icon: Boxes },
  ] : [];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Everything on the floor right now. Numbers refresh as changes happen."
        actions={(
          <>
            {role === 'admin' && <SimulatorControl />}
            {o && (
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
                <span className="size-2 animate-pulse rounded-full bg-green" /> Live
              </span>
            )}
          </>
        )}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {overview.isLoading && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className="group relative overflow-hidden rounded-xl border border-line bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-amber/50">
            <t.icon size={30} strokeWidth={1.25} className={`absolute right-2 top-2 opacity-[0.18] transition-opacity group-hover:opacity-25 ${t.tone}`} aria-hidden />
            <p className="pr-7 text-[11px] uppercase tracking-wider text-muted">{t.label}</p>
            <p className={`mt-1 font-display text-3xl font-bold tabular-nums ${t.tone}`}>{t.value}</p>
            <p className="mt-0.5 text-xs text-muted">{t.note}</p>
          </Link>
        ))}
      </div>

      <div className="mb-5 grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="min-w-0 rounded-2xl border border-line bg-surface p-4" aria-label="Machine floor">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Machine floor</h2>
            <div className="hidden gap-3 text-[11px] text-muted sm:flex">
              {(['running', 'idle', 'maintenance', 'offline'] as const).map((s) => (
                <span key={s} className="inline-flex items-center gap-1 capitalize"><span className={`size-2 rounded-full bg-current ${STATUS_TEXT[s]}`} />{s}</span>
              ))}
            </div>
          </header>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {machines.isLoading && Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-20" />)}
            {machines.data?.map((m) => (
              <Link key={m._id} to="/machines" className={`rounded-xl border p-3 transition-transform hover:-translate-y-0.5 ${STATUS_TILE[m.status]}`} title={`${m.name}: ${m.status}`}>
                <p className="font-mono text-sm font-semibold">{m.code}</p>
                <p className="truncate text-xs text-muted">{m.type ?? m.name}</p>
                <p className={`mt-2 text-[11px] font-semibold uppercase tracking-wide ${STATUS_TEXT[m.status]}`}>{m.status}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-line bg-surface p-4" aria-label="Open alerts">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Open alerts</h2>
            <Link to="/alerts" className="text-xs text-amber hover:underline">View all{o ? ` (${o.alerts.open})` : ''}</Link>
          </header>
          <div className="flex flex-col gap-2">
            {alerts.isLoading && <Skeleton className="h-40" />}
            {alerts.data?.map((a) => (
              <div key={a._id} className="flex overflow-hidden rounded-lg bg-bg">
                <div className={`w-1 shrink-0 ${STRIPE[a.severity]}`} aria-hidden />
                <div className="min-w-0 px-3 py-2">
                  <p className="text-xs leading-snug">{a.message}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted">{fmtDate(a.createdAt)}</p>
                </div>
              </div>
            ))}
            {alerts.data?.length === 0 && <p className="py-10 text-center text-sm text-muted">All clear. No open alerts.</p>}
          </div>
        </section>
      </div>

      {(cover.data || projections.data) && (
        <section className="mb-5 grid gap-4 rounded-2xl border border-line bg-surface p-4 md:grid-cols-2" aria-label="Forecasts">
          <div>
            <h2 className="mb-2 font-display text-sm font-semibold">Running out soon <span className="text-[11px] font-normal text-muted">forecast from usage</span></h2>
            {runningOut.length === 0 ? <p className="text-sm text-muted">Nothing is forecast to run out in the next two weeks.</p> : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {runningOut.map((c) => (
                  <li key={c.itemId} className="flex justify-between gap-2"><span>{c.name}</span><span className="font-mono tabular-nums text-amber">~{c.daysOfCover} d{(c.suggestedOrderQty ?? 0) > 0 && <span className="text-muted"> · order ~{c.suggestedOrderQty?.toLocaleString()} {c.unit}</span>}</span></li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2 className="mb-2 font-display text-sm font-semibold">Orders likely to be late <span className="text-[11px] font-normal text-muted">at the current pace</span></h2>
            {lateOrders.length === 0 ? <p className="text-sm text-muted">No in-progress order is projected to miss its due date.</p> : (
              <ul className="flex flex-col gap-1.5 text-sm">
                {lateOrders.map((p) => (
                  <li key={p.orderId} className="flex justify-between gap-2"><span>{p.orderNo} {p.product}</span><span className="font-mono text-xs tabular-nums text-red">{p.expectedFinish ?? '60+ d'} vs due {p.dueDate?.slice(0, 10)}</span></li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Units produced" subtitle="Last 7 days" loading={output.isLoading} empty={output.data?.totalUnits === 0 ? 'No output recorded in this period.' : undefined}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={output.data?.series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="date" tickFormatter={fmtDay} {...axis} />
                <YAxis {...axis} />
                <Tooltip {...tooltip} labelFormatter={(l) => fmtDay(String(l))} />
                <Bar dataKey="units" name="Units" fill="var(--blue)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Downtime" subtitle="Minutes lost per day, last 7 days" loading={downtime.isLoading} empty={downtime.data?.totalMinutes === 0 ? 'No downtime in this period.' : undefined}>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={downtime.data?.series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="date" tickFormatter={fmtDay} {...axis} />
                <YAxis {...axis} />
                <Tooltip {...tooltip} labelFormatter={(l) => fmtDay(String(l))} />
                <Bar dataKey="minutes" name="Minutes" fill="var(--red)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>
    </div>
  );
}
