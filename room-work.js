import {isDeepStrictEqual} from 'node:util';
import {canonical} from './security/approvals.js';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {findRoom,createRoom} from './store.js';
import {nextRoomStage,attachRoomStage,completeRoomStage} from './room-stages.js';
import {textInput} from './security.js';
import {saveFileBytes} from './files.js';
import {roomCompletion,artifactApproved,artifactSnapshot} from './public/room-policy.js';

const strict=(input,keys)=>{if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(key=>!keys.includes(key)))throw new Error('Invalid room work fields.');};
const roomEvidence=(room,ids)=>(room.evidence||[]).filter(item=>ids.includes(item.id)).map(({id,source,checkpointId,caseId,caseRevision,status,command,scenario,output,stdout,stderr,exitCode,createdAt})=>({id,source,checkpointId,caseId,caseRevision,status,command,scenario,output,stdout,stderr,exitCode,createdAt}));
const active=runtime=>runtime.activeJobs?.()||[runtime.active].filter(Boolean);
function workingRoom(runtime,job){
  runtime.store.security.context(job);const room=findRoom(runtime.state,job.conversationId);
  if(!room.governance||room.discussion?.status!=='active'||room.discussion.id!==job.roomRoundId)throw new Error('This requires an active configured room.');
  runtime.store.data.roomCheck(job);return room;
}
export function invalidateRoomResult(room,reason){
  if(room.discussion?.outcome){(room.discussion.previousOutcomes ||= []).push(room.discussion.outcome);delete room.discussion.outcome;}
  if(room.discussion)room.discussion.updateReason=reason;
}

export function writeArtifact(runtime,job,input){
  strict(input,['artifactId','outputId','title','versionId','text','fileId','evidenceIds']);
  const room=workingRoom(runtime,job);
  if(room.governance.observerIds.includes(job.agentId))throw new Error('Observers cannot author deliverables.');
  const artifacts=room.artifacts ||= [],existing=input.artifactId&&artifacts.find(item=>item.id===input.artifactId);
  if(input.artifactId&&!existing)throw new Error('Deliverable not found.');
  const output=room.governance.outputs?.find(item=>item.id===(existing?.outputId||input.outputId));
  if(input.outputId&&!output)throw new Error('Required output not found.');
  if((existing?.agentId||output?.agentId||job.agentId)!==job.agentId)throw new Error('Only the responsible agent can revise this deliverable.');
  const current=existing?.versions.at(-1);
  if(current && input.versionId!==current.id)throw new Error('Deliverable version changed. Read the current version.');
  if(!existing&&output&&artifacts.some(item=>item.outputId===output.id))throw new Error('Required output already exists. Revise its current version.');
  if((input.text!==undefined)===(input.fileId!==undefined))throw new Error('Provide either text or an existing saved file.');
  const content={};
  if(input.text!==undefined){content.text=textInput(input.text,20000);runtime.store.connectors.assertNoSecret(Buffer.from(content.text));}
  else{
    const file=runtime.store.data.file(job,input.fileId);content.fileId=file.id;
    if(file.jobId)runtime.store.data.assertHandoff(job,[file.jobId]);
    if(file.resourceId)runtime.store.data.note(job,file.resourceId,'file.download');
  }
  if(input.evidenceIds!==undefined){
    if(!Array.isArray(input.evidenceIds)||input.evidenceIds.length>100||new Set(input.evidenceIds).size!==input.evidenceIds.length||input.evidenceIds.some(id=>!room.evidence?.some(item=>item.id===id)))throw new Error('Choose recorded room evidence.');
    content.evidenceIds=[...input.evidenceIds];
    runtime.store.data.assertHandoff(job,room.evidence.filter(item=>content.evidenceIds.includes(item.id)).flatMap(item=>[item.taskId,...(item.sourceTaskIds||[])].filter(Boolean)));
  }
  const artifact=existing||{id:randomUUID(),...(output?{outputId:output.id}:{}),title:output?.title||textInput(input.title,120),agentId:job.agentId,kind:output?.kind||'document',versions:[]};
  if(!existing&&artifacts.length>=20)throw new Error('A room supports up to 20 deliverables.');
  if(current&&JSON.stringify([current.text,current.fileId,current.evidenceIds])===JSON.stringify([content.text,content.fileId,content.evidenceIds]))throw new Error('Revision must change the deliverable content or evidence.');
  const version={id:randomUUID(),taskId:job.id,...content,reviews:{},createdAt:new Date().toISOString()};
  artifact.versions.push(version);if(!existing)artifacts.push(artifact);
  invalidateRoomResult(room,'Deliverable revised. Review the current versions and propose a new result.');
  runtime.event(job,'Draft deliverable saved',artifact.title);
  return {artifactId:artifact.id,title:artifact.title,versionId:version.id,status:'draft',reviewerIds:room.governance.reviewerIds};
}

