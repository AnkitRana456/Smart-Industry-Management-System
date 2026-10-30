import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import type { AppUser, AuditEntry, Page } from '../lib/types';
import { btn, EmptyState, Field, fmtDate, input, Modal, PageHeader, Skeleton } from '../components/ui';
import { useAuth } from '../store/auth';
import { useToasts } from '../store/toast';

const ROLE_STYLE = { admin: 'bg-purple/15 text-purple', manager: 'bg-blue/15 text-blue', worker: 'bg-green/15 text-green' } as const;

export default function Users() {
  const me = useAuth((s) => s.user);
  const isAdmin = me?.role === 'admin';
  const [tab, setTab] = useState<'users' | 'audit'>('users');
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={isAdmin ? 'Accounts, roles and a record of who changed what.' : 'Accounts in the system. Only admins can change them.'}
        actions={isAdmin && tab === 'users' && <button className={btn.primary} onClick={() => setAdding(true)}><Plus size={15} className="mr-1 inline" />Add user</button>}
      />

      {isAdmin && (
        <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
          {([['users', 'Accounts'], ['audit', 'Audit log']] as const).map(([k, label]) => (
            <button
              key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === k ? 'border-amber text-amber' : 'border-transparent text-muted hover:text-fg'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === 'users' ? <Accounts isAdmin={isAdmin} meId={me?.id} /> : <Audit />}
      {adding && <AddUser onClose={() => setAdding(false)} />}
    </div>
  );
}

function Accounts({ isAdmin, meId }: { isAdmin: boolean; meId?: string }) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [resetting, setResetting] = useState<AppUser | null>(null);
  const users = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get<{ data: Page<AppUser> }>('/users', { params: { limit: 100 } })).data.data.items,
  });
  const update = useMutation({
    mutationFn: ({ id, ...data }: { id: string; role?: AppUser['role']; isActive?: boolean }) => api.patch(`/users/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e) => push({ tone: 'warning', title: 'Not changed', body: errorMessage(e) }),
  });

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="px-4 py-3 font-medium">User</th><th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Created</th>
              {isAdmin && <th className="px-4 py-3 text-right font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {users.isLoading && Array.from({ length: 4 }, (_, i) => <tr key={i}><td colSpan={5} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>)}
            {users.data?.map((u) => (
              <tr key={u.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3"><div className="font-medium">{u.name}{u.id === meId && <span className="ml-2 text-xs text-muted">(you)</span>}</div><div className="text-xs text-muted">{u.email}</div></td>
                <td className="px-4 py-3">
                  {isAdmin ? (
                    <select
                      aria-label={`Role of ${u.name}`} value={u.role} onChange={(e) => update.mutate({ id: u.id, role: e.target.value as AppUser['role'] })}
                      className="rounded-md border border-line bg-bg px-2 py-1 text-xs capitalize"
                    >
                      <option value="admin">admin</option><option value="manager">manager</option><option value="worker">worker</option>
                    </select>
                  ) : <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${ROLE_STYLE[u.role]}`}>{u.role}</span>}
                </td>
                <td className="px-4 py-3"><span className={`text-xs font-medium ${u.isActive ? 'text-green' : 'text-muted'}`}>{u.isActive ? 'Active' : 'Deactivated'}</span></td>
                <td className="px-4 py-3 text-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                {isAdmin && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button className={`${btn.ghost} flex items-center gap-1 !px-2.5 !py-1 text-xs`} onClick={() => setResetting(u)}><KeyRound size={12} />Reset password</button>
                      <button className={`${btn.ghost} !px-2.5 !py-1 text-xs`} disabled={update.isPending} onClick={() => update.mutate({ id: u.id, isActive: !u.isActive })}>{u.isActive ? 'Deactivate' : 'Reactivate'}</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {resetting && <ResetPassword user={resetting} onClose={() => setResetting(null)} />}
    </>
  );
}

function Audit() {
  const log = useQuery({
    queryKey: ['audit'],
    queryFn: async () => (await api.get<{ data: Page<AuditEntry> }>('/audit-logs', { params: { limit: 50 } })).data.data.items,
  });
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="px-4 py-3 font-medium">When</th><th className="px-4 py-3 font-medium">Who</th><th className="px-4 py-3 font-medium">Action</th><th className="px-4 py-3 font-medium">Fields sent</th>
          </tr>
        </thead>
        <tbody>
          {log.isLoading && <tr><td colSpan={4} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>}
          {log.data?.map((a) => (
            <tr key={a._id} className="border-b border-line last:border-0">
              <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-muted">{fmtDate(a.createdAt)}</td>
              <td className="px-4 py-2.5">{a.user?.name ?? 'Unknown'} <span className="text-xs text-muted">{a.user?.role}</span></td>
              <td className="px-4 py-2.5 font-mono text-xs">{a.action}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-muted">{a.diff?.fields?.join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!log.isLoading && log.data?.length === 0 && <div className="p-4"><EmptyState title="Nothing recorded yet" hint="Changes made through the app appear here. Passwords and other values are never stored." /></div>}
    </div>
  );
}

function AddUser({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'manager' });
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => api.post('/auth/register', f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Add user" onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); create.mutate(); }} className="flex flex-col gap-3">
        <Field label="Full name" htmlFor="u-name"><input id="u-name" required className={input} value={f.name} onChange={set('name')} /></Field>
        <Field label="Email" htmlFor="u-email"><input id="u-email" type="email" required className={input} value={f.email} onChange={set('email')} /></Field>
        <Field label="Temporary password (8+ characters)" htmlFor="u-pass"><input id="u-pass" type="password" minLength={8} required className={input} value={f.password} onChange={set('password')} /></Field>
        <Field label="Role" htmlFor="u-role">
          <select id="u-role" className={input} value={f.role} onChange={set('role')}><option value="admin">Admin</option><option value="manager">Manager</option><option value="worker">Worker</option></select>
        </Field>
        <p className="text-xs text-muted">Production workers should be added from the Workers page so they get a worker profile, shift and attendance.</p>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={create.isPending}>Create user</button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPassword({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const reset = useMutation({ mutationFn: () => api.post(`/users/${user.id}/reset-password`, { password }), onSuccess: onClose, onError: (e) => setError(errorMessage(e)) });
  return (
    <Modal title={`Reset password: ${user.name}`} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); reset.mutate(); }} className="flex flex-col gap-3">
        <Field label="New password (8+ characters)" htmlFor="rp-pass"><input id="rp-pass" type="password" minLength={8} required autoFocus className={input} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <p className="text-xs text-muted">The user is signed out everywhere and must sign in with the new password.</p>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={reset.isPending}>Reset password</button>
        </div>
      </form>
    </Modal>
  );
}
