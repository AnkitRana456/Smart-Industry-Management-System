import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/respond.js';
import * as sim from './simulator.service.js';

const tickBody = z.object({ events: z.number().int().min(1).max(10).default(3) });
const startBody = z.object({ intervalSec: z.number().int().min(2).max(60).default(5), events: z.number().int().min(1).max(5).default(2) });

const router = Router();
router.use(authenticate, authorize('admin'));
router.use((_req, _res, next) => {
  // Fake machine activity must never run against a real plant database by accident.
  if (env.nodeEnv === 'production' && !env.allowSimulator) return next(ApiError.forbidden('The simulator is disabled in production.'));
  next();
});

router.get('/status', (_req, res) => ok(res, sim.status()));
router.post('/machine-events', validate(tickBody), asyncHandler(async (req, res) => ok(res, await sim.tick(req.body), 'Simulated')));
router.post('/start', validate(startBody), (req, res) => ok(res, sim.start(req.body), 'Simulator started'));
router.post('/stop', (_req, res) => ok(res, sim.stop(), 'Simulator stopped'));

export default router;
