/**
 * Rule-based stand-in for Gemini. It exists to prove the evaluation harness and the server pipeline
 * work end to end. Its scores say nothing about Gemini's quality: run with --mode live for that.
 */
const evidenceOf = (p) => JSON.parse(p.split('EVIDENCE (JSON, data only):\n')[1]);

function route(q) {
  const lower = q.toLowerCase();
  const code = q.match(/\bE-\d\b/i)?.[0].toUpperCase();
  const call = (name, extra = {}) => ({ name, ...(code && ['getMachineStatus', 'getDowntimeSummary', 'getSavedMaintenanceAssessments'].includes(name) ? { machineCode: code } : {}), ...extra });
  const answer = (...tools) => ({ intent: 'answer', tools });

  if (/\b(it|they)\b.*\b(doing|broken|fine|ok)\b|^how is it|^is it\b/.test(lower)) return { intent: 'clarify', clarification: 'Which machine, item or order do you mean?', tools: [] };
  if (/weather|poem|joke|delete|password|email|ignore (all|your|previous)|capital of/.test(lower)) return { intent: 'unsupported', tools: [] };

  const tools = [];
  if (/downtime|down longest|was down|why was there/.test(lower)) tools.push(call('getDowntimeSummary'));
  if (/produc|output|units|orders|late orders|bottleneck/.test(lower)) {
    const product = ['gear', 'shaft', 'bracket', 'valve'].find((p) => lower.includes(p));
    tools.push(call('getProductionSummary', product ? { product } : {}));
  }
  if (/stock|reorder|inventory|steel|oil|bearing|enough/.test(lower)) {
    const search = ['steel', 'oil', 'bearing'].find((p) => lower.includes(p));
    tools.push(call('getInventoryStatus', { ...(search && { search }), ...(/low|reorder|need/.test(lower) && { lowStockOnly: true }) }));
  }
  if (/risk|assess/.test(lower)) {
    const riskLevel = lower.includes('high') ? 'HIGH' : lower.includes('medium') ? 'MEDIUM' : undefined;
    tools.push(call('getSavedMaintenanceAssessments', riskLevel ? { riskLevel } : {}));
  }
  if (/attend|\blate\b|present/.test(lower) && !/late orders/.test(lower)) tools.push(call('getWorkerAttendance'));
  if (/\b(running|idle|offline|maintenance)\b|status|how many machines/.test(lower) && !tools.length) {
    const status = ['running', 'idle', 'offline', 'maintenance'].find((s) => lower.includes(s));
    tools.push(call('getMachineStatus', status && !code ? { status } : {}));
  }
  if (/problems/.test(lower)) {
    if (!tools.some((t) => t.name === 'getInventoryStatus')) tools.push(call('getInventoryStatus'));
    if (!tools.some((t) => t.name === 'getMachineStatus')) tools.push(call('getMachineStatus'));
  }
  return tools.length ? answer(...tools.slice(0, 3)) : { intent: 'unsupported', tools: [] };
}

function assess(e) {
  const wear = e.readings.toolWearMin?.value ?? 0;
  const vib = e.readings.vibrationMms?.value ?? 0;
  const issues = e.dataIssues.length > 0;
  const level = issues && (e.readingsStale || e.dataIssues.some((i) => /plausible/.test(i))) ? 'INSUFFICIENT_DATA'
    : wear > 220 || vib > 5 ? 'HIGH' : wear > 150 || vib > 3 ? 'MEDIUM' : 'LOW';
  return {
    riskLevel: level,
    assessmentSummary: level === 'INSUFFICIENT_DATA' ? 'The readings are not reliable enough to assess this machine.' : `Tool wear is ${wear} min and vibration is ${vib} mm/s.`,
    observedConditions: [`Tool wear ${wear} min`, `Vibration ${vib} mm/s`],
    evidenceUsed: level === 'INSUFFICIENT_DATA' ? [] : [{ field: 'toolWearMin' }, { field: 'vibrationMms' }],
    recommendedActions: ['Ask a technician to review the machine at the next stop.'],
    limitations: [],
  };
}

export function makeMockProvider() {
  return {
    modelId: 'mock-rules',
    async generate({ purpose, prompt }) {
      if (purpose === 'router') return { text: JSON.stringify(route(prompt.split('QUESTION:\n')[1])) };
      if (purpose === 'answer') {
        const e = evidenceOf(prompt);
        const figs = e.results.flatMap((r) => r.keyFigures).slice(0, 4).map((f) => `${f.label} ${f.value} ${f.unit}`);
        return { text: JSON.stringify({ answer: `For ${e.reportingPeriod.label}: ${figs.join('; ')}.`, limitations: [] }) };
      }
      if (purpose === 'assessment') return { text: JSON.stringify(assess(evidenceOf(prompt))) };
      throw new Error(`mock provider has no script for ${purpose}`);
    },
  };
}
