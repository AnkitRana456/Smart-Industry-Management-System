import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { pageQuery } from '../../utils/pagination.js';
import { ok } from '../../utils/respond.js';
import * as service from './machine.service.js';
import { createSchema, listQuery, rangeQuery, statusSchema, updateSchema } from './machine.validation.js';

const staff = authorize('admin', 'manager');
const router = Router();
router.use(authenticate);

router.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => ok(res, await service.list(req.query))));
router.get('/downtime-summary', validate(rangeQuery, 'query'),
  asyncHandler(async (req, res) => ok(res, await service.downtimeSummary(req.query))));
router.post('/', staff, validate(createSchema),
  asyncHandler(async (req, res) => ok(res, await service.create(req.body), 'Machine created', 201)));

router.get('/:id', asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id))));
router.patch('/:id', staff, validate(updateSchema),
  asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body))));
router.delete('/:id', staff, asyncHandler(async (req, res) => {
  await service.remove(req.params.id);
  ok(res, null, 'Machine deleted');
}));
router.patch('/:id/status', staff, validate(statusSchema),
  asyncHandler(async (req, res) => ok(res, await service.changeStatus(req.params.id, req.body), 'Status updated')));
router.get('/:id/logs', validate(pageQuery, 'query'),
  asyncHandler(async (req, res) => ok(res, await service.logs(req.params.id, req.query))));

export default router;
