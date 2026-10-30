import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { pageQuery } from '../../utils/pagination.js';
import { ok } from '../../utils/respond.js';
import * as service from './task.service.js';

const STATUS = z.enum(['todo', 'in_progress', 'done']);
const createSchema = z.object({
  title: z.string().min(2).max(120),
  assignedTo: objectId.optional(),
  machine: objectId.optional(),
  order: objectId.optional(),
  dueAt: z.coerce.date().optional(),
});
const updateSchema = createSchema.partial();
const listQuery = pageQuery.extend({ assignedTo: objectId.optional(), status: STATUS.optional() });

const staff = authorize('admin', 'manager');
const router = Router();
router.use(authenticate);

router.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => ok(res, await service.list(req.query, req.user))));
router.post('/', staff, validate(createSchema), asyncHandler(async (req, res) => ok(res, await service.create(req.body), 'Task created', 201)));
router.patch('/:id', staff, validate(updateSchema), asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body))));
router.patch('/:id/status', validate(z.object({ status: STATUS })),
  asyncHandler(async (req, res) => ok(res, await service.setStatus(req.params.id, req.body.status, req.user))));
router.delete('/:id', staff, asyncHandler(async (req, res) => {
  await service.remove(req.params.id);
  ok(res, null, 'Task deleted');
}));

export default router;
