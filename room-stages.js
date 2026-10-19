import {randomUUID} from 'node:crypto';
import {createRoom,findRoom} from './store.js';
import {interpolate,validateWorkflow} from './workflows.js';

export function syncRoomWorkflowStatus(runtime){
  for(const run of runtime.state.workflowRuns){
    const room=runtime.state.conversations.find(item=>item.id===run.conversationId&&item.roomWorkflowRunId===run.id);
    if(!room?.discussion)continue;
    const status=room.discussion.status;
    if(['paused','stopped','changes_requested'].includes(status)){
      run.status='interrupted';run.error=runtime.state.jobs.find(job=>job.conversationId===room.id&&job.error)?.error||'Discussion paused. Review progress before continuing.';
    }else if(status==='awaiting_owner')run.status='waiting';
    else if(status==='active'){
      const active=runtime.state.jobs.filter(job=>job.conversationId===room.id&&['queued','running','waiting','takeover','stopping'].includes(job.status));
      run.status=active.some(job=>job.status==='waiting')&&!active.some(job=>job.status==='running')?'waiting':'running';delete run.error;
    }
  }
}

export async function advanceRoomWorkflows(runtime){
  for(const run of runtime.state.workflowRuns){
    if(runtime.closed||!run.workflow.autoAdvance||run.autoAdvanceBlocked)continue;
    try{
      let room=runtime.state.conversations.find(item=>item.id===run.conversationId);
      if(run.status==='awaiting_handoff'){
        const next=nextRoomStage(runtime,room);if(!next)continue;
        const input={room:next.room,artifactIds:(room.artifacts||[]).map(item=>item.id),openQuestions:''};
        if(room.targetCheckpointId&&room.spaceId!==next.room.spaceId){
          const checkpoint=room.checkpoints?.find(item=>item.id===room.targetCheckpointId);
          if(!checkpoint||checkpoint.conflict&&!checkpoint.adoptedByOwnerAt)throw Error('Resolve the current checkpoint before passing this stage.');
          const policy=runtime.store.security,source=policy.resource(checkpoint.resourceId);
          const targets=next.workspaceResourceId?[policy.resource(next.workspaceResourceId)]:policy.listResources().filter(item=>item.type==='workspace'&&item.spaceId===next.room.spaceId).flatMap(item=>policy.isolatedWorkspaces.targets(item)).filter(item=>item.type==='workspace'&&(source.isolatedWorkspaceId?item.isolatedWorkspaceId===source.isolatedWorkspaceId:source.metadata.repositoryId&&item.metadata.repositoryId===source.metadata.repositoryId));
          if(targets.length!==1)throw Error('Choose the destination workspace using Pass to next room.');
          Object.assign(input,{checkpointId:checkpoint.id,workspaceResourceId:targets[0].id});
        }
        room=await runtime.handoffRoom(room.id,input);
      }
      if(run.status==='ready'&&!runtime.closed)runtime.startRoomStage(room.id,{});
    }catch(error){run.error=runtime.store.connectors.redact(error.message);run.autoAdvanceBlocked=true;runtime.changed();}
  }
}

export function nextRoomStage(runtime,room){
  const run=runtime.state.workflowRuns.find(item=>item.id===room.roomWorkflowRunId);
  if(!run)return null;
  const step=run.workflow.steps.find(item=>item.id===room.roomWorkflowStepId);
  return step?.next?run.workflow.steps.find(item=>item.id===step.next):null;
}
export function launchRoomWorkflow(runtime,workflow,input,inputs){
  workflow=validateWorkflow(workflow,runtime.state);
  if(workflow.inputs.some(field=>field.required&&(inputs[field.name]==null||inputs[field.name]==='')))throw new Error('Supply required room workflow inputs before starting.');
  const run={id:randomUUID(),workflow:structuredClone(workflow),skills:[],agentId:input.agentId||runtime.state.agents[0].id,inputs,outputs:{},outputTasks:{},roomIds:[],visits:0,scheduleId:input.scheduleId||null,interactionMode:input.interactionMode,status:'running',createdAt:new Date().toISOString()};
  const identifier=inputs[workflow.inputs[0]?.name];
  if(typeof identifier==='string'&&identifier.trim())for(const stage of run.workflow.steps)stage.room.title=(`${identifier.trim().replace(/\s+/g,' ').slice(0,40)} · ${stage.room.title}`).slice(0,70);
  const step=run.workflow.steps.find(item=>item.id===workflow.start);
  for(const id of input.attachments||[])runtime.store.data.assertFileSpace(id,step.room.spaceId);
  const prompt=stagePrompt(run,step);
  const room=createRoom(runtime.state,step.room);
  Object.assign(room,{roomWorkflowRunId:run.id,roomWorkflowStepId:step.id,stagePrompt:prompt});
  Object.assign(run,{conversationId:room.id,spaceId:room.spaceId,currentStep:step.id});run.roomIds.push(room.id);
  runtime.state.workflowRuns.unshift(run);
  try{return startRoomStage(runtime,room.id,{},input.attachments);}
  catch(error){runtime.state.workflowRuns=runtime.state.workflowRuns.filter(item=>item!==run);runtime.state.conversations=runtime.state.conversations.filter(item=>item!==room);throw error;}
}
function stagePrompt(run,step){return interpolate(step.prompt,{inputs:run.inputs,run:{id:run.id,visits:run.visits}});}
export function startRoomStage(runtime,id,input,attachments=[]){
  if(!input||Object.keys(input).length)throw new Error('Start uses the configured stage goal.');
  const room=findRoom(runtime.state,id),run=runtime.state.workflowRuns.find(item=>item.id===room.roomWorkflowRunId);
  if(!room.stagePrompt||room.discussion||run&&(run.conversationId!==room.id||run.currentStep!==room.roomWorkflowStepId||run.status==='completed'))throw new Error('This room stage has already started or is unavailable.');
  const jobs=runtime.submitRoom(id,{prompt:room.stagePrompt,attachments,scheduleId:run?.scheduleId,interactionMode:run?.interactionMode});
  if(run)run.status='running';runtime.changed();return jobs[0];
}
export function completeRoomStage(runtime,room){
  const run=runtime.state.workflowRuns.find(item=>item.id===room.roomWorkflowRunId);if(!run)return;
  if(run.conversationId!==room.id||run.currentStep!==room.roomWorkflowStepId)return;
  const previous=run.outputs[room.roomWorkflowStepId];if(previous?.proposalId===room.discussion.outcome.id)return;
  run.outputs[room.roomWorkflowStepId]={roomId:room.id,proposalId:room.discussion.outcome.id};run.visits++;
  const next=nextRoomStage(runtime,room);
  run.status=next?(run.visits>=run.workflow.maxSteps?'limit_reached':'awaiting_handoff'):'completed';
  if(!next)run.endedAt=new Date().toISOString();
}
export function attachRoomStage(runtime,source,destination){
  const run=runtime.state.workflowRuns.find(item=>item.id===source.roomWorkflowRunId);if(!run)return;
  if(run.conversationId!==source.id||run.currentStep!==source.roomWorkflowStepId||run.status!=='awaiting_handoff')throw new Error('This workflow is not awaiting its next room.');
  const next=nextRoomStage(runtime,source);if(!next)throw new Error('Room workflow has finished.');
  Object.assign(destination,{roomWorkflowRunId:run.id,roomWorkflowStepId:next.id,stagePrompt:stagePrompt(run,next)});
  run.roomIds.push(destination.id);run.currentStep=next.id;run.conversationId=destination.id;run.spaceId=destination.spaceId;run.status='ready';
  delete run.error;delete run.autoAdvanceBlocked;
}
