import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, Download, History, Pencil, Plus, Search, SlidersHorizontal, Trash2, Upload } from 'lucide-react';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { downloadCsv, parseCsv } from '../lib/csv';
import type { ImportResult, InventoryItem, Page, StockCover, StockTx, Valuation } from '../lib/types';
import SupplierSelect from '../components/SupplierSelect';
import { useStockCover } from '../hooks/useInsights';
import { btn, ConfirmDialog, EmptyState, Field, fmtDate, input, Modal, PageHeader, Skeleton } from '../components/ui';
import { useAuth } from '../store/auth';

type TxType = 'in' | 'out' | 'adjust';

export default function Inventory() {
  const canEdit = useAuth((s) => s.user?.role !== 'worker');
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [tx, setTx] = useState<{ item: InventoryItem; type: TxType } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState<InventoryItem | null>(null);
  const [viewing, setViewing] = useState<InventoryItem | null>(null);
  const [importing, setImporting] = useState(false);
  const cover = useStockCover();
  const coverBy = new Map((cover.data ?? []).map((c) => [c.itemId, c]));
  const valuation = useQuery({
    queryKey: ['inventory', 'valuation'], enabled: canEdit,
    queryFn: async () => (await api.get<{ data: Valuation }>('/inventory/valuation')).data.data,
  });

  const inventory = useQuery({
    queryKey: ['inventory', search, lowOnly],
    queryFn: async () =>
      (await api.get<{ data: Page<InventoryItem> }>('/inventory', { params: { search: search || undefined, lowStock: lowOnly ? 'true' : undefined, limit: 100 } })).data.data,
  });

  const items = inventory.data?.items ?? [];
  const lowCount = items.filter((i) => i.quantity < i.reorderThreshold).length;

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Stock levels against reorder thresholds. Falling below a threshold raises an alert."
        actions={canEdit && (
          <>
            <button className={`${btn.ghost} flex items-center gap-1.5 !py-1.5 text-xs`} onClick={() => downloadCsv('inventory.csv', ['sku', 'name', 'quantity', 'unit', 'reorder_threshold', 'unit_cost', 'supplier'], items.map((i) => [i.sku, i.name, i.quantity, i.unit, i.reorderThreshold, i.unitCost ?? '', i.supplier ?? '']))}><Download size={13} />Export CSV</button>
            <button className={`${btn.ghost} flex items-center gap-1.5 !py-1.5 text-xs`} onClick={() => setImporting(true)}><Upload size={13} />Import CSV</button>
            <button className={btn.primary} onClick={() => setAdding(true)}><Plus size={15} className="mr-1 inline" />Add item</button>
          </>
        )}
      />

      {valuation.data && (
        <p className="mb-3 text-sm text-muted">
          Stock value at cost: <span className="font-mono font-semibold text-fg">{valuation.data.totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          {valuation.data.itemsWithoutCost > 0 && <> ({valuation.data.itemsWithoutCost} item{valuation.data.itemsWithoutCost === 1 ? '' : 's'} have no unit cost and are not counted)</>}
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input aria-label="Search inventory" placeholder="Search name, SKU or supplier" value={search} onChange={(e) => setSearch(e.target.value)} className={`${input} pl-9`} />
        </div>
        <button
          onClick={() => setLowOnly(!lowOnly)} aria-pressed={lowOnly}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${lowOnly ? 'border-red bg-red/15 text-red' : 'border-line text-muted hover:text-fg'}`}
        >
          Low stock only{!lowOnly && lowCount > 0 ? ` (${lowCount})` : ''}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="px-4 py-3 font-medium">Item</th>
              <th className="w-64 px-4 py-3 font-medium">Stock level</th>
              <th className="px-4 py-3 text-right font-medium">Quantity</th>
              {canEdit && cover.data && <th className="px-4 py-3 font-medium" title="Forecast from recent usage by the risk-model service">Days of cover</th>}
              <th className="px-4 py-3 font-medium">Supplier</th>
              {canEdit && <th className="px-4 py-3 text-right font-medium">Record</th>}
            </tr>
          </thead>
          <tbody>
            {inventory.isLoading && Array.from({ length: 6 }, (_, i) => (
              <tr key={i}><td colSpan={5} className="px-4 py-3"><Skeleton className="h-6" /></td></tr>
            ))}
            {items.map((i) => {
              const low = i.quantity < i.reorderThreshold;
              const cap = Math.max(i.reorderThreshold * 2, i.quantity, 1);
              return (
                <tr key={i._id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{i.name}</div>
                    <div className="font-mono text-xs text-muted">{i.sku}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="relative h-2 rounded-full bg-surface-2">
                      <div className={`h-full rounded-full ${low ? 'bg-red' : 'bg-green'}`} style={{ width: `${Math.min(100, (i.quantity / cap) * 100)}%` }} />
                      <div className="absolute -top-0.5 h-3 w-0.5 bg-fg/60" style={{ left: `${(i.reorderThreshold / cap) * 100}%` }} title={`Reorder at ${i.reorderThreshold}`} />
                    </div>
                    {low && <div className="mt-1 text-[11px] font-medium text-red">Below reorder level ({i.reorderThreshold})</div>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{i.quantity.toLocaleString()} <span className="text-muted">{i.unit}</span></td>
                  {canEdit && cover.data && <CoverCell c={coverBy.get(i._id)} />}
                  <td className="px-4 py-3 text-muted">{i.supplier ?? '—'}</td>
                  {canEdit && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconBtn label={`Stock in ${i.sku}`} onClick={() => setTx({ item: i, type: 'in' })}><ArrowDownToLine size={15} /></IconBtn>
                        <IconBtn label={`Stock out ${i.sku}`} onClick={() => setTx({ item: i, type: 'out' })}><ArrowUpFromLine size={15} /></IconBtn>
                        <IconBtn label={`Adjust ${i.sku}`} onClick={() => setTx({ item: i, type: 'adjust' })}><SlidersHorizontal size={15} /></IconBtn>
                        <span className="mx-0.5 w-px self-stretch bg-line" aria-hidden />
                        <IconBtn label={`History of ${i.sku}`} onClick={() => setViewing(i)}><History size={15} /></IconBtn>
                        <IconBtn label={`Edit ${i.sku}`} onClick={() => setEditing(i)}><Pencil size={15} /></IconBtn>
                        <IconBtn label={`Delete ${i.sku}`} onClick={() => setDeleting(i)}><Trash2 size={15} /></IconBtn>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!inventory.isLoading && items.length === 0 && <div className="p-4"><EmptyState title="No items found" hint="Adjust the search or filter." /></div>}
      </div>

      {tx && <TransactionModal {...tx} onClose={() => setTx(null)} />}
      {importing && <ImportCsv onClose={() => setImporting(false)} />}
      {adding && <AddItem onClose={() => setAdding(false)} />}
      {editing && <EditItem item={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteItem item={deleting} onClose={() => setDeleting(null)} />}
      {viewing && <TxHistory item={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="grid size-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-surface-2 hover:text-fg">
      {children}
    </button>
  );
}

const TX_COPY: Record<TxType, { title: string; hint: string }> = {
  in: { title: 'Receive stock', hint: 'Quantity to add' },
  out: { title: 'Issue stock', hint: 'Quantity to remove' },
  adjust: { title: 'Adjust stock', hint: 'Use a negative number to reduce' },
};

function TransactionModal({ item, type, onClose }: { item: InventoryItem; type: TxType; onClose: () => void }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState('');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/inventory/${item._id}/transactions`, { type, qty: Number(qty) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['alerts'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Modal title={`${TX_COPY[type].title}: ${item.name}`} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); save.mutate(); }} className="flex flex-col gap-3">
        <p className="text-sm text-muted">On hand: <span className="font-mono text-fg">{item.quantity} {item.unit}</span></p>
        <Field label={TX_COPY[type].hint} htmlFor="tx-qty">
          <input id="tx-qty" type="number" step="any" required autoFocus value={qty} onChange={(e) => setQty(e.target.value)} className={input} />
        </Field>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={save.isPending || !qty}>Record</button>
        </div>
      </form>
    </Modal>
  );
}

function AddItem({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ sku: '', name: '', quantity: '0', unit: 'pcs', reorderThreshold: '0', supplier: '', unitCost: '', supplierRef: '' });
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => api.post('/inventory', {
      sku: f.sku, name: f.name, unit: f.unit, supplier: f.supplier || undefined,
      unitCost: f.unitCost === '' ? undefined : Number(f.unitCost), supplierRef: f.supplierRef || undefined,
      quantity: Number(f.quantity), reorderThreshold: Number(f.reorderThreshold),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal title="Add inventory item" onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); create.mutate(); }} className="grid grid-cols-2 gap-3">
        <Field label="SKU" htmlFor="i-sku"><input id="i-sku" required className={input} value={f.sku} onChange={set('sku')} /></Field>
        <Field label="Unit" htmlFor="i-unit"><input id="i-unit" className={input} value={f.unit} onChange={set('unit')} /></Field>
        <div className="col-span-2"><Field label="Name" htmlFor="i-name"><input id="i-name" required className={input} value={f.name} onChange={set('name')} /></Field></div>
        <Field label="Opening quantity" htmlFor="i-qty"><input id="i-qty" type="number" min="0" className={input} value={f.quantity} onChange={set('quantity')} /></Field>
        <Field label="Reorder threshold" htmlFor="i-thr"><input id="i-thr" type="number" min="0" className={input} value={f.reorderThreshold} onChange={set('reorderThreshold')} /></Field>
        <Field label="Unit cost" htmlFor="i-cost"><input id="i-cost" type="number" min="0" step="any" className={input} value={f.unitCost} onChange={set('unitCost')} /></Field>
        <Field label="Supplier (for reorders)" htmlFor="i-supref"><SupplierSelect id="i-supref" value={f.supplierRef} onChange={(v) => setF({ ...f, supplierRef: v })} /></Field>
        <div className="col-span-2"><Field label="Supplier note" htmlFor="i-sup"><input id="i-sup" className={input} value={f.supplier} onChange={set('supplier')} /></Field></div>
        {error && <p role="alert" className="col-span-2 text-sm text-red">{error}</p>}
        <div className="col-span-2 flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={create.isPending}>Create</button>
        </div>
      </form>
    </Modal>
  );
}

