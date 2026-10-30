import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ok } from '../../utils/respond.js';
import * as service from './worker.service.js';
import {
  createWorkerSchema, listWorkerQuery, shiftSchema, updateShiftSchema, updateWorkerSchema,
} from './worker.validation.js';

const staff = authorize('admin', 'manager');

export const workerRouter = Router();
workerRouter.use(authenticate);
workerRouter.get('/me', asyncHandler(async (req, res) => ok(res, await service.forUser(req.user.id))));
workerRouter.get('/', staff, validate(listWorkerQuery, 'query'), asyncHandler(async (req, res) => ok(res, await service.list(req.query))));
workerRouter.post('/', staff, validate(createWorkerSchema),
  asyncHandler(async (req, res) => ok(res, await service.create(req.body), 'Worker created', 201)));
workerRouter.get('/:id', staff, asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id))));
workerRouter.patch('/:id', staff, validate(updateWorkerSchema),
  asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body))));
workerRouter.delete('/:id', staff, asyncHandler(async (req, res) => ok(res, await service.deactivate(req.params.id), 'Worker deactivated')));

export const shiftRouter = Router();
shiftRouter.use(authenticate);
shiftRouter.get('/', asyncHandler(async (_req, res) => ok(res, await service.listShifts())));
shiftRouter.post('/', staff, validate(shiftSchema), asyncHandler(async (req, res) => ok(res, await service.createShift(req.body), 'Shift created', 201)));
shiftRouter.patch('/:id', staff, validate(updateShiftSchema), asyncHandler(async (req, res) => ok(res, await service.updateShift(req.params.id, req.body))));
shiftRouter.delete('/:id', staff, asyncHandler(async (req, res) => {
  await service.removeShift(req.params.id);
  ok(res, null, 'Shift deleted');
}));
