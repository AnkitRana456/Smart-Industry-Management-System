import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import type { Assessment, Machine } from '../lib/types';
import { btn, fmtDate, Modal, RiskBadge, Skeleton } from './ui';

const DISCLAIMER = 'Preliminary AI assessment from recorded readings. It is not a validated failure prediction. Review it with a technician before acting.';

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
};

export function RiskAssessmentSummary({ machine, onOpen }: { machine: Machine; onOpen: () => void }) {
  return (
    <div className="mt-4 rounded-lg border border-line bg-bg p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted">AI condition assessment</p>
          <div className="mt-1 flex items-center gap-2"><RiskBadge risk={machine.riskLevel} />
            <span className="text-xs text-muted">{machine.lastAssessedAt ? ago(machine.lastAssessedAt) : 'Not assessed yet'}</span>
          </div>
        </div>
        <button className={`${btn.ghost} flex items-center gap-1.5 !px-3 !py-1.5 text-xs`} onClick={onOpen}><Sparkles size={13} />Open</button>
      </div>
    </div>
  );
}

export default function RiskAssessmentDialog({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ['assessments', machine._id],
    queryFn: async () => (await api.get<{ data: { items: Assessment[] } }>(`/machines/${machine._id}/assessments`, { params: { limit: 8 } })).data.data.items,
  });

  const run = useMutation({
    mutationFn: async (force: boolean) =>
      (await api.post<{ data: Assessment }>(`/machines/${machine._id}/assess-risk`, { forceNewAssessment: force })).data.data,
    onSuccess: (a) => {
      setSelected(a.assessmentId);
      qc.invalidateQueries({ queryKey: ['assessments', machine._id] });
      qc.invalidateQueries({ queryKey: ['machines'] });
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const items = history.data ?? [];
  const shown = items.find((a) => a.assessmentId === selected) ?? (run.data && !selected ? run.data : items[0]);

  return (
    <Modal title={`AI risk assessment: ${machine.code}`} onClose={onClose} wide>
      <p className="mb-4 rounded-lg bg-amber/10 px-3 py-2 text-xs text-amber">{DISCLAIMER}</p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{machine.name} · <span className="capitalize">{machine.status}</span></p>
        <button className={`${btn.primary} flex items-center gap-1.5`} disabled={run.isPending} onClick={() => run.mutate(false)}>
          <Sparkles size={14} />{run.isPending ? 'Assessing…' : shown ? 'Assess again' : 'Assess machine risk'}
        </button>
      </div>

      {run.isPending && (
        <div className="mb-4 space-y-2" aria-live="polite">
          <Skeleton className="h-5 w-40" /><Skeleton className="h-16" /><p className="text-xs text-muted">Reading machine data and asking the model. This usually takes a few seconds.</p>
        </div>
      )}

      {run.isError && (
        <div role="alert" className="mb-4 rounded-lg border border-red/40 bg-red/10 p-3 text-sm">
          <p className="font-medium text-red">The assessment could not be completed</p>
          <p className="mt-1 text-muted">{errorMessage(run.error)}</p>
          <p className="mt-1 text-xs text-muted">Nothing was saved. The previous assessment, if any, is still shown below.</p>
          <button className={`${btn.ghost} mt-2 !py-1 text-xs`} onClick={() => run.mutate(false)}>Try again</button>
        </div>
      )}

      {run.data?.reused && !run.isPending && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          <span>Showing the assessment from {ago(run.data.assessedAt)}. The machine data has not changed since.</span>
          <button className="font-medium text-amber hover:underline" onClick={() => run.mutate(true)}>Run a new one anyway</button>
        </div>
      )}

      {history.isLoading && <Skeleton className="h-40" />}
      {!history.isLoading && !shown && !run.isPending && (
        <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">No assessment yet. Run one to see the condition summary, evidence and recommended checks.</p>
      )}
      {shown && !run.isPending && <AssessmentCard a={shown} />}

      {items.length > 1 && (
        <section className="mt-5" aria-label="Assessment history">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">History</h3>
          <ul className="flex flex-col gap-1">
            {items.map((a) => (
              <li key={a.assessmentId}>
                <button
                  onClick={() => setSelected(a.assessmentId)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-surface-2 ${a.assessmentId === shown?.assessmentId ? 'bg-surface-2' : ''}`}
                >
                  <span className="tabular-nums text-muted">{fmtDate(a.assessedAt)}</span>
                  <RiskBadge risk={a.riskLevel} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  );
}

function AssessmentCard({ a }: { a: Assessment }) {
  return (
    <article className="rounded-xl border border-line bg-bg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <RiskBadge risk={a.riskLevel} />
          <span className="text-xs text-muted">{fmtDate(a.assessedAt)}</span>
        </div>
        {a.alertId && <Link to="/alerts" className="rounded-md bg-red/15 px-2 py-0.5 text-[11px] font-medium text-red hover:underline">Alert raised</Link>}
      </div>

      <p className="mt-3 text-sm leading-relaxed">{a.assessmentSummary}</p>

      {a.observedConditions.length > 0 && (
        <Block title="What stands out">
          <ul className="list-disc space-y-1 pl-4 text-sm">{a.observedConditions.map((c) => <li key={c}>{c}</li>)}</ul>
        </Block>
      )}

      {a.evidenceUsed.length > 0 && (
        <Block title="Evidence used">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
            {a.evidenceUsed.map((e) => (
              <div key={e.field}><dt className="font-mono text-muted">{e.field}</dt><dd className="font-mono tabular-nums">{String(e.value ?? '—')}{e.unit ? ` ${e.unit}` : ''}</dd></div>
            ))}
          </dl>
        </Block>
      )}

      {a.recommendedActions.length > 0 && (
        <Block title="Suggested human review">
          <ul className="list-disc space-y-1 pl-4 text-sm">{a.recommendedActions.map((r) => <li key={r}>{r}</li>)}</ul>
        </Block>
      )}

      <details className="mt-4 text-xs text-muted">
        <summary className="cursor-pointer font-medium text-fg">Limitations ({a.limitations.length})</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">{a.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
      </details>

      <p className="mt-4 border-t border-line pt-3 font-mono text-[10px] text-muted">
        {a.modelId ? `Model ${a.modelId}` : 'Rules check, no model used'} · prompt {a.promptVersion}
      </p>
    </article>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-4"><h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">{title}</h4>{children}</section>;
}
