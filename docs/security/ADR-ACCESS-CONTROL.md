# ADR: owner-configurable access and autonomy

Status: accepted; Phases 0–1 implemented and cumulative Phase 1 gate passed. Phases 2–5 remain required before release.

## Decision

Reuse stable existing agent IDs, native tools, routing conventions and Bun/SQLite/Playwright tests. Introduce a deterministic server-owned policy decision at each actual resource boundary. Subject identity is owner + agent + immutable task + exactly one Space + policy revision. No persona/role/provider privilege. Spaces are arbitrary owner data.

Default deny; explicit deny wins. Resolve canonical resources and typed actions before granting execution. Unsupported capabilities/constraints fail closed. Modes deny/auto/ask control execution of an authorized operation; legacy confirm/safe/allow remain interaction preferences. Unknown or high-impact browser operations cannot be made safe by button text. Owner administration, secrets and audit mutation are never agent tools.

Use normalized transactional SQLite records for Spaces/resources/grants/revisions/task identities/approvals/audit, separate from persona JSON. Preserve existing IDs, five-agent creation cap, provider settings, chats, Rooms, Workflows, Routines and Skills. Migration creates a restricted historical Space without silently granting external access.

Task context skeleton `security/task-context.js` validates scalar IDs/revision, copies and freezes them. It is not connected to legacy execution in Phase 0 and does not authorize anything. Phase 1 must construct it only from authenticated backend state, persist identity and validate reconstructed contexts after restart.

## Execution and credentials

Require non-root disposable isolated workers with read-only images, bounded processes/CPU/memory/time and default-deny egress. No host keys, app DB, browser profiles, auth home or container sockets. Terminal commands and dependency installs are untrusted. Export patches or push through trusted scoped Git brokerage; never put push credentials inside workers. Browser contexts and credential handles bind to immutable Space/task identity. Provider MCP must use a scoped gateway; unsupported paths stay disabled.

Backend selection remains BLOCKED pending inspection of a disposable Linux runner with enforceable kernel/network controls. A Docker executable or runner environment variable is insufficient. This workstation is not a declared disposable isolation runner. Never fall back to host shell when secure execution is requested.

Approvals bind the full canonical action envelope, policy revision, owner authentication, nonce, expiry and exact target. Consume once atomically after fresh policy evaluation; retain upstream idempotency receipts across crash/retry. Redact outputs before model/storage/audit disclosure.

## Alternatives rejected

Prompt/tool hiding alone cannot enforce boundaries. Persona presets cannot represent arbitrary owners. Existing `Always approve` cannot confer resource or host authority. A second parallel tool implementation would leave legacy bypasses. Path allowlists alone cannot contain shell execution. Broad connector tokens inside workers defeat isolation.

## Validation and rollback

Implement each phase's tests first; supplied catalog/JUnit validators remain fail closed. Phase 0 characterization can pass while denial tests remain red; both evidence sets must be visible. Release requires all 55 IDs, OS/network and upstream observations, regression and owner review. Phase 0 changes do not migrate saved data or change runtime behavior. Roll back by removing the inert skeleton and new test/docs/CI files; preserve original supplied contract material.

## Phase 1 implementation boundary

Normalized SQLite policy data is separate from the mutable chat state. A server-only symbol links storage to task creation; persisted task identities come from `task_security_contexts`, never from model/tool arguments or the chat JSON context snapshot. Policy edits use an atomic optimistic revision; action dispatch evaluates current grants. Available capabilities are bounded same-Space/same-agent recall, exact owner-granted file export, and credential-free repository reads. Repository reads use an exact owner-registered HTTPS endpoint, public-address validation, pinned resolution, no redirects or ambient credentials, a 1 MiB response bound and a 15-second timeout. Direct and MCP reads share the same current-policy enforcement. The actual MCP SDK client/server exposes only repository_read and captures the immutable task principal; its annotation is not authorization. Shared host shell, provider-native MCP, browser automation and unscoped writes remain platform-denied pending actual executors. `ask` records an approval requirement but cannot execute through legacy interaction approvals. Authenticated private repositories and report connectors require the Phase 3 credential broker. The installed MCP SDK is pinned directly at its existing version 1.32.1; no new implementation library is introduced. File grants identify one workspace basename and reject leaf symlinks. This is resource-scoped dispatch, not OS isolation.

## Phase 2 initial test-first decision — historical BLOCKED

The workstation is macOS arm64. Docker CLI is installed, but its daemon is unreachable; no disposable Linux execution runner is available. Do not launch untrusted code on this host, start privileged services, install a replacement sandbox, or flip capability availability to obtain green tests. `sandbox.exec` and branch pushes remain unavailable. Phase 2 is not implemented or complete.

