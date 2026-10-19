import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,updateRoom,createRoom,recoverJobs} from '../store.js';
import {Runtime} from '../runtime.js';
import {validateWorkflow} from '../workflows.js';
import {roomCompletion,checkSnapshot} from '../public/room-policy.js';
class Agent extends EventEmitter{child={};replies=[];calls=[];async request(method,params){this.calls.push({method,params});if(method==='account/read')return {account:{type:'chatgpt'}};if(method.startsWith('thread/'))return {thread:{id:params.threadId||randomUUID()}};return {turn:{id:randomUUID()}};}respond(id,reply){this.replies.push(reply);}reject(){}}

for(const autoAdvance of [false,true])for(const names of [['Grooming','Planning','Execution','Testing','Release'],['Research','Editorial review']])test(`room workflow runs ${names.join(' → ')} with ${autoAdvance?'automatic':'explicit owner'} handoffs`,async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-stages-')),store=openStore(directory),primary=store.state.agents[0].id;
  store.state.agents.push({id:'peer'});const runtime=new Runtime({store,codex:new Agent(),browser:{},workspace:directory});runtime.addProvider('peer',new Agent());
  const call=async(tool,args)=>{const job=runtime.active,p=runtime.providers.get(job.agentId);await runtime.handleRequest({id:randomUUID(),method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool,arguments:args}});const reply=p.replies.at(-1);if(!reply.success)throw Error(reply.contentItems[0].text);return JSON.parse(reply.contentItems[0].text);};
  try{
    await runtime.refreshAccount();await runtime.refreshAccount('peer');
    const definition={name:'Stage flow',command:'stages',inputs:[{name:'goal',required:true}],steps:names.map((name,i)=>({id:`stage-${i}`,name,type:'room',prompt:`${name}: {{inputs.goal}}`,room:{title:name,spaceId:store.security.legacySpaceId,memberIds:[primary,'peer'],governance:{facilitatorId:primary,reviewerIds:[primary],ownerApproval:name==='Planning',outputs:[{id:'package',title:`${name} package`,agentId:'peer'}]}}}))};
    definition.autoAdvance=autoAdvance;
    const workflow=validateWorkflow(definition,store.state);store.state.workflows.push(workflow);
    expect(()=>runtime.launchWorkflow(workflow,{inputs:{}})).toThrow('required');
    const count=store.state.conversations.length;expect(()=>runtime.launchWorkflow({...workflow,steps:workflow.steps.map(step=>({...step,prompt:'{{steps.unselected}}'}))},{inputs:{goal:'test'}})).toThrow('Unavailable');expect(store.state.conversations).toHaveLength(count);
    const first=runtime.launchWorkflow(workflow,{inputs:{goal:'Build a reviewed result'}});await runtime.drain();
    const run=store.state.workflowRuns[0];let room=runtime.conversation(first),previousArtifact;
    await runtime.cancelRoom(room.id);recoverJobs(store.state);expect(run.status).toBe('interrupted');const stopped=store.state.jobs.find(job=>job.conversationId===room.id&&job.agentId===primary&&['interrupted','cancelled'].includes(job.status));runtime.retry(stopped.id);await runtime.drain();expect(run.status).toBe('running');
    for(let i=0;i<names.length;i++){
      expect(room.title).toBe('Build a reviewed result · '+names[i]);expect(room.discussion.goal).toContain('Build a reviewed result');
      const provider=runtime.providers.get(runtime.active.agentId),instructions=provider.calls.findLast(call=>call.method.startsWith('thread/')).params.developerInstructions;
      expect(instructions).toContain('Scope-fit check before planning');
      expect(instructions).toContain('at most three practical steps');
      expect(instructions).toContain('until each is simple to execute');
      expect(instructions).toContain('never skip them because a task is small');
      if(i){
        const work=await call('odwyn_room_read',{}),incoming=work.handoff.artifacts[0];
        expect(incoming).toMatchObject({id:previousArtifact.id,versionId:previousArtifact.versions.at(-1).id,text:`Reviewed ${names[i-1]} package`});
        const input=provider.calls.findLast(call=>call.method==='turn/start').params.input[0].text;
        expect(input).toContain(incoming.id);expect(input).toContain(incoming.versionId);expect(input).toContain(incoming.text);
      }
      // First turn routes to author; author drafts, designated reviewer signs exact bytes.
      await call('odwyn_room_next',{agentId:'peer',reason:'Prepare the required package'});runtime.finish(runtime.active,'completed');await runtime.drain();
      await call('odwyn_artifact_write',{outputId:'package',text:`Reviewed ${names[i]} package`});
      await call('odwyn_room_next',{agentId:primary,reason:'Review exact package'});runtime.finish(runtime.active,'completed');await runtime.drain();
      const artifact=room.artifacts[0];await call('odwyn_artifact_review',{artifactId:artifact.id,versionId:artifact.versions[0].id,decision:'approve',summary:'Verified package'});
      await call('odwyn_room_done',{result:`${names[i]} ready`,nextPlan:'Continue after gates pass',summary:'Package verified'});
      const proposalId=room.discussion.outcome.id;await call('odwyn_room_review',{proposalId,decision:'approve',summary:'Reviewed current result'});
      await call('odwyn_room_next',{agentId:'peer',reason:'Confirm final package'});runtime.finish(runtime.active,'completed');await runtime.drain();
      await call('odwyn_room_done',{proposalId,summary:'Confirmed exact reviewed package'});runtime.finish(runtime.active,'completed');await runtime.drain();
      if(names[i]==='Planning'){expect(room.discussion.status).toBe('awaiting_owner');expect(run.status).toBe('waiting');runtime.decideRoom(room.id,{proposalId,decision:'approve'});}
      expect(room.discussion.status).toBe('completed');
      if(i+1<names.length){
        expect(run.status).toBe('awaiting_handoff');
        const input={room:run.workflow.steps[i+1].room,artifactIds:[artifact.id],openQuestions:''};
        if(autoAdvance){
          await runtime.advanceRoomWorkflows();await runtime.drain();previousArtifact=artifact;
          room=store.state.conversations.find(item=>item.id===run.conversationId);
          expect(room.discussion.status).toBe('active');continue;
        }
        const next=await runtime.handoffRoom(room.id,input);expect(next.discussion).toBeUndefined();expect(run.status).toBe('ready');
        previousArtifact=artifact;
        expect((await runtime.handoffRoom(room.id,input)).id).toBe(next.id);
        const job=runtime.startRoomStage(next.id,{});await runtime.drain();expect(job.conversationId).toBe(next.id);
        expect(()=>runtime.startRoomStage(next.id,{})).toThrow('already');room=next;
      }
    }
    expect(run.status).toBe('completed');expect(run.visits).toBe(names.length);expect(run.roomIds).toHaveLength(names.length);
    store.save();const reload=openStore(directory);try{expect(reload.state.workflowRuns[0].status).toBe('completed');expect(reload.state.conversations.find(item=>item.id===room.id).discussion.status).toBe('completed');}finally{reload.close();}
    expect(()=>validateWorkflow({...definition,id:workflow.id,steps:[...definition.steps,{id:'agent',type:'agent',prompt:'Mixed'}]},store.state)).toThrow('separate');
    expect(()=>updateRoom(store.state,room.id,{title:room.title,memberIds:room.memberIds,governance:{...room.governance,outputs:[{...room.governance.outputs[0],agentId:primary,kind:'evidence'}]}})).not.toThrow();
    expect(room.artifacts).toHaveLength(0);expect(room.archivedArtifacts).toHaveLength(1);expect(roomCompletion(room).pendingOutputIds).toEqual(['package']);
  }finally{await runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test('failed, unexecuted, stale and revised cases block reviewed completion; manual UAT stays owner-attributed',()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-cases-')),store=openStore(directory),runtime=new Runtime({store,codex:new Agent(),browser:{},workspace:directory});
  try{
    const primary=store.state.agents[0].id;store.state.agents.push({id:'peer'});
    const room={...createRoom(store.state,{title:'UAT',spaceId:store.security.legacySpaceId,memberIds:[primary,'peer'],governance:{facilitatorId:primary}}),targetCheckpointId:'a'.repeat(64),cases:[{id:'case',title:'UAT',revision:1,status:'failed'}],evidence:[],discussion:{id:randomUUID(),status:'active',outcome:{id:randomUUID(),confirmations:{[primary]:'yes',peer:'yes'},artifacts:[]}},messages:[]};store.state.conversations[0]=room;store.save();
    room.discussion.outcome.checks=checkSnapshot(room);expect(roomCompletion(room).pendingCaseIds).toEqual(['case']);expect(roomCompletion(room).ready).toBe(false);
    expect(()=>runtime.recordOwnerEvidence(room.id,{checkpointId:'stale',caseId:'case',caseRevision:1,status:'passed',summary:'UAT'})).toThrow('changed');
    const evidence=runtime.recordOwnerEvidence(room.id,{checkpointId:room.targetCheckpointId,caseId:'case',caseRevision:1,status:'passed',summary:'Owner checked the scenario'});
    expect(evidence.source).toBe('owner');expect(evidence.command).toBeUndefined();expect(room.discussion.outcome).toBeUndefined();expect(roomCompletion(room).pendingCaseIds).toEqual([]);
    room.targetCheckpointId='b'.repeat(64);expect(roomCompletion(room).pendingCaseIds).toEqual(['case']);room.targetCheckpointId=evidence.checkpointId;room.cases[0].revision++;expect(roomCompletion(room).pendingCaseIds).toEqual(['case']);
  }finally{runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test('Studio five-agent roles complete each stage with the configured participants and reviewers',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-studio-')),store=openStore(directory),lead=store.state.agents[0].id,ids=[lead,'backend','frontend','qa','release'];
  for(const id of ids.slice(1))store.state.agents.push({id});
  const runtime=new Runtime({store,codex:new Agent(),browser:{},workspace:directory});for(const id of ids.slice(1))runtime.addProvider(id,new Agent());
  const stages=[['Grooming',ids,[lead],['release'],['backend','frontend','qa']],['Planning',ids,[lead],[],['backend','frontend','qa']],['Execution',[lead,'backend','frontend'],[lead],[],['backend','frontend']],['Testing',[lead,'backend','frontend','qa'],[lead,'qa'],[],['qa']],['Release',[lead,'qa','release'],['release'],[],['qa','release']]];
  const call=async(tool,args)=>{const job=runtime.active,provider=runtime.providers.get(job.agentId);await runtime.handleRequest({id:randomUUID(),method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool,arguments:args}});const reply=provider.replies.at(-1);expect(reply.success).toBe(true);return JSON.parse(reply.contentItems[0].text);};
  try{
    for(const id of ids)await runtime.refreshAccount(id);
    const workflow=validateWorkflow({name:'Studio',command:'studio',steps:stages.map(([name,memberIds,reviewerIds,observerIds,authors],index)=>({id:`stage-${index}`,name,type:'room',prompt:`Complete ${name}, ask the owner when requirements are unclear.`,room:{title:name,spaceId:store.security.legacySpaceId,memberIds,governance:{facilitatorId:lead,reviewerIds,observerIds,ownerApproval:name==='Planning',outputs:authors.map(agentId=>({id:agentId,title:`${name} package from ${agentId}`,agentId}))}}}))},store.state);
    let room=runtime.conversation(runtime.launchWorkflow(workflow,{inputs:{}}));await runtime.drain();
    const run=store.state.workflowRuns[0];
    for(let index=0;index<stages.length;index++){
      let turns=0;
      while(room.discussion.status==='active'&&turns++<40){
        const actor=runtime.active.agentId,output=room.governance.outputs.find(item=>item.agentId===actor);
        if(output&&!room.artifacts?.some(item=>item.outputId===output.id))await call('odwyn_artifact_write',{outputId:output.id,text:`Reviewed ${room.title} output`});
        if(room.governance.reviewerIds.includes(actor))for(const artifact of room.artifacts||[])if(!artifact.versions.at(-1).reviews[actor])await call('odwyn_artifact_review',{artifactId:artifact.id,versionId:artifact.versions.at(-1).id,decision:'approve',summary:'Checked the exact output'});
        const outputsReady=room.governance.outputs.every(item=>room.artifacts?.some(artifact=>artifact.outputId===item.id&&room.governance.reviewerIds.every(id=>artifact.versions.at(-1).reviews[id]?.decision==='approve')));
        if(outputsReady&&!room.governance.observerIds.includes(actor)){
          const outcome=room.discussion.outcome;
          await call('odwyn_room_done',outcome?{proposalId:outcome.id,summary:'Confirmed reviewed package'}:{result:`${room.title} package complete`,nextPlan:'Continue through the configured gate',summary:'Verified current package'});
          if(room.governance.reviewerIds.includes(actor))await call('odwyn_room_review',{proposalId:room.discussion.outcome.id,decision:'approve',summary:'Approved exact room package'});
        }
        runtime.finish(runtime.active,'completed');await runtime.drain();
      }
      expect(turns).toBeLessThan(40);
      if(room.title==='Planning'){expect(room.discussion.status).toBe('awaiting_owner');runtime.decideRoom(room.id,{proposalId:room.discussion.outcome.id,decision:'approve'});}
      expect(room.discussion.status).toBe('completed');expect(roomCompletion(room).ready).toBe(true);
      if(index+1<stages.length){room=await runtime.handoffRoom(room.id,{room:run.workflow.steps[index+1].room,artifactIds:room.artifacts.map(item=>item.id)});runtime.startRoomStage(room.id,{});await runtime.drain();}
    }
    expect(run.status).toBe('completed');expect(run.visits).toBe(5);expect(room.governance.reviewerIds).toEqual(['release']);expect(room.memberIds).toEqual([lead,'qa','release']);expect(()=>updateRoom(store.state,room.id,{title:room.title,memberIds:[lead,'qa'],governance:{facilitatorId:lead}})).toThrow('Retain participants');
  }finally{await runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}
});

test('room stage loops stop at their execution limit and old loop rooms cannot advance the current room',async()=>{
  const {completeRoomStage,attachRoomStage}=await import('../room-stages.js');
  const first={id:'first',roomWorkflowRunId:'run',roomWorkflowStepId:'review',discussion:{outcome:{id:'proposal-1'}}},second={id:'second'},run={id:'run',conversationId:'first',currentStep:'review',visits:0,outputs:{},roomIds:['first'],inputs:{},workflow:{maxSteps:2,steps:[{id:'review',next:'review',prompt:'Review again'}]}};
  const runtime={state:{workflowRuns:[run]}};completeRoomStage(runtime,first);expect(run.status).toBe('awaiting_handoff');attachRoomStage(runtime,first,second);expect(run.conversationId).toBe('second');
  first.discussion.outcome.id='outdated-new-proposal';completeRoomStage(runtime,first);expect(run.visits).toBe(1);expect(()=>attachRoomStage(runtime,first,{id:'wrong'})).toThrow('not awaiting');
  second.discussion={outcome:{id:'proposal-2'}};completeRoomStage(runtime,second);expect(run.visits).toBe(2);expect(run.status).toBe('limit_reached');expect(()=>attachRoomStage(runtime,second,{id:'third'})).toThrow('not awaiting');
});
