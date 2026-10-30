import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { pageQuery } from '../../utils/pagination.js';
import { ok } from '../../utils/respond.js';
import * as service from './leave.service.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const createSchema = z.object({ from: day, to: day, reason: z.string().trim().max(300).optional(), worker: objectId.optional() });
const reviewSchema = z.object({ status: z.enum(['approved', 'rejected']), note: z.string().trim().max(300).optional() });
const listQuery = pageQuery.extend({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(), worker: objectId.optional() });

const router = Router();
router.use(authenticate);

router.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => ok(res, await service.list(req.query, req.user))));
router.post('/', validate(createSchema), asyncHandler(async (req, res) => ok(res, await service.create(req.body, req.user), 'Leave requested', 201)));
router.patch('/:id/review', authorize('admin', 'manager'), validate(reviewSchema),
  asyncHandler(async (req, res) => ok(res, await service.review(req.params.id, req.body, req.user.id), 'Reviewed')));
router.patch('/:id/cancel', asyncHandler(async (req, res) => ok(res, await service.cancel(req.params.id, req.user), 'Withdrawn')));

export default router;
