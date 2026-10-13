# Phase 4 — PASS

Authoritative run: `artifacts/security/20261013T072830Z-50439/`. Final code is frozen during this run. Cumulative gate **exit 0**: **45/45 mandatory IDs** through Phase 4 executed PASS, zero skips/missing cases. Phases 0/1/2/3 passed 7/17/15/21 tests; Phase 4 passed **22/22 real child cases**, **188 child assertions**, with 44 parent execution checks. BASE-003 passed all **90 repository regressions across 28 files**, zero failures/skips. The unchanged supplied verifier confirmed mandatory executions and required proof. Phase 5/release is not authorized or claimed.

## Files and behavior

- `security/approvals.js`: canonical immutable envelopes, current-PDP/revision/expiry/task checks, hashed action-bound 60-second step-up proofs, atomic single-use consume, logical proposal deduplication, durable sanitized receipts and indeterminate outcomes.
- `security/action-gateway.js`, `security/connectors.js`: typed payment/send/merge/production protocol, server-fixed connection/upstream IDs, broker credentials, pinned HTTPS, target-version preconditions/idempotency, bounded matching receipts and abortable transport. No native vendor, live service or broad installed MCP credential is used.
- `security/policy.js`, `store.js`: mandatory risk floors, trusted exact execution scope, persistent pauses, default Spaces, resource-free editable presets, dry preview/savepoint, pre-persistence audit redaction, private pre-approval SQLite backup and additive tables.
- `runtime.js`, `server.js`, `workflows.js`: existing tool Ask approvals, trusted owner routes/step-up, explicit fixed-envelope execution, waiting after provider completion, worker/HTTP emergency shutdown, audit, immutable task Space, workflow action allowlist and compatible routine default binding.
- `public/security-ui.js`, `public/app.js`, `public/views.js`, `public/style.css`, `public/workflow-editor.js`: Access & Autonomy, arbitrary Spaces/resources, precise deny/auto/ask, presets/constraints, preview/simulator, task picker, approval/password UI, audit, connector controls, pause/resume. Exact Deny and Revoke beat inherited wildcard Auto; saving preserves existing per-action expiry and branch restrictions. Password inputs clear after use.
- `tests/security/phase4/acceptance.test.js`, `tests/security/phase4/cases.js`, `tests/security/coverage.json`, `docs/security/entry-points.json`: all nine mandatory IDs and thirteen additional regressions, actual Bun JUnit/structured proof/execution, complete HTTP/tool inventory. Fresh Bun child per case preserves assertions while avoiding the reproduced macOS guarded-FD crash. Every registered child executes; no skipped child cases can pass.
- `.github/workflows/security.yml`: lightweight PR approvals; release/merge still runs the full fail-closed gate on a disposable runner. CI itself was not run here.
- `PHASE4_PLAN.md`, `PHASE4_API.md`, `ADR-ACCESS-CONTROL.md`, `THREAT_MODEL.md`, `IMPLEMENTATION_PLAN.md`, this report: design, versioned actual handler/adapter schemas, threats, migration, verification and rollback. Pre-existing workspace changes remain intact; no merge/commit/deployment was performed.

Supplied verifier SHA-256 remains `cd4858b8ac4cd6f4b4c507ef90253f6edd936a0e75d8e08fcb2720e09c28b6c2`. Gate/catalog guards were not weakened. No new dependency was added for Phase 4.

## Commands and exit status

```sh
ODWYN_SECURITY_ISOLATION_RUNNER=1 \
ODWYN_SECURITY_SANDBOX_IMAGE=sha256:b098e07c8d48bd4f997cb24bf106cd1fa9d8f1d2168c637f354aff680ead0b99 \
caffeinate -i bash scripts/security-gate.sh --phase 4
```

`caffeinate` only prevents idle sleep. Actual isolation comes from disposable worker/kernel, Chromium and upstream probes, never an environment declaration.

- Final cumulative command above: **exit 0**; all 45 mandatory IDs PASS. Logs/JUnit/proof/execution/results retained in the authoritative run. Frozen code hashes match; sanitized JUnit preserves all case names, outcomes and counts.
- `python3 scripts/verify-security-catalog.py --phase 4`: exit 0, all 45 mandatory IDs mapped. Registry retains all 55 IDs, with Phase 5 explicitly BLOCKED.
- `git diff --check`: exit 0.
- `ODWYN_SECURITY_REPORT_DIR=artifacts/security/phase4-process-green ODWYN_SECURITY_ISOLATION_RUNNER=1 ODWYN_SECURITY_SANDBOX_IMAGE=<immutable image above> bun test tests/security/phase4 --reporter=junit --reporter-outfile=artifacts/security/phase4-process-green/phase4.junit.xml`: exit 0, 22 cases and 22 actual one-case child JUnit files, zero skips/failures.
- Original nine-case tests-first red run: exit 1, nine genuine failures before implementing the adapter/owner UI. Additional red regressions reproduced missing fresh privileged-grant authentication, plaintext audit persistence, lost approvals after native completion, duplicate payable proposals, wildcard revocation and expiry loss. They are retained under `phase4-red/`.
- Cumulative attempt `20261013T071953Z-46422`: exit 2, all 22 Phase 4 cases passed but BASE-003 failed two unchanged 320-pixel layout regressions (Appearance and Sidebar). The new task picker caused composer overflow. Bounded picker sizing and toolbar wrapping fix it; each original test then passed unchanged (141 and 91 assertions). Revocation additionally clears expiry so wildcard access cannot revive.
- Cumulative attempts `20261013T065724Z-37379` and `20261013T071026Z-41574`: exit 2; no Phase 4 JUnit after Bun SIGKILL/EXC_GUARD. Reports correctly fail acceptance with missing executions. Sanitized OS crash facts are retained; assertions/timeouts/required IDs were not weakened. Diagnostic filtered runs are not cumulative PASS evidence.

