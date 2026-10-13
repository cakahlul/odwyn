# Phase 0 threat model

Status: baseline, not implemented hardening. The specification and acceptance plan are one contract. Only disposable fixtures are authorized for verification.

## Assets and actors

Protect owner credentials, provider authentication, browser sessions, conversations, preferences, files, repository state, approvals and audit history. The authenticated single owner administers access; arbitrary user-created agents are untrusted requesters. Names, prompts, provider configuration, specializations, workflows, repositories, webpages, MCP results and dependency scripts are never authority.

## Trust boundaries

1. Owner HTTP channel enters `createApp.fetch`: Basic Auth, same-origin writes and rate limits exist. These do not distinguish agent calls from owner administration if a task can obtain host credentials.
2. Backend creates jobs, delegates Room turns and transitions workflow steps. Stable agent IDs exist, but Space/resource/revision bindings do not.
3. Provider dispatch enters `Runtime.executeRequest`: active thread, workflow tool allowlist and interaction preferences exist. A resource policy decision point does not.
4. Execution leaves the backend through host `/bin/sh`, a shared browser, provider-native MCP and connector requests. Codex read-only sandbox does not constrain the separate host terminal or shared connectors.
5. SQLite, FTS, preferences and files re-enter provider/chat/Room context. Path checks are useful, but no Space labels or disclosure policy exist.

## Verified and targeted threats

| Threat | Baseline/probe | Required prevention |
| --- | --- | --- |
| Prompt injection asks for host secrets | Runtime terminal reads a planted file outside disposable workspace | Actual per-task OS isolation, no host secrets/mounts, scoped egress |
| Cross-agent search pivot | Runtime search finds foreign-agent synthetic record | Space/resource ACL at query and disclosure boundaries |
| Durable memory pivot | Remembered canary reaches another agent's developer instructions | Classified memory, explicit disclosure and provenance |
| Session/cookie pivot | Real Chromium context, cookie and localStorage survive owner job switch | Task/Space-bound profiles and proxy egress |
| MCP bypass | Shared config imported in `Codex.request` | Reviewed manifests, scoped gateway and token broker |
| Privilege amplification | Room history, agent-changing workflow, schedule and recovery | Immutable identity; per-step checks; authority intersection |
| High-impact action/replay | Interaction mode and DOM heuristics lack action-bound approval | Owner step-up, canonical digest, atomic single use, TTL and upstream idempotency |
| Self-grant/audit tampering | Host process identity can reach control-plane files | Owner-only administration, isolated executors, append-only sanitized audit |
| Revocation race | No policy revision at dispatch | Fresh checks and cancellation at every enforceable boundary |

The runnable negative suite `tests/security/negative/legacy-denials.test.js` asserts denial and is expected to fail on the baseline. `BASE-002` asserts these exposures are reproduced; its PASS means truthful characterization, never security. Fixture results contain booleans/counters only, not canary contents.

## Residual risks and stop condition

Legacy shell, shared browser/MCP/workspace and global memory remain exposed in Phase 0. The context skeleton is inert. No new autonomy, policy migration or security guarantee is enabled. Phases 1–5 remain mandatory; release requires real disposable OS/network isolation with protected canaries and upstream side-effect evidence. Missing infrastructure or inconclusive execution is BLOCKED.

## Phase 1 delta

New administrative routes create Spaces/resources, edit access, list capabilities and simulate decisions. Existing owner Basic Auth, same-origin write checks and rate limits protect them; agents receive no administrative token. Payload validation rejects unknown fields/capabilities/constraints; broad allow selectors require explicit confirmation. SQLite stores immutable task identities separately from chat JSON. Revocation is checked before each supported resource operation. Unsupported executors fail closed. OS/network/credential/data isolation and strong step-up are still unproved; current owner attachments/preferences/Room transcripts must not be described as isolated. Raw provider-native MCP is disabled; historical sessions are invalidated with a Space-specific tool brand.

Repository reads add a network boundary: exact owner resource endpoints, public-IP validation with pinned connections, no redirects, no agent-selected URLs/headers/credentials, bounded responses and fresh policy checks before dispatch, while receiving chunks and before disclosure. A real local MCP client/server captures the task identity and shares that gateway; arbitrary provider MCP stays disabled. Disposable upstream counters verify repo A read access and zero repo B/write calls. Exact file export requires an owner grant and rejects symlink leaves. These controls do not prove OS containment or classified-data isolation.

