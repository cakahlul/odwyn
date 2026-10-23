import {openCredentials} from './credentials.js';
import {openAudit} from './audit.js';
import {openKnowledge} from './knowledge.js';
import { defaults, ownerPreferenceKeys } from './public/profile.js';
import { Database } from 'bun:sqlite';
import { mkdirSync, chmodSync, existsSync, readdirSync, rmSync } from 'node:fs';
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
  const state = { conversations: [], jobs: [], schedules: [], files: [], workflows: [], skills: [], connections: [], knowledge: [], workflowRuns: [], preferences: '', currency:'source', customization: null, ...JSON.parse(row?.value || '{}') };
  state.agents ||= [{ id: randomUUID(), customization: state.customization }];
  state.owner ||= Object.fromEntries(ownerPreferenceKeys.map(key=>[key,state.customization?.[key] ?? state.agents[0].customization?.[key] ?? defaults[key]]));
  state.appearance ||= {palette:state.customization?.palette || 'paper',motion:state.customization?.motion || 'system'};
  for (const profile of [state.customization, ...state.agents.map(agent => agent.customization)]) {
    if (profile?.name === 'Sidekick') profile.name = 'Odwyn';
  }
  for (const item of [...state.conversations, ...state.jobs, ...state.schedules]) item.agentId ||= state.agents[0].id;
  for (const conversation of state.conversations) for (const message of conversation.messages) message.agentId ||= state.jobs.find(j => j.id === message.jobId)?.agentId || conversation.agentId;
  db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS chat_chunks USING fts5(messageId UNINDEXED, conversationId UNINDEXED, text)');
  const removedTables=['approval_keys','owner_reauth','approval_requests','security_pauses','agent_security_settings','security_presets','task_exports','workflow_output_sources','room_proposal_sources','task_tokens','data_exports','space_memory','classified_files','data_sources','classified_messages','classified_conversations','task_security_contexts','grants','memberships','security_events','resources','spaces','security_meta','security_migration','isolated_workspaces','git_merge_reviews','git_merge_requests','git_work_branches','connectors'];
  const hasTable=name=>!!db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const migrating=removedTables.some(hasTable);
  const plaintextProviderKeys=[state.provider,state.globalProvider,...state.agents.map(agent=>agent.provider)].some(config=>config?.apiKey);
  let credentials;
  try { db.transaction(()=>{
    credentials=openCredentials(db,directory);credentials.hydrateProviders(state);
    if(migrating){
      // Preserve selected room handoff contents before removing scoped export records.
      if(hasTable('data_exports'))for(const room of state.conversations)if(room.handoff?.exportId){
        const row=db.query('SELECT payload FROM data_exports WHERE id=? AND revoked=0').get(room.handoff.exportId);
        if(row)room.handoff.package=JSON.parse(row.payload).roomHandoff;
      }
      const strip=(value,keys)=>{if(value)for(const key of keys)delete value[key];};
      const removedTools=new Set(['action','export_read','repository_sync','repository_read','mcp_repository_read','repository_branch','repository_push','repository_patch','repository_merge','repository_review','checkpoint','run_test','test_case']);
      const stepClean=step=>{
        strip(step,['spaceId','workspaceResourceId']);strip(step.room,['spaceId']);strip(step.room?.governance,['concurrency']);strip(step.action,['resourceId','approvalId']);
        if(step.tools)step.tools=step.tools.filter(tool=>!removedTools.has(tool));
        if(typeof step.prompt==='string'&&/odwyn_(?:checkpoint|run_test|repository_)|isolated workspace/i.test(step.prompt)){
          step.prompt=step.prompt
            .replace(/Use the isolated workspace resource named:\n[^\n]+/g,'Use the persistent host workspace and the repository/branch identified in the approved handoff. Use odwyn_terminal for Git, file changes and tests.')
            .replace(/authorized isolated workspace/gi,'repository in the persistent host workspace')
            .replace(/odwyn_run_test with purpose "uat",\n[^.]+\./g,'odwyn_terminal on the development branch, recording the exact tested Git commit, command, exit status and result.')
            .replaceAll('odwyn_repository_branch','odwyn_terminal with Git branch/checkout commands')
            .replaceAll('odwyn_repository_push','odwyn_terminal with git push')
            .replaceAll('odwyn_repository_merge','odwyn_terminal with Git merge commands')
            .replaceAll('odwyn_repository_review','odwyn_room_review on the current proposal after inspecting the exact diff and test results')
            .replaceAll('odwyn_checkpoint','odwyn_terminal with Git status/diff/commit commands')
            .replaceAll('odwyn_run_test','odwyn_terminal with actual test commands')
            .replace(/odwyn_(?:mcp_repository_read|repository_(?:sync|read|patch))/g,'odwyn_terminal with Git commands')
            .replace(/registered task/g,'task').replace(/checkpoint/gi,'commit');
        }

      };
      strip(state,['checkpoints','executionHeads']);
      for(const room of state.conversations){
        strip(room,['spaceId','sessions','threadId','providerKey','checkpoints','targetCheckpointId','cases','evidence']);
        strip(room.handoff,['exportId']);strip(room.handoff?.package,['upstreamExports']);strip(room.governance,['concurrency']);
        for(const message of room.messages)strip(message,['spaceId','resourceId','exportId']);
        for(const artifact of [...(room.artifacts||[]),...(room.archivedArtifacts||[])])for(const version of artifact.versions)strip(version,['evidenceIds']);
        for(const outcome of [room.discussion?.outcome,...(room.discussion?.previousOutcomes||[])])strip(outcome,['checks']);
        for(const handoff of room.handoffs||[])strip(handoff,['exportId']);
      }
      for(const job of state.jobs){
        strip(job,['spaceId','securityContext','workspacePin','workspaceDirty','checkpointConflict','approvalWait']);
        for(const reference of [...(job.knowledgeContext||[]),...(job.knowledgeVersions||[])])strip(reference,['resourceId']);
        if(job.pending?.type==='security')job.pending=null;
        if(job.workflowStep)stepClean(job.workflowStep);
      }
      for(const item of [...state.files,...state.schedules])strip(item,['spaceId','resourceId','exportId']);
      for(const doc of state.knowledge)strip(doc,['resources']);
      for(const run of state.workflowRuns){strip(run,['spaceId','outputTasks']);strip(run.recovery,['checkpointId']);}
      for(const workflow of [...state.workflows,...state.workflowRuns.map(run=>run.workflow)])for(const step of workflow?.steps||[])stepClean(step);
      for(const name of removedTables)db.exec('DROP TABLE IF EXISTS "'+name+'"');
    }
    if(migrating||plaintextProviderKeys)db.query('INSERT INTO state VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(credentials.serialize(state));
  })(); } catch(error) { db.close();throw error; }
  if(migrating||plaintextProviderKeys)db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE)');
  for(const name of readdirSync(directory))if(['checkpoints','sources'].includes(name)||/^pre-(?:security|data-security|approval-security|isolated-workspaces|git-work|grants)-/.test(name))rmSync(join(directory,name),{recursive:true,force:true});
  const audit=openAudit(db,state,credentials);
  const indexed = new Map();
  const removeChunks = db.query('DELETE FROM chat_chunks WHERE messageId = ?');
  const insertChunk = db.query('INSERT INTO chat_chunks(messageId, conversationId, text) VALUES (?, ?, ?)');
  const query = db.query('INSERT INTO state VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value');
  const save = db.transaction(() => {
    state.agents[0].customization = state.customization;
    query.run(credentials.serialize(state));
    audit.sync();
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
    const conversations = state.conversations.filter(c => (!agentId || (c.kind === 'room' ? c.memberIds.includes(agentId) : c.agentId === agentId)));
    const authorized=conversations.flatMap(c=>c.messages).map(m=>m.id);
    return db.query("SELECT messageId, conversationId, text FROM chat_chunks WHERE chat_chunks MATCH ? AND messageId IN (SELECT value FROM json_each(?)) ORDER BY rank LIMIT 5").all(terms, JSON.stringify(authorized)).map(chunk => {
      const conversation = state.conversations.find(c => c.id === chunk.conversationId);
      const message = conversation?.messages.find(m => m.id === chunk.messageId);
      return { ...chunk, title: conversation?.title, role: message?.role, at: message?.at };
    });
  };
  const conversationDeletion = id => {
    if (!state.conversations.some(c=>c.id===id)) throw new Error('Conversation not found.');
    const ids=new Set([id]), runIds=new Set();
    let changed=true;
    while(changed){
      const size=ids.size+runIds.size;
      for(const room of state.conversations){
        if(ids.has(room.id)&&room.roomWorkflowRunId)runIds.add(room.roomWorkflowRunId);
        if(room.handoff?.sourceRoomId&&(ids.has(room.id)||ids.has(room.handoff.sourceRoomId))){ids.add(room.id);ids.add(room.handoff.sourceRoomId);}
        for(const handoff of room.handoffs||[])if(ids.has(room.id)||ids.has(handoff.roomId)){ids.add(room.id);if(handoff.roomId)ids.add(handoff.roomId);}
        if(runIds.has(room.roomWorkflowRunId))ids.add(room.id);
      }
      for(const run of state.workflowRuns)if(runIds.has(run.id)||ids.has(run.conversationId)||(run.roomIds||[]).some(roomId=>ids.has(roomId))){
        runIds.add(run.id);if(run.conversationId)ids.add(run.conversationId);
        for(const roomId of run.roomIds||[])ids.add(roomId);
      }
      changed=size!==ids.size+runIds.size;
    }
    const conversations=state.conversations.filter(c=>ids.has(c.id)).map(({id,title})=>({id,title}));
    return {conversations,conversationIds:conversations.map(c=>c.id),workflowRunIds:[...runIds]};
  };
  const deleteConversationState = db.transaction((id, confirmed) => {
    const plan=conversationDeletion(id), ids=new Set(plan.conversationIds), runIds=new Set(plan.workflowRunIds);
    const matches=(expected,actual)=>Array.isArray(actual)&&expected.length===actual.length&&expected.every(id=>actual.includes(id));
    if(confirmed&&(!matches(plan.conversationIds,confirmed.conversationIds)||!matches(plan.workflowRunIds,confirmed.workflowRunIds)))throw new Error('Deletion dependencies changed. Review and confirm again.');
    if(!confirmed&&ids.size>1)throw new Error('Linked room history requires confirmation to delete all dependent rooms.');
    if (state.jobs.some(j=>(ids.has(j.conversationId)||runIds.has(j.workflowRunId)) && ['queued','running','waiting','takeover','stopping'].includes(j.status))) throw new Error('Stop all linked conversations’ tasks before deleting them.');
    const conversations = state.conversations, jobs = state.jobs, workflowRuns = state.workflowRuns, files = state.files;
    try {
      state.conversations = conversations.filter(c=>!ids.has(c.id));
      state.jobs = jobs.filter(j=>!ids.has(j.conversationId)&&!runIds.has(j.workflowRunId));
      state.workflowRuns = workflowRuns.filter(r=>!runIds.has(r.id));
      const deletedJobs=new Set(jobs.filter(job=>ids.has(job.conversationId)||runIds.has(job.workflowRunId)).map(job=>job.id));
      const deleted=JSON.stringify([conversations.filter(c=>ids.has(c.id)),jobs.filter(j=>deletedJobs.has(j.id)),workflowRuns.filter(r=>runIds.has(r.id))]);
      const {files:ignored,...remaining}=state, references=JSON.stringify(remaining);
      const removedFiles=files.filter(file=>(deletedJobs.has(file.jobId)||deleted.includes(file.id))&&!references.includes(file.id)&&!state.jobs.some(job=>job.id===file.jobId));
      state.files=files.filter(file=>!removedFiles.includes(file));
      for (const conversation of conversations.filter(c=>ids.has(c.id))) {
        for (const message of conversation.messages) indexed.delete(message.id);
        db.query('DELETE FROM chat_chunks WHERE conversationId = ?').run(conversation.id);
      }
      save();
      return {plan,removedFiles};
    } catch(error) { state.conversations = conversations; state.jobs = jobs; state.workflowRuns = workflowRuns; state.files = files; throw error; }
  });
  const deleteConversation=(...args)=>{
    const {plan,removedFiles}=deleteConversationState(...args);
    // Remove bytes only after SQLite commits; failed persistence must preserve attachments.
    for(const file of removedFiles)if(/^[a-f0-9-]{36}$/.test(file.id))rmSync(join(directory,'files',file.id),{force:true});
    return plan;
  };
  const store={directory,state,credentials,audit,save,search,conversationDeletion,deleteConversation,close:()=>db.close()};
  store.knowledge=openKnowledge(db,store);save();return store;
}

