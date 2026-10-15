import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,createRoom} from '../store.js';
import {Runtime} from '../runtime.js';
import {roomCompletion} from '../public/room-policy.js';

class Agent extends EventEmitter{child={};replies=[];async request(method,params){if(method==='account/read')return {account:{type:'chatgpt'}};if(method.startsWith('thread/'))return {thread:{id:params.threadId||randomUUID()}};if(method==='turn/start')return {turn:{id:randomUUID(),status:'inProgress'}};return {};}respond(id,result){this.replies.push(result);}reject(){} }

test('required deliverables retain versions, enforce authors/reviewers and wait for exact owner approval before publishing',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-deliverables-')),store=openStore(directory),lead=new Agent(),engineer=new Agent(),primary=store.state.agents[0].id;
  store.state.agents.push({id:'engineer'});
  const room=createRoom(store.state,{title:'Planning',spaceId:store.security.legacySpaceId,memberIds:[primary,'engineer'],governance:{facilitatorId:primary,reviewerIds:[primary],observerIds:[],ownerApproval:true,outputs:[{id:'trd',title:'Technical design',agentId:'engineer'}]}});
  const runtime=new Runtime({store,codex:lead,browser:{},workspace:directory});runtime.addProvider('engineer',engineer);
  const call=async(tool,args)=>{const job=runtime.active,provider=runtime.providers.get(job.agentId);await runtime.handleRequest({id:randomUUID(),method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool,arguments:args}});const reply=provider.replies.at(-1);return {success:reply.success,value:reply.success?JSON.parse(reply.contentItems[0].text):reply.contentItems[0].text};};
  const finish=async()=>{runtime.finish(runtime.active,'completed');await runtime.drain();};
  try{
    await runtime.refreshAccount();await runtime.refreshAccount('engineer');runtime.submitRoom(room.id,{prompt:'Prepare the design'});await runtime.drain();
    expect(roomCompletion(room).pendingOutputIds).toEqual(['trd']);
    expect((await call('odwyn_artifact_write',{outputId:'trd',text:'Wrong author'})).success).toBe(false);
    await finish();
    const draft=await call('odwyn_artifact_write',{outputId:'trd',text:'# Design\nAPI contract v1'});expect(draft.success).toBe(true);
    const artifact=room.artifacts[0],original=artifact.versions[0].id;
    expect(store.state.files).toHaveLength(0);
    expect((await call('odwyn_artifact_review',{artifactId:artifact.id,versionId:original,decision:'approve',summary:'Forged review'})).success).toBe(false);
    await call('odwyn_room_next',{agentId:primary,reason:'Review design'});await finish();
    expect((await call('odwyn_artifact_review',{artifactId:artifact.id,versionId:original,decision:'changes_requested',summary:'Add error responses'})).success).toBe(true);
    await call('odwyn_room_next',{agentId:'engineer',reason:'Add error responses'});await finish();
    expect((await call('odwyn_artifact_write',{artifactId:artifact.id,versionId:'stale',text:'Lost update'})).success).toBe(false);
    expect((await call('odwyn_artifact_write',{artifactId:artifact.id,versionId:original,text:'# Design\nAPI contract v2 with errors'})).success).toBe(true);
    expect(artifact.versions).toHaveLength(2);const version=artifact.versions.at(-1).id;
    expect(artifact.versions[0].reviews[primary].decision).toBe('changes_requested');
    await call('odwyn_room_next',{agentId:primary,reason:'Review updated contract'});await finish();
    expect((await call('odwyn_artifact_review',{artifactId:artifact.id,versionId:original,decision:'approve',summary:'Stale'})).success).toBe(false);
    expect((await call('odwyn_artifact_review',{artifactId:artifact.id,versionId:version,decision:'approve',summary:'Errors checked'})).success).toBe(true);
    await call('odwyn_room_done',{result:'Design ready',nextPlan:'Develop after owner approval',summary:'Design checked'});
    const proposalId=room.discussion.outcome.id;
    await call('odwyn_room_review',{proposalId,decision:'approve',summary:'Reviewed package'});await call('odwyn_room_next',{agentId:'engineer',reason:'Confirm final contract'});await finish();
    await call('odwyn_room_done',{proposalId,summary:'Confirmed contract'});await finish();
    expect(room.discussion.status).toBe('awaiting_owner');expect(store.state.files).toHaveLength(0);
    expect(()=>runtime.decideRoom(room.id,{proposalId:'stale',decision:'approve'})).toThrow('changed');
    const validate=store.connectors.assertNoSecret;store.connectors.assertNoSecret=()=>{throw new Error('Publication failure fixture');};
    expect(()=>runtime.decideRoom(room.id,{proposalId,decision:'approve'})).toThrow('Publication failure');
    expect(room.discussion.status).toBe('awaiting_owner');expect(room.discussion.outcome.ownerDecision).toBeUndefined();expect(room.messages.some(message=>message.roomReport)).toBe(false);
    store.connectors.assertNoSecret=validate;
    const result=runtime.decideRoom(room.id,{proposalId,decision:'approve'});
    expect(room.discussion.status).toBe('completed');expect(result.files).toHaveLength(1);
    expect(readFileSync(join(directory,'files',result.files[0].id),'utf8')).toContain('v2 with errors');
    expect(runtime.publishRoom(room.id).files.map(file=>file.id)).toEqual(result.files.map(file=>file.id));
    store.save();const reload=openStore(directory);try{const saved=reload.state.conversations.find(c=>c.id===room.id);expect(saved.artifacts[0].versions).toHaveLength(2);expect(saved.discussion.outcome.ownerDecision.decision).toBe('approve');}finally{reload.close();}
  }finally{await runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}
});


