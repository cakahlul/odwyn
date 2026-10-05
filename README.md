# Sidekick

A personal browser assistant, separate from The Office. Chat with it, watch the browser, take over for sign-ins, and keep tasks running while the chat tab is closed.

## Run locally

Requires Bun, Codex CLI on `PATH`, and a ChatGPT account with Codex access. Tested with Bun 1.3.9, Codex CLI 0.160.0, and Playwright 1.58.2.

```sh
cd ~/labs/sidekick
bun install --frozen-lockfile
bun run browser:install
bun run setup
bun start
```

Open **http://127.0.0.1:4317**. Use the Basic Auth username and generated password in `.env`. Setup creates a private file and never prints the password.

Open **Settings → Connect Codex**, follow the ChatGPT device-code sign-in, then submit a task. If device authorization is disabled for your account, enable it in ChatGPT settings or sign in from the VPS terminal:

```sh
CODEX_HOME="$PWD/data/codex" codex login --device-auth
```

The app uses Codex App Server with ChatGPT subscription authentication. It does not use an API key or switch to API billing. Your account's Codex limits and model availability still apply. Subscription sign-in follows [Codex authentication](https://learn.chatgpt.com/docs/auth).

## Using it

- **Chat:** give an outcome; follow-up messages continue the same Codex thread.
- **Browser:** open the live view from the header, expand it for readable website interactions, or inspect the Activity tab. **Take control** pauses subsequent agent actions. Click the page, use the typing box and keys, then **Hand back**. Answer the assistant's pending question after completing a sign-in; reply drafts survive takeover updates.
- **Confirm interactions:** approve individual clicks, typing, uploads and browser dialogs. **Allow this run** permits browser interactions for that task. Authorizing spending, sending or deletion requires clear instructions separately.
- **Routines:** queue work once or repeatedly, with a minimum 15-minute interval. Pause or delete routines from the app. Execution does not depend on keeping the web app open.
- **Files & results:** upload files for website forms; retrieve downloads and saved screenshots. Uploads are limited to 20 MB. This browser-only version does not parse local documents.
- **Memory:** inspect and edit preferences in Settings. Memory is context, not permission to perform new actions.
- **Stop / Review & resume:** stop execution or continue an interrupted task after checking what already happened on the website.

One task uses the shared browser at a time. Other tasks wait in a persistent queue. A restart marks unfinished active work as interrupted; it requires review before resuming. Recurring schedules do not duplicate queued, active or interrupted runs.

## VPS, PM2 and your existing tunnel

Copy the project to your VPS without `.env`, `data`, `node_modules` or `artifacts`. Run as a dedicated ordinary user. Install Bun, Codex CLI, Node/PM2, and Chromium dependencies there. Keep `bun` and `codex` available on the process's `PATH`.

From the project directory:

```sh
bun install --frozen-lockfile
bunx playwright install --with-deps chromium
bun run setup
```

Edit `.env`: set `SIDEKICK_ORIGIN` to the **exact public HTTPS origin**, without a trailing slash. Example:

```dotenv
SIDEKICK_ORIGIN=https://assistant.example.com
```

Then start the supplied PM2 configuration:

