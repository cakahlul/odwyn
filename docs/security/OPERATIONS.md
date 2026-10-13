# Security operations — release gate required

`bun run start` starts the controller. It does not create an execution sandbox. Do not deploy this unapproved hardening as a security release; A separate disposable Linux release gate and authenticated owner review remain required. Local phase tests are not deployment approval.

## Controller and workers

Use a dedicated non-root OS account, private data directory (0700), database/key/env files (0600), TLS and exact `ODWYN_ORIGIN`. Keep the password outside Git, minimum 16 characters. Firewall the controller port; expose only the authenticated TLS endpoint. Cloudflare Access with owner MFA is an optional additional perimeter, not a replacement for server policy or action approvals.

Do not mount the controller database, `.env`, provider home, SSH directory or Docker socket into agent workers. A Docker container around the controller alone does not protect its own files from a compromised browser. Separate terminal workers need the reviewed immutable image, non-root user, no capabilities, seccomp, no-new-privileges, read-only root, cgroup v2 budgets and denied egress. Linux needs the reviewed rootless Docker backend; Docker Desktop workers support local probes only. Snapshot directories contain explicitly selected public workspaces, never the application data directory.

`ODWYN_SANDBOX_IMAGE` must be an immutable image ID/digest. `ODWYN_SANDBOX_SNAPSHOTS` supplies the reviewed snapshots. Leave them unset until isolation is available. Missing backend denies execution; `Always approve` does not grant terminal access. Agent browser read/navigation require a separately built, immutable `ODWYN_BROWSER_IMAGE`. Missing image or kernel isolation denies the call; there is no native agent-browser fallback. This supports public read-only HTML at exact reviewed HTTPS URLs, without website credentials, scripts, subresources, interactions, screenshots or downloads. Cookies/localStorage remain inside a separate task/resource container; owner-browser profiles are never copied.

## Upgrade review and dry-run

Stop the controller before changing binaries or restoring data. Make an encrypted owner-only backup of the whole data directory and the actual deployment `.env` location. Backups can contain legacy plaintext keys: never copy them into agent snapshots or share them with agents. Provider and connector secrets use `broker.key`; preserve that key alongside each compatible database backup.

Before upgrading, run:

```sh
bun scripts/security-migration.js --dry-run /absolute/owner-data-directory
```

This opens the source database read-only, snapshots committed WAL content to a private disposable directory, copies key/env files only for that fixture, migrates the copy, emits sanitized counts/restrictions and deletes the copy. It does not authorize grants, contact providers or modify the source DB. Do not point the normal application at the temporary copy.

On first startup, schema steps back up committed SQLite content to private `pre-security-*`, `pre-data-security-*` and `pre-approval-security-*` directories. These copies include `.env`/`broker.key` if located in the data directory; a deployment `.env` elsewhere still needs your separate owner backup. Existing chats, names, agent IDs, provider settings and routines persist; legacy `allow` becomes an interaction preference. No privileged grants are imported.

Open Customize agent → Access & Autonomy → Security upgrade review. Inspect preserved counts. Create your own Spaces and exact resources; preview each action and choose Deny/Ask/Auto. Connections require fresh password confirmation. Review imported workflows and interrupted jobs before owner restart. Mark upgrade reviewed only acknowledges this checklist; it does not grant access or restart jobs.

## Pause, disconnect and ambiguity

Use Pause agent/Space/all before removing access. Revocations apply to each subsequent authorization and to checked result delivery. Disable connection prevents new credential brokerage, discards held read results at the next safe boundary, increments policy revision and emits `connector.disable` audit. Disconnection cannot undo a remote effect already committed.

A crash after an external effect can leave approval `consumed` with no receipt. Restart interrupts the task and preserves its immutable digest. Do not retry with a new approval automatically. Reconcile the exact idempotency key/digest with the reviewed upstream and record the outcome before proposing new work. The current implementation blocks duplicate execution; automatic upstream reconciliation is not implemented.

## Offline rollback

1. Stop the controller and all workers; retain a forensic owner-only copy of current DB, WAL/SHM, key and configuration.
2. Restore the pre-upgrade application revision plus the compatible complete owner backup into a fresh private data directory. For tested pre-security rollback, restore `pre-security-*/state.sqlite` as the original `odwyn.db` or `sidekick.db` filename, plus its matching key/env when present. Do not reuse stale WAL/SHM beside a restored database.
3. Set restored directory/file permissions and deployment environment. Test offline on disposable fixtures before changing any live deployment. Never transplant encrypted credentials between unrelated databases/owners.
4. Keep privileged autonomy disabled. An older binary may contain the characterized host-shell/browser vulnerabilities; rollback is not a security approval. Re-upgrade remigrates idempotently with zero new grants.

## Gates and troubleshooting

Run `bash scripts/security-gate.sh --phase 5` with both pinned worker images and authorized disposable local probes (see `execution/README.md`). A release requires `ODWYN_SECURITY_ISOLATION_RUNNER=1 bash scripts/security-gate.sh --release` on an actually disposable Linux runner, rootless backend and contained browser. The declaration is not proof; mandatory actual JUnit/proofs and OS/network/token probes must pass. A workstation release attempt fails closed. CI's disposable runner label must be provisioned ephemerally; do not reuse a production VPS as a test runner.

Missing policy DB/key/backend: stop or show unavailable, restore owner backup, never select host shell or broad MCP credentials. Inspect sanitized audit and `artifacts/security/<run-id>/results.json` for FAIL/BLOCKED IDs. The supplied JUnit verifier is unchanged; missing, skipped or blocked mandatory cases cannot pass.

Worker crash cleanup: a killed controller cannot execute its normal cleanup. Workers have a fixed one-hour OS lifetime with restart disabled and retained kernel/egress restrictions. Check recorded immutable task labels; remove only confirmed interrupted-task containers. Never restart or reuse their profiles/workspaces. This does not reconcile ambiguous external effects; consumed approvals remain unusable.
