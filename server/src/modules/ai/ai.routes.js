import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { aiLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/respond.js';
import { ask } from './analyst.service.js';
import { explainAlert } from './explain.service.js';
import { objectId } from '../../utils/objectId.js';
import { isConfigured } from './gemini.client.js';
import { timeRangeSchema } from './timeRange.js';
import { weeklySummary } from './weekly.service.js';

const askSchema = z.object({
  question: z.string().trim().min(3, 'Ask a question of at least 3 characters').max(500, 'Questions can be at most 500 characters'),
  timeRange: timeRangeSchema.optional(),
});

const router = Router();
router.use(authenticate, authorize('admin', 'manager'));

router.get('/status', (_req, res) => ok(res, { configured: isConfigured() }));
router.post('/ask', aiLimiter, validate(askSchema), asyncHandler(async (req, res) => ok(res, await ask(req.body))));
router.post('/explain-alert/:id', aiLimiter, validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => ok(res, await explainAlert(req.params.id))));
router.get('/weekly-summary', aiLimiter, validate(z.object({ refresh: z.enum(['true', 'false']).optional() }), 'query'),
  asyncHandler(async (req, res) => ok(res, await weeklySummary({ refresh: req.query.refresh === 'true' }))));

export default router;
