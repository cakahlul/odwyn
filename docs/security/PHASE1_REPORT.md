# Phase 1 — PASS; release remains blocked

Cumulative gate completed with exit 0. All 15 mandatory Phase 0–1 IDs executed PASS, with 6 Phase 0 tests, 17 Phase 1 tests and all 90 repository regressions across 28 files; zero failures/skips, complete real JUnit and required proof. The supplied JUnit verifier is unchanged. No live systems, paid inference, merge or deployment used. Phase 2 and release verification have not run.

## Files changed

- `security/policy.js`, `security/task-context.js`: normalized SQLite owner/Spaces/resources/memberships/grants/revisions/task identities/decision records; stable IDs; deny precedence; expiry; optimistic edits; unsupported fields/constraints/capabilities denied; unavailable executors denied in every interaction mode.
- `security/repository-gateway.js`, `package.json`, `bun.lock`: actual credential-free, read-only HTTP repository adapter and MCP SDK client/server sharing fresh task-bound authorization. The already installed SDK is pinned directly at 1.32.1. Exact owner endpoint, pinned public IP, no redirects or ambient credentials, JSON/plain text only, 1 MiB/15-second limits. MCP exposes only repository_read with an immutable captured principal.
- `store.js`: private pre-migration SQLite/WAL snapshot, atomic security schema migration, additive legacy Space attribution with zero external grants, authoritative immutable task contexts on creation/reload, Space-bound schedules and scoped recall. Existing saved data preserved; deleted-agent history remains archival.
- `runtime.js`: enforcement at actual dispatch and workflow boundaries, selected-resource context, resource-ID tool schemas, raw provider MCP disabled, old sessions invalidated by Space-specific tool brand, native host execution/permissions denied. Removed host-shell/shared-browser execution and raw MCP approval branches. Asking the owner for information still works; legacy interaction approvals cannot approve resources.
- `files.js`: exact granted file export and non-followed symlink leaf. Resource paths are single workspace basenames.
- `server.js`: authenticated owner capability/Space/resource/access/simulation APIs, existing origin/auth/rate limits retained.
- `tests/security/phase1/acceptance.test.js`, `gateways.test.js`, `access-fixtures.js`, `coverage.json`: all AUTH IDs runnable, real HTTP/MCP repo access and streaming revocation, exact file export/symlink checks, migration/reload/owner authentication. No manifest ID removed or skipped.
- `tests/security/fixtures.js`, `phase0/baseline.test.js`, `run-baseline.js`: truthful exposure-or-dispatch-denial baseline and complete credential-free per-file regression JUnit. SDK dependency check imports its real exported entrypoints, not its nonexistent package root.
- `test/provider-settings.test.js`, `provider-settings-ui.test.js`, `core.test.js`, `runtime.test.js`, `providers.test.js`, `rooms.test.js`, `workflows.test.js`: existing flows retained with explicit disposable file grants and fail-closed privileged expectations. No skips introduced. `public/app.js`, `test/mention-navigation.test.js`: stale zero-width mention overlay fixed and actual mouse hit verified.
- `docs/security/entry-points.json`, `ADR-ACCESS-CONTROL.md`, `THREAT_MODEL.md`, `IMPLEMENTATION_PLAN.md`, `CONNECTOR_REVIEW_TERE_REPORTS.md`, this report: inventory, boundaries, connector review and human-readable evidence.

## Commands and retained failures

