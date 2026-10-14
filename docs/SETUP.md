# Set up Odwyn

[Back to Odwyn](../README.md) · [Using your workspace](USAGE.md) · [Development](DEVELOPMENT.md)

## Run locally

Install Bun and the CLI for your chosen provider, or use an OpenAI-compatible API. Agent browsing and terminal work also need a supported Docker backend: rootless Linux Docker with cgroup v2, or Docker Desktop for local macOS use.

From the project directory:

```sh
bun install --frozen-lockfile
bun run browser:install
bun run setup
bun start
```

Open **http://127.0.0.1:4317**. Sign in with the Basic Auth username and generated password saved in `.env`. Setup keeps that file private and does not print the password.

Setup builds missing worker images, pins their immutable IDs, verifies worker controls and Chromium startup, and saves configuration. Existing credentials and permissions stay intact. Restart an existing Odwyn process after configuring workers.

Without Docker, chat remains usable and isolated tools stay denied. Use `bun run setup --chat-only` to skip worker setup, or `bun run setup --isolation` to require it. Setup explains unavailable isolation and does not install Docker or grant agent access.

For manual worker setup, supported backends, and image upgrades, read [isolated execution](../execution/README.md). Existing pinned images are verified, not automatically replaced; new Interaction support needs the updated browser image.

## First visit

1. Choose workspace appearance, AI provider, model, reasoning effort, and shared preferences.
2. Save with **Continue to first agent**, then create an agent. It inherits the workspace provider by default.
3. Use **Workspace Settings** to create Spaces, resources, connections, and permission templates.
4. Use **Customize agent → Access & Autonomy** to assign membership and grant resource permissions. New resources grant no access by themselves.

## Connect a provider

| Provider | Connect it |
| --- | --- |
| Codex | Install Codex CLI. Save the provider, select **Connect**, and follow sign-in. Odwyn uses Codex App Server and your account's available models and limits. |
| Claude Code | Install Claude Code. Save the provider, select **Connect**, open the sign-in link, then paste the returned code into **Complete sign-in**. Terminal sign-in with `claude auth login`, followed by **Refresh**, also works. |
| OpenAI-compatible API | Enter the base URL, model, and optional API key. The endpoint must support Chat Completions and function tools. API billing follows your provider. |

Workspace Settings sets the default provider. An agent's **AI provider** section can override it. Stop that agent's active work before changing its provider.

Model menus fetch available models. Choose **Enter model manually…** for a custom model or when discovery is unavailable. Reasoning effort applies to the next task; supported levels depend on the model.

API credentials are encrypted by the local credential broker and excluded from browser state. Leave the key blank to keep it for the same endpoint. Changing the endpoint clears it unless you provide a new key.

## Deploy on a VPS

Review the [security release requirements](security/OPERATIONS.md) before a production deployment. Local checks do not approve a security release.

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
| `DOCKER_HOST` | Local Docker socket used by isolated execution. |
| `ODWYN_SANDBOX_IMAGE`, `ODWYN_BROWSER_IMAGE` | Reviewed immutable worker image IDs. |
| `ODWYN_SANDBOX_SNAPSHOTS` | Server-owned workspace snapshot root. |
| `ODWYN_BROWSER_EXECUTABLE`, `ODWYN_HEADLESS` | Owner browser executable/display settings; isolated browsers use their worker image. |
| `BUN_PATH` | Optional Bun interpreter path for PM2. |

Setup preserves an existing `.env`. Older `SIDEKICK_*` variables remain compatible; `ODWYN_*` takes precedence. Fresh installs use `odwyn.db`; existing `sidekick.db` databases stay in place to preserve saved work.

## Back up or troubleshoot

Stop Odwyn before a consistent backup of `.env`, the entire data directory, and any separate Codex home or workspace snapshots. Include the broker key with encrypted credentials. See [security operations](security/OPERATIONS.md) for recovery and worker cleanup.

If a tool says **Setup required**, check worker configuration, restart Odwyn, and review the agent's resource grants. For browser Interaction, verify that the pinned image contains the updated worker. Some websites require scripts, authenticated sessions, or API requests that isolated browsing does not support.
