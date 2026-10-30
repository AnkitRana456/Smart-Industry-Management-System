import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useToasts } from '../store/toast';

const DOT = { info: 'bg-blue', success: 'bg-green', warning: 'bg-amber', critical: 'bg-red' } as const;

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
};

export default function NotificationBell() {
  const { notices, markAllRead, clearNotices } = useToasts();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = notices.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen(!open);
          if (!open) {
            markAllRead();
            // Fire and forget: the badge already cleared, and the server copy catches up.
            if (unread > 0) api.patch('/notifications/read-all').catch(() => undefined);
          }
        }}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open}
        className="relative grid size-9 place-items-center rounded-lg border border-line bg-surface-2 text-muted hover:text-fg"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-red px-1 text-[10px] font-semibold leading-4 text-white">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-11 z-30 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
          <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="font-display text-sm font-semibold">Notifications</h2>
            {notices.length > 0 && <button onClick={clearNotices} className="text-xs text-muted hover:text-fg">Clear all</button>}
          </header>
          <ul className="max-h-80 overflow-y-auto">
            {notices.map((n) => (
              <li key={n.id} className="flex gap-3 border-b border-line px-4 py-2.5 last:border-0">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[n.tone]}`} aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body && <p className="text-xs text-muted">{n.body}</p>}
                  <p className="mt-0.5 font-mono text-[10px] text-muted">{ago(n.at)}</p>
                </div>
              </li>
            ))}
            {notices.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">Nothing new. Alerts and status changes show up here as they happen.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
