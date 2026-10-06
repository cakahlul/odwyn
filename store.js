import { Database } from 'bun:sqlite';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { textInput, interactionModes } from './security.js';

export function openStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Existing databases stay in place, including SQLite WAL files.
  const filename = join(directory, existsSync(join(directory, 'sidekick.db')) ? 'sidekick.db' : 'odwyn.db');
  const db = new Database(filename);
  chmodSync(filename, 0o600);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
  const row = db.query('SELECT value FROM state WHERE id=1').get();
  const state = { conversations: [], jobs: [], schedules: [], files: [], preferences: '', currency:'source', customization: null, ...JSON.parse(row?.value || '{}') };
  state.agents ||= [{ id: randomUUID(), customization: state.customization }];
  state.appearance ||= {palette:state.customization?.palette || 'paper',motion:state.customization?.motion || 'system'};
  for (const profile of [state.customization, ...state.agents.map(agent => agent.customization)]) {
    if (profile?.name === 'Sidekick') profile.name = 'Odwyn';
  }
  for (const item of [...state.conversations, ...state.jobs, ...state.schedules]) item.agentId ||= state.agents[0].id;
  for (const conversation of state.conversations) for (const message of conversation.messages) message.agentId ||= state.jobs.find(j => j.id === message.jobId)?.agentId || conversation.agentId;
  db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS chat_chunks USING fts5(messageId UNINDEXED, conversationId UNINDEXED, text)');
  const indexed = new Map();
  const removeChunks = db.query('DELETE FROM chat_chunks WHERE messageId = ?');
  const insertChunk = db.query('INSERT INTO chat_chunks(messageId, conversationId, text) VALUES (?, ?, ?)');
  const query = db.query('INSERT INTO state VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value');
  const save = db.transaction(() => {
    state.agents[0].customization = state.customization;
    query.run(JSON.stringify(state));
    for (const conversation of state.conversations) for (const message of conversation.messages) {
      if (indexed.get(message.id) === message.text) continue;
      removeChunks.run(message.id);
      for (const chunk of message.text.match(/[\s\S]{1,1500}/g) || []) insertChunk.run(message.id, conversation.id, chunk);
      indexed.set(message.id, message.text);
    }
  });
  const search = (text, agentId) => {
    // ponytail: lexical search; add semantic retrieval only if keyword recall proves insufficient.
    const terms = text.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12).map(word => `"${word}"`).join(' OR ');
    if (!terms) return [];
    const conversations = agentId ? state.conversations.filter(c => c.kind === 'room' ? c.memberIds.includes(agentId) : c.agentId === agentId) : state.conversations;
    return db.query("SELECT messageId, conversationId, text FROM chat_chunks WHERE chat_chunks MATCH ? AND conversationId IN (SELECT json_extract(value, '$.id') FROM json_each(?)) ORDER BY rank LIMIT 5").all(terms, JSON.stringify(conversations.map(c => ({ id:c.id })))).map(chunk => {
      const conversation = state.conversations.find(c => c.id === chunk.conversationId);
      const message = conversation?.messages.find(m => m.id === chunk.messageId);
      return { ...chunk, title: conversation?.title, role: message?.role, at: message?.at };
    });
  };
  const deleteConversation = db.transaction(id => {
    const conversation = state.conversations.find(c=>c.id===id);
    if (!conversation) throw new Error('Conversation not found.');
    if (state.jobs.some(j=>j.conversationId===id && ['queued','running','waiting','takeover','stopping'].includes(j.status))) throw new Error('Stop this conversation’s tasks before deleting it.');
    const conversations = state.conversations, jobs = state.jobs;
    try {
      state.conversations = conversations.filter(c=>c.id!==id);
      state.jobs = jobs.filter(j=>j.conversationId!==id);
      for (const message of conversation.messages) indexed.delete(message.id);
      db.query('DELETE FROM chat_chunks WHERE conversationId = ?').run(id);
      save();
    } catch(error) { state.conversations = conversations; state.jobs = jobs; throw error; }
  });
  return { state, save, search, deleteConversation, close: () => db.close() };
}

export function findAgent(state, id = state.agents[0].id) {
  const agent = state.agents.find(a => a.id === id);
  if (!agent) throw new Error('Agent not found.');
  return agent;
}

