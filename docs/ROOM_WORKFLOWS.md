# Reviewed room workflows

Status: scope approved by the owner on 2026-10-15. Slices 1–2 implemented and
application regressions verified. Isolation acceptance is blocked by the local
runner configuration. Remaining slices are not implemented.

## Objective

Let an owner coordinate agents through linked rooms with explicit deliverables,
review decisions, and handoffs. Keep domain names, agent jobs, and stage order
configurable. Software delivery is an example configuration, not application logic.

Success means the Studio scenario can progress from Grooming through Release
without confusing agent consensus with designated review or owner authorization.

## Assumptions

- Roles and required reviews belong to a room, not permanently to an agent.
- Existing rooms retain their current consensus behavior unless configured otherwise.
- A facilitator coordinates discussion but receives no extra resource permissions.
- Observers can acknowledge or comment without blocking completion by default.
- Drafts remain inspectable by the owner; they are not automatically delivered as
  final attachments before review. This is a presentation rule, not secrecy from
  the owner.
- A handoff carries selected approved versions, decisions, and open questions,
  not unrestricted history or access grants.
- Workflow approval permits the next stage; deployment and other consequential
  actions still use existing exact-action security approval.
- Work proceeds in tested increments. Durable execution is included in the full
  scope; simultaneous agent work follows durable workspace/conflict handling.

## Product behavior

### Room configuration and reviews

The owner can assign a facilitator, contributors, observers, and required
reviewers. A facilitator can also be a reviewer. The room editor defines required
outputs and whether owner approval is required to finish the stage.

Server validation requires all assigned agents to be members of the room and
Space. Required review cannot be satisfied by an observer acknowledgment or
another agent claiming the reviewer approved. Only the active authenticated
agent task may record that agent's decision. Owner decisions use owner routes.

Room status distinguishes work in progress, awaiting review, changes requested,
awaiting owner approval, and complete. Consensus remains visible separately.
Review decisions include the reviewed version and rationale. A revision
invalidates affected approvals and completion; rejection returns work to its
responsible agent. Pauses, errors, cancellations, and restarts never imply approval.

Changing reviewers, required outputs, membership, or the goal invalidates the
applicable completion gate. Removing an agent cannot silently remove a required
review; the owner must resolve the dependency first.

### Deliverables

Required outputs have a title, responsible agent, content/file version, and
review status. Reuse saved file bytes and existing room result proposals where
possible. Each revision preserves the previous version and its decisions.

Agents can create drafts, submit them for review, request changes, and approve
only versions they are authorized to read. Review is version-specific. Changing
an approved file's content creates a new draft; it never retains approval.

Approved deliverables can be published as final attachments after all applicable
review and owner gates pass. Permission checks cover file listings, downloads,
history, provider context, and handoffs, not just UI visibility.

### Handoff

After completion, show **Pass to next room** beside the composer. The owner
chooses the target Space, room name, participants, and selected approved outputs.
Create a linked destination room with a handoff summary, exact artifact versions,
decisions, and open questions. Starting its agents is a distinct owner action.

Cross-Space transfer is an explicit owner operation with a bounded payload and
source provenance. Extend the existing classified export mechanism rather than
bypassing it. The destination receives only the selected export; source resource
permissions and unrelated source history are not inherited. Validate destination
membership and access at creation and consumption. Preserve revocation behavior.

Repeated submission must not create duplicate destination rooms. Retain source
and destination links. Deleting a room must not silently destroy deliverables or
the review evidence required by a downstream room.

### Durable execution and testing

Persist code changes and explicit checkpoints through the existing isolated
execution boundary. Save approved patches/artifacts before removing workers;
subsequent tasks start from a named immutable checkpoint. Never persist worker
credentials or unrestricted host paths. Conflicts require explicit resolution.

Test evidence records the command/scenario, checkpoint or artifact version,
outcome, and relevant bounded output. Agent agreement cannot substitute for an
actual passing test result. Manual UAT can record owner-provided evidence without
claiming the agent executed it.

