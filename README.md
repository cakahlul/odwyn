# Odwyn

**Help with the oddly specific.**

Odwyn means “a companion for your particular way of doing things.” The name is invented. The “odd” gives it character: everyone has their own habits, interests, and oddly specific requests. Odwyn makes room for yours.

You’ve got twelve tabs open and still haven’t picked a hotel. There’s a price you want to check, a booking to sort out, and something you meant to do yesterday.

Give Odwyn a task. It browses, compares, and brings back what it finds. You can watch its browser, step in for a sign-in, or ask another agent to take a look. Your chats stay together, so you can pick up where you left off.

Name your agents. Give them different jobs. Tell them how you like things done.

## Run locally

Requires Bun and Chromium, plus your chosen AI provider: Codex CLI with ChatGPT sign-in, Claude Code CLI with sign-in, or an OpenAI-compatible API endpoint. Tested with Bun 1.3.9, Codex CLI 0.160.0, and Playwright 1.58.2.

```sh
cd ~/labs/odwyn
bun install --frozen-lockfile
bun run browser:install
bun run setup
bun start
```

Open **http://127.0.0.1:4317**. Use the Basic Auth username and generated password in `.env`. Setup creates a private file and never prints the password.

First-time setup starts with workspace colors and motion, then asks you to create your first agent and choose its AI provider. Update workspace defaults in Settings and each agent from its sidebar menu. Add up to **five agents total** with **Add agent** in the sidebar. Each agent has its own avatar, personality, routines, provider and model. **Settings → Workspace appearance** controls the shared palette and motion; agents inherit that theme unless their workspace override is enabled. Conversations are shared: choose **Reply with** to continue the same chat with another agent. Replies display their agent’s name, and each agent keeps its own provider session. Use the **⋯** beside any sidebar agent for **Customize agent**, **AI provider**, or **Delete agent**. Deletion keeps chats and files, removes its routines, and requires its tasks and shared room discussions to be stopped. Keep at least one agent; rooms with one remaining participant become ordinary chats. Agent customization applies to the selected agent. **Reasoning effort** is saved alongside its model and used on the next task; **Model default** leaves effort to the provider. Custom models may support only some levels. Codex, Claude Code and OpenAI-compatible APIs all use the same agent workflow; API models still need tool calling and vision for screenshots. CLI sign-ins, saved owner preferences, files and the browser session are shared. Every agent receives Caveman ultra brevity instructions and Ponytail ultra coding instructions on every thread start or resume, including Codex app-server startup. Routine replies default to at most three short lines and 35 words; room discussion defaults to 30 words per turn. Routine explanations use terse fragments instead of conversational paragraphs. Complete deliverables, explicit requests for detail, safety and accuracy can require more. Brevity overrides tone and reply-depth settings while preserving accuracy, safety, evidence, requested language, and result formats.

Use **Rooms → +** to create a named conversation with 2 to 5 agents. Enter a goal with **All agents** selected: participants discuss the goal as equals in a group chat, responding directly to each other’s questions, evidence and disagreements. The opener is selected by keyword overlap with each agent’s specialization; equally relevant agents rotate across discussions. Agents use `odwyn_room_next` to invite whoever should respond next, including someone who already spoke, instead of following a fixed reporting order. Without an invitation, waiting participants get their turn. Every reply receives the current shared discussion, and agents continue until material questions are resolved and everyone verifies the same recommendation. A proposal includes the result and next plan; revisions reset agreement, while confirmations carry across rounds if the proposal stays unchanged. Once all selected participants agree, the room publishes one report under the opening participant and stops redundant queued turns. The report includes recommendations, tradeoffs, remaining disagreements and decisions left to you; confirming a report verifies its accuracy, not identical personal preferences. Discussion and results remain visible. Agents debate evidence and tradeoffs to improve the shared outcome, produce drafts early for writing tasks, and stop when the requested result is verified. Automatic turns continue progress instead of repeatedly answering the last owner message. Type **@agentname** to call a specific participant; suggestions insert names with spaces as **@"Agent Name"**. Mentions override **Send to**; multiple mentions involve those participants. A single recipient continues until it verifies completion. Send a new message anytime to interrupt current and queued turns and redirect the agents while preserving the unfinished goal, compatible requirements, prior work, and provider sessions; messages without mentions default to everyone after each send. **Stop discussion** stops the whole room; **Continue discussion** starts again. Discussions pause on errors, service restarts, or after at most 30 turns or one hour; review progress before continuing. Owner questions and action approvals pause work until your response. Late provider replies cannot dismiss a pending question, and live updates preserve the answer being typed, focus, and cursor. Every participant has the same browser, terminal, memory, and scheduling tools as an individual chat. The selected approval mode applies to each turn; detected browser payments and credentials still require approval. Terminal commands follow the selected mode. Agents share the browser in turn and must not repeat completed actions. Click the room name to see participants, continue, rename, edit, or delete the room. Deletion requires stopped tasks and confirmation, removes messages and task runs from history and recall, and keeps agents and saved files. Room details stay closed by default; floating agent bubbles are hidden. Click a participant in details to open provider settings. Room names, membership, goals, and messages persist; **Edit room** changes the name or participants after active turns finish.

