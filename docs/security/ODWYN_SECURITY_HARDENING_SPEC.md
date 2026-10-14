# Security hardening contract

This tracked contract is reconstructed from the existing access-control design, implementation, coverage, and phase reports. The originally supplied contract and verifier files were absent from the repository. Historical reports refer to those earlier files; their hashes do not identify the reconstructed verifier.

The [access-control design](ADR-ACCESS-CONTROL.md), [threat model](THREAT_MODEL.md), and [capability catalog](CAPABILITY_CATALOG_DRAFT.md) define the implementation boundaries:

- Owner authentication and same-origin checks protect administration. Agents cannot grant themselves access or override their immutable task identity.
- Every tool call checks the task's agent, Space, resource, action, current policy revision, and applicable approvals. Names, prompts, and provider settings confer no authority.
- Unavailable execution or policy infrastructure denies access. Terminal and browser workers run with reviewed immutable images, non-root users, no host bind mounts, restricted capabilities, and enforced network isolation. Host execution is never a fallback.
- Conversations, files, memory, credentials, and connector results stay within their authorized boundaries. Room access uses the participants' intersected permissions, with provenance and live revocation checks.
- Sensitive actions require fresh owner authentication and immutable, expiring, single-use approval envelopes. Execution rechecks permissions and targets.
- Credentials are encrypted and redacted from logs, model output, and artifacts. Recovery, migration, retries, and emergency pauses preserve these boundaries.
- Workspaces have separate storage, browser profiles, sign-ins, and task identities. Explicit owner sharing links selected defaults without sharing agent permissions.

No passing unit test substitutes for OS isolation evidence or authorizes deployment. Missing, failed, skipped, or blocked mandatory security cases block the gate.