- Test-first Phase 1 suite: `bun test tests/security/phase1 --reporter=junit --reporter-outfile=artifacts/security/phase1-test-first.junit.xml`; exit 1, twelve executed failures before implementation.
- Prior cumulative gates `20261013T002844Z-69380` and `20261013T003235Z-70442`: exit 2, genuinely failed AUTH-004 and regressions. Retained; superseded only by a later complete passing gate.
- Current gateway test-first failure retained at `artifacts/security/phase1-gateway-red/gateways.junit.xml`.
- `bun test test/runtime.test.js`; exit 0, 18 PASS. `bun test test/providers.test.js`; exit 0, 6 PASS. `bun test test/rooms.test.js`; exit 0, 1 PASS with real Chromium. `bun test test/workflows.test.js`; exit 0, 15 PASS.
- `ODWYN_SECURITY_REPORT_DIR="$PWD/artifacts/security/phase1-gateway-focus" bun test tests/security/phase1 test/runtime.test.js test/providers.test.js --reporter=junit --reporter-outfile=artifacts/security/phase1-gateway-focus/combined.junit.xml`; exit 0, 41 PASS, zero FAIL/skips.
- `python3 scripts/verify-security-catalog.py --phase 1 --repo-root "$PWD"`; exit 0, 15/15 required IDs mapped. Mapping alone is not execution proof.
- `bash scripts/security-gate.sh --phase 1`, run `20261013T004515Z-72343`; exit 2. All 90 regressions and 17 Phase 1 tests passed, but BASE-003 failed because the SDK has no root export. Fixed by importing its actual client/server/transport entrypoints without omitting any dependency.
- Cumulative runs `20261013T004933Z-73354` and `20261013T005212Z-74346`: exit 2, BLOCKED by a real macOS EXC_GUARD/GUARD_TYPE_FD/CLOSE kill (137) inside provider-settings; missing JUnit correctly rejected. Required Phase 1 cases passed but did not override the blocker.
- Reproduction `bun test test/provider-settings.test.js --reporter=junit --reporter-outfile=artifacts/security/phase1-provider-settings-recheck.junit.xml`; exit 137 after six tests. Its final UI test passed alone. Moved that existing test unchanged into `test/provider-settings-ui.test.js` to receive a fresh process in the baseline runner; no test or assertion deleted.
- `bun test test/provider-settings.test.js --reporter=junit --reporter-outfile=artifacts/security/phase1-provider-settings-split.junit.xml`; exit 0, six PASS. `bun test test/provider-settings-ui.test.js --reporter=junit --reporter-outfile=artifacts/security/phase1-provider-settings-ui-split.junit.xml`; exit 0, one PASS. Total existing provider-settings coverage remains seven tests.
- Final `bash scripts/security-gate.sh --phase 1`: exit 0, report `artifacts/security/20261013T005358Z-75186/`. BASE-001–003 and AUTH-001–012 all executed PASS; required structured proof checked. All 90 regressions PASS, zero skips, all 28 files complete, dependency checks PASS. `results.json` owns the gate verdict; `baseline.json`, phase/regression JUnit, `repository-upstream.json`, `environment.json`, `runner-incident.json` and sanitized logs retain evidence.
- `git diff --check`; exit 0. Supplied `verify-security-results.py` unchanged; SHA-256 `cd4858b8ac4cd6f4b4c507ef90253f6edd936a0e75d8e08fcb2720e09c28b6c2`.

## Per-case coverage and effects

| IDs | Executed coverage |
| --- | --- |
| BASE-001–003 | Complete route/tool inventory; actual canary exposure or denied dispatch; all repository regression files, real Chromium and dependency import checks |
| AUTH-001–003 | Arbitrary zero-grant agent; renaming/provider changes preserve authority; arbitrary owner Spaces limit visible resources |
| AUTH-004 | Actual native and MCP reads reach repo A twice; repo B reads and writes remain zero at disposable HTTP upstream |
| AUTH-005 | Forged agent/Space/workflow/tool context denied; immutable authoritative task identity; structured proof |
| AUTH-006–007 | Exact deny overrides confirmed broad allow; unknown actions/tools/constraints denied |
| AUTH-008 | Started and queued recall denied after revocation; actual streaming HTTP and MCP reads interrupted before confidential suffix disclosure |
| AUTH-009 | Agent self-grant attempts and unauthenticated administrative mutation denied; structured proof |
| AUTH-010–012 | Current revision reevaluated; all legacy interaction modes remain non-authoritative; generated deny-monotonicity and name-independence cases |

Evidence is sanitized: synthetic canaries, local upstream counters, fixed decision observations and credential-free fixture configuration. Required proof is under `proof/BASE-002.json`, `proof/AUTH-005.json`, `proof/AUTH-009.json`; real upstream counts are in `repository-upstream.json`. Every mandated Phase 0–1 case executed PASS in `results.json`. Baseline dispatch denial does not establish OS isolation.

## Tere Reports and remaining boundaries

Installed Tere Reports tool metadata was reviewed; no live report, credential or company endpoint was accessed. It exposes board/project/team reports, not repository reads. Required input filters alone do not scope the creator's API key. Integration waits for the Phase 3 credential broker; aggregate and optional-scope tools stay unavailable to agents.

Remaining: Phase 2 real disposable OS/network runner and isolated terminal; Phase 3 classified files/history/FTS/memory/Rooms, browser profiles and authenticated connectors; Phase 4 approval/UI/append-only sanitized audit; Phase 5 release/migration interruption/whole-app rollback and CI runner provisioning. `ask` grants cannot execute until strong action-bound approval exists. Bare combined Bun tests remain unverified after a macOS guarded-FD crash; the gate executes all 28 regression files in fresh processes with genuine JUnit and zero skips. Private authenticated Git and production report brokerage are not implemented. This phase is not release hardening or a production deployment approval.

## Rollout, rollback and next phase

Development fixtures only; no real user DB migrated. Startup security schema migration is transactional and preceded by a private SQLite snapshot including committed WAL; fixture restore and data preservation tested. Existing chats, five-agent creation, customization, provider configuration, Rooms, Workflows, Routines and Skills remain usable subject to explicit resource grants and fail-closed privileged execution. Autonomous shell/browser/raw MCP stay unavailable rather than inheriting host authority.

Rollback: stop service, preserve current DB/WAL/SHM, restore the matching `pre-security-*/state.sqlite` snapshot only after owner review. Do not run an older unsafe runtime against newly granted data. Full interruption/rollback guarantees remain Phase 5 acceptance work.

After a genuine cumulative PASS, next is Phase 2: write all ten EXEC tests first, identify a real disposable isolated runner, and prove actual OS/network/process/credential boundaries. No environment flag or policy-unit result can substitute for those probes.
