import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, AlertTriangle, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import type { Bom, Feasibility, InventoryItem, Order, Page, QualityData } from '../lib/types';
import { btn, ConfirmDialog, EmptyState, Field, fmtDate, input, Modal, Skeleton } from './ui';

/** Live "can we take this order?" check. Everything shown comes from POST /production/feasibility. */
export function FeasibilityBox({ product, quantity, machines }: { product: string; quantity: number; machines: string[] }) {
  const [asked, setAsked] = useState<Feasibility | null>(null);
  const check = useMutation({
    mutationFn: async () => (await api.post<{ data: Feasibility }>('/production/feasibility', { product, quantity, machines })).data.data,
    onSuccess: setAsked,
  });
  const ready = product.trim().length >= 2 && quantity >= 1;
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 p-3 text-sm" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">Can we take this order?</p>
        <button type="button" className={`${btn.ghost} !py-1 text-xs`} disabled={!ready || check.isPending} onClick={() => check.mutate()}>Check</button>
      </div>
      {check.isError && <p role="alert" className="mt-2 text-xs text-red">{errorMessage(check.error)}</p>}
      {asked && (
        <div className="mt-2">
          <p className={`flex items-center gap-1.5 font-medium ${asked.feasible ? 'text-green' : 'text-amber'}`}>
            {asked.feasible ? <Check size={14} /> : <AlertTriangle size={14} />}
            {asked.feasible ? 'Yes: stock, a machine and staff are in place.' : 'Not as things stand:'}
          </p>
          {asked.problems.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-muted">{asked.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          {asked.materials.length > 0 && (
            <ul className="mt-2 text-xs text-muted">
              {asked.materials.map((m) => <li key={m.sku}>{m.name}: needs {m.needed.toLocaleString()} {m.unit}, {m.available.toLocaleString()} on hand</li>)}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-muted">{asked.note}</p>
        </div>
      )}
    </div>
  );
}

