#!/usr/bin/env python3
"""Require actual passing JUnit executions and structured security evidence."""
import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path

def require(condition, message):
    if not condition:
        raise ValueError(message)


p = argparse.ArgumentParser()
p.add_argument('--catalog', type=Path, required=True)
p.add_argument('--coverage', type=Path, default=Path('tests/security/coverage.json'))
p.add_argument('--phase', type=int, choices=range(6), required=True)
p.add_argument('--artifacts', type=Path, required=True)
a = p.parse_args()
try:
    cases = json.loads(a.catalog.read_text())['cases']
    coverage = json.loads(a.coverage.read_text())
    require(cases and len({c['id'] for c in cases}) == len(cases), 'Empty or duplicate catalog')
    results = []
    for case in cases:
        if case['phase'] > a.phase:
            continue
        reason = ''
        executions = []
        try:
            rows = [row for row in coverage if row['caseId'] == case['id']]
            require(rows, 'Missing coverage')
            root = ET.parse(a.artifacts / f"phase{case['phase']}.junit.xml").getroot()
            for row in rows:
                matches = [el for el in root.findall('.//testcase') if el.get('name') == row['testName']]
                require(len(matches) == 1, f"Missing or duplicate execution: {row['testName']}")
                el = matches[0]
                require(not any(el.find(tag) is not None for tag in ('skipped', 'failure', 'error')), f"Failed or skipped: {row['testName']}")
                executions.append({'name': row['testName'], 'status': 'PASS'})
            if case['layer'] in ('adversarial', 'isolation'):
                proof = json.loads((a.artifacts / 'proof' / f"{case['id']}.json").read_text())
                require(proof['caseId'] == case['id'] and proof['verified'] is True, 'Unverified proof')
                require(isinstance(proof['environment'], str) and proof['environment'].strip(), 'Missing proof environment')
                require(isinstance(proof['observations'], dict) and proof['observations'], 'Missing observations')
                require(proof['observations'].get('probeExecuted', True) is True, 'Probe did not execute')
                require(proof.get('status', 'PASS') == 'PASS', 'Blocked or failed proof')
            if case['id'] in ('BASE-003', 'REG-001'):
                path = a.artifacts / ('baseline.json' if case['id'] == 'BASE-003' else 'phase5-regression/results.json')
                baseline = json.loads(path.read_text())
                require(baseline['exitCode'] == 0 and baseline['junitComplete'] is True and baseline['tests'] > 0, 'Incomplete regression')
                require(baseline['failed'] == 0 and baseline['skipped'] == 0 and not baseline['timedOut'], 'Failed regression')
                require(baseline['browserSmoke'] is True and baseline['dependencies'] is True, 'Regression controls missing')
                require(baseline['executions'] and all(run['exitCode'] == 0 and not run['timedOut'] for run in baseline['executions']), 'Regression process failed')
        except (OSError, ValueError, KeyError, TypeError, AssertionError, ET.ParseError) as error:
            reason = str(error)
        results.append({'id': case['id'], 'status': 'BLOCKED' if reason else 'PASS', 'tests': executions, 'reason': reason})
    require(results, 'No required cases')
    status = 'PASS' if all(row['status'] == 'PASS' for row in results) else 'BLOCKED'
    a.artifacts.mkdir(parents=True, exist_ok=True)
    (a.artifacts / 'results.json').write_text(json.dumps({'schemaVersion': '1.0', 'status': status, 'phase': a.phase, 'results': results}, indent=2) + '\n')
    print(f'{status}: {sum(row["status"] == "PASS" for row in results)}/{len(results)} mandatory cases')
    if status != 'PASS':
        for row in results:
            if row['reason']:
                print(f'{row["id"]}: {row["reason"]}')
        raise SystemExit(2)
except (OSError, ValueError, KeyError, TypeError, AssertionError) as error:
    print(f'BLOCKED: {error}')
    raise SystemExit(2)
