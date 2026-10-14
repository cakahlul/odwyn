# Security acceptance test plan

The tracked [case registry](SECURITY_ACCEPTANCE_CASES.json) preserves all 55 case IDs from the existing [coverage map](../../tests/security/coverage.json). It was reconstructed because the originally supplied registry and test-plan files were absent. The executable tests and current architecture remain the source for each case's checks.

Run `bash scripts/security-gate.sh --phase 0..5` for cumulative phase verification. The gate validates coverage, runs the actual phase suites, correlates each mapped test name with exactly one passing JUnit execution, and requires structured proof for adversarial and isolation cases. Missing, malformed, failed, skipped, duplicate, or unproved executions block acceptance. BASE-003 and REG-001 also require complete passing repository regression evidence, browser smoke, and dependency checks.

All fixtures use disposable storage, synthetic canaries, local HTTP/MCP services, and reviewed isolated workers. Configure the pinned fixture images and authorized disposable worker environment as described in [execution setup](../../execution/README.md). Required infrastructure being unavailable is BLOCKED, never PASS.

`bun run test` runs every regression and security test file in a separate process and retains real JUnit and logs under `artifacts/tests/`. Security acceptance tests still require the documented worker configuration. No tests are filtered or silently skipped.

`bash scripts/security-gate.sh --release` additionally requires an actual disposable Linux release runner and a complete regression run. Local worker verification alone is not a release or deployment approval.
