import {
  Activity, Bell, Bot, Boxes, ClipboardList, ShoppingCart, Cog, Factory, LayoutDashboard, LineChart, LogOut, Menu, Moon, ShieldCheck, Sun, Users, Wrench, X,
} from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { useAuth, type Role } from '../store/auth';
import { useTheme } from '../store/theme';
import NotificationBell from './NotificationBell';
import { Toaster } from './ui';

interface NavItem { to: string; label: string; workerLabel?: string; icon: ComponentType<{ size?: number }>; roles: Role[] }

const ALL: Role[] = ['admin', 'manager', 'worker'];
const STAFF: Role[] = ['admin', 'manager'];

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: STAFF },
  { to: '/machines', label: 'Machines', icon: Cog, roles: ALL },
  { to: '/workers', label: 'Workers', workerLabel: 'My day', icon: Users, roles: ALL },
  { to: '/production', label: 'Production', icon: Factory, roles: ALL },
  { to: '/inventory', label: 'Inventory', icon: Boxes, roles: ALL },
  { to: '/purchasing', label: 'Purchasing', icon: ShoppingCart, roles: STAFF },
  { to: '/maintenance', label: 'Maintenance', icon: Wrench, roles: ALL },
  { to: '/handover', label: 'Handover', icon: ClipboardList, roles: ALL },
  { to: '/analytics', label: 'Analytics', icon: LineChart, roles: STAFF },
  { to: '/analyst', label: 'AI Analyst', icon: Bot, roles: STAFF },
  { to: '/alerts', label: 'Alerts', icon: Bell, roles: ALL },
  { to: '/users', label: 'Users', icon: ShieldCheck, roles: STAFF },
];

/** Label of the nav entry the current path belongs to, as the signed-in role sees it. */
function usePageTitle() {
  const { pathname } = useLocation();
  const role = useAuth((s) => s.user?.role);
  const hit = NAV.filter((n) => (n.to === '/' ? pathname === '/' : pathname.startsWith(n.to))).sort((a, b) => b.to.length - a.to.length)[0];
  return hit ? (role === 'worker' && hit.workerLabel ? hit.workerLabel : hit.label) : 'SIMS';
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-amber to-blue text-white shadow-lg shadow-amber/25"><Activity size={18} /></div>
      <div>
        <div className="font-display text-base font-bold leading-none">SIMS</div>
        <div className="font-mono text-[10px] text-muted">Smart Industry</div>
      </div>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const role = useAuth((s) => s.user?.role);
  const items = NAV.filter((n) => role && n.roles.includes(role));
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3" aria-label="Main">
      {items.map(({ to, label, workerLabel, icon: Icon }) => (
        <NavLink
          key={to} to={to} end={to === '/'} onClick={onNavigate}
          className={({ isActive }) =>
            `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${isActive ? 'bg-amber/12 text-amber shadow-[inset_3px_0_0_var(--amber)]' : 'text-muted hover:translate-x-0.5 hover:bg-surface-2 hover:text-fg'}`
          }
        >
          <Icon size={17} />
          {role === 'worker' && workerLabel ? workerLabel : label}
        </NavLink>
      ))}
    </nav>
  );
}

function AccountBlock() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="border-t border-line p-3">
      <div className="mb-2 flex items-center gap-2.5 px-1">
        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue/70 to-purple/70 text-xs font-semibold text-white" aria-hidden>{(user?.name ?? "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{user?.name}</div>
          <div className="font-mono text-[11px] uppercase text-muted">{user?.role}</div>
        </div>
      </div>
      <button
        onClick={async () => { await logout(); navigate('/login'); }}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg"
      >
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}

export default function AppShell() {
  const { theme, toggle } = useTheme();
  const [drawer, setDrawer] = useState(false);
  useLiveUpdates();
  const title = usePageTitle();
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  return (
    <div className="flex h-full text-fg">
      <a href="#main" className="sr-only z-50 rounded-md bg-amber px-3 py-2 text-sm font-semibold text-black focus:not-sr-only focus:absolute focus:left-3 focus:top-3">Skip to content</a>
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex h-14 items-center border-b border-line px-4"><Brand /></div>
        <NavList />
        <AccountBlock />
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="presentation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <aside role="dialog" aria-label="Navigation" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-line px-4">
              <Brand />
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"><X size={18} /></button>
            </div>
            <NavList onNavigate={() => setDrawer(false)} />
            <AccountBlock />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface/75 px-3 backdrop-blur-md print:hidden md:px-4">
          <div className="flex items-center gap-2">
            <button onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer} className="grid size-9 place-items-center rounded-lg border border-line bg-surface-2 text-muted hover:text-fg md:hidden"><Menu size={17} /></button>
            <div className="font-display text-sm font-semibold">{title}</div>
            <div className="hidden text-sm text-muted md:block">· {today}</div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <button onClick={toggle} aria-label="Toggle theme" className="grid size-9 place-items-center rounded-lg border border-line bg-surface-2 text-muted hover:text-fg">
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="min-h-0 outline-none flex-1 overflow-y-auto p-4 md:p-6"><Outlet /></main>
      </div>
      <Toaster />
    </div>
  );
}
