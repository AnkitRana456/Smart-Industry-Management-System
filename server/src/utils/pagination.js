import { z } from 'zod';

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function paginate(model, filter, { page, limit, sort = { createdAt: -1 }, populate } = {}) {
  let q = model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit);
  if (populate) q = q.populate(populate);
  const [items, total] = await Promise.all([q.lean(), model.countDocuments(filter)]);
  return { items, page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}
