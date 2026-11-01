import { z } from 'zod';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';

export const isEnabled = () => Boolean(env.mlServiceUrl);

const factor = z.object({
  feature: z.string(), label: z.string(), value: z.number(), unit: z.string(), effect: z.number(), direction: z.enum(['raises', 'lowers']),
});
const predictionSchema = z.object({
  risk: z.enum(['Low', 'Medium', 'High']),
  probability: z.number().min(0).max(1),
  modelVersion: z.string().min(1),
  dataSource: z.string(),
  topFactors: z.array(factor).max(6),
  warnings: z.array(z.string()).max(10),
});

/**
 * Calls the Python service. Every failure becomes an ApiError with a safe message, so callers
 * can decide whether it matters: the risk model is an optional extra and must never take the API down.
 */
async function call(path, { method = 'GET', body } = {}) {
  if (!isEnabled()) throw new ApiError(503, 'The risk model service is not configured.');
  let res;
  try {
    res = await fetch(env.mlServiceUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(env.mlApiKey && { 'X-API-Key': env.mlApiKey }) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(env.mlTimeoutMs),
    });
  } catch (err) {
    logger.warn({ ml: { path, error: err?.name ?? 'error' } }, 'ML service unreachable');
    throw new ApiError(503, 'The risk model service is unavailable. Please try again shortly.');
  }

  if (res.status === 422) throw new ApiError(422, 'The risk model rejected these readings as invalid.');
  if (!res.ok) {
    logger.warn({ ml: { path, status: res.status } }, 'ML service error');
    throw new ApiError(503, 'The risk model service is unavailable. Please try again shortly.');
  }
  try {
    return await res.json();
  } catch {
    throw new ApiError(502, 'The risk model service returned an unreadable response.');
  }
}

export async function predict(features) {
  const parsed = predictionSchema.safeParse(await call('/predict', { method: 'POST', body: features }));
  if (!parsed.success) throw new ApiError(502, 'The risk model service returned an unexpected response.');
  return parsed.data;
}

export const modelInfo = () => call('/model');
export const post = (path, body) => call(path, { method: 'POST', body });
export const sensorModelInfo = () => call('/sensor-model');

export async function predictSensor(input) {
  const parsed = predictionSchema.safeParse(await call('/predict-sensor', { method: 'POST', body: input }));
  if (!parsed.success) throw new ApiError(502, 'The risk model service returned an unexpected response.');
  return parsed.data;
}

export async function health() {
  const h = await call('/health');
  return { reachable: true, modelLoaded: Boolean(h.modelLoaded), modelVersion: h.modelVersion ?? null };
}
