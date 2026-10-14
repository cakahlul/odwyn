# Use your Odwyn workspace

[Back to Odwyn](../README.md) · [Setup](SETUP.md) · [Workflows and skills](WORKFLOWS.md)

## Agents and conversations

Create up to five agents. Give each a name, avatar, specialization, reply style, and optional provider override. Use the agent's **⋯** menu to customize it, change its provider, or delete it.

Choose **Reply with** to continue a conversation with another agent. Replies identify their author; agents keep separate provider sessions. Chats and files survive agent deletion. Active work and room discussions must be stopped first, and at least one agent must remain.

Minimize an agent workspace into a floating bubble and restore it later. Drag the bubble or move it with Alt + arrow keys. Closing a workspace keeps its conversation. Switching agents preserves drafts and attachments; minimizing does not stop tasks.

## Rooms

Create a room with two to five agents and give them a shared goal. Agents discuss evidence and tradeoffs, invite relevant participants, and work toward one recommendation. The room publishes a shared report after all selected participants confirm the same result.

Use `@agentname` to address a participant; names with spaces use `@"Agent Name"`. Send another message to redirect the discussion. **Stop discussion** stops the whole room; **Continue discussion** resumes after review.

Rooms pause for owner questions, approvals, errors, restarts, or their discussion limit. Review what happened before continuing. Deleting a stopped room removes its messages and task history while keeping agents and saved files.

## Shared data lives in Workspace Settings

Settings has separate sections for **Appearance**, **AI provider**, **Preferences**, **Spaces**, **Resources**, **Connections**, and **Permission templates**.

| Item | What it does |
| --- | --- |
| Space | Groups resources and binds task context. A conversation keeps its original Space. |
| Resource | A named target or scope, such as Browsing, a repository, notes, or an isolated workspace. |
| Connection | Stores a reviewed service adapter, endpoint, and encrypted credential used by linked resources. Creating one grants no agent access. |
| Permission template | Suggests an action selection for a resource. Apply it to an agent, review modes, then save access. It does not copy exact Ask/Automatic modes. |

Create, edit, or delete these items in Settings. Successful creation clears fields and selects the new item. Editing prefills saved configuration and offers Save/Cancel. Resource types and Spaces stay fixed when editing.

Changing a target or connection credential revokes affected agent permissions, including wildcard access. Stop tasks in the Space before changing configuration. Deletion confirms its impact and checks dependencies. Spaces referenced by history cannot be deleted; resource deletion preserves history and removes its grants. Connections can be disabled or permanently removed after unlinking their resources.

## Agent access

Open **Customize agent → Access & Autonomy**. Assign Spaces, choose a resource, and set each action to **Blocked**, **Ask first**, or **Automatic**. Preview shows effective permissions grouped by resource name, Space, and ID. Save access before switching resources.

Space membership alone grants no resource access. Platform availability, explicit denies, expiry, pauses, and connection state still apply. High-impact actions always require fresh owner approval of their exact target and parameters.

Under **Permission templates & restrictions**, apply a template, set expiry or allowed Git branch prefixes, block actions across a Space, or revoke a resource. Manage the templates themselves in Workspace Settings.

Emergency pause can stop an agent, a Space, or all automation. Resume allows new work; it does not replay stopped tasks or approvals. Legacy chat interaction modes do not grant browser, terminal, or MCP access.

## Browsing

New Browsing resources allow public websites except optional blocked domains. Blocking `example.com` also blocks its subdomains. An empty blocklist has no owner domain exclusions; private and reserved networks remain blocked.

- **Open pages:** fetch a permitted public HTML page. Redirects receive the same domain and public-address checks.
- **Read page content:** return text, links, and element references. Required for navigation and interaction results.
- **Interaction:** use local page controls, such as a Show more button. Grant it separately; Ask first requires an exact approval.

Use Open pages for ordinary links. External scripts, API-backed buttons, network form submissions, authenticated sessions, screenshots, and downloads are unavailable to the isolated agent browser. Inline scripts may run during an approved interaction; visible DOM and form values persist, while JavaScript runtime state resets between calls.

Existing website resources keep their exact URL allowlists. Explicitly switching to public-web Browsing revokes access for review. Interaction also needs the updated browser image; see [worker setup and upgrades](../execution/README.md).

## Files, memory, and routines

Files & results keeps uploads and generated deliverables. Agents need granted isolated workspace/file access to produce and attach files. Uploads and attachments are limited to 20 MB. Supported image types have inline previews.

Shared preferences live in Settings. Saved chats remain searchable across restarts and provider changes; agent recall remains subject to Space and resource access. Memory supplies context, not permission for new actions.

Routines queue a task, skill, or workflow once or on a repeating schedule. The minimum interval is 15 minutes. They run while the server is available even if the web app is closed. Pause or delete them from the Routines view.

Use **Task runs** to inspect progress. **Stop** ends execution; **Review & resume** continues interrupted work after you check what already happened. Provider limits, website behavior, and requests for your input can pause a task.