Select an agent in the sidebar to open its last workspace. **Minimize** animates the current workspace into a floating bubble showing its name. Select the bubble to restore it; drag it anywhere, or use Alt + arrow keys while focused. Bubble positions persist across visits. **Close** removes the workspace and bubble without deleting the conversation; reopen it from the sidebar or conversation history. Drafts, attachments, permission choices and the last view survive switching and reloads in the same tab. The selected agent persists across visits. Bubbles show working or pending-input status; minimizing does not stop tasks. Reduced-motion settings skip the transition.

**Odwyn settings** controls global workspace appearance, shared preferences, and currency. In **Customize agent → Workspace**, enable **Override workspace settings** to choose a palette and motion preference for that agent. Overrides apply while the agent is active; disabling them restores the global settings.

Change an agent’s provider, model, and reasoning effort in **Customize agent → AI provider**. Stop that agent’s active work before changing providers; its saved chats and routines remain. Provider sessions restart when switching providers, with the existing chat supplied as context. All agents use one browser queue: ready tasks run one at a time, and tasks for agents awaiting sign-in wait until connected.

- **Codex:** uses App Server and ChatGPT subscription sign-in. Save the provider, then select **Connect** in the agent’s AI provider tab and follow device-code sign-in.
- **Claude Code:** uses the same Agent SDK `query()` launcher as `channels-listener`, which starts Claude Code on the server. Run `claude auth login` under the user running Odwyn, choose Claude Code in the agent’s AI provider tab, and refresh. Default model: `sonnet`. Set `ODWYN_CLAUDE_COMMAND` for a custom executable.
- **OpenAI-compatible API:** enter a base URL (for example, `https://api.openai.com/v1` or `http://localhost:1234/v1`), model, and API key. Requests use standard `/chat/completions` messages and function tools. Tool calling is required; screenshots require vision support. Keys are optional for local endpoints, stored in the private SQLite database, and excluded from browser state. Leave the key blank to keep it for the same URL; changing URLs clears it unless a new key is entered. API billing applies.

For Codex, if device authorization is disabled for your account, enable it in ChatGPT settings or sign in from the VPS terminal:

```sh
CODEX_HOME="$PWD/data/codex" codex login --device-auth
```

The Codex provider uses ChatGPT subscription authentication rather than API-key billing. Your account's Codex limits and model availability still apply. Subscription sign-in follows [Codex authentication](https://learn.chatgpt.com/docs/auth).

## Using it

