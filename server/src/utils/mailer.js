import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Outgoing email. No SMTP client is wired in yet: with no transport the message is only logged, and
 * in production the body (which can hold a reset link) is deliberately left out of the log.
 * shortcut: log-only transport, swap `transport` for nodemailer when SMTP details exist.
 */
let transport = async ({ to, subject, text }) => {
  if (env.nodeEnv === 'production') logger.warn({ to, subject }, 'Email not sent: no mail transport is configured');
  else logger.info({ to, subject, text }, 'Email (log-only transport)');
};

export const setTransport = (fn) => { transport = fn; };
export const sendMail = (message) => transport(message);
