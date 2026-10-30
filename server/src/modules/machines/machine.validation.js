import { z } from 'zod';
import { pageQuery } from '../../utils/pagination.js';

export const STATUSES = ['running', 'idle', 'maintenance', 'offline'];

export const createSchema = z.object({
  name: z.string().min(2).max(80),
  code: z.string().min(2).max(20),
  type: z.string().max(60).optional(),
  status: z.enum(STATUSES).default('idle'),
  runHours: z.number().min(0).default(0),
  toolWearMin: z.number().min(0).optional(),
  temperatureC: z.number().min(-50).max(1500).optional(),
  vibrationMms: z.number().min(0).max(200).optional(),
  lastServiceAt: z.coerce.date().optional(),
  nextServiceDue: z.coerce.date().optional(),
});

export const updateSchema = createSchema.omit({ status: true }).partial();

export const statusSchema = z.object({
  status: z.enum(STATUSES),
  reason: z.string().max(200).optional(),
});

export const listQuery = pageQuery.extend({
  status: z.enum(STATUSES).optional(),
  search: z.string().max(60).optional(),
});

export const rangeQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});
