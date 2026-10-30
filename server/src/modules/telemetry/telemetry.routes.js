import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { ok } from '../../utils/respond.js';
import * as service from './telemetry.service.js';

const num = (min, max) => z.number().min(min).max(max).optional();
const readingSchema = z.object({
  machine: objectId,
  temperatureC: num(-50, 1500), vibrationMms: num(0, 200), rpm: num(0, 100_000), powerKw: num(0, 10_000),
}).refine((r) => ['temperatureC', 'vibrationMms', 'rpm', 'powerKw'].some((k) => r[k] !== undefined), 'Send at least one reading');
const historyQuery = z.object({ hours: z.coerce.number().int().min(1).max(168).default(2), limit: z.coerce.number().int().min(1).max(1000).default(300) });
const params = z.object({ machineId: objectId });

/** Mounted at /api/telemetry. */
export const telemetryRoutes = Router();
telemetryRoutes.use(authenticate);
telemetryRoutes.post('/', authorize('admin', 'manager'), validate(readingSchema), asyncHandler(async (req, res) => {
  const { machine, ...values } = req.body;
  const r = await service.ingest(machine, values);
  ok(res, { healthScore: r.healthScore, at: r.reading.at }, 'Reading recorded', 201);
}));

/** Mounted at /api/machines, before the generic machine routes. Any signed-in role can read. */
export const machineTelemetryRoutes = Router();
machineTelemetryRoutes.get('/:machineId/telemetry', authenticate, validate(params, 'params'), validate(historyQuery, 'query'),
  asyncHandler(async (req, res) => ok(res, await service.history(req.params.machineId, req.query))));
machineTelemetryRoutes.get('/:machineId/health-score', authenticate, validate(params, 'params'),
  asyncHandler(async (req, res) => ok(res, await service.health(req.params.machineId))));
