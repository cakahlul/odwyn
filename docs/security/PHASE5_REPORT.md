# Phase 5 — local PASS; release BLOCKED

Latest owner-setup follow-up: [SETUP_REPORT.md](SETUP_REPORT.md), cumulative gate `20261013T115629Z-17335` **PASS / exit 0**, 55/55 mandatory IDs and 99/99 regressions in both runs. Release `20261013T120544Z-20149` remains **BLOCKED / exit 2**. The browser-remediation evidence below predates that follow-up.

The cumulative Phase 0–5 gate genuinely passed: **55/55 required manifest IDs**, zero missing, failed or skipped cases. Actual Bun JUnit contains 93 primary tests (phase counts 7/17/15/22/22/10); Phase 5 child executions contain 198 assertions. Repository regression runs passed all 90 tests across 28 files in both BASE-003 and REG-001. This establishes the local phase result; it does not establish the Linux release result.

## Commands and retained evidence

```sh
ODWYN_SECURITY_ISOLATION_RUNNER=1 \
ODWYN_SECURITY_SANDBOX_IMAGE=sha256:b098e07c8d48bd4f997cb24bf106cd1fa9d8f1d2168c637f354aff680ead0b99 \
ODWYN_SECURITY_BROWSER_IMAGE=sha256:8d5363e8959833d042153947a4973f0891a8ed48909462eb0cc4b26bec6af876 \
caffeinate -i bash scripts/security-gate.sh --phase 5
```

Exit **0**, evidence `artifacts/security/20261013T090729Z-84121/`: actual `phase*.junit.xml`, child JUnit, `results.json`, `execution/<caseId>.json`, `proof/<caseId>.json`, regression results, `source-hashes.json`, `final-checks.json`, and `browser-image-files.json`. `results.json` and the artifact report enumerate every required ID and executed test. Source hashes were unchanged during the final gate; the pinned browser image's actual files match the tested source.

After removing only machine-identifying JUnit hostname attributes and sanitizing local paths in logs, the unchanged verifier was rerun:

```sh
python3 scripts/verify-security-results.py --catalog docs/security/SECURITY_ACCEPTANCE_CASES.json --phase 5 --artifacts artifacts/security/20261013T090729Z-84121
```

Exit **0**, 55 PASS. Verifier SHA256: `cd4858b8ac4cd6f4b4c507ef90253f6edd936a0e75d8e08fcb2720e09c28b6c2`. No catalog case or verifier requirement was removed or weakened. `bun build runtime.js server.js security/scoped-browser.js execution/browser-worker.js --target=bun --packages=external --outdir=/tmp/odwyn-browser-buildcheck`, `git diff --check`, `bash -n scripts/security-gate.sh`, and the phase-5 catalog verifier also exited **0**.

The same image configuration with `bash scripts/security-gate.sh --release` exited **2 / BLOCKED**. Evidence: `artifacts/security/20261013T091802Z-89206/`. Preflight rejected Darwin: “release requires a disposable Linux runner; workstation Docker workers are insufficient”. Release JUnit, OS/controller evidence and regression executions from disposable Linux are missing. No release PASS is claimed. The owner reports a disposable Linux test VM is available; access details are pending.

## Containment fix and actual effects

The agent browser now runs wholly inside a separate immutable, non-root Docker worker. The trusted broker fetches only an exact reviewed public URL with pinned public DNS/IP, bounded HTML and no credentials or cookies. Redirects, alternate routes, scripts, subresources, downloads, pixel exports and authenticated browser actions fail closed. Known secrets are redacted before HTML enters the worker and before tool output returns. Cookies/localStorage persist only inside each task/resource worker.