export function QualityModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const qc = useQueryClient();
  const data = useQuery({
    queryKey: ['quality', order._id],
    queryFn: async () => (await api.get<{ data: QualityData }>(`/quality-checks/order/${order._id}`)).data.data,
  });
  const [f, setF] = useState({ stage: 'Final inspection', inspectedQty: '', defectCount: '0', scrapQty: '0', notes: '' });
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const log = useMutation({
    mutationFn: () => api.post('/quality-checks', {
      order: order._id, stage: f.stage, inspectedQty: Number(f.inspectedQty), defectCount: Number(f.defectCount), scrapQty: Number(f.scrapQty), notes: f.notes || undefined,
    }),
    onSuccess: () => { setF({ ...f, inspectedQty: '', defectCount: '0', scrapQty: '0', notes: '' }); setError(''); qc.invalidateQueries({ queryKey: ['quality', order._id] }); qc.invalidateQueries({ queryKey: ['analytics'] }); },
    onError: (e) => setError(errorMessage(e)),
  });
  const s = data.data?.summary;
  const canLog = order.status !== 'pending';

  return (
    <Modal title={`${order.orderNo}: quality`} onClose={onClose} wide>
      {s && (
        <p className="mb-3 text-sm text-muted">
          {s.checks} check{s.checks === 1 ? '' : 's'} · {s.inspected.toLocaleString()} inspected · <span className={s.defects ? 'text-amber' : ''}>{s.defects.toLocaleString()} defects</span> · <span className={s.scrap ? 'text-red' : ''}>{s.scrap.toLocaleString()} scrapped</span>
          {s.inspected > 0 && <> · defect rate {Math.round((s.defects / s.inspected) * 1000) / 10}%</>}
        </p>
      )}
      {canLog ? (
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); log.mutate(); }} className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-4"><Field label="Stage" htmlFor="qc-stage"><input id="qc-stage" required minLength={2} maxLength={60} className={input} value={f.stage} onChange={set('stage')} /></Field></div>
          <Field label="Inspected" htmlFor="qc-n"><input id="qc-n" type="number" required min="1" className={input} value={f.inspectedQty} onChange={set('inspectedQty')} /></Field>
          <Field label="Defects" htmlFor="qc-d"><input id="qc-d" type="number" min="0" className={input} value={f.defectCount} onChange={set('defectCount')} /></Field>
          <Field label="Scrapped" htmlFor="qc-s"><input id="qc-s" type="number" min="0" className={input} value={f.scrapQty} onChange={set('scrapQty')} /></Field>
          <div className="col-span-2 sm:col-span-1"><Field label="Notes" htmlFor="qc-notes"><input id="qc-notes" maxLength={300} className={input} value={f.notes} onChange={set('notes')} /></Field></div>
          {error && <p role="alert" className="col-span-2 text-sm text-red sm:col-span-4">{error}</p>}
          <div className="col-span-2 flex justify-end sm:col-span-4"><button className={btn.primary} disabled={log.isPending}>Log check</button></div>
        </form>
      ) : <p className="mb-3 text-sm text-muted">Checks can be logged once the order has started.</p>}

      {data.isLoading && <Skeleton className="h-20" />}
      {data.data?.checks.length === 0 && <EmptyState title="No checks yet" />}
      <ul className="max-h-56 divide-y divide-line overflow-y-auto text-sm">
        {data.data?.checks.map((c) => (
          <li key={c._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><span className="font-medium">{c.stage}</span> <span className="text-xs text-muted">{c.notes}</span></span>
            <span className="text-xs tabular-nums text-muted">{c.inspectedQty} inspected, {c.defectCount} defects, {c.scrapQty} scrap · {c.checkedBy?.name ?? '—'} · {fmtDate(c.createdAt)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end"><button className={btn.ghost} onClick={onClose}>Close</button></div>
    </Modal>
  );
}

export function BomManager({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const boms = useQuery({ queryKey: ['bom'], queryFn: async () => (await api.get<{ data: Bom[] }>('/bom')).data.data });
  const stock = useQuery({ queryKey: ['inventory', 'all'], queryFn: async () => (await api.get<{ data: Page<InventoryItem> }>('/inventory', { params: { limit: 100 } })).data.data.items });
  const [product, setProduct] = useState('');
  const [rows, setRows] = useState([{ item: '', qty: '1' }]);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Bom | null>(null);

  const create = useMutation({
    mutationFn: () => api.post('/bom', { product, items: rows.filter((r) => r.item).map((r) => ({ item: r.item, qtyPerUnit: Number(r.qty) })) }),
    onSuccess: () => { setProduct(''); setRows([{ item: '', qty: '1' }]); setError(''); qc.invalidateQueries({ queryKey: ['bom'] }); },
    onError: (e) => setError(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: (b: Bom) => api.delete(`/bom/${b._id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bom'] }); setDeleting(null); },
  });
  const setRow = (i: number, patch: Partial<{ item: string; qty: string }>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Modal title="Bills of materials" onClose={onClose} wide>
      <p className="mb-3 text-sm text-muted">What one unit of a product takes from stock. A new order for the product copies it unless you list materials yourself.</p>
      {boms.isLoading && <Skeleton className="h-20" />}
      <ul className="mb-4 flex max-h-48 flex-col gap-2 overflow-y-auto">
        {boms.data?.map((b) => (
          <li key={b._id} className="flex items-start justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <div><p className="font-medium">{b.product}</p><p className="text-xs text-muted">{b.items.map((i) => `${i.item.name} ${i.qtyPerUnit} ${i.item.unit}`).join(', ')} per unit</p></div>
            <button aria-label={`Delete ${b.product}`} className="rounded-md p-1.5 text-muted hover:text-red" onClick={() => setDeleting(b)}><Trash2 size={14} /></button>
          </li>
        ))}
        {boms.data?.length === 0 && <li className="text-sm text-muted">None yet.</li>}
      </ul>

      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); create.mutate(); }} className="grid gap-3 border-t border-line pt-3">
        <Field label="New product" htmlFor="bom-product"><input id="bom-product" required minLength={2} maxLength={80} className={input} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Drive shaft" /></Field>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <select aria-label={`Material ${i + 1}`} className={input} value={r.item} onChange={(e) => setRow(i, { item: e.target.value })}>
              <option value="">Choose a material</option>
              {stock.data?.map((x) => <option key={x._id} value={x._id} disabled={rows.some((o, j) => j !== i && o.item === x._id)}>{x.name} ({x.unit})</option>)}
            </select>
            <input aria-label={`Quantity per unit ${i + 1}`} type="number" min="0.0001" step="any" className={`${input} !w-28`} value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} />
            {rows.length > 1 && <button type="button" aria-label={`Remove material ${i + 1}`} className="rounded-md p-1.5 text-muted hover:text-red" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
          </div>
        ))}
        <button type="button" className={`${btn.ghost} self-start !py-1 text-xs`} onClick={() => setRows([...rows, { item: '', qty: '1' }])}>Add material</button>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Close</button>
          <button className={btn.primary} disabled={create.isPending}>Save bill of materials</button>
        </div>
      </form>
      {deleting && (
        <ConfirmDialog
          title={`Delete the BOM for ${deleting.product}?`} message="Existing orders keep their materials. New orders will need materials listed by hand." busy={del.isPending}
          error={del.isError ? errorMessage(del.error) : undefined} onConfirm={() => del.mutate(deleting)} onCancel={() => { del.reset(); setDeleting(null); }}
        />
      )}
    </Modal>
  );
}
