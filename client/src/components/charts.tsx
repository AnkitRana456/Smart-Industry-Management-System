import type { ReactNode } from 'react';
import { Skeleton } from './ui';

export const fmtDay = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const axis = {
  tick: { fill: 'var(--muted)', fontSize: 11 },
  axisLine: { stroke: 'var(--border)' },
  tickLine: false as const,
};

export const grid = { stroke: 'var(--border)', strokeDasharray: '3 3', vertical: false as const };

export const tooltip = {
  contentStyle: {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--fg)',
  },
  labelStyle: { color: 'var(--muted)', marginBottom: 2 },
  itemStyle: { color: 'var(--fg)' },
  cursor: { fill: 'var(--surface-2)', opacity: 0.6 },
};

export function ChartCard({
  title, subtitle, actions, loading, empty, children, className = '',
}: {
  title: string; subtitle?: string; actions?: ReactNode; loading?: boolean; empty?: string; children: ReactNode; className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-line bg-surface p-4 ${className}`}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {loading ? <Skeleton className="h-56" /> : empty ? <p className="grid h-56 place-items-center text-sm text-muted">{empty}</p> : children}
    </section>
  );
}

export function RangePicker({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {[7, 14, 30].map((d) => (
        <button
          key={d} role="radio" aria-checked={value === d} onClick={() => onChange(d)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${value === d ? 'bg-amber text-black' : 'text-muted hover:text-fg'}`}
        >
          {d} days
        </button>
      ))}
    </div>
  );
}