export function findAgent(state, id = state.agents[0].id) {
  const agent = state.agents.find(a => a.id === id);
  if (!agent) throw new Error('Agent not found.');
  return agent;
}

export function deleteAgent(state, id) {
  const agent = findAgent(state,id);
  if (state.agents.length === 1) throw new Error('Keep at least one agent. Add a replacement first.');
  if (state.conversations.some(c=>c.kind==='room' && c.governance && c.memberIds.includes(id))) throw new Error('Update this agent’s room roles and membership before deleting it.');
  if (state.workflows?.some(w=>w.steps.some(s=>s.agentId===id||s.room?.memberIds.includes(id))) || state.workflowRuns?.some(r=>['running','waiting','takeover'].includes(r.status) && (r.agentId===id || r.workflow.steps.some(s=>s.agentId===id||s.room?.memberIds.includes(id))))) throw new Error('Update or finish workflows using this agent before deleting it.');
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
  for (const id of memberIds) findAgent(state,id);
  const governance=input.governance;
  if(governance!==undefined && governance!==null){
    if(typeof governance!=='object'||Array.isArray(governance)||Object.keys(governance).some(key=>!['facilitatorId','reviewerIds','observerIds','outputs','ownerApproval'].includes(key)))throw new Error('Invalid room roles.');
    const {facilitatorId=null,reviewerIds=[],observerIds=[]}=governance;
    for(const ids of [reviewerIds,observerIds])if(!Array.isArray(ids)||ids.length>5||new Set(ids).size!==ids.length||ids.some(id=>!memberIds.includes(id)))throw new Error('Room roles require different room participants.');
    if(facilitatorId!==null && !memberIds.includes(facilitatorId))throw new Error('Facilitator must be a room participant.');
    if(observerIds.length===memberIds.length||observerIds.includes(facilitatorId)||reviewerIds.some(id=>observerIds.includes(id)))throw new Error('Observers cannot facilitate or review. Keep at least one contributor.');
    const options={};
    if(governance.ownerApproval!==undefined){if(typeof governance.ownerApproval!=='boolean')throw new Error('Choose an owner approval mode.');if(governance.ownerApproval)options.ownerApproval=true;}
    if(governance.outputs!==undefined){
      if(!Array.isArray(governance.outputs)||governance.outputs.length>20)throw new Error('Choose up to 20 required outputs.');
      options.outputs=governance.outputs.map(output=>{
        if(!output||Object.keys(output).some(key=>!['id','title','agentId','kind'].includes(key))||!memberIds.includes(output.agentId)||observerIds.includes(output.agentId))throw new Error('Each required output needs a responsible contributor.');
        const kind=output.kind||'document';if(!['document','evidence'].includes(kind))throw new Error('Choose document or evidence output.');
        return {id:output.id===undefined?randomUUID():textInput(output.id,80),title:textInput(output.title,120),agentId:output.agentId,kind};
      });
      if(new Set(options.outputs.map(output=>output.id)).size!==options.outputs.length)throw new Error('Required output IDs must be unique.');
    }
    return {title,memberIds:[...memberIds],governance:{facilitatorId,reviewerIds:[...reviewerIds],observerIds:[...observerIds],...options}};
  }
  return {title,memberIds:[...memberIds]};
}

