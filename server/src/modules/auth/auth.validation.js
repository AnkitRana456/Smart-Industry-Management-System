import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.enum(['admin', 'manager', 'worker']).default('worker'),
});

export const forgotSchema = z.object({ email: z.string().email() });
export const resetSchema = z.object({ token: z.string().length(64).regex(/^[a-f\d]+$/), password: z.string().min(8).max(128) });

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
