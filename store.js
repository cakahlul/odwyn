import { Database } from 'bun:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { textInput } from './security.js';

export function openStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, 'sidekick.db');
  const db = new Database(filename);
  chmodSync(filename, 0o600);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
  const row = db.query('SELECT value FROM state WHERE id=1').get();
  const state = { conversations: [], jobs: [], schedules: [], files: [], preferences: '', ...JSON.parse(row?.value || '{}') };
  const query = db.query('INSERT INTO state VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value');
  return { state, save: () => query.run(JSON.stringify(state)), close: () => db.close() };
}

export function createJob(state, input) {
  const prompt = textInput(input.prompt);
  const interactionMode = input.interactionMode || 'confirm';
  if (!['confirm','allow'].includes(interactionMode)) throw new Error('Choose an interaction mode.');
  let conversation = input.conversationId && state.conversations.find(c => c.id === input.conversationId);
  if (input.conversationId && !conversation) throw new Error('Conversation not found.');
  const now = new Date().toISOString();
  if (!conversation) {
    conversation = { id: randomUUID(), title: prompt.slice(0, 70), threadId: null, createdAt: now, messages: [] };
    state.conversations.unshift(conversation);
  }
  const job = { id: randomUUID(), conversationId: conversation.id, prompt, interactionMode, status: 'queued', createdAt: now, events: [], toolCount: 0, files: [], scheduleId: input.scheduleId || null };
  conversation.messages.push({ id: randomUUID(), role: 'user', text: prompt, at: now, jobId: job.id });
  state.jobs.unshift(job);
  return job;
}

export function recoverJobs(state) {
  for (const job of state.jobs) if (['running','waiting','takeover','stopping'].includes(job.status)) {
    job.status = 'interrupted'; job.error = 'The service restarted. Review progress, then resume; completed website actions are not undone.'; job.endedAt = new Date().toISOString(); job.pending = null; delete job.stopResult;
  }
}

export function enqueueSchedules(state, now = new Date()) {
  let count = 0;
  for (const schedule of state.schedules) {
    if (!schedule.enabled || new Date(schedule.nextAt) > now) continue;
    if (state.jobs.some(j => j.scheduleId === schedule.id && ['queued','running','waiting','takeover','stopping','interrupted'].includes(j.status))) continue;
    createJob(state, { prompt: schedule.prompt, interactionMode: schedule.interactionMode, scheduleId: schedule.id });
    schedule.lastAt = now.toISOString();
    if (schedule.intervalMinutes) schedule.nextAt = new Date(now.valueOf() + schedule.intervalMinutes * 60_000).toISOString();
    else schedule.enabled = false;
    count++;
  }
  return count;
}
