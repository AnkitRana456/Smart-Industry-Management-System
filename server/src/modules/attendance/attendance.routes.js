import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { ok } from '../../utils/respond.js';
import * as service from './attendance.service.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const listQuery = z.object({ date: day.optional(), from: day.optional(), to: day.optional(), worker: objectId.optional() });

const router = Router();
router.use(authenticate);

router.post('/check-in', authorize('worker'), asyncHandler(async (req, res) => ok(res, await service.checkIn(req.user.id), 'Checked in', 201)));
router.post('/check-out', authorize('worker'), asyncHandler(async (req, res) => ok(res, await service.checkOut(req.user.id), 'Checked out')));
router.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => ok(res, await service.list(req.query, req.user))));
router.get('/summary', authorize('admin', 'manager'), validate(z.object({ date: day.optional() }), 'query'),
  asyncHandler(async (req, res) => ok(res, await service.summary(req.query.date))));

export default router;
