# Implementation and verification plan

No deployment, merge, paid action or live service access is authorized. No new dependencies in Phase 0.

| Phase | Test-first scope and changed boundaries | Completion condition |
| --- | --- | --- |
| 0 | BASE-001 inventory, BASE-002 executable exposure/denial probes, BASE-003 existing regression/UI/dependencies; docs, inert context, gate, evidence and CI | All three mandatory cases actually executed; honest baseline evidence; no skipped/inconclusive regression |
| 1 | AUTH-001–012; SQLite Spaces/grants/revisions, capability registry, simulate, immutable identity, shared enforcement across native/provider/workflow/admin boundaries | Denied requests have zero side effects; unsafe shell/MCP routes blocked pending gateway |
| 2 | EXEC-001–010; real Linux isolation, egress sink, budgets/process-tree cancellation, fake Git remote/broker | Real OS/network probes pass; no host fallback or raw credentials |
| 3 | DATA-001–011; broker/MCP manifest, real browser contexts, classified files/FTS/memory/history and Room/workflow/routine/recovery disclosure | Cross-Space canaries and tokens never enter unauthorized outputs/sinks |
| 4 | APPR-001–006, UX-001–002, AUD-001; arbitrary-agent UI, policy preview, owner-bound approval/audit/pause | Replay, target change, stale policy and forged owner authority blocked upstream |
| 5 | MIG-001–002, REG-001, E2E-001–002, ATTACK-001–002, REC-001, OPS-001–002; transactional migration/rollback, all-channel E2E, outages/recovery | Full release gate on real disposable isolation runner and existing regression; separate owner production review |

Coverage now maps all 55 stable IDs to real runnable suites. Mapping is not execution proof: Phase 5 E2E-001 remains BLOCKED on browser host containment. Missing, skipped or blocked mandatory cases fail the gate; no placeholder passing cases are used.

## Phase 0 verification

Run `bash scripts/security-gate.sh --phase 0`. Each run has fresh JUnit, sanitized logs, structured proof and machine-readable case statuses under ignored `artifacts/security/`. Run the separate red denial suite with `bun test tests/security/negative --reporter=junit --reporter-outfile=<report>/negative.junit.xml`; Phase 0 failures originally reproduced gaps. Phase 1 now denies these dispatch paths, and the four checks pass; this does not establish OS isolation. Bare combined `bun test` remains unverified after the macOS guarded-FD crash; the cumulative gate executes every repository test in separate real Bun processes. Phase 1 regressions now retain chat/provider/Room/Workflow behavior while asserting dispatch denial for unavailable privileged executors and explicit owner grants for supported file export.

`BASE-003` discovers every repository test file and runs each in a fresh credential-free Bun process, retaining and merging real JUnit. This avoids Bun 1.3.9 macOS guarded-file-descriptor crashes in combined runs. Every test runs with disposable app configuration, including real browser/UI tests and local fake MCP; installed dependencies are also imported and checked. Timeout, incomplete JUnit, skips or process kill blocks the phase. Live authenticated `check:codex` and public-network `check:browser` scripts are not safe baseline substitutes; equivalent existing Chromium tests run against fixtures. Initial pre-runtime-change regression exit and logs are retained separately.

No production data migration in Phase 0. Rollout is review of documentation/testing only. Rollback removes added inert module and test/gate/CI files; no saved data restoration needed. Next phase starts only after a genuine Phase 0 PASS; otherwise repair baseline execution without widening permissions.

## Phase 1 completion

`bash scripts/security-gate.sh --phase 1` exited 0; `artifacts/security/20261013T005358Z-75186/` contains actual PASS executions for BASE-001–003 and AUTH-001–012, required proofs and 90 passing regressions with zero skips across 28 files. The existing final provider-settings UI test now runs in a separate file/process to avoid reproduced macOS guarded-FD reuse; all seven original provider-settings tests and assertions remain. See PHASE1_REPORT.md for changed files, commands, retained failures, effect counters and rollback. Next: Phase 2 EXEC tests and real disposable OS/network isolation; no release or unrestricted autonomy follows from Phase 1 PASS.

## Phase 2 initial attempt — historical environment block

Test-first EXEC-001–010 live in `tests/security/phase2/acceptance.test.js`; fixture preflight, synthetic canaries, real Git HTTP fixture and proof records are in `fixture.js`. `fail-closed.test.js` verifies actual disabled-terminal dispatch without host effects. All 55 manifest IDs remain mapped; 25 required Phase 0–2 IDs now point to executable tests. Current Phase 2 cases stop at unsupported macOS/no disposable Linux runner; none is skipped or claimed PASS. Linux probe bodies and Git integration remain unexecuted and need validation with implementation on the approved runner.

Next: provide a disposable Linux runner with rootless Docker, cgroup v2/systemd and delegated CPU/memory/PID controllers; inspect it and select a pinned reviewed Bun/Git image. Implement the isolated runtime pathway and scoped snapshot/patch/Git broker while the production capability stays disabled. Run all real probes, then the cumulative Phase 2 gate. Do not proceed to Phase 3 before a genuine Phase 2 PASS. See PHASE2_REPORT.md for evidence and blocked work.

