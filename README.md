# Odwyn

**Help with the oddly specific.**

You’ve got twelve tabs open and still haven’t picked a hotel. There’s a price you want to check, a booking to sort out, and something you meant to do yesterday.

Give Odwyn a goal. Your agents can research, compare, discuss the options, and bring back a recommendation, draft, or file. Keep the conversation going as your plans change.

[Get started](docs/SETUP.md) · [See how to use it](docs/USAGE.md) · [Technical guides](#technical-guides)

![How Odwyn works: give it a goal, let your agents research or discuss it using resources you grant, then review the result and approve actions when required.](docs/images/how-odwyn-works.svg)

## Make it yours

Name your agents. Give them different jobs, personalities, and ways of replying. Put them in a room to compare evidence and work toward one shared recommendation, or switch agents inside an existing chat for another perspective.

Save work you repeat as a workflow. Schedule a routine for the next check. Your chats, preferences, and results stay available when you return.

**Oddy** in the top navigation opens the platform assistant from any screen, including Settings, to operate Odwyn in plain language. Oddy keeps one conversation across workspaces and uses the Default workspace's AI provider and account. Ask it to create a workspace or agent, set up workflows and rooms, run or stop jobs, schedule routines, or check progress. It works independently of busy workspace agents and always asks before deletion. Credentials, access grants, worker installation, and execution approvals remain in their existing setup flows. Oddy receives workspace configuration and recent job metadata; it does not read private conversation histories. Open it with the **Oddy** button or **⌘/Ctrl Shift O**. Both chat composers send with Enter; Shift+Enter adds a new line. Oddy includes an attachment button (up to 20 files, 20 MB each) and receives the current workspace, page, dialog, settings section, and selected conversation/agent with each request. The context label shows the current page; passwords and unsaved form contents are not captured. Images and UTF-8 text use the existing attachment reader; binary document extraction remains unavailable in Oddy. The ? tutorial also includes **Ask Oddy**.

| Give Odwyn a goal | Get something you can use |
| --- | --- |
| “Compare hotels near Shinjuku within my budget.” | A shortlist with sources and tradeoffs. |
| “Have my agents review these options together.” | One shared recommendation and decisions left to you. |
| Schedule a research workflow for Mondays. | A recurring task with saved results to review. |

## Your workspace, your rules

Run Odwyn on your computer or VPS. Connect Codex, Claude Code, or an OpenAI-compatible API. Choose which Spaces and resources each agent can use, and whether actions are blocked, automatic, or need your approval.

Use the workspace picker at the top to switch homes, or its + button to create one. Each home has the same features and its own agents, chats, files, browser sessions, connections, and settings. Existing data stays in Default. Tasks and routines continue when you switch away. In Settings → Workspaces, create, rename, or permanently delete a home after confirmation. Stop its tasks before deleting it. The first workspace can be renamed but cannot be deleted.

In Settings → Sharing, enable **Share to all workspaces** for saved appearance, preferences and memory, or AI provider defaults. Future changes from any home stay linked, including newly created homes. Turning sharing off leaves independent copies. Provider sharing includes the API key, requires your owner password, and preserves agent overrides; account sign-ins remain separate.

Browsing and terminal work require configured isolated workers. Website behavior and provider limits still apply. [Set up your workspace](docs/SETUP.md).

## Technical guides

- [Setup, providers, and deployment](docs/SETUP.md)
- [Agents, rooms, resources, and permissions](docs/USAGE.md)
- [Workflows, skills, and routines](docs/WORKFLOWS.md)
- [Development and verification](docs/DEVELOPMENT.md)
- [Isolated browser and terminal execution](execution/README.md)
- [Security operations and backups](docs/security/OPERATIONS.md)
- [Owner security API](docs/security/PHASE4_API.md)