export function validateRoomConfig(state,input) {
  return roomDetails(state,input);
}

export function createRoom(state, input) {
  const details = roomDetails(state,input);
  const room = {id:randomUUID(),kind:'room',...details,agentId:details.memberIds[0],createdAt:new Date().toISOString(),messages:[]};
  state.conversations.unshift(room); return room;
}

export function updateRoom(state, id, input) {
  const room = findRoom(state,id);
  const details = roomDetails(state,{...input,governance:Object.hasOwn(input,'governance') ? input.governance : room.governance});
  if (state.jobs.some(j => j.conversationId === id && ['queued','running','waiting','takeover','stopping'].includes(j.status))) throw new Error('Stop the room discussion before editing its participants.');
  const removed=room.memberIds.filter(id=>!details.memberIds.includes(id));
  const records=[...(room.artifacts||[]).flatMap(artifact=>[artifact.versions.at(-1),...(artifact.versions.at(-1)?.reviewEvents||[])])].filter(Boolean);
  if(removed.length&&records.some(record=>[record.taskId,...(record.sourceTaskIds||[])].some(taskId=>removed.includes(state.jobs.find(job=>job.id===taskId)?.agentId))))throw new Error('Retain participants referenced by room work, or pass approved work to a new room with different participants.');
  if(room.discussion && (JSON.stringify(room.memberIds)!==JSON.stringify(details.memberIds)||JSON.stringify(room.governance)!==JSON.stringify(details.governance))){
    room.discussion.status='stopped';room.discussion.invalidatedReason='Room configuration changed. Start a new discussion and review the new result.';
  }
  const obsolete=(room.artifacts||[]).filter(artifact=>artifact.outputId&&(()=>{const output=details.governance?.outputs?.find(item=>item.id===artifact.outputId);return !output||output.agentId!==artifact.agentId||output.kind!==artifact.kind;})());
  if(obsolete.length){(room.archivedArtifacts ||= []).push(...obsolete);room.artifacts=room.artifacts.filter(artifact=>!obsolete.includes(artifact));}
  if(!details.governance)delete room.governance;
  Object.assign(room,details,{agentId:details.memberIds[0]});
  if (!details.memberIds.includes(room.lastAgentId)) room.lastAgentId = room.agentId;
  return room;
}

