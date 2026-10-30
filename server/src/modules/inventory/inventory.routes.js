import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { pageQuery } from '../../utils/pagination.js';
import { ok } from '../../utils/respond.js';
import * as service from './inventory.service.js';
import { createSchema, importSchema, listQuery, transactionSchema, updateSchema } from './inventory.validation.js';

const staff = authorize('admin', 'manager');
const router = Router();
router.use(authenticate);

router.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => ok(res, await service.list(req.query))));
router.get('/low-stock', asyncHandler(async (_req, res) => ok(res, await service.lowStock())));
router.post('/', staff, validate(createSchema),
  asyncHandler(async (req, res) => ok(res, await service.create(req.body, req.user.id), 'Item created', 201)));

router.get('/valuation', staff, asyncHandler(async (_req, res) => ok(res, await service.valuation())));
router.post('/import', staff, validate(importSchema),
  asyncHandler(async (req, res) => ok(res, await service.importRows(req.body.rows, req.user.id), 'Import finished')));

router.get('/:id', asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id))));
router.patch('/:id', staff, validate(updateSchema),
  asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body))));
router.delete('/:id', staff, asyncHandler(async (req, res) => {
  await service.remove(req.params.id);
  ok(res, null, 'Item deleted');
}));

router.post('/:id/transactions', staff, validate(transactionSchema),
  asyncHandler(async (req, res) => ok(res, await service.addTransaction(req.params.id, req.body, req.user.id), 'Transaction recorded', 201)));
router.get('/:id/transactions', validate(pageQuery, 'query'),
  asyncHandler(async (req, res) => ok(res, await service.transactions(req.params.id, req.query))));

export default router;
