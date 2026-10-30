import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { ok } from '../../utils/respond.js';
import * as service from './analytics.service.js';

const rangeQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });
const downtimeQuery = rangeQuery.extend({ machine: objectId.optional() });
const stockQuery = rangeQuery.extend({ item: objectId.optional() });

const router = Router();
router.use(authenticate, authorize('admin', 'manager'));

router.get('/overview', asyncHandler(async (_req, res) => ok(res, await service.overview())));
router.get('/downtime', validate(downtimeQuery, 'query'),
  asyncHandler(async (req, res) => ok(res, await service.downtime(service.rangeFromDays(req.query.days), req.query.machine))));
router.get('/downtime-pareto', validate(rangeQuery, 'query'),
  asyncHandler(async (req, res) => ok(res, await service.downtimePareto(service.rangeFromDays(req.query.days)))));
router.get('/oee', validate(rangeQuery, 'query'),
  asyncHandler(async (req, res) => ok(res, await service.oee(service.rangeFromDays(req.query.days)))));
router.get('/reliability', validate(rangeQuery, 'query'),
  asyncHandler(async (req, res) => ok(res, await service.reliability(service.rangeFromDays(req.query.days)))));
router.get('/worker-attendance', validate(rangeQuery, 'query'),
  asyncHandler(async (req, res) => ok(res, await service.attendanceReport(service.rangeFromDays(req.query.days)))));
router.get('/production-output', validate(rangeQuery, 'query'),
  asyncHandler(async (req, res) => ok(res, await service.productionOutput(service.rangeFromDays(req.query.days)))));
router.get('/stock-trends', validate(stockQuery, 'query'),
  asyncHandler(async (req, res) => ok(res, await service.stockTrends(service.rangeFromDays(req.query.days), req.query.item))));

export default router;
