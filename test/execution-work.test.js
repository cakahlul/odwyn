import {test,expect} from 'bun:test';
import {ensureTaskWorkspace,saveTaskCheckpoint,runRecordedTest,defineRoomCase} from '../execution/work.js';
const id=n=>String(n).padStart(64,'0');
function fixture(){
  const job={id:'task',agentId:'engineer',spaceId:'space',conversationId:'room',roomRoundId:'round',status:'running'},room={id:'room',kind:'room',spaceId:'space',memberIds:['engineer','qa','observer'],governance:{observerIds:['observer']},discussion:{id:'round',status:'active'}},calls=[];
  const state={conversations:[room],jobs:[job],executionHeads:{},checkpoints:[]},workers=new Map();
  const runtime={state,active:job,executions:new Set(),store:{security:{context:task=>({spaceId:task.spaceId,agentId:task.agentId}),authorize(){calls.push('authorize');}},data:{roomCheck(){},assertHandoff(task,ids){calls.push(['handoff',...ids]);},readExport(task,exportId){calls.push(['export',exportId]);return {};},note(){}},connectors:{redact:value=>String(value).replaceAll('SECRET','[redacted]'),assertNoSecret(){}}},changed(){calls.push('changed');},event(){},conversation(){return room;},sandbox:{workers,async stop(taskId){workers.delete(taskId);calls.push(['stop',taskId]);},async worker(task,resourceId){if(workers.has(task.id))return workers.get(task.id);const worker={resourceId,checkpointId:null};workers.set(task.id,worker);return worker;},async restore(task,resourceId,checkpointId){const worker={resourceId,checkpointId};workers.set(task.id,worker);calls.push(['restore',checkpointId]);return worker;},async checkpoint(task,resourceId,{expectedParent}){return {id:id(2),spaceId:task.spaceId,resourceId,parentId:expectedParent,files:[{path:'private',data:'SECRET'}],createdAt:'now'};},async run(){return {stdout:'ok SECRET',stderr:'',exitCode:0};}}};
  function checkpoint(checkpointId=id(1)){const record={id:checkpointId,resourceId:'resource',spaceId:'space',taskId:'prior'};state.checkpoints.push(record);state.executionHeads.resource=checkpointId;return record;}
  return {runtime,state,job,room,calls,checkpoint};
}

test('workspace pins restored provenance and cannot switch resources or checkpoints',async()=>{
  const f=fixture();f.checkpoint();
  await ensureTaskWorkspace(f.runtime,f.job,'resource');
  expect(f.job.workspacePin).toEqual({resourceId:'resource',headId:id(1)});expect(f.calls).toContainEqual(['handoff','prior']);
  await expect(ensureTaskWorkspace(f.runtime,f.job,'other')).rejects.toThrow();
  await expect(ensureTaskWorkspace(f.runtime,f.job,'resource',id(3))).rejects.toThrow();
  await ensureTaskWorkspace(f.runtime,f.job,'resource',id(1));
  expect(f.calls.filter(call=>Array.isArray(call)&&call[0]==='restore')).toHaveLength(1);
});

test('successful checkpoint advances head and pin while retaining only metadata',async()=>{
  const f=fixture();f.checkpoint();await ensureTaskWorkspace(f.runtime,f.job,'resource');f.job.workspaceDirty=true;
  f.room.cases=[{id:'case',status:'passed',checkpointId:id(1),evidenceId:'old'}];
  const saved=await saveTaskCheckpoint(f.runtime,f.job,{resourceId:'resource',label:'Fix'});
  expect(saved.files).toBeUndefined();expect(JSON.stringify(f.room.checkpoints)).not.toContain('SECRET');
  expect(f.state.executionHeads.resource).toBe(id(2));expect(f.job.workspacePin.headId).toBe(id(2));expect(f.runtime.sandbox.workers.get(f.job.id).checkpointId).toBe(id(2));expect(f.job.workspaceDirty).toBe(false);
  expect(f.room.targetCheckpointId).toBe(id(2));expect(f.room.cases[0].status).toBe('pending');
});

test('concurrent checkpoint conflict preserves losing immutable work without overwriting head',async()=>{
  const f=fixture();f.checkpoint();await ensureTaskWorkspace(f.runtime,f.job,'resource');
  f.runtime.sandbox.checkpoint=async()=>{f.state.executionHeads.resource=id(3);return {id:id(2),resourceId:'resource',spaceId:'space',files:[]};};
  await expect(saveTaskCheckpoint(f.runtime,f.job,{resourceId:'resource'})).rejects.toThrow(id(2));
  expect(f.state.executionHeads.resource).toBe(id(3));expect(f.room.checkpoints[0].conflict).toBe(true);expect(f.job.workspacePin.headId).toBe(id(1));
});

