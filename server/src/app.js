import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import mongoSanitize from 'express-mongo-sanitize';
import helmet from 'helmet';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import { buildSpec } from './docs/openapi.js';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import aiRoutes from './modules/ai/ai.routes.js';
import assessmentRoutes from './modules/ai/assessment.routes.js';
import alertRoutes from './modules/alerts/alert.routes.js';
import analyticsRoutes from './modules/analytics/analytics.routes.js';
import attendanceRoutes from './modules/attendance/attendance.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import { audit } from './middleware/audit.js';
import auditRoutes from './modules/users/audit.routes.js';
import userRoutes from './modules/users/user.routes.js';
import simulatorRoutes from './modules/simulator/simulator.routes.js';
import { machineMlRoutes, mlRoutes } from './modules/ml/ml.routes.js';
import orderRoutes from './modules/production/order.routes.js';
import handoverRoutes from './modules/handover/handover.routes.js';
import maintenanceRoutes from './modules/maintenance/maintenance.routes.js';
import { machineTelemetryRoutes, telemetryRoutes } from './modules/telemetry/telemetry.routes.js';
import { purchaseRoutes, supplierRoutes } from './modules/purchasing/purchasing.routes.js';
import leaveRoutes from './modules/leave/leave.routes.js';
import notificationRoutes from './modules/notifications/notification.routes.js';
import { bomRoutes, productionPlanRoutes, qualityRoutes } from './modules/planning/planning.routes.js';
import taskRoutes from './modules/tasks/task.routes.js';
import { shiftRouter, workerRouter } from './modules/workers/worker.routes.js';
import inventoryRoutes from './modules/inventory/inventory.routes.js';
import machineRoutes from './modules/machines/machine.routes.js';

export function createApp() {
  const app = express();

  // Behind Render's proxy, rate limits must key on the real client address, not the proxy's.
  if (env.nodeEnv === 'production') app.set('trust proxy', 1);

  // Swagger UI needs inline scripts, so it is mounted before the strict global helmet policy.
  app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(buildSpec(), { customSiteTitle: 'SIMS API' }));
  app.get('/api/openapi.json', (_req, res) => res.json(buildSpec()));

  app.use(helmet());
  app.use(cors({ origin: env.clientOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(mongoSanitize());
  if (env.nodeEnv === 'development') app.use(morgan('dev'));

  app.get('/health', (_req, res) => {
    const db = mongoose.connection.readyState === 1;
    res.status(db ? 200 : 503).json({
      success: db, data: { status: db ? 'ok' : 'degraded', database: db ? 'connected' : 'disconnected', uptimeSec: Math.round(process.uptime()) },
      message: db ? 'OK' : 'Database unavailable', errors: null,
    });
  });

  app.use('/api', apiLimiter, audit);
  app.use('/api/auth', authRoutes);
  app.use('/api/machines', assessmentRoutes);
  app.use('/api/machines', machineMlRoutes);
  app.use('/api/machines', machineTelemetryRoutes);
  app.use('/api/telemetry', telemetryRoutes);
  app.use('/api/ml', mlRoutes);
  app.use('/api/machines', machineRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/suppliers', supplierRoutes);
  app.use('/api/purchase-orders', purchaseRoutes);
  app.use('/api/alerts', alertRoutes);
  app.use('/api/workers', workerRouter);
  app.use('/api/shifts', shiftRouter);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/leave', leaveRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/maintenance', maintenanceRoutes);
  app.use('/api/handover', handoverRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/bom', bomRoutes);
  app.use('/api/quality-checks', qualityRoutes);
  app.use('/api/production', productionPlanRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/simulate', simulatorRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/audit-logs', auditRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
