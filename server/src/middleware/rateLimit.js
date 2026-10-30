import rateLimit from 'express-rate-limit';

const make = (windowMs, limit) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, data: null, message: 'Too many requests', errors: null },
  });

export const apiLimiter = make(60_000, 300);
export const authLimiter = make(15 * 60_000, Number(process.env.AUTH_RATE_LIMIT_PER_15MIN) || 30);
export const aiLimiter = make(60_000, Number(process.env.AI_RATE_LIMIT_PER_MIN) || 20);