export function reviewArtifact(runtime,job,input){
  strict(input,['artifactId','versionId','decision','summary']);const room=workingRoom(runtime,job);
  if(!room.governance.reviewerIds.includes(job.agentId))throw new Error('Only designated reviewers can review deliverables.');
  if(!['approve','changes_requested'].includes(input.decision))throw new Error('Choose a review decision.');
  const artifact=room.artifacts?.find(item=>item.id===input.artifactId),version=artifact?.versions.at(-1);
  if(!version||version.id!==input.versionId)throw new Error('Deliverable version changed. Review the current version.');
  runtime.store.data.artifact(job,room.id,artifact.id,version.id);
  if(version.reviews[job.agentId]?.decision==='changes_requested'&&input.decision==='approve')throw new Error('Revise the deliverable before approving requested changes.');
  const review={agentId:job.agentId,taskId:job.id,decision:input.decision,summary:textInput(runtime.store.connectors.redact(input.summary),2000),at:new Date().toISOString()};
  version.reviews[job.agentId]=review;(version.reviewEvents ||= []).push(review);
  invalidateRoomResult(room,'Deliverable review changed. Propose a result after the reviews pass.');
  runtime.event(job,input.decision==='approve'?'Deliverable approved':'Deliverable changes requested',review.summary);
  return {artifactId:artifact.id,versionId:version.id,approved:artifactApproved(room,artifact),review};
}

export function roomWorkContext(runtime,job){
  const room=runtime.conversation(job);if(room.kind!=='room')return null;
  const artifacts=(room.artifacts||[]).map(artifact=>runtime.store.data.artifact(job,room.id,artifact.id,artifact.versions.at(-1).id));
  const handoff=room.handoff?runtime.store.data.readExport(job,room.handoff.exportId).roomHandoff:null;
  const records=[...(room.evidence||[]),...(room.checkpoints||[]),...(room.cases||[])];
  for(const record of records){
    const tasks=[record.taskId,...(record.sourceTaskIds||[])].filter(Boolean);
    runtime.store.data.assertHandoff(job,tasks);
    for(const id of tasks){const source=runtime.state.jobs.find(item=>item.id===id);if(!source)throw new Error('Room evidence source unavailable.');runtime.store.data.roomCheck(source);}
    if(record.exportId)runtime.store.data.readExport(job,record.exportId);
  }
  return {requiredOutputs:room.governance?.outputs||[],ownerApproval:!!room.governance?.ownerApproval,artifacts,handoff,evidence:room.evidence||[],checkpoints:room.checkpoints||[],cases:room.cases||[]};
}

export function finalizeRoom(runtime,room,job){
  const gate=roomCompletion(room);if(!gate.ready)throw new Error('Room review gates have not passed.');
  if(active(runtime).some(item=>item.conversationId===room.id&&item.id!==job.id))throw new Error('Wait for every executing room participant to finish.');
  const outcome=runtime.store.data.proposal(job,room.discussion.outcome);if(!outcome)throw new Error('Room proposal disclosure denied.');
  for(const reference of outcome.artifacts||[])runtime.store.data.artifact(job,room.id,reference.id,reference.versionId);
  room.discussion.status='completed';
  if(!room.messages.some(message=>message.roomReport&&message.proposalId===outcome.id))room.messages.push({id:randomUUID(),role:'assistant',agentId:room.governance?.facilitatorId||room.discussion.memberIds[0],jobId:job.id,at:new Date().toISOString(),roomReport:true,proposalId:outcome.id,text:`Discussion result:\n${outcome.result}\n\nNext plan:\n${outcome.nextPlan}`});
  if(!room.governance?.ownerApproval)completeRoomStage(runtime,room);
  runtime.changed();return outcome;
}