Provide suitable, explicitly configured execution profiles for larger builds
and supported application testing. No automatic network/credential access or
weakening of current isolation. Unsupported targets show a blocker.

To support QA continuing while engineers fix defects, introduce bounded task
concurrency only after provider, question, approval, browser, and cancellation
state no longer depend on a single global active job. Agents use separate working
copies. QA tests a pinned checkpoint; a new fix triggers retesting against a new
checkpoint. Non-blocking defects permit continued tests; blockers pause dependent
tests. No unattended merge of conflicting agent changes.

### Reusable stage configuration

Reuse the existing workflow editor/definitions where appropriate. Add a room
stage path instead of a separate orchestration engine. Stage settings contain
Space, participants, roles, required outputs, reviewers, and owner gate.

The Studio example configures:

| Stage | Participants | Outputs and gate |
| --- | --- | --- |
| Grooming | All five | Draft contracts, TRDs, test cases, tasks, UAT scenarios; Lead facilitates |
| Planning | All five | Lead reviews and requests revisions; owner approves development; publish approved files |
| Execution | Lead, Backend, Frontend | Implementation, unit-test evidence, Lead review |
| Testing | Lead, Backend, Frontend, QA | Test results, defect fixes, retest evidence; QA acceptance and Lead review |
| Release | Lead, QA, Release Manager | QA executes UAT; Release Manager approves exact evidence and package; Lead receives green light |

Release green light does not itself deploy. Stage names, participant assignments,
and gates are editable. The same features must work for a non-software review flow.

## Implementation approach

Stack: existing Bun HTTP/SQLite, native JavaScript/HTML/CSS, Playwright. No new
dependencies. Reuse room persistence, proposals, classified data, saved files,
owner approvals, workflow definitions, and the existing UI components.

Follow current module style, for example:

```js
if (review.versionId !== artifact.versionId) throw new Error('Review version changed.');
```

Validate inputs at server boundaries; provider text is never authorization.
Use additive optional room fields where possible. Security metadata that needs
transactional integrity belongs in the existing classified-data layer. Preserve
old saved work and backup affected persistent data before schema changes.

## Ordered implementation slices

Each slice adds a failing behavioral test first, then API/runtime behavior and
the corresponding UI. Split slices further if more than five implementation
files need changes. No runtime feature is declared complete with only a UI check.

| Order | Slice | Acceptance and verification | Main locations |
| --- | --- | --- | --- |
| 1 | Configurable room roles | Save/reload roles; facilitator opens; observers do not impersonate reviewers; legacy room behavior passes | `store.js`, `runtime.js`, room editor, room tests |
| 2 | Enforced review gates | Only designated agents decide; revisions invalidate decisions; blocked completion survives restart | room state/runtime, room status UI, runtime tests |
| 3 | Versioned draft deliverables | Responsible agent submits; reviewer requests changes/approves exact version; no premature final attachment | saved files, classified data, artifact UI, file tests |
| 4 | Owner completion gate | Owner approves exact reviewed result; new versions invalidate approval; actionable approval remains separate | owner routes, runtime, approval UI, API tests |
| 5 | Same-Space handoff | Button creates one linked room with selected approved outputs and configured members | room routes/store, room UI, room tests |
| 6 | Cross-Space handoff | Bounded approved export works; unauthorized, changed, revoked sources fail; no implicit grants | `security/data.js`, server routes, handoff UI, security tests |
| 7 | Durable execution checkpoints | Changes survive task cleanup/restart; cancellation and conflicting updates preserve last valid checkpoint | `execution/`, runtime, checkpoint state, executor tests |
| 8 | Test evidence and execution profiles | Evidence binds to exact checkpoint; supported build/UAT runs produce real results; unsupported execution blocks clearly | execution configuration, runtime, evidence UI/tests |
| 9 | Bounded concurrent work | QA continues independent tests during fixes; job-specific approvals/questions/cancellation remain isolated; conflicts require resolution | scheduler/providers, execution, task UI, isolation tests |
| 10 | Reusable room stages | Configure/run Studio example plus a non-software flow without code changes | `workflows.js`, runtime, workflow editor, workflow tests |
| 11 | End-to-end proof and documentation | Grooming-to-Release scenario exercises review feedback, owner gate, handoff, defect/retest, final package; existing room behavior remains intact | `test/`, `tests/security/`, usage/workflow/execution docs |

