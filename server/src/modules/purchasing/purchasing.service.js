import { InventoryItem, PurchaseOrder, Supplier } from '../../models/index.js';
import { emit } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { addTransaction } from '../inventory/inventory.service.js';

const OPEN = ['draft', 'approved'];
const POPULATE = [
  { path: 'supplier', select: 'name leadTimeDays email' },
  { path: 'lines.item', select: 'sku name unit quantity reorderThreshold' },
  { path: 'createdBy approvedBy', select: 'name' },
];

// ---- suppliers ----

export const listSuppliers = () => Supplier.find().sort({ name: 1 }).lean();

export async function createSupplier(data) {
  if (await Supplier.exists({ name: new RegExp(`^${data.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })) throw ApiError.conflict('A supplier with this name already exists');
  return (await Supplier.create(data)).toObject();
}

export async function updateSupplier(id, data) {
  const s = await Supplier.findByIdAndUpdate(id, data, { new: true, runValidators: true }).lean();
  if (!s) throw ApiError.notFound('Supplier not found');
  return s;
}

export async function removeSupplier(id) {
  if (await PurchaseOrder.exists({ supplier: id, status: { $in: OPEN } })) throw ApiError.conflict('This supplier has open purchase orders. Cancel or receive them first.');
  const s = await Supplier.findByIdAndDelete(id);
  if (!s) throw ApiError.notFound('Supplier not found');
  await InventoryItem.updateMany({ supplierRef: id }, { $unset: { supplierRef: 1 } });
}

// ---- purchase orders ----

async function nextNo() {
  const [last] = await PurchaseOrder.find({ poNo: /^PUR-\d+$/ }).sort({ poNo: -1 }).limit(1).lean();
  return `PUR-${last ? Number(last.poNo.slice(4)) + 1 : 5001}`;
}

async function insert(data) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await PurchaseOrder.create({ ...data, poNo: await nextNo() });
    } catch (err) {
      if (err?.code !== 11000 || attempt >= 4) throw err;
    }
  }
}

export async function getById(id) {
  const po = await PurchaseOrder.findById(id).populate(POPULATE).lean();
  if (!po) throw ApiError.notFound('Purchase order not found');
  return withTotal(po);
}

const withTotal = (po) => ({ ...po, total: Math.round(po.lines.reduce((n, l) => n + l.qty * l.unitCost, 0) * 100) / 100 });

export async function list({ status, supplier, page, limit }) {
  const filter = {};
  if (status) filter.status = status;
  if (supplier) filter.supplier = supplier;
  const res = await paginate(PurchaseOrder, filter, { page, limit, populate: POPULATE });
  return { ...res, items: res.items.map(withTotal) };
}

async function checkRefs({ supplier, lines }) {
  if (supplier && !(await Supplier.exists({ _id: supplier }))) throw ApiError.badRequest('Supplier does not exist');
  if (lines) {
    const ids = lines.map((l) => String(l.item));
    if (new Set(ids).size !== ids.length) throw ApiError.badRequest('Each item can appear on a purchase order only once');
    if ((await InventoryItem.countDocuments({ _id: { $in: ids } })) !== ids.length) throw ApiError.badRequest('A line refers to an item that does not exist');
  }
}

export async function create(data, userId) {
  await checkRefs(data);
  const po = await insert({ ...data, createdBy: userId });
  emit('purchase:updated', { _id: String(po._id), status: po.status }, 'room:staff');
  return getById(po._id);
}

export async function update(id, data) {
  const po = await PurchaseOrder.findById(id);
  if (!po) throw ApiError.notFound('Purchase order not found');
  if (po.status !== 'draft') throw ApiError.conflict('Only a draft can be edited');
  await checkRefs(data);
  Object.assign(po, data);
  await po.save();
  emit('purchase:updated', { _id: id, status: po.status }, 'room:staff');
  return getById(id);
}

export async function approve(id, userId) {
  const po = await PurchaseOrder.findById(id);
  if (!po) throw ApiError.notFound('Purchase order not found');
  if (po.status !== 'draft') throw ApiError.conflict(`A ${po.status} purchase order cannot be approved`);
  if (!po.supplier) throw ApiError.badRequest('Choose a supplier before approving');
  if (!po.lines.length) throw ApiError.badRequest('Add at least one line before approving');
  // The status is part of the filter, so two managers approving at once cannot both succeed.
  const done = await PurchaseOrder.updateOne({ _id: id, status: 'draft' }, { status: 'approved', approvedBy: userId, approvedAt: new Date() });
  if (!done.modifiedCount) throw ApiError.conflict('This purchase order was just changed by someone else');
  emit('purchase:updated', { _id: id, status: 'approved' }, 'room:staff');
  return getById(id);
}

export async function receive(id, userId) {
  const po = await PurchaseOrder.findById(id);
  if (!po) throw ApiError.notFound('Purchase order not found');
  if (po.status !== 'approved') throw ApiError.conflict(po.status === 'draft' ? 'Approve the purchase order before receiving it' : `A ${po.status} purchase order cannot be received`);
  const ids = po.lines.map((l) => l.item);
  if ((await InventoryItem.countDocuments({ _id: { $in: ids } })) !== ids.length) throw ApiError.conflict('An item on this order no longer exists in inventory');

  // Claim it first so a double click cannot add the stock twice.
  const claim = await PurchaseOrder.updateOne({ _id: id, status: 'approved' }, { status: 'received', receivedAt: new Date() });
  if (!claim.modifiedCount) throw ApiError.conflict('This purchase order was just received');
  for (const l of po.lines) await addTransaction(l.item, { type: 'in', qty: l.qty }, userId);
  emit('purchase:updated', { _id: id, status: 'received' }, 'room:staff');
  return getById(id);
}

export async function cancel(id) {
  const res = await PurchaseOrder.updateOne({ _id: id, status: { $in: OPEN } }, { status: 'cancelled' });
  if (!res.modifiedCount) {
    if (!(await PurchaseOrder.exists({ _id: id }))) throw ApiError.notFound('Purchase order not found');
    throw ApiError.conflict('Only a draft or approved purchase order can be cancelled');
  }
  emit('purchase:updated', { _id: id, status: 'cancelled' }, 'room:staff');
  return getById(id);
}

const reorderQty = (item) => Math.max(1, Math.ceil(item.reorderThreshold * 2 - item.quantity));

/**
 * Adds a reorder line for a low-stock item to a draft for its supplier, unless an open purchase
 * order already covers it. Never approves anything: a person always does that.
 */
export async function draftForItem(item) {
  if (await PurchaseOrder.exists({ status: { $in: OPEN }, 'lines.item': item._id })) return null;
  const line = { item: item._id, qty: reorderQty(item), unitCost: item.unitCost ?? 0 };
  const supplier = item.supplierRef ?? undefined;
  const draft = await PurchaseOrder.findOne({ status: 'draft', createdFromAlert: true, supplier: supplier ?? null });
  const po = draft
    ? await PurchaseOrder.findOneAndUpdate({ _id: draft._id, status: 'draft' }, { $push: { lines: line } }, { new: true })
    : await insert({ supplier, lines: [line], createdFromAlert: true, notes: 'Drafted automatically from low-stock alerts.' });
  emit('purchase:updated', { _id: String(po._id), status: 'draft' }, 'room:staff');
  return po;
}

/** Drafts for every item currently under its reorder level (for stock that fell before this existed). */
export async function draftFromLowStock() {
  const low = await InventoryItem.find({ $expr: { $lt: ['$quantity', '$reorderThreshold'] } }).lean();
  let drafted = 0;
  for (const item of low) if (await draftForItem(item)) drafted += 1;
  return { drafted, checked: low.length };
}
