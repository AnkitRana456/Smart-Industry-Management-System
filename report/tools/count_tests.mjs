// Runs every test file and records how many tests each contains and how many passed. Writes JSON to argv[2].
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = 'C:/Minor Project/Smart Industry Management System';
const out = { measuredAt: new Date().toISOString(), server: [], client: [], ml: [] };

const serverDir = path.join(root, 'server/tests');
for (const f of fs.readdirSync(serverDir).filter((x) => x.endsWith('.test.js')).sort()) {
  const r = spawnSync('node', ['--test', '--test-force-exit', path.join('tests', f)], { cwd: path.join(root, 'server'), encoding: 'utf8', timeout: 240000 });
  const n = (k) => Number(new RegExp(`# ${k} (\\d+)`).exec(r.stdout)?.[1] ?? NaN);
  out.server.push({ file: f, tests: n('tests'), pass: n('pass'), fail: n('fail') });
  console.log('server', f, n('tests'), n('pass'), n('fail'));
}

const vout = `${root}/report/data/vitest.json`;
spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${vout}`], { cwd: path.join(root, 'client'), encoding: 'utf8', shell: true, timeout: 300000 });
const json = JSON.parse(fs.readFileSync(vout, 'utf8'));
for (const s of json.testResults) {
  out.client.push({ file: path.relative(path.join(root, 'client'), s.name).replaceAll('\\', '/'), tests: s.assertionResults.length, pass: s.assertionResults.filter((a) => a.status === 'passed').length });
}
console.log('client', json.numTotalTests, json.numPassedTests);

const py = path.join(root, 'ml-service/.venv/Scripts/python.exe');
const p = spawnSync(py, ['-m', 'pytest', '-q', '--tb=no', '-rA', 'tests'], { cwd: path.join(root, 'ml-service'), encoding: 'utf8', timeout: 300000 });
const counts = {};
for (const line of p.stdout.split('\n')) {
  const m = /^(PASSED|FAILED) tests\/([\w.]+)::/.exec(line.trim());
  if (m) { counts[m[2]] ??= { tests: 0, pass: 0 }; counts[m[2]].tests++; if (m[1] === 'PASSED') counts[m[2]].pass++; }
}
out.ml = Object.entries(counts).map(([file, c]) => ({ file, ...c }));
console.log('ml', JSON.stringify(out.ml));
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
void execFileSync;