- **Chat:** give an outcome; follow-up messages continue the selected provider’s conversation. Saved chats remain searchable across providers.
- **Browser:** browsing opens a live preview in the active conversation, including rooms. **Minimize** replaces it with a floating **Live browser** button. **Browser controls** opens tabs, activity and takeover. **Take control** pauses subsequent agent actions; **Hand back** resumes them. Answer any pending question after completing a sign-in.
- **Terminal:** ask an agent to run commands or work with local files. All providers use `odwyn_terminal`, a non-interactive `/bin/sh` in `data/workspace` (or the configured data directory). **Ask me** and **Approve safe actions** show each command’s full text for approval. **Always approve** runs task-related terminal commands automatically. The approval card also offers **Always approve**, and changing the permission selector to that mode releases a pending command. Commands run with the server user’s filesystem, environment and network permissions, without a sandbox. Default timeout: 30 seconds; maximum: 120 seconds. Output is capped at 32 KiB per stream. Stop, shutdown and timeout kill the command and its process group. No interactive terminal or persistent shell; use `cd` inside a command when needed.
- **Approvals:** **Ask me** confirms interactions; **Approve for me** automatically permits recognized navigation, search and filtering; **Always approve** permits terminal commands and browser actions needed for the task, including coordinate clicks, catalogue controls, and targets without inspectable metadata. Changing this selector updates current work and releases pending browser interactions and terminal commands permitted by the new mode. Arbitrary shell commands ask in Ask me and Approve safe actions modes. Detected payment-related controls and credential entry always ask. Unknown targets ask in the other two modes. Payment detection uses current page URLs, form context, labels and payment-field metadata; it cannot guarantee the effect of an uninspectable control. Modes do not authorize unrelated actions.
- **Routines:** queue work once or repeatedly, with a minimum 15-minute interval. Pause or delete routines from the app. Execution does not depend on keeping the web app open.
- **Files & results:** upload files for website forms; retrieve downloads, saved screenshots, and AI-generated deliverables. Agents create requested files in the shared workspace using approved terminal commands, then attach them with `odwyn_send_file`. Attachments appear beside the producing agent’s answer in both chats and rooms and remain downloadable after later turns and reloads. PNG, JPEG, GIF, WebP, AVIF, and SVG images have inline previews; click an image to open its preview. Downloads and previews require authentication; previews use detected image content, with scripts and external resources disabled. Uploads and generated attachments are limited to 20 MB. Approved terminal commands can inspect local documents using tools installed on the host.
- **Currency:** choose **Settings → Preferred currency**, then **Save preferences**. It applies to all agents on future tasks. Original source prices remain visible; converted estimates require a verified exchange-rate source and date. Receipts retain the original charged currency.
- **Memory:** inspect and edit preferences in Settings. The assistant can search related saved conversations using `odwyn_search`: SQLite FTS5 ranks keyword matches across 1,500-character message chunks and returns up to five excerpts. Chat history and this index survive restarts and provider changes. Memory is context, not permission to perform new actions.
- **Stop / Review & resume:** stop execution or continue an interrupted task after checking what already happened on the website.

One task uses the shared browser at a time. Other tasks wait in a persistent queue. A restart marks unfinished active work as interrupted; it requires review before resuming. Recurring schedules do not duplicate queued, active or interrupted runs.

## VPS, PM2 and your existing tunnel

Copy the project to your VPS without `.env`, `data`, `node_modules` or `artifacts`. Run as a dedicated ordinary user. Install Bun, Node/PM2, Chromium dependencies, and the CLI needed for your selected provider. Keep `bun` and that CLI available on the process's `PATH`.

From the project directory:

```sh
bun install --frozen-lockfile
bunx playwright install --with-deps chromium
bun run setup
```

Edit `.env`: set `ODWYN_ORIGIN` to the **exact public HTTPS origin**, without a trailing slash. Example:

```dotenv
ODWYN_ORIGIN=https://assistant.example.com
```

Then start the supplied PM2 configuration:

```sh
BUN_PATH="$(command -v bun)" pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the startup command PM2 prints, then `pm2 save`. The configuration uses one instance, automatic restarts and graceful shutdown. [Bun's PM2 guide](https://bun.sh/guides/ecosystem/pm2) documents the interpreter configuration.

In your existing Cloudflare tunnel, route the chosen hostname to **HTTP → 127.0.0.1:4317** on this VPS. The app binds to loopback. Its Basic Auth protects the UI, API, browser screenshots and files. Keep the hostname's HTTPS origin identical to `ODWYN_ORIGIN`; remote writes fail otherwise. See [Cloudflare published applications](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/).

Open the HTTPS hostname, authenticate, and configure your AI provider through Customize agent. Website logins happen in Odwyn's own persistent browser through takeover.

```sh
pm2 status odwyn
pm2 logs odwyn --lines 50
pm2 restart odwyn --update-env
```

Chromium installation on Linux follows [Playwright's browser instructions](https://playwright.dev/docs/browsers). If Chromium cannot launch, check its system dependencies and the VPS user's browser cache.

## Configuration

| Variable | Default / purpose |
| --- | --- |
| `ODWYN_USER` | Basic Auth username, generated setup uses `owner` |
| `ODWYN_PASSWORD` | Required; at least 16 characters |
| `PORT` | `4317`; server binds to `127.0.0.1` |
| `ODWYN_ORIGIN` | Local loopback origin, or your exact public HTTPS origin |
| `ODWYN_DATA_DIR` | Project's `data` directory |
| `ODWYN_CODEX_HOME` | `data/codex`; dedicated subscription sign-in and threads |
| `ODWYN_PROVIDER` | Initial provider: `codex`, `claude`, or `openai`; Agent customization overrides it after saving |
| `ODWYN_MODEL` | Initial model: `gpt-6.1-sol` for Codex, `sonnet` for Claude; required for API mode. Codex uses medium reasoning |
| `ODWYN_CLAUDE_COMMAND` | `claude`; executable used for sign-in checks and SDK spawning |
| `ODWYN_API_BASE_URL` | Initial API base URL, defaults to `https://api.openai.com/v1` |
| `ODWYN_API_KEY` | Initial API key; Agent customization stores later changes privately |
| `ODWYN_BROWSER_EXECUTABLE` | Optional absolute Chromium executable path |
| `ODWYN_HEADLESS` | `true`; `false` requires a desktop/display |
| `BUN_PATH` | Optional absolute Bun interpreter path when starting PM2 |

