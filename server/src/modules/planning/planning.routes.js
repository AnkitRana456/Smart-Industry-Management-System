import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import mongoose from 'mongoose';
import { ProductionOrder, Task } from '../../models/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { ok } from '../../utils/respond.js';
import { forUser } from '../workers/worker.service.js';
import * as service from './planning.service.js';

const staff = authorize('admin', 'manager');
const items = z.array(z.object({ item: objectId, qtyPerUnit: z.number().positive().max(100_000) })).min(1).max(20);
const bomCreate = z.object({ product: z.string().trim().min(2).max(80), items });
const checkSchema = z.object({
  order: objectId,
  stage: z.string().trim().min(2).max(60),
  inspectedQty: z.number().int().min(1).max(1_000_000),
  defectCount: z.number().int().min(0).default(0),
  scrapQty: z.number().int().min(0).default(0),
  notes: z.string().trim().max(300).optional(),
});
const feasibilitySchema = z.object({
  product: z.string().trim().min(2).max(80),
  quantity: z.number().int().min(1).max(1_000_000),
  machines: z.array(objectId).max(10).default([]),
});

/** Mounted at /api/bom. Anyone signed in can read; staff change. */
export const bomRoutes = Router();
bomRoutes.use(authenticate);
bomRoutes.get('/', asyncHandler(async (_req, res) => ok(res, await service.listBoms())));
bomRoutes.post('/', staff, validate(bomCreate), asyncHandler(async (req, res) => ok(res, await service.createBom(req.body), 'Bill of materials created', 201)));
bomRoutes.patch('/:id', staff, validate(z.object({ items })), asyncHandler(async (req, res) => ok(res, await service.updateBom(req.params.id, req.body))));
bomRoutes.delete('/:id', staff, asyncHandler(async (req, res) => {
  await service.removeBom(req.params.id);
  ok(res, null, 'Deleted');
}));

/**
 * A worker may log checks only for an order that one of their tasks points at; staff for any order.
 */
async function assertCanCheck(orderId, user) {
  if (user.role !== 'worker') return;
  const me = await forUser(user.id);
  if (!(await Task.exists({ assignedTo: me._id, order: orderId }))) throw ApiError.forbidden('This order is not linked to your tasks');
}

/** Mounted at /api/quality-checks. */
export const qualityRoutes = Router();
qualityRoutes.use(authenticate);
qualityRoutes.post('/', validate(checkSchema), asyncHandler(async (req, res) => {
  await assertCanCheck(req.body.order, req.user);
  ok(res, await service.logCheck(req.body, req.user), 'Quality check logged', 201);
}));
qualityRoutes.get('/order/:orderId', validate(z.object({ orderId: objectId }), 'params'), asyncHandler(async (req, res) => {
  await assertCanCheck(req.params.orderId, req.user);
  if (!(await ProductionOrder.exists({ _id: req.params.orderId }))) throw ApiError.notFound('Order not found');
  ok(res, { summary: await service.qualitySummary(new mongoose.Types.ObjectId(req.params.orderId)), checks: await service.listChecks(req.params.orderId) });
}));

/** Mounted at /api/production. */
export const productionPlanRoutes = Router();
productionPlanRoutes.post('/feasibility', authenticate, staff, validate(feasibilitySchema),
  asyncHandler(async (req, res) => ok(res, await service.feasibility(req.body))));
