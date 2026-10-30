import { useQuery } from '@tanstack/react-query';
import { RefreshCw, SendHorizontal, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import type { AnalystAnswer, KeyFigure, WeeklySummary } from '../lib/types';
import { btn, input, PageHeader, Skeleton } from '../components/ui';

const PRESETS = [
  ['LAST_7_DAYS', 'Last 7 days'], ['TODAY', 'Today'], ['YESTERDAY', 'Yesterday'], ['THIS_WEEK', 'This week'],
  ['LAST_WEEK', 'Last week'], ['THIS_MONTH', 'This month'], ['LAST_MONTH', 'Last month'], ['LAST_30_DAYS', 'Last 30 days'],
] as const;

const SUGGESTIONS = [
  'Which machine had the most downtime?',
  'Which items are below their reorder level?',
  'How many units did we produce?',
  'Which machines are rated high risk?',
  'How was attendance?',
  'Which work orders are overdue?',
  'Which machine failed most often?',
];

const SOURCES: Record<string, string> = {
  getDowntimeSummary: 'Downtime logs', getProductionSummary: 'Production output', getInventoryStatus: 'Inventory',
  getMachineStatus: 'Machine status', getSavedMaintenanceAssessments: 'Saved assessments', getWorkerAttendance: 'Attendance',
  getMaintenanceWorkOrders: 'Work orders', getReliability: 'Reliability (MTBF/MTTR)',
};

interface Turn {
  id: number;
  question: string;
  preset: string;
  state: 'loading' | 'done' | 'error';
  answer?: AnalystAnswer;
  error?: string;
}

/** A range key is a preset name, or CUSTOM|start|end for the date pickers. */
const rangeBody = (key: string) => {
  if (key.startsWith('CUSTOM|')) {
    const [, startDate, endDate] = key.split('|');
    return { startDate, endDate };
  }
  return { preset: key };
};

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const period = (p: { start: string; end: string }) => `${day(p.start)} to ${day(p.end)}`;

function Figures({ items }: { items: KeyFigure[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Key figures">
      {items.map((f) => (
        <li key={`${f.label}-${f.value}`} className="rounded-lg border border-line bg-bg px-3 py-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted">{f.label}</p>
          <p className="font-display text-base font-semibold tabular-nums">{f.value.toLocaleString()} <span className="text-xs font-normal text-muted">{f.unit}</span></p>
        </li>
      ))}
    </ul>
  );
}

export default function Analyst() {
  const status = useQuery({ queryKey: ['ai', 'status'], queryFn: async () => (await api.get<{ data: { configured: boolean } }>('/ai/status')).data.data });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [preset, setPreset] = useState<string>('LAST_7_DAYS');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const custom = preset === 'CUSTOM';
  const rangeOk = !custom || (Boolean(customStart) && Boolean(customEnd) && customEnd >= customStart);
  const rangeKey = custom ? `CUSTOM|${customStart}|${customEnd}` : preset;
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns]);

  async function send(text: string, usePreset = rangeKey, replaceId?: number) {
    const q = text.trim();
    if (q.length < 3 || busy || !rangeOk) return;
    const id = replaceId ?? nextId.current++;
    setBusy(true);
    setQuestion('');
    setTurns((t) => (replaceId ? t.map((x) => (x.id === id ? { ...x, state: 'loading', error: undefined } : x)) : [...t, { id, question: q, preset: usePreset, state: 'loading' }]));
    try {
      const { data } = await api.post<{ data: AnalystAnswer }>('/ai/ask', { question: q, timeRange: rangeBody(usePreset) });
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, state: 'done', answer: data.data } : x)));
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, state: 'error', error: errorMessage(e) } : x)));
    } finally {
      setBusy(false);
    }
  }

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void send(question); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(question); }
  };

  const label = (p: string) => (p.startsWith('CUSTOM|') ? p.split('|').slice(1).join(' to ') : PRESETS.find(([k]) => k === p)?.[1] ?? p);

  return (
    <div>
      <PageHeader title="AI Analyst" subtitle="Ask about machines, downtime, production, stock, assessments and attendance. Figures come from the database; the model only explains them." />

      {status.data && !status.data.configured && (
        <div role="status" className="mb-4 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-amber">
          AI is not configured on the server. Add <code className="font-mono">GEMINI_API_KEY</code> and <code className="font-mono">GEMINI_MODEL</code> to <code className="font-mono">server/.env</code> and restart it.
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <section className="flex min-h-[520px] min-w-0 flex-col rounded-2xl border border-line bg-surface" aria-label="Conversation">
          <div className="flex-1 space-y-5 overflow-y-auto p-4 md:p-5" style={{ maxHeight: 'calc(100vh - 330px)' }}>
            {turns.length === 0 && (
              <div className="py-8 text-center">
                <div className="mx-auto mb-3 grid size-11 place-items-center rounded-xl bg-amber/15 text-amber"><Sparkles size={20} /></div>
                <p className="font-display text-lg font-semibold">What would you like to know?</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted">Pick a period, then ask in plain language. Every answer lists the data it used.</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => void send(s)} disabled={busy || !rangeOk} className="rounded-full border border-line bg-bg px-3.5 py-1.5 text-xs text-muted transition-colors hover:border-amber/60 hover:text-fg disabled:opacity-50">{s}</button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t) => (
              <div key={t.id} className="space-y-2.5">
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-amber/15 px-4 py-2.5 text-sm">
                  {t.question}
                  <p className="mt-0.5 text-[10px] text-muted">{label(t.preset)}</p>
                </div>

                {t.state === 'loading' && <div className="max-w-[90%] space-y-2 rounded-2xl rounded-bl-md border border-line bg-bg p-4" aria-live="polite"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /><p className="text-xs text-muted">Looking up the data…</p></div>}

                {t.state === 'error' && (
                  <div role="alert" className="max-w-[90%] rounded-2xl rounded-bl-md border border-red/40 bg-red/10 p-4 text-sm">
                    <p className="font-medium text-red">Could not answer</p>
                    <p className="mt-1 text-muted">{t.error}</p>
                    <button className={`${btn.ghost} mt-2 !py-1 text-xs`} onClick={() => void send(t.question, t.preset, t.id)} disabled={busy}>Try again</button>
                  </div>
                )}

                {t.state === 'done' && t.answer && <AnswerCard a={t.answer} />}
              </div>
            ))}
            <div ref={bottom} />
          </div>

          <form onSubmit={onSubmit} className="border-t border-line p-3 md:p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <label htmlFor="range" className="text-xs text-muted">Period</label>
              <select id="range" value={preset} onChange={(e) => setPreset(e.target.value)} className={`${input} !w-auto !py-1 text-xs`}>
                {PRESETS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                <option value="CUSTOM">Custom dates…</option>
              </select>
              {custom && (
                <>
                  <input aria-label="Start date" type="date" max={customEnd || undefined} value={customStart} onChange={(e) => setCustomStart(e.target.value)} className={`${input} !w-auto !py-1 text-xs`} />
                  <span className="text-xs text-muted">to</span>
                  <input aria-label="End date" type="date" min={customStart || undefined} value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className={`${input} !w-auto !py-1 text-xs`} />
                </>
              )}
              <span className="text-[11px] text-muted">{custom && !rangeOk ? 'Pick a start and end date (up to 92 days).' : 'Weeks run Monday to Sunday. Times follow the factory timezone.'}</span>
            </div>
            <div className="flex items-end gap-2">
              <div className="relative flex-1">
                <textarea
                  id="question" aria-label="Your question" rows={2} maxLength={500} value={question} onKeyDown={onKey}
                  onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question about the plant…" className={`${input} resize-none pr-14`}
                />
                <span className="pointer-events-none absolute bottom-2 right-3 font-mono text-[10px] text-muted">{question.length}/500</span>
              </div>
              <button type="submit" className={`${btn.primary} flex h-[58px] items-center gap-1.5 px-4`} disabled={busy || question.trim().length < 3 || !rangeOk} aria-label="Send question">
                <SendHorizontal size={16} />
              </button>
            </div>
          </form>
        </section>

        <WeeklyPanel disabled={status.data ? !status.data.configured : false} />
      </div>
    </div>
  );
}

function AnswerCard({ a }: { a: AnalystAnswer }) {
  return (
    <article className={`max-w-[92%] rounded-2xl rounded-bl-md border p-4 ${a.needsClarification ? 'border-blue/40 bg-blue/10' : 'border-line bg-bg'}`}>
      {a.needsClarification && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-blue">Needs a little more detail</p>}
      <p className="text-sm leading-relaxed">{a.answer}</p>
      <Figures items={a.keyFigures} />
      {!a.needsClarification && (
        <p className="mt-3 text-[11px] text-muted">Period: {period(a.reportingPeriod)} ({a.reportingPeriod.timezone})</p>
      )}
      {a.limitations.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-muted">{a.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
      )}
      {a.evidence.length > 0 && (
        <p className="mt-2 border-t border-line pt-2 font-mono text-[10px] text-muted">
          Based on {a.evidence.map((e) => `${SOURCES[e.source] ?? e.source} (${e.recordCount} record${e.recordCount === 1 ? '' : 's'})`).join(', ')}
        </p>
      )}
    </article>
  );
}

function WeeklyPanel({ disabled }: { disabled: boolean }) {
  const [data, setData] = useState<WeeklySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load(refresh: boolean) {
    setLoading(true);
    setError('');
    try {
      setData((await api.get<{ data: WeeklySummary }>('/ai/weekly-summary', { params: { refresh: refresh ? 'true' : undefined } })).data.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="min-w-0 self-start rounded-2xl border border-line bg-surface p-4" aria-label="Weekly summary">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold">Weekly summary</h2>
          <p className="text-xs text-muted">Last 7 days, written from calculated figures.</p>
        </div>
        {data && <button className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50" aria-label="Regenerate summary" disabled={loading} onClick={() => void load(true)}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>}
      </header>

      {!data && !loading && !error && (
        <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
          <p className="text-sm text-muted">Generate a short summary of downtime, output, stock and machine condition.</p>
          <button className={`${btn.primary} mt-3`} disabled={disabled} onClick={() => void load(false)}>Generate summary</button>
        </div>
      )}
      {loading && <div className="space-y-2" aria-live="polite"><Skeleton className="h-4" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-2/3" /></div>}
      {error && (
        <div role="alert" className="rounded-lg border border-red/40 bg-red/10 p-3 text-sm">
          <p className="text-muted">{error}</p>
          <button className={`${btn.ghost} mt-2 !py-1 text-xs`} onClick={() => void load(false)}>Try again</button>
        </div>
      )}

      {data && !loading && (
        <div>
          <p className="text-sm leading-relaxed">{data.summary}</p>
          {data.highlights.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-4 text-sm">{data.highlights.map((h) => <li key={h}>{h}</li>)}</ul>}
          {!data.verified && <p className="mt-3 rounded-md bg-amber/10 px-2.5 py-1.5 text-xs text-amber">The written summary could not be checked against the data, so only the figures are shown.</p>}
          <Figures items={data.keyFigures.slice(0, 8)} />
          <p className="mt-3 font-mono text-[10px] text-muted">{period(data.reportingPeriod)} · generated {new Date(data.generatedAt).toLocaleString()}{data.cached ? ' · saved copy' : ''}</p>
        </div>
      )}
    </aside>
  );
}
