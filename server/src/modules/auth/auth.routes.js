import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as c from './auth.controller.js';
import { forgotSchema, loginSchema, registerSchema, resetSchema } from './auth.validation.js';

const router = Router();

router.post('/register', authenticate, authorize('admin'), validate(registerSchema), c.register);
router.post('/login', authLimiter, validate(loginSchema), c.login);
router.post('/forgot-password', authLimiter, validate(forgotSchema), c.forgotPassword);
router.post('/reset-password', authLimiter, validate(resetSchema), c.resetPassword);
router.post('/refresh', authLimiter, c.refresh);
router.post('/logout', authenticate, c.logout);
router.get('/me', authenticate, c.me);

export default router;
