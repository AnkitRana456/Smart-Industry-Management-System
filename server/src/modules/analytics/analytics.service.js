import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import {
  Alert, Attendance, InventoryItem, QualityCheck, Machine, MachineLog, OutputLog, ProductionOrder, StockTransaction, Worker,
} from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { lastDayKeys, startOfDay } from '../../utils/time.js';
import * as attendance from '../attendance/attendance.service.js';
import { approvedDays } from '../leave/leave.service.js';

const DOWN = ['offline', 'maintenance'];
const DAY_MS = 86_400_000;
const tz = env.timezone;

/** A range of whole factory days ending now, e.g. days=7 is today plus the six days before it. */
export function rangeFromDays(days) {
  const end = new Date();
  const start = new Date(startOfDay(end).getTime() - (days - 1) * DAY_MS);
  return { start, end, days, keys: lastDayKeys(days, end) };
}

const dayExpr = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: tz } });
const countBy = (rows, keys) => Object.fromEntries(keys.map((k) => [k, rows.find((r) => r._id === k)?.n ?? 0]));

export async function overview() {
  const todayStart = startOfDay();
  const now = new Date();

  const [machineRows, riskRows, orderRows, bottlenecks, items, low, alertRows, att, downtimeToday, outputToday] = await Promise.all([
    Machine.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Machine.aggregate([{ $group: { _id: '$riskLevel', n: { $sum: 1 } } }]),
    ProductionOrder.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ProductionOrder.countDocuments({ bottleneckFlag: true }),
    InventoryItem.countDocuments(),
    InventoryItem.countDocuments({ $expr: { $lt: ['$quantity', '$reorderThreshold'] } }),
    Alert.aggregate([{ $match: { status: 'open' } }, { $group: { _id: '$severity', n: { $sum: 1 } } }]),
    attendance.summary(),
    MachineLog.aggregate([
      { $match: { toStatus: { $in: DOWN }, $or: [{ endedAt: null }, { endedAt: { $gte: todayStart } }] } },
      {
        $project: {
          mins: {
            $dateDiff: {
              startDate: { $max: ['$startedAt', todayStart] },
              endDate: { $ifNull: ['$endedAt', '$$NOW'] },
              unit: 'minute',
            },
          },
        },
      },
      { $group: { _id: null, mins: { $sum: { $max: ['$mins', 0] } } } },
    ]),
    OutputLog.aggregate([{ $match: { at: { $gte: todayStart, $lte: now } } }, { $group: { _id: null, qty: { $sum: '$qty' } } }]),
  ]);

  const machines = countBy(machineRows, ['running', 'idle', 'maintenance', 'offline']);
  const machineTotal = Object.values(machines).reduce((a, b) => a + b, 0);
  return {
    machines: { total: machineTotal, ...machines },
    risk: countBy(riskRows, ['LOW', 'MEDIUM', 'HIGH', 'INSUFFICIENT_DATA']),
    orders: { ...countBy(orderRows, ['pending', 'in_progress', 'completed']), bottlenecks },
    inventory: { items, lowStock: low },
    alerts: { open: alertRows.reduce((a, r) => a + r.n, 0), ...countBy(alertRows, ['critical', 'warning', 'info']) },
    attendance: att,
    today: { downtimeMins: downtimeToday[0]?.mins ?? 0, unitsProduced: outputToday[0]?.qty ?? 0 },
    generatedAt: now,
  };
}

/**
 * Downtime (offline + maintenance) per day, per machine and per reason. An event
 * counts toward the day it started; ongoing events are measured up to now.
 */
export async function downtime({ start, end, days, keys }, machineId) {
  const minsExpr = { $ifNull: ['$durationMins', { $dateDiff: { startDate: '$startedAt', endDate: '$$NOW', unit: 'minute' } }] };
  const match = { $match: { toStatus: { $in: DOWN }, startedAt: { $gte: start, $lte: end }, ...(machineId && { machine: new mongoose.Types.ObjectId(machineId) }) } };

  const [rows, reasons, machines] = await Promise.all([
    MachineLog.aggregate([
      match,
      { $addFields: { mins: minsExpr, day: dayExpr('$startedAt') } },
      { $group: { _id: { day: '$day', machine: '$machine' }, minutes: { $sum: '$mins' }, events: { $sum: 1 } } },
    ]),
    MachineLog.aggregate([
      match,
      { $addFields: { mins: minsExpr } },
      { $group: { _id: { $ifNull: ['$reason', 'Unspecified'] }, minutes: { $sum: '$mins' }, events: { $sum: 1 } } },
      { $sort: { minutes: -1 } },
      { $limit: 6 },
    ]),
    Machine.find().select('code name').sort({ code: 1 }).lean(),
  ]);

  const perDay = Object.fromEntries(keys.map((k) => [k, 0]));
  const perMachine = new Map(machines.map((m) => [String(m._id), { machineId: String(m._id), code: m.code, name: m.name, minutes: 0, events: 0 }]));
  for (const r of rows) {
    if (r._id.day in perDay) perDay[r._id.day] += r.minutes;
    const m = perMachine.get(String(r._id.machine));
    if (m) { m.minutes += r.minutes; m.events += r.events; }
  }

  const periodMins = days * 24 * 60;
  const byMachine = [...perMachine.values()]
    .map((m) => ({ ...m, availabilityPct: Math.max(0, Math.round((1 - m.minutes / periodMins) * 1000) / 10) }))
    .sort((a, b) => b.minutes - a.minutes);

  return {
    days, start, end, timezone: tz,
    totalMinutes: byMachine.reduce((a, m) => a + m.minutes, 0),
    series: keys.map((date) => ({ date, minutes: perDay[date] })),
    byMachine,
    byReason: reasons.map((r) => ({ reason: r._id, minutes: r.minutes, events: r.events })),
  };
}

