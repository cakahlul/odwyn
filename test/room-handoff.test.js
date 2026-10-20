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
test('owner handoffs preserve selected approved versions, copied files and durable downstream packages',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-handoff-')),store=openStore(directory),primary=store.state.agents[0].id;
  store.state.agents.push({id:'peer'},{id:'recipient'});
  const source=createRoom(store.state,{title:'Grooming',memberIds:[primary,'peer'],governance:{facilitatorId:primary}}),job=createJob(store.state,{conversationId:source.id,agentId:primary,prompt:'Draft'});job.status='completed';
  const version={id:randomUUID(),taskId:job.id,text:'Approved contract',reviews:{}};
  const artifact={id:randomUUID(),agentId:primary,title:'Contract',kind:'document',versions:[version]};source.artifacts=[artifact];
  const file=saveFileBytes(Buffer.from('approved attachment'),'contract.txt',join(directory,'files'),job.id);store.state.files.push(file);
  const fileArtifact={id:randomUUID(),agentId:primary,title:'File',kind:'document',versions:[{id:randomUUID(),taskId:job.id,fileId:file.id,reviews:{}}]};source.artifacts.push(fileArtifact);
  const outcome={id:randomUUID(),result:'Agreed',nextPlan:'Review in Planning',confirmations:{[primary]:'Checked',peer:'Checked'},confirmationTasks:{[primary]:job.id},reviews:{},artifacts:source.artifacts.map(item=>({id:item.id,versionId:item.versions[0].id}))};
  source.discussion={id:randomUUID(),memberIds:source.memberIds,status:'completed',outcome};
  source.messages.push({id:randomUUID(),role:'assistant',agentId:primary,jobId:job.id,roomReport:true,proposalId:outcome.id,text:'Agreed selected contract'});store.save();
  const runtime=new Runtime({store,codex:new Agent(),browser:{},workspace:directory});
  const input={room:{title:'Planning',memberIds:[primary,'recipient'],governance:{facilitatorId:primary}},artifactIds:[artifact.id,fileArtifact.id],openQuestions:'Clarify timeline'};
  try{
    const changed=runtime.changed;runtime.changed=()=>{throw Error('Persistence failed');};
    await expect(runtime.handoffRoom(source.id,input)).rejects.toThrow('Persistence failed');
    expect(source.handoffs||[]).toHaveLength(0);expect(store.state.conversations.filter(room=>room.handoff?.sourceRoomId===source.id)).toHaveLength(0);
    runtime.changed=changed;
    const target=await runtime.handoffRoom(source.id,input);
    expect((await runtime.handoffRoom(source.id,input)).id).toBe(target.id);expect((await runtime.handoffRoom(source.id,{openQuestions:input.openQuestions,artifactIds:input.artifactIds,room:input.room})).id).toBe(target.id);expect(source.handoffs).toHaveLength(1);
    const reader=createJob(store.state,{conversationId:target.id,agentId:'recipient',prompt:'Read handoff'});reader.status='completed';
    const shared=target.handoff.package;
    expect(shared.artifacts[0].text).toBe('Approved contract');expect(shared.openQuestions).toBe('Clarify timeline');
    const saved=store.state.files.find(item=>item.id===shared.artifacts[1].file.id);store.save();
    expect(saved.name).toBe('contract.txt');
    expect(()=>store.deleteConversation(source.id)).toThrow('Linked room');
    const derived={id:randomUUID(),title:'Derived plan',agentId:'recipient',kind:'document',versions:[{id:randomUUID(),taskId:reader.id,text:'Plan based on shared contract',reviews:{}}]};target.artifacts=[derived];
    const downstreamOutcome={id:randomUUID(),result:'Plan ready',nextPlan:'Execute',confirmations:{[primary]:'Checked',recipient:'Checked'},confirmationTasks:{recipient:reader.id},reviews:{},artifacts:[{id:derived.id,versionId:derived.versions[0].id}]};
    target.discussion={id:randomUUID(),status:'completed',memberIds:target.memberIds,outcome:downstreamOutcome};
    target.messages.push({id:randomUUID(),role:'assistant',agentId:'recipient',jobId:reader.id,roomReport:true,proposalId:downstreamOutcome.id,text:'Derived approved plan'});store.save();
    const third=await runtime.handoffRoom(target.id,{room:{title:'Execution',memberIds:target.memberIds},artifactIds:[derived.id]});
    const downstream=createJob(store.state,{conversationId:third.id,agentId:'recipient',prompt:'Read plan'});downstream.status='completed';
    expect(third.handoff.package.artifacts[0].text).toContain('shared contract');
  }finally{await runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}
});