export function deleteAgent(state, id) {
  const agent = findAgent(state,id);
  if (state.agents.length === 1) throw new Error('Keep at least one agent. Add a replacement first.');
  const rooms = state.conversations.filter(c => c.kind === 'room' && c.memberIds.includes(id));
  if (state.jobs.some(j => (j.agentId === id || rooms.some(r => r.id === j.conversationId)) && ['queued','running','waiting','takeover','stopping'].includes(j.status))) throw new Error('Stop this agent’s tasks and room discussions before deleting it.');
  state.agents = state.agents.filter(a => a.id !== id);
  const replacement = state.agents[0];
  for (const conversation of state.conversations) {
    for (const message of conversation.messages) if (message.agentId === id) message.agentProfile = agent.customization || {name:'Odwyn'};
    let owner = replacement.id;
    if (rooms.includes(conversation)) {
      conversation.memberIds = conversation.memberIds.filter(member => member !== id);
      owner = conversation.memberIds[0];
      if (conversation.memberIds.length < 2) { delete conversation.kind; delete conversation.memberIds; }
    }
    if (conversation.agentId === id) { conversation.agentId = owner; delete conversation.threadId; delete conversation.providerKey; }
    if (conversation.lastAgentId === id) conversation.lastAgentId = owner;
    if (conversation.sessions) delete conversation.sessions[id];
  }
  state.schedules = state.schedules.filter(s => s.agentId !== id);
  state.customization = replacement.customization; state.provider = replacement.provider;
  return agent;
}

export function findRoom(state, id) {
  const room = state.conversations.find(c => c.id === id && c.kind === 'room');
  if (!room) throw new Error('Room not found.');
  return room;
}

function roomDetails(state, input) {
  const title = textInput(input.title,70);
  if (/[\x00-\x1f\x7f]/.test(title)) throw new Error('Use a single line for the room name.');
  const memberIds = input.memberIds;
  if (!Array.isArray(memberIds) || memberIds.length < 2 || memberIds.length > 5 || memberIds.some(id => typeof id !== 'string' || !id) || new Set(memberIds).size !== memberIds.length) throw new Error('Choose 2 to 5 different agents.');
  memberIds.forEach(id => findAgent(state,id));
  return {title,memberIds:[...memberIds]};
}

export function createRoom(state, input) {
  const details = roomDetails(state,input);
  const room = {id:randomUUID(),kind:'room',...details,agentId:details.memberIds[0],createdAt:new Date().toISOString(),messages:[]};
  state.conversations.unshift(room); return room;
}

export function updateRoom(state, id, input) {
  const room = findRoom(state,id), details = roomDetails(state,input);
  if (state.jobs.some(j => j.conversationId === id && ['queued','running','waiting','takeover','stopping'].includes(j.status))) throw new Error('Stop the room discussion before editing its participants.');
  Object.assign(room,details,{agentId:details.memberIds[0]});
  if (!details.memberIds.includes(room.lastAgentId)) room.lastAgentId = room.agentId;
  return room;
}

export function createJob(state, input, recordMessage = true) {
  const prompt = textInput(input.prompt);
  const interactionMode = input.interactionMode || 'confirm';
  if (!interactionModes.includes(interactionMode)) throw new Error('Choose an interaction mode.');
  let conversation = input.conversationId && state.conversations.find(c => c.id === input.conversationId);
  if (input.conversationId && !conversation) throw new Error('Conversation not found.');
  const agent = findAgent(state, input.agentId ?? conversation?.lastAgentId ?? conversation?.agentId);
  if (conversation?.kind === 'room' && !conversation.memberIds.includes(agent.id)) throw new Error('This agent is not in the room.');
  const now = new Date().toISOString();
  if (!conversation) {
    conversation = { id: randomUUID(), agentId: agent.id, title: prompt.slice(0, 70), threadId: null, createdAt: now, messages: [] };
    state.conversations.unshift(conversation);
  }
  const job = { id: randomUUID(), agentId: agent.id, conversationId: conversation.id, prompt, interactionMode, status: 'queued', createdAt: now, events: [], toolCount: 0, files: [], scheduleId: input.scheduleId || null };
  conversation.lastAgentId = agent.id;
  if (recordMessage) conversation.messages.push({ id: randomUUID(), agentId:agent.id, role: 'user', text: prompt, at: now, jobId: job.id });
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
    createJob(state, { prompt: schedule.prompt, agentId: schedule.agentId, interactionMode: schedule.interactionMode, scheduleId: schedule.id });
    schedule.lastAt = now.toISOString();
    if (schedule.intervalMinutes) schedule.nextAt = new Date(now.valueOf() + schedule.intervalMinutes * 60_000).toISOString();
    else schedule.enabled = false;
    count++;
  }
  return count;
}
