import { Machine, MaintenanceSchedule, User, WorkOrder, Worker } from '../../models/index.js';
import { emit } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { forUser } from '../workers/worker.service.js';

const DAY = 86_400_000;
const LEAD_DAYS = 3; // a recurring job gets its work order this many days before it is due
const OPEN = ['open', 'in_progress'];
const NEXT = { open: ['in_progress', 'cancelled'], in_progress: ['done', 'cancelled'], done: [], cancelled: [] };

const POPULATE = [
  { path: 'machine', select: 'code name status' },
  { path: 'assignedTo', select: 'employeeId user', populate: { path: 'user', select: 'name' } },
];

async function nextNo() {
  const [last] = await WorkOrder.find({ woNo: /^WO-\d+$/ }).sort({ woNo: -1 }).limit(1).lean();
  return `WO-${last ? Number(last.woNo.slice(3)) + 1 : 1001}`;
}

async function checkRefs({ machine, assignedTo }) {
  if (machine && !(await Machine.exists({ _id: machine }))) throw ApiError.badRequest('Machine does not exist');
  if (assignedTo && !(await Worker.exists({ _id: assignedTo }))) throw ApiError.badRequest('Assigned worker does not exist');
}

const withOverdue = (wo) => ({ ...wo, overdue: !!wo.dueAt && OPEN.includes(wo.status) && new Date(wo.dueAt) < new Date() });

export async function getById(id) {
  const wo = await WorkOrder.findById(id).populate(POPULATE).lean();
  if (!wo) throw ApiError.notFound('Work order not found');
  return withOverdue(wo);
}

/** Creates with a fresh number; a concurrent create can claim the same one, so retry on the unique index. */
async function insert(data) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await WorkOrder.create({ ...data, woNo: await nextNo() });
    } catch (err) {
      if (err?.code !== 11000 || attempt >= 4) throw err;
    }
  }
}

export async function create(data) {
  await checkRefs(data);
  const wo = await insert(data);
  emit('workorder:updated', { _id: String(wo._id), status: wo.status }, 'room:staff');
  return getById(wo._id);
}

export async function list({ status, machine, type, assignedTo, overdue, page, limit }, user) {
  const filter = {};
  if (status) filter.status = status;
  if (machine) filter.machine = machine;
  if (type) filter.type = type;
  if (user.role === 'worker') filter.assignedTo = (await forUser(user.id))._id;
  else if (assignedTo) filter.assignedTo = assignedTo;
  if (overdue === 'true') Object.assign(filter, { status: { $in: OPEN }, dueAt: { $lt: new Date() } });
  const res = await paginate(WorkOrder, filter, { page, limit, sort: { createdAt: -1 }, populate: POPULATE });
  return { ...res, items: res.items.map(withOverdue) };
}

export async function update(id, data) {
  await checkRefs(data);
  const wo = await WorkOrder.findById(id);
  if (!wo) throw ApiError.notFound('Work order not found');
  if (!OPEN.includes(wo.status)) throw ApiError.conflict('Closed work orders cannot be edited');
  Object.assign(wo, data);
  await wo.save();
  emit('workorder:updated', { _id: id, status: wo.status }, 'room:staff');
  return getById(id);
}

async function assertMine(wo, user) {
  if (user.role !== 'worker') return;
  const me = await forUser(user.id);
  if (String(wo.assignedTo) !== String(me._id)) throw ApiError.forbidden('This work order is not assigned to you');
}

export async function setStatus(id, status, user, resolution) {
  const wo = await WorkOrder.findById(id);
  if (!wo) throw ApiError.notFound('Work order not found');
  await assertMine(wo, user);
  if (!NEXT[wo.status].includes(status)) {
    throw ApiError.conflict(`A ${wo.status.replace('_', ' ')} work order cannot become ${status.replace('_', ' ')}`);
  }
  if (user.role === 'worker' && status === 'cancelled') throw ApiError.forbidden('Only a manager can cancel a work order');

  const now = new Date();
  wo.status = status;
  if (status === 'in_progress') wo.startedAt = now;
  if (status === 'done') {
    wo.completedAt = now;
    if (resolution) wo.resolution = resolution;
  }
  await wo.save();
  if (status === 'done') await onDone(wo, now);
  if (status === 'cancelled') await releaseSchedule(wo);
  emit('workorder:updated', { _id: id, status }, 'room:staff');
  return getById(id);
}

const releaseSchedule = (wo) =>
  wo.schedule ? MaintenanceSchedule.updateOne({ _id: wo.schedule, openWorkOrder: wo._id }, { $unset: { openWorkOrder: 1 } }) : null;

