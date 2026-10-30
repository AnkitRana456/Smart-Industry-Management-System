import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import type { AttendanceReport, DowntimeReport, OeeReport, ParetoReport, InventoryItem, OutputReport, Page, StockReport } from '../lib/types';
import AttendanceHeatmap from '../components/AttendanceHeatmap';
import { axis, ChartCard, fmtDay, grid, RangePicker, tooltip } from '../components/charts';
import { btn, fmtMins, input, PageHeader } from '../components/ui';

const ExportBtn = ({ onClick }: { onClick: () => void }) => (
  <button className={`${btn.ghost} flex items-center gap-1.5 !px-2.5 !py-1 text-xs`} onClick={onClick}><Download size={13} />CSV</button>
);

export default function Analytics() {
  const [days, setDays] = useState(7);
  const [item, setItem] = useState('');

  const downtime = useQuery({
    queryKey: ['analytics', 'downtime', days],
    queryFn: async () => (await api.get<{ data: DowntimeReport }>('/analytics/downtime', { params: { days } })).data.data,
  });
  const output = useQuery({
    queryKey: ['analytics', 'output', days],
    queryFn: async () => (await api.get<{ data: OutputReport }>('/analytics/production-output', { params: { days } })).data.data,
  });
  const items = useQuery({
    queryKey: ['inventory', 'all'],
    queryFn: async () => (await api.get<{ data: Page<InventoryItem> }>('/inventory', { params: { limit: 100 } })).data.data.items,
  });
  const stockId = item || items.data?.[0]?._id || '';
  const stock = useQuery({
    queryKey: ['analytics', 'stock', days, stockId],
    enabled: !!stockId,
    queryFn: async () => (await api.get<{ data: StockReport }>('/analytics/stock-trends', { params: { days, item: stockId } })).data.data,
  });

  const attendance = useQuery({
    queryKey: ['analytics', 'attendance', days],
    queryFn: async () => (await api.get<{ data: AttendanceReport }>('/analytics/worker-attendance', { params: { days } })).data.data,
  });

  const pareto = useQuery({
    queryKey: ['analytics', 'pareto', days],
    queryFn: async () => (await api.get<{ data: ParetoReport }>('/analytics/downtime-pareto', { params: { days } })).data.data,
  });
  const oee = useQuery({
    queryKey: ['analytics', 'oee', days],
    queryFn: async () => (await api.get<{ data: OeeReport }>('/analytics/oee', { params: { days } })).data.data,
  });

  const d = downtime.data;
  const a = attendance.data;
  const pr = pareto.data;
  const oe = oee.data;
  const maxMins = Math.max(1, ...(d?.byMachine ?? []).map((m) => m.minutes));
  const s = stock.data;

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Downtime, output and stock movement, calculated from the logs."
        actions={(
          <div className="flex items-center gap-2 print:hidden">
            <button className={`${btn.ghost} flex items-center gap-1.5 !py-1.5 text-xs`} onClick={() => window.print()} title="Opens the print dialog; choose Save as PDF">
              <Printer size={13} />Print / PDF
            </button>
            <RangePicker value={days} onChange={setDays} />
          </div>
        )}
      />

      <h2 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-muted">Downtime</h2>
      <div className="mb-6 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <ChartCard
          title="Minutes lost per day" subtitle={d ? `${fmtMins(d.totalMinutes)} in total` : undefined}
          loading={downtime.isLoading} empty={d?.totalMinutes === 0 ? 'No downtime in this period.' : undefined}
          actions={d && <ExportBtn onClick={() => downloadCsv(`downtime-by-day-${days}d.csv`, ['date', 'minutes'], d.series.map((r) => [r.date, r.minutes]))} />}
        >
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d?.series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="date" tickFormatter={fmtDay} {...axis} interval="preserveStartEnd" />
                <YAxis {...axis} />
                <Tooltip {...tooltip} labelFormatter={(l) => fmtDay(String(l))} />
                <Bar dataKey="minutes" name="Minutes" fill="var(--red)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="By machine" subtitle="Availability = share of the period not lost" loading={downtime.isLoading}
          actions={d && <ExportBtn onClick={() => downloadCsv(`downtime-by-machine-${days}d.csv`, ['code', 'name', 'minutes', 'events', 'availability_pct'], d.byMachine.map((m) => [m.code, m.name, m.minutes, m.events, m.availabilityPct]))} />}
        >
          <ul className="flex max-h-60 flex-col gap-3 overflow-y-auto pr-1">
            {d?.byMachine.map((m) => (
              <li key={m.machineId}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                  <span><span className="font-mono font-medium">{m.code}</span> <span className="text-muted">{m.name}</span></span>
                  <span className="tabular-nums text-muted">{fmtMins(m.minutes)} · <span className={m.availabilityPct < 95 ? 'text-amber' : 'text-green'}>{m.availabilityPct}%</span></span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-2"><div className="h-full rounded-full bg-red" style={{ width: `${(m.minutes / maxMins) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>

      {d && d.byReason.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2" aria-label="Top downtime reasons">
          {d.byReason.map((r) => (
            <span key={r.reason} className="rounded-full border border-line bg-surface px-3 py-1 text-xs">
              {r.reason} <span className="ml-1 tabular-nums text-muted">{fmtMins(r.minutes)} · {r.events}×</span>
            </span>
          ))}
        </div>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <ChartCard
          title="Downtime Pareto" subtitle="Which reasons account for most of the lost time"
          loading={pareto.isLoading} empty={pr?.totalMinutes === 0 ? 'No downtime in this period.' : undefined}
          actions={pr && <ExportBtn onClick={() => downloadCsv(`downtime-pareto-${days}d.csv`, ['reason', 'minutes', 'events', 'cumulative_pct'], pr.reasons.map((r) => [r.reason, r.minutes, r.events, r.cumulativePct]))} />}
        >
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={pr?.reasons} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="reason" {...axis} interval={0} tick={{ ...axis.tick, fontSize: 10 }} />
                <YAxis yAxisId="m" {...axis} />
                <YAxis yAxisId="p" orientation="right" domain={[0, 100]} unit="%" {...axis} />
                <Tooltip {...tooltip} />
                <Bar yAxisId="m" dataKey="minutes" name="Minutes lost" fill="var(--red)" radius={[4, 4, 0, 0]} />
                <Line yAxisId="p" dataKey="cumulativePct" name="Cumulative %" type="monotone" stroke="var(--cyan)" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="Equipment effectiveness" subtitle="OEE = availability x performance x quality" loading={oee.isLoading}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {([['Availability', oe?.availabilityPct], ['Quality', oe?.qualityPct], ['Performance', oe?.performancePct], ['OEE', oe?.oeePct]] as const).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-surface-2 p-3"><dt className="text-xs text-muted">{k}</dt><dd className="font-display text-2xl font-bold tabular-nums">{v == null ? 'n/a' : `${v}%`}</dd></div>
            ))}
          </dl>
          {oe && <p className="mt-3 text-xs text-muted">{oe.unitsProduced.toLocaleString()} units made, {oe.scrapUnits.toLocaleString()} scrapped, {oe.defectsFound.toLocaleString()} defects found in {oe.unitsInspected.toLocaleString()} inspected. {oe.note}</p>}
        </ChartCard>
      </div>

      <h2 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-muted">Production</h2>
      <div className="mb-6 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <ChartCard
          title="Units produced per day" subtitle={output.data ? `${output.data.totalUnits.toLocaleString()} units in total` : undefined}
          loading={output.isLoading} empty={output.data?.totalUnits === 0 ? 'No output recorded in this period.' : undefined}
          actions={output.data && <ExportBtn onClick={() => downloadCsv(`output-by-day-${days}d.csv`, ['date', 'units'], output.data!.series.map((r) => [r.date, r.units]))} />}
        >
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={output.data?.series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="date" tickFormatter={fmtDay} {...axis} interval="preserveStartEnd" />
                <YAxis {...axis} />
                <Tooltip {...tooltip} labelFormatter={(l) => fmtDay(String(l))} />
                <Bar dataKey="units" name="Units" fill="var(--blue)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="By product" loading={output.isLoading}
          actions={output.data && <ExportBtn onClick={() => downloadCsv(`output-by-product-${days}d.csv`, ['product', 'units'], output.data!.byProduct.map((p) => [p.product, p.units]))} />}
        >
          <ul className="flex flex-col gap-3">
            {output.data?.byProduct.map((p) => (
              <li key={p.product}>
                <div className="mb-1 flex justify-between text-xs"><span>{p.product}</span><span className="tabular-nums text-muted">{p.units.toLocaleString()}</span></div>
                <div className="h-1.5 rounded-full bg-surface-2"><div className="h-full rounded-full bg-blue" style={{ width: `${(p.units / Math.max(1, output.data!.byProduct[0].units)) * 100}%` }} /></div>
              </li>
            ))}
            {output.data?.byProduct.length === 0 && <li className="py-10 text-center text-sm text-muted">No output yet.</li>}
          </ul>
        </ChartCard>
      </div>

      <h2 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-muted">Workforce</h2>
      <div className="mb-6 grid gap-4">
        <ChartCard
          title="Attendance per day"
          subtitle={a ? (a.attendancePct == null ? 'No attendance recorded yet' : `${a.attendancePct}% of expected attendances on days the plant was open`) : undefined}
          loading={attendance.isLoading}
          actions={a && <ExportBtn onClick={() => downloadCsv(`attendance-${days}d.csv`, ['employee_id', 'name', ...a.keys], a.rows.map((w) => [w.employeeId, w.name, ...a.keys.map((k) => w.days[k])]))} />}
        >
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={a?.series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="date" tickFormatter={fmtDay} {...axis} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip {...tooltip} labelFormatter={(l) => fmtDay(String(l))} />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--muted)' }} />
                <Bar dataKey="present" name="Present" stackId="a" fill="var(--green)" />
                <Bar dataKey="late" name="Late" stackId="a" fill="var(--amber)" />
                <Bar dataKey="absent" name="Absent" stackId="a" fill="var(--red)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="Attendance by worker" subtitle="Each square is one day" loading={attendance.isLoading} className="!min-h-0">
          {a && <AttendanceHeatmap report={a} />}
        </ChartCard>
      </div>

      <h2 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-muted">Stock</h2>
      <ChartCard
        title="Stock level and movement"
        subtitle={s?.item ? `${s.item.name}: ${s.totalIn.toLocaleString()} ${s.item.unit} in, ${s.totalOut.toLocaleString()} out` : 'Pick an item'}
        loading={stock.isLoading || items.isLoading}
        actions={(
          <div className="flex items-center gap-2">
            <select aria-label="Inventory item" className={`${input} !w-auto !py-1 text-xs`} value={stockId} onChange={(e) => setItem(e.target.value)}>
              {items.data?.map((i) => <option key={i._id} value={i._id}>{i.name} ({i.sku})</option>)}
            </select>
            {s && <ExportBtn onClick={() => downloadCsv(`stock-${s.item?.sku ?? 'all'}-${days}d.csv`, ['date', 'in', 'out', 'end_of_day_level'], s.series.map((r) => [r.date, r.in, r.out, r.level ?? '']))} />}
          </div>
        )}
      >
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={s?.series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid {...grid} />
              <XAxis dataKey="date" tickFormatter={fmtDay} {...axis} interval="preserveStartEnd" />
              <YAxis {...axis} />
              <Tooltip {...tooltip} labelFormatter={(l) => fmtDay(String(l))} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--muted)' }} />
              <Bar dataKey="in" name="Received" fill="var(--green)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="out" name="Issued" fill="var(--amber)" radius={[3, 3, 0, 0]} />
              <Line dataKey="level" name="Level" type="monotone" stroke="var(--cyan)" strokeWidth={2} dot={false} />
              {s?.item && <ReferenceLine y={s.item.reorderThreshold} stroke="var(--red)" strokeDasharray="5 4" label={{ value: 'Reorder level', fill: 'var(--red)', fontSize: 10, position: 'insideTopRight' }} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  );
}
