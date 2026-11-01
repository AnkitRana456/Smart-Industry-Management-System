import { z } from 'zod';
import { AiReport } from '../../models/index.js';
import { generateJson, InvalidOutputError } from './gemini.client.js';
import { buildWeeklyPrompt, WEEKLY_SCHEMA, WEEKLY_SYSTEM } from './prompts/analyst.v1.js';
import { ungroundedNumbers } from './analyst.service.js';
import { resolveRange, toAnalyticsRange } from './timeRange.js';
import { runTool, TOOL_NAMES, TOOLS } from './tools.js';

const CACHE_MS = 6 * 3_600_000;
const schema = z.object({ summary: z.string().min(1).max(1500), highlights: z.array(z.string().max(250)).max(5).default([]) });

/** Weekly summary from precomputed figures only, cached in AiReport so refreshes do not re-bill the model. */
export async function weeklySummary({ refresh = false } = {}, now = new Date()) {
  const range = resolveRange({ preset: 'LAST_7_DAYS' }, now);
  const cached = await AiReport.findOne({ type: 'weekly', 'period.start': range.start }).sort({ generatedAt: -1 }).lean();
  if (cached && !refresh && now - cached.generatedAt < CACHE_MS) return { ...JSON.parse(cached.content), cached: true };

  const analyticsRange = toAnalyticsRange(range);
  const results = await Promise.all(TOOL_NAMES.filter((name) => !TOOLS[name].needsMl).map((name) => runTool({ name, args: {} }, analyticsRange, now)));
  const keyFigures = results.flatMap((r) => r.keyFigures);
  const pkg = {
    reportingPeriod: { label: range.label, start: range.start.toISOString().slice(0, 10), end: range.end.toISOString().slice(0, 10), timezone: range.timezone },
    results: results.map(({ tool, recordCount, data, keyFigures: kf }) => ({ tool, recordCount, data, keyFigures: kf })),
  };
  const evidenceJson = JSON.stringify(pkg);

  let narrative;
  let verified = true;
  try {
    narrative = (await generateJson({
      purpose: 'weekly', system: WEEKLY_SYSTEM, prompt: buildWeeklyPrompt(pkg), jsonSchema: WEEKLY_SCHEMA, maxOutputTokens: 1100,
      validate: (raw) => {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) throw new InvalidOutputError('it did not match the schema');
        const bad = ungroundedNumbers([parsed.data.summary, ...parsed.data.highlights].join(' '), evidenceJson);
        if (bad.length) throw new InvalidOutputError(`it used numbers that are not in the evidence (${bad.slice(0, 3).join(', ')})`);
        return parsed.data;
      },
    })).data;
  } catch (err) {
    if (err?.status !== 502) throw err;
    verified = false;
    narrative = { summary: `Figures for ${range.label} are listed below. A written summary could not be verified against the data.`, highlights: [] };
  }

  const report = {
    reportingPeriod: { start: range.start.toISOString(), end: range.end.toISOString(), timezone: range.timezone },
    summary: narrative.summary, highlights: narrative.highlights, keyFigures, verified,
    generatedAt: now.toISOString(),
  };
  if (verified) await AiReport.create({ type: 'weekly', content: JSON.stringify(report), period: { start: range.start, end: range.end }, generatedAt: now });
  return { ...report, cached: false };
}
