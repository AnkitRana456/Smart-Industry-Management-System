import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import type { InventoryItem, Page, PoStatus, PurchaseOrder, Supplier } from '../lib/types';
import SupplierSelect, { useSuppliers } from '../components/SupplierSelect';
import { btn, ConfirmDialog, EmptyState, Field, fmtDate, input, Modal, PageHeader, Skeleton } from '../components/ui';
import { useToasts } from '../store/toast';

type Tab = 'orders' | 'suppliers';
const STATUS_STYLE: Record<PoStatus, string> = {
  draft: 'bg-surface-2 text-muted', approved: 'bg-blue/15 text-blue', received: 'bg-green/15 text-green', cancelled: 'bg-red/10 text-red',
};
const STEPS: PoStatus[] = ['draft', 'approved', 'received'];
const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function Purchasing() {
  const [tab, setTab] = useState<Tab>('orders');
  return (
    <div>
      <PageHeader title="Purchasing" subtitle="Suppliers and purchase orders. Low stock drafts an order automatically; a person always approves it." />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
        {(['orders', 'suppliers'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t ? 'border-amber text-amber' : 'border-transparent text-muted hover:text-fg'}`}>
            {t === 'orders' ? 'Purchase orders' : 'Suppliers'}
          </button>
        ))}
      </div>
      {tab === 'orders' ? <Orders /> : <Suppliers />}
    </div>
  );
}

function Timeline({ status }: { status: PoStatus }) {
  if (status === 'cancelled') return <p className="text-xs font-medium text-red">Cancelled</p>;
  const at = STEPS.indexOf(status);
  return (
    <ol className="flex items-center gap-1.5 text-[11px]" aria-label={`Status: ${status}`}>
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 font-medium capitalize ${i <= at ? STATUS_STYLE[s] : 'text-muted/60'}`}>{s}</span>
          {i < STEPS.length - 1 && <span className="text-muted/50" aria-hidden>→</span>}
        </li>
      ))}
    </ol>
  );
}

