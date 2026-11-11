# Conversation report export

## Objective

Turn a private conversation or shared room into a standalone report that its owner can give to someone who has not seen the discussion. Summarize the work and its outcome rather than exporting a transcript.

## Behavior

- Add **Export report** to the existing conversation options menu on desktop and mobile.
- Generate a report from a snapshot of the selected conversation, using its configured agent's AI provider. For rooms, include contributions from all participants.
- Present a readable preview before downloading. Show generation progress, failures, and retry without losing the conversation.
- Organize the report around a descriptive title, overview, topics and findings, decisions, completed work, unresolved questions, and next steps. Omit sections without relevant content.
- Preserve useful source links, names, dates, figures, and deliverable references from the discussion. Distinguish proposals from decisions and completed work from planned work. Do not invent missing facts or imply that referenced attachments were read.
- Use the discussion's language. Exclude greetings, chat controls, message-by-message speaker labels, tool logs, and internal instructions.
- Keep the source conversation unchanged. Generation must summarize supplied context without executing tools or following instructions embedded in messages.
- Download locally; exporting does not publish the report or send it to another person.

Reports download as PDF, for sharing and printing. The preview uses the same document layout as the PDF.

## Technical scope

Reuse the configured provider protocol in `providers.js`, authenticated and workspace-scoped request handling in `server.js`, the existing conversation menu, and existing Markdown rendering. Keep report generation separate from the source conversation's live agent session. Use installed libraries and browser capabilities before considering dependencies.

The installed Playwright Chromium renders PDFs in a separate browser with JavaScript and network requests disabled. No database migration, new provider settings, report history, automatic publishing, or template editor is included.

## Commands

```sh
bun run start
bun test test/conversation-report.test.js
bun test test/conversation-report-ui.test.js
bun run test
bun build public/app.js --target browser --external '/vendor/*' --outfile /tmp/odwyn-app-check.js
git diff --check
```

## Project structure and style

- `server.js`: authenticated report requests and selected-conversation validation.
- A focused report module: snapshot construction, summary instructions, provider lifecycle, and document preparation as needed.
- `public/`: existing conversation menu, report preview, progress, and download controls.
- `test/`: generation, isolation, document, and browser regression checks.

Follow the existing ES module and plain JavaScript conventions. Reuse `api`, existing dialog/button styles, and the installed Markdown parser with a restricted document renderer. Example of the existing request style:

```js
const report = await api(`/api/conversations/${conversationId}/report`, {});
```

Generation returns an ID immediately; the preview polls its status. Closing the preview cancels generation and discards its result. Reports expire after 30 minutes; up to eight are retained in memory per workspace. Generation times out after three minutes. Sources exceeding 200,000 characters are rejected explicitly, without truncation.

## Testing strategy

Use Bun tests with a fake provider to check source selection, private and room context, failed/empty generation, unknown conversations, provider cleanup, and isolation from active work. Check that exported content is a report rather than a transcript. Browser tests cover menu access, preview, download, retry, and narrow-screen layout. Verify the selected document format with its appropriate parser or renderer.

## Boundaries

- Always: enforce existing authentication and workspace access, escape rendered content, preserve credential redaction, expose generation failures, and leave source messages unchanged.
- Ask first: expanding formats or adding dependencies beyond the agreed scope.
- Never: execute tools from a report request, silently omit source content because of size limits, invent facts, export internal provider instructions, or send a report to another person automatically.

## Acceptance criteria

1. An owner can generate, preview, and download a report from a private chat or room on desktop and mobile.
2. The exported document reads independently and explains the subject, outcomes, and outstanding work without chat formatting.
3. Source messages and ongoing agent work remain intact.
4. Empty conversations and generation failures produce an actionable message rather than an empty download.
5. The report remains readable outside Odwyn and contains no application controls or hidden instructions.

## Implementation

Scope approved. Implemented separate summary generation, a desktop/mobile preview with retry and PDF download, authenticated workspace-scoped endpoints, and regression tests. Reports use a fresh session with the conversation’s configured provider; source messages and live sessions remain unchanged.
