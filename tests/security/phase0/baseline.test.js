import { test, expect } from 'bun:test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { legacyProbe } from '../fixtures.js';
import { tools } from '../../../runtime.js';

const report = process.env.ODWYN_SECURITY_REPORT_DIR;
function evidence(name, value) {
  if (!report) throw new Error('BLOCKED: ODWYN_SECURITY_REPORT_DIR required');
  mkdirSync(join(report, 'proof'), {recursive: true});
  writeFileSync(join(report, name), JSON.stringify(value, null, 2) + '\n');
}

test('BASE-001 execution entry-point inventory', () => {
  const inventory = JSON.parse(readFileSync('docs/security/entry-points.json', 'utf8'));
  const categories = ['chat','room','workflow','skill','routine','recovery','file','memory','browser','terminal','mcp','admin','provider','network'];
  for (const category of categories) expect(inventory.boundaries.some(row => row.category === category)).toBe(true);
  for (const row of inventory.boundaries) {
    expect(row.plannedHook.length).toBeGreaterThan(5);
    expect(row.gap.length).toBeGreaterThan(5);
    expect(readFileSync(row.file, 'utf8')).toContain(row.anchor);
  }
  expect(inventory.tools.sort()).toEqual(tools.map(tool => tool.name).sort());
  const server = readFileSync('server.js', 'utf8');
  const literals = [...new Set([...server.matchAll(/pathname === '([^']+)'/g)].map(match => match[1]))].sort();
  const patterns = [...server.matchAll(/pathname\.match\((.+)\)/g)].map(match => match[1]).sort();
  expect(inventory.httpLiterals.sort()).toEqual(literals);
  expect(inventory.httpPatterns.sort()).toEqual(patterns);
  evidence('inventory.json', inventory);
});

test('BASE-002 legacy shared boundary characterization', async () => {
  const observations = {};
  for (const kind of ['terminal', 'search', 'memory', 'browser']) {
    observations[kind] = await legacyProbe(kind);
    // Characterization records actual exposure OR a verified dispatch denial.
    expect(typeof observations[kind].leaked).toBe('boolean');
    expect(observations[kind].leaked || observations[kind].denied).toBe(true);
  }
  if(observations.browser.leaked){
    expect(observations.browser.sharedContext).toBe(true);
    expect(observations.browser.localStorageShared).toBe(true);
  }else expect(observations.browser.profileNotStarted).toBe(true);
  evidence('proof/BASE-002.json', {caseId: 'BASE-002', verified: true,
    environment: `${process.platform}/${process.arch}; SQLite and application dispatch; browser/shell only if dispatched; disposable fixtures`,
    observations, securityVerdict: Object.values(observations).some(o=>o.leaked)?'EXPOSED':'DISPATCH_DENIED_NOT_OS_ISOLATION', noLiveSystemsTouched: true});
}, 120_000);

test('BASE-003 repository regression browser smoke and dependency baseline', async () => {
  // Run the existing suite, including real Chromium UI tests and local Codex MCP.
  // Restrict inherited credentials/configuration to disposable paths in helper.
  const { runBaseline } = await import('../run-baseline.js');
  const result = await runBaseline(report);
  evidence('baseline.json', result);
  expect(result.exitCode).toBe(0);
  expect(result.junitComplete).toBe(true);
  expect(result.executions).toHaveLength(result.files.length);
  expect(result.executions.every(run => run.exitCode === 0)).toBe(true);
  expect(result.failed).toBe(0);
  expect(result.skipped).toBe(0);
  expect(result.tests).toBeGreaterThan(80);
  expect(result.browserSmoke).toBe(true);
  expect(result.dependencies).toBe(true);
}, 300_000);
