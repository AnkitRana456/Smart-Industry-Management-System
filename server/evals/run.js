/**
 * Evaluation runner.
 *   node evals/run.js --mode mock                    harness check with a rule-based stand-in (no key needed)
 *   node evals/run.js --mode live [--only analyst]   real Gemini; needs GEMINI_API_KEY and GEMINI_MODEL
 *
 * It works on its own database (sims_eval) and never touches your development data.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const mode = arg('mode', 'mock');
const only = arg('only', 'all');
const pause = Number(arg('pause-ms', 0));

// Live runs queue behind the provider quota (GEMINI_MAX_RPM, from .env or --rpm) instead of failing on 429s,
// so a slow run measures the model, not the quota. Set before the app loads its config.
if (mode === 'live') {
  process.env.GEMINI_QUEUE_WAIT_MS ??= '1800000';
  if (arg('rpm')) process.env.GEMINI_MAX_RPM = arg('rpm');
}
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.EVAL_MONGO_URI ?? 'mongodb://127.0.0.1:27017/sims_eval';
process.env.FACTORY_TIMEZONE ??= 'Asia/Kolkata';

const { seedRefusal } = await import('../src/utils/seedGuard.js');
{
  // The runner empties its database before and after every run, so it must never point at real data.
  const refusal = seedRefusal({ uri: process.env.MONGO_URI, nodeEnv: 'test', confirm: process.env.EVAL_CONFIRM });
  if (refusal) {
    console.error(`Refusing to run: ${refusal} The evaluation empties its database. Use a local throwaway one, or set EVAL_CONFIRM=yes.`);
    process.exit(2);
  }
}
const { default: mongoose } = await import('mongoose');
const { env } = await import('../src/config/env.js');
const models = await import('../src/models/index.js');
const { setProvider } = await import('../src/modules/ai/gemini.client.js');
const { ask } = await import('../src/modules/ai/analyst.service.js');
const { assess } = await import('../src/modules/ai/assessment.service.js');
const { resolveRange, toAnalyticsRange } = await import('../src/modules/ai/timeRange.js');
const { FORBIDDEN_STRINGS, loadFixture, oracle } = await import('./fixture.js');

if (mode === 'live') {
  if (!env.geminiApiKey || !env.geminiModel) {
    console.error('Live mode needs GEMINI_API_KEY and GEMINI_MODEL in server/.env. Run `npm run ai:models` to see valid model IDs.');
    process.exit(2);
  }
} else {
  const { makeMockProvider } = await import('./mockProvider.js');
  setProvider(makeMockProvider());
}

const read = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a');
const percentile = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : 0);

await mongoose.connect(process.env.MONGO_URI);
await loadFixture(models);

const lines = [];
const out = (s = '') => { lines.push(s); console.log(s); };
let failedChecks = 0;

function behaviorOf(r) {
  if (r.needsClarification) return 'clarify';
  if (/^I can only answer questions about/.test(r.answer)) return 'unsupported';
  if (/no matching records/i.test(r.answer)) return 'no_data';
  return 'answer';
}

async function runAnalyst() {
  const wanted = arg('ids')?.split(',');
  const questions = read('analyst.questions.json').questions.filter((q) => !wanted || wanted.includes(q.id));
  const rows = [];
  for (const q of questions) {
    const started = Date.now();
    const row = { id: q.id, category: q.category, question: q.question, checks: {}, notes: [] };
    try {
      const res = await ask({ question: q.question, timeRange: { preset: q.preset } });
      row.latencyMs = Date.now() - started;
      row.behavior = behaviorOf(res);

      let expected = q.behavior ?? ['answer'];
      let exp = null;
      if (q.oracle) {
        const range = toAnalyticsRange(resolveRange({ preset: q.preset }));
        exp = await oracle[q.oracle.name](range, q.oracle.args);
        if (exp.recordCount === 0 && !q.oracle.noDataIgnored) expected = ['no_data'];
      }
      row.checks.behaviour = expected.includes(row.behavior);
      if (!row.checks.behaviour) row.notes.push(`behaviour ${row.behavior}, expected ${expected.join('/')}`);

      if (q.tools && row.behavior === 'answer') {
        const used = res.evidence.map((e) => e.source);
        row.checks.tools = q.subset ? q.tools.every((t) => used.includes(t)) : used.length === q.tools.length && q.tools.every((t) => used.includes(t));
        if (!row.checks.tools) row.notes.push(`tools ${used.join(',')}, expected ${q.tools.join(',')}`);
      }
      if (exp && row.behavior === 'answer' && expected.includes('answer')) {
        const bad = [];
        for (const label of q.figures) {
          const want = Object.entries(exp.figures).find(([k]) => k === label || (label === 'Most downtime' && k.startsWith('Most downtime')));
          const got = res.keyFigures.find((f) => f.label === want?.[0]);
          if (!want || !got || got.value !== want[1]) bad.push(`${label}: got ${got?.value ?? 'none'}, expected ${want?.[1] ?? 'none'}`);
        }
        row.checks.figures = bad.length === 0;
        if (bad.length) row.notes.push(...bad);
      }
      const text = JSON.stringify(res);
      row.checks.noLeak = !FORBIDDEN_STRINGS.some((s) => text.includes(s));
      if (!row.checks.noLeak) row.notes.push('response contains text that must never appear');
      row.fallback = res.limitations.some((l) => /could not be verified/.test(l));
    } catch (err) {
      row.latencyMs = Date.now() - started;
      row.error = `${err.status ?? ''} ${err.message}`.trim();
      row.checks.completed = false;
    }
    rows.push(row);
    if (pause) await sleep(pause);
  }

  const answered = rows.filter((r) => !r.error);
  const rate = (key) => { const rs = answered.filter((r) => key in r.checks); return `${rs.filter((r) => r.checks[key]).length}/${rs.length} (${pct(rs.filter((r) => r.checks[key]).length, rs.length)})`; };
  const lat = answered.map((r) => r.latencyMs);
  failedChecks += rows.filter((r) => r.error || Object.values(r.checks).some((v) => v === false)).length;

  out('## Feature 2: AI Industrial Analyst');
  out('');
  out(`Questions run: ${rows.length}. Provider errors: ${rows.filter((r) => r.error).length}.`);
  out('');
  out('| Measure | Result |');
  out('|---|---|');
  out(`| Behaviour correct (answer, clarify, refuse, no data) | ${rate('behaviour')} |`);
  out(`| Right data tools chosen | ${rate('tools')} |`);
  out(`| Key figures equal the independent oracle | ${rate('figures')} |`);
  out(`| No forbidden text in responses (names, emails, injected number) | ${rate('noLeak')} |`);
  out(`| Fell back to figures-only because the narrative was unverifiable | ${answered.filter((r) => r.fallback).length}/${answered.length} |`);
  out(`| Latency p50 / p95 | ${percentile(lat, 50)} ms / ${percentile(lat, 95)} ms |`);
  out('');
  const bad = rows.filter((r) => r.error || Object.values(r.checks).some((v) => v === false));
  if (bad.length) {
    out('Failures:');
    for (const r of bad) out(`- ${r.id} "${r.question}": ${r.error ?? r.notes.join('; ')}`);
  } else out('No failures.');
  out('');
}

async function runAssessment() {
  const { scenarios, repeats } = read('assessment.scenarios.json');
  const rows = [];
  const wanted = arg('scenarios')?.split(',');
  for (const s of scenarios.filter((x) => !wanted || wanted.includes(x.id))) {
    const m = s.machine;
    const now = Date.now();
    const machine = await models.Machine.create({
      name: `Scenario ${s.id}`, code: `SC-${s.id}`.slice(0, 20), status: 'running', runHours: m.runHours,
      toolWearMin: m.toolWearMin, temperatureC: m.temperatureC, vibrationMms: m.vibrationMms,
      lastReadingAt: new Date(now - (m.readingAgeHours ?? 1) * 3_600_000),
      lastServiceAt: new Date(now - 40 * 86_400_000), nextServiceDue: new Date(now + (m.serviceOverdueDays ? -m.serviceOverdueDays : 10) * 86_400_000),
    });
    const levels = [];
    const row = { id: s.id, title: s.title, valid: 0, repeats, notes: [], latency: [] };
    for (let i = 0; i < repeats; i++) {
      const started = Date.now();
      try {
        const r = await assess(machine._id, { forceNewAssessment: true }, undefined);
        row.latency.push(Date.now() - started);
        row.valid += 1;
        levels.push(r.riskLevel);
        if (s.mustDisclose && !r.limitations.some((l) => l.includes(s.mustDisclose))) row.notes.push(`did not disclose "${s.mustDisclose}"`);
        if (s.mustAbstain && r.modelId !== null && r.riskLevel !== 'INSUFFICIENT_DATA') row.notes.push('should have abstained');
        const unsupported = r.evidenceUsed.filter((e) => e.value === undefined);
        if (unsupported.length) row.notes.push('evidence without a backend value');
      } catch (err) {
        row.notes.push(`error ${err.status ?? ''} ${err.message}`);
      }
      if (pause) await sleep(pause);
    }
    row.levels = levels;
    row.hit = levels.filter((l) => s.acceptable.includes(l)).length;
    row.consistent = levels.length > 0 && new Set(levels).size === 1;
    rows.push(row);
  }

  const total = rows.reduce((a, r) => a + r.repeats, 0);
  const lat = rows.flatMap((r) => r.latency);
  failedChecks += rows.filter((r) => r.valid < r.repeats || r.hit < r.valid || !r.consistent || r.notes.length).length;

  out('## Feature 1: Gemini machine-condition assessment');
  out('');
  out('These numbers show schema validity, agreement with expert-defined acceptable levels, and run-to-run consistency. They are not predictive accuracy: nothing here is a trained classifier.');
  out('');
  out('| Measure | Result |');
  out('|---|---|');
  out(`| Valid, schema-conforming assessments | ${rows.reduce((a, r) => a + r.valid, 0)}/${total} (${pct(rows.reduce((a, r) => a + r.valid, 0), total)}) |`);
  out(`| Level within the acceptable set | ${rows.reduce((a, r) => a + r.hit, 0)}/${total} (${pct(rows.reduce((a, r) => a + r.hit, 0), total)}) |`);
  out(`| Scenarios with identical level across ${repeats} repeats | ${rows.filter((r) => r.consistent).length}/${rows.length} |`);
  out(`| Latency p50 / p95 | ${percentile(lat, 50)} ms / ${percentile(lat, 95)} ms |`);
  out('');
  out('| Scenario | Levels returned | Acceptable | Consistent | Notes |');
  out('|---|---|---|---|---|');
  for (const r of rows) out(`| ${r.id}: ${r.title} | ${r.levels.join(', ') || 'none'} | ${r.hit}/${r.valid} | ${r.consistent ? 'yes' : 'no'} | ${r.notes.join('; ') || ''} |`);
  out('');
}

out(`# SIMS AI evaluation (${mode} mode)`);
out('');
out(`Run at ${new Date().toISOString()}. Model: ${mode === 'live' ? env.geminiModel : 'scripted rule-based stand-in (harness check only)'}.`);
out('');
if (mode !== 'live') {
  out('> Mock mode proves the harness, oracle and server pipeline work. It says nothing about Gemini. Run `npm run eval:live` for real results.');
  out('');
}
if (only === 'all' || only === 'analyst') await runAnalyst();
if (only === 'all' || only === 'assessment') await runAssessment();

mkdirSync(new URL('./reports/', import.meta.url), { recursive: true });
const file = new URL(`./reports/eval-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`, import.meta.url);
writeFileSync(file, lines.join('\n'));
console.log(`Report written to ${fileURLToPath(file)}`);

await mongoose.connection.dropDatabase();
await mongoose.disconnect();
process.exit(failedChecks === 0 ? 0 : 1);
