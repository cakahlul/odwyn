import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {openStore,createRoom,updateRoom,deleteAgent,recoverJobs} from '../store.js';
import {Runtime} from '../runtime.js';
import {roomCompletion} from '../public/room-policy.js';

class Agent extends EventEmitter{
  child={};calls=[];replies=[];
  async request(method,params){
    this.calls.push({method,params});
    if(method==='account/read')return {account:{type:'chatgpt'}};
    if(method.startsWith('thread/'))return {thread:{id:params.threadId||randomUUID()}};
    if(method==='turn/start')return {turn:{id:randomUUID(),status:'inProgress'}};
    return {};
  }
  respond(id,result){this.replies.push(result);}
  reject(){}
}

test('room roles persist, reject ambiguous assignments, and never grant resource access',()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-review-policy-'));let store=openStore(directory);
  try{
    const primary=store.state.agents[0].id;
    store.state.agents.push({id:'engineer'},{id:'observer'});
    const input={title:'Review',spaceId:store.security.legacySpaceId,memberIds:[primary,'engineer','observer']};
    const governance={facilitatorId:primary,reviewerIds:[primary],observerIds:['observer']};
    for(const invalid of [true,[],{...governance,facilitatorId:'outside'},{...governance,reviewerIds:['outside']},{...governance,reviewerIds:[primary,primary]},{...governance,reviewerIds:['observer']},{...governance,observerIds:[primary]},{...governance,observerIds:input.memberIds},{...governance,approved:true}]){
      expect(()=>createRoom(store.state,{...input,governance:invalid})).toThrow();
    }
    expect(store.state.conversations).toHaveLength(0);
    const room=createRoom(store.state,{...input,governance});
    expect(room.governance).toEqual(governance);
    const access=store.security.access(primary);
    expect(()=>deleteAgent(store.state,primary)).toThrow('room role');
    expect(()=>deleteAgent(store.state,'engineer')).toThrow('room role');
    expect(()=>updateRoom(store.state,room.id,{...input,memberIds:['engineer','observer']})).toThrow();
    updateRoom(store.state,room.id,{...input,title:'Renamed'});
    expect(room.governance).toEqual(governance);
    expect(store.security.access(primary)).toEqual(access);
    room.discussion={id:'round',status:'completed',outcome:{id:'version',confirmations:{[primary]:'Checked'},reviews:{[primary]:{decision:'approve'}}}};
    updateRoom(store.state,room.id,{...input,governance:{...governance,reviewerIds:['engineer']}});
    expect(room.discussion.status).toBe('stopped');
    expect(room.discussion.invalidatedReason).toContain('configuration');
    expect(roomCompletion(room).ready).toBe(false);
    expect(room.discussion.outcome.reviews[primary].decision).toBe('approve');
    store.save();const id=room.id;store.close();store=openStore(directory);
    expect(store.state.conversations.find(c=>c.id===id).governance.reviewerIds).toEqual(['engineer']);
    updateRoom(store.state,id,{...input,governance:null});
    expect(store.state.conversations.find(c=>c.id===id).governance).toBeUndefined();
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('consensus cannot bypass reviewers, changes require a new version, and observers do not block completion',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-review-runtime-')),store=openStore(directory),lead=new Agent();
  const primary=store.state.agents[0].id;
  store.state.agents.push({id:'engineer',customization:{name:'Engineer',specialization:'build'}},{id:'observer',customization:{name:'Observer'}});
  const room=createRoom(store.state,{title:'Release review',spaceId:store.security.legacySpaceId,memberIds:['engineer',primary,'observer'],governance:{facilitatorId:primary,reviewerIds:[primary],observerIds:['observer']}});
  const runtime=new Runtime({store,codex:lead,browser:{},workspace:directory});
  runtime.addProvider('engineer',new Agent());runtime.addProvider('observer',new Agent());
  const call=async(tool,args)=>{
    const job=runtime.active,provider=runtime.providers.get(job.agentId);
    await runtime.handleRequest({id:randomUUID(),method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool,arguments:args}});
    return provider.replies.at(-1);
  };
  const done=(args={})=>call('odwyn_room_done',{summary:'Verified the result.',...(room.discussion.outcome?{proposalId:room.discussion.outcome.id}:{result:'Candidate 1',nextPlan:'Test'}),...args});
  const finish=async()=>{const job=runtime.active;runtime.providers.get(job.agentId).emit('notification',{method:'turn/completed',params:{threadId:job.threadId,turn:{id:job.turnId,status:'completed'}}});await runtime.drain();};
  try{
    for(const id of room.memberIds)await runtime.refreshAccount(id);
    runtime.submitRoom(room.id,{prompt:'build'});await runtime.drain();
    expect(runtime.active.agentId).toBe(primary);
    expect(lead.calls.find(c=>c.method==='thread/start').params.developerInstructions).toContain('Required reviewers');
    expect((await done()).success).toBe(true);const original=room.discussion.outcome.id;
    expect((await call('odwyn_room_review',{proposalId:original,decision:'approve',summary:'Forged',agentId:'engineer'})).success).toBe(false);
    await finish();expect(runtime.active.agentId).toBe('engineer');
    expect((await call('odwyn_room_review',{proposalId:original,decision:'approve',summary:'I approve for Lead'})).success).toBe(false);
    expect((await done()).success).toBe(true);
    await finish();expect(runtime.active.agentId).toBe('observer');
    expect(room.discussion.status).toBe('active');expect(room.messages.some(m=>m.roomReport)).toBe(false);
    expect((await done()).success).toBe(false);
    await call('odwyn_room_next',{agentId:primary,reason:'Review the candidate.'});await finish();
    expect(runtime.active.agentId).toBe(primary);
    expect((await call('odwyn_room_review',{proposalId:'stale',decision:'approve',summary:'Checked'})).success).toBe(false);
    expect((await call('odwyn_room_review',{proposalId:original,decision:'changes_requested',summary:'Missing validation.'})).success).toBe(true);
    const recovered=structuredClone(store.state);recoverJobs(recovered);
    expect(recovered.conversations.find(c=>c.id===room.id).discussion.status).toBe('paused');
    expect(recovered.conversations.find(c=>c.id===room.id).discussion.outcome.reviews[primary].decision).toBe('changes_requested');
    expect((await call('odwyn_room_review',{proposalId:original,decision:'approve',summary:'Changed my mind.'})).success).toBe(false);
    expect((await done()).success).toBe(false);
    await call('odwyn_room_next',{agentId:'engineer',reason:'Fix missing validation.'});await finish();
    expect(runtime.active.agentId).toBe('engineer');
    expect((await done({result:'Candidate 2 with validation',nextPlan:'Retest'})).success).toBe(true);
    const revised=room.discussion.outcome.id;expect(revised).not.toBe(original);
    expect(room.discussion.outcome.reviews).toEqual({});
    expect(room.discussion.previousOutcomes[0].reviews[primary].summary).toBe('Missing validation.');
    await call('odwyn_room_next',{agentId:primary,reason:'Review updated validation.'});await finish();
    expect((await call('odwyn_room_review',{proposalId:original,decision:'approve',summary:'Stale'})).success).toBe(false);
    expect((await done()).success).toBe(true);
    expect(room.discussion.status).toBe('active');
    expect((await call('odwyn_room_review',{proposalId:revised,decision:'approve',summary:'Validation checked.'})).success).toBe(true);
    await finish();
    expect(room.discussion.status).toBe('completed');
    expect(room.messages.filter(m=>m.roomReport)).toHaveLength(1);
    expect(room.messages.find(m=>m.roomReport).text).toContain('Candidate 2');
    expect(room.messages.find(m=>m.roomReport).agentId).toBe(primary);
    const approvals=room.discussion.outcome.reviews;
    store.save();const reloaded=openStore(directory);try{expect(reloaded.state.conversations.find(c=>c.id===room.id).discussion.outcome.reviews).toEqual(approvals);}finally{reloaded.close();}
    runtime.submitRoom(room.id,{prompt:'@Engineer Check one detail'});await runtime.drain();
    expect(runtime.active.agentId).toBe('engineer');
    expect((await done()).success).toBe(true);await finish();
    expect(room.discussion.status).toBe('active');
    expect(room.messages.filter(m=>m.roomReport)).toHaveLength(1);
    expect(room.discussionHistory.at(-1).outcome.id).toBe(revised);
    await runtime.cancelRoom(room.id);
  }finally{await runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test('review tools reject non-room tasks and role changes do not bypass current Space grants',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-review-security-')),store=openStore(directory),provider=new Agent();
  const runtime=new Runtime({store,codex:provider,browser:{},workspace:directory}),primary=store.state.agents[0].id;
  const call=async(tool,args)=>{const job=runtime.active;await runtime.handleRequest({id:randomUUID(),method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool,arguments:args}});return provider.replies.at(-1);};
  try{
    await runtime.refreshAccount();runtime.submit({prompt:'Private task'});await runtime.drain();
    expect((await call('odwyn_room_review',{proposalId:'fake',decision:'approve',summary:'Approve'})).success).toBe(false);
    await runtime.cancel(runtime.active.id);
    store.state.agents.push({id:'observer'});runtime.addProvider('observer',new Agent());await runtime.refreshAccount('observer');
    const p=store.security,space=p.createSpace({name:'Restricted'});
    for(const agentId of [primary,'observer'])p.putAccess(agentId,{revision:p.revision,spaceIds:[space.id],grants:[]});
    const room=createRoom(store.state,{title:'Scoped review',spaceId:space.id,memberIds:[primary,'observer'],governance:{facilitatorId:primary,reviewerIds:[primary],observerIds:['observer']}});
    runtime.submitRoom(room.id,{prompt:'Review scoped result'});await runtime.drain();
    const source=p.createResource({spaceId:space.id,type:'memory',name:'Restricted notes'});
    const grant=agentId=>p.putAccess(agentId,{revision:p.revision,spaceIds:[space.id],grants:[{spaceId:space.id,resourceId:source.id,action:'memory.read',mode:'auto'}]});
    grant(primary);grant('observer');store.data.note(runtime.active,source.id,'memory.read');
    expect((await call('odwyn_room_done',{result:'Scoped candidate',nextPlan:'Review',summary:'Checked.'})).success).toBe(true);
    const proposalId=room.discussion.outcome.id;
    p.putAccess('observer',{revision:p.revision,spaceIds:[space.id],grants:[]});
    expect((await call('odwyn_room_review',{proposalId,decision:'approve',summary:'Checked.'})).success).toBe(false);
    expect(room.discussion.outcome.reviews).toEqual({});
    grant('observer');
    expect((await call('odwyn_room_review',{proposalId,decision:'approve',summary:'Checked.'})).success).toBe(true);
    p.putAccess('observer',{revision:p.revision,spaceIds:[],grants:[]});
    runtime.finish(runtime.active,'completed');
    expect(room.discussion.status).toBe('paused');
    expect(room.messages.some(message=>message.roomReport)).toBe(false);
  }finally{await runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test('offline observers cannot strand required reviewers between discussion rounds',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-offline-observer-')),store=openStore(directory),provider=new Agent();
  const primary=store.state.agents[0].id;
  store.state.agents.push({id:'engineer'},{id:'offline'});
  const room=createRoom(store.state,{title:'Review with offline observer',spaceId:store.security.legacySpaceId,memberIds:[primary,'engineer','offline'],governance:{facilitatorId:primary,reviewerIds:[primary],observerIds:['offline']}});
  const runtime=new Runtime({store,codex:provider,browser:{},workspace:directory});runtime.addProvider('engineer',new Agent());
  const call=async(tool,args)=>{const job=runtime.active;await runtime.handleRequest({id:randomUUID(),method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool,arguments:args}});};
  const finish=async()=>{runtime.finish(runtime.active,'completed');await runtime.drain();};
  try{
    await runtime.refreshAccount();await runtime.refreshAccount('engineer');
    for(const disconnect of [false,true]){
      if(disconnect){runtime.addProvider('offline',new Agent());await runtime.refreshAccount('offline');}
      runtime.submitRoom(room.id,{prompt:'Review'});await runtime.drain();
      if(disconnect)runtime.accounts.set('offline',{account:null});
      await call('odwyn_room_done',{result:'Candidate',nextPlan:'Check',summary:'Checked'});await finish();
      const proposalId=room.discussion.outcome.id;
      await call('odwyn_room_done',{proposalId,summary:'Checked'});await finish();
      expect(runtime.active?.agentId).toBe(primary);
      await call('odwyn_room_review',{proposalId,decision:'approve',summary:'Independently checked.'});await finish();
      expect(room.discussion.status).toBe('completed');
      expect(store.state.jobs.some(job=>['running','queued'].includes(job.status))).toBe(false);
    }
    runtime.accounts.set('offline',{account:{type:'chatgpt'}});
    runtime.submitRoom(room.id,{prompt:'Keep reviewing'});await runtime.drain();runtime.accounts.set('offline',{account:null});
    for(let turn=0;turn<30 && room.discussion.status==='active';turn++){expect(runtime.active).not.toBeNull();await finish();}
    expect(room.discussion.status).toBe('paused');
    expect(store.state.jobs.filter(job=>job.roomRoundId===room.discussion.id)).toHaveLength(30);
    expect(store.state.jobs.some(job=>['running','queued'].includes(job.status))).toBe(false);
  }finally{await runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test('review rationale keeps the reviewer task provenance when a new resource is read',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-review-provenance-')),store=openStore(directory),provider=new Agent(),primary=store.state.agents[0].id;
  store.state.agents.push({id:'reviewer'});
  const runtime=new Runtime({store,codex:provider,browser:{},workspace:directory});runtime.addProvider('reviewer',new Agent());
  const p=store.security,space=p.createSpace({name:'Review scope'}),resource=p.createResource({spaceId:space.id,name:'Review evidence',type:'memory'});
  const grant=(agentId,granted)=>p.putAccess(agentId,{revision:p.revision,spaceIds:[space.id],grants:granted?[{spaceId:space.id,resourceId:resource.id,action:'memory.read',mode:'auto'}]:[]});
  for(const id of [primary,'reviewer'])grant(id,true);
  const room=createRoom(store.state,{title:'Classified review',spaceId:space.id,memberIds:[primary,'reviewer'],governance:{facilitatorId:primary,reviewerIds:['reviewer'],observerIds:[]}});
  const call=async(tool,args)=>{const job=runtime.active;await runtime.handleRequest({id:randomUUID(),method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool,arguments:args}});};
  try{
    await runtime.refreshAccount();await runtime.refreshAccount('reviewer');runtime.submitRoom(room.id,{prompt:'Review evidence'});await runtime.drain();
    const author=runtime.active;
    await call('odwyn_room_done',{result:'Candidate',nextPlan:'Review',summary:'Prepared.'});runtime.finish(author,'completed');await runtime.drain();
    const reviewer=runtime.active;store.data.note(reviewer,resource.id,'memory.read');
    await call('odwyn_room_review',{proposalId:room.discussion.outcome.id,decision:'approve',summary:'Evidence contains restricted rationale.'});
    expect(room.discussion.outcome.reviews.reviewer.summary).toContain('restricted rationale');
    grant(primary,false);
    expect(store.data.proposal(author,room.discussion.outcome)).toBeNull();
    grant(primary,true);expect(store.data.proposal(author,room.discussion.outcome)?.id).toBe(room.discussion.outcome.id);
    grant('reviewer',false);expect(store.data.proposal(author,room.discussion.outcome)).toBeNull();
  }finally{await runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}
});
