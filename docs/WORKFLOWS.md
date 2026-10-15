# Workflows and skills

[Back to Odwyn](../README.md) · [Workspace guide](USAGE.md) · [Development](DEVELOPMENT.md)

## Build a workflow

Open **Workflows & skills** and choose **New workflow**, edit the research template, or import a JSON definition.

Add steps with **+**, drag nodes to arrange them, and connect output ports to input ports. Click a node to configure its agent, instructions, skills, tools, or action. Conditions have True/False ports. Select a connection to delete it; Fit, zoom, and Arrange help navigate the canvas.

Workflow settings hold launch inputs and the execution limit. Connecting back to an earlier step creates a bounded loop. Runs execute in individual chats and retain their definition and skill snapshots.

| Block | Behavior |
| --- | --- |
| Agent | Runs custom instructions with selected tools and text or JSON output. |
| Browser | Requests a browser action through the agent's resource permissions. |
| Terminal | Runs a command in the granted isolated workspace. |
| Condition | Compares values without executing expressions. |
| Approval | Pauses for owner instructions and optional item selection. |
| Output | Displays mapped text or JSON in chat. |
| Room stage | Runs a configured room goal with participants, deliverables, reviewers, and optional owner approval. |

Workflow tool selection does not grant access. Browser, terminal, and connector operations still require resource permissions and a configured executor. Raw provider MCP servers and their read-only annotations cannot authorize access; use reviewed connections and scoped resources.

## Run commands

Give the workflow a command and invoke it from chat:

```text
/research Odwyn
$research Odwyn
/research {"topic":"Odwyn","audience":"engineering"}
```

Plain arguments fill the first input. Multiple inputs use JSON. Missing required inputs pause for an answer. Typing `/` or `$` shows available commands; Run opens an input form.

## Map data between steps

Use references such as:

```text
{{inputs.topic}}
{{steps.research}}
{{steps.research.findings}}
{{steps.review.answer}}
{{steps.review.selected}}
{{run.visits}}
```

A reference occupying the entire value retains its JSON type; embedded references become text. Missing references fail the step. Terminal references must stay outside shell quotes and heredocs; the runner quotes mapped values as shell arguments.

## Create or import a skill

Skills are reusable named instructions. Select them on agent steps, assign them as agent defaults, or invoke their `/command` or `$command` in chat. The chat shows the submitted command; the agent receives expanded instructions.

Import skill accepts a `SKILL.md` under 30 KB with YAML frontmatter: `name`, optional `description`, and optional `command`. Review the draft and resolve command conflicts before saving. Importing never overwrites an existing skill. Bundled scripts and resources are not imported.

Names can be up to 80 characters, descriptions 500, and instructions 20,000. Workflow and skill commands must be unique. When moving definitions between workspaces, update agent and skill IDs.

## Interactive results

On an Agent or Output node, open **Interactive response**. Set the returned array field, button text, and follow-up instructions. Leaving instructions empty keeps the result read-only.

The result shows selectable records. Submitting sends selected records, owner notes, and original result context to the producing agent as a new task in the same chat after the workflow finishes. It does not resume the workflow or grant new resource access. Selections and notes survive reload; a result can be submitted once.

Use an Approval block when selections should instead feed connected workflow steps. Map its `answer` or `selected` output into the next step.

## Schedule and recover

In **Routines → New routine**, choose an agent and a Task, Skill, or Workflow. Workflows show configured inputs; skills accept optional instructions. Custom repeat intervals range from 15 minutes to one year.

Each scheduled run uses the definition saved when it starts. Update routines when a command is renamed or deleted; invalid commands pause with an error.

Editing a definition affects future runs. Failed, cancelled, or interrupted runs resume their current step through Review & resume; completed steps remain saved. Restarts interrupt unfinished workflows. Automatic retries require a retry count and confirmation that repeating the step is safe.

## Room stages

Create a workflow and add **Room stage** blocks. **Configure room** opens the
existing room editor: choose Space, members, facilitator, reviewers, observers,
required outputs, owner approval, and concurrency. Give each stage a goal and
connect its Next step. Room stages belong together in a room workflow; ordinary
agent/action workflows remain separate. No resource access is inherited.

Supply launch inputs before running. The first room starts immediately. After its
review gates pass, **Pass to next room** uses the snapshotted next stage settings
and lets you select the package and optional checkpoint. The next room is created
with **Start stage**; creating it does not start its agents. Final stages finish
the workflow. Changing definitions affects future runs. Bounded loops work with
the same explicit handoff gate. Stage instructions accept `{{inputs.name}}` and
run metadata. Previous stages arrive through the selected package, not `steps.*`.

For Studio, create the workspace, five agent profiles and five Spaces in Settings.
Grant each agent only the resources needed in its Spaces. Configure these stages:

| Stage | Participants and roles | Required package / gate |
| --- | --- | --- |
| Grooming | Lead facilitates; Backend, Frontend, QA contribute; Release observes | Contracts, TRDs, draft cases and tasks, UAT scenarios; Lead reviews drafts |
| Planning | All five; Lead facilitates/reviews | Revised TRDs/contracts and plan; owner approval publishes development files |
| Execution | Lead, Backend, Frontend; Lead reviews; optional concurrency | Implementation checkpoint and actual unit-test evidence |
| Testing | Lead, Backend, Frontend, QA; QA and Lead review | Cases, defect fixes, passing retests at the current checkpoint |
| Release | Lead, QA, Release Manager; Release Manager reviews | QA UAT evidence, approved TRDs and release package; green light to Lead |

Put the responsibilities and ritual in each stage goal, including asking the
owner about unclear requirements. Define evidence outputs for gates requiring
actual test results. Reissue imported draft documents as the next stage's required
outputs so its reviewers approve those exact versions. Transfer a checkpoint into
an empty destination workspace resource and grant execution/read access there.
Do not copy source grants. The same editor supports Research → Editorial review
or any other reviewed deliverable flow; these stage names have no special logic.
