import { Activity, BellRing, Gauge, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { errorMessage } from '../lib/api';
import { useAuth } from '../store/auth';

// Seeded demo accounts are prefilled only in `vite dev`; production builds start empty.
const DEMO = import.meta.env.DEV;

const PERKS = [
  { Icon: Gauge, text: 'Live machine health and downtime' },
  { Icon: BellRing, text: 'Alerts that reach the right person' },
  { Icon: ShieldCheck, text: 'Role-based access for every team' },
];

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(DEMO ? 'manager@sims.local' : '');
  const [password, setPassword] = useState(DEMO ? 'Password@123' : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-full place-items-center p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-line bg-surface md:grid-cols-[1.05fr_1fr]" style={{ boxShadow: 'var(--shadow-pop)' }}>
        <aside className="relative hidden flex-col justify-between gap-10 overflow-hidden bg-gradient-to-br from-amber/20 via-blue/15 to-purple/20 p-10 md:flex" aria-hidden>
          <div className="absolute -right-20 -top-20 size-72 rounded-full bg-amber/20 blur-3xl" />
          <div className="absolute -bottom-24 -left-16 size-72 rounded-full bg-blue/20 blur-3xl" />
          <div className="relative">
            <div className="mb-8 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-amber to-blue text-white shadow-lg shadow-amber/30"><Activity size={24} /></div>
            <h2 className="font-display text-3xl font-bold leading-tight">The whole floor,<br />in one calm view.</h2>
            <p className="mt-3 max-w-xs text-sm text-muted">Machines, people, stock and production, with live updates and plain-language insight.</p>
          </div>
          <ul className="relative flex flex-col gap-3 text-sm">
            {PERKS.map(({ Icon, text }) => (
              <li key={text} className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg bg-surface/60 text-amber"><Icon size={16} /></span>{text}</li>
            ))}
          </ul>
        </aside>

        <form onSubmit={submit} className="w-full p-7 sm:p-10">
          <div className="mb-7 flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-amber to-blue text-white shadow-lg shadow-amber/25 md:hidden">
              <Activity size={20} />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold leading-tight">Sign in to SIMS</h1>
              <p className="text-xs text-muted">Smart Industrial Management System</p>
            </div>
          </div>

          <label htmlFor="email" className="mb-1 block text-xs font-medium text-muted">Email</label>
          <input
            id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
            className="mb-4 w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-sm"
          />
          <label htmlFor="password" className="mb-1 block text-xs font-medium text-muted">Password</label>
          <input
            id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="mb-3 w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-sm"
          />
          <p className="mb-5 text-right text-xs"><Link to="/forgot-password" className="text-amber hover:underline">Forgot password?</Link></p>

          {error && <p role="alert" className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{error}</p>}

          <button
            type="submit" disabled={busy}
            className="w-full rounded-lg bg-gradient-to-b from-amber to-amber/85 px-4 py-2.5 text-sm font-semibold text-black shadow-md shadow-amber/25 transition hover:brightness-110 active:translate-y-px disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {DEMO && (
            <p className="mt-4 text-center font-mono text-[11px] text-muted">
              Demo: admin / manager / worker @sims.local
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
