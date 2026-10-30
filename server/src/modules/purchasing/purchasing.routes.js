import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { pageQuery } from '../../utils/pagination.js';
import { ok } from '../../utils/respond.js';
import * as service from './purchasing.service.js';

const supplierSchema = z.object({
  name: z.string().trim().min(2).max(80),
  contactName: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(120).optional().or(z.literal('').transform(() => undefined)),
  phone: z.string().trim().max(30).optional(),
  leadTimeDays: z.number().int().min(0).max(365).default(7),
  notes: z.string().trim().max(500).optional(),
  active: z.boolean().default(true),
});
const lines = z.array(z.object({ item: objectId, qty: z.number().int().min(1).max(1_000_000), unitCost: z.number().min(0).max(10_000_000).default(0) })).max(50);
const poCreate = z.object({ supplier: objectId.optional(), lines: lines.default([]), notes: z.string().trim().max(500).optional() });
const poUpdate = poCreate.partial();
const poList = pageQuery.extend({ status: z.enum(['draft', 'approved', 'received', 'cancelled']).optional(), supplier: objectId.optional() });

const staff = authorize('admin', 'manager');

/** Mounted at /api/suppliers. */
export const supplierRoutes = Router();
supplierRoutes.use(authenticate, staff);
supplierRoutes.get('/', asyncHandler(async (_req, res) => ok(res, await service.listSuppliers())));
supplierRoutes.post('/', validate(supplierSchema), asyncHandler(async (req, res) => ok(res, await service.createSupplier(req.body), 'Supplier created', 201)));
supplierRoutes.patch('/:id', validate(supplierSchema.partial()), asyncHandler(async (req, res) => ok(res, await service.updateSupplier(req.params.id, req.body))));
supplierRoutes.delete('/:id', asyncHandler(async (req, res) => {
  await service.removeSupplier(req.params.id);
  ok(res, null, 'Supplier deleted');
}));

/** Mounted at /api/purchase-orders. Approval and receiving are always a person's action. */
export const purchaseRoutes = Router();
purchaseRoutes.use(authenticate, staff);
purchaseRoutes.get('/', validate(poList, 'query'), asyncHandler(async (req, res) => ok(res, await service.list(req.query))));
purchaseRoutes.post('/', validate(poCreate), asyncHandler(async (req, res) => ok(res, await service.create(req.body, req.user.id), 'Purchase order created', 201)));
purchaseRoutes.post('/draft-from-low-stock', asyncHandler(async (_req, res) => ok(res, await service.draftFromLowStock(), 'Checked low-stock items')));
purchaseRoutes.get('/:id', asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id))));
purchaseRoutes.patch('/:id', validate(poUpdate), asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body))));
purchaseRoutes.patch('/:id/approve', asyncHandler(async (req, res) => ok(res, await service.approve(req.params.id, req.user.id), 'Approved')));
purchaseRoutes.patch('/:id/receive', asyncHandler(async (req, res) => ok(res, await service.receive(req.params.id, req.user.id), 'Received into stock')));
purchaseRoutes.patch('/:id/cancel', asyncHandler(async (req, res) => ok(res, await service.cancel(req.params.id), 'Cancelled')));
