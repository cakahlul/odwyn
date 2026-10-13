# Phase 5 — BLOCKED, implementation incomplete

Historical pre-remediation cumulative run: `artifacts/security/20261013T081606Z-67946/`, **exit 2**. All **55/55 mandatory IDs executed**: **54 PASS, E2E-001 BLOCKED**, zero missing or skipped. Bun reports the blocked case as a failed testcase; structured proof/execution and the failure report preserve BLOCKED. The unchanged supplied verifier correctly rejects it. Phase 5 is not complete and no security release is approved.

Phases 0/1/2/3/4 passed **7/17/15/21/22** real suites/cases. Phase 5 executed all **10** real child cases: nine PASS, one BLOCKED, **176 child assertions**. BASE-003 and REG-001 each executed the existing **90 regressions across 28 files**, with real per-file JUnit and zero failures/skips. Existing UI, customization, providers, five-agent creation, Rooms, Workflows, Routines, Skills and saved-data behavior remain exercised subject to safe authorization restrictions.

## Files and behavior

- `security/migration.js`, `store.js`, `security/policy.js`: private WAL-consistent database backups plus `.env`/`broker.key` when present; additive persisted upgrade review; sanitized preserved-record report; no imported resource grants. Existing migration transactions recover idempotently after actual process interruption.
- `server.js`, `public/security-ui.js`: owner-only migration GET/POST, upgrade checklist inside existing Access & Autonomy editor, acknowledgement grants nothing; connector disconnect returns and displays an owner alert and updates state.
- `security/connectors.js`, `security/policy.js`: connector-disable audit and revision change are atomic. Held MCP results are discarded after grant revocation/disconnect; subsequent credential brokerage is denied. Default native agent browser capabilities now fail closed because whole browser host-process containment is unavailable. Test fixtures explicitly enable native profile probes; production has no browser-enable environment flag.
- `scripts/security-migration.js`: read-only dry-run migrates a private disposable snapshot and emits counts/restrictions; never modifies the owner source, contacts providers or grants access. `scripts/security-regression.js` reuses actual fresh-process regression execution/JUnit for the release step, avoiding the reproduced Bun/macOS guarded-FD issue without removing tests.
- `tests/security/phase5/{acceptance.test.js,cases.js,fixture.js,process-child.js}`: all ten mandatory real cases, disposable SQL/services/browser/OS workers; actual SIGKILL barriers; real child Bun JUnit and proof/execution per ID. `tests/security/coverage.json` maps all 55 IDs. `tests/security/phase3/acceptance.test.js` explicitly enables its disposable browser adapter only.
- `scripts/security-gate.sh`: retains cumulative execution, supplied catalog/results guards and required proof; adds Linux release preflight and actual fresh-process regression runner. `scripts/security-report.py` can classify partially executed unavailable-boundary cases as BLOCKED; it never authorizes PASS or changes the supplied verifier.
- `.github/workflows/security.yml`: PR migration/recovery/outage fixtures; release/merge still requires a provisioned disposable runner and full gate, now with Chromium installation. CI was not executed.
- `entry-points.json`, `INVENTORY.md`, `PHASE5_PLAN.md`, `OPERATIONS.md`, `THREAT_MODEL.md`, `ADR-ACCESS-CONTROL.md`, `IMPLEMENTATION_PLAN.md`, this report: new owner endpoints, threats, setup, migration/rollback and incomplete release boundary. Pre-existing workspace changes remain intact. No dependencies, merge, deployment, live MCP/company service, paid operation or VPS access were added.

## Per-case evidence

All rows map to actual Bun child execution in `phase5/<index>.xml` and `.execution.json`, plus `proof/<ID>.json` and `execution/<ID>.json`.

| ID | Outcome | Actual evidence |
|---|---|---|
| MIG-001 | PASS | Five arbitrary legacy agents, chats and routines preserved; 15 actual privileged tool attempts denied despite legacy allow; imported workflow retained, running workflow/job interrupted; five chat-provider starts; real Chromium upgrade UI; acknowledgement creates no grants. |
| MIG-002 | PASS | Read-only dry-run source DB hash unchanged; real SIGKILL inside SQLite schema transaction; partial schema uncommitted; actual pre-security backup restored; synthetic `.env` backed up; restart/remigration idempotent with zero privileged grants. |
| REG-001 | PASS | All 90 existing tests/28 files, genuine JUnit; UI/browser smoke and installed-dependency imports; zero failures/skips. |
| E2E-001 | **BLOCKED** | Three unrelated named agents/Spaces complete low-risk work; independent fake-provider switching; real MCP/browser read and terminal worker; routine binding, forbidden workflow handoff/Room union, three explicitly reviewed public Room turns. Actual Chromium PID and OS UID show shared controller principal. Whole-process containment cannot be claimed. |
| E2E-002 | PASS | Actual Linux worker escaped-host-path reads fail; reachable sink positive control, zero exfil calls; real permitted Git push produces two upstream requests; protected main push makes zero additional calls and leaves refs unchanged; no host mounts, non-root, network none. |
| ATTACK-001 | PASS | Injection text from actual HTML, MCP issue, sandbox README and terminal output; deterministic instruction-following attempts reach real dispatch; forbidden self-escalation/host/payment/routine attempts produce no effects or grant changes. No live model service used. |
| ATTACK-002 | PASS | Forged owner approval from real MCP and sandbox README; forged/pending approval IDs and task HTTP authority denied; zero action-service effects. |
| REC-001 | PASS | Actual controller process SIGKILL after fake upstream HTTP effect commits and before receipt; durable consumed status/no receipt and exact idempotency key/digest; restart interrupts job; replay and task retry cannot invoke another effect; audit binding retained. |
| OPS-001 | PASS | Actual MCP read held during grant revocation and connection disable; private response discarded, no followup upstream read; owner alert and correlated disable audit. |
| OPS-002 | PASS | Real app startup with unavailable worker configuration; closed/corrupt policy DB; no host-shell or broad MCP fallback; planted host canary undisclosed; granted uncontained browser remains denied and never starts. |

