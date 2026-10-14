# Owner security API schema, version 1

These handlers extend existing routing. Owner Basic authentication and configured same-origin checks apply to every mutation; task bearer tokens cannot administer security. Errors are JSON `{error:string}`; invalid/stale input is HTTP 400, authentication 401/403, cross-origin 403 and rate limits 429. Successful owner operations return 200, creations 201. No raw credential or fresh password is returned in state, approvals or audit.

| Route | Input/result contract |
|---|---|
| GET `/api/agents/:id/access` | `{schemaVersion:1,revision:number,defaultSpaceId:UUID,spaceIds:UUID[],grants:Grant[]}` |
| PUT `/api/agents/:id/access` | Same access schema; optional `confirmWildcard:true`. Fresh `ownerPassword` required for wildcard confirmation or non-deny high-impact grants. Optimistic current revision required. |
| POST `/api/policy/preview` | `{agentId:UUID,access:Access}`; returns `{decisions:[{resourceId,action,mode,reason,revision}]}`. Transaction rolled back; no side effects. |
| POST `/api/policy/simulate` | Existing `{agentId,spaceId,resourceId,action}`; current effective decision only. |
| GET `/api/resources`, `/api/spaces` | Existing owner inventory; stable UUIDs, arbitrary owner names. |
| GET/PUT `/api/security/presets` | List `{name,actions:string[]}[]`; PUT `{name,actions,previousName?}` creates, edits or renames a template; changes suggestions only, never scopes/grants. |
| POST `/api/connectors` | Existing connector schema plus fresh `ownerPassword`; credential encrypted by existing broker. No default endpoint. |
| PUT/DELETE `/api/spaces/:id` | PUT `{name}` renames; DELETE removes an empty, unreferenced Space, memberships and default assignments. Legacy Workspace and Spaces referenced by history/files/exports/routines cannot be deleted. |
| PUT/DELETE `/api/resources/:id` | PUT `{name?,metadata?}` retains type, Space and UUID. Changed metadata revokes exact and wildcard access to this resource. DELETE removes the resource and its grants; dependent file resources must first be unlinked. History remains. |
| GET `/api/connectors` | Owner inventory includes endpoint and enabled state, never credentials. |
| PUT `/api/connectors/:id` | `{name,endpoint,credential?,ownerPassword}`; blank credential should be omitted to retain it. Endpoint/credential changes revoke linked resource access; Git resource endpoints follow the connection. Type and Space stay fixed. |
| DELETE `/api/connectors/:id` | Existing disable operation. |
| DELETE `/api/connectors/:id/permanent` | Permanently removes an unlinked connection and encrypted credential. |
| DELETE `/api/security/presets/:name` | Deletes a URL-encoded template name; existing agent grants stay unchanged. |
| GET `/api/approvals` | `{approvals:[{id,status,digest,expiresAt,envelope,receipt}]}`; sanitized immutable preview. |
| POST `/api/security/reauth` | Exactly `{password:string,approvalId:UUID}`; verifies current owner password and live pending request. Returns `{ok:true}` and action-bound HttpOnly, SameSite=Strict cookie, 60-second maximum, Secure on HTTPS. Token hash only in SQLite. |
| POST `/api/approvals/:id/decision` | Exactly `{decision:"approve"|"deny"}`; approve consumes valid cookie proof bound to this request. Deny revokes pending/approved requests. |
| POST `/api/approvals/:id/execute` | Exactly `{}`; server executes stored immutable tool/arguments in its still-active task. No client target substitution. |
| GET `/api/audit` | `{events:Event[]}`; last 100 normalized events, sanitized before persistence and response. |
| POST `/api/security/pause` | Exactly `{scope:"agent"|"space"|"all",id:UUID|"all",paused:boolean}`; persists pause, interrupts matching active/queued work. Resume permits new work, never replays stopped tasks. |

Grant: `{spaceId:UUID,resourceId:UUID|"*",action:string,mode:"deny"|"auto"|"ask",constraints?:object,expiresAt?:ISO8601}`. Existing branch constraints validate exact prefixes, forbidden refs and mandatory CI restrictions. Deny precedence and platform availability always apply. Default Space must be assigned (Legacy remains restricted compatibility default). New tasks accept `spaceId`; conversations retain immutable Space. New routines inherit the agent default, existing routines retain their stored Space.

Envelope: `{ownerId,agentId,taskId,spaceId,connectorId:UUID|null,resourceId,canonicalAction,normalizedParameters,constraints,policyRevision,expiresAt:epochMilliseconds,nonce:UUID}`. Parameters store `{tool,arguments}`; canonical sorted JSON is SHA-256 hashed. Maximum 30,000 characters, TTL 1–300,000 milliseconds. State: pending → approved → consumed → succeeded or indeterminate; pending/approved may become revoked/expired. Logical `(task,action,resource,parameters)` retries keep one approval ID. A restart interrupts the original task. New proposals after an ambiguous effect require reconciliation; no automatic replay.

## Reviewed action gateway protocol, version 1

`odwyn_action` accepts exactly `{resourceId:UUID,action,parameters,approvalId?:UUID}`. Its registered `action-gateway-v1` connection must be enabled in the same Space; fixed server metadata selects the external resource. Only these structured operations exist:

| Action | Required parameters |
|---|---|
| `payment.execute` | `amountMinor` safe integer 1–1,000,000,000; `currency` three uppercase letters; `recipient`; `expectedVersion` |
| `message.send` | `recipient`, `subject`, `body` (maximum 8,000 characters), `expectedVersion` |
| `repository.merge` | `commit` 40 lowercase hex characters, `target`, `expectedVersion` |
| `deployment.production` | `commit` 40 lowercase hex characters, `environment:"production"`, `expectedVersion` |

Other string fields are nonempty, maximum 200 characters; control characters/unknown keys rejected. HTTPS endpoint resolves to a pinned public address. Broker sends POST `{action,resourceId:<fixed upstream ID>,parameters,digest,idempotencyKey:<approval UUID>}` with credential, `Idempotency-Key` and `If-Match: expectedVersion`. No redirects, 15-second deadline, bounded 16,000-character JSON response. The adapter must atomically reject changed targets and durably deduplicate the idempotency key. HTTP 200 receipt must contain string `id` and exact `digest`/`idempotencyKey`; only sanitized receipt identifiers return. Cancellation drops the transport; prior upstream commit cannot be undone. Missing/rejected/ambiguous receipts consume the request permanently.

Adapters require independent vendor review before connecting live services. These tests use synthetic credentials and local disposable HTTP sinks only; no live payment, send, merge or deploy is authorized.

Resource configuration changes/deletion and connection configuration changes/permanent deletion require no queued, running, waiting, takeover or stopping tasks in the Space. Rename-only edits preserve grants. Workspace Settings contains shared management; agent Access & Autonomy contains memberships, permissions, template application and restrictions.

Browsing resource metadata is either `{blockedDomains:string[]}` (public web excluding those domains and subdomains, at most 100 entries) or legacy `{readUrls:string[]}` (exact HTTPS URL allowlist). Schemes, ports, paths and wildcards are invalid blocked-domain entries. Domain names are normalized to lowercase ASCII/IDNA and deduplicated. Mixing scopes is rejected. New UI resources default to public-web Browsing with an optional empty blocklist; editing a legacy resource preserves its allowlist unless the owner explicitly changes its scope. All three browser permissions remain denied without a configured isolated executor. Interaction requires the updated browser-worker image and cannot bypass Read denial.