export async function productionOutput({ start, end, days, keys }) {
  const match = { $match: { at: { $gte: start, $lte: end } } };
  const [daily, products, orders] = await Promise.all([
    OutputLog.aggregate([match, { $group: { _id: dayExpr('$at'), qty: { $sum: '$qty' }, n: { $sum: 1 } } }]),
    OutputLog.aggregate([match, { $group: { _id: '$product', qty: { $sum: '$qty' } } }, { $sort: { qty: -1 } }, { $limit: 8 }]),
    ProductionOrder.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  const series = keys.map((date) => ({ date, units: daily.find((d) => d._id === date)?.qty ?? 0 }));
  return {
    days, start, end, timezone: tz,
    totalUnits: series.reduce((a, d) => a + d.units, 0),
    entryCount: daily.reduce((a, d) => a + d.n, 0),
    series,
    byProduct: products.map((p) => ({ product: p._id, units: p.qty })),
    ordersByStatus: countBy(orders, ['pending', 'in_progress', 'completed']),
  };
}

/**
 * Daily stock movement. With an item, the end-of-day level is reconstructed
 * from the current quantity by undoing every later transaction.
 */
export async function stockTrends({ start, end, days, keys }, itemId) {
  let item = null;
  if (itemId) {
    item = await InventoryItem.findById(itemId).lean();
    if (!item) throw ApiError.notFound('Inventory item not found');
  }

  const inQty = {
    $cond: [{ $eq: ['$type', 'in'] }, '$qty', { $cond: [{ $and: [{ $eq: ['$type', 'adjust'] }, { $gt: ['$qty', 0] }] }, '$qty', 0] }],
  };
  const outQty = {
    $cond: [{ $eq: ['$type', 'out'] }, '$qty', { $cond: [{ $and: [{ $eq: ['$type', 'adjust'] }, { $lt: ['$qty', 0] }] }, { $multiply: ['$qty', -1] }, 0] }],
  };
  const rows = await StockTransaction.aggregate([
    { $match: { createdAt: { $gte: start, $lte: end }, ...(item && { item: item._id }) } },
    { $group: { _id: dayExpr('$createdAt'), in: { $sum: inQty }, out: { $sum: outQty } } },
  ]);

  const byDay = new Map(rows.map((r) => [r._id, r]));
  let level = item?.quantity ?? null;
  const series = [];
  for (let i = keys.length - 1; i >= 0; i--) {
    const r = byDay.get(keys[i]);
    const inn = r?.in ?? 0;
    const out = r?.out ?? 0;
    series.unshift({ date: keys[i], in: inn, out, ...(item && { level }) });
    if (item) level -= inn - out;
  }

  return {
    days, start, end, timezone: tz,
    item: item && { id: String(item._id), sku: item.sku, name: item.name, unit: item.unit, quantity: item.quantity, reorderThreshold: item.reorderThreshold },
    totalIn: series.reduce((a, d) => a + d.in, 0),
    totalOut: series.reduce((a, d) => a + d.out, 0),
    series,
  };
}

/**
 * Per-day and per-worker attendance for active workers. A day on which nobody checked in at all
 * (weekend, holiday, plant closed) is reported as 'none' rather than counting everyone absent;
 * shifts carry no working-day calendar, so this is the only signal for a non-working day.
 */
export async function attendanceReport({ days, keys }) {
  const [leaveSet, workers, records] = await Promise.all([
    approvedDays(keys),
    Worker.find({ status: 'active' }).select('employeeId user').populate('user', 'name').sort({ employeeId: 1 }).lean(),
    Attendance.find({ date: { $in: keys } }).select('worker date status').lean(),
  ]);
  const byKey = new Map(records.map((r) => [`${r.worker}|${r.date}`, r.status]));
  const worked = new Set(records.map((r) => r.date));
  const today = keys.at(-1);

  const cell = (id, date) => byKey.get(`${id}|${date}`) ?? (leaveSet.has(`${id}|${date}`) ? 'leave' : !worked.has(date) ? 'none' : date === today ? 'pending' : 'absent');
  const rows = workers.map((w) => ({
    workerId: String(w._id), employeeId: w.employeeId, name: w.user?.name ?? w.employeeId,
    days: Object.fromEntries(keys.map((d) => [d, cell(w._id, d)])),
  }));
  const series = keys.map((date) => {
    const counts = { present: 0, late: 0, absent: 0 };
    for (const r of rows) if (r.days[date] in counts) counts[r.days[date]] += 1;
    return { date, ...counts };
  });
  const attended = series.reduce((a, d) => a + d.present + d.late, 0);
  const expected = series.reduce((a, d) => a + d.present + d.late + d.absent, 0);
  return { days, keys, series, rows, attendancePct: expected ? Math.round((1000 * attended) / expected) / 10 : null };
}

/**
 * Reliability per machine. A failure is a trip to 'offline' (maintenance is planned work, so it is
 * downtime but not a failure). MTTR = mean repair time of those failures; MTBF = running time between
 * them = (period - downtime) / failures. Both are null for a machine with no failures in the period.
 */
export async function reliability({ start, days }) {
  const minsExpr = { $ifNull: ['$durationMins', { $dateDiff: { startDate: '$startedAt', endDate: '$$NOW', unit: 'minute' } }] };
  const [rows, machines] = await Promise.all([
    MachineLog.aggregate([
      { $match: { toStatus: { $in: DOWN }, startedAt: { $gte: start } } },
      { $addFields: { mins: minsExpr } },
      {
        $group: {
          _id: '$machine',
          downMins: { $sum: '$mins' },
          failures: { $sum: { $cond: [{ $eq: ['$toStatus', 'offline'] }, 1, 0] } },
          failMins: { $sum: { $cond: [{ $eq: ['$toStatus', 'offline'] }, '$mins', 0] } },
        },
      },
    ]),
    Machine.find().select('code name').sort({ code: 1 }).lean(),
  ]);
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  const periodMins = days * 24 * 60;
  const round1 = (n) => Math.round(n * 10) / 10;
  const out = machines.map((m) => {
    const r = byId.get(String(m._id)) ?? { downMins: 0, failures: 0, failMins: 0 };
    return {
      machineId: String(m._id), code: m.code, name: m.name,
      failures: r.failures, downtimeMins: r.downMins,
      mttrMins: r.failures ? round1(r.failMins / r.failures) : null,
      mtbfHours: r.failures ? round1(Math.max(0, periodMins - r.downMins) / r.failures / 60) : null,
      availabilityPct: Math.max(0, round1((1 - r.downMins / periodMins) * 100)),
    };
  });
  const totalFailures = out.reduce((n, m) => n + m.failures, 0);
  return { days, periodMins, totalFailures, machines: out.sort((x, y) => y.failures - x.failures || y.downtimeMins - x.downtimeMins) };
}

/** Downtime by reason, biggest first, with the running share: the few causes behind most of the lost time. */
export async function downtimePareto({ start, end }) {
  const minsExpr = { $ifNull: ['$durationMins', { $dateDiff: { startDate: '$startedAt', endDate: '$$NOW', unit: 'minute' } }] };
  const rows = await MachineLog.aggregate([
    { $match: { toStatus: { $in: DOWN }, startedAt: { $gte: start, $lte: end } } },
    { $addFields: { mins: minsExpr } },
    { $group: { _id: { $ifNull: ['$reason', 'Unspecified'] }, minutes: { $sum: '$mins' }, events: { $sum: 1 } } },
    { $sort: { minutes: -1 } },
  ]);
  const total = rows.reduce((n, r) => n + r.minutes, 0);
  let running = 0;
  return {
    totalMinutes: total,
    reasons: rows.map((r) => {
      running += r.minutes;
      return { reason: r._id, minutes: r.minutes, events: r.events, cumulativePct: total ? Math.round((running / total) * 1000) / 10 : 0 };
    }),
  };
}

/**
 * OEE is availability x performance x quality. Availability and quality are measured here;
 * performance needs per-machine output against an ideal rate, which this system does not record,
 * so it is reported as null and no combined OEE figure is invented.
 */
export async function oee(range) {
  const [down, machines, produced, scrapRow] = await Promise.all([
    downtime(range),
    Machine.countDocuments(),
    OutputLog.aggregate([{ $match: { at: { $gte: range.start, $lte: range.end } } }, { $group: { _id: null, units: { $sum: '$qty' } } }]),
    QualityCheck.aggregate([{ $match: { createdAt: { $gte: range.start, $lte: range.end } } }, { $group: { _id: null, scrap: { $sum: '$scrapQty' }, defects: { $sum: '$defectCount' }, inspected: { $sum: '$inspectedQty' } } }]),
  ]);
  const periodMins = machines * range.days * 24 * 60;
  const units = produced[0]?.units ?? 0;
  const scrap = scrapRow[0]?.scrap ?? 0;
  const pct = (n) => Math.round(n * 1000) / 10;
  return {
    days: range.days,
    availabilityPct: periodMins ? pct(Math.max(0, 1 - down.totalMinutes / periodMins)) : null,
    qualityPct: units ? pct(Math.max(0, (units - scrap) / units)) : null,
    performancePct: null,
    oeePct: null,
    unitsProduced: units, scrapUnits: scrap, defectsFound: scrapRow[0]?.defects ?? 0, unitsInspected: scrapRow[0]?.inspected ?? 0,
    note: 'Performance needs output per machine against an ideal rate, which is not recorded, so a combined OEE figure is not reported.',
  };
}
