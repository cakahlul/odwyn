import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openStore,createJob,createRoom,enqueueSchedules} from '../store.js';
import {createApp} from '../server.js';
import {defaults,validateProfile} from '../public/profile.js';
import {validateWorkflow} from '../workflows.js';

const value={name:'Architecture <core>',summary:'Core service rules',content:'Use versioned API contracts.'};
function fixture(){const directory=mkdtempSync(join(tmpdir(),'odwyn-knowledge-')),store=openStore(directory);store.state.customization={...defaults};return {directory,store,close(){store.close();rmSync(directory,{recursive:true,force:true});}};}
function grant(store,agentId,docs){const p=store.security,resources=docs.flatMap(doc=>doc.resources);p.putAccess(agentId,{revision:p.revision,spaceIds:[...new Set(resources.map(row=>row.spaceId))],grants:resources.map(row=>({spaceId:row.spaceId,resourceId:row.id,action:'knowledge.read',mode:'auto'}))});}

test('knowledge CRUD is versioned, persistent, validates all scopes and revokes grants atomically',()=>{
 const f=fixture(),{store}=f,p=store.security,first=p.legacySpaceId,second=p.createSpace({name:'Execution'}).id,agent=store.state.agents[0];
 try{
  const before=p.listResources().length;
  for(const input of [{...value,spaceIds:[]},{...value,spaceIds:[first,'missing']},{...value,spaceIds:[first],content:''},{...value,spaceIds:[first],content:'x'.repeat(20001)},{...value,spaceIds:[first],extra:true}])expect(()=>store.knowledge.create(input)).toThrow();
  expect(p.listResources()).toHaveLength(before);
  const doc=store.knowledge.create({...value,spaceIds:[first,second,first]});expect(doc.version).toBe(1);expect(doc.resources).toHaveLength(2);expect(doc.resources.map(row=>p.resource(row.id).type)).toEqual(['knowledge','knowledge']);
  grant(store,agent.id,[doc]);store.state.customization={...defaults,knowledgeIds:[doc.id]};store.save();
  expect(store.knowledge.update(doc.id,{...value,version:1})).toBe(doc);expect(p.access(agent.id).grants.every(row=>row.mode==='auto')).toBe(true);
  expect(()=>store.knowledge.update(doc.id,{...value,version:0})).toThrow('Reload');
  const job=createJob(store.state,{agentId:agent.id,spaceId:first,prompt:'Active'});
  expect(()=>store.knowledge.update(doc.id,{...value,content:'Changed',version:1})).toThrow();expect(p.access(agent.id).grants.every(row=>row.mode==='auto')).toBe(true);job.status='completed';
  const next=store.knowledge.update(doc.id,{...value,content:'Changed',version:1});expect(next.version).toBe(2);expect(p.access(agent.id).grants.every(row=>row.mode==='deny')).toBe(true);
  grant(store,agent.id,[next]);const original=p.updateResource;let writes=0;p.updateResource=(...args)=>{if(++writes===2)throw Error('Injected second-resource failure');return original(...args);};
  try{expect(()=>store.knowledge.update(doc.id,{...value,content:'Must roll back',version:2})).toThrow('Injected');}finally{p.updateResource=original;}
  expect(store.state.knowledge[0].version).toBe(2);expect(p.resource(doc.resources[0].id).metadata.version).toBe(2);expect(p.access(agent.id).grants.every(row=>row.mode==='auto')).toBe(true);
  const reopened=openStore(f.directory);expect(reopened.state.knowledge[0].content).toBe('Changed');expect(reopened.state.knowledge[0].version).toBe(2);reopened.close();
  expect(()=>store.knowledge.delete(doc.id,{version:1})).toThrow('Reload');store.knowledge.delete(doc.id,{version:2});expect(store.state.knowledge).toEqual([]);expect(store.state.customization.knowledgeIds).toEqual([]);for(const resource of doc.resources)expect(()=>p.resource(resource.id)).toThrow();
  expect(()=>validateProfile({...defaults,knowledgeIds:'wrong'})).toThrow();expect(()=>validateProfile({...defaults,knowledgeIds:Array(21).fill('x')})).toThrow();
 }finally{f.close();}
});

