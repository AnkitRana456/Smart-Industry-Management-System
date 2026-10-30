import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useToasts } from '../store/toast';
import type { MachineStatus, Risk } from '../lib/types';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[1.65rem] font-bold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<MachineStatus, string> = {
  running: 'bg-green/15 text-green',
  idle: 'bg-blue/15 text-blue',
  maintenance: 'bg-amber/15 text-amber',
  offline: 'bg-red/15 text-red',
};

export function StatusBadge({ status }: { status: MachineStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[status]}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

const RISK_STYLE: Record<Risk, string> = {
  LOW: 'bg-green/15 text-green',
  MEDIUM: 'bg-amber/15 text-amber',
  HIGH: 'bg-red/15 text-red',
  INSUFFICIENT_DATA: 'bg-surface-2 text-muted',
};

export function RiskBadge({ risk }: { risk: Risk }) {
  return (
    <span className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-medium ${RISK_STYLE[risk]}`}>
      {risk === 'INSUFFICIENT_DATA' ? 'NO DATA' : risk}
    </span>
  );
}

const ML_STYLE = { Low: 'bg-green/15 text-green', Medium: 'bg-amber/15 text-amber', High: 'bg-red/15 text-red' } as const;

/** Band from the trained statistical model, with its estimated probability. Distinct from the Gemini RiskBadge. */
export function MlBadge({ risk, probability }: { risk?: 'Low' | 'Medium' | 'High'; probability?: number }) {
  if (!risk) return <span className="font-mono text-[11px] text-muted">—</span>;
  return (
    <span className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-medium ${ML_STYLE[risk]}`} title="Trained statistical model (synthetic training data)">
      {risk.toUpperCase()}{probability != null ? ` ${Math.round(probability * 100)}%` : ''}
    </span>
  );
}

export const btn = {
  primary: 'rounded-lg bg-gradient-to-b from-amber to-amber/85 px-3.5 py-2 text-sm font-semibold text-black shadow-md shadow-amber/20 transition hover:brightness-110 active:translate-y-px disabled:opacity-50 disabled:shadow-none',
  ghost: 'rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-fg shadow-sm shadow-black/5 transition hover:border-amber/40 hover:bg-surface-2 active:translate-y-px disabled:opacity-50',
};

export const input = 'w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm placeholder:text-muted/70';

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} />;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose; // callers pass inline functions; the effect below must run once per open
  // Esc closes, focus moves into the dialog and returns to the opener, background stops scrolling.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!box.current?.contains(document.activeElement)) box.current?.querySelector<HTMLElement>('input,select,textarea,button:not([aria-label="Close"])')?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; opener?.focus?.(); };
  }, []);
  return (
    <div className="anim-fade fixed inset-0 z-40 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div
        ref={box} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: 'var(--shadow-pop)' }}
        className={`anim-pop max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-line bg-surface p-6 ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** In-app confirmation for destructive actions. The browser's confirm() is blocked in some contexts. */
export function ConfirmDialog({
  title, message, confirmLabel = 'Delete', busy, error, onConfirm, onCancel,
}: { title: string; message: ReactNode; confirmLabel?: string; busy?: boolean; error?: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="text-sm text-muted">{message}</div>
      {error && <p role="alert" className="mt-3 text-sm text-red">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={btn.ghost} onClick={onCancel} autoFocus>Cancel</button>
        <button type="button" className="rounded-lg bg-red px-3.5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50" disabled={busy} onClick={onConfirm}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

const TOAST_TONE = {
  info: 'border-blue/40', success: 'border-green/40', warning: 'border-amber/50', critical: 'border-red/50',
} as const;

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`anim-slide pointer-events-auto rounded-xl border bg-surface p-3 shadow-xl ${TOAST_TONE[t.tone]}`}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold">{t.title}</p>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-muted hover:text-fg"><X size={14} /></button>
          </div>
          {t.body && <p className="mt-0.5 text-xs text-muted">{t.body}</p>}
        </div>
      ))}
    </div>
  );
}

export function fmtMins(m: number) {
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

export function fmtDate(iso?: string) {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}
