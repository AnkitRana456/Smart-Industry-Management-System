import cron from 'node-cron';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { isConfigured } from './gemini.client.js';
import { weeklySummary } from './weekly.service.js';
import { isEnabled as isMlEnabled } from '../ml/ml.client.js';
import { scoreAll } from '../ml/ml.service.js';
import { escalateStale } from '../alerts/alert.service.js';
import { generateDue } from '../maintenance/maintenance.service.js';

/** Regenerates the weekly summary so the first manager to open it on Monday sees a fresh one. */
export async function runWeeklyJob() {
  if (!isConfigured()) {
    logger.info('Weekly summary job skipped: AI is not configured');
    return { skipped: true };
  }
  try {
    const report = await weeklySummary({ refresh: true });
    logger.info({ verified: report.verified }, 'Weekly summary generated');
    return { skipped: false, verified: report.verified };
  } catch (err) {
    // A provider outage must never crash the API; the manager can still generate it on demand.
    logger.error({ status: err?.status, message: err?.message }, 'Weekly summary job failed');
    return { skipped: false, failed: true };
  }
}

/** Re-scores every machine with the trained model. A no-op unless ML_SERVICE_URL is set. */
export async function runMlJob() {
  if (!isMlEnabled()) return { skipped: true };
  try {
    const summary = await scoreAll('scheduled');
    logger.info({ ml: summary }, 'Hourly risk scoring finished');
    return { skipped: false, ...summary };
  } catch (err) {
    logger.error({ message: err?.message }, 'Hourly risk scoring failed');
    return { skipped: false, failed: true };
  }
}

export function startScheduler() {
  if (process.env.SCHEDULER_ENABLED === 'false') return [];
  const tasks = [
    cron.schedule('0 7 * * 1', runWeeklyJob, { timezone: env.timezone }),
    cron.schedule('5 * * * *', runMlJob, { timezone: env.timezone }),
    cron.schedule('*/10 * * * *', () => escalateStale().catch((err) => logger.error({ message: err?.message }, 'Alert escalation failed')), { timezone: env.timezone }),
    cron.schedule('10 6 * * *', () => generateDue().catch((err) => logger.error({ message: err?.message }, 'Recurring maintenance check failed')), { timezone: env.timezone }),
  ];
  logger.info(`Scheduler started: weekly summary Mondays 07:00, hourly risk scoring and the daily recurring-maintenance check, ${env.timezone}`);
  return tasks;
}
