# Execution and data entry-point inventory

Phase 0 baseline; hooks below are proposed, not implemented policy enforcement. Existing guards are not Space/resource authorization.

| Category | Current source anchor | Required enforcement hook | Current gap |
| --- | --- | --- | --- |
| chat | `runtime.js:100` / `submit(input)` | submit/startJob and executeRequest | No resource or Space grants |
| room | `runtime.js:229` / `async messageRoom(` | messageRoom/submitRoom/startJob/disclosure | Shared transcripts; no per-resource disclosure |
| workflow | `runtime.js:130` / `launchWorkflow(` | launch/queueWorkflowStep/startWorkflowStep/advanceWorkflow | Tool allowlist only; agent changes lack authority intersection |
| skill | `workflows.js:108` / `export function workflowInvocation(` | submit/startJob skill resolution | Instructions are untrusted; no resource context |
| routine | `store.js:167` / `export function enqueueSchedules(` | schedule/enqueueSchedules/submit | No revision or Space binding at due time |
| recovery | `runtime.js:686` / `retry(` | retry/recoverJobs/queueWorkflowStep | Recovered task has no immutable policy context |
| file | `files.js:16` / `export function saveGeneratedFile(` | saveGeneratedFile/attachmentInput/validateAttachments and HTTP file routes | Workspace path validation exists; no Space ACL |
| memory | `runtime.js:566` / `params.tool === 'odwyn_search'` | store.search/remember/startJob/history | Runtime omits agent filter; global preferences |
| browser | `browser.js:39` / `async start()` | Browser.action/start/download and owner takeover routes | One persistent profile and mutable owner; no Space egress |
| terminal | `terminal.js:13` / `export function runCommand(` | runCommand and executeRequest terminal branch | Host shell; inherited environment; no OS sandbox |
| mcp | `codex.js:53` / `async request(` | Codex.request/start and broker tool/call; runtime elicitations | Shared MCP config; no trusted scoped gateway |
| admin | `server.js:113` / `async fetch(` | Authenticated owner routes and step-up admin/approval boundary | Basic Auth/origin only; no agent-specific credentials or strong approval |
| provider | `providers.js:216` / `async runClaude(` | runClaude/runAPI/Codex.start and per-tool dispatch | Provider prompts restrict tools; shared execution identity |
| network | `proxy.js:43` / `export async function startProxy(` | resolvePublic/fetchImage/startProxy and sandbox egress | Public-IP filtering exists; no owner domain constraints or terminal egress |

## HTTP routes

All routes enter Basic Auth; mutations require same-origin and rate limits. Owner administration must remain separate from agent task credentials. Literal routes and dynamic matcher families are checked against source in BASE-001.

- `/api/account/login`
- `/api/account/login/complete`
- `/api/account/refresh`
- `/api/agents`
- `/api/appearance`
- `/api/browser/action`
- `/api/browser/frame`
- `/api/browser/takeover`
- `/api/customization`
- `/api/files`
- `/api/images`
- `/api/jobs`
- `/api/preferences`
- `/api/provider`
- `/api/provider/models`
- `/api/rooms`
- `/api/schedules`
- `/api/skills/import`
- `/api/state`

Dynamic families (every action under each matcher must be enforced):

- `/^\/api\/(workflows|skills)(?:\/([a-f0-9-]{36}))?(?:\/(run))?$/`
- `/^\/api\/agents\/([a-f0-9-]{36})$/`
- `/^\/api\/conversations\/([a-f0-9-]{36})$/`
- `/^\/api\/files\/([a-f0-9-]{36})(\/preview)?$/`
- `/^\/api\/jobs\/([a-f0-9-]{36})\/(answer|respond|cancel|retry|permissions)$/`
- `/^\/api\/rooms\/([a-f0-9-]{36})(?:\/(messages|cancel))?$/`
- `/^\/api\/schedules\/([a-f0-9-]{36})$/`

## Tool dispatch

- `odwyn_send_file`: `Runtime.executeRequest`, then actual resource boundary.
- `odwyn_room_next`: `Runtime.executeRequest`, then actual resource boundary.
- `odwyn_room_read`: `Runtime.executeRequest`, then current-room membership, participant permission intersection, artifact provenance and handoff export validation in `roomWorkContext`.
- `odwyn_room_done`: `Runtime.executeRequest`, then actual resource boundary.
- `odwyn_room_review`: `Runtime.executeRequest` verifies active task/room/Space,
  owner-designated reviewer identity, current readable proposal version, and
  participant permission intersection. Decisions never grant resource access.
- `odwyn_terminal`: `Runtime.executeRequest`, then actual resource boundary.
- `odwyn_search`: `Runtime.executeRequest`, then actual resource boundary.
- `odwyn_browser`: `Runtime.executeRequest`, then actual resource boundary.
- `odwyn_ask`: `Runtime.executeRequest`, then actual resource boundary.
- `odwyn_remember`: `Runtime.executeRequest`, then actual resource boundary.
- `odwyn_schedule`: `Runtime.executeRequest`, then actual resource boundary.

Provider requests also enter `handleRequest` and native approval/elicitation branches. Codex native command/file escalation is declined; external MCP execution can occur outside native Odwyn dispatch. `providers.js` API and Claude SDK dynamic-tool callbacks must use the same gate. `proxy.js` public destination checks must remain and add owner scope. Owner takeover is an authenticated separate channel, never agent approval authority.

Fixtures directly test terminal/search/memory/browser disclosure through real runtime dispatch. Remaining gaps map to required future IDs in coverage.json; not claimed implemented. Reviewers must inspect new semantic paths: static route/tool inventory cannot prove complete enforcement.

Phase 5 adds owner-only `GET/POST /api/security/migration`: sanitized preservation counts/restrictions and explicit review acknowledgement. It grants nothing and does not restart tasks. `scripts/security-migration.js --dry-run` snapshots a read-only owner DB into disposable private storage; no provider calls. `scripts/security-regression.js` executes every existing regression file in a fresh real Bun process with JUnit to avoid the documented native FD issue. Production browser capabilities now fail closed; explicitly enabled native browser probes live only in disposable test fixture setup.

Browser remediation: `security/scoped-browser.js` now routes through the exact-URL credential-free broker and isolated image, not `Browser.start` on the controller. `execution/browser-worker.js` validates bounded stdin and renders inside the task/resource cgroup with all alternate traffic aborted. `Sandbox.create` is shared by terminal and browser, retaining actual UID/seccomp/no-new-privileges/capability/cgroup checks. Trusted server configuration adds `ODWYN_BROWSER_IMAGE`; agent/HTTP input cannot change it. Owner native browsing remains owner-only. Fixtures now drive Chromium inside the worker, including cookie persistence, revoked reads, direct OS/network probes and zero forbidden upstream effects.
