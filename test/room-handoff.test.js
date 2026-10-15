import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,createRoom,createJob} from '../store.js';
import {Runtime} from '../runtime.js';
import {saveFileBytes} from '../files.js';

class Agent extends EventEmitter{child={};async request(){return {};}respond(){}reject(){} }
test('owner handoffs export only selected approved versions, preserve revocation and never inherit grants',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-handoff-')),store=openStore(directory),primary=store.state.agents[0].id;
  store.state.agents.push({id:'peer'},{id:'recipient'});const p=store.security,A=p.createSpace({name:'Drafts'}),B=p.createSpace({name:'Planning'}),notes=p.createResource({spaceId:A.id,type:'memory',name:'Private research'});
  const grant=enabled=>{for(const id of [primary,'peer'])p.putAccess(id,{revision:p.revision,spaceIds:[A.id,B.id],grants:enabled?[{spaceId:A.id,resourceId:notes.id,action:'memory.read',mode:'auto'}]:[]});};grant(true);
  p.putAccess('recipient',{revision:p.revision,spaceIds:[B.id],grants:[]});
  const source=createRoom(store.state,{title:'Grooming',spaceId:A.id,memberIds:[primary,'peer'],governance:{facilitatorId:primary}}),job=createJob(store.state,{conversationId:source.id,agentId:primary,prompt:'Draft'});job.status='completed';
  store.data.note(job,notes.id,'memory.read');
  const version={id:randomUUID(),taskId:job.id,text:'Approved contract',reviews:{}};
  const artifact={id:randomUUID(),agentId:primary,title:'Contract',kind:'document',versions:[version]};source.artifacts=[artifact];
  const file=saveFileBytes(Buffer.from('approved attachment'),'contract.txt',join(directory,'files'),job.id);file.spaceId=A.id;store.state.files.push(file);
  const fileArtifact={id:randomUUID(),agentId:primary,title:'File',kind:'document',versions:[{id:randomUUID(),taskId:job.id,fileId:file.id,reviews:{}}]};source.artifacts.push(fileArtifact);
  const outcome={id:randomUUID(),result:'Agreed',nextPlan:'Review in Planning',confirmations:{[primary]:'Checked',peer:'Checked'},confirmationTasks:{[primary]:job.id},reviews:{},artifacts:source.artifacts.map(item=>({id:item.id,versionId:item.versions[0].id}))};
  source.discussion={id:randomUUID(),memberIds:source.memberIds,status:'completed',outcome};store.data.propose(job,outcome);
  source.messages.push({id:randomUUID(),role:'assistant',agentId:primary,jobId:job.id,roomReport:true,proposalId:outcome.id,text:'Agreed selected contract'});store.save();
  const runtime=new Runtime({store,codex:new Agent(),browser:{},workspace:directory});
  const input={room:{title:'Planning',spaceId:B.id,memberIds:[primary,'recipient'],governance:{facilitatorId:primary}},artifactIds:[artifact.id,fileArtifact.id],openQuestions:'Clarify timeline'};
  try{
    const workspace=p.createResource({spaceId:B.id,type:'workspace',name:'Transferred work',metadata:{}}),checkpoint={id:'a'.repeat(64),spaceId:A.id,resourceId:randomUUID(),taskId:job.id};source.checkpoints=[checkpoint];
    const copy=runtime.sandbox.copyCheckpoint,changed=runtime.changed;runtime.sandbox.copyCheckpoint=()=>({id:'b'.repeat(64),spaceId:B.id,resourceId:workspace.id,createdAt:new Date().toISOString()});runtime.changed=()=>{throw Error('Persistence failed');};
    await expect(runtime.handoffRoom(source.id,{...input,checkpointId:checkpoint.id,workspaceResourceId:workspace.id})).rejects.toThrow('Persistence failed');
    expect(store.state.executionHeads?.[workspace.id]).toBeUndefined();expect(source.handoffs||[]).toHaveLength(0);expect(store.state.conversations.filter(room=>room.handoff?.sourceRoomId===source.id)).toHaveLength(0);
    runtime.sandbox.copyCheckpoint=copy;runtime.changed=changed;
    const access=p.access('recipient'),target=await runtime.handoffRoom(source.id,input);
    expect((await runtime.handoffRoom(source.id,input)).id).toBe(target.id);expect((await runtime.handoffRoom(source.id,{openQuestions:input.openQuestions,artifactIds:input.artifactIds,room:input.room})).id).toBe(target.id);expect(source.handoffs).toHaveLength(1);
    expect(p.access('recipient').grants).toEqual(access.grants);expect(p.access('recipient').spaceIds).toEqual(access.spaceIds);
    const reader=createJob(store.state,{conversationId:target.id,agentId:'recipient',prompt:'Read handoff'});reader.status='completed';
    const shared=store.data.readExport(reader,target.handoff.exportId).roomHandoff;
    expect(shared.artifacts[0].text).toBe('Approved contract');expect(shared.openQuestions).toBe('Clarify timeline');
    const saved=store.state.files.find(item=>item.id===shared.artifacts[1].file.id);expect(saved.spaceId).toBe(B.id);store.save();
    expect(store.data.file(reader,saved.id).name).toBe('contract.txt');
    const unrelated=createRoom(store.state,{title:'Other room',spaceId:B.id,memberIds:[primary,'recipient']}),other=createJob(store.state,{conversationId:unrelated.id,agentId:'recipient',prompt:'Guess ID'});other.status='completed';
    expect(()=>store.data.readExport(other,target.handoff.exportId)).toThrow('another room');
    expect(()=>store.data.file(reader,file.id)).toThrow('Space');
    expect(()=>store.deleteConversation(source.id)).toThrow('Linked room');
    source.discussion.status='active';expect(()=>store.data.readExport(reader,target.handoff.exportId)).toThrow('changed or revoked');source.discussion.status='completed';
    const derived={id:randomUUID(),title:'Derived plan',agentId:'recipient',kind:'document',versions:[{id:randomUUID(),taskId:reader.id,text:'Plan based on shared contract',reviews:{}}]};target.artifacts=[derived];
    const downstreamOutcome={id:randomUUID(),result:'Plan ready',nextPlan:'Execute',confirmations:{[primary]:'Checked',recipient:'Checked'},confirmationTasks:{recipient:reader.id},reviews:{},artifacts:[{id:derived.id,versionId:derived.versions[0].id}]};
    target.discussion={id:randomUUID(),status:'completed',memberIds:target.memberIds,outcome:downstreamOutcome};store.data.propose(reader,downstreamOutcome);
    target.messages.push({id:randomUUID(),role:'assistant',agentId:'recipient',jobId:reader.id,roomReport:true,proposalId:downstreamOutcome.id,text:'Derived approved plan'});store.save();
    const third=await runtime.handoffRoom(target.id,{room:{title:'Execution',spaceId:B.id,memberIds:target.memberIds},artifactIds:[derived.id]});
    const downstream=createJob(store.state,{conversationId:third.id,agentId:'recipient',prompt:'Read plan'});downstream.status='completed';
    expect(store.data.readExport(downstream,third.handoff.exportId).roomHandoff.artifacts[0].text).toContain('shared contract');
    store.data.revokeExport(target.handoff.exportId);expect(()=>store.data.file(reader,saved.id)).toThrow('changed or revoked');
    expect(()=>store.data.readExport(downstream,third.handoff.exportId)).toThrow('changed or revoked');
  }finally{await runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}
});
