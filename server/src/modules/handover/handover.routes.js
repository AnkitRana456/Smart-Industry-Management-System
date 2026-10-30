import { Router } from 'express';
import { z } from 'zod';
import { HandoverNote, Machine, User } from '../../models/index.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { emit } from '../../sockets/index.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { objectId } from '../../utils/objectId.js';
import { pageQuery, paginate } from '../../utils/pagination.js';
import { ok } from '../../utils/respond.js';

const createSchema = z.object({
  text: z.string().trim().min(2).max(500),
  priority: z.enum(['info', 'important']).default('info'),
  machine: objectId.optional(),
});
const listQuery = pageQuery.extend({ resolved: z.enum(['true', 'false']).default('false') });

const router = Router();
router.use(authenticate);

router.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const { page, limit, resolved } = req.query;
  ok(res, await paginate(HandoverNote, { resolved: resolved === 'true' }, {
    page, limit, sort: { priority: 1, createdAt: -1 } /* 'important' sorts before 'info' */, populate: { path: 'machine', select: 'code name' },
  }));
}));

router.post('/', validate(createSchema), asyncHandler(async (req, res) => {
  if (req.body.machine && !(await Machine.exists({ _id: req.body.machine }))) throw ApiError.badRequest('Machine does not exist');
  const author = await User.findById(req.user.id).select('name').lean();
  const note = await HandoverNote.create({ ...req.body, author: req.user.id, authorName: author?.name });
  emit('handover:updated', { _id: String(note._id) });
  ok(res, note, 'Note added', 201);
}));

// Anyone can close their own note; managers can close any.
router.patch('/:id/resolve', asyncHandler(async (req, res) => {
  const note = await HandoverNote.findById(req.params.id);
  if (!note) throw ApiError.notFound('Note not found');
  if (req.user.role === 'worker' && String(note.author) !== req.user.id) throw ApiError.forbidden('You can only close your own notes');
  note.resolved = true;
  note.resolvedAt = new Date();
  await note.save();
  emit('handover:updated', { _id: req.params.id });
  ok(res, note, 'Note closed');
}));

router.delete('/:id', authorize('admin', 'manager'), asyncHandler(async (req, res) => {
  const note = await HandoverNote.findByIdAndDelete(req.params.id);
  if (!note) throw ApiError.notFound('Note not found');
  emit('handover:updated', { _id: req.params.id });
  ok(res, null, 'Note deleted');
}));

export default router;