export function validateAttachments(state, ids = []) {
  if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => typeof id !== 'string' || !state.files.some(file => file.id === id && file.kind === 'upload'))) throw new Error('Choose up to 20 uploaded files.');
  return [...new Set(ids)];
}

export function createJob(state, input, recordMessage = true) {
  const attachments = validateAttachments(state,input.attachments);
  const prompt = textInput(input.prompt || (attachments.length ? 'Describe the attached files.' : input.prompt));
  const interactionMode = input.interactionMode || 'confirm';
  if (!interactionModes.includes(interactionMode)) throw new Error('Choose an interaction mode.');
  let conversation = input.conversationId && state.conversations.find(c => c.id === input.conversationId);
  if (input.conversationId && !conversation) throw new Error('Conversation not found.');
  const agent = findAgent(state, input.agentId ?? conversation?.lastAgentId ?? conversation?.agentId);
  if (conversation?.kind === 'room') {
    if (!conversation.memberIds.includes(agent.id)) throw new Error('This agent is not in the room.');
  }
  const now = new Date().toISOString();
  if (!conversation) {
    conversation = { id: randomUUID(), agentId: agent.id, title: prompt.slice(0, 70), threadId: null, createdAt: now, messages: [] };
    state.conversations.unshift(conversation);
  }
  const job = { id: randomUUID(), agentId: agent.id, conversationId: conversation.id, prompt, attachments, interactionMode, status: 'queued', createdAt: now, events: [], toolCount: 0, files: [], scheduleId: input.scheduleId || null };
  conversation.lastAgentId = agent.id;
  if (recordMessage) conversation.messages.push({ id: randomUUID(), agentId:agent.id, role: 'user', text: prompt, attachments, at: now, jobId: job.id });
  state.jobs.unshift(job);
  return job;
}

