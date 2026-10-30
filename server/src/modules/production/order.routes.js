import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { pageQuery } from '../../utils/pagination.js';
import { ok } from '../../utils/respond.js';
import * as service from './order.service.js';

const createSchema = z.object({
  orderNo: z.string().min(3).max(20).optional(),
  product: z.string().min(2).max(80),
  quantity: z.number().int().min(1).max(1_000_000),
  machines: z.array(objectId).max(10).default([]),
  materials: z.array(z.object({ item: objectId, qtyPerUnit: z.number().positive().max(100_000) })).max(10).default([]),
  dueDate: z.coerce.date().optional(),
});
const updateSchema = createSchema.omit({ orderNo: true }).partial();
const statusSchema = z.object({ status: z.enum(['pending', 'in_progress', 'completed']) });
const progressSchema = z.object({ producedQty: z.number().int().min(0) });
const listQuery = pageQuery.extend({
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
  bottleneck: z.enum(['true', 'false']).optional(),
});

const staff = authorize('admin', 'manager');
const router = Router();
router.use(authenticate);

router.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => ok(res, await service.list(req.query, req.user))));
router.post('/', staff, validate(createSchema), asyncHandler(async (req, res) => ok(res, await service.create(req.body), 'Order created', 201)));
router.get('/:id', asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id))));
router.get('/:id/output', staff, asyncHandler(async (req, res) => ok(res, await service.outputHistory(req.params.id))));
router.patch('/:id', staff, validate(updateSchema), asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body))));
router.patch('/:id/status', staff, validate(statusSchema), asyncHandler(async (req, res) => ok(res, await service.setStatus(req.params.id, req.body.status, req.user.id), 'Status updated')));
router.patch('/:id/progress', staff, validate(progressSchema), asyncHandler(async (req, res) => ok(res, await service.setProgress(req.params.id, req.body.producedQty))));
router.delete('/:id', staff, asyncHandler(async (req, res) => {
  await service.remove(req.params.id);
  ok(res, null, 'Order deleted');
}));

export default router;
