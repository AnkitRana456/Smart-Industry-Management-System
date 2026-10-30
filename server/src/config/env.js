import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Load server/.env by path, so the API behaves the same wherever it is started from.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH ?? fileURLToPath(new URL('../../.env', import.meta.url)) });

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/sims',
  jwtSecret: process.env.JWT_SECRET || 'dev-access-secret',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  // CLIENT_URL may list several origins separated by commas (e.g. production and a preview URL).
  clientOrigins: (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  timezone: process.env.FACTORY_TIMEZONE || 'Asia/Kolkata',
  // Empty means the trained-model feature is off. Nothing else in the app depends on it.
  mlServiceUrl: (process.env.ML_SERVICE_URL || '').replace(/\/$/, ''),
  mlApiKey: process.env.ML_API_KEY || '',
  mlTimeoutMs: Number(process.env.ML_TIMEOUT_MS) || 5_000,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || '',
  allowSimulator: process.env.ALLOW_SIMULATOR === 'true',
  // Thinking tokens count against the output limit and add latency. Grounded explanations and extraction do not
  // need them, so they are off (0) unless GEMINI_THINKING_BUDGET says otherwise. Use "default" to let the model decide.
  geminiThinkingBudget: (() => {
    const raw = process.env.GEMINI_THINKING_BUDGET;
    if (raw === 'default') return null;
    return raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : 0;
  })(),
  // Requests per minute the AI provider allows (free tier: 5). 0 = no client-side limit. Calls queue up to the wait below.
  geminiMaxRpm: Number(process.env.GEMINI_MAX_RPM) || 0,
  geminiQueueWaitMs: Number(process.env.GEMINI_QUEUE_WAIT_MS) || 20_000,
  geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 25_000,
};

export const ROLES = ['admin', 'manager', 'worker'];

/** Refuses to start in production with development defaults, so a deploy cannot ship guessable secrets. */
export function assertProductionConfig() {
  if (env.nodeEnv !== 'production') return;
  const problems = [];
  const weak = (v, dev) => !v || v === dev || v.startsWith('change-me') || v.length < 32;
  if (weak(process.env.JWT_SECRET, 'dev-access-secret')) problems.push('JWT_SECRET must be set to a random value of at least 32 characters');
  if (weak(process.env.JWT_REFRESH_SECRET, 'dev-refresh-secret')) problems.push('JWT_REFRESH_SECRET must be set to a random value of at least 32 characters');
  if (process.env.JWT_SECRET && process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) problems.push('JWT_SECRET and JWT_REFRESH_SECRET must differ');
  if (!process.env.MONGO_URI) problems.push('MONGO_URI must be set');
  if (!process.env.CLIENT_URL) problems.push('CLIENT_URL must be set to the deployed frontend origin');
  if (problems.length) throw new Error(`Unsafe production configuration:\n- ${problems.join('\n- ')}`);
}