## Required Phase 4 coverage and side effects

| ID | Executed boundary and observed effect |
|---|---|
| APPR-001 | Four generic high-impact operations: zero unapproved/alternate-tool effects; one real approved effect each. Native completion retains trusted review. Low-risk Ask writes one scoped note only after approval. |
| APPR-002 | Concurrent and later replay leave one upstream mutation. Identical retry keeps the same proposal/idempotency ID, including after success. |
| APPR-003 | Changed amount/currency/recipient/body/env/commit/version/resource rejected; originals execute. Connector mutation at unchanged revision rejects. Real upstream stale-version HTTP rejection causes zero effects and an unreplayable indeterminate outcome. |
| APPR-004 | Expired/revoked requests denied; both remain denied after reload. Successful receipt persists and consumed request cannot replay after reopening SQLite. |
| APPR-005 | Agent bearer, forged headers, wrong password, cross-origin request and reused/cross-action proof cannot approve. Privileged grant expansion requires fresh password. Real Chromium owner UI approves and explicitly executes once; password field clears. |
| APPR-006 | Revoked grant/stale revision prevents execution. Persistent Space pause removes a real Linux worker and its background descendant; new tasks deny. Global pause aborts held real HTTP transport; upstream request signal observes disconnect with zero effects. |
| UX-001 | Real Chromium creates three arbitrary agents and unrelated owner Spaces; saves stable-ID resource permissions and chooses default task Space. New tasks/routines bind that default; conversations reject a Space rewrite. |
| UX-002 | Real Chromium preview and simulator agree on deny precedence, including inherited wildcard Auto; exact Revoke remains denied. Existing expiry preserves exact timestamp. Agent/Space/global pause and scoped resume work; dialog fits 360-pixel viewport. |
| AUD-001 | Real permit/deny/approval/consume/execute events correlate task/agent/Space/resource/action. Synthetic credential is absent from HTTP audit and current SQLite WAL. Agent audit mutation rejects. |

Cumulative per-case mappings and actual statuses belong in the run's `coverage.json`, `results.json`, `case-results.json`, phase JUnit and `proof/<caseId>.json`. Child JUnit/log/exit records are under `phase4/`. Only disposable stores, profiles, repositories, containers, synthetic canaries and local services were used. No live owner database or company system was opened.

## Rollout, rollback and remaining limits

Safe migration creates a private WAL-complete `pre-approval-security-*/state.sqlite` backup before additive approval/settings/pause/preset tables. Existing grants/providers/chats/five-agent limit/Rooms/Workflows/Routines/Skills remain; names and providers confer no new privilege. New agent external access stays denied. Existing restricted Legacy remains compatible; assigning a new default Space is an explicit owner edit. Sandbox remains opt-in and missing infrastructure denies execution. Unsupported/browser-write operations remain unavailable.

Review first. Offline rollback: stop app/workers, disable newly configured action connectors, reconcile any external outcome, restore matching private pre-approval SQLite backup and broker key with the prior Phase 3 application. Earlier application denies high-impact actions. Never restore approval state to resume a consumed effect; restart interrupts jobs and a stopped task must not be automatically replayed. Protect historical backups as private owner data.

Workstation evidence uses macOS arm64, Bun 1.3.9, real Chromium and Docker Desktop's Linux arm64 VM. Worker probes verify actual UID 1000, seccomp, no-new-privileges, no capabilities, read-only root, cgroup limits, no host mounts/credentials and denied network; Phase 2 positive controls validate probes. Docker daemon is rootful inside the VM. Rootless Linux, whole-browser host containment, CI execution, vendor adapter behavior and a fully disposable release runner remain unverified. Known-string redaction cannot identify arbitrary transformed secrets. Aborting HTTP cannot undo an already committed external effect; reconcile indeterminate outcomes instead of replaying them.

Next: Phase 5 migration/wizard/recovery, three-Space real-runtime adversarial journeys, operational hardening and the mandatory release gate on a real disposable isolated runner. No production autonomy or release PASS follows from Phase 4 alone.
