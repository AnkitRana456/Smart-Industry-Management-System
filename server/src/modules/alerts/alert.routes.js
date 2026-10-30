import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { pageQuery } from '../../utils/pagination.js';
import { ok } from '../../utils/respond.js';
import * as service from './alert.service.js';

const query = pageQuery.extend({
  status: z.enum(['open', 'acknowledged', 'resolved']).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
});

const router = Router();
router.use(authenticate);

router.get('/', validate(query, 'query'), asyncHandler(async (req, res) => ok(res, await service.list(req.query))));
router.patch('/:id/acknowledge', authorize('admin', 'manager'),
  asyncHandler(async (req, res) => ok(res, await service.setStatus(req.params.id, 'acknowledged'))));
router.patch('/:id/resolve', authorize('admin', 'manager'),
  asyncHandler(async (req, res) => ok(res, await service.setStatus(req.params.id, 'resolved'))));

export default router;
