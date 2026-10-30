import { Alert, User } from '../../models/index.js';
import { emit } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';
import { notify, notifyStaff } from '../notifications/notification.service.js';

/** Creates an alert unless an unresolved one already exists for the same type and source. */
export async function create({ type, severity = 'warning', source, sourceId, message }) {
  const key = sourceId ? String(sourceId) : undefined;
  if (key) {
    const existing = await Alert.findOne({ type, sourceId: key, status: { $in: ['open', 'acknowledged'] } });
    if (existing) return null;
  }
  const alert = await Alert.create({ type, severity, source, sourceId: key, message });
  emit('alert:new', alert.toObject(), 'room:staff');
  // info alerts stay in the alert list only; warnings and criticals also reach every manager's bell.
  if (severity !== 'info') await notifyStaff({ kind: 'alert', tone: severity, title: severity === 'critical' ? 'Critical alert' : 'New alert', body: message, link: '/alerts' });
  return alert;
}

export const findOpen = (type, sourceId) =>
  Alert.findOne({ type, sourceId: String(sourceId), status: { $in: ['open', 'acknowledged'] } }).lean();

export async function resolveFor(type, sourceId) {
  const res = await Alert.updateMany(
    { type, sourceId: String(sourceId), status: { $in: ['open', 'acknowledged'] } },
    { status: 'resolved' },
  );
  if (res.modifiedCount) emit('alert:updated', { type, sourceId: String(sourceId), status: 'resolved' }, 'room:staff');
  return res.modifiedCount;
}

export function list({ status, severity, page, limit }) {
  const filter = {};
  if (status) filter.status = status;
  if (severity) filter.severity = severity;
  return paginate(Alert, filter, { page, limit });
}

export async function setStatus(id, status) {
  const alert = await Alert.findByIdAndUpdate(id, { status }, { new: true });
  if (!alert) throw ApiError.notFound('Alert not found');
  emit('alert:updated', alert.toObject(), 'room:staff');
  return alert;
}

const ESCALATE_AFTER_MIN = 30;

/** Critical alerts nobody acknowledged within half an hour are escalated once, to the admins. */
export async function escalateStale(now = new Date()) {
  const cutoff = new Date(now.getTime() - ESCALATE_AFTER_MIN * 60_000);
  const stale = await Alert.find({ severity: 'critical', status: 'open', escalatedAt: { $exists: false }, createdAt: { $lte: cutoff } });
  if (!stale.length) return { escalated: 0 };
  const admins = (await User.find({ role: 'admin', isActive: true }).select('_id').lean()).map((u) => u._id);
  let escalated = 0;
  for (const a of stale) {
    // Claim first so two overlapping runs cannot notify twice.
    const claim = await Alert.updateOne({ _id: a._id, escalatedAt: { $exists: false } }, { escalatedAt: now });
    if (!claim.modifiedCount) continue;
    escalated += 1;
    await notify(admins, { kind: 'alert', tone: 'critical', title: 'Escalated: critical alert not acknowledged', body: a.message, link: '/alerts' });
  }
  if (escalated) emit('alert:updated', { escalated }, 'room:staff');
  return { escalated };
}