export function recoverJobs(state) {
  for (const run of state.workflowRuns || []) if (['running','waiting','takeover'].includes(run.status)) { run.status = 'interrupted'; run.error = 'Service restarted. Review progress before resuming.'; }
  for (const room of state.conversations) if (room.kind === 'room' && room.discussion?.status === 'active') {
    room.discussion.status = 'paused';
    for (const job of state.jobs) if (job.roomRoundId === room.discussion.id && job.status === 'queued') {
      job.status = 'interrupted'; job.error = 'The service restarted. Review progress before continuing the discussion.'; job.endedAt = new Date().toISOString();
    }
  }
  for (const job of state.jobs) if (['running','waiting','takeover','stopping'].includes(job.status) || job.status==='queued' && state.workflowRuns?.some(r=>r.id===job.workflowRunId && r.status==='interrupted')) {
    job.status = 'interrupted'; job.error = 'The service restarted. Review progress, then resume; completed website actions are not undone.'; job.endedAt = new Date().toISOString(); job.pending = null; delete job.stopResult;
  }
}

export function enqueueSchedules(state, now = new Date(), submit = input=>createJob(state,input)) {
  let count = 0;
  for (const schedule of state.schedules) {
    if (!schedule.enabled || new Date(schedule.nextAt) > now) continue;
    if (state.jobs.some(j => j.scheduleId === schedule.id && ['queued','running','waiting','takeover','stopping','interrupted'].includes(j.status))) continue;
    try { submit({ prompt: schedule.prompt, agentId: schedule.agentId, interactionMode: schedule.interactionMode, scheduleId: schedule.id }); delete schedule.error; }
    catch(error) { schedule.enabled=false; schedule.error=error.message; count++; continue; }
    schedule.lastAt = now.toISOString();
    if (schedule.intervalMinutes) schedule.nextAt = new Date(now.valueOf() + schedule.intervalMinutes * 60_000).toISOString();
    else schedule.enabled = false;
    count++;
  }
  return count;
}