export function publishRoom(runtime,id){
  const room=findRoom(runtime.state,id);
  if(room.discussion?.status!=='completed'||!roomCompletion(room).ready)throw new Error('Complete all room review gates before publishing.');
  const files=[],created=[];
  try{
    for(const artifact of room.artifacts||[]){
      if(!artifactApproved(room,artifact))throw new Error('Deliverable review pending.');
      const version=artifact.versions.at(-1),job=runtime.state.jobs.find(item=>item.id===version.taskId);
      runtime.store.data.artifact(job,room.id,artifact.id,version.id);
      let file=runtime.state.files.find(item=>item.id===version.publishedFileId);
      if(!file){
        const source=version.fileId&&runtime.state.files.find(item=>item.id===version.fileId);
        if(version.fileId&&!source)throw new Error('Deliverable file unavailable.');
        const bytes=source?readFileSync(join(runtime.store.directory,'files',source.id)):Buffer.from(version.text);
        const name=source?.name||artifact.title.replace(/[^\p{L}\p{N}_. -]/gu,'_').slice(0,100)+'.md';
        file=saveFileBytes(bytes,name,join(runtime.store.directory,'files'),job.id,value=>runtime.store.connectors.assertNoSecret(value));
        file.spaceId=room.spaceId;file.roomArtifact={roomId:room.id,artifactId:artifact.id,versionId:version.id};
        runtime.state.files.push(file);created.push(file);version.publishedFileId=file.id;
      }
      files.push(file);
    }
    room.discussion.publishedFileIds=files.map(file=>file.id);runtime.changed();return {files};
  }catch(error){for(const file of created){runtime.state.files=runtime.state.files.filter(item=>item.id!==file.id);rmSync(join(runtime.store.directory,'files',file.id),{force:true});for(const artifact of room.artifacts||[])for(const version of artifact.versions)if(version.publishedFileId===file.id)delete version.publishedFileId;}throw error;}
}

export function decideRoom(runtime,id,input){
  strict(input,['proposalId','decision','summary']);const room=findRoom(runtime.state,id),outcome=room.discussion?.outcome;
  if(!outcome||input.proposalId!==outcome.id)throw new Error('Room proposal changed. Review the current version.');
  if(!room.governance?.ownerApproval||room.discussion.status!=='awaiting_owner'||!roomCompletion(room).agentReady)throw new Error('Room is not awaiting owner approval.');
  if(!['approve','changes_requested'].includes(input.decision))throw new Error('Choose an owner decision.');
  const job=runtime.state.jobs.find(item=>item.id===Object.values(outcome.confirmationTasks||{}).at(-1));
  if(!job||!runtime.store.data.proposal(job,outcome))throw new Error('Room source access changed.');
  outcome.ownerDecision={proposalId:outcome.id,decision:input.decision,summary:input.summary?textInput(input.summary,4000):'',at:new Date().toISOString()};
  if(input.decision==='changes_requested'){room.discussion.status='changes_requested';runtime.changed();return {status:'changes_requested',files:[]};}
  const oldReports=new Set(room.messages.filter(message=>message.roomReport).map(message=>message.id));
  try{finalizeRoom(runtime,room,job);const published=publishRoom(runtime,id);completeRoomStage(runtime,room);runtime.changed();return {...published,status:'completed'};}
  catch(error){delete outcome.ownerDecision;room.discussion.status='awaiting_owner';room.messages=room.messages.filter(message=>!message.roomReport||oldReports.has(message.id));runtime.changed();throw error;}
}

