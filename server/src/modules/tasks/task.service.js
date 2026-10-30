import { Machine, ProductionOrder, Task, Worker } from '../../models/index.js';
import { emit } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { forUser } from '../workers/worker.service.js';

const POPULATE = [
  { path: 'assignedTo', select: 'employeeId user', populate: { path: 'user', select: 'name' } },
  { path: 'machine', select: 'code name' },
  { path: 'order', select: 'orderNo product' },
];

async function checkRefs({ assignedTo, machine, order }) {
  if (assignedTo && !(await Worker.exists({ _id: assignedTo }))) throw ApiError.badRequest('Assigned worker does not exist');
  if (machine && !(await Machine.exists({ _id: machine }))) throw ApiError.badRequest('Machine does not exist');
  if (order && !(await ProductionOrder.exists({ _id: order }))) throw ApiError.badRequest('Order does not exist');
}

export async function list({ assignedTo, status, page, limit }, user) {
  const filter = {};
  if (status) filter.status = status;
  if (user.role === 'worker') filter.assignedTo = (await forUser(user.id))._id;
  else if (assignedTo) filter.assignedTo = assignedTo;
  return paginate(Task, filter, { page, limit, sort: { dueAt: 1, createdAt: -1 }, populate: POPULATE });
}

export async function create(data) {
  await checkRefs(data);
  const task = await Task.create(data);
  emit('task:updated', { _id: String(task._id) });
  return Task.findById(task._id).populate(POPULATE).lean();
}

export async function update(id, data) {
  await checkRefs(data);
  const task = await Task.findByIdAndUpdate(id, data, { new: true, runValidators: true }).populate(POPULATE).lean();
  if (!task) throw ApiError.notFound('Task not found');
  emit('task:updated', { _id: id });
  return task;
}

export async function setStatus(id, status, user) {
  const task = await Task.findById(id);
  if (!task) throw ApiError.notFound('Task not found');
  if (user.role === 'worker') {
    const me = await forUser(user.id);
    if (String(task.assignedTo) !== String(me._id)) throw ApiError.forbidden('This task is not assigned to you');
  }
  task.status = status;
  await task.save();
  emit('task:updated', { _id: id, status });
  return Task.findById(id).populate(POPULATE).lean();
}

export async function remove(id) {
  const task = await Task.findByIdAndDelete(id);
  if (!task) throw ApiError.notFound('Task not found');
  emit('task:updated', { _id: id });
}
