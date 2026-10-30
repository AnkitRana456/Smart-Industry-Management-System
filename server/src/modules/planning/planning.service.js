import { Attendance, BOM, InventoryItem, Machine, ProductionOrder, QualityCheck, User } from '../../models/index.js';
import { emit } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { dayKey } from '../../utils/time.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactProduct = (p) => new RegExp(`^${escapeRe(p.trim())}$`, 'i');
const POPULATE_BOM = { path: 'items.item', select: 'sku name unit quantity' };

// ---- bill of materials ----

async function checkItems(items) {
  const ids = items.map((i) => String(i.item));
  if (new Set(ids).size !== ids.length) throw ApiError.badRequest('Each material can be listed only once');
  if ((await InventoryItem.countDocuments({ _id: { $in: ids } })) !== ids.length) throw ApiError.badRequest('One or more materials are not inventory items');
}

export const listBoms = () => BOM.find().sort({ product: 1 }).populate(POPULATE_BOM).lean();

export async function createBom({ product, items }) {
  if (await BOM.exists({ product: exactProduct(product) })) throw ApiError.conflict('A bill of materials for this product already exists');
  await checkItems(items);
  const bom = await BOM.create({ product: product.trim(), items });
  return BOM.findById(bom._id).populate(POPULATE_BOM).lean();
}

export async function updateBom(id, { items }) {
  await checkItems(items);
  const bom = await BOM.findByIdAndUpdate(id, { items }, { new: true, runValidators: true }).populate(POPULATE_BOM).lean();
  if (!bom) throw ApiError.notFound('Bill of materials not found');
  return bom;
}

export async function removeBom(id) {
  if (!(await BOM.findByIdAndDelete(id))) throw ApiError.notFound('Bill of materials not found');
}

/** The materials an order for this product should carry, or [] when no BOM exists. */
export async function materialsFor(product) {
  const bom = await BOM.findOne({ product: exactProduct(product) }).lean();
  return bom ? bom.items.map((i) => ({ item: i.item, qtyPerUnit: i.qtyPerUnit })) : [];
}

// ---- quality checks ----

export async function logCheck(data, user) {
  const order = await ProductionOrder.findById(data.order).select('orderNo status').lean();
  if (!order) throw ApiError.badRequest('Order does not exist');
  if (order.status === 'pending') throw ApiError.conflict('Quality checks can be logged once the order has started');
  if (data.defectCount > data.inspectedQty) throw ApiError.badRequest('Defects cannot exceed the number inspected');
  if (data.scrapQty > data.inspectedQty) throw ApiError.badRequest('Scrap cannot exceed the number inspected');
  const check = await QualityCheck.create({ ...data, checkedBy: user.id });
  emit('quality:updated', { order: String(data.order) }, 'room:staff');
  return check.toObject();
}

export async function listChecks(orderId) {
  return QualityCheck.find({ order: orderId }).sort({ createdAt: -1 }).populate('checkedBy', 'name').lean();
}

export async function qualitySummary(orderId) {
  const [row] = await QualityCheck.aggregate([
    { $match: { order: orderId } },
    { $group: { _id: null, inspected: { $sum: '$inspectedQty' }, defects: { $sum: '$defectCount' }, scrap: { $sum: '$scrapQty' }, checks: { $sum: 1 } } },
  ]);
  return { checks: row?.checks ?? 0, inspected: row?.inspected ?? 0, defects: row?.defects ?? 0, scrap: row?.scrap ?? 0 };
}

// ---- feasibility ----

/**
 * Can we take this order? Deterministic arithmetic over stock, machines and today's attendance.
 * It does not model production rates, so "feasible" means the inputs exist, not that a due date
 * will be met. The AI assistant may explain this result but never produces it.
 */
export async function feasibility({ product, quantity, machines: wanted = [] }) {
  const bomItems = await materialsFor(product);
  const stock = await InventoryItem.find({ _id: { $in: bomItems.map((m) => m.item) } }).lean();
  const byId = new Map(stock.map((s) => [String(s._id), s]));

  const materials = bomItems.map((m) => {
    const s = byId.get(String(m.item));
    const needed = Math.ceil(m.qtyPerUnit * quantity);
    return { sku: s?.sku, name: s?.name, unit: s?.unit, needed, available: s?.quantity ?? 0, short: Math.max(0, needed - (s?.quantity ?? 0)), enough: (s?.quantity ?? 0) >= needed };
  });

  const filter = wanted.length ? { _id: { $in: wanted } } : {};
  const all = await Machine.find(filter).select('code name status').lean();
  const usable = all.filter((m) => m.status === 'running' || m.status === 'idle');
  const [checkedIn, activeUsers] = await Promise.all([
    Attendance.countDocuments({ date: dayKey(), status: { $in: ['present', 'late'] } }),
    User.countDocuments({ role: 'worker', isActive: true }),
  ]);

  const problems = [];
  if (!bomItems.length) problems.push(`No bill of materials is defined for "${product}", so materials could not be checked.`);
  for (const m of materials.filter((x) => !x.enough)) problems.push(`${m.name} is short by ${m.short} ${m.unit}.`);
  if (wanted.length && usable.length < all.length) problems.push(`${all.length - usable.length} of the chosen machines are offline or in maintenance.`);
  if (!usable.length) problems.push('No machine is available (running or idle).');
  if (checkedIn === 0) problems.push('No worker has checked in today.');

  return {
    product, quantity,
    feasible: problems.length === 0,
    hasBom: bomItems.length > 0,
    materials,
    machines: { considered: all.length, available: usable.length, unavailable: all.filter((m) => !usable.includes(m)).map((m) => ({ code: m.code, status: m.status })) },
    workers: { checkedInToday: checkedIn, activeAccounts: activeUsers },
    problems,
    note: 'Checks stock, machine status and today\'s attendance. Production rates are not modelled, so this does not promise a delivery date.',
  };
}
