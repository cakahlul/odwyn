# Phase 3 — PASS

Final frozen-source cumulative gate: **exit 0**, `artifacts/security/20261013T052038Z-23512/`. All **36/36 mandatory IDs** through Phase 3 executed PASS, with zero skips/missing cases. Phase 0: 7 tests; Phase 1: 17; Phase 2: 15; Phase 3: **21 tests/137 assertions**. BASE-003 also executes all **90 repository regressions across 28 files**, exit 0, zero failures/skips. This is Phase 3 acceptance, not a release verdict or completion of Phases 4–5.

## Files and behavior

- `security/data.js`: immutable SQL conversation/message/file classification; source-resource provenance, scoped notes, Room intersections and proposal digests; referenced workflow-output handoffs; owner-bounded fixed exports with changed-source/revocation checks; hashed expiring live-task HTTP tokens.
- `security/connectors.js`: reviewed document-read/Git manifests, encrypted principal-bound credentials and native provider keys, separate private broker key, pinned bounded MCP transport, current grant checks, secret redaction and artifact quarantine.
- `security/scoped-browser.js`, `browser.js`, `proxy.js`: separate immutable task/Space/resource browser profiles, credential-free environment, exact reviewed GET destinations, pinned resolver/proxy, context routing, service-worker/socket/download/script denial and in-flight identity checks. Agent visual exports deny because pixels cannot use string redaction; the existing owner browser remains available.
- `security/policy.js`, `store.js`: strict typed resource metadata, live membership versus historical SQL identity, policy revision invalidation, classified FTS filtering, atomic backed-up data migration, native key encryption/reload and removal of old plaintext from the current DB/WAL.
- `runtime.js`, `workflows.js`, `server.js`, `files.js`, `execution/sandbox.js`: mandatory disclosure/tool enforcement across provider input, returned output, Rooms, Workflows, Routines, retry, direct task HTTP and files. Provider item IDs cannot overwrite owner messages. New-Space file exports use actual isolated workspace bytes, bounded non-following reads and pre-write credential checks. Shared owner-browser files retain Legacy classification.
- `tests/security/phase3/acceptance.test.js`, `tests/security/coverage.json`, `docs/security/entry-points.json`: all eleven DATA IDs runnable, with ten supplementary regression probes, real Bun JUnit and aggregated per-ID structured PASS/FAIL/BLOCKED execution/proof. There are no `.skip` or `.todo` cases. All 55 registry IDs remain present; future phase requirements are unchanged.
- `test/home.test.js`, `test/rooms.test.js`, `test/runtime.test.js`, `test/files.test.js`: legacy fixtures explicitly bind task identities/file grants; file label assertions require no absolute host path. Existing UI, customization, provider, Room and workflow assertions are retained.
- `.github/workflows/security.yml`: lightweight PR fixtures explicitly exclude real Docker/browser Phase 3 cases; the separate release/merge job still requires all future phases on a disposable runner. CI is not claimed to have executed here.
- `PHASE3_PLAN.md`, `ADR-ACCESS-CONTROL.md`, `THREAT_MODEL.md`, `IMPLEMENTATION_PLAN.md`, this report: interfaces, enforcement decisions, threats, migration, evidence and rollback.

The supplied verifier remains unchanged: SHA-256 `cd4858b8ac4cd6f4b4c507ef90253f6edd936a0e75d8e08fcb2720e09c28b6c2`. Neither its guard nor the catalog was weakened. No new dependency was needed for this phase. Pre-existing workspace changes from earlier phases are retained.

## Commands and evidence

Final cumulative command:

```sh
ODWYN_SECURITY_ISOLATION_RUNNER=1 \
ODWYN_SECURITY_SANDBOX_IMAGE=sha256:b098e07c8d48bd4f997cb24bf106cd1fa9d8f1d2168c637f354aff680ead0b99 \
caffeinate -i bash scripts/security-gate.sh --phase 3
```

`caffeinate -i` only prevents idle sleep. Isolation comes from actual disposable Linux worker/kernel, Chromium storage/network and upstream side-effect probes, never this environment declaration.