The initial test target is a disposable Linux runner with rootless Docker, cgroup v2 and systemd delegation. Docker documents that rootless cgroup flags can be ignored without these controls: https://docs.docker.com/engine/security/rootless/tips/. Test actual kernel limits and upstream effects, not flags alone. A runner environment variable is a declaration only. The tests also require genuine Odwyn isolated dispatch before any canary, network, dependency or exhaustion probe runs.

Test-first executor contract: one non-root task-bound worker labelled `odwyn.task=<taskId>`, copied safe snapshot at `/workspace`, read-only image, no host bind mounts, dropped capabilities, no-new-privileges, no network, bounded cgroups and cancellation of the complete worker. Tests must be adapted with equivalent or stronger real observations if a reviewed backend uses a different lifecycle; never replace OS checks with mock denial. Rootless containers share a kernel and are not microVM isolation.

The pending Git broker must use a trusted, resource-scoped upstream adapter outside workers, constrain refs and CI changes, and never expose authentication to the worker. The test service is a disposable bare Git repository behind the real `git http-backend`; accepted pushes must change actual refs. No production broker, authenticated Git integration, patch export or draft PR path was enabled here. Before implementation, finish runner/image selection and bind the fake upstream to the reviewed gateway contract.

## Phase 2 execution decision — October 13 retry

The owner started Docker and requested completion. Support Docker Desktop's Linux VM on macOS in addition to preferred rootless Linux Docker. Native rootful Linux is rejected. The spec prefers rootless; it requires non-root isolated execution. This supersedes the provisional Linux-host-only fixture prerequisite, without changing the acceptance contract. [Docker documents the VM boundary](https://docs.docker.com/desktop/setup/install/mac-permission-requirements/); rootless resource flags alone are insufficient without working [cgroup delegation](https://docs.docker.com/engine/security/rootless/tips/).

Every actual worker must prove UID 1000, seccomp filter mode 2, no-new-privileges, zero effective capabilities and the exact CPU/memory/PID kernel limits before workspace ingestion. Workers have no network, host binds or privileged sockets; only bounded descriptor-relative snapshots enter through tar stdin. Each task has a distinct worker in its immutable Space. Timeout, output overflow, cancellation and task completion stop the worker; awaited service shutdown also waits for pending removals. No host shell fallback exists. Availability is server configuration plus the immutable image ID, never an agent/provider/prompt privilege. Default configuration remains disabled.

Repository objects are parsed only inside workers. Git pushes use smart-protocol packet transport in the server broker; no host Git command parses an agent repository. The broker accepts an exact registered resource and constrained branch, pins the resolved IP, refuses redirects, applies current grants, excludes CI/policy changes and protected refs, and requires a receive-pack receipt. Credentials enter only the server-side resource/task-scoped callback. No live credential source is enabled by default. Synthetic Git HTTP fixtures require a canary bearer token and verify actual ref mutations. Optional draft PRs remain unavailable; main/tag/merge/CI actions cannot use the branch-push capability.

Persist branch constraints in a backward-compatible grants column. Before ALTER, create a private WAL-complete SQLite backup; existing grants receive `{}` and remain denied for branch pushes without prefixes. Matching branch constraints intersect, forbidden refs union, and expiry is parsed consistently with the policy evaluator. Rollback disables configuration and restores a backup only offline with the pre-migration application. Completion evidence belongs in PHASE2_REPORT.md, not this design decision. Rootless Linux and a production release remain unverified by the workstation run.

Final cumulative Phase 2 gate: `artifacts/security/20261013T024903Z-1267/`, exit 0; all 25 mandatory IDs, 7/17/15 phase tests and 90 repository regressions PASS with zero skips. Final review added secret-free command/usage auditing and a real two-execution cancellation regression: all in-flight terminal/Git transports now abort together. See PHASE2_REPORT.md for retained failed attempts, per-case evidence and rollback. Phase 3 is next; release remains blocked.

## Phase 3 decision

Classification and derived-data provenance use normalized server-owned SQLite records, separate from mutable messages and provider item IDs. Source resource grants and recipient read grants must both remain valid. Rooms use participant intersections; each workflow step uses its own immutable agent/Space and imports only referenced, authorized outputs. Owner sharing uses a fixed, bounded field snapshot, not an implicit domain bridge. Revocation or changed source text invalidates inherited exports. Shared owner-browser files remain Legacy, never a running unrelated task's Space.

