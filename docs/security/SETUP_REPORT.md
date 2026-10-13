# Owner setup automation

`bun run setup` preserves owner credentials, detects supported isolation, builds only missing worker images, pins immutable IDs and checks actual worker kernel controls plus contained Chromium startup before saving private configuration. Existing immutable images are checked rather than silently upgraded. It creates no database, policy grants, connectors or resources. `bun run start` still starts the controller; unavailable tools now show setup guidance in its console and Access & Autonomy.

No Docker/backend: ordinary setup remains available with isolated tools denied; `--isolation` instead returns exit 2. `--chat-only` skips workers. Docker/system-package installation remains an explicit owner operation, not an automatic elevated installation. Runtime authorization and kernel checks remain mandatory on every worker provisioning. This is startup readiness, not a substitute for the release acceptance contract.

Changed files: `scripts/setup.js`, startup guidance in `server.js`, unavailable-tool guidance in `public/security-ui.js`, `.gitignore`, README and execution instructions. Tests: new `test/setup.test.js`, `tests/security/phase5/setup.test.js`; supplemental OPS-002 mapping and execution entry-point inventory updated. No dependencies or saved-data schemas added.

Tests-first evidence: `artifacts/security/setup-red/` records the missing implementation and the concurrent configuration overwrite regression. `artifacts/security/setup-green/results.xml` records 9 actual Bun tests / 33 assertions, exit 0. These tests use synthetic command adapters for build/error cases and are not OS isolation proof. `setup-green/os.junit.xml` records an actual disposable worker test / 16 assertions, exit 0; `setup-green/setup/os-readiness.json` records actual terminal/browser kernel controls and browser launch. Existing pinned images were used for that OS check, not fake command adapters.

Both production/server and browser UI builds exited 0 with their proper Bun targets. An initial combined build failed on the browser-only `/vendor/marked.js` import; splitting targets and treating that served dependency as external fixed the validation command. The supplied verifier and manifest IDs remain unchanged. Final cumulative **Phase 0–5 PASS**, exit **0**, evidence `artifacts/security/20261013T115629Z-17335/`. All **55/55** mandatory IDs executed with zero missing, skipped or failed cases. Primary phase counts: 7/17/15/22/22/11 (94 tests). Both actual repository regression runs passed **99/99 tests across 29 files**. The added OPS-002 installer check used real disposable terminal/browser workers and is included in coverage. `setup-source-hashes.json` confirms the changed executable sources remained unchanged during the final gate; `setup-final-checks.json` records counts and unchanged verifier SHA. Machine-identifying JUnit hostname attributes were removed without changing test outcomes; the unchanged verifier reran successfully, exit 0.

Exact final commands (image variables below are fixture configuration):

```sh
export ODWYN_SECURITY_ISOLATION_RUNNER=1
export ODWYN_SECURITY_SANDBOX_IMAGE=sha256:b098e07c8d48bd4f997cb24bf106cd1fa9d8f1d2168c637f354aff680ead0b99
export ODWYN_SECURITY_BROWSER_IMAGE=sha256:8d5363e8959833d042153947a4973f0891a8ed48909462eb0cc4b26bec6af876
caffeinate -i bash scripts/security-gate.sh --phase 5
python3 scripts/verify-security-results.py --catalog docs/security/SECURITY_ACCEPTANCE_CASES.json --phase 5 --artifacts artifacts/security/20261013T115629Z-17335
```

Both exited 0. `bash scripts/security-gate.sh --release` with the same fixture configuration exited **2 / BLOCKED**, evidence `artifacts/security/20261013T120544Z-20149/`: this controller is Darwin, and actual disposable Linux release JUnit, controller isolation and regression evidence are unavailable. No release PASS is claimed. The interrupted earlier run `20261013T113800Z-11909` is preserved as BLOCKED, not PASS; its shell exit was unavailable, and exit 2 there is the report's explicit fail-closed classification.

The repeated regressions and OS/adversarial probes prevent treating installation readiness as security certification. Existing credentials and concurrent configuration edits are preserved; mutable image IDs, unsupported backends and failed probes never save new execution settings. Per-case executions, required proofs and sanitized fake-upstream effects remain in the final artifact directory.

Rollout: use the release-tested revision, install dependencies, run `bun run setup`, restart Odwyn and select precise permissions through Access & Autonomy. `.env` is written atomically only after probes pass, with owner-only permissions and a concurrent-edit check. Snapshot roots remain owner-reviewed and resource-scoped; no live data or secrets belong there. Services outside the checkout must explicitly load the generated configuration.

Rollback: stop the controller, unset the worker configuration and restart; saved application data and grants remain. Never substitute host execution. Build downloads and Docker installation require network/system prerequisites. Linux deployment and full release validation remain unverified. Nothing was deployed, pushed or merged; no production VPS data or live connector was used.
