import { z } from 'zod';
import { generateJson, InvalidOutputError } from './gemini.client.js';
import {
  ANSWER_SCHEMA, ANSWER_SYSTEM, buildAnswerPrompt, buildRouterPrompt, ROUTER_SCHEMA, ROUTER_SYSTEM,
} from './prompts/analyst.v1.js';
import { resolveRange, toAnalyticsRange } from './timeRange.js';
import { parseCall, runTool, TOOL_NAMES } from './tools.js';

const routerSchema = z.object({
  intent: z.enum(['answer', 'clarify', 'unsupported']),
  clarification: z.string().max(400).optional(),
  tools: z.array(z.object({ name: z.enum(TOOL_NAMES) }).passthrough()).max(3),
});

const answerSchema = z.object({ answer: z.string().min(1).max(1200), limitations: z.array(z.string().max(300)).max(4).default([]) });

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const numbersIn = (s) => (s.match(NUMBER) ?? []).map((n) => n.replace(/,/g, ''));

/** Numbers in the prose that appear nowhere in the evidence the model was given. */
export function ungroundedNumbers(answer, evidenceJson) {
  const allowed = new Set(numbersIn(evidenceJson));
  return [...new Set(numbersIn(answer).filter((n) => !allowed.has(n)))];
}

function validateRouter(raw) {
  const parsed = routerSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidOutputError('it did not match the schema or named a tool that does not exist');
  if (parsed.data.intent === 'answer' && parsed.data.tools.length === 0) throw new InvalidOutputError('it chose to answer without selecting any tool');
  if (parsed.data.intent === 'clarify' && !parsed.data.clarification) throw new InvalidOutputError('it asked for clarification without saying what to clarify');
  let calls;
  try {
    calls = parsed.data.tools.map(parseCall);
  } catch {
    throw new InvalidOutputError('a tool call used arguments that tool does not accept');
  }
  const seen = new Set();
  calls = calls.filter((c) => { const k = JSON.stringify(c); return seen.has(k) ? false : seen.add(k); });
  return { intent: parsed.data.intent, clarification: parsed.data.clarification, calls };
}

const fmtFigure = (f) => `${f.label}: ${f.value.toLocaleString('en-US')} ${f.unit}`;

function baseResponse(range, extra) {
  return {
    answer: '',
    reportingPeriod: { start: range.start.toISOString(), end: range.end.toISOString(), timezone: range.timezone },
    keyFigures: [], evidence: [], limitations: [], needsClarification: false,
    ...extra,
  };
}

export async function ask({ question, timeRange }, now = new Date()) {
  const range = resolveRange(timeRange, now);
  const periodNote = range.usedDefault ? ['No time range was given, so the last 7 days were used.'] : [];

  const route = await generateJson({
    purpose: 'router', system: ROUTER_SYSTEM, prompt: buildRouterPrompt(question), jsonSchema: ROUTER_SCHEMA, validate: validateRouter, maxOutputTokens: 600,
  });

  if (route.data.intent === 'clarify') {
    return baseResponse(range, { answer: route.data.clarification, needsClarification: true, limitations: periodNote });
  }
  if (route.data.intent === 'unsupported') {
    return baseResponse(range, {
      answer: 'I can only answer questions about machines, downtime, production, inventory, maintenance assessments and attendance.',
      limitations: periodNote,
    });
  }

  const analyticsRange = toAnalyticsRange(range);
  const results = await Promise.all(route.data.calls.map((c) => runTool(c, analyticsRange, now)));
  const evidence = results.map((r) => ({ source: r.tool, recordCount: r.recordCount, asOf: r.asOf }));
  const toolNotes = results.flatMap((r) => (r.note ? [r.note] : []));
  const keyFigures = results.flatMap((r) => r.keyFigures).slice(0, 8);
  const snapshotNote = results.some((r) => r.tool === 'getInventoryStatus' || r.tool === 'getMachineStatus')
    ? ['Machine status and stock levels are current values, not figures for the selected period.'] : [];

  if (results.every((r) => r.recordCount === 0)) {
    return baseResponse(range, {
      answer: `There are no matching records for ${range.label}, so I can't answer this from the data.`,
      evidence, limitations: [...toolNotes, ...periodNote, 'No records matched the question for this period.'],
    });
  }

  const pkg = {
    reportingPeriod: { label: range.label, start: range.start.toISOString().slice(0, 10), end: range.end.toISOString().slice(0, 10), timezone: range.timezone },
    results: results.map(({ tool, recordCount, asOf, data, keyFigures: kf }) => ({ tool, recordCount, asOf, data, keyFigures: kf })),
  };
  const evidenceJson = JSON.stringify(pkg);

  let narrative;
  try {
    narrative = (await generateJson({
      purpose: 'answer', system: ANSWER_SYSTEM, prompt: buildAnswerPrompt(question, pkg), jsonSchema: ANSWER_SCHEMA, maxOutputTokens: 900,
      validate: (raw) => {
        const parsed = answerSchema.safeParse(raw);
        if (!parsed.success) throw new InvalidOutputError('it did not match the schema');
        const bad = ungroundedNumbers(parsed.data.answer, evidenceJson);
        if (bad.length) throw new InvalidOutputError(`it used numbers that are not in the evidence (${bad.slice(0, 3).join(', ')}); use only the numbers provided`);
        return parsed.data;
      },
    })).data;
  } catch (err) {
    if (err?.status !== 502) throw err;
    // The model could not produce a verifiable explanation: show the calculated figures instead.
    narrative = {
      answer: `For ${range.label}: ${keyFigures.slice(0, 6).map(fmtFigure).join('; ')}.`,
      limitations: ['The written explanation could not be verified against the data, so only the calculated figures are shown.'],
    };
  }

  return baseResponse(range, {
    answer: narrative.answer, keyFigures, evidence, limitations: [...narrative.limitations, ...toolNotes, ...snapshotNote, ...periodNote],
  });
}
