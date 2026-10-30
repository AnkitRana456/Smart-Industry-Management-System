import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';

// Access tokens live for 15 minutes, but an account can change inside that window: a user can be
// deactivated, demoted or have their password reset. So the role and active flag come from the
// database, cached briefly to keep this to about one query per user per 30 seconds.
const TTL_MS = 30_000;
const cache = new Map();

/** Call whenever a user's role, active flag or credentials change, so the change applies immediately. */
export const forgetUser = (id) => cache.delete(String(id));

export async function currentUser(id) {
  const key = String(id);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const u = await User.findById(key).select('role isActive tokensValidFrom').lean();
  const entry = { role: u?.role ?? null, isActive: Boolean(u?.isActive), tokensValidFrom: u?.tokensValidFrom ?? null, at: Date.now() };
  cache.set(key, entry);
  return entry;
}

/** Throws a 401 unless the token's user is active and the token was issued after any credential reset. */
export async function resolveUser(payload) {
  const u = await currentUser(payload.sub);
  if (!u.isActive) throw ApiError.unauthorized('This account is deactivated or no longer exists');
  if (u.tokensValidFrom && payload.iat < Math.floor(u.tokensValidFrom.getTime() / 1000)) {
    throw ApiError.unauthorized('Your session ended because the password was reset. Please sign in again.');
  }
  return { id: String(payload.sub), role: u.role };
}

export async function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(ApiError.unauthorized('Missing access token'));

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    return next(ApiError.unauthorized('Invalid or expired access token'));
  }
  try {
    req.user = await resolveUser(payload);
    next();
  } catch (err) {
    next(err);
  }
}

export const authorize = (...roles) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!roles.includes(req.user.role)) return next(ApiError.forbidden('Insufficient permissions'));
  next();
};
