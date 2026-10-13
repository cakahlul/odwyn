# Phase 2 — PASS

Cumulative gate: **exit 0**, 25/25 mandatory BASE/AUTH/EXEC IDs through Phase 2 executed PASS; zero skips or missing cases. Phase 0: 7 tests; Phase 1: 17 tests; Phase 2: 15 tests. BASE-003 also executes all 90 repository regressions across 28 files, including actual Chromium and local MCP smoke tests. This is Phase 2 acceptance, not a release verdict or completion of Phases 3–5.

## Implementation and changed files

- `execution/Dockerfile`, `sandbox.js`, `snapshot.py`, `README.md`: reviewed base digest and immutable worker ID; task-bound non-root Linux containers; descriptor-relative, non-following snapshots bounded by bytes/entries/depth; no network/host binds/credentials; kernel seccomp, no-new-privileges, capabilities and cgroup checks; bounded commands/output; whole-worker timeout/cancellation and completion/shutdown removal; exact-workspace patch export.
- `security/git-gateway.js`: resource-scoped smart Git transport outside workers, pinned upstream resolution, bounded requests/packs, scoped credential callback, intersected branch prefixes, protected-ref/CI guards, history/fast-forward validation and verified receive-pack receipts. Repository Git parsing stays inside workers; no production host Git subprocess.
- `security/policy.js`: opt-in server capability availability, backed-up atomic constraints migration, expiry/intersection handling, namespace-denial audit and secret-free command-digest/elapsed-time/output-byte/exit-status audits. Default configuration stays disabled; legacy interaction modes confer no privilege.
- `runtime.js`, `server.js`: shared policy-enforced tool dispatch, pinned-image/snapshot configuration, Git and patch tools, all in-flight terminal/Git abort handles tracked, browser interruption before awaited worker removal, task-finish and awaited shutdown cleanup. No host fallback.
- `tests/security/phase2/acceptance.test.js`, `fixture.js`, `fail-closed.test.js`, `infrastructure.test.js`: real disposable workers, synthetic canaries, authenticated fake Git using git HTTP backend, positive-controlled network sink, actual kernel/upstream assertions, actual Bun JUnit and per-ID execution/proof. Supplementary snapshot/migration/constraint/lifecycle tests.
- `tests/security/coverage.json`, `docs/security/entry-points.json`: ten EXEC IDs mapped, complete tool inventory; all 55 registry IDs preserved, future phases still require implementation.
- `.github/workflows/security.yml`: PR default-denial check; disposable release job builds the reviewed worker and supplies its immutable ID. No CI execution claimed. Release/merge gate remains blocked until future phases exist and pass.
- `ADR-ACCESS-CONTROL.md`, `THREAT_MODEL.md`, `IMPLEMENTATION_PLAN.md`, this report: supported backend, historical blockers, boundaries, migration and rollout.

The supplied result verifier remains unchanged: SHA-256 `cd4858b8ac4cd6f4b4c507ef90253f6edd936a0e75d8e08fcb2720e09c28b6c2`. The catalog and required IDs were not weakened.

## Exact successful gate

```sh
ODWYN_SECURITY_ISOLATION_RUNNER=1 \
ODWYN_SECURITY_SANDBOX_IMAGE=sha256:b098e07c8d48bd4f997cb24bf106cd1fa9d8f1d2168c637f354aff680ead0b99 \
caffeinate -i bash scripts/security-gate.sh --phase 2
```

`caffeinate -i` inhibits workstation idle sleep during the same gate; it provides no isolation or authorization. The declaration alone never passes: worker/kernel probes, real upstream effects and the unchanged JUnit verifier are mandatory.

Final evidence: `artifacts/security/20261013T024903Z-1267/`: `phase0.junit.xml`–`phase2.junit.xml`, regression JUnit/logs, `results.json`, `execution/<caseId>.json`, `proof/<caseId>.json`, `runner.json`, source hashes, catalog/verifier logs and environment report. `results.json` shows PASS; the gate `report.md` records exit 0. Git ignores artifacts. Proof contains synthetic observations, not token values; command audits contain hashes and measured wall time/output volume rather than secret-bearing literals or stdout.

Sanitized OS observations: Darwin/arm64 controller; Docker Desktop Linux aarch64 VM, Docker 20.10.23, cgroup v2/cgroupfs, default seccomp. Actual worker: UID 1000, seccomp mode 2, NoNewPrivs 1, CapEff 0, read-only root, no binds, network none/no kernel routes. Actual limits: 134217728 memory bytes without extra swap, 64 PIDs, CPU `100000 100000`; real OOM, fork rejection and timeout observed. Worker Bun 1.4.2, Git 2.47.3. Runner-info and isolated-version commands exited 0. Synthetic Git requires a bearer canary only in the server broker, and actual remote refs verify writes/denials. Sink reachability is proven from the controller before counters reset; forbidden worker requests produce zero sink calls.

## Per-case coverage

