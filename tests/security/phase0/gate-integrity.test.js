import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('Phase 0 supplied verifier rejects missing skipped failed and unproved executions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-verifier-'));
  const artifacts = join(directory, 'artifacts'); mkdirSync(artifacts);
  const name = 'FIXTURE-001 verifier fixture';
  const catalog = join(directory, 'catalog.json'), coverage = join(directory, 'coverage.json');
  writeFileSync(catalog, JSON.stringify({cases: [{id: 'FIXTURE-001', phase: 0, layer: 'adversarial', release_blocker: true}]}));
  writeFileSync(coverage, JSON.stringify([{caseId:'FIXTURE-001', testName:name, testFile:'fixture.test.js'}]));
  const run = () => Bun.spawnSync(['python3', resolve('scripts/verify-security-results.py'), '--catalog', catalog, '--coverage', coverage, '--phase', '0', '--artifacts', artifacts]);
  try {
    expect(run().exitCode).toBe(2);
    for (const child of ['<skipped/>', '<failure/>', '<error/>', '']) {
      writeFileSync(join(artifacts, 'phase0.junit.xml'), `<testsuites><testsuite><testcase name="${name}">${child}</testcase></testsuite></testsuites>`);
      expect(run().exitCode).toBe(2);
    }
    mkdirSync(join(artifacts, 'proof'));
    writeFileSync(join(artifacts, 'proof/FIXTURE-001.json'), JSON.stringify({caseId:'FIXTURE-001', verified:true, environment:'validator fixture only', observations:{fixture:true}}));
    expect(run().exitCode).toBe(0);
    writeFileSync(join(artifacts, 'phase0.junit.xml'), '<testsuites><testsuite><testcase name="wrong name"/></testsuite></testsuites>');
    expect(run().exitCode).toBe(2);
  } finally {rmSync(directory, {recursive:true, force:true});}
});


test('Phase 0 failure reporter preserves missing executions as BLOCKED', () => {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-report-'));
  try {
    const result = Bun.spawnSync(['python3', resolve('scripts/security-report.py'), '--phase', '0', '--artifacts', directory, '--exit-code', '2']);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(readFileSync(join(directory, 'results.json'), 'utf8'));
    expect(report.status).toBe('BLOCKED');
    expect(report.results).toHaveLength(3);
    expect(report.results.every(row => row.status === 'BLOCKED' && row.tests.length === 0)).toBe(true);
    const falsePass = Bun.spawnSync(['python3', resolve('scripts/security-report.py'), '--phase', '0', '--artifacts', directory, '--exit-code', '0']);
    expect(falsePass.exitCode).not.toBe(0);
  } finally {rmSync(directory, {recursive:true, force:true});}
});


test('Phase 0 failure reporter retains executed unavailable-runner cases as BLOCKED and rejects false PASS', () => {
  const directory=mkdtempSync(join(tmpdir(),'odwyn-blocked-report-'));
  try {
    writeFileSync(join(directory,'phase2.junit.xml'),'<testsuites><testsuite><testcase name="EXEC-007 Scoped push permitted"><failure type="AssertionError"/></testcase><testcase name="EXEC-008 Protected refs blocked"><failure type="AssertionError"/></testcase></testsuite></testsuites>');
    mkdirSync(join(directory,'proof'));mkdirSync(join(directory,'execution'));
    writeFileSync(join(directory,'proof/EXEC-007.json'),JSON.stringify({caseId:'EXEC-007',verified:false,environment:'reporter fixture',observations:{probeExecuted:false}}));
    writeFileSync(join(directory,'execution/EXEC-007.json'),JSON.stringify({caseId:'EXEC-007',status:'BLOCKED',probeExecuted:false,reason:'BLOCKED: disposable runner unavailable.'}));
    writeFileSync(join(directory,'proof/EXEC-008.json'),JSON.stringify({caseId:'EXEC-008',verified:false,environment:'reporter fixture',observations:{probeExecuted:true}}));
    const result=Bun.spawnSync(['python3',resolve('scripts/security-report.py'),'--phase','2','--artifacts',directory,'--exit-code','2']);
    expect(result.exitCode).toBe(0);
    const report=JSON.parse(readFileSync(join(directory,'results.json'),'utf8'));
    expect(report.results.find(r=>r.id==='EXEC-007')).toMatchObject({status:'BLOCKED',tests:[{name:'EXEC-007 Scoped push permitted',status:'BLOCKED'}]});
    expect(report.results.find(r=>r.id==='EXEC-008')).toMatchObject({status:'FAIL',tests:[{name:'EXEC-008 Protected refs blocked',status:'FAIL'}]});
    expect(report.status).toBe('FAIL');
    expect(Bun.spawnSync(['python3',resolve('scripts/security-report.py'),'--phase','2','--artifacts',directory,'--exit-code','0']).exitCode).not.toBe(0);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
