import { AuditLog } from '../models/index.js';
import { logger } from '../utils/logger.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Never record request bodies for these, and never record their values anywhere.
const SKIP = [/^\/api\/auth\/(login|refresh)/];

/**
 * Records who changed what. It stores the route pattern, resource id and the *names* of
 * the fields sent, never their values, so passwords and personal data never reach the log.
 */
export function audit(req, res, next) {
  if (!MUTATING.has(req.method) || SKIP.some((re) => re.test(req.originalUrl))) return next();

  // Read now: later validation fills in defaults, and the log should show what the client sent.
  const sentFields = Object.keys(req.body ?? {});

  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.user) return;
    const pattern = `${req.baseUrl}${req.route?.path ?? ''}`.replace(/\/$/, '') || req.originalUrl.split('?')[0];
    AuditLog.create({
      user: req.user.id,
      action: `${req.method} ${pattern}`,
      resource: pattern.split('/')[2] ?? null,
      resourceId: req.params?.id ?? req.params?.machineId ?? null,
      diff: { fields: sentFields },
      ip: req.ip,
    }).catch((err) => logger.error({ err }, 'Audit write failed'));
  });
  next();
}
