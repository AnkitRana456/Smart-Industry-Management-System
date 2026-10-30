import { InventoryItem, Machine, OutputLog, ProductionOrder, Task } from '../../models/index.js';
import { emit } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import * as alerts from '../alerts/alert.service.js';
import { consumeForOrder } from '../inventory/inventory.service.js';
import { materialsFor } from '../planning/planning.service.js';
import { forUser } from '../workers/worker.service.js';

const TRANSITIONS = { pending: ['in_progress'], in_progress: ['completed'], completed: [] };
const DOWN = ['offline', 'maintenance'];
const POPULATE = [{ path: 'machines', select: 'code name status' }, { path: 'materials.item', select: 'sku name unit quantity' }];

async function checkMaterials(materials = []) {
  if (!materials.length) return;
  const ids = materials.map((m) => String(m.item));
  if (new Set(ids).size !== ids.length) throw ApiError.badRequest('Each material can be listed only once');
  if ((await InventoryItem.countDocuments({ _id: { $in: ids } })) !== ids.length) throw ApiError.badRequest('One or more materials are not inventory items');
}

async function checkMachines(ids = []) {
  if (!ids.length) return;
  const found = await Machine.countDocuments({ _id: { $in: ids } });
  if (found !== new Set(ids.map(String)).size) throw ApiError.badRequest('One or more machines do not exist');
}

async function nextOrderNo() {
  const [last] = await ProductionOrder.find({ orderNo: /^PO-\d+$/ }).sort({ orderNo: -1 }).limit(1).lean();
  const n = last ? Number(last.orderNo.slice(3)) + 1 : 2001;
  return `PO-${n}`;
}

/** Only positive increments are logged, so daily output totals stay additive. */
async function recordOutput(order, delta) {
  if (delta > 0) await OutputLog.create({ order: order._id, product: order.product, qty: delta });
}

/**
 * Bottleneck rule: an in-progress order that is past its due date, or that
 * depends on a machine that is offline or in maintenance. Flags are persisted
 * so reports and the AI layer read the same value the UI shows.
 */
export async function refreshBottlenecks() {
  const now = new Date();
  const orders = await ProductionOrder.find({ $or: [{ status: 'in_progress' }, { bottleneckFlag: true }] }).populate(POPULATE);
  for (const order of orders) {
    const overdue = order.status === 'in_progress' && order.dueDate && order.dueDate < now;
    const downMachines = order.status === 'in_progress' ? order.machines.filter((m) => DOWN.includes(m.status)) : [];
    const flag = Boolean(overdue || downMachines.length);
    if (flag === order.bottleneckFlag) continue;

    order.bottleneckFlag = flag;
    await order.save();
    emit('order:updated', order.toObject());

    if (flag) {
      const reasons = [overdue && 'past its due date', downMachines.length && `waiting on ${downMachines.map((m) => m.code).join(', ')}`].filter(Boolean);
      await alerts.create({
        type: 'bottleneck', severity: 'warning', source: 'production', sourceId: order._id,
        message: `Order ${order.orderNo} (${order.product}) is a bottleneck: ${reasons.join(' and ')}.`,
      });
    } else {
      await alerts.resolveFor('bottleneck', order._id);
    }
  }
}

export async function list({ status, bottleneck, page, limit }, user) {
  await refreshBottlenecks();
  const filter = {};
  if (status) filter.status = status;
  if (bottleneck === 'true') filter.bottleneckFlag = true;
  if (user.role === 'worker') {
    const me = await forUser(user.id);
    const orderIds = await Task.find({ assignedTo: me._id, order: { $ne: null } }).distinct('order');
    filter._id = { $in: orderIds };
  }
  return paginate(ProductionOrder, filter, { page, limit, sort: { dueDate: 1 }, populate: POPULATE });
}

export async function getById(id) {
  const order = await ProductionOrder.findById(id).populate(POPULATE).lean();
  if (!order) throw ApiError.notFound('Order not found');
  return order;
}