| ID | PASS evidence |
| --- | --- |
| EXEC-001 | Six planted host-only secret paths inaccessible; no canary in output/job/export; command digest and usage audited without literals. |
| EXEC-002 | Host/adjacent-Space traversal, symlink and procfs attempts denied by actual OS boundary. |
| EXEC-003 | Real fetch cannot reach the positive-controlled sink; zero sink calls, no kernel routes, egress-denial audit. |
| EXEC-004 | Host sink, IPv4/IPv6 loopback, metadata and internal-address requests cannot succeed. |
| EXEC-005 | Actual kernel limits, busy-command timeout, kernel OOM kill and fork exhaustion rejection; control plane remains alive. |
| EXEC-006 | Child/grandchild and two parallel executions observed, both transports cancelled, whole worker stopped, future dispatch denied; no worker credentials issued. |
| EXEC-007 | Actual authorized agent branch created at fake remote; no worker token; bounded patch export succeeds and a separately granted workspace cannot substitute. |
| EXEC-008 | Main/tag/unrelated/release/CI requests denied before upstream calls; actual remote refs unchanged. |
| EXEC-009 | Offline dependency installation really executes postinstall; marker proves execution and denied network sink receives nothing. |
| EXEC-010 | Container sockets, credential environment and host fake keys absent/inaccessible. |

Every case has a positive worker execution control and kernel security assertions. Supplementary tests cover no-executor denial in all interaction modes, source symlink/credential/config rejection, backed-up constraints migration, tightest grant intersection/expiry and actual worker disposal on task completion/shutdown.

## Retained failures and corrections

Initial Phase 2 gate `20261013T010634Z-78292` exited 2/BLOCKED before OS probes when Docker was unavailable. No absence of effects was called isolation proof. Owner-started Docker permits a supported Linux VM; rootless remains preferred rather than a newly invented mandatory host-OS condition.

Retry `20261013T012811Z-84870` exited 2: browser interruption regression from awaiting worker cleanup first. Restore immediate interruption before awaiting removal; focused regression checks exit 0. Retry `20261013T013134Z-87002` exited 2: BASE-003 timed out with incomplete regressions; retained, never substituted for PASS. Fresh browser retry passed and idle-sleep inhibition was used thereafter.

Retry `20261013T023348Z-91013` exited 2: the 3-second Docker transport deadline expired in the memory probe. Use a bounded 10-second deadline while still rejecting timeout and requiring actual kernel OOM evidence. Retry `20261013T023715Z-93121` exited 1 despite 25 mandatory IDs PASS: a supplementary migration assertion found fresh stores making two unordered backups. Create the constraints column in the initial transaction; only existing schemas require the separately backed-up ALTER. Migration-focused checks exit 0. `20261013T024025Z-95234` passed before final audit/cancellation review; `20261013T024532Z-98570` passed with the new audit but before the stronger parallel-cancellation test.

Focused `phase2-parallel-red` exited 1: two parallel calls exposed an overwritten abort handle; first transport did not report cancellation. Track all in-flight controllers, abort them on cancellation/finish/shutdown, and remove them on completion. `phase2-parallel-green` exited 0 with both actual transports cancelled. An earlier exploratory Bun-spawn exhaustion probe timed out rather than exiting cleanly; the corrected shell exhaustion fixture requires actual kernel fork rejection and safe termination. No required ID/assertion was removed or replaced with mock policy results. Filtered diagnostic runs are not used as acceptance evidence; final gate runs all cases without filtering.

`git diff --check` exits 0. Verifier and catalog invariants remain intact.

## Rollout, rollback and remaining limits

No live company system, installed report connector, saved owner database, production browser, paid operation, merge or deployment was touched. Tests create and remove disposable app stores, containers, repositories and sinks. The reviewed worker image remains available locally; no server configuration was enabled automatically.

Opt in only with the reviewed immutable image ID, owner-controlled scoped snapshots and explicit resource grants. Push grants require constrained branch prefixes. Grant defaults remain empty; imported grants gain `{}` without new privileges. Unconfigured/unhealthy backends fail closed. See `execution/README.md` for commands and filesystem layout.

Rollback: revoke execution/push grants, unset the sandbox image/snapshot variables and restart. Keep saved data; restore the private pre-ALTER SQLite backup only offline with its matching pre-migration application, handling WAL/SHM safely. Existing chats, five-agent creation, customization, provider configuration, Rooms, Workflows, Routines, Skills and saved data retain the regression baseline subject to denied unsupported operations.

No remaining Phase 0–2 mandatory case is blocked. Rootless Linux and CI are unexecuted here. Docker Desktop's daemon is rootful inside its VM; workers share that Linux kernel, so container/runtime kernel escape remains a residual risk. Optional draft PRs and live authenticated Git credential integration remain unavailable. Browser/connector/data-sharing isolation, strong approvals and full migration/release validation are Phases 3–5; release remains blocked. Next: Phase 3, without enabling unavailable capabilities or treating this gate as permission to deploy.
