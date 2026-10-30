import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import type { HandoverNote, Machine, Page } from '../lib/types';
import { btn, EmptyState, Field, fmtDate, input, PageHeader, Skeleton } from '../components/ui';
import { useAuth } from '../store/auth';
import { useToasts } from '../store/toast';

export default function Handover() {
  const { user } = useAuth();
  const staff = user?.role !== 'worker';
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [closed, setClosed] = useState(false);
  const [text, setText] = useState('');
  const [priority, setPriority] = useState<'info' | 'important'>('info');
  const [machine, setMachine] = useState('');

  const notes = useQuery({
    queryKey: ['handover', closed],
    queryFn: async () => (await api.get<{ data: Page<HandoverNote> }>('/handover', { params: { resolved: closed ? 'true' : 'false', limit: 50 } })).data.data.items,
  });
  const machines = useQuery({
    queryKey: ['machines', 'all'],
    queryFn: async () => (await api.get<{ data: Page<Machine> }>('/machines', { params: { limit: 100 } })).data.data.items,
  });

  const done = () => qc.invalidateQueries({ queryKey: ['handover'] });
  const fail = (title: string) => (e: unknown) => push({ tone: 'critical', title, body: errorMessage(e) });
  const add = useMutation({
    mutationFn: () => api.post('/handover', { text, priority, machine: machine || undefined }),
    onSuccess: () => { setText(''); setPriority('info'); setMachine(''); done(); push({ tone: 'success', title: 'Note left for the next shift' }); },
    onError: fail('Note not saved'),
  });
  const resolve = useMutation({ mutationFn: (id: string) => api.patch(`/handover/${id}/resolve`), onSuccess: done, onError: fail('Could not close the note') });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/handover/${id}`), onSuccess: done, onError: fail('Could not delete the note') });

  const submit = (e: FormEvent) => { e.preventDefault(); if (text.trim().length >= 2) add.mutate(); };
  const items = notes.data ?? [];

  return (
    <div>
      <PageHeader title="Shift handover" subtitle="Leave notes for the next shift: a leak, a part on order, a machine to watch. Close a note once it is dealt with." />

      <form onSubmit={submit} className="mb-5 rounded-2xl border border-line bg-surface p-4">
        <Field label="What should the next shift know?" htmlFor="ho-text">
          <textarea id="ho-text" rows={2} maxLength={500} className={`${input} resize-none`} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Press C is leaking oil, keep an eye on it" />
        </Field>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Machine (optional)" htmlFor="ho-machine">
            <select id="ho-machine" className={`${input} !w-auto`} value={machine} onChange={(e) => setMachine(e.target.value)}>
              <option value="">General</option>
              {machines.data?.map((m) => <option key={m._id} value={m._id}>{m.code} {m.name}</option>)}
            </select>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={priority === 'important'} onChange={(e) => setPriority(e.target.checked ? 'important' : 'info')} />
            Mark as important
          </label>
          <span className="ml-auto pb-2 text-xs text-muted">{text.length}/500</span>
          <button className={btn.primary} disabled={add.isPending || text.trim().length < 2}>Leave note</button>
        </div>
      </form>

      <div role="tablist" className="mb-3 flex gap-1 border-b border-line">
        {([[false, 'Open'], [true, 'Closed']] as const).map(([v, l]) => (
          <button key={l} role="tab" aria-selected={closed === v} onClick={() => setClosed(v)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${closed === v ? 'border-amber text-amber' : 'border-transparent text-muted hover:text-fg'}`}>{l}</button>
        ))}
      </div>

      {notes.isLoading && <Skeleton className="h-24" />}
      {!notes.isLoading && items.length === 0 && <EmptyState title={closed ? 'No closed notes' : 'Nothing to hand over'} hint={closed ? undefined : 'Open notes show up here for everyone on the next shift.'} />}
      <ul className="flex flex-col gap-2.5">
        {items.map((n) => (
          <li key={n._id} className={`flex items-start justify-between gap-3 rounded-xl border bg-surface p-4 ${n.priority === 'important' && !n.resolved ? 'border-amber/60' : 'border-line'}`}>
            <div className="min-w-0">
              <p className="text-sm">
                {n.priority === 'important' && <span className="mr-2 rounded-full bg-amber/15 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber">Important</span>}
                {n.text}
              </p>
              <p className="mt-1 text-xs text-muted">
                {n.authorName ?? 'Someone'} · {fmtDate(n.createdAt)}{n.machine && <> · {n.machine.code} {n.machine.name}</>}
              </p>
            </div>
            {!n.resolved && (
              <div className="flex shrink-0 gap-1">
                {(staff || n.author === user?.id) && (
                  <button className={`${btn.ghost} flex items-center gap-1 !py-1 text-xs`} disabled={resolve.isPending} onClick={() => resolve.mutate(n._id)}><Check size={13} />Close</button>
                )}
                {staff && <button aria-label="Delete note" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-red" onClick={() => remove.mutate(n._id)}><Trash2 size={14} /></button>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
