import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ClipboardCheck, History, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import type { InventoryItem, Machine, Order, OrderStatus, Page } from '../lib/types';
import { BomManager, FeasibilityBox, QualityModal } from '../components/ProductionExtras';
import { btn, ConfirmDialog, EmptyState, Field, input, Modal, PageHeader, Skeleton } from '../components/ui';
import { useAuth } from '../store/auth';
import { useToasts } from '../store/toast';

const COLUMNS: { status: OrderStatus; title: string; hint: string }[] = [
  { status: 'pending', title: 'Pending', hint: 'Waiting to start' },
  { status: 'in_progress', title: 'In progress', hint: 'On the floor now' },
  { status: 'completed', title: 'Completed', hint: 'Finished orders' },
];

const MACHINE_DOT = { running: 'bg-green', idle: 'bg-blue', maintenance: 'bg-amber', offline: 'bg-red' } as const;

function dueLabel(order: Order) {
  if (!order.dueDate) return { text: 'No due date', late: false };
  const days = Math.ceil((new Date(order.dueDate).getTime() - Date.now()) / 86_400_000);
  if (order.status === 'completed') return { text: `Due ${new Date(order.dueDate).toLocaleDateString()}`, late: false };
  if (days < 0) return { text: `${-days}d overdue`, late: true };
  return { text: days === 0 ? 'Due today' : `Due in ${days}d`, late: false };
}

