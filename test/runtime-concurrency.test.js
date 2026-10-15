import {test, expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Runtime} from '../runtime.js';
import {openStore, createRoom} from '../store.js';
import {defaults} from '../public/profile.js';
import {installLanes} from '../execution/lanes.js';

class Provider extends EventEmitter {
  child = {}; calls = []; replies = [];
  async request(method, params) {
    this.calls.push({method, params});
    if (method === 'account/read') return {account:{type:'chatgpt'}};
    if (method.startsWith('thread/')) return {thread:{id:params.threadId || randomUUID()}};
    if (method === 'turn/start') return {turn:{id:randomUUID()}};
    return {};
  }
  respond(id, result) { this.replies.push({id, result}); }
  reject(id, error) { this.replies.push({id, error}); }
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-concurrent-'));
  const store = openStore(directory), first = new Provider();
  const primary = store.state.agents[0].id;
  store.state.agents.push({id:'engineer', customization:{...defaults,name:'Engineer'}});
  const runtime = new Runtime({store, codex:first, browser:{}, workspace:directory});
  installLanes(runtime);
  runtime.addProvider('engineer', new Provider());
  await runtime.refreshAccount(primary); await runtime.refreshAccount('engineer');
  const room = createRoom(store.state, {spaceId:store.security.legacySpaceId,title:'Independent tasks',memberIds:[primary,'engineer'],governance:{facilitatorId:primary}});
  room.governance.concurrency = 2;
  const jobs = runtime.submitRoom(room.id, {prompt:'Work independently, then review the result.'});
  await runtime.drain();
  const call = (job, tool, args) => runtime.contextForJob(job.id).handleRequest({id:randomUUID(),method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool,arguments:args}});
  const finish = job => runtime.providers.get(job.agentId).emit('notification', {method:'turn/completed',params:{threadId:job.threadId,turn:{id:job.turnId,status:'completed'}}});
  return {runtime, store, room, jobs, call, finish, async close() {await runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}};
}

test('parallel room questions, provider responses and cancellation stay bound to their jobs', async () => {
  const f = await fixture();
  try {
    const {runtime, jobs, call} = f;
    expect(jobs.every(job => job.status === 'running')).toBe(true);
    expect(runtime.activeJobs()).toHaveLength(2);
    expect(runtime.contextForJob(jobs[0].id).browser).not.toBe(runtime.contextForJob(jobs[1].id).browser);
    const questions = jobs.map(job => call(job,'odwyn_ask',{question:`Decision for ${job.agentId}?`}));
    await Bun.sleep(1);
    expect(jobs.every(job => job.pending?.type === 'question')).toBe(true);
    expect(() => runtime.answer(jobs[0].id, {requestId:jobs[1].pending.id,answer:'Wrong recipient'})).toThrow();
    runtime.answer(jobs[0].id, {requestId:jobs[0].pending.id,answer:'Continue first task'});
    await questions[0];
    expect(jobs[1].status).toBe('waiting');
    await runtime.cancel(jobs[0].id);
    expect(jobs[0].status).toBe('cancelled');
    expect(jobs[1].pending.type).toBe('question');
    runtime.answer(jobs[1].id, {requestId:jobs[1].pending.id,answer:'Continue second task'});
    await questions[1];
    const reply = runtime.providers.get(jobs[1].agentId).replies.at(-1);
    expect(JSON.stringify(reply)).toContain('Continue second task');
    expect(runtime.providers.get(jobs[1].agentId).calls.some(call => call.method === 'turn/interrupt')).toBe(false);
  } finally { await f.close(); }
});

test('parallel room never publishes while a sibling still executes, and stop cancels all jobs', async () => {
  const f = await fixture();
  try {
    const {runtime, room, jobs, call, finish} = f;
    await call(jobs[0], 'odwyn_room_done', {summary:'Checked.',result:'Agreed deliverable',nextPlan:'Review with owner.'});
    const proposalId = room.discussion.outcome.id;
    await call(jobs[1], 'odwyn_room_done', {proposalId,summary:'Independently checked.'});
    finish(jobs[0]);
    expect(room.discussion.status).toBe('active');
    expect(room.messages.some(message => message.roomReport)).toBe(false);
    finish(jobs[1]);
    expect(room.discussion.status).toBe('completed');
    expect(room.messages.filter(message => message.roomReport)).toHaveLength(1);
    const next = runtime.submitRoom(room.id, {prompt:'Next independent tasks'});
    await runtime.drain();
    expect(runtime.activeJobs()).toHaveLength(2);
    await runtime.cancelRoom(room.id);
    expect(next.every(job => job.status === 'cancelled')).toBe(true);
    expect(runtime.activeJobs()).toHaveLength(0);
  } finally { await f.close(); }
});

test('an agent cannot occupy two lanes across concurrent rooms', async () => {
  const f = await fixture();
  try {
    const {runtime, room, store} = f;
    const other = createRoom(store.state, {spaceId:room.spaceId,title:'Second room',memberIds:room.memberIds,governance:{facilitatorId:room.memberIds[0]}});
    other.governance.concurrency = 2;
    const queued = runtime.submitRoom(other.id, {prompt:'Another task for the same agents'});
    await runtime.drain();
    expect(queued.every(job => job.status === 'queued')).toBe(true);
    expect(new Set(runtime.activeJobs().map(job => job.agentId)).size).toBe(runtime.activeJobs().length);
    await runtime.cancelRoom(room.id);
    await runtime.drain();
    expect(queued.every(job => job.status === 'running')).toBe(true);
  } finally { await f.close(); }
});
