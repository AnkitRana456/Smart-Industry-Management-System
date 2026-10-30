import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import type { LeaveRequest, LeaveStatus, Page } from '../lib/types';
import { btn, EmptyState, Field, input, Skeleton } from './ui';
import { useToasts } from '../store/toast';

const STYLE: Record<LeaveStatus, string> = {
  pending: 'bg-amber/15 text-amber', approved: 'bg-green/15 text-green', rejected: 'bg-red/15 text-red', cancelled: 'bg-surface-2 text-muted',
};
const today = () => new Date().toLocaleDateString('en-CA');

/** Leave requests. Workers file and withdraw their own; managers review everyone's. */
export default function LeavePanel({ staff }: { staff: boolean }) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [reason, setReason] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const list = useQuery({
    queryKey: ['leave'],
    queryFn: async () => (await api.get<{ data: Page<LeaveRequest> }>('/leave', { params: { limit: 50 } })).data.data.items,
  });
  const done = () => { qc.invalidateQueries({ queryKey: ['leave'] }); qc.invalidateQueries({ queryKey: ['analytics'] }); };
  const request = useMutation({
    mutationFn: () => api.post('/leave', { from, to, reason: reason || undefined }),
    onSuccess: () => { setReason(''); setError(''); done(); push({ tone: 'success', title: 'Leave requested', body: 'Your manager has been notified.' }); },
    onError: (e) => setError(errorMessage(e)),
  });
  const review = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => api.patch(`/leave/${id}/review`, { status, note: note[id] || undefined }),
    onSuccess: done,
    onError: (e) => push({ tone: 'warning', title: 'Not updated', body: errorMessage(e) }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.patch(`/leave/${id}/cancel`),
    onSuccess: done,
    onError: (e) => push({ tone: 'warning', title: 'Not withdrawn', body: errorMessage(e) }),
  });
  const items = list.data ?? [];

  return (
    <section aria-label="Leave" className="mb-5">
      {!staff && (
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); request.mutate(); }} className="mb-4 rounded-2xl border border-line bg-surface p-4">
          <h2 className="mb-3 font-display text-sm font-semibold">Request leave</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
            <Field label="From" htmlFor="lv-from"><input id="lv-from" type="date" required min={today()} className={input} value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
            <Field label="To" htmlFor="lv-to"><input id="lv-to" type="date" required min={from} className={input} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <Field label="Reason (optional)" htmlFor="lv-reason"><input id="lv-reason" maxLength={300} className={input} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <button className={btn.primary} disabled={request.isPending}>Send request</button>
          </div>
          {error && <p role="alert" className="mt-2 text-sm text-red">{error}</p>}
        </form>
      )}

      {staff && <h2 className="mb-2 font-display text-sm font-semibold">Leave requests</h2>}
      {!staff && <h2 className="mb-2 font-display text-sm font-semibold">My leave</h2>}
      {list.isLoading && <Skeleton className="h-20" />}
      {!list.isLoading && items.length === 0 && <EmptyState title="No leave requests" hint={staff ? 'Requests from workers show up here for approval.' : undefined} />}
      <ul className="flex flex-col gap-2.5">
        {items.map((r) => (
          <li key={r._id} className="rounded-xl border border-line bg-surface p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {staff && <p className="text-sm font-medium">{r.worker.user.name} <span className="font-mono text-xs text-muted">{r.worker.employeeId}</span></p>}
                <p className="text-sm tabular-nums">{r.from}{r.to !== r.from && <> to {r.to}</>} <span className="text-muted">({r.days} day{r.days === 1 ? '' : 's'})</span></p>
                {r.reason && <p className="text-xs text-muted">{r.reason}</p>}
                {r.reviewNote && <p className="text-xs text-muted">Reviewer: {r.reviewNote}</p>}
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STYLE[r.status]}`}>{r.status}</span>
            </div>
            {r.status === 'pending' && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {staff && (
                  <>
                    <input aria-label={`Note for ${r.worker.user.name}`} maxLength={300} placeholder="Note (optional)" className={`${input} !w-48 !py-1 text-xs`} value={note[r._id] ?? ''} onChange={(e) => setNote({ ...note, [r._id]: e.target.value })} />
                    <button className={`${btn.primary} !py-1 text-xs`} disabled={review.isPending} onClick={() => review.mutate({ id: r._id, status: 'approved' })}>Approve</button>
                    <button className={`${btn.ghost} !py-1 text-xs`} disabled={review.isPending} onClick={() => review.mutate({ id: r._id, status: 'rejected' })}>Reject</button>
                  </>
                )}
                {!staff && <button className={`${btn.ghost} !py-1 text-xs`} disabled={cancel.isPending} onClick={() => cancel.mutate(r._id)}>Withdraw</button>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
