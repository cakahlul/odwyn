#!/usr/bin/env bash
# Odwyn fail-closed security gate scaffold. Not an implementation of security tests.
set -Eeuo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

phase=''; release=0
case "${1:-}" in
  --phase)
    phase="${2:-}"
    if [[ ! "$phase" =~ ^[0-5]$ ]] || [[ $# -ne 2 ]]; then echo 'Usage: bash scripts/security-gate.sh --phase 0..5' >&2; exit 2; fi
    ;;
  --release)
    if [[ $# -ne 1 ]]; then echo 'Usage: bash scripts/security-gate.sh --release' >&2; exit 2; fi
    phase=5; release=1
    ;;
  *) echo 'Usage: bash scripts/security-gate.sh --phase 0..5 | --release' >&2; exit 2;;
esac

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
REPORT_DIR="artifacts/security/$RUN_ID"
mkdir -p "$REPORT_DIR/proof"
export ODWYN_SECURITY_REPORT_DIR="$REPO/$REPORT_DIR"
finish() {
  local code=$?
  trap - EXIT
  if command -v python3 >/dev/null && [[ -f scripts/security-report.py ]]; then
    python3 scripts/security-report.py --phase "$phase" --artifacts "$REPORT_DIR" --exit-code "$code" || { echo 'BLOCKED: report generation failed' >&2; exit 2; }
  fi
  exit "$code"
}
trap finish EXIT

[[ -f 'docs/security/ODWYN_SECURITY_ACCEPTANCE_TEST_PLAN.md' ]] || { echo 'BLOCKED: Missing test plan document' >&2; exit 2; }
[[ -f 'docs/security/ODWYN_SECURITY_HARDENING_SPEC.md' ]] || { echo 'BLOCKED: Missing hardening specification' >&2; exit 2; }
[[ -f 'scripts/verify-security-catalog.py' ]] || { echo 'BLOCKED: Missing catalog validator' >&2; exit 2; }
command -v python3 >/dev/null || { echo 'BLOCKED: python3 missing' >&2; exit 2; }
command -v bun >/dev/null || { echo 'BLOCKED: Bun missing; do not replace test execution with a no-op' >&2; exit 2; }

if [[ "$release" == '1' ]]; then
  [[ "$(uname -s)" == Linux ]] || { echo 'BLOCKED: release requires a disposable Linux runner; workstation Docker workers are insufficient' >&2; exit 2; }
  [[ "${ODWYN_SECURITY_ISOLATION_RUNNER:-}" == '1' ]] || { echo 'BLOCKED: release requires a real isolated test runner (ODWYN_SECURITY_ISOLATION_RUNNER=1)' >&2; exit 2; }
fi

python3 scripts/verify-security-catalog.py --phase "$phase" --repo-root "$REPO" 2>&1 | tee "$REPORT_DIR/catalog.log"
[[ -f 'scripts/verify-security-results.py' ]] || { echo 'BLOCKED: Missing JUnit result verifier' >&2; exit 2; }
test_status=0
for (( i=0; i<=phase; i++ )); do
  echo "RUN security phase $i"
  bun test "tests/security/phase$i" --reporter=junit --reporter-outfile="$REPORT_DIR/phase$i.junit.xml" 2>&1 | tee "$REPORT_DIR/phase$i.log" || test_status=1
done

# Correlate actual executed JUnit test names with all mandatory catalog IDs,
# fail on skips/missing cases and require structured isolation/adversarial proof.
python3 scripts/verify-security-results.py \
  --catalog docs/security/SECURITY_ACCEPTANCE_CASES.json \
  --phase "$phase" --artifacts "$REPORT_DIR" 2>&1 | tee "$REPORT_DIR/verifier.log"
[[ "$test_status" == 0 ]] || { echo 'FAIL: security test process failed' >&2; exit 1; }

if [[ "$release" == '1' ]]; then
  echo 'RUN existing repository regression suite'
  bun scripts/security-regression.js 2>&1 | tee "$REPORT_DIR/regression.log"
fi

echo "PASS: security gate phase $phase; report $REPORT_DIR"