test('configured room saved files remain drafts and reviewers receive only submitted file versions',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-draft-files-')),store=openStore(directory),primary=store.state.agents[0].id,provider=new Agent();store.state.agents.push({id:'peer'});
  const room=createRoom(store.state,{title:'File review',spaceId:store.security.legacySpaceId,memberIds:[primary,'peer'],governance:{facilitatorId:primary,reviewerIds:['peer']}}),runtime=new Runtime({store,codex:provider,browser:{},workspace:directory});runtime.addProvider('peer',new Agent());
  try{
    writeFileSync(join(directory,'draft.txt'),'Unpublished reviewed content');
    const p=store.security,resource=p.createResource({spaceId:p.legacySpaceId,type:'file',name:'Draft',metadata:{path:'draft.txt'}});
    for(const agentId of [primary,'peer'])p.putAccess(agentId,{revision:p.revision,spaceIds:[p.legacySpaceId],grants:[{spaceId:p.legacySpaceId,resourceId:resource.id,action:'file.download',mode:'auto'}]});
    await runtime.refreshAccount();await runtime.refreshAccount('peer');runtime.submitRoom(room.id,{prompt:'Review a generated file'});await runtime.drain();
    const send=async(tool,args)=>{const job=runtime.active,actor=runtime.providers.get(job.agentId);await runtime.handleRequest({id:randomUUID(),method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool,arguments:args}});const reply=actor.replies.at(-1);expect(reply.success).toBe(true);return JSON.parse(reply.contentItems[0].text);};
    const saved=await send('odwyn_send_file',{path:'draft.txt',resourceId:resource.id});expect(saved.status).toBe('draft');expect(saved.url).toBeUndefined();expect(runtime.active.files).toEqual([]);
    await send('odwyn_artifact_write',{title:'Draft file',fileId:saved.fileId});await send('odwyn_room_next',{agentId:'peer',reason:'Review file bytes'});runtime.finish(runtime.active,'completed');await runtime.drain();
    expect(runtime.active.agentId).toBe('peer');expect(store.data.file(runtime.active,saved.fileId).name).toBe('draft.txt');expect(room.discussion.publishedFileIds).toBeUndefined();
  }finally{await runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}
});
