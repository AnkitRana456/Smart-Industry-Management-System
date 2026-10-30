import { Attendance, Worker } from '../../models/index.js';
import { emit } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { dayKey, hhmmToMinutes, minutesOfDay } from '../../utils/time.js';
import { forUser } from '../workers/worker.service.js';

const LATE_GRACE_MINS = 15;
const POPULATE = { path: 'worker', select: 'employeeId department user', populate: { path: 'user', select: 'name' } };

export async function checkIn(userId) {
  const worker = await forUser(userId);
  if (worker.status !== 'active') throw ApiError.forbidden('Only active workers can check in');
  const now = new Date();
  const date = dayKey(now);

  let status = 'present';
  if (worker.shift) {
    status = minutesOfDay(now) > hhmmToMinutes(worker.shift.startTime) + LATE_GRACE_MINS ? 'late' : 'present';
  }
  try {
    const record = await Attendance.create({ worker: worker._id, date, checkIn: now, status });
    emit('attendance:updated', { workerId: String(worker._id), date, status }, 'room:staff');
    return record;
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict('You have already checked in today');
    throw err;
  }
}

export async function checkOut(userId) {
  const worker = await forUser(userId);
  const date = dayKey();
  const record = await Attendance.findOneAndUpdate(
    { worker: worker._id, date, checkOut: { $exists: false } },
    { checkOut: new Date() },
    { new: true },
  );
  if (!record) {
    const existing = await Attendance.exists({ worker: worker._id, date });
    throw ApiError.conflict(existing ? 'You have already checked out today' : 'You have not checked in today');
  }
  emit('attendance:updated', { workerId: String(worker._id), date, status: record.status }, 'room:staff');
  return record;
}

export async function list({ date, from, to, worker }, user) {
  const filter = {};
  if (user.role === 'worker') filter.worker = (await forUser(user.id))._id;
  else if (worker) filter.worker = worker;

  if (from || to) filter.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  else filter.date = date ?? dayKey();

  return Attendance.find(filter).sort({ date: -1, checkIn: 1 }).populate(POPULATE).lean();
}

/** Counts for one day: active workers without a record are absent. */
export async function summary(date = dayKey()) {
  const [records, activeWorkers] = await Promise.all([
    Attendance.find({ date }).lean(),
    Worker.countDocuments({ status: 'active' }),
  ]);
  const late = records.filter((r) => r.status === 'late').length;
  const present = records.length - late;
  return { date, total: activeWorkers, present, late, absent: Math.max(0, activeWorkers - records.length) };
}
