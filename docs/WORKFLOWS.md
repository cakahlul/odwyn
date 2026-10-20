# Workflows and skills

[Back to Odwyn](../README.md) · [Workspace guide](USAGE.md) · [Development](DEVELOPMENT.md)

## Build a workflow

Open **Workflows & skills** and choose **New workflow**, edit the research template, or import a JSON definition.

Add steps with **+**, drag nodes to arrange them, and connect output ports to input ports. Click a node to configure its agent, instructions, skills, tools, or action. Conditions have True/False ports. Select a connection to delete it; Fit, zoom, and Arrange help navigate the canvas.

Workflow settings hold launch inputs and the execution limit. Connecting back to an earlier step creates a bounded loop. Runs execute in individual chats and retain their definition and skill snapshots.

| Block | Behavior |
| --- | --- |
| Agent | Runs custom instructions with selected tools and text or JSON output. |
| Browser | Uses the workspace browser and selected interaction mode. |
| Terminal | Runs a host command in the workspace folder. |
| Condition | Compares values without executing expressions. |
| Approval | Pauses for owner instructions and optional item selection. |
| Output | Displays mapped text or JSON in chat. |
| Room stage | Runs a configured room goal with participants, deliverables, reviewers, and optional owner approval. |

Workflow steps use their selected tools and the task’s interaction mode. Native MCP tools are available only when the step enables MCP.

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

The result shows selectable records. Submitting sends selected records, owner notes, and original result context to the producing agent as a new task in the same chat after the workflow finishes. It does not resume the workflow or authorize unrelated actions. Selections and notes survive reload; a result can be submitted once.

Use an Approval block when selections should instead feed connected workflow steps. Map its `answer` or `selected` output into the next step.

## Schedule and recover

In **Routines → New routine**, choose an agent and a Task, Skill, or Workflow. Workflows show configured inputs; skills accept optional instructions. Custom repeat intervals range from 15 minutes to one year.

Each scheduled run uses the definition saved when it starts. Update routines when a command is renamed or deleted; invalid commands pause with an error.

Editing a definition affects future runs. Failed, cancelled, or interrupted runs resume their current step through Review & resume; completed steps remain saved. Restarts interrupt unfinished workflows. Automatic retries require a retry count and confirmation that repeating the step is safe.

## Room stages

Create a workflow and add **Room stage** blocks. **Configure room** opens the
existing room editor: choose members, facilitator, reviewers, observers,
required outputs, owner approval. Give each stage a goal and
connect its Next step. Room stages belong together in a room workflow; ordinary
agent/action workflows remain separate.

Supply launch inputs before running. The first room starts immediately. After its
review gates pass, **Pass to next room** uses the snapshotted next stage settings
and lets you select the approved deliverable package. The next room is created
with **Start stage**; creating it does not start its agents. Final stages finish
the workflow. Changing definitions affects future runs. Bounded loops work with
the same explicit handoff gate. Stage instructions accept `{{inputs.name}}` and
run metadata. Previous stages arrive through the selected package, not `steps.*`.

For Studio, create five agent profiles and configure Grooming, Planning, Execution, Testing and Release stages. Give each stage the appropriate authors, reviewers and deliverables. Planning can require owner approval; testing and release deliverables should include actual verification results. The same editor supports Research → Editorial review or other reviewed deliverable flows.

## Launch requirements and attachments

For room workflows, put the run identifier first in Inputs (for example **Feature Identifier**), followed by the requirement or brief. The first input remains a short field and prefixes each generated room title: `Feature001 · Grooming`, `Feature001 · Planning`, and so on. Remaining room-workflow inputs use large, resizable multiline fields. Titles use up to 40 identifier characters and the existing 70-character room-title limit; saved workflow stage names stay unchanged.

The Run workflow dialog accepts files through **Attach files**, image paste, or file drop. Review/remove attachment cards before running. Existing chat limits apply: up to 20 files, 20 MB each. Files are saved in the workspace and included in the first task or room message. Later stages receive selected deliverables through room handoffs. Cancelling or removing an attachment leaves its uploaded file in Files & results, as in chat. Supported text/images are supplied through the existing attachment reader; uploading a binary document does not add a new PDF/Word parser.
