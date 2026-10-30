import { LeaveRequest, User, Worker } from '../../models/index.js';
import { emit } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { dayKey } from '../../utils/time.js';
import { paginate } from '../../utils/pagination.js';
import { notify, notifyStaff } from '../notifications/notification.service.js';
import { forUser } from '../workers/worker.service.js';

const MAX_DAYS = 30;
const POPULATE = [
  { path: 'worker', select: 'employeeId user', populate: { path: 'user', select: 'name' } },
  { path: 'reviewedBy', select: 'name' },
];
const DAY_MS = 86_400_000;
const span = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

export async function getById(id) {
  const lr = await LeaveRequest.findById(id).populate(POPULATE).lean();
  if (!lr) throw ApiError.notFound('Leave request not found');
  return { ...lr, days: span(lr.from, lr.to) };
}

export async function create({ from, to, reason, worker: workerId }, user) {
  if (to < from) throw ApiError.badRequest('The end date cannot be before the start date');
  if (span(from, to) > MAX_DAYS) throw ApiError.badRequest(`Leave can cover at most ${MAX_DAYS} days at a time`);
  if (from < dayKey()) throw ApiError.badRequest('Leave cannot start in the past');

  // Workers ask for themselves; staff may record leave for a worker.
  const worker = user.role === 'worker' ? await forUser(user.id) : await Worker.findById(workerId);
  if (!worker) throw ApiError.badRequest(user.role === 'worker' ? 'No worker profile for this account' : 'Choose a worker');

  const overlap = await LeaveRequest.exists({ worker: worker._id, status: { $in: ['pending', 'approved'] }, from: { $lte: to }, to: { $gte: from } });
  if (overlap) throw ApiError.conflict('This overlaps another pending or approved leave request');

  const lr = await LeaveRequest.create({ worker: worker._id, from, to, reason });
  const who = await User.findById(worker.user).select('name').lean();
  await notifyStaff({ kind: 'leave', tone: 'info', title: `Leave request: ${who?.name ?? worker.employeeId}`, body: `${from} to ${to}${reason ? `: ${reason}` : ''}`, link: '/workers' });
  emit('leave:updated', { _id: String(lr._id), status: lr.status }, 'room:staff');
  return getById(lr._id);
}

export async function list({ status, worker, page, limit }, user) {
  const filter = {};
  if (status) filter.status = status;
  if (user.role === 'worker') filter.worker = (await forUser(user.id))._id;
  else if (worker) filter.worker = worker;
  const res = await paginate(LeaveRequest, filter, { page, limit, populate: POPULATE });
  return { ...res, items: res.items.map((i) => ({ ...i, days: span(i.from, i.to) })) };
}

export async function review(id, { status, note }, reviewerId) {
  // The status is in the filter, so only one reviewer can decide a pending request.
  const lr = await LeaveRequest.findOneAndUpdate(
    { _id: id, status: 'pending' }, { status, reviewNote: note, reviewedBy: reviewerId, reviewedAt: new Date() }, { new: true },
  );
  if (!lr) {
    if (!(await LeaveRequest.exists({ _id: id }))) throw ApiError.notFound('Leave request not found');
    throw ApiError.conflict('This request has already been decided or withdrawn');
  }
  const worker = await Worker.findById(lr.worker).select('user').lean();
  if (worker) {
    await notify([worker.user], {
      kind: 'leave', tone: status === 'approved' ? 'success' : 'warning', link: '/workers',
      title: `Your leave request was ${status}`, body: `${lr.from} to ${lr.to}${note ? `: ${note}` : ''}`,
    });
  }
  emit('leave:updated', { _id: id, status }, 'room:staff');
  return getById(id);
}

export async function cancel(id, user) {
  const lr = await LeaveRequest.findById(id);
  if (!lr) throw ApiError.notFound('Leave request not found');
  if (user.role === 'worker' && String(lr.worker) !== String((await forUser(user.id))._id)) throw ApiError.forbidden('This is not your request');
  if (lr.status !== 'pending') throw ApiError.conflict('Only a pending request can be withdrawn');
  const done = await LeaveRequest.updateOne({ _id: id, status: 'pending' }, { status: 'cancelled' });
  if (!done.modifiedCount) throw ApiError.conflict('This request was just decided');
  emit('leave:updated', { _id: id, status: 'cancelled' }, 'room:staff');
  return getById(id);
}

/** Day keys covered by approved leave for the given workers, used so approved leave is not shown as absence. */
export async function approvedDays(keys) {
  const rows = await LeaveRequest.find({ status: 'approved', from: { $lte: keys.at(-1) }, to: { $gte: keys[0] } }).select('worker from to').lean();
  const set = new Set();
  for (const r of rows) for (const k of keys) if (k >= r.from && k <= r.to) set.add(`${r.worker}|${k}`);
  return set;
}