Focused complete Phase 3 run before the visual/migration supplements: the same isolation/image variables plus `ODWYN_SECURITY_REPORT_DIR=artifacts/security/phase3-green bun test tests/security/phase3 --reporter=junit --reporter-outfile=artifacts/security/phase3-green/phase3.junit.xml`, exit 0, 19 tests/123 assertions. Focused diagnostic filters are not acceptance evidence; filtered tests are not used to satisfy the gate. Visual-output red/green and migration diagnostic JUnit are retained separately. `python3 scripts/verify-security-catalog.py --phase 3` maps 36/36 required IDs; mapping alone is not PASS. `git diff --check` exits 0.

Final artifacts include phase0–phase3 actual JUnit/logs, all regression JUnit/logs, `results.json`, `execution/<caseId>.json`, `proof/<caseId>.json`, catalog/verifier logs, environment/runner metadata and source hashes. Artifact paths are Git-ignored. Proof records contain counts/booleans and synthetic observations, not credentials. Original failed gates remain available. The exact PR-lightweight pattern in `.github/workflows/security.yml` also ran locally: exit 0, 14 tests and seven explicitly filtered cases; that separate diagnostic report is not acceptance evidence. Supplied JUnit verification reruns after removing only host-identifying artifact metadata; test names, outcomes and observations are preserved.

Sanitized observations: Darwin/arm64 controller; Docker Desktop Linux aarch64 VM; immutable reviewed worker Bun 1.4.2/Git 2.47.3, non-root UID 1000, seccomp mode 2, NoNewPrivs 1, CapEff 0, read-only root, no host mounts/network/routes and working CPU/memory/PID limits. Phase 2 reexecutes its actual host-secret, egress, cgroup, dependency and whole-process cancellation probes in this cumulative run. Phase 3 exports real worker bytes and denies a real symlink. Native Playwright Chromium proves three distinct profiles, real cookies/localStorage and zero forbidden upstream requests; in-flight task changes deny returned context. This does not prove a VM boundary for the entire browser process.

Local MCP uses the actual SDK client/server and a synthetic bearer-authenticated HTTP sink. Its only accepted call is the exact owner-selected document read; unknown/native/write/disabled routes produce zero unauthorized calls. Fake Git uses real Git smart HTTP/remote refs and the encrypted broker token; disabling that connection produces no additional upstream requests or mutations. No installed report connector or production service was contacted.

## Mandatory DATA coverage

| ID | Executed observations required for PASS |
| --- | --- |
| DATA-001 | Actual three-profile Chromium cookie/storage positive control; independent task/Space state; three permitted reads and zero forbidden requests; credential text redacted and visual export denied. |
| DATA-002 | Actual SDK document read succeeds once; fake write, foreign ID, native tool and disabled connection deny; exact upstream call list verified. |
| DATA-003 | Actual upstream credential echo is redacted before provider/events; SQLite ciphertext contains no raw key; native provider keys reload unchanged; real encrypted Git push changes only the allowed branch, then disable stops calls; secret-bearing artifact is not written; legacy migration preserves chat and lost key fails closed. |
| DATA-004 | Foreign file IDs/attachments/traversal deny; explicit owner same-Space attachment succeeds; real isolated worker export succeeds, symlink/shared-host paths deny; shared owner-browser download remains Legacy and cannot attach to an unrelated task. |
| DATA-005 | Actual FTS own-canary positive control and zero foreign-canary matches; global preferences remain unchanged; only selected read-granted notes enter actual provider input, with Room intersection/revocation enforced. |
| DATA-006 | Actual Room provider context excludes restricted transcript and proposal; non-overlapping grants cannot union; provider item-ID collision cannot overwrite/reclassify owner content. |
| DATA-007 | Actual next workflow step uses its configured agent/Space; revoked or unshared source cannot transfer; an explicit bounded export works across Spaces without raw foreign output in provider context. |
| DATA-008 | Scheduled/retried tasks retain their original Space and use current grants; changed owner profile gives no privilege; task context substitution denies. |
| DATA-009 | Actual HTTP bearer requests deny foreign file/history, search and owner state; own scoped history succeeds; completed-task token stops working. |
| DATA-010 | Only owner-selected named summary field is shared; private field omitted; changed source/revocation invalidates export and later derived recall. |
| DATA-011 | Actual browser remains task/Space-bound across active-principal switch; forged context and delayed in-flight result deny; new task inherits no cookies/profile. |