## Exact verification commands and exits

```sh
ODWYN_SECURITY_ISOLATION_RUNNER=1 \
ODWYN_SECURITY_SANDBOX_IMAGE=sha256:b098e07c8d48bd4f997cb24bf106cd1fa9d8f1d2168c637f354aff680ead0b99 \
caffeinate -i bash scripts/security-gate.sh --phase 5
# exit 2; artifacts/security/20261013T081606Z-67946/

ODWYN_SECURITY_ISOLATION_RUNNER=1 bash scripts/security-gate.sh --release
# exit 2; artifacts/security/20261013T081220Z-64702/
# preflight: disposable Linux runner required; workstation Docker workers insufficient

python3 scripts/verify-security-catalog.py --phase 5
# exit 0; all 55 mandatory IDs mapped, not a test PASS

python3 scripts/verify-security-results.py \
  --catalog docs/security/SECURITY_ACCEPTANCE_CASES.json \
  --phase 5 --artifacts artifacts/security/20261013T081606Z-67946
# exit 2; E2E-001 not PASS; repeated after hostname-only JUnit sanitation

bash -n scripts/security-gate.sh
# exit 0
git diff --check
# exit 0
bun build scripts/security-migration.js scripts/security-regression.js \
  --target=bun --outdir=/tmp/odwyn-phase5-script-check
# exit 0
```

The gate invokes `bun test tests/security/phaseN --reporter=junit --reporter-outfile=<run>/phaseN.junit.xml` for every phase 0..5. Phase 5 child processes run `bun test ./tests/security/phase5/cases.js --reporter=junit --reporter-outfile=<run>/phase5/<index>.xml`, exactly one assigned case each: index 3 exits 1/BLOCKED; the other nine exit 0. Every original regression file runs in a separate real Bun process with JUnit; there is no filtered or skipped regression.

Red/focused artifacts retain missing upgrade route (404), missing disconnect audit/alert, initially unsafe browser availability, actual rollback/recovery and final OS probes. First exploratory gate `20261013T080438Z-59856` is invalid: inventory was stale and editing the runner while Bash was still reading it caused a parse failure. That mistake was corrected by completing the runner before subsequent launches. Gate `20261013T081234Z-64770` also correctly blocks E2E-001. The latest gate above is authoritative for final cases. Production code stayed unchanged during it; the Phase 5 Git probe was strengthened before Phase 5 began. `source-hashes.json`, `source-hashes-final.json` and `source-freeze-note.json` document that timing transparently. `final-checks.json` confirms complete execution and unchanged JUnit outcomes after removing hostnames only.

Verifier SHA-256 remains `cd4858b8ac4cd6f4b4c507ef90253f6edd936a0e75d8e08fcb2720e09c28b6c2`. The catalog was not reduced; no guard, proof requirement or mandatory case was removed to obtain a green result.

## OS/upstream facts, prevented vulnerabilities and limits

Local controller: macOS arm64, Bun 1.3.9, Docker Desktop Linux VM/cgroup v2. Actual worker probes report UID 1000, read-only root, no host binds/sockets or credential environment, network none, seccomp mode 2, no-new-privileges and zero effective capabilities. Safe network sink positive controls are reachable, while worker exfil reaches zero calls. Git protected refs remain unchanged; fake MCP/action services verify actual transport and side effects. These facts do not establish rootless Linux deployment or containment of the entire local controller.

Prevents silent migration privilege inflation, host-shell fallback, forged tool-output approvals, replay after ambiguous committed actions, stale MCP disclosure and tested OS/network/Git escapes. Native agent browser autonomy is now unavailable by default rather than enabled with an unproven host boundary.

Remaining blockers: isolated browser execution backend plus real filesystem/network/token probes; actual disposable Linux controller runner with reviewed rootless backend; successful full release/merge hard gate and CI evidence. Native profile tests establish cookies/proxy scoping only. No serious-browser-gap waiver or production PASS is claimed.

Rollout remains safe restriction and owner review only. No live migration/rollout occurred. Offline rollback restores compatible DB/env/key backup to a fresh private directory after stopping the controller/workers, without stale WAL/SHM; the actual pre-security DB restore/remigration was tested. Restoring an older binary does not restore security: keep autonomy disabled. See `OPERATIONS.md` for the owner procedure.

Next safe step: implement contained browser execution and its genuine OS probes, provision a disposable Linux runner, rerun phase 5 then the release gate. Do not use the deployment VPS as the disposable test runner or deploy this work as completed hardening.
