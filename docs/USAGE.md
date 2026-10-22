# Use your Odwyn workspace

[Back to Odwyn](../README.md) · [Setup](SETUP.md) · [Workflows](WORKFLOWS.md)

Use the workspace picker to create or switch workspaces. Each keeps its agents, conversations, files, browser sessions and settings. Settings → Workspaces lets you rename or delete a workspace after stopping its tasks. The first workspace cannot be deleted.

Customize agents with their name, focus, appearance, AI provider, skills and knowledge. Tools → Knowledge lets you create or import text/Markdown documents, search the library and browse pages; select them under Customize agent → Knowledge. Updated versions load on future tasks.

Send a goal with its constraints and optional attachments. Search past conversations, resume unfinished work, or minimize agents into floating bubbles. The ? button explains the current screen; automatic tutorials can be hidden or reset in Settings.

## Browser and terminal confirmations

Tasks use the selected interaction mode. Ask me confirms browser interactions and terminal commands. Approve safe actions permits low-risk browser controls; commands still require confirmation. Always approve permits routine interactions and commands automatically. Payment and credential interactions still require confirmation. Owner questions pause the task until answered.

Terminal commands run on the host in that workspace’s folder with the server user’s filesystem and network permissions. Files created there can be attached to the conversation. Browser tools use a persistent Chromium session; use takeover for sign-ins, MFA or CAPTCHA. Only public websites are available through the browser proxy.

## Rooms and deliverables

Create a room with a name and two to five agents. Send a shared goal or select one participant. Use `@name` to address an agent. Send updates to redirect the discussion; Stop discussion stops its tasks.

Optional roles select a facilitator, designated reviewers and observers. Contributors confirm one shared result. Designated reviewers separately approve its exact version; changes require revision and fresh confirmations. Observers comment without blocking completion.

Configure required outputs with an author and title. Deliverables are collapsed by default; expand a document to read its formatted content, versions and reviews. Authors save drafts; reviewers approve exact versions. Optional owner approval gates completion and publication. Published files appear in the room. Pass to next room packages selected approved deliverables, the shared result, next plan and open questions. Later rooms retain their own participants and review gates.

Agents run sequentially within a workspace. Room workflows support configured stages and optional automatic advancement; see [the workflow guide](WORKFLOWS.md).

## Shared settings

Settings includes Appearance, AI provider, Preferences, Workspaces, Sharing and Tutorials. Sharing links saved appearance, preferences or provider defaults across workspaces. Provider sharing includes the API key, requires the owner password and preserves agent overrides. Account sign-ins remain separate.

## Audit log

Tools → Audit log shows task activity across agents, with agent and creation-time filters and paginated task/event history. Each task records status, configured provider/model, start/end timestamps and elapsed wall time, including pauses for owner input. Running durations update automatically. Audit history survives conversation and agent deletion within its workspace. Deleting the workspace deletes its audit database.

Token counts come from Codex, Claude Code, Antigravity CLI, or compatible API responses when available. Cached/reasoning tokens are included in provider totals, not added twice. Unknown or incomplete data is labelled; old history can only include events retained before this feature. Reported USD charges are preserved when available (currently OpenRouter). Otherwise Codex and supported Antigravity models show **estimated API-equivalent token value**, separately labelled from charges. Estimates use a documented price snapshot verified October 20, 2026; the log details link to its source and show USD rates per million tokens. They use standard short-context pricing, discount reported cached input and price cache writes separately when published. Reasoning tokens already included in output are not added again. Estimates exclude subscription fees, regional/priority/long-context premiums, tools, cache storage and taxes. Google reference rates include documented promotional credits, with their published expiry dates handled automatically; actual eligibility can differ. Pricing changes beyond this snapshot require a catalog update. Unknown model or input/output counts remain unavailable. Older Antigravity `default` logs cannot be priced without a recorded model; new tasks capture the selected CLI model. This local history is not a tamper-proof billing ledger.

