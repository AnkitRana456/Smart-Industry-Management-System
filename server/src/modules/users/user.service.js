import bcrypt from 'bcryptjs';
import { forgetUser } from '../../middleware/auth.js';
import { User } from '../../models/index.js';
import { disconnectUser } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { paginate } from '../../utils/pagination.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const publicUser = (u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, isActive: u.isActive, createdAt: u.createdAt });

export async function list({ search, role, page, limit }) {
  const filter = {};
  if (role) filter.role = role;
  if (search) {
    const re = new RegExp(escapeRe(search), 'i');
    filter.$or = [{ name: re }, { email: re }];
  }
  const res = await paginate(User, filter, { page, limit, sort: { createdAt: 1 } });
  return { ...res, items: res.items.map(publicUser) };
}

const activeAdmins = (excludeId) => User.countDocuments({ role: 'admin', isActive: true, _id: { $ne: excludeId } });

export async function update(id, data, actorId) {
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User not found');

  const demoting = data.role && data.role !== 'admin' && user.role === 'admin';
  const deactivating = data.isActive === false && user.isActive;
  if (String(id) === String(actorId) && (demoting || deactivating)) {
    throw ApiError.conflict('You cannot remove your own admin access or deactivate your own account.');
  }
  if ((demoting || (deactivating && user.role === 'admin')) && (await activeAdmins(id)) === 0) {
    throw ApiError.conflict('At least one active admin must remain.');
  }

  const roleChanged = data.role && data.role !== user.role;
  Object.assign(user, data);
  // A deactivated user must not be able to keep refreshing a session.
  if (deactivating) user.refreshTokenHash = undefined;
  await user.save();
  // Apply at once: drop the cached permissions and close sockets opened under the old ones.
  forgetUser(id);
  if (deactivating || roleChanged) disconnectUser(id);
  return publicUser(user);
}

export async function resetPassword(id, password) {
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User not found');
  user.passwordHash = await bcrypt.hash(password, 10);
  user.refreshTokenHash = undefined;
  user.tokensValidFrom = new Date();
  await user.save();
  forgetUser(id);
  disconnectUser(id);
}
