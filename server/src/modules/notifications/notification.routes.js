import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { ok } from '../../utils/respond.js';
import * as service from './notification.service.js';

const router = Router();
router.use(authenticate);

// Every route is scoped to the signed-in user; there is no way to read or change someone else's.
router.get('/', validate(z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }), 'query'),
  asyncHandler(async (req, res) => ok(res, await service.list(req.user.id, req.query.limit))));
router.patch('/read-all', asyncHandler(async (req, res) => ok(res, await service.markAllRead(req.user.id))));
router.patch('/:id/read', validate(z.object({ id: objectId }), 'params'),
  asyncHandler(async (req, res) => ok(res, await service.markRead(req.user.id, req.params.id))));

export default router;
