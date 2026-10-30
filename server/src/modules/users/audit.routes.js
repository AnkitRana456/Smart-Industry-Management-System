import { Router } from 'express';
import { z } from 'zod';
import { AuditLog } from '../../models/index.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { paginate, pageQuery } from '../../utils/pagination.js';
import { ok } from '../../utils/respond.js';

const query = pageQuery.extend({ resource: z.string().max(30).optional() });

const router = Router();
router.get('/', authenticate, authorize('admin'), validate(query, 'query'), asyncHandler(async (req, res) => {
  const { resource, page, limit } = req.query;
  ok(res, await paginate(AuditLog, resource ? { resource } : {}, { page, limit, populate: { path: 'user', select: 'name role' } }));
}));

export default router;