test('assigned knowledge follows Space permissions, preserves provenance and blocks private room disclosure',()=>{
 const f=fixture(),{store}=f,p=store.security,agent=store.state.agents[0],first=p.legacySpaceId,second=p.createSpace({name:'Testing'}).id;
 try{
  const shared=store.knowledge.create({...value,spaceIds:[first,second]}),long=store.knowledge.create({...value,name:'Long reference',content:'Intro '.repeat(600)+'\nNeedle UNIQUE_DETAIL',spaceIds:[first]}),other=store.knowledge.create({...value,name:'Unselected',content:'UNASSIGNED_CONTENT',spaceIds:[first]});
  const profile={...defaults,knowledgeIds:[shared.id,long.id]},job=createJob(store.state,{agentId:agent.id,spaceId:first,prompt:'Read'});job.status='running';
  expect(store.knowledge.prepare(job,profile)).toBe('');expect(()=>store.knowledge.read(job,{resourceId:shared.resources[0].id})).toThrow();
  grant(store,agent.id,[shared,long,other]);const context=store.knowledge.prepare(job,profile);expect(context).toContain(shared.content);expect(context).not.toContain('UNIQUE_DETAIL');expect(context).not.toContain('UNASSIGNED_CONTENT');expect(job.knowledgeVersions.map(doc=>doc.version)).toEqual([1,1]);
  expect(store.knowledge.read(job,{resourceId:long.resources[0].id,query:'Needle'}).matches[0].content).toContain('UNIQUE_DETAIL');expect(store.knowledge.read(job,{resourceId:long.resources[0].id}).content).toBe(long.content);expect(()=>store.knowledge.read(job,{resourceId:other.resources[0].id})).toThrow('assigned');expect(()=>store.knowledge.read(job,{resourceId:long.resources[0].id,query:'x',agentId:agent.id})).toThrow();
  const next=createJob(store.state,{agentId:agent.id,spaceId:second,prompt:'Other Space'});expect(store.knowledge.prepare(next,profile)).toContain(shared.content);expect(next.knowledgeContext).toHaveLength(1);
  const colleague={id:randomUUID(),customization:{...defaults}};store.state.agents.push(colleague);p.putAccess(colleague.id,{revision:p.revision,spaceIds:[first],grants:[]});
  const room=createRoom(store.state,{spaceId:first,title:'Review',memberIds:[agent.id,colleague.id]}),roomJob=createJob(store.state,{agentId:agent.id,conversationId:room.id,prompt:'Discuss'});
  expect(store.knowledge.prepare(roomJob,profile)).toBe('');expect(()=>store.knowledge.read(roomJob,{resourceId:shared.resources[0].id})).toThrow('participant');
  grant(store,colleague.id,[shared,long]);expect(store.knowledge.prepare(roomJob,profile)).toContain(shared.content);
  const follow=createJob(store.state,{agentId:colleague.id,conversationId:room.id,prompt:'Read prior output'});store.data.assertHandoff(follow,[roomJob.id]);
  p.putAccess(colleague.id,{revision:p.revision,spaceIds:[first],grants:[]});expect(()=>store.data.assertHandoff(follow,[roomJob.id])).toThrow();
 }finally{f.close();}
});