function EditItem({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: item.name, unit: item.unit, reorderThreshold: String(item.reorderThreshold), supplier: item.supplier ?? '', unitCost: item.unitCost == null ? '' : String(item.unitCost), supplierRef: item.supplierRef ?? '' });
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => api.patch(`/inventory/${item._id}`, { name: f.name, unit: f.unit, supplier: f.supplier || undefined, reorderThreshold: Number(f.reorderThreshold), unitCost: f.unitCost === '' ? undefined : Number(f.unitCost), supplierRef: f.supplierRef || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['alerts'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={`Edit ${item.sku}`} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); save.mutate(); }} className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Name" htmlFor="ei-name"><input id="ei-name" required className={input} value={f.name} onChange={set('name')} /></Field></div>
        <Field label="Unit" htmlFor="ei-unit"><input id="ei-unit" required className={input} value={f.unit} onChange={set('unit')} /></Field>
        <Field label="Reorder threshold" htmlFor="ei-thr"><input id="ei-thr" type="number" min="0" required className={input} value={f.reorderThreshold} onChange={set('reorderThreshold')} /></Field>
        <Field label="Unit cost" htmlFor="ei-cost"><input id="ei-cost" type="number" min="0" step="any" className={input} value={f.unitCost} onChange={set('unitCost')} /></Field>
        <Field label="Supplier (for reorders)" htmlFor="ei-supref"><SupplierSelect id="ei-supref" value={f.supplierRef} onChange={(v) => setF({ ...f, supplierRef: v })} /></Field>
        <div className="col-span-2"><Field label="Supplier note" htmlFor="ei-sup"><input id="ei-sup" className={input} value={f.supplier} onChange={set('supplier')} /></Field></div>
        <p className="col-span-2 text-xs text-muted">Quantity changes go through Stock in, Stock out or Adjust so every movement is recorded.</p>
        {error && <p role="alert" className="col-span-2 text-sm text-red">{error}</p>}
        <div className="col-span-2 flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={save.isPending}>Save changes</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteItem({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const del = useMutation({
    mutationFn: () => api.delete(`/inventory/${item._id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['alerts'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <ConfirmDialog
      title={`Delete ${item.sku}?`} busy={del.isPending} error={error} onCancel={onClose} onConfirm={() => del.mutate()}
      message={<>Remove <strong className="text-fg">{item.name}</strong> from inventory. Orders that list it as a material will no longer be able to start until you change them. This cannot be undone.</>}
    />
  );
}

const TX_STYLE = { in: 'text-green', out: 'text-amber', adjust: 'text-blue' } as const;

function TxHistory({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const txs = useQuery({
    queryKey: ['inventory', 'tx', item._id],
    queryFn: async () => (await api.get<{ data: Page<StockTx> }>(`/inventory/${item._id}/transactions`, { params: { limit: 30 } })).data.data.items,
  });
  return (
    <Modal title={`${item.name}: stock movements`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">On hand now: <span className="font-mono text-fg">{item.quantity} {item.unit}</span></p>
      <ul className="flex max-h-80 flex-col overflow-y-auto rounded-lg border border-line">
        {txs.isLoading && <li className="p-3"><Skeleton className="h-6" /></li>}
        {txs.data?.map((t) => (
          <li key={t._id} className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-sm last:border-0">
            <span className={`w-16 font-medium capitalize ${TX_STYLE[t.type]}`}>{t.type}</span>
            <span className="font-mono tabular-nums">{t.type === 'out' ? '-' : t.qty > 0 ? '+' : ''}{t.qty} {item.unit}</span>
            <span className="text-right text-xs text-muted">{fmtDate(t.createdAt)}{t.by ? ` · ${t.by.name}` : ''}</span>
          </li>
        ))}
        {txs.data?.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No movements recorded yet.</li>}
      </ul>
    </Modal>
  );
}

const COLUMNS = ['sku', 'name', 'quantity', 'unit', 'reorder_threshold', 'unit_cost', 'supplier'] as const;

function ImportCsv({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [problem, setProblem] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  function read(e: ChangeEvent<HTMLInputElement>) {
    setProblem(''); setRows(null); setResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) { setProblem('That file is too large. Import up to 500 rows at a time.'); return; }
    file.text().then((text) => {
      const [head, ...body] = parseCsv(text);
      const cols = (head ?? []).map((h) => h.trim().toLowerCase());
      const missing = ['sku', 'name', 'quantity'].filter((c) => !cols.includes(c));
      if (missing.length) { setProblem(`The first row must name these columns: ${missing.join(', ')}. Expected: ${COLUMNS.join(', ')}.`); return; }
      if (body.length === 0) { setProblem('The file has a header but no rows.'); return; }
      if (body.length > 500) { setProblem('Import up to 500 rows at a time.'); return; }
      const at = (r: string[], c: string) => (r[cols.indexOf(c)] ?? '').trim();
      setRows(body.map((r) => ({
        sku: at(r, 'sku'), name: at(r, 'name'), quantity: Number(at(r, 'quantity')),
        ...(at(r, 'unit') && { unit: at(r, 'unit') }),
        ...(at(r, 'reorder_threshold') && { reorderThreshold: Number(at(r, 'reorder_threshold')) }),
        ...(at(r, 'unit_cost') && { unitCost: Number(at(r, 'unit_cost')) }),
        ...(at(r, 'supplier') && { supplier: at(r, 'supplier') }),
      })));
    }).catch(() => setProblem('That file could not be read.'));
  }

  const send = useMutation({
    mutationFn: async () => (await api.post<{ data: ImportResult }>('/inventory/import', { rows })).data.data,
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['alerts'] }); },
    onError: (e) => setProblem(errorMessage(e)),
  });

  return (
    <Modal title="Import inventory from CSV" onClose={onClose} wide>
      <p className="mb-3 text-sm text-muted">
        Columns: <span className="font-mono text-xs">{COLUMNS.join(', ')}</span>. New SKUs are created; existing SKUs are updated, and a changed quantity is recorded as an adjustment.
      </p>
      <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={read} className="mb-3 block text-sm" />
      {problem && <p role="alert" className="mb-3 text-sm text-red">{problem}</p>}
      {rows && !result && <p className="mb-3 text-sm">{rows.length} row{rows.length === 1 ? '' : 's'} ready to import.</p>}
      {result && (
        <div className="mb-3 text-sm">
          <p className="font-medium text-green">{result.created} created, {result.updated} updated.</p>
          {result.errors.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-y-auto text-xs text-red">
              {result.errors.map((x) => <li key={x.row}>Row {x.row} ({x.sku}): {x.message}</li>)}
            </ul>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button className={btn.ghost} onClick={onClose}>{result ? 'Close' : 'Cancel'}</button>
        {!result && <button className={btn.primary} disabled={!rows || send.isPending} onClick={() => send.mutate()}>Import</button>}
      </div>
    </Modal>
  );
}

function CoverCell({ c }: { c?: StockCover }) {
  if (!c || !c.enoughHistory) return <td className="px-4 py-3 text-xs text-muted" title={c?.message}>No usage yet</td>;
  const d = c.daysOfCover;
  const tone = d == null ? 'text-green' : d <= 7 ? 'text-red' : d <= 14 ? 'text-amber' : 'text-green';
  const range = c.earliestDays != null && c.latestDays != null && c.earliestDays !== c.latestDays ? `, between ${c.earliestDays} and ${c.latestDays}` : '';
  return (
    <td className="px-4 py-3" title={`At about ${c.usagePerDay} ${c.unit} a day${range}. Based on the last 30 days of usage${c.confidence === 'low' ? ' (patchy, so treat it loosely)' : ''}.`}>
      <span className={`font-mono text-sm font-semibold tabular-nums ${tone}`}>{d == null ? '60+ d' : `~${d} d`}</span>
      {c.runOutOn && d != null && d <= 30 && <div className="text-[11px] text-muted">runs out {c.runOutOn}</div>}
      {(c.suggestedOrderQty ?? 0) > 0 && <div className="text-[11px] text-muted">order ~{c.suggestedOrderQty?.toLocaleString()} {c.unit}</div>}
    </td>
  );
}