function Orders() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [status, setStatus] = useState<PoStatus | ''>('');
  const [editing, setEditing] = useState<PurchaseOrder | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['purchase-orders', status],
    queryFn: async () => (await api.get<{ data: Page<PurchaseOrder> }>('/purchase-orders', { params: { limit: 100, status: status || undefined } })).data.data.items,
  });
  const done = () => { qc.invalidateQueries({ queryKey: ['purchase-orders'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['alerts'] }); };
  const act = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: 'approve' | 'receive' | 'cancel' }) => api.patch(`/purchase-orders/${id}/${verb}`),
    onSuccess: (_r, v) => { done(); push({ tone: 'success', title: v.verb === 'receive' ? 'Received into stock' : v.verb === 'approve' ? 'Approved' : 'Cancelled' }); },
    onError: (e) => push({ tone: 'warning', title: 'Not updated', body: errorMessage(e) }),
  });
  const sweep = useMutation({
    mutationFn: async () => (await api.post<{ data: { drafted: number; checked: number } }>('/purchase-orders/draft-from-low-stock')).data.data,
    onSuccess: (r) => { done(); push({ tone: 'info', title: r.drafted ? `${r.drafted} item${r.drafted === 1 ? '' : 's'} added to drafts` : 'Nothing new to draft', body: `${r.checked} item${r.checked === 1 ? ' is' : 's are'} under the reorder level.` }); },
    onError: (e) => push({ tone: 'critical', title: 'Check failed', body: errorMessage(e) }),
  });
  const items = list.data ?? [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <select aria-label="Filter by status" className={`${input} !w-auto`} value={status} onChange={(e) => setStatus(e.target.value as PoStatus | '')}>
          <option value="">All orders</option>
          {(['draft', 'approved', 'received', 'cancelled'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex gap-2">
          <button className={`${btn.ghost} flex items-center gap-1.5 !py-1.5 text-xs`} disabled={sweep.isPending} onClick={() => sweep.mutate()}><RefreshCw size={13} />Draft from low stock</button>
          <button className={btn.primary} onClick={() => setEditing('new')}><Plus size={15} className="mr-1 inline" />New order</button>
        </div>
      </div>
      {list.isLoading && <Skeleton className="h-40" />}
      {!list.isLoading && items.length === 0 && <EmptyState title="No purchase orders" hint="They appear here automatically when an item drops below its reorder level." />}
      <ul className="flex flex-col gap-3">
        {items.map((o) => (
          <li key={o._id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-mono text-xs text-muted">{o.poNo}{o.createdFromAlert && ' · drafted from a low-stock alert'}</p>
                <p className="font-medium">{o.supplier?.name ?? <span className="text-amber">No supplier chosen yet</span>}</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-lg font-semibold tabular-nums">{money(o.total)}</p>
                <Timeline status={o.status} />
              </div>
            </div>
            <ul className="mt-3 divide-y divide-line text-sm">
              {o.lines.map((l) => (
                <li key={l.item._id} className="flex justify-between gap-3 py-1.5">
                  <span>{l.item.name} <span className="font-mono text-xs text-muted">{l.item.sku}</span></span>
                  <span className="tabular-nums text-muted">{l.qty.toLocaleString()} {l.item.unit} × {money(l.unitCost)}</span>
                </li>
              ))}
              {o.lines.length === 0 && <li className="py-1.5 text-muted">No lines yet.</li>}
            </ul>
            <p className="mt-2 text-xs text-muted">
              {o.approvedBy && <>Approved by {o.approvedBy.name} · {fmtDate(o.approvedAt)}. </>}
              {o.receivedAt && <>Received {fmtDate(o.receivedAt)}. </>}
              {o.supplier && o.status === 'approved' && <>Lead time {o.supplier.leadTimeDays} days.</>}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {o.status === 'draft' && <button className={`${btn.primary} flex items-center gap-1 !py-1.5 text-xs`} disabled={act.isPending} onClick={() => act.mutate({ id: o._id, verb: 'approve' })}><Check size={13} />Approve</button>}
              {o.status === 'approved' && <button className={`${btn.primary} !py-1.5 text-xs`} disabled={act.isPending} onClick={() => act.mutate({ id: o._id, verb: 'receive' })}>Mark received</button>}
              {o.status === 'draft' && <button className={`${btn.ghost} flex items-center gap-1 !py-1.5 text-xs`} onClick={() => setEditing(o)}><Pencil size={13} />Edit</button>}
              {(o.status === 'draft' || o.status === 'approved') && <button className={`${btn.ghost} flex items-center gap-1 !py-1.5 text-xs`} disabled={act.isPending} onClick={() => act.mutate({ id: o._id, verb: 'cancel' })}><X size={13} />Cancel</button>}
            </div>
          </li>
        ))}
      </ul>
      {editing && <OrderForm order={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

interface Line { item: string; qty: string; unitCost: string }

function OrderForm({ order, onClose }: { order?: PurchaseOrder; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = !!order;
  const [supplier, setSupplier] = useState(order?.supplier?._id ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(order?.lines.map((l) => ({ item: l.item._id, qty: String(l.qty), unitCost: String(l.unitCost) })) ?? [{ item: '', qty: '1', unitCost: '0' }]);
  const [error, setError] = useState('');
  const stock = useQuery({ queryKey: ['inventory', 'all'], queryFn: async () => (await api.get<{ data: Page<InventoryItem> }>('/inventory', { params: { limit: 100 } })).data.data.items });
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = useMutation({
    mutationFn: (): Promise<unknown> => {
      const body = {
        supplier: supplier || undefined, notes: notes || undefined,
        lines: lines.filter((l) => l.item).map((l) => ({ item: l.item, qty: Number(l.qty), unitCost: Number(l.unitCost) || 0 })),
      };
      return editing ? api.patch(`/purchase-orders/${order!._id}`, body) : api.post('/purchase-orders', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase-orders'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const total = lines.reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);

  return (
    <Modal title={editing ? `Edit ${order!.poNo}` : 'New purchase order'} onClose={onClose} wide>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); save.mutate(); }} className="grid gap-3">
        <Field label="Supplier" htmlFor="po-sup"><SupplierSelect id="po-sup" value={supplier} onChange={setSupplier} empty="Choose later" /></Field>
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Lines</p>
          <ul className="flex flex-col gap-2">
            {lines.map((l, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <select aria-label={`Item ${i + 1}`} className={`${input} !w-auto min-w-48 flex-1`} value={l.item} onChange={(e) => {
                  const it = stock.data?.find((x) => x._id === e.target.value);
                  setLine(i, { item: e.target.value, ...(it?.unitCost != null && { unitCost: String(it.unitCost) }) });
                }}>
                  <option value="">Choose an item</option>
                  {stock.data?.map((x) => <option key={x._id} value={x._id} disabled={lines.some((o, j) => j !== i && o.item === x._id)}>{x.name} ({x.sku})</option>)}
                </select>
                <input aria-label={`Quantity ${i + 1}`} type="number" min="1" step="1" className={`${input} !w-24`} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                <input aria-label={`Unit cost ${i + 1}`} type="number" min="0" step="any" className={`${input} !w-24`} value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} />
                <button type="button" aria-label={`Remove line ${i + 1}`} className="rounded-md p-1.5 text-muted hover:text-red" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
          <button type="button" className={`${btn.ghost} mt-2 !py-1 text-xs`} onClick={() => setLines([...lines, { item: '', qty: '1', unitCost: '0' }])}>Add line</button>
        </div>
        <Field label="Notes" htmlFor="po-notes"><input id="po-notes" maxLength={500} className={input} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="text-sm text-muted">Total: <span className="font-mono font-semibold text-fg">{money(total)}</span></p>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={save.isPending}>{editing ? 'Save draft' : 'Create draft'}</button>
        </div>
      </form>
    </Modal>
  );
}

function Suppliers() {
  const qc = useQueryClient();
  const suppliers = useSuppliers();
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);
  const del = useMutation({
    mutationFn: (s: Supplier) => api.delete(`/suppliers/${s._id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); setDeleting(null); },
  });
  const list = suppliers.data ?? [];
  return (
    <div>
      <div className="mb-3 flex justify-end"><button className={btn.primary} onClick={() => setEditing('new')}><Plus size={15} className="mr-1 inline" />New supplier</button></div>
      {suppliers.isLoading && <Skeleton className="h-32" />}
      {!suppliers.isLoading && list.length === 0 && <EmptyState title="No suppliers yet" hint="Add one, then link it to inventory items so reorders know who to order from." />}
      {list.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
              {['Supplier', 'Contact', 'Lead time', 'Active', ''].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s._id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-muted">{[s.contactName, s.email, s.phone].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{s.leadTimeDays} days</td>
                  <td className="px-4 py-3">{s.active ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-right">
                    <button aria-label={`Edit ${s.name}`} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => setEditing(s)}><Pencil size={14} /></button>
                    <button aria-label={`Delete ${s.name}`} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-red" onClick={() => setDeleting(s)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <SupplierForm supplier={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`} message="Items linked to this supplier keep working but lose the link." busy={del.isPending}
          error={del.isError ? errorMessage(del.error) : undefined} onConfirm={() => del.mutate(deleting)} onCancel={() => { del.reset(); setDeleting(null); }}
        />
      )}
    </div>
  );
}

function SupplierForm({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: supplier?.name ?? '', contactName: supplier?.contactName ?? '', email: supplier?.email ?? '', phone: supplier?.phone ?? '',
    leadTimeDays: String(supplier?.leadTimeDays ?? 7), active: supplier?.active ?? true,
  });
  const [error, setError] = useState('');
  const set = (k: 'name' | 'contactName' | 'email' | 'phone' | 'leadTimeDays') => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, contactName: f.contactName || undefined, email: f.email || undefined, phone: f.phone || undefined, leadTimeDays: Number(f.leadTimeDays), active: f.active };
      return supplier ? api.patch(`/suppliers/${supplier._id}`, body) : api.post('/suppliers', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal title={supplier ? `Edit ${supplier.name}` : 'New supplier'} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); save.mutate(); }} className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Name" htmlFor="sp-name"><input id="sp-name" required minLength={2} maxLength={80} className={input} value={f.name} onChange={set('name')} /></Field></div>
        <Field label="Contact person" htmlFor="sp-contact"><input id="sp-contact" className={input} value={f.contactName} onChange={set('contactName')} /></Field>
        <Field label="Phone" htmlFor="sp-phone"><input id="sp-phone" className={input} value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email" htmlFor="sp-email"><input id="sp-email" type="email" className={input} value={f.email} onChange={set('email')} /></Field>
        <Field label="Lead time (days)" htmlFor="sp-lead"><input id="sp-lead" type="number" min="0" max="365" className={input} value={f.leadTimeDays} onChange={set('leadTimeDays')} /></Field>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Active</label>
        {error && <p role="alert" className="col-span-2 text-sm text-red">{error}</p>}
        <div className="col-span-2 flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={save.isPending}>{supplier ? 'Save' : 'Create supplier'}</button>
        </div>
      </form>
    </Modal>
  );
}