## Phase 2 initial test-first delta — historical BLOCKED

All ten EXEC cases now have executable test code and catalog mappings. A positive authorized workspace read and inspection of an actual non-root task worker precede destructive/exfiltration probes. Current runner preflight throws a typed BLOCKED error on macOS; canary reads, network attempts, resource stress, dependency scripts and Git mutations do not run on this host. Generated blocked proof has verified=false and probeExecuted=false, so it cannot satisfy the unchanged verifier.

No production execution or credential surface was added. A separate actual runtime test confirms explicit auto grants plus every interaction mode still cannot create a host marker while the isolated executor is unavailable. This is dispatch denial only. Per-Space snapshot creation, kernel budgets, whole-worker cancellation, safe patch export, Git ref/CI brokerage and credential containment remain implementation and empirical verification work. Docker rootless/cgroup configuration requires actual runner evidence; absence of a forbidden effect before a probe runs is not isolation proof.

## Phase 2 implemented boundaries

The opt-in executor addresses hostile repository code, install scripts and fork/memory/CPU exhaustion with separate non-root, seccomp-filtered Linux cgroups, a read-only image and bounded writable tmpfs. Kernel state is checked before copying; missing Docker, immutable image, snapshot or kernel controls fails closed. The copied snapshot excludes credential/config/database files, rejects symlinks and special files, and bounds bytes, entries and nesting. No ambient application environment, credentials, host mounts, Docker socket or network enters the worker. Default egress denial is recorded for the task in the policy audit; controlled sinks have positive controls and worker probes inspect the kernel route table.

Protected refs, tags, branch-prefix escapes, non-fast-forward/unrelated history and CI/policy changes fail before writes to the upstream. Broker credentials are task/resource scoped and absent from worker environment/output. Patch export is bounded and matches the task workspace even when the agent has a separate workspace grant. Task finish, timeout and cancellation terminate the whole worker; service shutdown awaits removals. Migration preserves old grant rows and saved state with private backups, not implicit new authority.

Remaining boundaries: the container shares its Linux VM kernel; Docker Desktop's daemon is rootful inside that VM, and rootless Linux has not been empirically tested here. Classified file/derived-data sharing, connector/browser token/profile isolation and strong action approvals remain Phases 3–5 work and unavailable capabilities deny. No paid or live upstream was used for validation. This threat-model delta is implementation description; the cumulative gate and per-ID proof determine acceptance.

Final cumulative Phase 2 gate: `artifacts/security/20261013T024903Z-1267/`, exit 0; all 25 mandatory IDs, 7/17/15 phase tests and 90 repository regressions PASS with zero skips. Final review added secret-free command/usage auditing and a real two-execution cancellation regression: all in-flight terminal/Git transports now abort together. See PHASE2_REPORT.md for retained failed attempts, per-case evidence and rollback. Phase 3 is next; release remains blocked.

## Phase 3 boundary delta

Attacks now exercised include cross-Space cookie/localStorage reuse; unknown, disabled or broader MCP operations; raw connector/provider credentials in replies/artifacts; foreign file IDs and worker symlinks; exact-canary FTS recall; Room privilege unions; workflow output laundering; stale scheduled/retry grants; task-token access to owner HTTP state; altered/revoked exports; and switching the active principal during an in-flight browser read. Supplementary attacks reproduce provider item-ID overwrite, unselected note-resource disclosure, owner-browser download misattribution and credential pixels bypassing string redaction.

Server-owned classification is enforced before retrieval and provider context injection, with source-resource provenance retained through summaries and handoffs. Owner user text is trusted explicit input; an assistant cannot turn its output into user text by choosing a provider item ID. Resource revocation invalidates cached context and derived disclosures. Fixed owner-approved exports are the only supported cross-Space summary bridge. Privileged agent selection does not transfer a previous step's authority.

Credential ciphertext and broker handles never enter a task, worker or browser environment. Actual fake MCP/Git upstreams verify the precise bearer scope and allowed mutations; known echoes are sanitized or quarantined. Only bounded server-reviewed MCP and read-only browser requests are available; high-impact or unknown operations remain denied. Direct task HTTP calls require an expiring hashed token, live immutable task context and current data checks, not UI hiding.

