import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Gauge } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { Machine, MlPrediction, MlStatus } from '../lib/types';
import type { SensorRisk } from '../lib/types';
import { btn, fmtDate, MlBadge, Skeleton } from './ui';

const PROB_BAR = { Low: 'bg-green', Medium: 'bg-amber', High: 'bg-red' } as const;

/**
 * The trained statistical model, shown next to (and never mixed with) the Gemini assessment.
 * The panel states what it was trained on every time, because that is what limits how far to trust it.
 */
export default function MlRiskPanel({ machine }: { machine: Machine }) {
  const qc = useQueryClient();
  const [about, setAbout] = useState(false);

  const status = useQuery({
    queryKey: ['ml', 'status'], staleTime: 30_000,
    queryFn: async () => (await api.get<{ data: MlStatus }>('/ml/status')).data.data,
  });
  const history = useQuery({
    queryKey: ['ml', 'history', machine._id],
    enabled: !!status.data?.enabled,
    queryFn: async () => (await api.get<{ data: MlPrediction[] }>(`/machines/${machine._id}/ml-predictions`)).data.data,
  });
  const run = useMutation({
    mutationFn: async () => (await api.post<{ data: MlPrediction }>(`/machines/${machine._id}/ml-predict`)).data.data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ml', 'history', machine._id] });
      qc.invalidateQueries({ queryKey: ['machines'] });
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const sensor = useMutation({
    mutationFn: async () => (await api.post<{ data: SensorRisk }>(`/machines/${machine._id}/sensor-risk`)).data.data,
  });

  if (!status.data?.enabled) return null;
  const latest = history.data?.[0];
  const s = status.data;

  return (
    <section className="mt-3 rounded-lg border border-line bg-bg p-3" aria-label="Statistical risk model">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Statistical risk model</p>
          <p className="text-[11px] text-muted">Trained on synthetic data</p>
        </div>
        <button className={`${btn.ghost} flex items-center gap-1.5 !px-3 !py-1.5 text-xs`} disabled={run.isPending || !s.reachable} onClick={() => run.mutate()}>
          <Gauge size={13} />{run.isPending ? 'Scoring…' : latest ? 'Score again' : 'Score now'}
        </button>
      </div>

      {!s.reachable && <p role="status" className="mt-2 text-xs text-amber">The model service is not reachable right now. The rest of the app is unaffected.</p>}
      {history.isLoading && <Skeleton className="mt-3 h-12" />}
      {run.isError && <p role="alert" className="mt-2 text-xs text-red">{errorMessage(run.error)}</p>}
      {run.data?.reused && !run.isPending && <p role="status" className="mt-2 text-[11px] text-muted">This machine's data has not changed since the last score, so the saved result is shown.</p>}

      {latest && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <MlBadge risk={latest.risk} probability={latest.probability} />
            <span className="text-[11px] text-muted">{fmtDate(latest.predictedAt)}</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-surface-2" role="img" aria-label={`Estimated 30-day failure probability ${Math.round(latest.probability * 100)} percent`}>
            <div className={`h-full rounded-full ${PROB_BAR[latest.risk]}`} style={{ width: `${Math.max(2, latest.probability * 100)}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-muted">Estimated chance of a failure in the next 30 days, within the synthetic training world. Not a prediction for this real machine.</p>

          <ul className="mt-2.5 flex flex-col gap-1">
            {latest.topFactors.map((f) => (
              <li key={f.feature} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5">
                  {f.direction === 'raises' ? <ArrowUp size={12} className="text-red" aria-label="raises risk" /> : <ArrowDown size={12} className="text-green" aria-label="lowers risk" />}
                  {f.label}
                </span>
                <span className="font-mono tabular-nums text-muted">{f.value} {f.unit}</span>
              </li>
            ))}
          </ul>

          {latest.warnings.map((w) => <p key={w} className="mt-2 rounded-md bg-amber/10 px-2 py-1.5 text-[11px] text-amber">{w}</p>)}
        </div>
      )}
      {!history.isLoading && !latest && !run.isPending && <p className="mt-2 text-xs text-muted">Not scored yet. Scoring uses the machine's readings, days since service and recent downtime.</p>}

      {s.sensor && (
        <div className="mt-3 border-t border-line pt-3" aria-label="Sensor model">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Sensor model</p>
              <p className="text-[11px] text-muted">Trained on the public AI4I dataset (synthetic)</p>
            </div>
            <button className={`${btn.ghost} !px-3 !py-1.5 text-xs`} disabled={sensor.isPending || !s.reachable} onClick={() => sensor.mutate()}>{sensor.isPending ? 'Checking…' : 'Check'}</button>
          </div>
          {sensor.isError && <p role="alert" className="mt-2 text-xs text-red">{errorMessage(sensor.error)}</p>}
          {sensor.data && (
            <div className="mt-2">
              <div className="flex items-center justify-between gap-2">
                <MlBadge risk={sensor.data.risk} probability={sensor.data.probability} />
                <span className="text-[11px] text-muted">reading {fmtDate(sensor.data.readingAt)}</span>
              </div>
              <p className="mt-1 font-mono text-[11px] text-muted">{sensor.data.inputs.rpm} rpm · {sensor.data.inputs.torqueNm} Nm{sensor.data.torqueIsDerived && ' (from power)'} · wear {sensor.data.inputs.toolWearMin} min</p>
              {sensor.data.warnings.map((w) => <p key={w} className="mt-2 rounded-md bg-amber/10 px-2 py-1.5 text-[11px] text-amber">{w}</p>)}
            </div>
          )}
          {s.sensor.metrics && <p className="mt-2 text-[11px] text-muted">On held-out AI4I rows: ROC-AUC {s.sensor.metrics.rocAuc} (tool wear alone: {s.sensor.metrics.references.toolWearAloneRocAuc}). That measures the dataset, not this plant. A second opinion only: it raises no alerts.</p>}
        </div>
      )}

      <button className="mt-3 text-[11px] font-medium text-muted underline-offset-2 hover:text-fg hover:underline" aria-expanded={about} onClick={() => setAbout(!about)}>
        {about ? 'Hide model details' : 'About this model'}
      </button>
      {about && (
        <div className="mt-2 space-y-2 text-[11px] text-muted">
          <p className="font-mono">{s.modelVersion} · {s.algorithm} · trained {s.trainedAt ? new Date(s.trainedAt).toLocaleDateString() : '?'}</p>
          {s.metrics && (
            <p>
              On held-out synthetic data: ROC-AUC {s.metrics.rocAuc} (the best possible from these inputs is {s.metrics.references.generatorCeilingRocAuc}), Brier {s.metrics.brier}, failure base rate {Math.round(s.metrics.baseRate * 100)}%.
              Bands: Medium from {Math.round((s.bands?.mediumFrom ?? 0) * 100)}%, High from {Math.round((s.bands?.highFrom ?? 0) * 100)}%.
            </p>
          )}
          <ul className="list-disc space-y-1 pl-4">{s.limitations?.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
