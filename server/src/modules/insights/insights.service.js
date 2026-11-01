import { z } from 'zod';
import { env } from '../../config/env.js';
import { InventoryItem, Machine, OutputLog, ProductionOrder, SensorReading, StockTransaction, Supplier } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { dayKey, lastDayKeys } from '../../utils/time.js';
import * as client from '../ml/ml.client.js';

const DAY = 86_400_000;
const HISTORY_DAYS = 30;
const MIN_ANOMALY_HISTORY = 30;
const RECENT_POINTS = 10;

const point = z.object({ day: z.number(), expected: z.number(), low: z.number(), high: z.number() });
const forecastSchema = z.object({
  daysOfHistory: z.number(), averagePerDay: z.number(), recentPerDay: z.number(), trendPerDay: z.number(), noise: z.number(),
  forecast: z.array(point), confidence: z.enum(['ok', 'low']),
  expectedDays: z.number().nullable().optional(), earliestDays: z.number().nullable().optional(), latestDays: z.number().nullable().optional(),
  withinHorizon: z.boolean().optional(), usesLevel: z.boolean().optional(),
});
const anomalySchema = z.object({
  historyPoints: z.number(), flagged: z.number(),
  baseline: z.record(z.number()),
  points: z.array(z.object({ anomalous: z.boolean(), score: z.number(), mostUnusual: z.object({ feature: z.string(), value: z.number(), typical: z.number(), deviation: z.number() }) })),
});

async function ml(path, body, schema) {
  const parsed = schema.safeParse(await client.post(path, body));
  if (!parsed.success) throw new ApiError(502, 'The risk model service returned an unexpected response.');
  return parsed.data;
}

/** A zero-filled daily series for the given day keys from { _id: dayKey, n } rows. */
const fill = (keys, rows) => keys.map((k) => rows.find((r) => r._id === k)?.n ?? 0);
const dayExpr = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: env.timezone } };

// ---- anomalies ----

/** Scores the newest readings against this machine's own recent history. */
export async function machineAnomalies(machineId) {
  const machine = await Machine.findById(machineId).select('code name').lean();
  if (!machine) throw ApiError.notFound('Machine not found');
  const since = new Date(Date.now() - 7 * DAY);
  const rows = await SensorReading.find({
    machine: machineId, at: { $gte: since }, temperatureC: { $exists: true }, vibrationMms: { $exists: true }, rpm: { $exists: true }, powerKw: { $exists: true },
  }).sort({ at: -1 }).limit(1500).lean();
  const ordered = rows.reverse();
  if (ordered.length < MIN_ANOMALY_HISTORY + 1) {
    throw new ApiError(422, `Not enough telemetry to learn what is normal for this machine yet: ${ordered.length} complete readings, ${MIN_ANOMALY_HISTORY + 1} needed. Start the simulator or send more readings.`);
  }
  const recent = ordered.slice(-RECENT_POINTS);
  const history = ordered.slice(0, -RECENT_POINTS);
  const clip = (r) => ({ temperatureC: r.temperatureC, vibrationMms: r.vibrationMms, rpm: r.rpm, powerKw: r.powerKw });
  const result = await ml('/anomaly', { history: (history.length >= MIN_ANOMALY_HISTORY ? history : ordered.slice(0, -1)).map(clip), recent: recent.map(clip) }, anomalySchema);
  return {
    machine: { id: String(machine._id), code: machine.code, name: machine.name },
    ...result,
    points: result.points.map((p, i) => ({ ...p, at: recent[i].at })),
    note: 'Compared with this machine\'s own readings of the past week. An unusual reading is a prompt to look, not a diagnosis.',
  };
}

// ---- stock cover ----

async function stockSeries(itemId) {
  const since = new Date(Date.now() - HISTORY_DAYS * DAY);
  const keys = lastDayKeys(HISTORY_DAYS);
  const rows = await StockTransaction.aggregate([
    { $match: { item: itemId, type: 'out', createdAt: { $gte: since } } },
    { $group: { _id: dayExpr, n: { $sum: '$qty' } } },
  ]);
  return fill(keys, rows);
}

