import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ProductionOrder } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { ok } from '../../utils/respond.js';
import * as service from './insights.service.js';

const id = z.object({ id: objectId });
const router = Router();
router.use(authenticate, authorize('admin', 'manager'));

router.get('/machines/:id/anomalies', validate(id, 'params'), asyncHandler(async (req, res) => ok(res, await service.machineAnomalies(req.params.id))));
router.get('/stock', asyncHandler(async (_req, res) => ok(res, await service.fleetStockCover())));
router.get('/orders', asyncHandler(async (_req, res) => ok(res, await service.orderProjections())));
router.get('/orders/:id', validate(id, 'params'), asyncHandler(async (req, res) => {
  const order = await ProductionOrder.findById(req.params.id).lean();
  if (!order) throw ApiError.notFound('Order not found');
  ok(res, await service.orderProjection(order));
}));

export default router;
