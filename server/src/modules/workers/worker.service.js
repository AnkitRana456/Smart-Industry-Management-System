import bcrypt from 'bcryptjs';
import { Shift, User, Worker } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const POPULATE = [{ path: 'user', select: 'name email isActive' }, { path: 'shift', select: 'name startTime endTime' }];

export async function forUser(userId) {
  const worker = await Worker.findOne({ user: userId }).populate(POPULATE).lean();
  if (!worker) throw ApiError.notFound('No worker profile is linked to this account');
  return worker;
}

export async function list({ search, status, department, page, limit }) {
  const filter = {};
  if (status) filter.status = status;
  if (department) filter.department = department;
  if (search) {
    const re = new RegExp(escapeRe(search), 'i');
    const userIds = await User.find({ name: re, role: 'worker' }).distinct('_id');
    filter.$or = [{ employeeId: re }, { department: re }, { user: { $in: userIds } }];
  }
  return paginate(Worker, filter, { page, limit, sort: { employeeId: 1 }, populate: POPULATE });
}

export async function getById(id) {
  const worker = await Worker.findById(id).populate(POPULATE).lean();
  if (!worker) throw ApiError.notFound('Worker not found');
  return worker;
}

export async function create({ name, email, password, employeeId, department, skills, shift }) {
  if (await User.exists({ email })) throw ApiError.conflict('Email already registered');
  if (await Worker.exists({ employeeId })) throw ApiError.conflict('Employee ID already exists');
  if (shift && !(await Shift.exists({ _id: shift }))) throw ApiError.badRequest('Shift does not exist');

  const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 10), role: 'worker' });
  try {
    const worker = await Worker.create({ user: user._id, employeeId, department, skills, shift });
    return getById(worker._id);
  } catch (err) {
    await User.deleteOne({ _id: user._id });
    throw err;
  }
}

export async function update(id, { name, shift, ...rest }) {
  const worker = await Worker.findById(id);
  if (!worker) throw ApiError.notFound('Worker not found');
  if (shift && !(await Shift.exists({ _id: shift }))) throw ApiError.badRequest('Shift does not exist');
  Object.assign(worker, rest);
  if (shift !== undefined) worker.shift = shift;
  await worker.save();
  if (name) await User.updateOne({ _id: worker.user }, { name });
  if (rest.status) await User.updateOne({ _id: worker.user }, { isActive: rest.status !== 'terminated' });
  return getById(id);
}

/** Workers are never hard-deleted: attendance and task history must stay intact. */
export async function deactivate(id) {
  return update(id, { status: 'terminated' });
}

export const listShifts = () => Shift.find().sort({ startTime: 1 }).lean();

export async function createShift(data) {
  return Shift.create(data);
}

export async function updateShift(id, data) {
  const shift = await Shift.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!shift) throw ApiError.notFound('Shift not found');
  return shift;
}

export async function removeShift(id) {
  if (await Worker.exists({ shift: id, status: { $ne: 'terminated' } })) {
    throw ApiError.conflict('Shift still has workers assigned');
  }
  const shift = await Shift.findByIdAndDelete(id);
  if (!shift) throw ApiError.notFound('Shift not found');
}