test('transferred checkpoint provenance uses revocable export and rejects missing records',async()=>{
  const f=fixture(),record=f.checkpoint();record.exportId='export';delete record.taskId;
  await ensureTaskWorkspace(f.runtime,f.job,'resource');expect(f.calls).toContainEqual(['export','export']);
  const g=fixture();g.state.executionHeads.resource=id(1);await expect(ensureTaskWorkspace(g.runtime,g.job,'resource')).rejects.toThrow('provenance');
});

test('test evidence requires a clean pin and actual success; output stays bounded and redacted',async()=>{
  const f=fixture();f.checkpoint();await ensureTaskWorkspace(f.runtime,f.job,'resource');
  const defined=defineRoomCase(f.runtime,f.job,{title:'Scenario',blocking:true});
  f.job.workspaceDirty=true;await expect(runRecordedTest(f.runtime,f.job,{resourceId:'resource',checkpointId:id(1),command:'true',reason:'verify',caseId:defined.id})).rejects.toThrow('checkpoint');f.job.workspaceDirty=false;
  const evidence=await runRecordedTest(f.runtime,f.job,{resourceId:'resource',checkpointId:id(1),command:'true',reason:'verify',caseId:defined.id});
  expect(evidence.status).toBe('passed');expect(evidence.stdout).toBe('ok [redacted]');expect(evidence.checkpointId).toBe(id(1));expect(f.room.cases[0].status).toBe('passed');expect(f.runtime.executions.size).toBe(0);
  f.runtime.sandbox.run=async()=>({exitCode:1,stdout:'x'.repeat(40000),stderr:'bad'});
  const failed=await runRecordedTest(f.runtime,f.job,{resourceId:'resource',checkpointId:id(1),command:'false',reason:'verify',caseId:defined.id});
  expect(failed.status).toBe('failed');expect(Buffer.byteLength(failed.stdout+failed.stderr)).toBeLessThanOrEqual(32768);expect(f.room.cases[0].status).toBe('failed');
});

test('blocking defects pause dependent tests while unrelated tests continue; fixed still needs retest',async()=>{
  const f=fixture();f.checkpoint();const blocker=defineRoomCase(f.runtime,f.job,{title:'Blocker',blocking:true,defect:'broken'}),dependent=defineRoomCase(f.runtime,f.job,{title:'Dependent',dependsOn:[blocker.id]});
  await expect(runRecordedTest(f.runtime,f.job,{resourceId:'resource',checkpointId:id(1),command:'true',reason:'verify',caseId:dependent.id})).rejects.toThrow('block');
  const unrelated=await runRecordedTest(f.runtime,f.job,{resourceId:'resource',checkpointId:id(1),command:'true',reason:'verify'});expect(unrelated.status).toBe('passed');
  defineRoomCase(f.runtime,f.job,{id:blocker.id,status:'fixed'});expect(f.room.cases[0].status).toBe('pending');
  await runRecordedTest(f.runtime,f.job,{resourceId:'resource',checkpointId:id(1),command:'true',reason:'verify',caseId:blocker.id});
  expect((await runRecordedTest(f.runtime,f.job,{resourceId:'resource',checkpointId:id(1),command:'true',reason:'verify',caseId:dependent.id})).status).toBe('passed');
  expect(()=>defineRoomCase(f.runtime,f.job,{id:blocker.id,status:'passed'})).toThrow();
});

test('cancelled test cannot pass even if executor returns exit zero',async()=>{
  const f=fixture();f.checkpoint();f.runtime.sandbox.run=async()=>{for(const run of f.runtime.executions)run.controller.abort();return {exitCode:0,stdout:'',stderr:''};};
  const evidence=await runRecordedTest(f.runtime,f.job,{resourceId:'resource',checkpointId:id(1),command:'true',reason:'verify'});
  expect(evidence.status).toBe('cancelled');expect(f.runtime.executions.size).toBe(0);
});

test('case definitions reject observers, unknown fields, missing dependencies and cycles',()=>{
  const f=fixture(),a=defineRoomCase(f.runtime,f.job,{title:'a'}),b=defineRoomCase(f.runtime,f.job,{title:'b',dependsOn:[a.id]});
  expect(()=>defineRoomCase(f.runtime,f.job,{id:a.id,dependsOn:[b.id]})).toThrow();expect(()=>defineRoomCase(f.runtime,f.job,{title:'c',dependsOn:['missing']})).toThrow();
  expect(()=>defineRoomCase(f.runtime,f.job,{title:'c',passed:true})).toThrow();expect(()=>defineRoomCase(f.runtime,{...f.job,agentId:'observer'},{title:'c'})).toThrow();
});

test('head conflicts already present before export retain immutable work and dirty pin',async()=>{
  const f=fixture();f.checkpoint();await ensureTaskWorkspace(f.runtime,f.job,'resource');f.job.workspaceDirty=true;f.state.executionHeads.resource=id(3);
  await expect(saveTaskCheckpoint(f.runtime,f.job,{resourceId:'resource'})).rejects.toThrow(id(2));
  expect(f.state.executionHeads.resource).toBe(id(3));expect(f.job.workspaceDirty).toBe(true);expect(f.room.checkpoints[0].conflict).toBe(true);
});

