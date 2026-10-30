import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { resolveUser } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

let io = null;

export function initSockets(httpServer) {
  io = new Server(httpServer, { cors: { origin: env.clientOrigins, credentials: true } });

  io.use(async (socket, next) => {
    try {
      const payload = jwt.verify(socket.handshake.auth?.token, env.jwtSecret);
      // The same rules as the REST API: active account, current role, token not older than a password reset.
      socket.data.user = await resolveUser(payload);
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { role } = socket.data.user;
    socket.join('room:all');
    socket.join(`room:${role}`);
    socket.join(`user:${socket.data.user.id}`);
    if (role !== 'worker') socket.join('room:staff');

    socket.on('subscribe:machine', (id) => {
      if (typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)) socket.join(`machine:${id}`);
    });
    socket.on('unsubscribe:machine', (id) => socket.leave(`machine:${id}`));
  });

  logger.info('Socket.io ready');
  return io;
}

/** Closes every live connection of a user. They reconnect through the normal checks (and fail them if revoked). */
export function disconnectUser(userId) {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.user?.id === String(userId)) socket.disconnect(true);
  }
}

/**
 * Shuts Socket.io down, which also closes the HTTP server it is attached to. A plain server.close()
 * leaves WebSocket connections open, so a graceful shutdown would wait on them until a timeout.
 */
export async function closeSockets() {
  if (!io) return;
  const closing = io;
  io = null;
  await new Promise((resolve) => closing.close(resolve));
}

/** Emit after a successful DB write. No-op when sockets are not running (seed, tests). */
export function emit(event, payload, ...rooms) {
  if (!io) return;
  const targets = rooms.length ? rooms : ['room:all'];
  targets.reduce((chain, room) => chain.to(room), io).emit(event, payload);
}
