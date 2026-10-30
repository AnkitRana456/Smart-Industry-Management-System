import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { pageQuery } from '../../utils/pagination.js';
import { ok } from '../../utils/respond.js';
import * as service from './maintenance.service.js';

const PRIORITY = z.enum(['low', 'medium', 'high', 'urgent']);
const STATUS = z.enum(['open', 'in_progress', 'done', 'cancelled']);
const TYPE = z.enum(['preventive', 'corrective', 'inspection']);

const createSchema = z.object({
  machine: objectId,
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1000).optional(),
  type: TYPE.default('corrective'),
  priority: PRIORITY.default('medium'),
  assignedTo: objectId.optional(),
  dueAt: z.coerce.date().optional(),
});
const updateSchema = createSchema.omit({ machine: true }).partial();
const listQuery = pageQuery.extend({
  status: STATUS.optional(), machine: objectId.optional(), type: TYPE.optional(), assignedTo: objectId.optional(),
  overdue: z.enum(['true', 'false']).optional(),
});
const statusSchema = z.object({ status: STATUS, resolution: z.string().trim().max(1000).optional() });
const noteSchema = z.object({ text: z.string().trim().min(1).max(500) });
const scheduleSchema = z.object({
  machine: objectId,
  title: z.string().trim().min(3).max(120),
  everyDays: z.coerce.number().int().min(1).max(730),
  nextDueAt: z.coerce.date(),
  priority: PRIORITY.default('medium'),
  active: z.boolean().default(true),
});

const staff = authorize('admin', 'manager');
const router = Router();
router.use(authenticate);

router.get('/summary', staff, asyncHandler(async (_req, res) => ok(res, await service.summary())));

router.get('/work-orders', validate(listQuery, 'query'), asyncHandler(async (req, res) => ok(res, await service.list(req.query, req.user))));
router.post('/work-orders', staff, validate(createSchema), asyncHandler(async (req, res) => ok(res, await service.create(req.body), 'Work order created', 201)));
router.get('/work-orders/:id', asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id))));
router.patch('/work-orders/:id', staff, validate(updateSchema), asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body))));
router.patch('/work-orders/:id/status', validate(statusSchema),
  asyncHandler(async (req, res) => ok(res, await service.setStatus(req.params.id, req.body.status, req.user, req.body.resolution))));
router.post('/work-orders/:id/notes', validate(noteSchema), asyncHandler(async (req, res) => ok(res, await service.addNote(req.params.id, req.body.text, req.user), 'Note added', 201)));
router.delete('/work-orders/:id', staff, asyncHandler(async (req, res) => {
  await service.remove(req.params.id);
  ok(res, null, 'Work order deleted');
}));

router.get('/schedules', staff, asyncHandler(async (_req, res) => ok(res, await service.listSchedules())));
router.post('/schedules', staff, validate(scheduleSchema), asyncHandler(async (req, res) => ok(res, await service.createSchedule(req.body), 'Schedule created', 201)));
router.patch('/schedules/:id', staff, validate(scheduleSchema.omit({ machine: true }).partial()), asyncHandler(async (req, res) => ok(res, await service.updateSchedule(req.params.id, req.body))));
router.delete('/schedules/:id', staff, asyncHandler(async (req, res) => {
  await service.removeSchedule(req.params.id);
  ok(res, null, 'Schedule deleted');
}));
router.post('/schedules/run-due', staff, asyncHandler(async (_req, res) => ok(res, await service.generateDue(), 'Checked schedules')));

export default router;