## Phase 2 retry implementation

Owner-started Docker enables real disposable Linux workers in Docker Desktop's VM. Implemented immutable-image opt-in configuration, descriptor-relative bounded snapshots, non-root/seccomp/no-new-privileges/cgroup health checks, no network/host binds, whole-worker cancellation and finish cleanup, bounded exact-workspace patch export, and scoped Git packet brokerage. Added atomic backed-up grant-constraint migration and intersection/expiry handling. All EXEC-001–010 remain substantive OS/upstream tests, with actual JUnit and structured execution/proof records; supplementary tests cover default denial, snapshot safety, migration, constraint intersection and worker teardown. See PHASE2_REPORT.md for the final gate status and retained failed attempts.

Next dependency: only a genuine cumulative Phase 2 PASS permits Phase 3 connector/data/browser implementation. Do not run a release gate or enable browser, sharing, payment, merge or deployment capabilities from this phase. CI builds a reviewed worker image and supplies its immutable ID to the disposable-runner release hard gate; missing future suites or proof still block release.

Final cumulative Phase 2 gate: `artifacts/security/20261013T024903Z-1267/`, exit 0; all 25 mandatory IDs, 7/17/15 phase tests and 90 repository regressions PASS with zero skips. Final review added secret-free command/usage auditing and a real two-execution cancellation regression: all in-flight terminal/Git transports now abort together. See PHASE2_REPORT.md for retained failed attempts, per-case evidence and rollback. Phase 3 is next; release remains blocked.

## Phase 3 completion

Final frozen-source cumulative gate `artifacts/security/20261013T052038Z-23512/` exits 0: all 36 required BASE/AUTH/EXEC/DATA IDs PASS, phase tests 7/17/15/21, all 90 repository regressions PASS, zero skips/missing cases. Implemented normalized classification/provenance, scoped notes and derived handoffs, bounded exports, encrypted reviewed MCP/Git/native provider keys, real task-bound browser profiles/read-network controls, isolated file bytes and task HTTP enforcement. See PHASE3_PLAN.md for interfaces/test-first sequence and PHASE3_REPORT.md for retained failures, actual proof, limits and rollback.

Next: Phase 4 action-bound owner approvals, Access & Autonomy UI, simulator, audit and emergency pause. Unsupported/high-impact actions remain denied. No release, deployment, paid operation or production-connector access follows from the Phase 3 verdict. Whole-browser host containment, rootless Linux/CI and full migration/release checks remain unverified for Phase 5.

## Phase 4 completion

Frozen-code cumulative gate `artifacts/security/20261013T072830Z-50439/` exited 0: all 45 mandatory IDs through Phase 4, 7/17/15/21/22 phase cases, and all 90 repository regressions PASS with zero skips. Approvals and owner Access & Autonomy, task Space selection, audit and persistent emergency pause are implemented. Phase 4 uses genuine fresh-process Bun child executions to avoid reproduced native macOS EXC_GUARD while retaining every case, JUnit and side-effect proof. Original mobile layout regressions detected picker overflow and passed unchanged after the focused fix. See PHASE4_REPORT.md and PHASE4_API.md for files, exact commands, proof, migrations and rollback.

Next: Phase 5 owner migration wizard, recovery/adversarial multi-Space journeys, operational hardening and the real disposable-runner release gate. No CI, release, deployment, paid action or production connection was authorized or executed. Whole-browser host containment, rootless Linux and vendor adapter behavior remain unverified.

## Phase 5 implementation and remaining gate

See `PHASE5_PLAN.md` for the ten test-first cases and `OPERATIONS.md` for deployment boundaries, safe upgrade, dry-run and offline rollback. Migration uses the existing owner Access editor; review acknowledgement grants nothing. Centralized private backups include env/key files when present. Actual process kills test SQLite migration rollback and post-upstream/pre-receipt approval recovery. Held MCP revocation discards results, blocks subsequent calls and emits owner alert plus audit. Attack cases consume real local HTML/MCP/README/terminal outputs and deterministically attempt denied actions.

Native Chromium shares controller OS authority. Production agent browser capabilities therefore default unavailable; disposable profile fixtures explicitly enable their limited probes without claiming release containment. A true isolated browser execution backend and its OS/network probes remain required. The disposable Linux release runner is also unavailable in this session; the owner's live VPS is not an authorized test fixture. No production rollout or security release is claimed. Cumulative Phase 5 results and exact exit/status evidence appear in `PHASE5_REPORT.md` once verification finishes.

Phase 5 browser correction: tests first required actual container Chromium and host/sink denials. Replace the native scoped adapter; reuse kernel provisioning, DOM snapshot output, existing Playwright and trusted runtime configuration. Preserve session cookies/localStorage within each task/resource and remove workers on stop. Add immutable browser image build and strict context allowlist, real worker fixture driver, broker redirect/type/size/egress negatives, coverage and CI image configuration. Cumulative Phase 5 and separate disposable Linux release gate remain the acceptance criteria.