Checkpoints after slices 2, 6, and 9: verify acceptance, security implications,
and the remaining plan before extending the next subsystem. Do not represent
early increments as the complete autonomous Studio workflow.

## Verification commands

Run focused files independently because shared native handles can interfere:

```sh
bun test test/core.test.js
bun test test/runtime.test.js
bun test test/rooms.test.js
bun test test/files.test.js
bun test test/workflows.test.js
bun test tests/security/management.test.js
bun run check:workflows
bun run test
```

Add focused regression/security files for new behavior. Browser coverage includes
keyboard access, narrow viewports, role configuration, review feedback, owner
approval, and handoff. Persistence coverage reopens the store after each gate.
Negative checks cover stale versions, forged identity, missing reviewers,
cross-Space access, revoked exports, duplicate handoffs, and concurrent updates.

Execution acceptance additionally requires the pinned disposable Docker images
and supported runner documented in `execution/README.md`. Fixture passes are not
proof of real builds, mobile testing, UAT, or container isolation. No separate
build/lint command exists in the current package scripts.

## Boundaries and risks

- Always preserve Space classification, resource grants, provenance, exact-action
  approvals, validation, cancellation, and accessible controls.
- Review the spec and plan before implementation. No dependencies, deployment,
  live provider inference, or production credentials are required for this proposal.
- Never treat a job name, facilitator role, reviewer decision, imported document,
  or workflow template as permission to deploy or disclose source resources.
- Concurrency is the largest runtime change; durable isolated checkpoints must
  land first. Existing worker limits cannot be advertised as sufficient for
  arbitrary web/mobile applications.
- Formal review proves who approved which version and evidence. It cannot
  guarantee that an agent's engineering judgment or test suite is complete.

## Review decision

The owner approved this scope. The initial implementation checkpoint is room
roles plus enforced review gates; the remaining slices retain the full Studio
workflow as the completion target.

## First implementation checkpoint

Implemented: optional room roles, facilitator opening, separate reviewer
decisions, required contributor confirmations, non-blocking observers, exact
proposal-version checks, change requests, retained prior proposals/reviews,
configuration invalidation, and status UI. New owner messages begin a fresh
discussion and invalidate earlier completion; previous configured discussions
remain in history. Existing rooms retain selected-participant consensus.

Not yet implemented: required artifact slots or artifact review/publication,
owner stage approval, handoffs, durable execution, test-evidence records,
concurrency, and reusable stage definitions. Current review evidence is a
reviewer's recorded rationale, not independent proof of test execution.

Focused checks cover real room tool dispatch, forged/stale decisions, changes
requested, revisions, reload/restart, targeted-message bypass, current resource
and Space grants, optional observers that start offline or disconnect, and a
browser flow at 320/768/1024/1440 pixels. Review and confirmation rationale retains
its source-task provenance; revoking source access blocks subsequent disclosure.

Verification on 2026-10-15: the fresh-process application regression run passed
111 tests with zero failures/skips. The full `bun run test` run executed 223 tests
with 24 failures and zero skips; worker-dependent security checks are blocked by
missing pinned disposable images/runner declaration, and Docker is unreachable.
Evidence: `artifacts/tests/1792047645379-83425/`, including the passing nested
`phase5-regression/results.json` and full `regression.log`. Subsequent focused
checks pass all five room-review tests and the room-review browser test.
No live provider inference or production actions were used.

Reverting this feature removes review-gate enforcement in the older runtime.
Stop configured room discussions before reverting; saved fields alone do not
make an older binary enforce reviews.