Use installed MCP/Playwright and native AES-256-GCM, without a new dependency. Reviewed document/Git manifests fix actions, endpoints and upstream resource IDs. Credentials stay in the server broker, encrypted with a separate 0600 key and principal-bound authenticated ciphertext. Missing key material fails closed. Known raw/escaped/URL/base64 secret variants are redacted at model/event boundaries and quarantined before artifact writes; this is not a claim that arbitrary secret transformations can be recognized.

Browser instances bind to task, Space and resource, with private profiles, no credential environment, JavaScript/service workers/downloads disabled, exact GET destinations and pinned public network targets. Context request routing and WebSocket rejection follow the installed Playwright BrowserContext APIs: https://playwright.dev/docs/api/class-browsercontext. Visual exports remain unavailable because string redaction cannot sanitize pixels. Native Chromium renderer sandbox/profile separation is not an independent VM for the whole browser process; full browser host containment remains a release risk to resolve before production.

Phase 3 API/migration contracts are in PHASE3_PLAN.md; execution evidence belongs in PHASE3_REPORT.md. Historical Phase 0–2 limitations above remain chronological records, superseded only for boundaries actually implemented and verified. Strong approvals, owner Access & Autonomy UI and release/migration readiness remain Phases 4–5.

## Phase 4 decision

Keep approvals in server-owned SQLite, independent of provider requests and legacy interaction preferences. Canonical envelopes bind owner, immutable task/agent/Space, resource/connector, typed parameters, constraints, revision, expiry and nonce. Fresh password verification produces a hashed, action-bound, single-use 60-second proof in an HttpOnly/SameSite cookie. Atomic consume precedes effects; a logical request key prevents an identical retry from issuing another payable approval. Persist sanitized receipts; ambiguous failures stay consumed and need reconciliation. Restart interrupts tasks rather than silently resuming approved effects.

Use the existing dispatcher under an exact AsyncLocalStorage execution scope. Every downstream policy check still runs; approval cannot override deny, disabled adapters, stale policy, participant intersections or pause. Native provider completion leaves pending actions waiting for explicit trusted owner execution. A fixed generic HTTPS action adapter uses typed inputs, target-version preconditions and upstream idempotency/digest receipts; unknown operations and unrestricted browser writes remain unavailable. No native vendor or live integration was validated.

Expose owner controls through existing customization dialogs and composer, with empty-resource neutral editable presets. Dry previews roll back their temporary policy transaction. Persist pause before terminating matching workers and transports; resume never revives interrupted tasks. Add tables only after a private WAL-complete pre-approval backup. Versioned handler/adapter schemas are in PHASE4_API.md; real evidence and remaining limitations belong in PHASE4_REPORT.md.

### Phase 5: safe migration and browser availability

Reuse the existing Access & Autonomy editor for upgrade review; acknowledgement grants nothing. Persist review state in SQLite, present preserved record counts without secret paths, retain private backups of database, `.env` and broker key when present. Offer read-only dry-run and offline rollback instructions. Crash recovery retains consumed approvals; never replay an ambiguous external effect.

Retire the native scoped browser adapter. Agent read/navigation use a separate immutable image and full-process network-none container per task/Space/resource, reusing the terminal kernel checks. A trusted controller broker makes only exact reviewed credential-free HTTPS GETs; bounded, redacted HTML crosses stdin into Chromium. Renderer traffic has no route back to the broker. Session cookies and localStorage stay in private temporary profiles; no owner/native profile is mounted. Interactive/authenticated browsing, redirects, scripts, subresources, pixel exports and downloads remain unavailable. Chromium closes between reads; its optional inner sandbox is not the containment boundary. Missing infrastructure denies execution. Release still requires independent disposable Linux validation; no external integration or deployment is authorized.

## Explicit Room Space selection

New Rooms require an explicit owner Space (`POST /api/rooms` with `spaceId`). The editor starts with the active agent’s default Space and lists only that Space’s members. Legacy Workspace retains the policy’s existing implicit membership semantics. Editing displays the fixed Space; `PATCH /api/rooms/:id` rejects any different Space and validates every submitted participant, including retained members, before mutation. Room creation and editing never add memberships or resource grants.

Existing Room IDs, transcripts, and Legacy Workspace classification remain unchanged. No Room is moved to a custom Space automatically. Task creation, history disclosure, tool-result return, and agreed-result publication recheck current membership and resource permission intersection. Derived resource provenance continues through the existing classified-data and proposal records.

Regression coverage extends DATA-006 with explicit binding, cross-Space denial, membership edits, live and in-flight revocation, provenance, and Legacy migration/reload probes. API and browser tests cover the selector, filtered/empty participant lists, forged Space edits, and stale membership. These probes retain the existing proof/execution records and JUnit conventions; focused runs do not establish a full release-gate pass.
