#!/usr/bin/env python3
"""Preserve failed/blocked gate executions; the supplied verifier owns PASS."""
import argparse
import json
import platform
import hashlib
import subprocess
from pathlib import Path
import xml.etree.ElementTree as ET

p = argparse.ArgumentParser()
p.add_argument('--phase', type=int, required=True)
p.add_argument('--artifacts', type=Path, required=True)
p.add_argument('--exit-code', type=int, required=True)
a = p.parse_args()
catalog = json.loads(Path('docs/security/SECURITY_ACCEPTANCE_CASES.json').read_text())
coverage = json.loads(Path('tests/security/coverage.json').read_text())
results = []
for case in catalog['cases']:
    if case['phase'] > a.phase:
        continue
    xml = a.artifacts / f"phase{case['phase']}.junit.xml"
    executed = []
    try:
        names = [m['testName'] for m in coverage if m['caseId'] == case['id']]
        for el in ET.parse(xml).getroot().findall('.//testcase'):
            if case['id'] in el.get('name', '') and any(n in el.get('name', '') for n in names):
                status = 'SKIPPED' if el.find('skipped') is not None else 'FAIL' if el.find('failure') is not None or el.find('error') is not None else 'PASS'
                if status == 'FAIL':
                    # Bun 1.3.9 labels thrown environment errors AssertionError.
                    # This changes only failure classification, never verifier PASS.
                    try:
                        execution = json.loads((a.artifacts / 'execution' / f"{case['id']}.json").read_text())
                        proof = json.loads((a.artifacts / 'proof' / f"{case['id']}.json").read_text())
                        if (execution.get('caseId') == case['id'] and execution.get('status') == 'BLOCKED'
                                and isinstance(execution.get('probeExecuted'), bool)
                                and str(execution.get('reason', '')).startswith('BLOCKED: ')
                                and proof.get('caseId') == case['id'] and proof.get('verified') is False
                                and isinstance(proof.get('observations', {}).get('probeExecuted'), bool)):
                            status = 'BLOCKED'
                    except (OSError, ValueError, AttributeError):
                        pass
                executed.append({'name': el.get('name'), 'status': status})
    except (OSError, ET.ParseError):
        pass
    status = 'BLOCKED' if not executed else next((t['status'] for t in executed if t['status'] != 'PASS'), 'PASS')
    proof = a.artifacts / 'proof' / f"{case['id']}.json"
    if case['layer'] in ('adversarial', 'isolation') and not proof.is_file():
        status = 'BLOCKED'
    if case['id'] == 'BASE-003':
        baseline = a.artifacts / 'baseline.json'
        if baseline.exists():
            observation = json.loads(baseline.read_text())
            if observation.get('timedOut') or observation.get('exitCode') in (124, 137, -9) or not observation.get('tests'):
                status = 'BLOCKED'
    results.append({'id': case['id'], 'status': status, 'tests': executed})
if a.exit_code == 0:
    verified = a.artifacts / 'results.json'
    if not verified.exists() or json.loads(verified.read_text()).get('status') != 'PASS':
        raise SystemExit('BLOCKED: supplied verifier PASS report missing')
verdict = 'PASS' if a.exit_code == 0 else 'FAIL' if any(r['status'] == 'FAIL' for r in results) else 'BLOCKED'
if a.exit_code != 0:
    (a.artifacts / 'results.json').write_text(json.dumps({'schemaVersion':'1.0', 'status':verdict, 'phase':a.phase, 'exitCode':a.exit_code, 'results':results}, indent=2) + '\n')
for log in a.artifacts.glob('*.log'):
    log.write_text(log.read_text().replace(str(Path.cwd()), '<repo>').replace(str(Path.home()), '<host-home>'))
environment = {'platform':platform.system(), 'architecture':platform.machine(), 'python':platform.python_version(),
    'gitSha':subprocess.check_output(['git','rev-parse','HEAD'], text=True).strip(), 'noLiveSystemsTouched':True,
    'verifierSha256':hashlib.sha256(Path('scripts/verify-security-results.py').read_bytes()).hexdigest(),
    'isolation':'Not established by Phase 0. No release or autonomy authorization.'}
(a.artifacts / 'environment.json').write_text(json.dumps(environment, indent=2) + '\n')
(a.artifacts / 'coverage.json').write_text(json.dumps(coverage, indent=2) + '\n')
for src, dst in [('docs/security/INVENTORY.md','inventory.md'), ('docs/security/THREAT_MODEL.md','threat-model-delta.md')]:
    (a.artifacts / dst).write_text(Path(src).read_text())
(a.artifacts / 'report.md').write_text(f"# Security gate: {verdict}\n\nPhase: {a.phase}; exit: {a.exit_code}; SHA: {environment['gitSha']}.\n\n" +
    '\n'.join(f"- {r['id']}: {r['status']}" for r in results) +
    '\n\nCommands/logs: catalog.log, verifier.log, phase*.log and regression.log.\n' +
    'Phase 0 characterizes exposures; PASS is not a security release verdict. No live systems touched by disposable fixtures.\n' +
    'Remediation: resolve missing/failed executions and evidence before advancing. Legacy boundary risks remain.\n')
print(f"{verdict}: report {a.artifacts}/report.md; exit {a.exit_code}")