Pricing sources: [OpenAI](https://developers.openai.com/api/docs/pricing), [Google Agent Platform](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing), and [Antigravity overages](https://www.antigravity.google/docs/plans/).

## Oddy, the platform assistant

**Oddy** in the top navigation opens the platform assistant from any screen, including Settings, to operate Odwyn in plain language. Oddy keeps its conversations across workspaces and inherits the Default workspace's AI provider and account. Choose an independent Oddy provider under **Settings → AI provider → Oddy**. Ask it to create a workspace or agent, set up workflows and rooms, run or stop jobs, schedule routines, or check progress. It works independently of busy workspace agents and shows a review and requires your approval before every write, including creating, updating, deleting and launching work. Rejecting applies nothing; approval is single use. Provider credentials remain in Settings. Oddy can investigate saved conversations, messages, complete job events, workflow runs, knowledge and user configuration across your workspaces. Reads are paginated and managed credentials are redacted; this does not grant other agents access. File history exposes metadata, not binary file contents. Open it with the **Oddy** button or **⌘/Ctrl Shift O**. Both chat composers send with Enter; Shift+Enter adds a new line. Oddy includes an attachment button (up to 20 files, 20 MB each) and receives the current workspace, page, dialog, settings section, and selected conversation/agent with each request. The context label shows the current page; passwords and unsaved form contents are not captured. Images and UTF-8 text use the existing attachment reader; binary document extraction remains unavailable in Oddy. The ? tutorial also includes **Ask Oddy**. Oddy’s conversation menu includes New chat, New room, chat history, and Clear this chat. New chat preserves previous conversations; clearing requires confirmation and removes only the selected Oddy conversation, keeping uploaded files. Long workspace/context labels are truncated in the header; hover to read the full label.

## Connections

Open **Tools → Connections** to save HTTP/REST requests, GraphQL queries or mutations, unary gRPC calls, or MCP servers. Connections belong to the current workspace and are available to all its agents. Headers, tokens, local-process environment variables, and MCP OAuth credentials use the encrypted credential broker; saved credentials are never returned to the editor or agents. Put credentials in authentication or secret headers, not request bodies or URLs.

For REST, choose a method and JSON, raw text, URL-encoded form, or multipart form fields. Use `{{inputs.id}}` in URL paths/query values and request bodies; URL values are encoded. GraphQL accepts a query, optional operation name, and JSON variables using the same input mapping. gRPC accepts `host:port`, a self-contained protobuf definition, fully qualified service, method, metadata, and JSON body. TLS is enabled by default.

For Atlassian, choose **MCP server → Streamable HTTP**, enter `https://mcp.atlassian.com/v2/mcp`, choose **MCP OAuth sign-in**, save, then select **Sign in**. Your configured `ODWYN_ORIGIN` must be the browser-accessible Odwyn address. Your Atlassian administrator may need to allow that domain. See [Atlassian's setup guide](https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/). Other MCP servers may use bearer/custom headers, legacy SSE, or a trusted local executable using stdio.

To use a localhost MCP OAuth callback while keeping the public UI, set these separately and restart Odwyn:

```dotenv
ODWYN_ORIGIN=https://odwyn.example.com
ODWYN_MCP_OAUTH_ORIGIN=http://127.0.0.1:4317
```

The callback uses Odwyn's existing listener, so its port must match `PORT` (default `4317`), or a local forwarded port. Sign in from your ordinary browser. If Odwyn runs on a remote host, first run `ssh -N -L 4317:127.0.0.1:4317 user@your-odwyn-host` on your browser computer and keep it running during sign-in. The localhost callback may prompt for your Odwyn username/password before returning you to the public UI. Changing the callback clears the previous OAuth client registration and tokens when its saved redirect URI differs; choose **Sign in** again. Atlassian [allows localhost callbacks by default](https://support.atlassian.com/security-and-access-policies/docs/available-atlassian-mcp-server-domains/), but administrators can remove that allowance. This does not change Codex's separate MCP credentials or the managed browser's private-address restrictions.


Select **Test** to supply runtime inputs and inspect response status, headers, and data. For MCP, **Explore tools → Run** discovers tool names and argument schemas; enter a tool name and JSON arguments to execute it. Tests execute immediately and can change external data.

In chat or rooms, ask “Use the Atlassian connection to summarize PROJ-123.” Skills can refer to connections by name. For an agent workflow step, enable **Connections** under **Allowed tools** and describe the saved request or MCP tool to call. Agents discover connections through `odwyn_connection`; calls follow the task's approval mode. Starting a local MCP process also requires approval unless **Always approve** is selected. Stop active tasks before editing or deleting connections.

Current limits: unary gRPC with single-file protobuf (no imports or reflection), GraphQL queries/mutations, multipart text fields, and MCP tools. Streaming/subscriptions, multipart file uploads, MCP resources/prompts, and general API OAuth flows are not implemented. Requests have configurable 1–120 second timeouts; HTTP and returned MCP responses are capped at 1 MB. HTTP redirects are rejected. Owner-configured endpoints may target private services; agents cannot choose another endpoint through runtime inputs.
