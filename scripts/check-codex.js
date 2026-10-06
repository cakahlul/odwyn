import { mkdtempSync, cpSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { openStore } from '../store.js';
import { Browser } from '../browser.js';
import { Codex } from '../codex.js';
import { Runtime } from '../runtime.js';

const directory = mkdtempSync(join(tmpdir(), 'odwyn-codex-check-'));
const home = join(directory, 'codex');
const source = join((process.env.ODWYN_SMOKE_CODEX_HOME ?? process.env.SIDEKICK_SMOKE_CODEX_HOME) || (process.env.ODWYN_CODEX_HOME ?? process.env.SIDEKICK_CODEX_HOME) || process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json');
if (!existsSync(source)) { rmSync(directory, { recursive: true }); throw new Error('Sign in to Codex first. Set ODWYN_SMOKE_CODEX_HOME to your signed-in Codex home.'); }
cpSync(source, join(home, 'auth.json'), { recursive: true });
const store = openStore(directory);
const browser = new Browser({ directory });
const codex = new Codex({ home, workspace: join(directory, 'workspace') });
const runtime = new Runtime({ store, browser, codex, workspace: join(directory, 'workspace'), model: (process.env.ODWYN_MODEL ?? process.env.SIDEKICK_MODEL) || 'gpt-6.1-sol' });
const wait = async (job, status = 'completed') => {
  const until = Date.now() + 240_000;
  while (job.status !== status && ['queued','running','waiting','takeover'].includes(job.status) && Date.now() < until) await Bun.sleep(500);
  assert.equal(job.status, status, job.error || JSON.stringify(job.pending));
};
try {
  await runtime.refreshAccount(); assert.ok(runtime.account, runtime.connectionError || 'Subscription sign-in unavailable.');
  const clarification = runtime.submit({prompt:'Help me pick a hotel for a weekend staycation near Summarecon Mall Serpong. First ask my budget per night and whether I am bringing children. Wait for my reply. After I answer, just acknowledge those preferences; do not browse or recommend hotels yet.'});
  await wait(clarification,'waiting'); assert.equal(clarification.pending.type,'question');
  const callsBeforeAnswer = clarification.toolCount;
  await Bun.sleep(1000); assert.equal(clarification.status,'waiting'); assert.equal(clarification.toolCount,callsBeforeAnswer); assert.ok(!browser.context);
  runtime.answer(clarification.id,{requestId:clarification.pending.id,answer:'Rp1–2 million per night, two adults and one child.'});
  await wait(clarification);
  const job = runtime.submit({ prompt: 'Use odwyn_browser to navigate to https://example.com, read its actual heading, then use screenshot to inspect the browser image. Tell me the page heading and URL. Do not click any links or use any other tools.' });
  await wait(job);
  assert.ok(job.events.some(event => event.label === 'navigate'));
  assert.ok(job.events.some(event => event.label === 'screenshot'));
  const conversation = runtime.conversation(job); const threadId = conversation.threadId;
  assert.match(conversation.messages.filter(m => m.role === 'assistant').map(m => m.text).join('\n'), /Example Domain/i);
  const follow = runtime.submit({ conversationId: conversation.id, prompt: 'What URL did you just visit? Answer from this conversation without browsing.' });
  await wait(follow); assert.equal(conversation.threadId, threadId);
  assert.match(conversation.messages.filter(m => m.jobId === follow.id && m.role === 'assistant').map(m => m.text).join('\n'), /example\.com/i);
  console.log('PASS: owner question waits for reply, subscription inference, real browser navigation, screenshot image tool output, persisted result, same-thread follow-up.');
} finally { runtime.close(); codex.stop(); await browser.close(); store.close(); rmSync(directory, { recursive: true, force: true }); }