export async function create(data) {
  // An order with no materials of its own takes the product's bill of materials, when there is one.
  if (!data.materials?.length) data = { ...data, materials: await materialsFor(data.product) };
  await checkMachines(data.machines);
  await checkMaterials(data.materials);
  const order = await ProductionOrder.create({ ...data, orderNo: data.orderNo ?? (await nextOrderNo()) });
  const full = await getById(order._id);
  emit('order:updated', full);
  return full;
}

export async function update(id, data) {
  const order = await ProductionOrder.findById(id);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.status === 'completed') throw ApiError.conflict('Completed orders cannot be edited');
  if (data.machines) await checkMachines(data.machines);
  if (data.materials) {
    if (order.status !== 'pending') throw ApiError.conflict('Materials can only be changed before the order starts.');
    await checkMaterials(data.materials);
  }
  if (data.quantity != null && order.status !== 'pending' && order.materials.length) {
    throw ApiError.conflict('Quantity cannot change after the order has started, because its materials were already taken.');
  }
  if (data.quantity != null && data.quantity < order.producedQty) {
    throw ApiError.badRequest('Quantity cannot be lower than what is already produced');
  }
  Object.assign(order, data);
  order.progress = Math.round((order.producedQty / order.quantity) * 100);
  await order.save();
  await refreshBottlenecks();
  const full = await getById(id);
  emit('order:updated', full);
  return full;
}

export async function setStatus(id, next, userId) {
  const order = await ProductionOrder.findById(id).populate(POPULATE[0]);
  if (!order) throw ApiError.notFound('Order not found');
  if (!TRANSITIONS[order.status].includes(next)) {
    throw ApiError.conflict(`Cannot move an order from ${order.status} to ${next}`);
  }

  let consumption = null;
  if (next === 'in_progress') {
    const down = order.machines.filter((m) => DOWN.includes(m.status));
    if (down.length) throw ApiError.conflict(`Machines unavailable: ${down.map((m) => `${m.code} (${m.status})`).join(', ')}`);
    if (order.materials.length && !order.materialsConsumed) {
      consumption = await consumeForOrder(order, userId);
      order.materialsConsumed = true;
    }
    order.startedAt = new Date();
  }
  if (next === 'completed') {
    await recordOutput(order, order.quantity - order.producedQty);
    order.producedQty = order.quantity;
    order.progress = 100;
    order.bottleneckFlag = false;
    await alerts.resolveFor('bottleneck', order._id);
  }
  order.status = next;
  try {
    await order.save();
  } catch (err) {
    // Never leave stock taken for an order that did not start.
    await consumption?.undo();
    throw err;
  }
  await refreshBottlenecks();

  const full = await getById(id);
  emit('order:updated', full);
  return full;
}

export async function setProgress(id, producedQty) {
  const order = await ProductionOrder.findById(id);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.status !== 'in_progress') throw ApiError.conflict('Only in-progress orders can record output');
  if (producedQty > order.quantity) throw ApiError.badRequest(`Cannot exceed the ordered quantity (${order.quantity})`);
  await recordOutput(order, producedQty - order.producedQty);
  order.producedQty = producedQty;
  order.progress = Math.round((producedQty / order.quantity) * 100);
  await order.save();
  const full = await getById(id);
  emit('order:updated', full);
  return full;
}

export async function remove(id) {
  const order = await ProductionOrder.findById(id);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.status === 'in_progress') throw ApiError.conflict('Complete or edit an in-progress order instead of deleting it');
  await order.deleteOne();
  await alerts.resolveFor('bottleneck', id);
  emit('order:updated', { _id: String(id), deleted: true });
}

/** Newest-first output entries for one order. */
export async function outputHistory(id, limit = 50) {
  if (!(await ProductionOrder.exists({ _id: id }))) throw ApiError.notFound('Order not found');
  return OutputLog.find({ order: id }).sort({ at: -1 }).limit(limit).select('qty at').lean();
}
