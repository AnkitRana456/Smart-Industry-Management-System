import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const read = (f) => JSON.parse(readFileSync(new URL(`../evals/${f}`, import.meta.url), 'utf8'));
const TOOLS = ['getMachineStatus', 'getDowntimeSummary', 'getProductionSummary', 'getInventoryStatus', 'getSavedMaintenanceAssessments', 'getWorkerAttendance', 'getMaintenanceWorkOrders', 'getReliability', 'getStockForecast', 'getOrderProjections'];
const PRESETS = ['TODAY', 'YESTERDAY', 'THIS_WEEK', 'LAST_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'LAST_7_DAYS', 'LAST_30_DAYS'];

describe('Evaluation datasets', () => {
  const { questions } = read('analyst.questions.json');
  const { scenarios } = read('assessment.scenarios.json');

  test('there are 30 to 50 analyst questions with unique ids', () => {
    assert.ok(questions.length >= 30 && questions.length <= 50, `got ${questions.length}`);
    assert.equal(new Set(questions.map((q) => q.id)).size, questions.length);
  });

  test('every question is well formed and refers to real tools and presets', () => {
    for (const q of questions) {
      assert.ok(q.question.length >= 3 && q.question.length <= 500, q.id);
      assert.ok(PRESETS.includes(q.preset), `${q.id} preset`);
      if (q.behavior) assert.ok(q.behavior.every((b) => ['answer', 'clarify', 'unsupported', 'no_data'].includes(b)), q.id);
      else {
        assert.ok(q.tools?.length && q.tools.every((t) => TOOLS.includes(t)), `${q.id} tools`);
        assert.ok(q.oracle?.name && q.figures?.length, `${q.id} oracle and figures`);
      }
    }
  });

  test('all analyst categories are covered, including refusals and clarifications', () => {
    const cats = new Set(questions.map((q) => q.category));
    for (const c of ['downtime', 'production', 'inventory', 'machines', 'assessments', 'attendance', 'multi', 'behaviour']) assert.ok(cats.has(c), c);
    assert.ok(questions.some((q) => q.behavior?.includes('clarify')));
    assert.ok(questions.some((q) => q.behavior?.includes('unsupported')));
  });

  test('assessment scenarios cover normal, unusual, missing, stale and contradictory data', () => {
    assert.deepEqual(scenarios.map((s) => s.id).sort(), ['contradictory', 'elevated', 'missing', 'normal', 'severe', 'stale']);
    assert.ok(scenarios.every((s) => s.acceptable.length > 0));
  });
});

describe('Evaluation harness', () => {
  test('runs end to end against the scripted provider with no failures', { timeout: 120_000 }, () => {
    const r = spawnSync(process.execPath, ['evals/run.js', '--mode', 'mock'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, GEMINI_API_KEY: '', GEMINI_MODEL: '' } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Feature 2: AI Industrial Analyst/);
    assert.match(r.stdout, /Feature 1: Gemini machine-condition assessment/);
    assert.match(r.stdout, /No failures\./);
  });

  test('live mode refuses to start without a key instead of pretending', () => {
    const r = spawnSync(process.execPath, ['evals/run.js', '--mode', 'live'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, GEMINI_API_KEY: '', GEMINI_MODEL: '', DOTENV_CONFIG_PATH: 'no-such.env' } });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /GEMINI_API_KEY and GEMINI_MODEL/);
  });
});
