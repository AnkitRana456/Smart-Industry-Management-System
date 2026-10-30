import { InventoryItem, StockTransaction } from '../../models/index.js';
import { emit } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import * as alerts from '../alerts/alert.service.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LOW = { $expr: { $lt: ['$quantity', '$reorderThreshold'] } };

export function list({ search, lowStock, page, limit }) {
  const filter = {};
  if (search) {
    const re = new RegExp(escapeRe(search), 'i');
    filter.$or = [{ name: re }, { sku: re }, { supplier: re }];
  }
  if (lowStock === 'true') Object.assign(filter, LOW);
  return paginate(InventoryItem, filter, { page, limit, sort: { sku: 1 } });
}

export const lowStock = () => InventoryItem.find(LOW).sort({ sku: 1 }).lean();

export async function getById(id) {
  const item = await InventoryItem.findById(id).lean();
  if (!item) throw ApiError.notFound('Inventory item not found');
  return item;
}

export async function create(data, userId) {
  if (await InventoryItem.exists({ sku: data.sku })) throw ApiError.conflict('SKU already exists');
  const item = await InventoryItem.create(data);
  if (data.quantity > 0) {
    await StockTransaction.create({ item: item._id, type: 'in', qty: data.quantity, by: userId });
  }
  await afterChange(item);
  return item;
}

export async function update(id, data) {
  const item = await InventoryItem.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!item) throw ApiError.notFound('Inventory item not found');
  await afterChange(item);
  return item;
}

export async function remove(id) {
  const item = await InventoryItem.findByIdAndDelete(id);
  if (!item) throw ApiError.notFound('Inventory item not found');
  await alerts.resolveFor('low_stock', id);
}

/**
 * Atomic stock movement: the quantity guard lives in the update filter, so
 * concurrent stock-outs can never push stock below zero.
 */
export async function addTransaction(id, { type, qty }, userId) {
  const delta = type === 'out' ? -qty : qty;
  const filter = { _id: id };
  if (delta < 0) filter.quantity = { $gte: -delta };

  const item = await InventoryItem.findOneAndUpdate(filter, { $inc: { quantity: delta } }, { new: true });
  if (!item) {
    if (!(await InventoryItem.exists({ _id: id }))) throw ApiError.notFound('Inventory item not found');
    throw ApiError.conflict('Insufficient stock for this transaction');
  }

  const tx = await StockTransaction.create({ item: id, type, qty, by: userId });
  await afterChange(item);
  return { item, transaction: tx };
}

/**
 * Takes everything an order needs, or nothing. Each decrement is a guarded atomic update, so
 * stock never goes negative even when orders start at the same moment; if any material is
 * short, the ones already taken are put back and the order is refused with the shortages named.
 * Transactions, alerts and events are only written once every material has been secured.
 * Returns an `undo` that restores the stock if a later step fails.
 */
export async function consumeForOrder(order, userId) {
  const taken = [];
  const restore = () => Promise.all(taken.map((t) => InventoryItem.updateOne({ _id: t.item._id }, { $inc: { quantity: t.qty } })));

  for (const m of order.materials) {
    const qty = Math.ceil(m.qtyPerUnit * order.quantity);
    const item = await InventoryItem.findOneAndUpdate({ _id: m.item, quantity: { $gte: qty } }, { $inc: { quantity: -qty } }, { new: true });
    if (item) {
      taken.push({ item, qty });
      continue;
    }
    await restore();
    const current = await InventoryItem.findById(m.item).lean();
    throw ApiError.conflict(
      current
        ? `Not enough ${current.name} to start this order: needs ${qty} ${current.unit}, ${current.quantity} available.`
        : 'A material on this order no longer exists in inventory.',
    );
  }

  for (const { item, qty } of taken) {
    await StockTransaction.create({ item: item._id, type: 'out', qty, order: order._id, by: userId });
    await afterChange(item);
  }
  return { consumed: taken.map((t) => ({ sku: t.item.sku, qty: t.qty })), undo: restore };
}

export async function transactions(id, { page, limit }) {
  await getById(id);
  return paginate(StockTransaction, { item: id }, { page, limit, populate: { path: 'by', select: 'name' } });
}

async function afterChange(item) {
  emit('inventory:updated', item.toObject(), 'room:all');
  if (item.quantity < item.reorderThreshold) {
    const created = await alerts.create({
      type: 'low_stock', severity: item.quantity === 0 ? 'critical' : 'warning', source: 'inventory', sourceId: item._id,
      message: `${item.name} (${item.sku}) is below its reorder threshold: ${item.quantity} ${item.unit} left, minimum ${item.reorderThreshold}.`,
    });
    if (created) {
      emit('inventory:low', item.toObject(), 'room:staff');
      // Loaded lazily: purchasing imports this module to post received stock.
      const { draftForItem } = await import('../purchasing/purchasing.service.js');
      await draftForItem(item);
    }
  } else {
    await alerts.resolveFor('low_stock', item._id);
  }
}

/** Stock value at cost. Items without a unit cost are counted separately rather than treated as free. */
export async function valuation() {
  const items = await InventoryItem.find().sort({ sku: 1 }).lean();
  const rows = items.map((i) => ({ sku: i.sku, name: i.name, quantity: i.quantity, unit: i.unit, unitCost: i.unitCost ?? null, value: i.unitCost == null ? null : Math.round(i.quantity * i.unitCost * 100) / 100 }));
  return {
    totalValue: Math.round(rows.reduce((n, r) => n + (r.value ?? 0), 0) * 100) / 100,
    itemsWithoutCost: rows.filter((r) => r.unitCost == null).length,
    items: rows,
  };
}

/**
 * Upserts by SKU. A new SKU is created; an existing one has its details updated and, when the file's
 * quantity differs, an 'adjust' transaction records the change so the history stays complete.
 * Each row stands alone: one bad row is reported and the rest still import.
 */
export async function importRows(rows, userId) {
  const result = { created: 0, updated: 0, errors: [] };
  for (const [i, row] of rows.entries()) {
    try {
      const existing = await InventoryItem.findOne({ sku: row.sku }).lean();
      if (!existing) {
        await create(row, userId);
        result.created += 1;
      } else {
        const { quantity, ...details } = row;
        await update(existing._id, details);
        if (quantity !== existing.quantity) await addTransaction(existing._id, { type: 'adjust', qty: quantity - existing.quantity }, userId);
        result.updated += 1;
      }
    } catch (err) {
      result.errors.push({ row: i + 1, sku: row.sku, message: err?.message ?? 'Failed' });
    }
  }
  return result;
}
