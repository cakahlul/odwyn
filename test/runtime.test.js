import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../store.js';
import { Runtime } from '../runtime.js';

class FakeCodex extends EventEmitter {
  child = {}; calls = []; replies = [];
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'pro' } };
    if (method.startsWith('thread/')) return { thread: { id: params?.threadId || 'thread-test' } };
    if (method === 'turn/start') return { turn: { id: 'turn-test', status: 'inProgress' } };
    return {};
  }
  respond(id, result) { this.replies.push({ id, result }); }
  reject() {}
}

test('real tool protocol pauses interactions until exact approval and resumes the same thread', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sidekick-runtime-'));
  const store = openStore(dir); const codex = new FakeCodex(); const browserCalls = [];
  const browser = { last: { url: 'https://example.com', elements: [{ ref: '0', label: 'Submit' }] }, action: async args => { browserCalls.push(args); return { text: 'Done', elements: [] }; } };
  const runtime = new Runtime({ store, codex, browser, workspace: dir, model: 'gpt-6.1-sol' });
  await runtime.refreshAccount();
  const job = runtime.submit({ prompt: 'Fill this form' });
  await runtime.drain();
  expect(codex.calls.find(c => c.method === 'thread/start').params.model).toBe('gpt-6.1-sol');
  const handle = runtime.handleRequest({ id: 77, method: 'item/tool/call', params: { threadId: 'thread-test', turnId: 'turn-test', tool: 'sidekick_browser', arguments: { action: 'click', ref: '0', reason: 'Submit the requested form' } } });
  await Bun.sleep(10);
  expect(job.status).toBe('waiting'); expect(browserCalls).toHaveLength(0);
  expect(() => runtime.answer(job.id, { requestId: 'stale', decision: 'allow' })).toThrow();
  runtime.answer(job.id, { requestId: job.pending.id, decision: 'allow' });
  await handle;
  expect(browserCalls).toHaveLength(1); expect(codex.replies[0].result.success).toBe(true);
  codex.emit('notification', { method: 'item/completed', params: { threadId: 'thread-test', turnId: 'turn-test', item: { id: 'message-1', type: 'agentMessage', text: 'Form submitted.', phase: 'final_answer' } } });
  codex.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-test', turn: { id: 'turn-test', status: 'completed' } } });
  expect(job.status).toBe('completed');
  const next = runtime.submit({ prompt: 'What happened?', conversationId: job.conversationId });
  await runtime.drain();
  expect(codex.calls.some(c => c.method === 'thread/resume' && c.params.threadId === 'thread-test')).toBe(true);
  expect(codex.calls.filter(c => c.method === 'turn/start').map(c => c.params.effort)).toEqual(['medium','medium']);
  await runtime.cancel(next.id); runtime.close(); store.close(); rmSync(dir, { recursive: true });
});

test('parallel tools keep distinct owner prompts and active cancellation wins the interrupt notification', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sidekick-runtime-'));
  const store = openStore(dir); const codex = new FakeCodex();
  const runtime = new Runtime({ store, codex, browser: {}, workspace: dir });
  try {
    await runtime.refreshAccount();
    const job = runtime.submit({ prompt: 'Ask two questions' }); await runtime.drain();
    const ask = (id, question) => runtime.handleRequest({ id, method: 'item/tool/call', params: { threadId: 'thread-test', turnId: 'turn-test', tool: 'sidekick_ask', arguments: { question } } });
    const first = ask(1, 'First question?'); const second = ask(2, 'Second question?');
    await Bun.sleep(10);
    expect(job.pending.detail).toBe('First question?'); expect(runtime.requests.size).toBe(1);
    runtime.answer(job.id, { requestId: job.pending.id, answer: 'First answer' }); await first; await Bun.sleep(10);
    expect(job.pending.detail).toBe('Second question?'); expect(runtime.requests.size).toBe(1);
    runtime.answer(job.id, { requestId: job.pending.id, answer: 'Second answer' }); await second;
    const request = codex.request.bind(codex);
    codex.request = async (method, params) => {
      if (method === 'turn/interrupt') codex.emit('notification', { method: 'turn/completed', params: { threadId: job.threadId, turn: { id: job.turnId, status: 'interrupted' } } });
      return request(method, params);
    };
    await runtime.cancel(job.id);
    expect(job.status).toBe('cancelled'); expect(runtime.active).toBe(null);
    const retry = runtime.retry(job.id); await runtime.drain();
    expect(retry.recovering).toBe(true); expect(job.status).toBe('resumed');
    expect(() => runtime.retry(job.id)).toThrow();
  } finally { runtime.close(); store.close(); rmSync(dir, { recursive: true }); }
});
