import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { ok } from '../../utils/respond.js';
import * as service from './ml.service.js';

const staff = [authenticate, authorize('admin', 'manager')];
const params = z.object({ machineId: objectId });

/** Mounted at /api/machines: guards are per route so workers can still read machines. */
export const machineMlRoutes = Router();
machineMlRoutes.post('/:machineId/ml-predict', ...staff, validate(params, 'params'),
  asyncHandler(async (req, res) => ok(res, await service.score(req.params.machineId, { userId: req.user.id }), 'Scored', 201)));
machineMlRoutes.post('/:machineId/sensor-risk', ...staff, validate(params, 'params'),
  asyncHandler(async (req, res) => ok(res, await service.scoreSensor(req.params.machineId))));
machineMlRoutes.get('/:machineId/ml-predictions', ...staff, validate(params, 'params'),
  asyncHandler(async (req, res) => ok(res, await service.history(req.params.machineId, { limit: 10 }))));

/** Mounted at /api/ml. */
export const mlRoutes = Router();
mlRoutes.use(...staff);
mlRoutes.get('/status', asyncHandler(async (_req, res) => ok(res, await service.status())));
mlRoutes.post('/rescore', asyncHandler(async (_req, res) => ok(res, await service.scoreAll('manual'), 'Re-scored')));