Setup preserves an existing `.env`. Existing `SIDEKICK_*` variables still work; `ODWYN_*` values take precedence. Fresh installs use `odwyn.db`; existing `sidekick.db` databases stay in place to preserve chats, credentials, and SQLite journal files. Older provider sessions restart once with the updated tools and saved chat context. Browser preferences and older reply cards remain usable. If you copy `.env.example` yourself, fill in a strong password before starting.

## Data and limits

SQLite stores chats, searchable message chunks, provider configuration, API credentials, task state, routines and preferences. The `data` directory also contains browser sessions, downloads, uploads and Codex credentials. Stop Odwyn before making a consistent backup of `.env` and the entire `data` directory. Protect backups like account credentials. If you override the data directory or Codex home, include those paths too.

The process stays available without running inference when idle. A task pauses after 120 tool calls or its one-hour run deadline. Browser interactions are serialized; this version serves one owner, with history stored in a single SQLite JSON row. Large histories will eventually need indexed storage and pagination.

Browser access is restricted to public HTTP/HTTPS sites on ports 80/443. A local filtering proxy resolves and pins public IPs, blocks private/reserved destinations and applies to subresources and redirects. The browser tool has no arbitrary JavaScript. Approved terminal commands can access the host filesystem and network, including destinations blocked by the browser proxy; the browser restrictions do not sandbox terminal work. Native provider tools and Codex escalation requests remain disabled or declined. Its browser content is still untrusted, and consequential actions depend on clear owner authorization.

Some sites block automation or require MFA/CAPTCHA/manual steps. The service can remain up around the clock; successful unlimited unattended work depends on subscription limits, sessions, website behavior and owner input. Browser interaction permissions alone cannot guarantee the assistant's judgment.

## Verification

```sh
bun test
bun run check:browser
bun run check:codex
```

Tests cover the five-agent cap (including simultaneous creation), agent/provider isolation, shared conversations and attributed replies, room membership, discussion context, whole-round cancellation, credential redaction, API request/tool formats, Claude SDK streaming and session resume, chat recall, authentication, same-origin writes, uploads, persistence, schedule deduplication, approvals, cancellation, browser dialogs and private-network rejection. Provider inference is mocked in unit tests. `test/rooms.test.js` exercises the room workflow with streamed provider events and responsive screenshots. `check:browser` exercises agent creation, provider selection, switching drafts and permissions, shared-chat agent selection, draggable bubbles, close/reopen, keyboard controls, reduced motion, reload persistence and Chromium takeover at 320/768/1024/1440 widths; screenshots go to `artifacts`.

`check:codex` uses subscription inference and therefore consumes Codex allowance. It temporarily copies an existing local Codex `auth.json` into an isolated test home, navigates to example.com, sends an actual screenshot to the model, verifies the result and continues the same conversation. The temporary directory is removed afterward. Set `ODWYN_SMOKE_CODEX_HOME` to select the signed-in source home.

For optional WCAG checks, install `@axe-core/playwright` outside this project and set `ODWYN_AXE_PATH` to its absolute `dist/index.mjs` path when running `check:browser`.

## Implementation and references

Bun HTTP and SQLite, native HTML/CSS/JavaScript, Playwright Chromium, and [Codex App Server](https://learn.chatgpt.com/docs/app-server). Providers reuse the same task and approval runtime. Codex uses App Server dynamic tools; Claude uses [Agent SDK custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools) with Zod schemas; API mode uses native `fetch` and [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). Claude’s built-in tools, skills, hooks, and external MCP configuration are disabled.

UI references: [Nexus sidebar exploration](https://dribbble.com/shots/26923064-Nexus-AI-Chat-Application-Sidebar-Options-Exploration) and [Molleya chat dashboard](https://dribbble.com/shots/27205623-Molleya-aio-AI-Chat-Knowledge-Management-Dashboard-UI). Odwyn uses original SVG artwork, system fonts, warm paper/sage colors and an orange accent.
