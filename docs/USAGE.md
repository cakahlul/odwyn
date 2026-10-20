# Use your Odwyn workspace

[Back to Odwyn](../README.md) · [Setup](SETUP.md) · [Workflows](WORKFLOWS.md)

Use the workspace picker to create or switch workspaces. Each keeps its agents, conversations, files, browser sessions and settings. Settings → Workspaces lets you rename or delete a workspace after stopping its tasks. The first workspace cannot be deleted.

Customize agents with their name, focus, appearance, AI provider, skills and knowledge. Settings → Knowledge creates reusable versioned documents; select them under Customize agent → Knowledge. Updated versions load on future tasks.

Send a goal with its constraints and optional attachments. Search past conversations, resume unfinished work, or minimize agents into floating bubbles. The ? button explains the current screen; automatic tutorials can be hidden or reset in Settings.

## Browser and terminal confirmations

Tasks use the selected interaction mode. Ask me confirms browser interactions and terminal commands. Approve safe actions permits low-risk browser controls; commands still require confirmation. Always approve permits routine interactions and commands automatically. Payment and credential interactions still require confirmation. Owner questions pause the task until answered.

Terminal commands run on the host in that workspace’s folder with the server user’s filesystem and network permissions. Files created there can be attached to the conversation. Browser tools use a persistent Chromium session; use takeover for sign-ins, MFA or CAPTCHA. Only public websites are available through the browser proxy.

## Rooms and deliverables

Create a room with a name and two to five agents. Send a shared goal or select one participant. Use `@name` to address an agent. Send updates to redirect the discussion; Stop discussion stops its tasks.

Optional roles select a facilitator, designated reviewers and observers. Contributors confirm one shared result. Designated reviewers separately approve its exact version; changes require revision and fresh confirmations. Observers comment without blocking completion.

Configure required outputs with an author and title. Authors save draft deliverables; reviewers approve exact versions. Optional owner approval gates completion and publication. Published files appear in the room. Pass to next room packages selected approved deliverables, the shared result, next plan and open questions. Later rooms retain their own participants and review gates.

Agents run sequentially within a workspace. Room workflows support configured stages and optional automatic advancement; see [the workflow guide](WORKFLOWS.md).

## Shared settings

Settings includes Appearance, AI provider, Preferences, Workspaces, Sharing, Knowledge and Tutorials. Sharing links saved appearance, preferences or provider defaults across workspaces. Provider sharing includes the API key, requires the owner password and preserves agent overrides. Account sign-ins remain separate.
