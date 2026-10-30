import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { User } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { sendMail } from '../../utils/mailer.js';
import { resetPassword as setPassword } from '../users/user.service.js';

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;
const RESET_MS = 30 * 60_000;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const signAccess = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role }, env.jwtSecret, { expiresIn: '15m' });
const signRefresh = (user) =>
  jwt.sign({ sub: String(user._id) }, env.jwtRefreshSecret, { expiresIn: '7d' });

export const publicUser = (u) => ({
  id: String(u._id), name: u.name, email: u.email, role: u.role, isActive: u.isActive,
});

async function issueTokens(user) {
  const accessToken = signAccess(user);
  const refreshToken = signRefresh(user);
  await User.updateOne({ _id: user._id }, { refreshTokenHash: sha(refreshToken) });
  return { accessToken, refreshToken };
}

export async function register({ name, email, password, role }) {
  if (await User.exists({ email })) throw ApiError.conflict('Email already registered');
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, passwordHash, role });
  return publicUser(user);
}

export async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil - Date.now()) / 60_000);
    throw new ApiError(429, `Too many failed sign-in attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
  const valid = user && user.isActive && (await bcrypt.compare(password, user.passwordHash));
  if (!valid) {
    if (user) {
      const n = (await User.findOneAndUpdate({ _id: user._id }, { $inc: { failedLogins: 1 } }, { new: true })).failedLogins;
      if (n >= MAX_FAILED) await User.updateOne({ _id: user._id }, { lockedUntil: new Date(Date.now() + LOCK_MS), failedLogins: 0 });
    }
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (user.failedLogins || user.lockedUntil) await User.updateOne({ _id: user._id }, { failedLogins: 0, $unset: { lockedUntil: 1 } });
  const tokens = await issueTokens(user);
  return { user: publicUser(user), ...tokens };
}

export async function refresh(token) {
  if (!token) throw ApiError.unauthorized('Missing refresh token');
  let payload;
  try {
    payload = jwt.verify(token, env.jwtRefreshSecret);
  } catch {
    throw ApiError.unauthorized('Invalid refresh token');
  }
  const user = await User.findById(payload.sub).select('+refreshTokenHash');
  if (!user || !user.isActive || user.refreshTokenHash !== sha(token)) {
    throw ApiError.unauthorized('Refresh token revoked');
  }
  const tokens = await issueTokens(user);
  return { user: publicUser(user), ...tokens };
}

export async function logout(userId) {
  await User.updateOne({ _id: userId }, { $unset: { refreshTokenHash: 1 } });
}

export async function me(userId) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User not found');
  return publicUser(user);
}

/**
 * Always resolves the same way, so the answer never reveals whether an email has an account.
 * The link carries a random token; only its hash is stored, and it works once for 30 minutes.
 */
export async function forgotPassword(email) {
  const user = await User.findOne({ email });
  if (!user || !user.isActive) return;
  const token = crypto.randomBytes(32).toString('hex');
  await User.updateOne({ _id: user._id }, { resetTokenHash: sha(token), resetTokenExpires: new Date(Date.now() + RESET_MS) });
  await sendMail({
    to: user.email,
    subject: 'Reset your SIMS password',
    text: `Use this link within 30 minutes to choose a new password:\n${env.clientOrigins[0]}/reset-password?token=${token}\n\nIf you did not ask for this, ignore this email.`,
  });
}

export async function resetWithToken(token, password) {
  const user = await User.findOneAndUpdate(
    { resetTokenHash: sha(token), resetTokenExpires: { $gt: new Date() } },
    { $unset: { resetTokenHash: 1, resetTokenExpires: 1, lockedUntil: 1 }, failedLogins: 0 },
  ).select('_id');
  // The token is cleared by the same atomic update that found it, so it cannot be used twice.
  if (!user) throw ApiError.badRequest('This reset link is invalid or has expired. Ask for a new one.');
  await setPassword(user._id, password);
}
