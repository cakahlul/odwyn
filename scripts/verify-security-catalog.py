#!/usr/bin/env python3
"""Validate mandatory case coverage before executing the security gate."""
import argparse
import json
import re
from pathlib import Path

def require(condition, message):
    if not condition:
        raise ValueError(message)


p = argparse.ArgumentParser()
p.add_argument('--phase', type=int, choices=range(6), required=True)
p.add_argument('--repo-root', type=Path, default=Path.cwd())
a = p.parse_args()
try:
    catalog = json.loads((a.repo_root / 'docs/security/SECURITY_ACCEPTANCE_CASES.json').read_text())
    coverage = json.loads((a.repo_root / 'tests/security/coverage.json').read_text())
    cases = catalog['cases']
    expected = {f'{prefix}-{number:03d}' for prefix, count in [('BASE', 3), ('AUTH', 12), ('EXEC', 10), ('DATA', 11), ('APPR', 6), ('AUD', 1), ('UX', 2), ('MIG', 2), ('REG', 1), ('E2E', 2), ('ATTACK', 2), ('REC', 1), ('OPS', 2)] for number in range(1, count + 1)}
    require(len(cases) == len(expected) and {c['id'] for c in cases} == expected, 'Mandatory case IDs changed')
    for case in cases:
        require(case['phase'] in range(6) and case['release_blocker'] is True, 'Invalid mandatory case')
        phase = {'BASE': 0, 'AUTH': 1, 'EXEC': 2, 'DATA': 3, 'APPR': 4, 'AUD': 4, 'UX': 4, 'MIG': 5, 'REG': 5, 'E2E': 5, 'ATTACK': 5, 'REC': 5, 'OPS': 5}[case['id'].split('-')[0]]
        layer = 'isolation' if phase == 2 else 'adversarial' if phase >= 3 or case['id'] in ('BASE-002', 'AUTH-005', 'AUTH-009') else 'regression' if case['id'] == 'BASE-003' else 'functional'
        require(case['phase'] == phase and case['layer'] == layer, 'Mandatory phase or proof requirement changed')
        if case['phase'] > a.phase:
            continue
        rows = [row for row in coverage if row['caseId'] == case['id']]
        require(rows, f"Missing coverage: {case['id']}")
        require(len({(r['testFile'], r['testName']) for r in rows}) == len(rows), 'Duplicate coverage')
        for row in rows:
            path = (a.repo_root / row['testFile']).resolve()
            require(path.is_relative_to(a.repo_root.resolve()), 'Coverage outside repository')
            require(re.search(rf'phase{case["phase"]}/', row['testFile']), 'Wrong test phase')
            require(row['testName'].startswith(case['id'] + ' '), 'Wrong test ID')
            require(row['testName'] in path.read_text(), f"Missing executable test: {row['testName']}")
    require(all(row['caseId'] in expected for row in coverage), 'Unknown coverage ID')
except (OSError, ValueError, KeyError, TypeError, AssertionError) as error:
    raise SystemExit(f'BLOCKED: {error}')
print(f'PASS: mandatory coverage through phase {a.phase}')