export async function handoffRoom(runtime,id,input){
  strict(input,['room','artifactIds','openQuestions','checkpointId','workspaceResourceId']);
  const source=findRoom(runtime.state,id),outcome=source.discussion?.outcome;
  if(source.discussion?.status!=='completed'||!roomCompletion(source).ready||active(runtime).some(job=>job.conversationId===id))throw new Error('Complete the source room before passing it on.');
  if(!input.room||!Array.isArray(input.artifactIds)||input.artifactIds.length>20||new Set(input.artifactIds).size!==input.artifactIds.length)throw new Error('Select the approved deliverables to pass.');
  const selected=input.artifactIds.map(artifactId=>source.artifacts?.find(item=>item.id===artifactId));
  if(selected.some(artifact=>!artifact||!artifactApproved(source,artifact)))throw new Error('Only current approved deliverables can be passed.');
  const signature=createHash('sha256').update(canonical([outcome.id,input])).digest('hex');
  const previous=source.handoffs?.find(item=>item.signature===signature);
  if(previous)return findRoom(runtime.state,previous.roomId);
  const job=runtime.state.jobs.find(item=>item.id===Object.values(outcome.confirmationTasks||{}).at(-1));
  if(!job||!runtime.store.data.proposal(job,outcome))throw new Error('Source access changed.');
  const stage=nextRoomStage(runtime,source);
  if(source.roomWorkflowRunId){
    const run=runtime.state.workflowRuns.find(item=>item.id===source.roomWorkflowRunId);
    if(!stage||run.status!=='awaiting_handoff'||run.conversationId!==source.id||run.currentStep!==source.roomWorkflowStepId)throw new Error('Room workflow is not awaiting this handoff.');
    if(!isDeepStrictEqual(input.room,stage.room))throw new Error('Use the configured next room stage. Edit the workflow before starting a new run to change its configuration.');
  }
  const prepared=[],created=[];const handoffCount=source.handoffs?.length||0,run=runtime.state.workflowRuns.find(item=>item.id===source.roomWorkflowRunId),runBefore=run&&structuredClone(run);let destination,exportId,total=0,promotedResource; 
  try{
    for(const artifact of selected){
      const version=artifact.versions.at(-1);runtime.store.data.artifact(job,source.id,artifact.id,version.id);
      const item={id:artifact.id,title:artifact.title,versionId:version.id,kind:artifact.kind,reviews:Object.values(version.reviews||{}).map(({agentId,decision,summary,at})=>({agentId,decision,summary,at})),...(version.evidenceIds?.length?{evidence:roomEvidence(source,version.evidenceIds)}:{})};
      if(version.text!==undefined)item.text=version.text;
      else{
        const file=runtime.state.files.find(saved=>saved.id===version.fileId);if(!file)throw new Error('Source deliverable file unavailable.');
        const bytes=readFileSync(join(runtime.store.directory,'files',file.id));total+=bytes.length;if(total>20*1024*1024)throw new Error('Handoff files exceed 20 MB.');
        const copy=saveFileBytes(bytes,file.name,join(runtime.store.directory,'files'),null,value=>runtime.store.connectors.assertNoSecret(value));created.push(copy);item.file={id:copy.id,name:copy.name,size:copy.size};
      }
      prepared.push(item);
    }
    destination=createRoom(runtime.state,input.room);
    const exported=runtime.store.data.exportRoom(source.id,destination.spaceId,destination.id,prepared,input.openQuestions?textInput(input.openQuestions,4000):'');exportId=exported.id;
    for(const file of created){file.spaceId=destination.spaceId;file.exportId=exportId;runtime.state.files.push(file);}
    destination.handoff={sourceRoomId:source.id,sourceProposalId:outcome.id,exportId};
    if(input.checkpointId){
      const checkpoint=source.checkpoints?.find(item=>item.id===input.checkpointId);
      const target=runtime.store.security.resource(input.workspaceResourceId);
      if(!checkpoint||target.type!=='workspace'||target.spaceId!==destination.spaceId)throw new Error('Choose a recorded checkpoint and destination workspace resource.');
      if(runtime.state.executionHeads?.[target.id])throw new Error('Destination workspace already has a checkpoint. Choose an empty workspace to avoid overwriting progress.');
      const copied=runtime.sandbox.copyCheckpoint(checkpoint.id,{sourceSpaceId:source.spaceId,sourceResourceId:checkpoint.resourceId,destinationSpaceId:destination.spaceId,destinationResourceId:target.id});
      const record={id:copied.id,spaceId:copied.spaceId,resourceId:copied.resourceId,parentId:null,createdAt:copied.createdAt,label:'Handoff checkpoint',exportId};
      destination.checkpoints=[record];runtime.state.executionHeads ||= {};runtime.state.executionHeads[target.id]=record.id;promotedResource=target.id;
    }
    if(stage)attachRoomStage(runtime,source,destination);
    (source.handoffs ||= []).push({signature,proposalId:outcome.id,roomId:destination.id,exportId});runtime.changed();return destination;
  }catch(error){
    if(promotedResource)delete runtime.state.executionHeads[promotedResource];
    if(source.handoffs)source.handoffs.length=handoffCount;
    if(runBefore)Object.assign(run,runBefore);
    if(destination)runtime.state.conversations=runtime.state.conversations.filter(room=>room.id!==destination.id);
    if(exportId)runtime.store.data.revokeExport(exportId);
    for(const file of created){runtime.state.files=runtime.state.files.filter(item=>item.id!==file.id);rmSync(join(runtime.store.directory,'files',file.id),{force:true});}
    throw error;
  }
}

