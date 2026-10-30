import { z } from 'zod';
import { objectId } from '../../utils/objectId.js';
import { pageQuery } from '../../utils/pagination.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const createWorkerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  employeeId: z.string().min(2).max(20),
  department: z.string().max(60).optional(),
  skills: z.array(z.string().max(40)).max(20).default([]),
  shift: objectId.optional(),
});

export const updateWorkerSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  department: z.string().max(60).optional(),
  skills: z.array(z.string().max(40)).max(20).optional(),
  shift: objectId.nullable().optional(),
  status: z.enum(['active', 'on_leave', 'terminated']).optional(),
});

export const listWorkerQuery = pageQuery.extend({
  search: z.string().max(60).optional(),
  status: z.enum(['active', 'on_leave', 'terminated']).optional(),
  department: z.string().max(60).optional(),
});

export const shiftSchema = z.object({
  name: z.string().min(2).max(40),
  startTime: hhmm,
  endTime: hhmm,
});
export const updateShiftSchema = shiftSchema.partial();
