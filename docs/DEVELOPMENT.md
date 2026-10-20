# Development and verification

[Back to Odwyn](../README.md) · [Setup](SETUP.md)

Odwyn uses Bun HTTP/SQLite, native HTML/CSS/JavaScript and Playwright Chromium. `server.js` handles routes, `runtime.js` executes tasks and workflows, and `store.js` persists state. `credentials.js` encrypts provider keys and redacts managed secrets. Login, origin validation, request limits, file path validation and the browser’s public-network proxy remain enforced.

Run `bun run test` for the regression suite. Each test file runs in a separate process to keep browser and SQLite handles local. Focused checks use `bun test test/<name>.test.js`. Browser checks require installed Chromium; `bun run browser:install` installs it.

`bun run check:settings`, `bun run check:workflows` and `bun run check:browser` exercise the UI with disposable data. `bun run check:codex` uses real subscription inference and consumes allowance.

`test/access-removal.test.js` covers removal of old access tables, preservation of history and handoff packages, credential migration, repeat opens and transaction rollback when a provider key is unavailable.

Terminal tools execute host commands under the service user. Native provider command tools remain disabled; use the application’s terminal/browser tools and selected interaction mode. Keep `.env`, data and provider homes private. Back up SQLite and its local `broker.key` together with the service stopped.