export {artifactSnapshot};

export function recordOwnerEvidence(runtime,id,input){
  strict(input,['checkpointId','caseId','caseRevision','status','scenario','summary']);
  const room=findRoom(runtime.state,id),item=room.cases?.find(candidate=>candidate.id===input.caseId);
  if(!room.governance||!['active','stopped','changes_requested'].includes(room.discussion?.status))throw new Error('Record UAT evidence in an unfinished configured room.');
  if(!room.targetCheckpointId||input.checkpointId!==room.targetCheckpointId||!item||input.caseRevision!==item.revision)throw new Error('Checkpoint or test case changed. Review the current scenario.');
  if(!['passed','failed'].includes(input.status))throw new Error('Choose passed or failed.');
  const summary=textInput(input.summary,4000);runtime.store.connectors.assertNoSecret(Buffer.from(summary));
  const sourceTaskIds=[...new Set([item.taskId,...(item.sourceTaskIds||[])].filter(Boolean))];
  const evidence={id:randomUUID(),source:'owner',checkpointId:input.checkpointId,caseId:item.id,caseRevision:item.revision,status:input.status,scenario:textInput(input.scenario||item.title,2000),output:summary,sourceTaskIds,createdAt:new Date().toISOString()};
  (room.evidence ||= []).push(evidence);Object.assign(item,{status:input.status,checkpointId:input.checkpointId,evidenceId:evidence.id});
  invalidateRoomResult(room,'Owner supplied UAT evidence changed. Review the current evidence.');runtime.changed();return evidence;
}

export function selectRoomCheckpoint(runtime,id,input){
  strict(input,['resourceId','checkpointId','expectedHeadId']);const room=findRoom(runtime.state,id);
  const resource=runtime.store.security.resource(input.resourceId),head=runtime.state.executionHeads?.[input.resourceId]||null;
  if(resource.spaceId!==room.spaceId||resource.type!=='workspace'||input.expectedHeadId!==head)throw new Error('Workspace head changed. Review it before resolving the conflict.');
  if(active(runtime).some(job=>job.conversationId===id||job.workspacePin?.resourceId===resource.id))throw new Error('Stop workspace tasks before selecting a checkpoint.');
  const record=[...(room.checkpoints||[]),...(runtime.state.checkpoints||[])].find(item=>item.id===input.checkpointId&&item.resourceId===resource.id&&item.spaceId===room.spaceId);
  if(!record)throw new Error('Choose a recorded checkpoint for this workspace.');
  runtime.state.executionHeads ||= {};runtime.state.executionHeads[resource.id]=record.id;record.adoptedByOwnerAt=new Date().toISOString();
  room.targetCheckpointId=record.id;for(const item of room.cases||[]){item.status='pending';delete item.evidenceId;delete item.checkpointId;}
  invalidateRoomResult(room,'Owner selected a checkpoint. Retest and review before completion.');if(room.discussion?.status==='completed')room.discussion.status='stopped';
  runtime.changed();return {checkpointId:record.id};
}