test('stale test evidence does not pass a revised case or a newer checkpoint',async()=>{
  const f=fixture();f.checkpoint();const item=defineRoomCase(f.runtime,f.job,{title:'Original'});
  f.runtime.sandbox.run=async()=>{defineRoomCase(f.runtime,{...f.job,id:'editor',agentId:'qa'},{id:item.id,title:'Revised'});f.room.targetCheckpointId=id(2);return {exitCode:0,stdout:'ok',stderr:''};};
  const evidence=await runRecordedTest(f.runtime,f.job,{resourceId:'resource',checkpointId:id(1),command:'true',reason:'verify',caseId:item.id});
  expect(evidence.stale).toBe(true);expect(f.room.cases[0].status).toBe('pending');expect(f.room.cases[0].sourceTaskIds).toEqual(['task','editor']);
});

test('evidence counts only actual successful exits and safely bounds multibyte output',async()=>{
  const f=fixture();f.checkpoint();
  for(const result of [{exitCode:0,timedOut:true},{exitCode:0,truncated:true},{exitCode:null},{exitCode:2}]){
    f.runtime.sandbox.run=async()=>({...result,stdout:'🚀'.repeat(10000),stderr:'秘密'});
    const evidence=await runRecordedTest(f.runtime,f.job,{resourceId:'resource',checkpointId:id(1),command:'true',reason:'verify'});
    expect(evidence.status).toBe('failed');expect(Buffer.byteLength(evidence.stdout+evidence.stderr)).toBeLessThanOrEqual(32768);
  }
  f.runtime.sandbox.run=async()=>{throw Error('executor failed SECRET');};
  const evidence=await runRecordedTest(f.runtime,f.job,{resourceId:'resource',checkpointId:id(1),command:'true',reason:'verify'});
  expect(evidence.status).toBe('failed');expect(evidence.stderr).toBe('executor failed [redacted]');
});


test('cancelled or superseded checkpoint saves cannot promote a head after export',async()=>{
  for(const change of [f=>f.job.status='interrupted',f=>f.room.discussion.status='paused',f=>f.room.discussion.id='new-round']){
    const f=fixture();f.checkpoint();await ensureTaskWorkspace(f.runtime,f.job,'resource');
    f.runtime.sandbox.checkpoint=async()=>{change(f);return {id:id(2),resourceId:'resource',spaceId:'space',files:[]};};
    await expect(saveTaskCheckpoint(f.runtime,f.job,{resourceId:'resource'})).rejects.toThrow();
    expect(f.state.executionHeads.resource).toBe(id(1));expect(f.room.checkpoints).toBeUndefined();
  }
});

test('ended tasks and superseded rounds cannot acquire passing evidence',async()=>{
  const f=fixture();f.checkpoint();f.job.status='interrupted';
  await expect(ensureTaskWorkspace(f.runtime,f.job,'resource')).rejects.toThrow('ended');
  f.job.status='running';f.runtime.sandbox.run=async()=>{f.room.discussion.id='new-round';return {exitCode:0};};
  const evidence=await runRecordedTest(f.runtime,f.job,{resourceId:'resource',checkpointId:id(1),command:'true',reason:'verify'});
  expect(evidence.status).toBe('cancelled');
});


test('each test restores its immutable input and discards its worker afterwards',async()=>{
  const f=fixture();f.checkpoint();await ensureTaskWorkspace(f.runtime,f.job,'resource');
  f.runtime.sandbox.workers.get(f.job.id).mutated=true;
  f.runtime.sandbox.run=async()=>{const worker=f.runtime.sandbox.workers.get(f.job.id);expect(worker.mutated).toBeUndefined();worker.mutated=true;return {exitCode:0};};
  for(let n=0;n<2;n++){await runRecordedTest(f.runtime,f.job,{resourceId:'resource',checkpointId:id(1),command:'true',reason:'verify'});expect(f.runtime.sandbox.workers.size).toBe(0);}
});

test('cancellation during workspace restoration aborts before execution or checkpoint export',async()=>{
  for(const operation of ['save','test']){
    const f=fixture();f.checkpoint();let executed=false;
    f.runtime.sandbox.restore=async()=>{for(const run of f.runtime.executions)run.controller.abort();return {};};
    f.runtime.sandbox.run=f.runtime.sandbox.checkpoint=async()=>{executed=true;return {id:id(2),exitCode:0};};
    if(operation==='save')await expect(saveTaskCheckpoint(f.runtime,f.job,{resourceId:'resource'})).rejects.toThrow();
    else expect((await runRecordedTest(f.runtime,f.job,{resourceId:'resource',checkpointId:id(1),command:'true',reason:'verify'})).status).toBe('cancelled');
    expect(executed).toBe(false);expect(f.state.executionHeads.resource).toBe(id(1));expect(f.runtime.executions.size).toBe(0);
  }
});
