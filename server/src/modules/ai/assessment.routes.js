import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { aiLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { ok } from '../../utils/respond.js';
import * as service from './assessment.service.js';

const params = z.object({ machineId: objectId });
// Unknown keys are stripped: readings can only come from the database, never from the request.
const body = z.object({
  includeMaintenanceHistory: z.boolean().default(true),
  forceNewAssessment: z.boolean().default(false),
});
const historyQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: objectId.optional() });

// Guards are attached per route: this router shares the /api/machines prefix with the
// machine routes, so a router-wide guard would also lock workers out of reading machines.
const staff = [authenticate, authorize('admin', 'manager')];

const router = Router();
router.post('/:machineId/assess-risk', ...staff, aiLimiter, validate(params, 'params'), validate(body),
  asyncHandler(async (req, res) => ok(res, await service.assess(req.params.machineId, req.body, req.user.id), 'Assessment saved', 201)));
router.get('/:machineId/assessments', ...staff, validate(params, 'params'), validate(historyQuery, 'query'),
  asyncHandler(async (req, res) => ok(res, await service.history(req.params.machineId, req.query))));

export default router;
