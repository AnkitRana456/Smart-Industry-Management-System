import { Machine, MachineLog } from '../../models/index.js';
import { emit } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import * as alerts from '../alerts/alert.service.js';
import * as maintenance from '../maintenance/maintenance.service.js';
import { refreshBottlenecks } from '../production/order.service.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DOWN = ['offline', 'maintenance'];

export function list({ status, search, page, limit }) {
  const filter = {};
  if (status) filter.status = status;
  if (search) {
    const re = new RegExp(escapeRe(search), 'i');
    filter.$or = [{ name: re }, { code: re }, { type: re }];
  }
  return paginate(Machine, filter, { page, limit, sort: { code: 1 } });
}

export async function getById(id) {
  const machine = await Machine.findById(id).lean();
  if (!machine) throw ApiError.notFound('Machine not found');
  return machine;
}

export async function create(data) {
  if (await Machine.exists({ code: data.code })) throw ApiError.conflict('Machine code already exists');
  const machine = await Machine.create(data);
  await MachineLog.create({ machine: machine._id, eventType: 'registered', toStatus: machine.status, startedAt: new Date() });
  emit('machine:created', machine.toObject());
  return machine;
}

export async function update(id, data) {
  const machine = await Machine.findByIdAndUpdate(id, data, { new: true, runValidators: true }).lean();
  if (!machine) throw ApiError.notFound('Machine not found');
  emit('machine:updated', machine, `machine:${id}`);
  return machine;
}

export async function remove(id) {
  const machine = await Machine.findByIdAndDelete(id);
  if (!machine) throw ApiError.notFound('Machine not found');
  await MachineLog.deleteMany({ machine: id });
  emit('machine:deleted', { _id: id });
}

/** Closes the open log, opens a new one for the new status, then emits. */
export async function changeStatus(id, { status, reason }) {
  const machine = await Machine.findById(id);
  if (!machine) throw ApiError.notFound('Machine not found');
  if (machine.status === status) throw ApiError.conflict(`Machine is already ${status}`);

  const now = new Date();
  const open = await MachineLog.findOne({ machine: id, endedAt: null }).sort({ startedAt: -1 });
  if (open) {
    open.endedAt = now;
    open.durationMins = Math.max(0, Math.round((now - open.startedAt) / 60_000));
    await open.save();
  }
  const from = machine.status;
  await MachineLog.create({ machine: id, fromStatus: from, toStatus: status, startedAt: now, reason });
  machine.status = status;
  await machine.save();

  const payload = { machineId: String(id), code: machine.code, name: machine.name, from, to: status, at: now };
  emit('machine:statusChanged', payload);
  emit('machine:statusChanged', payload, `machine:${id}`);

  if (status === 'offline') {
    await alerts.create({
      type: 'machine_offline', severity: 'critical', source: 'machines', sourceId: id,
      message: `${machine.name} (${machine.code}) went offline${reason ? `: ${reason}` : '.'}`,
    });
    await maintenance.openForDowntime(machine, reason);
  } else if (from === 'offline') {
    await alerts.resolveFor('machine_offline', id);
  }
  await refreshBottlenecks();
  return machine.toObject();
}

export async function logs(id, { page, limit }) {
  await getById(id);
  return paginate(MachineLog, { machine: id }, { page, limit, sort: { startedAt: -1 } });
}

/** Total downtime (offline + maintenance) per machine over the last `days`, computed in MongoDB. */
export async function downtimeSummary({ days }) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await MachineLog.aggregate([
    { $match: { toStatus: { $in: DOWN }, startedAt: { $gte: since } } },
    {
      $addFields: {
        mins: {
          $ifNull: ['$durationMins', { $dateDiff: { startDate: '$startedAt', endDate: '$$NOW', unit: 'minute' } }],
        },
      },
    },
    { $group: { _id: '$machine', downtimeMins: { $sum: '$mins' }, events: { $sum: 1 } } },
    { $lookup: { from: 'machines', localField: '_id', foreignField: '_id', as: 'm' } },
    { $unwind: '$m' },
    { $project: { _id: 0, machineId: '$_id', code: '$m.code', name: '$m.name', downtimeMins: 1, events: 1 } },
    { $sort: { downtimeMins: -1 } },
  ]);
  return { days, since, rows };
}