/** Days of cover for one item, from its own usage trend, with a suggested order size that covers the supplier's lead time plus a week. */
export async function stockCover(item) {
  const series = await stockSeries(item._id);
  if (series.filter((v) => v > 0).length < 2) {
    return { itemId: String(item._id), sku: item.sku, name: item.name, unit: item.unit, quantity: item.quantity, enoughHistory: false, message: 'Not enough recorded usage in the last 30 days to forecast.' };
  }
  const f = await ml('/forecast', { series, horizon: 60, level: item.quantity }, forecastSchema);
  const supplier = item.supplierRef ? await Supplier.findById(item.supplierRef).select('leadTimeDays').lean() : null;
  const lead = supplier?.leadTimeDays ?? 7;
  const perDay = Math.max(f.recentPerDay, f.averagePerDay);
  const suggested = Math.max(0, Math.ceil(perDay * (lead + 7) - item.quantity));
  const days = f.expectedDays;
  return {
    itemId: String(item._id), sku: item.sku, name: item.name, unit: item.unit, quantity: item.quantity, reorderThreshold: item.reorderThreshold,
    enoughHistory: true, usagePerDay: f.recentPerDay, trendPerDay: f.trendPerDay, confidence: f.confidence,
    daysOfCover: days, earliestDays: f.earliestDays ?? null, latestDays: f.latestDays ?? null, beyondHorizon: !f.withinHorizon,
    runOutOn: days == null ? null : dayKey(new Date(Date.now() + days * DAY)),
    leadTimeDays: lead, suggestedOrderQty: suggested,
  };
}

/** All items, most urgent first. Items with no usable history are listed last, not guessed. */
export async function fleetStockCover() {
  const items = await InventoryItem.find().sort({ sku: 1 }).limit(100).lean();
  const rows = await Promise.all(items.map((i) => stockCover(i)));
  const rank = (r) => (!r.enoughHistory ? Infinity : r.daysOfCover ?? 1e6);
  return rows.sort((a, b) => rank(a) - rank(b));
}

// ---- order projection ----

/** When will an in-progress order finish at its recent pace, and is that before the due date? */
export async function orderProjection(order) {
  const keys = lastDayKeys(14);
  const rows = await OutputLog.aggregate([
    { $match: { order: order._id, at: { $gte: new Date(Date.now() - 14 * DAY) } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$at', timezone: env.timezone } }, n: { $sum: '$qty' } } },
  ]);
  const series = fill(keys, rows);
  const remaining = Math.max(0, order.quantity - order.producedQty);
  const base = { orderId: String(order._id), orderNo: order.orderNo, product: order.product, quantity: order.quantity, producedQty: order.producedQty, remaining, dueDate: order.dueDate ?? null };
  if (remaining === 0) return { ...base, status: 'done' };
  if (series.filter((v) => v > 0).length < 2) return { ...base, status: 'unknown', message: 'Not enough output logged in the last 14 days to project a finish.' };
  const f = await ml('/forecast', { series, horizon: 60, target: remaining }, forecastSchema);
  const finish = (d) => (d == null ? null : dayKey(new Date(Date.now() + d * DAY)));
  const likely = finish(f.expectedDays);
  const due = order.dueDate ? dayKey(new Date(order.dueDate)) : null;
  const late = due != null && (likely == null || likely > due);
  return {
    ...base, status: late ? 'late' : 'on_track', pacePerDay: f.recentPerDay, confidence: f.confidence,
    expectedFinish: likely, earliestFinish: finish(f.earliestDays), latestFinish: finish(f.latestDays), beyondHorizon: !f.withinHorizon,
  };
}

export async function orderProjections() {
  const orders = await ProductionOrder.find({ status: 'in_progress' }).sort({ dueDate: 1 }).limit(50).lean();
  return Promise.all(orders.map((o) => orderProjection(o)));
}