BASE-001–003, AUTH-001–012 and EXEC-001–010 also reexecute in the same gate; their detailed enforcement contracts are in PHASE0/1/2 reports. The final results file must show all 36 mandatory IDs, no skips and no missing proof. Policy-unit tests alone cannot provide this verdict.

## Retained failures and fixes

Initial eleven-case run: ten failures, one pass, exit 1. No absent gateway or policy-only denial was relabelled isolation PASS. Subsequent red probes reproduced provider message-ID overwrite, read-only memory denial, plaintext native keys, unavailable encrypted Git brokerage, credential artifact export, overly restrictive bounded-export workflows, shared owner-browser attribution and credential screenshots. The shared enforcement/storage layer fixes each cause; supplementary tests retain their assertions.

The encrypted Git positive-control fixture initially forgot to create its requested branch; explicitly creating that synthetic branch fixes the fixture without changing policy. The first legacy migration probe incorrectly expected a `grants` field from the visible-resource API; it now checks the authoritative access API. These diagnostic failures are not product-security PASS evidence.

Gate `20261013T043720Z-12881` exited 2: BASE-003 failed because the Home fixture manually injected a task without its new mandatory SQL context. Bind the disposable Legacy task explicitly. Gate `20261013T045415Z-16249` exited 2: unchanged Appearance and Mention UI tests timed out under local load. Each original file subsequently passed unchanged in an isolated diagnostic process; test timeouts/assertions were not weakened. Intermediate cumulative `20261013T051703Z-21080` exited 0 with all 90 regressions and 20 Phase 3 tests, before adding the final migration supplement; the frozen rerun is the authoritative final evidence.

## Rollout, rollback and limits

No live owner database, company system, paid operation, merge or deployment was touched. All fixtures use disposable stores, containers, profiles, repositories and network sinks. No broad installed MCP credentials were reused. Available low-risk capabilities still require explicit owner resource grants; names/providers/prompts confer no authority. High-impact/unknown operations and `ask` remain non-executable until strong Phase 4 approvals exist.

Migration creates private WAL-complete pre-data SQLite backups, adds normalized tables atomically, preserves provider behavior and old chat/file IDs, and classifies unlabeled historical data as Legacy Workspace. Current DB/WAL native keys become encrypted; historical rollback copies may retain pre-migration plaintext and require private offline protection. Back up `broker.key` separately with matching encrypted DB; losing it fails closed. Provider-managed OAuth files stay outside workers; their host storage remains Phase 5 hardening work.

Rollback offline: revoke new integration/data grants, stop the app and active workers/profiles, restore the private pre-data backup with its matching earlier application, and handle WAL/SHM safely. Do not discard saved owner data or the matching key. An earlier application can restore earlier behavior, including its historical weaker boundaries; keep it offline during recovery.

Remaining unverified: CI, rootless Linux, live provider authentication, arbitrary installed connectors, whole-browser-process VM containment and the Phase 5 disposable release gate. Only reviewed read-document/Git integrations and exact read-only browser pages are supported; browser scripts, UI writes, uploads/downloads and visual export deny. String matching cannot prove redaction of every arbitrary credential transformation. Host broker/controller or shared Linux-kernel compromise remains a residual risk. Phase 4 implements owner UX and action-bound approvals; Phase 5 must resolve release hardening and migration validation. No release PASS is claimed.

No remaining Phase 0–3 mandatory case is blocked. Next phase: APPR-001–006, UX-001–002 and AUD-001, test-first, without using legacy `Always approve` to authorize high-impact actions.
