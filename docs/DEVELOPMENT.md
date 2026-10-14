# Development and verification

[Back to Odwyn](../README.md) · [Setup](SETUP.md) · [Workflow guide](WORKFLOWS.md)

## Project layout

Odwyn uses Bun HTTP/SQLite, native HTML/CSS/JavaScript, and Playwright Chromium. Codex, Claude Code, and OpenAI-compatible API providers share the task, workflow, and approval runtime.

| Location | Responsibility |
| --- | --- |
| `server.js`, `runtime.js`, `store.js` | HTTP routes, task execution, and persistence. |
| `providers.js`, `codex.js` | Provider integration. |
| `public/` | Workspace UI, customization, access controls, and workflow editor. |
| `security/` | Policy, credentials, scoped gateways, approvals, and classified data. |
| `execution/` | Isolated terminal/browser workers and setup instructions. |
| `test/`, `tests/security/` | Regression tests and security acceptance gates. |
| `scripts/` | Setup and focused end-to-end checks. |

Read the [security boundary inventory](security/INVENTORY.md), [access-control design](security/ADR-ACCESS-CONTROL.md), and [owner API contracts](security/PHASE4_API.md) before changing execution or permissions. Provider-native tools, plugins, or remote MCP annotations must not bypass server policy.

## Focused checks

```sh
bun test test/core.test.js test/runtime.test.js
bun test tests/security/management.test.js tests/security/browsing.test.js
bun test test/browser-page.test.js
bun run check:settings
bun run check:workflows
bun run check:browser
```

These use disposable fixtures or mocked providers. Settings checks cover shared management, legacy browsing scopes, resets, access separation, and four viewport widths. Browser page tests use real Chromium to check local interactions and blocked outbound requests; they do not prove container isolation.

Some macOS Bun runs can reuse guarded native file descriptors across test files. The security baseline runner executes regression files in separate processes to avoid that issue.

## Full security verification

`bun test` includes acceptance suites that require a report directory and, for worker isolation, pinned disposable images and a supported Linux/Docker runner. Read [isolated execution](../execution/README.md) for the environment and commands. An unavailable worker environment is a blocked check, not a passing isolation test.

`bun run check:codex` uses real subscription inference and consumes allowance. It uses a temporary test home; `ODWYN_SMOKE_CODEX_HOME` selects the signed-in source home. Review [scripts/check-codex.js](../scripts/check-codex.js) before running it.

For optional WCAG checks, install `@axe-core/playwright` outside the project and set `ODWYN_AXE_PATH` to its absolute `dist/index.mjs` when running `check:browser`.

## Data and operations

Persistent state lives in the configured data directory. Provider credentials are encrypted using the local broker key. Tasks and room discussions have execution limits; service restarts require review of interrupted work. This is a single-owner application.

See [security operations](security/OPERATIONS.md) for backups, recovery, review evidence, and worker cleanup. The [threat model](security/THREAT_MODEL.md) records the execution boundaries and remaining risks.