/** Finishing planned work records the service on the machine and rolls the schedule forward. */
async function onDone(wo, now) {
  if (wo.type !== 'inspection') await Machine.updateOne({ _id: wo.machine }, { lastServiceAt: now });
  if (!wo.schedule) return;
  const sch = await MaintenanceSchedule.findById(wo.schedule);
  if (!sch) return;
  sch.lastDoneAt = now;
  sch.nextDueAt = new Date(now.getTime() + sch.everyDays * DAY);
  sch.openWorkOrder = undefined;
  await sch.save();
  await Machine.updateOne({ _id: wo.machine }, { nextServiceDue: sch.nextDueAt });
}

export async function addNote(id, text, user) {
  const wo = await WorkOrder.findById(id);
  if (!wo) throw ApiError.notFound('Work order not found');
  await assertMine(wo, user);
  const author = await User.findById(user.id).select('name').lean();
  wo.notes.push({ by: author?.name ?? 'User', text });
  await wo.save();
  emit('workorder:updated', { _id: id, status: wo.status }, 'room:staff');
  return getById(id);
}

export async function remove(id) {
  const wo = await WorkOrder.findByIdAndDelete(id);
  if (!wo) throw ApiError.notFound('Work order not found');
  await releaseSchedule(wo);
  emit('workorder:updated', { _id: id }, 'room:staff');
}

/** A machine that goes offline gets one corrective work order; further trips while it is open add nothing. */
export async function openForDowntime(machine, reason) {
  if (await WorkOrder.exists({ machine: machine._id, source: 'downtime', status: { $in: OPEN } })) return null;
  return create({
    machine: machine._id, type: 'corrective', priority: 'high', source: 'downtime',
    title: `${machine.name} offline${reason ? `: ${reason}` : ''}`.slice(0, 120),
    description: 'Opened automatically when the machine went offline.',
  });
}

// ---- recurring schedules ----

const SCH_POPULATE = [{ path: 'machine', select: 'code name' }];

export const listSchedules = () => MaintenanceSchedule.find().sort({ nextDueAt: 1 }).populate(SCH_POPULATE).lean();

export async function createSchedule(data) {
  await checkRefs(data);
  const s = await MaintenanceSchedule.create(data);
  return MaintenanceSchedule.findById(s._id).populate(SCH_POPULATE).lean();
}

export async function updateSchedule(id, data) {
  await checkRefs(data);
  const s = await MaintenanceSchedule.findByIdAndUpdate(id, data, { new: true, runValidators: true }).populate(SCH_POPULATE).lean();
  if (!s) throw ApiError.notFound('Schedule not found');
  return s;
}

export async function removeSchedule(id) {
  const s = await MaintenanceSchedule.findByIdAndDelete(id);
  if (!s) throw ApiError.notFound('Schedule not found');
}

/** Opens a preventive work order for every active schedule that is due soon and has none open. Safe to run repeatedly. */
export async function generateDue(now = new Date()) {
  const horizon = new Date(now.getTime() + LEAD_DAYS * DAY);
  const due = await MaintenanceSchedule.find({ active: true, nextDueAt: { $lte: horizon }, openWorkOrder: { $exists: false } });
  let created = 0;
  for (const s of due) {
    // Claim the schedule first; when two runs race only the one that sets openWorkOrder goes on.
    const claim = await MaintenanceSchedule.updateOne({ _id: s._id, openWorkOrder: { $exists: false } }, { openWorkOrder: s._id });
    if (!claim.modifiedCount) continue;
    try {
      const wo = await insert({ machine: s.machine, title: s.title, type: 'preventive', priority: s.priority, source: 'schedule', schedule: s._id, dueAt: s.nextDueAt });
      await MaintenanceSchedule.updateOne({ _id: s._id }, { openWorkOrder: wo._id });
      created += 1;
    } catch (err) {
      await MaintenanceSchedule.updateOne({ _id: s._id }, { $unset: { openWorkOrder: 1 } });
      throw err;
    }
  }
  if (created) emit('workorder:updated', { generated: created }, 'room:staff');
  return { created };
}

export async function summary() {
  const [open, inProgress, overdue, urgent] = await Promise.all([
    WorkOrder.countDocuments({ status: 'open' }),
    WorkOrder.countDocuments({ status: 'in_progress' }),
    WorkOrder.countDocuments({ status: { $in: OPEN }, dueAt: { $lt: new Date() } }),
    WorkOrder.countDocuments({ status: { $in: OPEN }, priority: 'urgent' }),
  ]);
  return { open, inProgress, overdue, urgent };
}
