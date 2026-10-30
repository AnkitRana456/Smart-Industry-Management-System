import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/respond.js';
import * as service from './auth.service.js';

const cookieOpts = {
  httpOnly: true,
  sameSite: env.nodeEnv === 'production' ? 'none' : 'lax',
  secure: env.nodeEnv === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/api/auth',
};

export const register = asyncHandler(async (req, res) => {
  ok(res, await service.register(req.body), 'User created', 201);
});

export const login = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await service.login(req.body);
  res.cookie('refreshToken', refreshToken, cookieOpts);
  ok(res, { user, accessToken }, 'Logged in');
});

export const refresh = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await service.refresh(req.cookies?.refreshToken);
  res.cookie('refreshToken', refreshToken, cookieOpts);
  ok(res, { user, accessToken }, 'Token refreshed');
});

export const logout = asyncHandler(async (req, res) => {
  await service.logout(req.user.id);
  res.clearCookie('refreshToken', { ...cookieOpts, maxAge: undefined });
  ok(res, null, 'Logged out');
});

export const forgotPassword = asyncHandler(async (req, res) => {
  await service.forgotPassword(req.body.email);
  ok(res, null, 'If that email has an account, a reset link is on its way.');
});

export const resetPassword = asyncHandler(async (req, res) => {
  await service.resetWithToken(req.body.token, req.body.password);
  ok(res, null, 'Password changed. Please sign in.');
});

export const me = asyncHandler(async (req, res) => {
  ok(res, await service.me(req.user.id));
});