E2E-001 used three custom agents and arbitrary Spaces, including two agents created through the authenticated owner API. It exercised actual MCP transport, scoped browser, same-principal terminal, workflows, routines and Room membership. Actual Chromium PID inspection observed UID 1000, seccomp mode 2, no-new-privileges and zero capabilities. Host canary, controller database, Docker socket and host proc paths were inaccessible. Both worker and renderer egress probes failed; a reachable synthetic sink positive control succeeded and received zero forbidden requests. Actual Docker inspection verified no host mounts, network none, read-only root, 512 MiB memory and 128 PIDs. DATA-001 proved cookie/localStorage positive controls, isolation across three distinct live PID namespaces, scoped broker denials, revocation and container removal. E2E-002 and ATTACK-001 exercised actual OS canaries and synthetic upstream side effects, including protected Git targets and hostile content. No production upstream services were contacted.

These changes prevent the previously observed same-UID host-browser boundary, credential/cookie forwarding, cross-task browser profile sharing and renderer-selected network requests. They preserve fail-closed policy enforcement and task/Space ownership.

## Files changed for this remediation

- Backend/callers: `security/scoped-browser.js`, `execution/sandbox.js`, new `execution/browser-worker.js`, `runtime.js`, `server.js`.
- Packaging/CI: new `execution/Dockerfile.browser`, `.dockerignore`, `.github/workflows/security.yml`.
- Tests/fixtures: `tests/security/browser-fixture.js`, phase-2 infrastructure, phase-3 acceptance, phase-5 cases/fixture/acceptance, `tests/security/coverage.json`.
- Documentation/inventory: `execution/README.md`, security operations, ADR, threat model, inventory, implementation/Phase-5 plans, entry points, and this report. Prior blocked report retained as `PHASE5_PRE_CONTAINMENT_REPORT.md`.

No new application dependency or saved-data schema is required for this containment fix. Earlier migrations, owner settings, approval recovery and legacy fixtures passed their mandatory MIG/REC/OPS cases; regression tests passed existing application flows.

## Failed runs retained

The original native-browser BLOCKED run is documented in [PHASE5_PRE_CONTAINMENT_REPORT.md](PHASE5_PRE_CONTAINMENT_REPORT.md). Browser characterization first failed with missing containment, then cookie persistence and fixture checks failed before correction. Cumulative run `20261013T085150Z-78089` exited **2 / FAIL**, with 53 PASS and E2E-001/ATTACK-001 failures. E2E's invalid manual agent fixture was replaced with real owner API creation. ATTACK's transient browser timeout was not conclusively diagnosed; focused and final cumulative reruns passed without loosening budgets. Those failures remain unchanged. Focused actual JUnit is retained under the `browser-*` and `worker-lifetime-red` artifact directories. Only the final unchanged-source cumulative run establishes this phase PASS.

## Rollout, rollback and remaining limits

Build and review both immutable worker images; configure server-owned `ODWYN_BROWSER_IMAGE` separately from terminal execution and owner grants. The controller may continue using `bun run start`; this does not itself provide an execution sandbox. Supported deployment requires rootless Linux Docker and delegated cgroup v2. Missing image/backend/control denies execution. Detailed configuration is in [execution/README.md](../../execution/README.md) and [OPERATIONS.md](OPERATIONS.md).

Rollback: unset the browser image, revoke browser grants and restart; saved chats/configuration remain. Never substitute native host browsing or unrestricted host shell. Browser functionality is restricted to reviewed public HTML. Chromium's optional inner namespace sandbox is not enabled; whole-process container/seccomp controls are the verified boundary, with shared-kernel escape remaining a risk. A killed controller can leave its contained worker for up to one hour; actual init command and normal removal were tested, full-hour expiry was not observed. Controller and owner-native browser isolation on the release host, real vendor integration and production deployment are unverified.

Next: run the existing hard gate on the owner's genuinely disposable Linux VM, retaining all JUnit/proofs and regression artifacts. CI targets an ephemeral `odwyn-disposable-security` runner with Bun, Python, Git, Codex, Chromium, rootless Docker and cgroup v2. The environment marker alone proves nothing. No merge, deployment, paid operation, production VPS access or live company integration was performed.
