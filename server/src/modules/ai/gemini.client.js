import { ApiError as GenAiApiError, GoogleGenAI } from '@google/genai';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';
import { createGate } from './rateGate.js';

/** Raised when the model answers, but not in the shape or with the content we allow. */
export class InvalidOutputError extends Error {}

const gate = createGate({ perMinute: env.geminiMaxRpm, maxWaitMs: env.geminiQueueWaitMs });
let override = null;
let sdk = null;

/** Tests inject a fake provider with the same `generate` signature. Pass null to restore the real one. */
export function setProvider(provider) {
  override = provider;
}

export const isConfigured = () => Boolean(override || (env.geminiApiKey && env.geminiModel));

function realProvider() {
  sdk ??= new GoogleGenAI({ apiKey: env.geminiApiKey });
  return {
    modelId: env.geminiModel,
    async generate({ system, prompt, jsonSchema, maxOutputTokens = 1024 }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.geminiTimeoutMs);
      try {
        const res = await sdk.models.generateContent({
          model: env.geminiModel,
          contents: prompt,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            responseJsonSchema: jsonSchema,
            temperature: 0,
            maxOutputTokens,
            ...(env.geminiThinkingBudget != null && { thinkingConfig: { thinkingBudget: env.geminiThinkingBudget } }),
            abortSignal: controller.signal,
          },
        });
        return {
          text: res.text ?? '',
          finishReason: res.candidates?.[0]?.finishReason,
          usage: { promptTokens: res.usageMetadata?.promptTokenCount, outputTokens: res.usageMetadata?.candidatesTokenCount },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Google writes delays like "retry in 30.6s" or "retry in 20h56m41.4s" (a daily quota). Falls back to a minute. */
export function retrySeconds(message) {
  const m = /retry in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/i.exec(message ?? '');
  return m ? Math.ceil(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3])) : 60;
}

const humanize = (secs) => (secs >= 5400 ? `${Math.round(secs / 3600)} hours` : secs >= 90 ? `${Math.round(secs / 60)} minutes` : `${secs} seconds`);

/** Maps provider failures to our error contract without leaking provider details or secrets. */
export function normalizeProviderError(err) {
  if (err instanceof ApiError) return err;
  if (err?.name === 'AbortError' || /abort|timed? ?out/i.test(err?.message ?? '')) {
    return new ApiError(503, 'The AI service took too long to respond. Please try again.');
  }
  const status = err instanceof GenAiApiError || typeof err?.status === 'number' ? err.status : null;
  if (status === 429) {
    const secs = retrySeconds(err?.message);
    return new ApiError(429, `The AI service is rate limited right now. Please try again in about ${humanize(secs)}.`, null, secs);
  }
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return new ApiError(503, 'The AI service rejected this server\'s configuration. Check the API key and model name.');
  }
  return new ApiError(503, 'The AI service is unavailable. Please try again shortly.');
}

function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new InvalidOutputError('the reply was not valid JSON');
  }
}

/**
 * One structured call. `validate(parsed)` must return the cleaned value or throw
 * InvalidOutputError. An invalid reply is retried once with a generic correction;
 * after that the call fails and nothing downstream is persisted.
 */
export async function generateJson({ purpose, system, prompt, jsonSchema, validate, maxOutputTokens, attempts = 2 }) {
  if (!isConfigured()) throw new ApiError(503, 'AI features are not configured on this server.');
  const provider = override ?? realProvider();

  let correction = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // The quota belongs to the real API; an injected (test) provider is not subject to it.
    if (!override) await gate.acquire();
    const started = Date.now();
    let reply;
    try {
      // A reply cut off by the token limit is retried with twice the room.
      reply = await provider.generate({ purpose, system, prompt: prompt + correction, jsonSchema, maxOutputTokens: maxOutputTokens ? maxOutputTokens * 2 ** (attempt - 1) : undefined, attempt });
    } catch (err) {
      logger.warn({ ai: { purpose, attempt, latencyMs: Date.now() - started, error: err?.status ?? err?.name ?? 'error' } }, 'Gemini call failed');
      throw normalizeProviderError(err);
    }
    logger.info({ ai: { purpose, attempt, model: provider.modelId ?? env.geminiModel, latencyMs: Date.now() - started, finishReason: reply.finishReason, ...reply.usage } }, 'Gemini call');

    try {
      if (reply.finishReason === 'MAX_TOKENS') throw new InvalidOutputError('it was cut off before it finished, so keep every text item shorter');
      return { data: validate(parseJson(reply.text)), modelId: provider.modelId ?? env.geminiModel };
    } catch (err) {
      if (!(err instanceof InvalidOutputError)) throw err;
      logger.warn({ ai: { purpose, attempt, invalid: err.message } }, 'Gemini output rejected');
      correction = `\n\nYour previous reply was rejected because ${err.message}. Reply again with only JSON that follows the schema and the rules.`;
    }
  }
  throw new ApiError(502, 'The AI service returned an unusable response. Please try again.');
}
