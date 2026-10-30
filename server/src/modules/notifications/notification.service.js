import { Notification, User } from '../../models/index.js';
import { emit } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';

/** Stores one notification per recipient and pushes it to that user's own socket room. */
export async function notify(userIds, { title, body, tone = 'info', kind = 'info', link }) {
  const ids = [...new Set(userIds.map(String))];
  if (!ids.length) return [];
  const docs = await Notification.insertMany(ids.map((user) => ({ user, title, body, tone, kind, link })));
  for (const d of docs) emit('notification:new', d.toObject(), `user:${d.user}`);
  return docs;
}

export async function staffIds() {
  const rows = await User.find({ role: { $in: ['admin', 'manager'] }, isActive: true }).select('_id').lean();
  return rows.map((u) => u._id);
}

export const notifyStaff = async (payload) => notify(await staffIds(), payload);

export async function list(userId, limit = 30) {
  const [items, unread] = await Promise.all([
    Notification.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ user: userId, readAt: { $exists: false } }),
  ]);
  return { items, unread };
}

export async function markRead(userId, id) {
  const n = await Notification.findOneAndUpdate({ _id: id, user: userId }, { $set: { readAt: new Date() } }, { new: true }).lean();
  if (!n) throw ApiError.notFound('Notification not found');
  return n;
}

export async function markAllRead(userId) {
  const r = await Notification.updateMany({ user: userId, readAt: { $exists: false } }, { $set: { readAt: new Date() } });
  return { updated: r.modifiedCount };
}
