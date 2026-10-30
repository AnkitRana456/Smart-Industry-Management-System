import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import type { Alert, AlertExplanation, Page } from '../lib/types';
import { btn, EmptyState, fmtDate, PageHeader, Skeleton } from '../components/ui';
import { useAuth } from '../store/auth';
import { useToasts } from '../store/toast';

const STRIPE = { critical: 'bg-red', warning: 'bg-amber', info: 'bg-blue' } as const;
const FILTERS = ['open', 'acknowledged', 'resolved'] as const;

export default function Alerts() {
  const canEdit = useAuth((s) => s.user?.role !== 'worker');
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('open');

  const alerts = useQuery({
    queryKey: ['alerts', status],
    queryFn: async () => (await api.get<{ data: Page<Alert> }>('/alerts', { params: { status, limit: 50 } })).data.data,
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'acknowledge' | 'resolve' }) => api.patch(`/alerts/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
    onError: (e) => push({ tone: 'critical', title: 'Action failed', body: errorMessage(e) }),
  });

  const [explained, setExplained] = useState<Record<string, AlertExplanation>>({});
  const [explaining, setExplaining] = useState<string | null>(null);
  const explain = useMutation({
    mutationFn: async (id: string) => { setExplaining(id); return { id, data: (await api.post<{ data: AlertExplanation }>(`/ai/explain-alert/${id}`)).data.data }; },
    onSuccess: ({ id, data }) => setExplained((m) => ({ ...m, [id]: data })),
    onError: (e) => push({ tone: 'warning', title: 'Could not explain this alert', body: errorMessage(e) }),
    onSettled: () => setExplaining(null),
  });

  const items = alerts.data?.items ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Alerts" subtitle="Machine outages and low-stock warnings appear here as they happen." />
      <div className="mb-4 flex gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f} onClick={() => setStatus(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${status === f ? 'border-amber bg-amber/15 text-amber' : 'border-line text-muted hover:text-fg'}`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        {alerts.isLoading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16" />)}
        {items.map((a) => (
          <article key={a._id} className="flex flex-wrap overflow-hidden rounded-xl border border-line bg-surface">
            <div className={`w-1.5 shrink-0 ${STRIPE[a.severity]}`} aria-hidden />
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <p className="text-sm">{a.message}</p>
                <p className="mt-1 font-mono text-[11px] text-muted">{a.type} · {a.severity} · {fmtDate(a.createdAt)}</p>
              </div>
              {canEdit && (
                <div className="flex gap-2">
                  <button className={`${btn.ghost} flex items-center gap-1.5`} disabled={explaining === a._id} onClick={() => explain.mutate(a._id)}><Sparkles size={13} />{explaining === a._id ? 'Explaining…' : 'Explain'}</button>
                </div>
              )}
              {canEdit && a.status !== 'resolved' && (
                <div className="flex gap-2">
                  {a.status === 'open' && <button className={btn.ghost} onClick={() => act.mutate({ id: a._id, action: 'acknowledge' })}>Acknowledge</button>}
                  <button className={btn.ghost} onClick={() => act.mutate({ id: a._id, action: 'resolve' })}>Resolve</button>
                </div>
              )}
            </div>
            {explained[a._id] && (
              <div className="basis-full border-t border-line bg-surface-2/50 px-4 py-3 text-sm" aria-label="AI explanation">
                <p>{explained[a._id].explanation}</p>
                {explained[a._id].possibleReasons.length > 0 && <><p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-muted">Possible reasons</p><ul className="list-disc pl-5 text-xs text-muted">{explained[a._id].possibleReasons.map((r) => <li key={r}>{r}</li>)}</ul></>}
                {explained[a._id].suggestedChecks.length > 0 && <><p className="mt-2 text-[11px] font-medium uppercase tracking-wider text-muted">Suggested checks</p><ul className="list-disc pl-5 text-xs text-muted">{explained[a._id].suggestedChecks.map((r) => <li key={r}>{r}</li>)}</ul></>}
                <p className="mt-2 text-[11px] text-muted">{explained[a._id].limitation}</p>
              </div>
            )}
          </article>
        ))}
        {!alerts.isLoading && items.length === 0 && <EmptyState title={`No ${status} alerts`} hint="New alerts show up here in real time." />}
      </div>
    </div>
  );
}
