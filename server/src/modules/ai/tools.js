import { z } from 'zod';
import { Attendance, InventoryItem, Machine, MachineAssessment, OutputLog, ProductionOrder, WorkOrder, Worker } from '../../models/index.js';
import { clean } from '../../utils/sanitize.js';
import * as analytics from '../analytics/analytics.service.js';

/**
 * The only data the analyst can reach. Each tool has a strict argument schema, runs fixed
 * queries, and returns bounded, already-calculated results. Nothing here accepts a query,
 * collection name or pipeline from the caller or the model.
 */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (s) => new RegExp(`^${escapeRe(s)}$`, 'i');
const contains = (s) => new RegExp(escapeRe(s), 'i');
const countBy = (rows, keys) => Object.fromEntries(keys.map((k) => [k, rows.filter((r) => r === k).length]));
const fig = (label, value, unit) => ({ label, value, unit });

const code = z.string().trim().max(20);
const text = z.string().trim().max(40);

export const TOOLS = {
  getMachineStatus: {
    description: 'Current status of machines (running, idle, maintenance, offline) with risk level. Optional filters: status, machineCode.',
    args: z.object({ status: z.enum(['running', 'idle', 'maintenance', 'offline']).optional(), machineCode: code.optional() }),
    async run(_range, args, now) {
      const filter = {};
      if (args.status) filter.status = args.status;
      if (args.machineCode) filter.code = exact(args.machineCode);
      const machines = await Machine.find(filter).sort({ code: 1 }).lean();
      const counts = countBy(machines.map((m) => m.status), ['running', 'idle', 'maintenance', 'offline']);
      return {
        recordCount: machines.length,
        asOf: now,
        data: {
          total: machines.length, counts,
          machines: machines.slice(0, 25).map((m) => ({ code: clean(m.code, 20), name: clean(m.name, 60), status: m.status, riskLevel: m.riskLevel })),
        },
        keyFigures: [
          fig('Machines matched', machines.length, 'machines'),
          ...Object.entries(counts).filter(([, n]) => n > 0).map(([s, n]) => fig(`Machines ${s}`, n, 'machines')),
        ],
      };
    },
  },

  getDowntimeSummary: {
    description: 'Downtime (offline plus maintenance) in the period: total minutes, per machine and top reasons. Optional filter: machineCode.',
    args: z.object({ machineCode: code.optional() }),
    async run(range, args, now) {
      const report = await analytics.downtime(range);
      const machines = args.machineCode ? report.byMachine.filter((m) => m.code.toLowerCase() === args.machineCode.toLowerCase()) : report.byMachine;
      const total = machines.reduce((a, m) => a + m.minutes, 0);
      const events = machines.reduce((a, m) => a + m.events, 0);
      const top = machines.filter((m) => m.minutes > 0).slice(0, 5);
      return {
        recordCount: events,
        asOf: now,
        data: {
          totalDowntimeMinutes: total, events,
          topMachines: top.map((m) => ({ code: clean(m.code, 20), name: clean(m.name, 60), minutes: m.minutes, events: m.events, availabilityPct: m.availabilityPct })),
          topReasons: args.machineCode ? [] : report.byReason.slice(0, 3).map((r) => ({ reason: clean(r.reason, 60), minutes: r.minutes, events: r.events })),
        },
        keyFigures: [
          fig('Total downtime', total, 'minutes'),
          fig('Downtime events', events, 'events'),
          ...(top[0] ? [fig(`Most downtime: ${top[0].code}`, top[0].minutes, 'minutes')] : []),
        ],
      };
    },
  },

  getProductionSummary: {
    description: 'Units produced in the period, output by product, and current order counts including bottlenecks. Optional filter: product (the bare product name, such as "gear", without words like "units").',
    args: z.object({ product: text.optional() }),
    async run(range, args, now) {
      const [output, inProgress] = await Promise.all([
        analytics.productionOutput(range),
        ProductionOrder.find({ status: 'in_progress' }).sort({ dueDate: 1 }).limit(10).lean(),
      ]);
      let units = output.totalUnits;
      let entries = output.entryCount;
      let byProduct = output.byProduct;
      let note = null;
      if (args.product) {
        // A filter that matches no product must be said out loud, not answered as "0 units".
        const known = [...new Set([...(await OutputLog.distinct('product')), ...(await ProductionOrder.distinct('product'))])];
        if (!known.some((p) => p.toLowerCase().includes(args.product.toLowerCase()))) {
          note = `No product matches "${args.product}". Products in the system: ${known.slice(0, 10).map((p) => clean(p, 40)).join(', ') || 'none yet'}.`;
        }
        const rows = await OutputLog.aggregate([
          { $match: { at: { $gte: range.start, $lte: range.end }, product: contains(args.product) } },
          { $group: { _id: '$product', units: { $sum: '$qty' }, n: { $sum: 1 } } },
        ]);
        units = rows.reduce((a, r) => a + r.units, 0);
        entries = rows.reduce((a, r) => a + r.n, 0);
        byProduct = rows.map((r) => ({ product: r._id, units: r.units }));
      }
      const bottlenecks = inProgress.filter((o) => o.bottleneckFlag).length;
      return {
        recordCount: note ? 0 : entries + inProgress.length,
        ...(note && { note }),
        asOf: now,
        data: {
          unitsProduced: units,
          byProduct: byProduct.slice(0, 8).map((p) => ({ product: clean(p.product, 60), units: p.units })),
          ordersByStatus: output.ordersByStatus,
          inProgressOrders: inProgress.map((o) => ({
            orderNo: clean(o.orderNo, 20), product: clean(o.product, 60), progressPct: o.progress,
            dueDate: o.dueDate ? o.dueDate.toISOString().slice(0, 10) : null, bottleneck: o.bottleneckFlag,
          })),
        },
        keyFigures: [
          fig('Units produced', units, 'units'),
          fig('Orders in progress', output.ordersByStatus.in_progress, 'orders'),
          fig('Bottleneck orders', bottlenecks, 'orders'),
        ],
      };
    },
  },

  getInventoryStatus: {
    description: 'Current stock levels against reorder thresholds (a snapshot, not tied to the period). Returns how many items are tracked, how many are below their reorder level, and each item\'s quantity. Optional filters: lowStockOnly, search (the bare item name).',
    args: z.object({ lowStockOnly: z.boolean().optional(), search: text.optional() }),
    async run(_range, args, now) {
      const filter = args.search ? { $or: [{ name: contains(args.search) }, { sku: contains(args.search) }] } : {};
      const items = await InventoryItem.find(filter).sort({ sku: 1 }).lean();
      const low = items.filter((i) => i.quantity < i.reorderThreshold);
      const shown = args.lowStockOnly ? low : items;
      return {
        recordCount: items.length,
        asOf: now,
        data: {
          itemsTracked: items.length, belowReorderLevel: low.length,
          items: shown.slice(0, 20).map((i) => ({
            sku: clean(i.sku, 30), name: clean(i.name, 60), quantity: i.quantity, unit: clean(i.unit, 10), reorderThreshold: i.reorderThreshold,
            belowReorderLevel: i.quantity < i.reorderThreshold,
          })),
        },
        keyFigures: [fig('Items tracked', items.length, 'items'), fig('Below reorder level', low.length, 'items')],
      };
    },
  },

  getSavedMaintenanceAssessments: {
    description: 'Latest saved AI condition assessment per machine within the period. Reads saved records only; never runs a new assessment. Optional filters: riskLevel, machineCode.',
    args: z.object({ riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'INSUFFICIENT_DATA']).optional(), machineCode: code.optional() }),
    async run(range, args, now) {
      const rows = await MachineAssessment.aggregate([
        { $match: { assessedAt: { $gte: range.start, $lte: range.end } } },
        { $sort: { assessedAt: -1 } },
        { $group: { _id: '$machine', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
        { $lookup: { from: 'machines', localField: 'machine', foreignField: '_id', as: 'm' } },
        { $unwind: '$m' },
        ...(args.riskLevel ? [{ $match: { riskLevel: args.riskLevel } }] : []),
        ...(args.machineCode ? [{ $match: { 'm.code': exact(args.machineCode) } }] : []),
        { $sort: { assessedAt: -1 } },
      ]);
      const counts = countBy(rows.map((r) => r.riskLevel), ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_DATA']);
      return {
        recordCount: rows.length,
        asOf: now,
        data: {
          machinesAssessed: rows.length, counts,
          assessments: rows.slice(0, 20).map((r) => ({
            machineCode: clean(r.m.code, 20), riskLevel: r.riskLevel, summary: clean(r.assessmentSummary, 160), assessedAt: r.assessedAt.toISOString().slice(0, 10),
          })),
        },
        keyFigures: [
          fig('Machines assessed', rows.length, 'machines'),
          ...Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => fig(`Rated ${k}`, n, 'machines')),
        ],
      };
    },
  },

  getWorkerAttendance: {
    description: 'Attendance check-ins in the period: on-time and late counts. Aggregated; workers are identified by employee ID only.',
    args: z.object({}),
    async run(range, _args, now) {
      const [rows, activeWorkers, lateRows] = await Promise.all([
        Attendance.aggregate([{ $match: { date: { $in: range.keys } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        Worker.countDocuments({ status: 'active' }),
        Attendance.aggregate([
          { $match: { date: { $in: range.keys }, status: 'late' } },
          { $group: { _id: '$worker', n: { $sum: 1 } } },
          { $sort: { n: -1 } }, { $limit: 5 },
          { $lookup: { from: 'workers', localField: '_id', foreignField: '_id', as: 'w' } },
          { $unwind: '$w' },
        ]),
      ]);
      const n = (s) => rows.find((r) => r._id === s)?.n ?? 0;
      return {
        recordCount: n('present') + n('late'),
        asOf: now,
        data: {
          onTimeCheckIns: n('present'), lateCheckIns: n('late'), activeWorkers,
          mostLate: lateRows.map((r) => ({ employeeId: clean(r.w.employeeId, 20), lateCheckIns: r.n })),
        },
        keyFigures: [fig('On-time check-ins', n('present'), 'check-ins'), fig('Late check-ins', n('late'), 'check-ins'), fig('Active workers', activeWorkers, 'workers')],
      };
    },
  },

  getMaintenanceWorkOrders: {
    description: 'Maintenance work orders: how many are open, in progress, overdue or urgent right now, and how many were completed in the period. Optional filters: machineCode, status (open, in_progress, done, cancelled), type (preventive, corrective, inspection).',
    args: z.object({
      machineCode: code.optional(),
      status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
      type: z.enum(['preventive', 'corrective', 'inspection']).optional(),
    }),
    async run(range, args, now) {
      const base = {};
      if (args.type) base.type = args.type;
      if (args.machineCode) {
        const m = await Machine.findOne({ code: exact(args.machineCode) }).select('_id').lean();
        base.machine = m ? m._id : null;
      }
      const live = ['open', 'in_progress'];
      const [open, inProgress, overdue, urgent, completed, backlog] = await Promise.all([
        WorkOrder.countDocuments({ ...base, status: 'open' }),
        WorkOrder.countDocuments({ ...base, status: 'in_progress' }),
        WorkOrder.countDocuments({ ...base, status: { $in: live }, dueAt: { $lt: now } }),
        WorkOrder.countDocuments({ ...base, status: { $in: live }, priority: 'urgent' }),
        WorkOrder.countDocuments({ ...base, status: 'done', completedAt: { $gte: range.start, $lte: range.end } }),
        WorkOrder.find({ ...base, status: args.status ?? { $in: live } }).sort({ dueAt: 1, createdAt: 1 }).limit(8).populate('machine', 'code').lean(),
      ]);
      return {
        recordCount: open + inProgress + completed,
        asOf: now,
        data: {
          open, inProgress, overdue, urgent, completedInPeriod: completed,
          workOrders: backlog.map((w) => ({
            woNo: w.woNo, machine: clean(w.machine?.code, 20), title: clean(w.title, 80), type: w.type, priority: w.priority, status: w.status,
            overdue: !!w.dueAt && live.includes(w.status) && w.dueAt < now,
          })),
        },
        keyFigures: [
          fig('Open work orders', open, 'work orders'), fig('Work orders in progress', inProgress, 'work orders'),
          fig('Overdue work orders', overdue, 'work orders'), fig('Urgent work orders', urgent, 'work orders'),
          fig('Work orders completed in the period', completed, 'work orders'),
        ],
      };
    },
  },

  getReliability: {
    description: 'Machine reliability in the period: failures (trips to offline), mean time to repair (MTTR) and mean time between failures (MTBF). Optional filter: machineCode.',
    args: z.object({ machineCode: code.optional() }),
    async run(range, args, now) {
      const report = await analytics.reliability(range);
      const all = args.machineCode ? report.machines.filter((m) => m.code.toLowerCase() === args.machineCode.toLowerCase()) : report.machines;
      const failures = all.reduce((n, m) => n + m.failures, 0);
      const repairMins = all.reduce((n, m) => n + (m.mttrMins ?? 0) * m.failures, 0);
      const worst = all.filter((m) => m.failures > 0).slice(0, 5);
      const mttr = failures ? Math.round((repairMins / failures) * 10) / 10 : null;
      return {
        recordCount: failures,
        asOf: now,
        data: {
          failures, meanTimeToRepairMinutes: mttr,
          machines: worst.map((m) => ({ code: clean(m.code, 20), name: clean(m.name, 60), failures: m.failures, mttrMins: m.mttrMins, mtbfHours: m.mtbfHours, availabilityPct: m.availabilityPct })),
        },
        keyFigures: [
          fig('Failures', failures, 'failures'),
          ...(mttr != null ? [fig('Mean time to repair', mttr, 'minutes')] : []),
          ...(args.machineCode && worst[0]?.mtbfHours != null ? [fig('Mean time between failures', worst[0].mtbfHours, 'hours')] : []),
          ...(!args.machineCode && worst[0] ? [fig(`Failures on ${clean(worst[0].code, 20)}`, worst[0].failures, 'failures')] : []),
        ],
      };
    },
  },
};

export const TOOL_NAMES = Object.keys(TOOLS);

/** Reduces a model-supplied call to the arguments that tool declares. Anything else is dropped. */
export function parseCall(call) {
  const def = TOOLS[call.name];
  if (!def) throw new Error('unknown tool');
  const raw = Object.fromEntries(Object.entries(call).filter(([k, v]) => k !== 'name' && v !== null && v !== '' && v !== undefined));
  return { name: call.name, args: def.args.parse(raw) };
}

export async function runTool({ name, args }, range, now = new Date()) {
  const result = await TOOLS[name].run(range, args, now);
  return { tool: name, ...result, asOf: now.toISOString() };
}