export default function Production() {
  const canEdit = useAuth((s) => s.user?.role !== 'worker');
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [adding, setAdding] = useState(false);
  const [logging, setLogging] = useState<Order | null>(null);
  const [editing, setEditing] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState<Order | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<OrderStatus | null>(null);
  const [history, setHistory] = useState<Order | null>(null);
  const [quality, setQuality] = useState<Order | null>(null);
  const [boms, setBoms] = useState(false);
  const [search, setSearch] = useState('');
  const [machineId, setMachineId] = useState('');
  const [onlyBlocked, setOnlyBlocked] = useState(false);

  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: async () => (await api.get<{ data: Page<Order> }>('/orders', { params: { limit: 100 } })).data.data.items,
  });

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) => api.patch(`/orders/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
    onError: (e) => push({ tone: 'warning', title: 'Order not moved', body: errorMessage(e) }),
  });

  const all = orders.data ?? [];
  const bottlenecks = all.filter((o) => o.bottleneckFlag).length;
  const q = search.trim().toLowerCase();
  const items = all.filter((o) =>
    (!q || o.orderNo.toLowerCase().includes(q) || o.product.toLowerCase().includes(q))
    && (!machineId || o.machines.some((m) => m._id === machineId))
    && (!onlyBlocked || o.bottleneckFlag));
  const machineOptions = [...new Map(all.flatMap((o) => o.machines).map((m) => [m._id, m])).values()].sort((a, b) => a.code.localeCompare(b.code));
  const filtering = !!(q || machineId || onlyBlocked);

  function drop(status: OrderStatus) {
    const order = items.find((o) => o._id === dragId);
    setDragId(null);
    setOverCol(null);
    if (order && order.status !== status) move.mutate({ id: order._id, status });
  }

  return (
    <div>
      <PageHeader
        title="Production"
        subtitle={canEdit ? 'Drag an order to the next column, or use its action button. Orders can only move forward.' : 'Orders linked to your tasks.'}
        actions={canEdit && (
          <>
            <button className={`${btn.ghost} !py-1.5 text-xs`} onClick={() => setBoms(true)}>Bills of materials</button>
            <button className={btn.primary} onClick={() => setAdding(true)}><Plus size={15} className="mr-1 inline" />New order</button>
          </>
        )}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input aria-label="Search orders" placeholder="Search order number or product" value={search} onChange={(e) => setSearch(e.target.value)} className={`${input} pl-9`} />
        </div>
        <select aria-label="Filter by machine" className={`${input} !w-auto`} value={machineId} onChange={(e) => setMachineId(e.target.value)}>
          <option value="">All machines</option>
          {machineOptions.map((m) => <option key={m._id} value={m._id}>{m.code}</option>)}
        </select>
        <button
          aria-pressed={onlyBlocked} onClick={() => setOnlyBlocked((v) => !v)}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${onlyBlocked ? 'border-amber bg-amber/15 text-amber' : 'border-line text-muted hover:text-fg'}`}
        >
          Blocked only ({bottlenecks})
        </button>
        {filtering && <button className="text-xs text-muted underline hover:text-fg" onClick={() => { setSearch(''); setMachineId(''); setOnlyBlocked(false); }}>Clear filters</button>}
      </div>

      {bottlenecks > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber/40 bg-amber/10 px-4 py-2.5 text-sm text-amber" role="status">
          <AlertTriangle size={16} />
          {bottlenecks} {bottlenecks === 1 ? 'order is' : 'orders are'} blocked by an overdue date or an unavailable machine.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const list = items.filter((o) => o.status === col.status);
          return (
            <section
              key={col.status}
              onDragOver={(e) => { if (canEdit) { e.preventDefault(); setOverCol(col.status); } }}
              onDragLeave={() => setOverCol((c) => (c === col.status ? null : c))}
              onDrop={() => canEdit && drop(col.status)}
              aria-label={col.title}
              className={`min-w-0 rounded-2xl border p-3 transition-colors ${overCol === col.status ? 'border-amber bg-amber/5' : 'border-line bg-surface-2/40'}`}
            >
              <header className="mb-3 flex items-baseline justify-between px-1">
                <div>
                  <h2 className="font-display text-sm font-semibold">{col.title}</h2>
                  <p className="text-[11px] text-muted">{col.hint}</p>
                </div>
                <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-xs tabular-nums text-muted">{list.length}</span>
              </header>

              <div className="flex flex-col gap-2.5">
                {orders.isLoading && <Skeleton className="h-32" />}
                {list.map((o) => {
                  const due = dueLabel(o);
                  return (
                    <article
                      key={o._id} draggable={canEdit} onDragStart={() => setDragId(o._id)} onDragEnd={() => { setDragId(null); setOverCol(null); }}
                      className={`rounded-xl border bg-surface p-3.5 ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''} ${o.bottleneckFlag ? 'border-amber/60' : 'border-line'} ${dragId === o._id ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-[11px] text-muted">{o.orderNo}</p>
                          <h3 className="truncate text-sm font-semibold">{o.product}</h3>
                        </div>
                        {o.bottleneckFlag && (
                          <span className="shrink-0 rounded-md bg-amber/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber">Bottleneck</span>
                        )}
                      </div>

                      <div className="mt-3">
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="tabular-nums text-muted">{o.producedQty.toLocaleString()} / {o.quantity.toLocaleString()}</span>
                          <span className="font-mono tabular-nums">{o.progress}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-surface-2" role="progressbar" aria-valuenow={o.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${o.orderNo} progress`}>
                          <div className={`h-full rounded-full ${o.status === 'completed' ? 'bg-green' : 'bg-blue'}`} style={{ width: `${o.progress}%` }} />
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1">
                          {o.machines.map((m) => (
                            <span key={m._id} title={`${m.name} is ${m.status}`} className="inline-flex items-center gap-1 rounded-md bg-bg px-1.5 py-0.5 font-mono text-[10px]">
                              <span className={`size-1.5 rounded-full ${MACHINE_DOT[m.status]}`} />{m.code}
                            </span>
                          ))}
                          {o.machines.length === 0 && <span className="text-[11px] text-muted">No machines</span>}
                        </div>
                        <span className={`text-[11px] font-medium ${due.late ? 'text-red' : 'text-muted'}`}>{due.text}</span>
                      </div>
                      {o.materials.length > 0 && (
                        <p className="mt-2 text-[11px] leading-snug text-muted">
                          <span className="font-medium text-fg">{o.materialsConsumed ? 'Used:' : 'Needs:'}</span>{' '}
                          {o.materials.map((m) => `${m.item.name} ${Math.ceil(m.qtyPerUnit * o.quantity).toLocaleString()} ${m.item.unit}`).join(', ')}
                        </p>
                      )}

                      {canEdit && o.status !== 'completed' && (
                        <div className="mt-3 flex gap-2">
                          {o.status === 'in_progress' && <button className={`${btn.ghost} flex-1 !py-1.5 text-xs`} onClick={() => setLogging(o)}>Log output</button>}
                          <button
                            className={`${btn.ghost} flex-1 !py-1.5 text-xs`} disabled={move.isPending}
                            onClick={() => move.mutate({ id: o._id, status: o.status === 'pending' ? 'in_progress' : 'completed' })}
                          >
                            {o.status === 'pending' ? 'Start' : 'Complete'}
                          </button>
                        </div>
                      )}
                      {o.status !== 'pending' && (
                        <div className="mt-2 flex justify-end">
                          <button aria-label={`Quality checks for ${o.orderNo}`} title="Quality checks" className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg" onClick={() => setQuality(o)}><ClipboardCheck size={13} />Quality</button>
                        </div>
                      )}
                      {canEdit && (
                        <div className="mt-2 flex justify-end gap-1">
                          <button aria-label={`Output history for ${o.orderNo}`} title="Output history" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => setHistory(o)}><History size={13} /></button>
                          {o.status !== 'completed' && <button aria-label={`Edit ${o.orderNo}`} title="Edit order" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => setEditing(o)}><Pencil size={13} /></button>}
                          {o.status !== 'in_progress' && <button aria-label={`Delete ${o.orderNo}`} title="Delete order" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-red" onClick={() => setDeleting(o)}><Trash2 size={13} /></button>}
                        </div>
                      )}
                    </article>
                  );
                })}
                {!orders.isLoading && list.length === 0 && <EmptyState title={filtering ? 'No orders match the filters' : 'Nothing here'} />}
              </div>
            </section>
          );
        })}
      </div>

      {adding && <OrderForm onClose={() => setAdding(false)} />}
      {editing && <OrderForm order={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteOrder order={deleting} onClose={() => setDeleting(null)} />}
      {quality && <QualityModal order={quality} onClose={() => setQuality(null)} />}
      {boms && <BomManager onClose={() => setBoms(false)} />}
      {history && <OrderHistory order={history} onClose={() => setHistory(null)} />}
      {logging && <LogOutput order={logging} onClose={() => setLogging(null)} />}
    </div>
  );
}

