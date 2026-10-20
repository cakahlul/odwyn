# Set up Odwyn

[Back to Odwyn](../README.md) · [Using your workspace](USAGE.md) · [Development](DEVELOPMENT.md)

## Run locally

Install Bun and the CLI for your chosen provider, or use an OpenAI-compatible API. Install Chromium with the command below for browser work.

From the project directory:

```sh
bun install --frozen-lockfile
bun run browser:install
bun run setup
bun start
```

Open **http://127.0.0.1:4317**. Sign in with the Basic Auth username and generated password saved in `.env`. Setup keeps that file private and does not print the password.

Terminal commands run directly on the host in the workspace folder. Keep the service under a dedicated ordinary user. Browser and command confirmation follow the interaction mode selected for each task.

## First visit

1. Choose workspace appearance, AI provider, model, reasoning effort, and shared preferences.
2. Save with **Continue to first agent**, then create an agent. It inherits the workspace provider by default.
3. Use **Settings → Knowledge** to create reference documents and assign them in Customize agent.

## Connect a provider

| Provider | Connect it |
| --- | --- |
| Codex | Install Codex CLI. Save the provider, select **Connect**, and follow sign-in. Odwyn uses Codex App Server and your account's available models and limits. |
| Claude Code | Install Claude Code. Save the provider, select **Connect**, open the sign-in link, then paste the returned code into **Complete sign-in**. Terminal sign-in with `claude auth login`, followed by **Refresh**, also works. |
| Antigravity CLI | Install `agy`, sign in with your personal Google subscription and set credit overages to Never. Save **Antigravity CLI**, then **Refresh**. |
| OpenAI-compatible API | Enter the base URL, model, and optional API key. The endpoint must support Chat Completions and function tools. API billing follows your provider. |

For Antigravity, install [the official CLI](https://www.antigravity.google/docs/getting-started?tab=cli), then run `agy` as the operating-system user running Odwyn and sign in with your personal Google subscription. Set **AI Credit Overages → Never** in Antigravity. Odwyn rejects API-key/ADC mode and enabled credit overages, and removes API-key/Cloud overrides from its CLI environment. Exhausted quota does not fall back to API billing.

Choose **Antigravity CLI** globally or for one agent, then Refresh. Use `default`, or a model slug from `agy models`. Workspaces share the host's Antigravity sign-in. `ODWYN_ANTIGRAVITY_COMMAND` overrides the executable. Saved chats, automatic skills and knowledge are supplied on each task. A temporary custom agent disables inherited customizations and built-in tools; Odwyn supplies tools through an authenticated MCP bridge and keeps its existing approval flow.

`bun run check:antigravity` checks the installed CLI with a small subscription inference request.

Workspace Settings sets the default provider. An agent's **AI provider** section can override it. Stop that agent's active work before changing its provider.

Model menus fetch available models. Choose **Enter model manually…** for a custom model or when discovery is unavailable. Reasoning effort applies to the next task; supported levels depend on the model.

API credentials are encrypted by the local credential broker and excluded from browser state. Leave the key blank to keep it for the same endpoint. Changing the endpoint clears it unless you provide a new key.

## Deploy on a VPS

Copy the project without `.env`, `data`, `node_modules`, or `artifacts`. Use a dedicated ordinary user. Install Bun, Node/PM2, the chosen provider CLI, and Chromium's system dependencies. Keep the executables on the process's `PATH`.

Run the local installation commands above. Set `.env` to your exact public HTTPS origin, without a trailing slash:

```dotenv
ODWYN_ORIGIN=https://assistant.example.com
```

Start the supplied PM2 configuration:

```sh
BUN_PATH="$(command -v bun)" pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Follow the startup command PM2 prints, then run `pm2 save` again.

If you use a Cloudflare tunnel, route the hostname to `http://127.0.0.1:4317` on the VPS. The app binds to loopback; its Basic Auth protects the UI, API, files, and owner browser. The public origin must match `ODWYN_ORIGIN` for remote writes.

```sh
pm2 status odwyn
pm2 logs odwyn --lines 50
pm2 restart odwyn --update-env
```

## Configuration

See [.env.example](../.env.example) for the initial configuration. Settings saved through the app control subsequent agent tasks.

| Variable | Purpose |
| --- | --- |
| `ODWYN_USER`, `ODWYN_PASSWORD` | Owner Basic Auth. Password must be at least 16 characters. |
| `PORT`, `ODWYN_ORIGIN` | Port defaults to `4317`; exact permitted origin for writes. |
| `ODWYN_DATA_DIR` | Persistent data directory; defaults to `data`. |
| `ODWYN_CODEX_HOME` | Dedicated Codex sign-in and thread storage; defaults to `data/codex`. |
| `ODWYN_PROVIDER`, `ODWYN_MODEL` | Initial provider and model. |
| `ODWYN_CLAUDE_COMMAND` | Claude executable; defaults to `claude`. |
| `ODWYN_API_BASE_URL`, `ODWYN_API_KEY` | Initial API connection. |
| `ODWYN_BROWSER_EXECUTABLE`, `ODWYN_HEADLESS` | Chromium executable and display settings. |
| `BUN_PATH` | Optional Bun interpreter path for PM2. |

Setup preserves an existing `.env`. Older `SIDEKICK_*` variables remain compatible; `ODWYN_*` takes precedence. Fresh installs use `odwyn.db`; existing `sidekick.db` databases stay in place to preserve saved work.

## Back up or troubleshoot

Stop Odwyn before backing up `.env`, the entire data directory, and any separate Codex home. Include each `broker.key` with the SQLite database: provider keys remain encrypted and require that key.

Upgrading from Access & Autonomy removes its SQLite tables and task metadata automatically, while preserving ordinary history, files, knowledge and encrypted provider credentials. Stop the previous server before upgrading. Saved workflow instructions that name the removed Git/checkpoint tools are converted to terminal Git and test instructions. Old task-bound tokens and access-management endpoints no longer work. Isolation snapshots and Docker worker configuration are no longer used.