```sh
BUN_PATH="$(command -v bun)" pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the startup command PM2 prints, then `pm2 save`. The configuration uses one instance, automatic restarts and graceful shutdown. [Bun's PM2 guide](https://bun.sh/guides/ecosystem/pm2) documents the interpreter configuration.

In your existing Cloudflare tunnel, route the chosen hostname to **HTTP → 127.0.0.1:4317** on this VPS. The app binds to loopback. Its Basic Auth protects the UI, API, browser screenshots and files. Keep the hostname's HTTPS origin identical to `SIDEKICK_ORIGIN`; remote writes fail otherwise. See [Cloudflare published applications](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/).

Open the HTTPS hostname, authenticate, and connect Codex through Settings. Website logins happen in Sidekick's own persistent browser through takeover.

```sh
pm2 status sidekick
pm2 logs sidekick --lines 50
pm2 restart sidekick --update-env
```

Chromium installation on Linux follows [Playwright's browser instructions](https://playwright.dev/docs/browsers). If Chromium cannot launch, check its system dependencies and the VPS user's browser cache.

## Configuration

| Variable | Default / purpose |
| --- | --- |
| `SIDEKICK_USER` | Basic Auth username, generated setup uses `owner` |
| `SIDEKICK_PASSWORD` | Required; at least 16 characters |
| `PORT` | `4317`; server binds to `127.0.0.1` |
| `SIDEKICK_ORIGIN` | Local loopback origin, or your exact public HTTPS origin |
| `SIDEKICK_DATA_DIR` | Project's `data` directory |
| `SIDEKICK_CODEX_HOME` | `data/codex`; dedicated subscription sign-in and threads |
| `SIDEKICK_MODEL` | `gpt-6.1-sol`; use a model available to your account |
| `SIDEKICK_BROWSER_EXECUTABLE` | Optional absolute Chromium executable path |
| `SIDEKICK_HEADLESS` | `true`; `false` requires a desktop/display |
| `BUN_PATH` | Optional absolute Bun interpreter path when starting PM2 |

Setup preserves an existing `.env`. If you copy `.env.example` yourself, fill in a strong password before starting.

## Data and limits

SQLite stores chats, task state, routines and preferences. The `data` directory also contains browser sessions, downloads, uploads and Codex credentials. Stop Sidekick before making a consistent backup of `.env` and the entire `data` directory. Protect backups like account credentials. If you override the data directory or Codex home, include those paths too.

The process stays available without running inference when idle. A task pauses after 120 tool calls or its one-hour run deadline. Browser interactions are serialized; this version serves one owner, with history stored in a single SQLite JSON row. Large histories will eventually need indexed storage and pagination.

Browser access is restricted to public HTTP/HTTPS sites on ports 80/443. A local filtering proxy resolves and pins public IPs, blocks private/reserved destinations and applies to subresources and redirects. The agent has no exposed arbitrary JavaScript, shell, filesystem-editing or connector tools; native Codex escalation requests are declined. Its browser content is still untrusted, and consequential actions depend on clear owner authorization.

Some sites block automation or require MFA/CAPTCHA/manual steps. The service can remain up around the clock; successful unlimited unattended work depends on subscription limits, sessions, website behavior and owner input. Browser interaction permissions alone cannot guarantee the assistant's judgment.

## Verification

```sh
bun test
bun run check:browser
bun run check:codex
```

Tests cover authentication, same-origin writes, uploads, persistence, schedule deduplication, approvals, parallel tool prompts, cancellation, browser dialogs and private-network rejection. `check:browser` exercises real UI flows and Chromium takeover at 320/768/1024/1440 widths; screenshots go to `artifacts`.

`check:codex` uses subscription inference and therefore consumes Codex allowance. It temporarily copies an existing local Codex `auth.json` into an isolated test home, navigates to example.com, sends an actual screenshot to the model, verifies the result and continues the same conversation. The temporary directory is removed afterward. Set `SIDEKICK_SMOKE_CODEX_HOME` to select the signed-in source home.

For optional WCAG checks, install `@axe-core/playwright` outside this project and set `SIDEKICK_AXE_PATH` to its absolute `dist/index.mjs` path when running `check:browser`.

## Implementation and references

Bun HTTP and SQLite, native HTML/CSS/JavaScript, Playwright Chromium, and [Codex App Server](https://learn.chatgpt.com/docs/app-server). Playwright is the only runtime package. Browser tools are registered through App Server dynamic tools; assistant messages and task progress use the real protocol.

UI references: [Linear's interface refresh](https://linear.app/now/behind-the-latest-design-refresh) and [its interface design process](https://linear.app/now/how-we-redesigned-the-linear-ui). Sidekick uses charcoal surfaces, a restrained lime accent, system typography and an original geometric mark. The overview places task creation above actual recent work, prioritizes tasks needing input, and opens browser controls on demand. Task runs include an input-needed filter.