interface MaterialRow { item: string; qtyPerUnit: string }

function OrderForm({ order, onClose }: { order?: Order; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = Boolean(order);
  const started = Boolean(order && order.status !== 'pending');
  const lockQty = started && (order?.materials.length ?? 0) > 0;
  const [f, setF] = useState({ product: order?.product ?? '', quantity: order ? String(order.quantity) : '', dueDate: order?.dueDate ? order.dueDate.slice(0, 10) : '' });
  const [picked, setPicked] = useState<string[]>(order?.machines.map((m) => m._id) ?? []);
  const [materials, setMaterials] = useState<MaterialRow[]>(order?.materials.map((m) => ({ item: m.item._id, qtyPerUnit: String(m.qtyPerUnit) })) ?? []);
  const [error, setError] = useState('');

  const machines = useQuery({
    queryKey: ['machines', 'all'],
    queryFn: async () => (await api.get<{ data: Page<Machine> }>('/machines', { params: { limit: 100 } })).data.data.items,
  });
  const stock = useQuery({
    queryKey: ['inventory', 'all'],
    queryFn: async () => (await api.get<{ data: Page<InventoryItem> }>('/inventory', { params: { limit: 100 } })).data.data.items,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        product: f.product, quantity: Number(f.quantity), machines: picked,
        dueDate: f.dueDate ? new Date(`${f.dueDate}T23:59:00`).toISOString() : undefined,
        ...(!started && { materials: materials.filter((m) => m.item && Number(m.qtyPerUnit) > 0).map((m) => ({ item: m.item, qtyPerUnit: Number(m.qtyPerUnit) })) }),
      };
      return editing ? api.patch(`/orders/${order!._id}`, body) : api.post('/orders', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });

  const setRow = (i: number, patch: Partial<MaterialRow>) => setMaterials(materials.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const qty = Number(f.quantity) || 0;

  return (
    <Modal title={editing ? `Edit ${order!.orderNo}` : 'New production order'} onClose={onClose} wide>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); save.mutate(); }} className="flex flex-col gap-3">
        <Field label="Product" htmlFor="o-product"><input id="o-product" required className={input} value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" htmlFor="o-qty"><input id="o-qty" type="number" min="1" required disabled={lockQty} className={input} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          <Field label="Due date" htmlFor="o-due"><input id="o-due" type="date" className={input} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
        </div>
        {lockQty && <p className="-mt-1 text-xs text-muted">Quantity is locked because this order has already taken its materials from stock.</p>}

        <fieldset>
          <legend className="mb-1 text-xs font-medium text-muted">Machines</legend>
          <div className="grid max-h-36 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border border-line bg-bg p-2 sm:grid-cols-3">
            {machines.data?.map((m) => (
              <label key={m._id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-surface-2">
                <input type="checkbox" checked={picked.includes(m._id)} onChange={(e) => setPicked(e.target.checked ? [...picked, m._id] : picked.filter((x) => x !== m._id))} />
                <span className="font-mono">{m.code}</span><span className="truncate text-muted">{m.status}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={started}>
          <legend className="mb-1 text-xs font-medium text-muted">Materials per unit produced{started ? ' (locked once started)' : ''}</legend>
          <div className="flex flex-col gap-2">
            {materials.map((row, i) => {
              const item = stock.data?.find((x) => x._id === row.item);
              const need = Math.ceil((Number(row.qtyPerUnit) || 0) * qty);
              const short = item && need > item.quantity;
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select aria-label={`Material ${i + 1}`} className={`${input} !w-auto min-w-0 flex-1`} value={row.item} onChange={(e) => setRow(i, { item: e.target.value })}>
                    <option value="">Choose an item</option>
                    {stock.data?.map((x) => <option key={x._id} value={x._id} disabled={materials.some((m, j) => j !== i && m.item === x._id)}>{x.name} ({x.sku})</option>)}
                  </select>
                  <input aria-label={`Quantity per unit for material ${i + 1}`} type="number" min="0" step="any" placeholder="per unit" className={`${input} !w-24`} value={row.qtyPerUnit} onChange={(e) => setRow(i, { qtyPerUnit: e.target.value })} />
                  <span className={`min-w-28 text-xs tabular-nums ${short ? 'font-medium text-red' : 'text-muted'}`}>
                    {item ? `needs ${need.toLocaleString()} of ${item.quantity.toLocaleString()} ${item.unit}` : ''}
                  </span>
                  {!started && <button type="button" aria-label={`Remove material ${i + 1}`} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg" onClick={() => setMaterials(materials.filter((_, j) => j !== i))}><X size={14} /></button>}
                </div>
              );
            })}
            {!started && <button type="button" className={`${btn.ghost} self-start !py-1 text-xs`} onClick={() => setMaterials([...materials, { item: '', qtyPerUnit: '' }])}><Plus size={12} className="mr-1 inline" />Add material</button>}
            {materials.length === 0 && started && <p className="text-xs text-muted">No materials were listed for this order.</p>}
          </div>
          {!started && materials.length > 0 && <p className="mt-2 text-xs text-muted">Stock is taken when the order starts. If anything is short, the order will not start and nothing is taken.</p>}
        </fieldset>

        {!editing && <FeasibilityBox product={f.product} quantity={Number(f.quantity) || 0} machines={picked} />}
        {!editing && materials.length === 0 && <p className="text-xs text-muted">Leave materials empty to copy the product&apos;s bill of materials, if it has one.</p>}

        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={save.isPending}>{editing ? 'Save changes' : 'Create order'}</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteOrder({ order, onClose }: { order: Order; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const del = useMutation({
    mutationFn: () => api.delete(`/orders/${order._id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['alerts'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <ConfirmDialog
      title={`Delete ${order.orderNo}?`} busy={del.isPending} error={error} onCancel={onClose} onConfirm={() => del.mutate()}
      message={<>Remove <strong className="text-fg">{order.product}</strong>. {order.materialsConsumed ? 'Materials it already used are not returned to stock. ' : ''}Output already logged stays in the analytics history. This cannot be undone.</>}
    />
  );
}

function LogOutput({ order, onClose }: { order: Order; onClose: () => void }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState(String(order.producedQty));
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => api.patch(`/orders/${order._id}/progress`, { producedQty: Number(qty) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal title={`Log output: ${order.orderNo}`} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setError(''); save.mutate(); }} className="flex flex-col gap-3">
        <Field label={`Total produced so far (ordered: ${order.quantity})`} htmlFor="o-produced">
          <input id="o-produced" type="number" min="0" max={order.quantity} required autoFocus className={input} value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-red">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn.primary} disabled={save.isPending}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function OrderHistory({ order, onClose }: { order: Order; onClose: () => void }) {
  const log = useQuery({
    queryKey: ['orders', order._id, 'output'],
    queryFn: async () => (await api.get<{ data: { _id: string; qty: number; at: string }[] }>(`/orders/${order._id}/output`)).data.data,
  });
  return (
    <Modal title={`${order.orderNo}: output history`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">{order.product}: {order.producedQty.toLocaleString()} of {order.quantity.toLocaleString()} made ({order.progress}%).</p>
      {order.materials.length > 0 && (
        <p className="mb-3 text-xs text-muted">
          Materials {order.materialsConsumed ? 'taken from stock' : 'reserved on start'}: {order.materials.map((m) => `${m.item.name} ${Math.ceil(m.qtyPerUnit * order.quantity).toLocaleString()} ${m.item.unit}`).join(', ')}
        </p>
      )}
      {log.isLoading && <Skeleton className="h-20" />}
      {log.data?.length === 0 && <EmptyState title="No output logged yet" />}
      <ul className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto text-sm">
        {log.data?.map((x) => (
          <li key={x._id} className="flex justify-between py-2"><span className="tabular-nums">+{x.qty.toLocaleString()} units</span><span className="text-xs text-muted">{new Date(x.at).toLocaleString()}</span></li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end"><button className={btn.ghost} onClick={onClose}>Close</button></div>
    </Modal>
  );
}
