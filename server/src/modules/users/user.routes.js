import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { pageQuery } from '../../utils/pagination.js';
import { ok } from '../../utils/respond.js';
import * as service from './user.service.js';

const listQuery = pageQuery.extend({ search: z.string().max(60).optional(), role: z.enum(['admin', 'manager', 'worker']).optional() });
const updateSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  role: z.enum(['admin', 'manager', 'worker']).optional(),
  isActive: z.boolean().optional(),
});
const passwordSchema = z.object({ password: z.string().min(8).max(128) });

const router = Router();
router.use(authenticate);

// Managers can read the user list (matrix: Users, Manager = Read). Changes are admin only.
router.get('/', authorize('admin', 'manager'), validate(listQuery, 'query'), asyncHandler(async (req, res) => ok(res, await service.list(req.query))));
router.patch('/:id', authorize('admin'), validate(z.object({ id: objectId }), 'params'), validate(updateSchema),
  asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body, req.user.id), 'User updated')));
router.post('/:id/reset-password', authorize('admin'), validate(z.object({ id: objectId }), 'params'), validate(passwordSchema),
  asyncHandler(async (req, res) => {
    await service.resetPassword(req.params.id, req.body.password);
    ok(res, null, 'Password reset. The user must sign in again.');
  }));

export default router;
