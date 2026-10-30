import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import type { Health, Machine, SensorReading } from '../lib/types';
import { axis, grid, tooltip } from './charts';
import { Skeleton } from './ui';

const tone = (score: number) => (score >= 75 ? 'text-green' : score >= 50 ? 'text-amber' : 'text-red');
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** Live sensor chart and the explained health score for one machine. */
export default function TelemetryPanel({ machine }: { machine: Machine }) {
  const readings = useQuery({
    queryKey: ['telemetry', 'readings', machine._id],
    queryFn: async () => (await api.get<{ data: SensorReading[] }>(`/machines/${machine._id}/telemetry`, { params: { hours: 2 } })).data.data,
  });
  const health = useQuery({
    queryKey: ['telemetry', 'health', machine._id],
    queryFn: async () => (await api.get<{ data: Health }>(`/machines/${machine._id}/health-score`)).data.data,
  });
  const h = health.data;
  const rows = readings.data ?? [];
  const last = rows.at(-1);

  return (
    <section className="mt-4" aria-label="Telemetry and health">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted">Health score</h3>
        {h && <span className={`font-display text-2xl font-bold tabular-nums ${tone(h.score)}`} aria-label={`Health score ${h.score} out of 100`}>{h.score}<span className="text-xs font-normal text-muted"> / 100</span></span>}
      </div>
      {health.isLoading && <Skeleton className="h-10" />}
      {h && (h.factors.length === 0
        ? <p className="text-xs text-muted">No concerns right now.</p>
        : (
          <ul className="mb-2 flex flex-col gap-1 text-xs">
            {h.factors.map((f) => <li key={f.label} className="flex justify-between gap-2"><span className="text-muted">{f.label}</span><span className="font-mono tabular-nums text-red">−{f.penalty}</span></li>)}
          </ul>
        ))}

      <h3 className="mb-1 mt-3 text-[11px] font-medium uppercase tracking-wider text-muted">Live sensors, last 2 hours</h3>
      {readings.isLoading && <Skeleton className="h-36" />}
      {!readings.isLoading && rows.length === 0 && (
        <p className="rounded-lg bg-surface-2 px-3 py-4 text-center text-xs text-muted">No readings yet. Start the simulator, or send one to POST /api/telemetry.</p>
      )}
      {rows.length > 0 && (
        <>
          <dl className="mb-1 grid grid-cols-4 gap-2 text-center text-xs">
            {([['Temp', last?.temperatureC, '°C'], ['Vibr.', last?.vibrationMms, 'mm/s'], ['RPM', last?.rpm, ''], ['Power', last?.powerKw, 'kW']] as const).map(([k, v, u]) => (
              <div key={k} className="rounded-lg bg-surface-2 py-1.5"><dt className="text-[10px] text-muted">{k}</dt><dd className="font-mono tabular-nums">{v ?? '—'}{v != null && u ? ` ${u}` : ''}</dd></div>
            ))}
          </dl>
          <div className="h-36" role="img" aria-label="Line chart of temperature and vibration over the last two hours">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="at" tickFormatter={clock} {...axis} interval="preserveStartEnd" minTickGap={40} />
                <YAxis yAxisId="t" {...axis} domain={['auto', 'auto']} />
                <YAxis yAxisId="v" orientation="right" {...axis} domain={[0, 'auto']} width={28} />
                <Tooltip {...tooltip} labelFormatter={(l) => clock(String(l))} />
                {h && <ReferenceLine yAxisId="t" y={h.thresholds.temperatureC.warn} stroke="var(--amber)" strokeDasharray="4 4" />}
                <Line yAxisId="t" dataKey="temperatureC" name="Temp °C" stroke="var(--amber)" dot={false} strokeWidth={2} isAnimationActive={false} />
                <Line yAxisId="v" dataKey="vibrationMms" name="Vibration mm/s" stroke="var(--blue)" dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {h && <p className="text-[10px] text-muted">Dashed line: temperature warning limit ({h.thresholds.temperatureC.warn} °C). Vibration warns at {h.thresholds.vibrationMms.warn} mm/s.</p>}
        </>
      )}
    </section>
  );
}
