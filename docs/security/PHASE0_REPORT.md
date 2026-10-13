# Phase 0 handoff: PASS

Gate: `bash scripts/security-gate.sh --phase 0`, exit **0**. Evidence: `artifacts/security/20261013T001828Z-67753/` (ignored by Git). Darwin arm64; Bun 1.3.9; Python 3.10.13; real Chromium, SQLite and disposable legacy shell fixtures. Baseline SHA: `7fe25c1d9cc7e1d02a4afcef40b2f55fcaa027fc`; working-tree patch is uncommitted.

## Executed acceptance coverage

| ID | Test in tests/security/phase0/baseline.test.js | Outcome |
| --- | --- | --- |
| BASE-001 | BASE-001 execution entry-point inventory | PASS: categories/source anchors, native tools, literal routes and dynamic HTTP families checked; inventory.json |
| BASE-002 | BASE-002 legacy shared boundary characterization | PASS for characterization: four legacy leaks reproduced through actual runtime dispatch; proof/BASE-002.json |
| BASE-003 | BASE-003 repository regression browser smoke and dependency baseline | PASS: all 90 existing tests across 27 files, zero failures/skips; real browser/UI and local fake MCP included; dependency imports succeeded |

Phase suite: six tests passed, zero failures/skips. Supplied unchanged verifier correlated all three mandatory IDs and checked adversarial proof. Every repository file ran in a fresh credential-free process; all 27 exit codes were 0. Original individual Bun JUnit reports are under regression/; merged real executions are in regression.junit.xml. Missing, malformed, empty, skipped or failed execution still blocks acceptance.

Coverage enumerates 55 IDs: three runnable Phase 0 rows, 52 future BLOCKED rows with planned files. Phase 0 PASS is a truthful baseline, not security hardening or release approval.

## Diagnosed blockers and fixes

1. Repeated full-suite exit 137 was macOS EXC_GUARD/GUARD_TYPE_FD/CLOSE, with `__close_nocancel` at the top of the Bun crash stack. It was not an assertion failure or runner timeout. Sanitized selected fields are in crash-evidence.json; raw OS reports were not copied. Underlying Bun native bug is not patched. The security regression runner executes every file in a fresh Bun process and merges actual JUnit, avoiding cross-file native-handle reuse. No filters or retries hide failing cases. The first fresh-process attempt completed all files and correctly failed for a real UI timeout.
2. The UI timeout was a stale mention-overlay width after returning from an editor. A physical click at the center of a ~99px-tall wrapped mention landed on Upload while the textarea was only 26px tall. Captured targets/rectangles are in pointer-evidence.json. `renderMentions` now synchronizes overlay width to the textarea before rendering, using the same calculation as the existing ResizeObserver. The existing UI test plants a stale zero width and verifies the mention fits inside the textarea and the real mouse click switches agents without submitting a job.

## Retry commands and exact exits

- `bun test test --reporter=junit --reporter-outfile=artifacts/security/retry-diagnosis/regression.junit.xml`: exit 137; actual crash fields captured.
- `bun test test/provider-settings.test.js --reporter=junit --reporter-outfile=artifacts/security/retry-diagnosis/provider-settings.junit.xml`: exit 0; seven pass.
- `bun test test/providers.test.js test/files.test.js test/provider-settings.test.js --reporter=junit --reporter-outfile=artifacts/security/retry-diagnosis/reproduction.junit.xml`: exit 0; 15 pass. This subset does not reproduce the full-suite crash.
- `bun test test/mention-navigation.test.js`: stale-width regression before fix exit 1, expected <=26px versus actual 98.78125px. After fix, same case with real JUnit exit 0, one pass/nine assertions.
- `bun test test/chat-bubbles.test.js`: exit 0, one pass/92 assertions.
- `bash scripts/security-gate.sh --phase 0`: first fresh-process attempt exit 2 (one UI failure); final attempt exit 0, six phase tests and all 90 repository regressions pass.
- `git diff --check`: exit 0.

Diagnostic repeated pointer probes reproduced the Upload misclick and also triggered the Bun guarded-FD crash; they are evidence only, not acceptance passes. Scratch test was renamed to a fixture to keep it out of test discovery. Old incomplete/failed reports remain under earlier run directories. The previous four security denial tests remain intentionally red; new BASE-002 still verifies each exposure is present.

## Exact added/adapted files

Unchanged canonical contract copies:

- `docs/security/ODWYN_SECURITY_HARDENING_SPEC.md`
- `docs/security/ODWYN_SECURITY_ACCEPTANCE_TEST_PLAN.md`
- `docs/security/SECURITY_ACCEPTANCE_CASES.json`

Architecture:

- `docs/security/THREAT_MODEL.md`
- `docs/security/ADR-ACCESS-CONTROL.md`
- `docs/security/IMPLEMENTATION_PLAN.md`
- `docs/security/CAPABILITY_CATALOG_DRAFT.md`
- `docs/security/INVENTORY.md`
- `docs/security/entry-points.json`
- `docs/security/PHASE0_REPORT.md`
- `security/task-context.js` (inert, validated/frozen scalar identities)

Tests/gates:

- `tests/security/coverage.json`
- `tests/security/fixtures.js`
- `tests/security/run-baseline.js`
- `tests/security/phase0/baseline.test.js`
- `tests/security/phase0/context.test.js`
- `tests/security/phase0/gate-integrity.test.js`
- `tests/security/negative/legacy-denials.test.js`
- `scripts/security-gate.sh` (supplied scaffold: fix plan filename, retain failures, preserve verifier/isolation guards)
- `scripts/verify-security-catalog.py` (supplied, unchanged)
- `scripts/verify-security-results.py` (supplied, unchanged; hash in environment.json)
- `scripts/security-report.py` (sanitized failure/BLOCKED reports; requires supplied verifier PASS)
- `.github/workflows/security.yml` (PR lightweight, merge-queue/manual release hard gate)

Existing `.gitignore` already ignores artifacts. Supplied source contracts/prompt/install files are preserved. No security dispatch, provider settings, saved-data or autonomy changes.


Additional retry changes:

- `tests/security/run-baseline.js`: discover/run all files separately and retain/merge genuine JUnit; retain every file's status.
- `tests/security/phase0/baseline.test.js`: require complete JUnit and zero nonzero per-file exits.
- `public/app.js`: one-line overlay-width synchronization.
- `test/mention-navigation.test.js`: deterministic stale-width regression and geometry assertion.
- `docs/security/IMPLEMENTATION_PLAN.md`, `docs/security/PHASE0_REPORT.md`: updated run strategy and evidence.

## Effects, rollout, rollback and next phase

No security leak fixed in Phase 0. Outside-workspace terminal reads, foreign-agent search, global-memory prompt disclosure and shared cookie/localStorage still occur. The UI misclick is fixed; the Bun crash is worked around in the security runner. Bare combined `bun test test` may still trigger the native crash. No true OS/network/token isolation or high-autonomy safety claim.

Fixtures use synthetic canaries, fake providers and intercepted browser pages. No live secrets, paid requests, production service writes, merge or deployment. Sanitized proof records observations, not canary contents.

Rollout is local review/testing only; no data migration or autonomy enabled. Rollback restores the single UI line and prior runner/test/doc changes; saved data is unchanged. CI has not run remotely; disposable runner provisioning and branch protection remain owner operations.

Next phase: AUTH-001–012 test-first owner/Space/resource policy enforcement with unsafe host/MCP routes blocked until isolated gateways exist. Real isolated release infrastructure and all 52 future mandatory cases remain BLOCKED/unimplemented.