Remaining threats: controller compromise, its separate broker key and private historical rollback backups; arbitrary transformed secrets not detectable by string matching; a Chromium/browser host-process or Linux VM/kernel escape; provider-managed OAuth host files; and unimplemented action-bound approvals/owner UX/release checks. Native browser tests prove real profile/storage/network isolation, not whole-process VM containment. No live company system or production connector is used. Phases 4–5 and the real disposable-runner release gate remain mandatory.

## Phase 4 boundary delta

Approval attacks include forged headers/chat consent, task-token administration, cross-origin requests, cached authentication without a fresh password, stolen/reused step-up proofs, concurrent replay, changed parameters/resource/connector/version, expired/revoked approvals, changed grants, duplicate proposals, native-provider completion and restart. Tests observe actual authenticated disposable upstream mutation counts, SQLite outcomes, real Chromium owner flows, and worker/HTTP shutdown. Audit sanitization occurs before persistence, including known synthetic secret variants.

Controls: immutable canonical envelopes, task-bound execution scopes, current PDP checks, atomic single-use consumption, fixed target preconditions/idempotency and durable receipts. Global/Space/agent pauses are server-owned and persistent; they terminate active work and prevent new tasks. Explicit Deny survives inherited Auto in the UI. High-impact actions retain mandatory fresh owner approval regardless of Auto or Always approve.

Residual limits: compromise of the trusted controller/broker, native whole-browser host containment, Linux VM/kernel escape and untested rootless Linux. An HTTP abort cannot undo an upstream effect already committed; ambiguous executions must be reconciled and never automatically replayed. A real vendor must implement the reviewed adapter's version precondition and durable idempotency contract; fake upstream acceptance does not certify a vendor. Phase 5 and release on a real disposable runner remain mandatory.

## Phase 5 delta — incomplete, release blocked

- Migration interruption is an actual SIGKILL inside the policy schema SQLite transaction. Disposable rollback restores the compatible pre-security database; retries introduce no grants. Dry-run uses a read-only WAL-consistent source snapshot, never a live migration.
- Approval recovery kills the actual controller after the fake upstream commits, before any local receipt response. The persisted consumed approval and digest prevent replay and task retry; ambiguous outcomes need owner reconciliation, never a fresh automatic payment proposal.
- Connector disable now records a sanitized owner audit event. A held real MCP read loses its grant before result delivery; its response is discarded at the next enforceable boundary. Remote operations already committed cannot be undone by disconnect.
- **Known containment gap:** native Chromium profiles, renderer sandbox and pinned proxy do not isolate the browser host process from the controller OS principal. Agent browser capabilities now default unavailable, including deployments started with `bun run start`. Only disposable fixture code explicitly enables native profile probes. No environment, provider, persona or owner resource grant enables production browser autonomy.
- E2E-001 exercises actual three-Space operations, then inspects the actual browser PID/OS identity; it remains BLOCKED. A real isolated browser execution service and filesystem/network probes are still required. No release verdict may be inferred from the other passing cases.

## Browser containment remediation (13 October 2026)

The earlier native-browser gap is addressed by replacing that adapter with a network-none, non-root, default-seccomp whole-process container. Its image cannot receive the controller database, keys, sockets, home or owner browser profile; the Docker build context is explicitly allowlisted. Reuse the existing kernel/cgroup checks. The immutable server task selects one exact reviewed public HTTPS GET through a trusted broker; no renderer-selected upstream requests, cookies, headers or redirects are accepted. Redact broker secrets before transferring bounded HTML. Abort all other Chromium requests, and separately test direct worker network attempts/host-path reads/actual live Chrome `/proc` controls.

Cookie/localStorage tests now use actual Chromium inside task/resource containers, including session persistence across reads, cross-task/Space isolation, denied upstream effects and container teardown. E2E-001 requires actual live browser PID, non-root/seccomp/no-new-privileges/capability observations and a reachable sink with zero forbidden calls; it no longer accepts shared-controller identity as sufficient evidence. Local evidence cannot establish rootless Linux production compatibility or release readiness. Controller compromise, authenticated owner native browsing and kernel/container escapes remain outside this agent-worker boundary.

A real fixture crash left an inert network-none container. Kernel provisioning now sets a fixed one-hour init lifetime (task ceiling), so controller death cannot retain workers indefinitely. Normal stop still removes the entire cgroup immediately. The configured lifetime and normal removal are asserted against the actual worker; full-hour expiry is not observed in this suite. Crash cleanup may remain pending up to that deadline; interrupted task IDs are never resumed.
