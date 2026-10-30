import { Activity } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center bg-bg p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-7 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-amber to-blue text-white"><Activity size={20} /></div>
          <h1 className="font-display text-xl font-bold leading-tight">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

const field = 'mb-4 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm';
const submitCls = 'w-full rounded-lg bg-amber px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Forgot your password?">
      {sent ? (
        <p role="status" className="text-sm">If that email has an account, a reset link is on its way. It works once and expires in 30 minutes.</p>
      ) : (
        <form onSubmit={submit}>
          <p className="mb-4 text-sm text-muted">Enter your email and we will send you a link to choose a new password.</p>
          <label htmlFor="fp-email" className="mb-1 block text-xs font-medium text-muted">Email</label>
          <input id="fp-email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          {error && <p role="alert" className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{error}</p>}
          <button type="submit" disabled={busy} className={submitCls}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><Link to="/login" className="text-amber hover:underline">Back to sign in</Link></p>
    </Card>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      navigate('/login', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!/^[a-f\d]{64}$/.test(token)) {
    return (
      <Card title="Reset link problem">
        <p role="alert" className="text-sm">This reset link is not valid. <Link to="/forgot-password" className="text-amber hover:underline">Ask for a new one.</Link></p>
      </Card>
    );
  }
  return (
    <Card title="Choose a new password">
      <form onSubmit={submit}>
        <label htmlFor="rp-pw" className="mb-1 block text-xs font-medium text-muted">New password (at least 8 characters)</label>
        <input id="rp-pw" type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        <label htmlFor="rp-pw2" className="mb-1 block text-xs font-medium text-muted">Repeat it</label>
        <input id="rp-pw2" type="password" required minLength={8} maxLength={128} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} />
        {error && <p role="alert" className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{error}</p>}
        <button type="submit" disabled={busy} className={submitCls}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>
    </Card>
  );
}
