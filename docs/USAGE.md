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

## Audit log

Tools → Audit log shows task activity across agents, with agent and creation-time filters and paginated task/event history. Each task records status, configured provider/model, start/end timestamps and elapsed wall time, including pauses for owner input. Running durations update automatically. Audit history survives conversation and agent deletion within its workspace. Deleting the workspace deletes its audit database.

Token counts come from Codex, Claude Code, Antigravity CLI, or compatible API responses when available. Cached/reasoning tokens are included in provider totals, not added twice. Unknown or incomplete data is labelled; old history can only include events retained before this feature. Reported USD charges are preserved when available (currently OpenRouter). Otherwise Codex and supported Antigravity models show **estimated API-equivalent token value**, separately labelled from charges. Estimates use a documented price snapshot verified October 20, 2026; the log details link to its source and show USD rates per million tokens. They use standard short-context pricing, discount reported cached input and price cache writes separately when published. Reasoning tokens already included in output are not added again. Estimates exclude subscription fees, regional/priority/long-context premiums, tools, cache storage and taxes. Google reference rates include documented promotional credits, with their published expiry dates handled automatically; actual eligibility can differ. Pricing changes beyond this snapshot require a catalog update. Unknown model or input/output counts remain unavailable. Older Antigravity `default` logs cannot be priced without a recorded model; new tasks capture the selected CLI model. This local history is not a tamper-proof billing ledger.

Pricing sources: [OpenAI](https://developers.openai.com/api/docs/pricing), [Google Agent Platform](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing), and [Antigravity overages](https://www.antigravity.google/docs/plans/).

## Oddy, the platform assistant

**Oddy** in the top navigation opens the platform assistant from any screen, including Settings, to operate Odwyn in plain language. Oddy keeps its conversations across workspaces and inherits the Default workspace's AI provider and account. Choose an independent Oddy provider under **Settings → AI provider → Oddy**. Ask it to create a workspace or agent, set up workflows and rooms, run or stop jobs, schedule routines, or check progress. It works independently of busy workspace agents and shows a review and requires your approval before every write, including creating, updating, deleting and launching work. Rejecting applies nothing; approval is single use. Provider credentials remain in Settings. Oddy can investigate saved conversations, messages, complete job events, workflow runs, knowledge and user configuration across your workspaces. Reads are paginated and managed credentials are redacted; this does not grant other agents access. File history exposes metadata, not binary file contents. Open it with the **Oddy** button or **⌘/Ctrl Shift O**. Both chat composers send with Enter; Shift+Enter adds a new line. Oddy includes an attachment button (up to 20 files, 20 MB each) and receives the current workspace, page, dialog, settings section, and selected conversation/agent with each request. The context label shows the current page; passwords and unsaved form contents are not captured. Images and UTF-8 text use the existing attachment reader; binary document extraction remains unavailable in Oddy. The ? tutorial also includes **Ask Oddy**. Oddy’s conversation menu includes New chat, New room, chat history, and Clear this chat. New chat preserves previous conversations; clearing requires confirmation and removes only the selected Oddy conversation, keeping uploaded files. Long workspace/context labels are truncated in the header; hover to read the full label.
