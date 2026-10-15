import {randomUUID} from 'node:crypto';
import {textInput} from '../security.js';
import {validateCommand} from '../terminal.js';
import {invalidateRoomResult} from '../room-work.js';

const strict=(input,keys)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key)))throw new Error('Invalid execution work fields.');};
const roomFor=(runtime,job)=>runtime.state.conversations.find(room=>room.id===job.conversationId&&room.kind==='room');
const head=(runtime,resourceId)=>Object.hasOwn(runtime.state.executionHeads||{},resourceId)?runtime.state.executionHeads[resourceId]:null;
const activeTask=job=>{if(!['running','waiting'].includes(job.status))throw new Error('Execution task has ended or is stopping.');};
const checkpointId=id=>{if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw new Error('Choose a recorded checkpoint.');return id;};
function workingRoom(runtime,job){
  const context=runtime.store.security.context(job),room=roomFor(runtime,job);
  if(!room?.governance||room.spaceId!==context.spaceId||!room.memberIds.includes(context.agentId)||room.discussion?.status!=='active'||room.discussion.id!==job.roomRoundId)throw new Error('An active configured room is required.');
  if((room.governance.observerIds||[]).includes(context.agentId))throw new Error('Observers cannot change execution work.');
  runtime.store.data.roomCheck(job);return room;
}
function provenance(runtime,job,resourceId,id){
  const record=[...(runtime.state.checkpoints||[]),...runtime.state.conversations.flatMap(room=>room.checkpoints||[])].find(item=>item.id===id&&item.resourceId===resourceId&&item.spaceId===job.spaceId);
  if(!record)throw new Error('Checkpoint provenance unavailable.');
  if(record.exportId)runtime.store.data.readExport(job,record.exportId);
  else if(record.taskId)runtime.store.data.assertHandoff(job,[record.taskId]);
  else throw new Error('Checkpoint provenance unavailable.');
  return record;
}
function adopt(room,id){
  if(!room||room.targetCheckpointId===id)return;
  room.targetCheckpointId=id;
  for(const item of room.cases||[]){if(item.status==='passed')item.status='pending';delete item.checkpointId;delete item.evidenceId;}
  invalidateRoomResult(room,'Execution checkpoint changed. Retest the current version.');
}
export async function ensureTaskWorkspace(runtime,job,resourceId,selectedId,signal){
  signal?.throwIfAborted();activeTask(job);textInput(resourceId,200);runtime.store.security.authorize(job,'sandbox.exec',resourceId);
  runtime.store.data.roomCheck(job,[{resourceId,action:'sandbox.exec'}]);
  const pin=job.workspacePin;
  if(pin&&(pin.resourceId!==resourceId||selectedId!==undefined&&selectedId!==pin.headId))throw new Error('Task workspace cannot switch resources or checkpoints.');
  const id=pin?pin.headId:(selectedId===undefined?head(runtime,resourceId):checkpointId(selectedId));
  if(id){checkpointId(id);provenance(runtime,job,resourceId,id);}
  const existing=runtime.sandbox.workers.get(job.id);
  if(existing&&(existing.resourceId!==resourceId||(existing.checkpointId||null)!==(id||null)))throw new Error('Existing task workspace does not match the pinned checkpoint.');
  const worker=existing?await runtime.sandbox.worker(job,resourceId,signal):id?await runtime.sandbox.restore(job,resourceId,id,signal):await runtime.sandbox.worker(job,resourceId,signal);
  signal?.throwIfAborted();activeTask(job);runtime.store.security.authorize(job,'sandbox.exec',resourceId);runtime.store.data.roomCheck(job);
  const room=roomFor(runtime,job);if(room?.governance)workingRoom(runtime,job);
  job.workspacePin={resourceId,headId:id||null};
  runtime.store.data.note(job,resourceId,'sandbox.exec');
  if(id&&(!room?.targetCheckpointId||head(runtime,resourceId)===id))adopt(room,id);
  runtime.changed();return worker;
}
export async function saveTaskCheckpoint(runtime,job,input){
  strict(input,['resourceId','label']);const resourceId=textInput(input.resourceId,200),label=input.label===undefined?'Checkpoint':textInput(runtime.store.connectors.redact(input.label),120);
  const room=roomFor(runtime,job);if(room)workingRoom(runtime,job);
  const controller=new AbortController(),run={job,controller};runtime.executions.add(run);
  let saved,pin,before;
  try{await ensureTaskWorkspace(runtime,job,resourceId,undefined,controller.signal);pin=job.workspacePin;before=head(runtime,resourceId);saved=await runtime.sandbox.checkpoint(job,resourceId,{expectedParent:pin.headId,signal:controller.signal});}
  finally{runtime.executions.delete(run);}
  if(controller.signal.aborted)throw new Error('Checkpoint save cancelled.');
  activeTask(job);if(room)workingRoom(runtime,job);
  runtime.store.security.authorize(job,'sandbox.exec',resourceId);runtime.store.data.roomCheck(job);
  const conflict=before!==pin.headId||head(runtime,resourceId)!==pin.headId;
  const record={id:saved.id,spaceId:job.spaceId,resourceId,parentId:pin.headId,taskId:job.id,agentId:job.agentId,label,createdAt:saved.createdAt,...(conflict?{conflict:true}:{})};
  (runtime.state.checkpoints ||= []).push(record);if(room)(room.checkpoints ||= []).push(record);
  if(conflict){runtime.changed();throw new Error(`Checkpoint conflict. Saved work as ${record.id}; choose and resolve the current head explicitly.`);}
  runtime.state.executionHeads ||= {};runtime.state.executionHeads[resourceId]=record.id;
  pin.headId=record.id;runtime.sandbox.workers.get(job.id).checkpointId=record.id;job.workspaceDirty=false;
  adopt(room,record.id);runtime.changed();return record;
}
export function defineRoomCase(runtime,job,input){
  strict(input,['id','title','dependsOn','blocking','defect','status']);const room=workingRoom(runtime,job),cases=room.cases ||= [];
  const existing=input.id===undefined?null:cases.find(item=>item.id===input.id);
  if(input.id!==undefined&&!existing)throw new Error('Test case not found.');
  if(!existing&&cases.length>=100)throw new Error('A room supports at most 100 test cases.');
  if(input.status!==undefined&&!['pending','open','fixed','blocked'].includes(input.status))throw new Error('Only recorded tests can mark cases passed or failed.');
  if(input.blocking!==undefined&&typeof input.blocking!=='boolean')throw new Error('Choose a blocking mode.');
  const dependsOn=input.dependsOn===undefined?[...(existing?.dependsOn||[])]:input.dependsOn;
  if(!Array.isArray(dependsOn)||dependsOn.length>100||new Set(dependsOn).size!==dependsOn.length||dependsOn.some(id=>typeof id!=='string'||id===existing?.id||!cases.some(item=>item.id===id)))throw new Error('Choose existing test case dependencies.');
  const reaches=(id,seen=new Set())=>{if(id===existing?.id)return true;if(seen.has(id))return false;seen.add(id);return (cases.find(item=>item.id===id)?.dependsOn||[]).some(next=>reaches(next,seen));};
  if(dependsOn.some(id=>reaches(id)))throw new Error('Test case dependency cycle.');
  const sourceIds=[existing,...cases.filter(item=>dependsOn.includes(item.id))].filter(Boolean).flatMap(item=>item.sourceTaskIds||[item.taskId]);if(sourceIds.length)runtime.store.data.assertHandoff(job,sourceIds);
  const item={...(existing||{}),id:existing?.id||randomUUID(),title:input.title===undefined?existing?.title:textInput(input.title,200),dependsOn:[...dependsOn],blocking:input.blocking??existing?.blocking??false,defect:input.defect===undefined?existing?.defect||'':textInput(input.defect,2000),status:input.status==='blocked'?'blocked':'pending',revision:(existing?.revision||0)+1,sourceTaskIds:[...new Set([...(existing?.sourceTaskIds||[existing?.taskId].filter(Boolean)),job.id])],taskId:job.id,agentId:job.agentId,updatedAt:new Date().toISOString()};
  if(!item.title)throw new Error('Test case title required.');
  delete item.checkpointId;delete item.evidenceId;
  if(existing)Object.assign(existing,item);else cases.push(item);
  if(existing){delete existing.checkpointId;delete existing.evidenceId;}
  invalidateRoomResult(room,'Test cases changed. Execute the current cases before review.');runtime.changed();return item;
}
export async function runRecordedTest(runtime,job,input){
  strict(input,['resourceId','checkpointId','command','reason','scenario','caseId','timeoutMs']);const room=workingRoom(runtime,job);
  const resourceId=textInput(input.resourceId,200),id=checkpointId(input.checkpointId),command=validateCommand(input),scenario=input.scenario===undefined?'':textInput(input.scenario,2000);
  const item=input.caseId===undefined?null:room.cases?.find(item=>item.id===input.caseId);
  if(input.caseId!==undefined&&!item)throw new Error('Test case not found.');
  if(job.workspaceDirty)throw new Error('Save a checkpoint before testing modified work.');
  if(item){
    runtime.store.data.assertHandoff(job,item.sourceTaskIds||[item.taskId]);
    const dependencies=new Set(),visit=key=>{if(dependencies.has(key))return;dependencies.add(key);for(const next of room.cases.find(candidate=>candidate.id===key)?.dependsOn||[])visit(next);};for(const key of item.dependsOn)visit(key);
    const pending=[...dependencies].map(key=>room.cases.find(candidate=>candidate.id===key)).filter(dependency=>!dependency||dependency.blocking&&(dependency.status!=='passed'||dependency.checkpointId!==id));
    if(pending.length)throw new Error('Test blocked by a dependency awaiting a passing retest.');
  }
  const revision=item?.revision,controller=new AbortController(),run={job,controller},startedAt=new Date().toISOString();runtime.executions.add(run);
  let result,error;
  try{
    // Every test starts at the immutable checkpoint; prior test commands cannot alter its input.
    await runtime.sandbox.stop(job.id);
    await ensureTaskWorkspace(runtime,job,resourceId,id,controller.signal);
    result=await runtime.sandbox.run(job,{resourceId,...command},controller.signal);
  }
  catch(failure){error=failure;result={exitCode:null,stdout:'',stderr:failure.message||'Execution failed.'};}
  finally{await runtime.sandbox.stop(job.id);runtime.executions.delete(run);}
  const cancelled=controller.signal.aborted||result.cancelled||!['running','waiting'].includes(job.status)||room.discussion?.status!=='active'||room.discussion.id!==job.roomRoundId,passed=!error&&!cancelled&&!result.timedOut&&!result.truncated&&result.exitCode===0;
  runtime.store.security.authorize(job,'sandbox.exec',resourceId);runtime.store.data.roomCheck(job);
  const bounded=(value,limit)=>new TextDecoder().decode(Buffer.from(runtime.store.connectors.redact(value||'')).subarray(0,limit),{stream:true});
  const stdout=bounded(result.stdout,32768),stderr=bounded(result.stderr,32768-Buffer.byteLength(stdout));
  const stale=room.targetCheckpointId!==id||item&&item.revision!==revision;
  const evidence={id:randomUUID(),checkpointId:id,resourceId,taskId:job.id,agentId:job.agentId,command:runtime.store.connectors.redact(command.command),scenario:runtime.store.connectors.redact(scenario),...(item?{caseId:item.id,caseRevision:revision}:{}),status:cancelled?'cancelled':passed?'passed':'failed',exitCode:result.exitCode,stdout,stderr,timedOut:!!result.timedOut,truncated:!!result.truncated,startedAt,createdAt:new Date().toISOString(),...(stale?{stale:true}:{})};
  (room.evidence ||= []).push(evidence);
  if(item&&!stale){item.status=passed?'passed':'failed';item.checkpointId=id;item.evidenceId=evidence.id;}
  invalidateRoomResult(room,'Test evidence changed. Review the current execution results.');runtime.changed();return evidence;
}
