import { z } from 'zod';
import { objectId } from '../../utils/objectId.js';
import { pageQuery } from '../../utils/pagination.js';

export const createSchema = z.object({
  sku: z.string().min(2).max(30),
  name: z.string().min(2).max(80),
  quantity: z.number().min(0).default(0),
  unit: z.string().max(10).default('pcs'),
  reorderThreshold: z.number().min(0).default(0),
  supplier: z.string().max(80).optional(),
  unitCost: z.number().min(0).max(10_000_000).optional(),
  supplierRef: objectId.optional(),
});

export const importSchema = z.object({
  rows: z.array(createSchema.extend({ quantity: z.number().min(0) })).min(1).max(500),
});

export const updateSchema = createSchema.omit({ quantity: true }).partial();

export const transactionSchema = z.object({
  type: z.enum(['in', 'out', 'adjust']),
  qty: z.number().refine((n) => n !== 0, 'Quantity cannot be zero'),
}).superRefine((v, ctx) => {
  if (v.type !== 'adjust' && v.qty < 0) {
    ctx.addIssue({ code: 'custom', path: ['qty'], message: 'Quantity must be positive for in/out' });
  }
});

export const listQuery = pageQuery.extend({
  search: z.string().max(60).optional(),
  lowStock: z.enum(['true', 'false']).optional(),
});