test('owner knowledge API rejects task administration and managed-resource bypasses; provider receives knowledge in chats, retries and workflows',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-knowledge-api-')),calls=[],replies=[];
 const provider=Object.assign(new EventEmitter(),{request:async(method,params)=>{calls.push({method,params});if(method==='account/read')return {account:{type:'chatgpt'}};if(method.startsWith('thread/'))return {thread:{id:params.threadId||randomUUID()}};if(method==='turn/start')return {turn:{id:randomUUID(),status:'inProgress'}};return {};},respond:(id,result)=>replies.push({id,result}),reject(){},stop(){}});
 const app=createApp({directory,user:'owner',password:'knowledge-password-long',origin:'http://localhost',codex:provider,browser:{close:async()=>{}}}),{store}=app.runtime,p=store.security;
 const headers={authorization:'Basic '+Buffer.from('owner:knowledge-password-long').toString('base64'),origin:'http://localhost','content-type':'application/json'};
 const request=(path,body,method='POST',auth=headers)=>app.fetch(new Request('http://localhost'+path,{method,headers:auth,...(body===undefined?{}:{body:JSON.stringify(body)})}));
 try{
  store.state.customization={...defaults};const agent=store.state.agents[0],spaceId=p.legacySpaceId;
  const created=await request('/api/knowledge',{...value,spaceIds:[spaceId]});expect(created.status).toBe(201);const doc=await created.json();expect((await request('/api/knowledge',undefined,'GET')).status).toBe(200);
  expect((await request(`/api/resources/${doc.resources[0].id}`,{metadata:{version:2}},'PUT')).status).toBe(400);expect((await request(`/api/resources/${doc.resources[0].id}`,undefined,'DELETE')).status).toBe(400);
  expect((await request('/api/customization',{...defaults,knowledgeIds:['missing']},'PUT')).status).toBe(400);
  expect((await request('/api/customization',{...defaults,knowledgeIds:[doc.id]},'PUT')).status).toBe(200);grant(store,agent.id,[doc]);await app.runtime.refreshAccount();
  const job=app.runtime.submit({prompt:'Use the architecture'});await app.runtime.drain();expect(calls.find(row=>row.method==='thread/start').params.developerInstructions).toContain(doc.content);expect(job.knowledgeVersions[0].version).toBe(1);
  const token=store.data.issueToken(job),bearer={...headers,authorization:'Bearer '+token};expect((await request('/api/knowledge',undefined,'GET',bearer)).status).toBe(403);expect((await request('/api/knowledge',{...value,spaceIds:[spaceId]},'POST',bearer)).status).toBe(401);
  await app.runtime.executeRequest({id:'read',method:'item/tool/call',params:{threadId:job.threadId,tool:'odwyn_knowledge',arguments:{resourceId:doc.resources[0].id}}});expect(replies.at(-1).result.success).toBe(true);expect(JSON.stringify(replies.at(-1))).toContain(doc.content);
  app.runtime.finish(job,'failed','Retry this');const retry=app.runtime.retry(job.id);await app.runtime.drain();expect(retry.knowledgeVersions[0].version).toBe(1);app.runtime.finish(retry,'completed');
  const workflow=validateWorkflow({name:'Knowledge workflow',command:'knowledge-check',steps:[{id:'check',type:'agent',prompt:'Check standards',tools:[]}]},store.state);store.state.workflows.push(workflow);
  const task=app.runtime.submit({prompt:'/knowledge-check'});await app.runtime.drain();expect(task.knowledgeVersions[0].id).toBe(doc.id);const start=calls.filter(row=>row.method==='thread/start').at(-1);expect(start.params.dynamicTools.some(tool=>tool.name==='odwyn_knowledge')).toBe(true);expect(start.params.developerInstructions).toContain(doc.content);
  await app.runtime.executeRequest({id:'workflow-read',method:'item/tool/call',params:{threadId:task.threadId,tool:'odwyn_knowledge',arguments:{resourceId:doc.resources[0].id}}});expect(replies.at(-1).result.success).toBe(true);app.runtime.finish(task,'completed');
  const conversationId=job.conversationId;
  await request('/api/customization',{...defaults,knowledgeIds:[]},'PUT');
  const removed=app.runtime.submit({conversationId,prompt:'Continue without assigned knowledge'});await app.runtime.drain();
  const removedStart=calls.filter(row=>row.method.startsWith('thread/')).at(-1);expect(removedStart.method).toBe('thread/start');expect(removedStart.params.developerInstructions).not.toContain(doc.content);expect(removed.knowledgeVersions||[]).toEqual([]);app.runtime.finish(removed,'completed');
  await request('/api/customization',{...defaults,knowledgeIds:[doc.id]},'PUT');p.putAccess(agent.id,{revision:p.revision,spaceIds:[spaceId],grants:[]});
  const revoked=app.runtime.submit({conversationId,prompt:'Continue after revocation'});await app.runtime.drain();const revokedStart=calls.filter(row=>row.method.startsWith('thread/')).at(-1);expect(revokedStart.method).toBe('thread/start');expect(revokedStart.params.developerInstructions).not.toContain(doc.content);app.runtime.finish(revoked,'completed');
  const updated=store.knowledge.update(doc.id,{...value,content:'NEW_VERSION_REFERENCE',version:1});grant(store,agent.id,[updated]);
  const schedule=app.runtime.schedule({prompt:'Use latest knowledge when due',at:new Date(Date.now()+60000).toISOString()});enqueueSchedules(store.state,new Date(Date.now()+120000),input=>app.runtime.submit(input));await app.runtime.drain();
  const scheduled=app.runtime.active;expect(scheduled.scheduleId).toBe(schedule.id);expect(scheduled.knowledgeVersions[0].version).toBe(2);const scheduledStart=calls.filter(row=>row.method.startsWith('thread/')).at(-1);expect(scheduledStart.params.developerInstructions).toContain('NEW_VERSION_REFERENCE');
 }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});
