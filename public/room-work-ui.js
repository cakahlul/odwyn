import {$,esc,api,workspaceUrl,handleError} from './ui.js';
import {artifactApproved,roomCompletion} from './room-policy.js';

export function renderRoomWork(state,room){
  if(room.kind!=='room')return '';
  const name=id=>state.agents.find(agent=>agent.id===id)?.customization?.name||'Agent',gate=roomCompletion(room);
  const artifacts=(room.artifacts||[]).map(artifact=>{
    const version=artifact.versions.at(-1),approved=artifactApproved(room,artifact);
    return `<article class="room-deliverable"><h3>${esc(artifact.title)}</h3><p>${esc(name(artifact.agentId))} · Version ${artifact.versions.length} · ${approved?(room.governance?.reviewerIds.length?'Reviewed':'No designated reviewers'):'Draft · Review pending'}</p>${artifact.versions.map((item,index)=>`<details ${item.id===version.id?'open':''}><summary>Version ${index+1}${item.id===version.id?' · Current':''}</summary>${item.text!==undefined?`<pre>${esc(item.text)}</pre>`:`<p>Saved file: ${esc(state.files.find(file=>file.id===item.fileId)?.name||'Unavailable')}</p>`}${Object.entries(item.reviews||{}).map(([id,review])=>`<p><strong>${esc(name(id))}</strong> · ${review.decision==='approve'?'Approved':'Changes requested'}<br>${esc(review.summary)}</p>`).join('')}</details>`).join('')}</article>`;
  }).join('');
  const missing=gate.pendingOutputIds.map(id=>room.governance.outputs.find(output=>output.id===id)).filter(Boolean);
  const files=(room.discussion?.publishedFileIds||[]).map(id=>state.files.find(file=>file.id===id)).filter(Boolean);
  const owner=room.discussion?.status==='awaiting_owner'?`<form class="room-owner-review" data-room-owner="${esc(room.id)}" data-proposal="${esc(room.discussion.outcome.id)}"><h3>Ready for your approval</h3><p>Review this result and its current deliverables before the next stage.</p><label>Feedback<textarea name="summary" rows="3" maxlength="4000"></textarea></label><div class="room-work-actions"><button class="primary-button" name="decision" value="approve">Approve and publish files</button><button class="secondary-button" name="decision" value="changes_requested">Request changes</button></div><p class="field-hint" role="status"></p></form>`:'';
  const start=room.stagePrompt&&!room.discussion?`<button type="button" class="primary-button" data-room-start="${esc(room.id)}">Start stage</button><p>${esc(room.stagePrompt)}</p>`:'';
  const checkpoints=(room.checkpoints||[]).map(item=>`<li>${esc(item.label||item.id.slice(0,12))}${item.conflict?' · Conflicting branch':''} · ${esc(item.id.slice(0,12))}${item.conflict?` <button type="button" class="text-button" data-room-checkpoint="${esc(item.id)}">Use this checkpoint</button>`:''}</li>`).join('');
  const manual=room.targetCheckpointId&&(room.cases||[]).length&&!['completed','awaiting_owner'].includes(room.discussion?.status)?`<details><summary>Record manual UAT evidence</summary><form data-room-uat="${esc(room.id)}" data-checkpoint="${esc(room.targetCheckpointId)}" data-cases="${esc(JSON.stringify(room.cases.map(item=>[item.id,item.revision])))}"><label>Scenario<select name="caseId">${room.cases.map(item=>`<option value="${esc(item.id)}" data-revision="${item.revision}">${esc(item.title)}</option>`).join('')}</select></label><label>Result<select name="status"><option value="passed">Passed</option><option value="failed">Failed</option></select></label><label>Evidence<textarea name="summary" required maxlength="4000"></textarea></label><button class="secondary-button">Record owner evidence</button><p role="status"></p></form></details>`:'';
  const cases=(room.cases||[]).map(item=>`<li><strong>${esc(item.title)}</strong> · ${esc(item.status)}${item.blocking?' · Blocking':''}${item.defect?`<p>${esc(item.defect)}</p>`:''}</li>`).join('');
  const evidence=(room.evidence||[]).slice(-30).map(item=>`<details><summary>${esc(item.scenario||item.command||'Check')} · ${esc(item.status)}${item.stale?' · Previous version':''}</summary><p>${esc(item.source==='owner'?'Owner supplied evidence':'Executed in isolated worker')} · ${esc(item.checkpointId?.slice(0,12)||'No checkpoint')}</p>${item.command?`<pre>${esc(item.command)}</pre>`:''}<pre>${esc(item.output||[item.stdout,item.stderr].filter(Boolean).join('\n'))}</pre></details>`).join('');
  const links=[room.handoff?`<button type="button" class="text-button" data-conversation="${esc(room.handoff.sourceRoomId)}">Open previous room</button>`:'',...(room.handoffs||[]).map(item=>`<button type="button" class="text-button" data-conversation="${esc(item.roomId)}">Open next room</button>`)].join('');
  if(!start&&!checkpoints&&!artifacts&&!missing.length&&!owner&&!links&&!cases&&!evidence)return '';
  return `<section class="room-work" aria-label="Room deliverables and checks">${start}${links?`<div class="room-work-actions">${links}</div>`:''}${missing.length?`<p>Required outputs pending: ${esc(missing.map(item=>`${item.title} (${name(item.agentId)})`).join(', '))}.</p>`:''}${artifacts?`<h2>Deliverables</h2>${artifacts}`:''}${owner}${room.discussion?.status==='changes_requested'?`<p role="status">Owner requested changes: ${esc(room.discussion.outcome?.ownerDecision?.summary||'Send direction to continue the review.')}</p>`:''}${files.length?`<section aria-label="Published files"><h3>Published files</h3>${files.map(file=>`<a class="room-file" href="${esc(workspaceUrl('/api/files/'+file.id))}" download>${esc(file.name)}</a>`).join('')}</section>`:artifacts&&room.discussion?.status==='completed'&&gate.ready?`<button type="button" class="secondary-button" data-room-publish="${esc(room.id)}">Publish approved files</button>`:''}${checkpoints?`<h3>Checkpoints</h3><ul>${checkpoints}</ul>`:''}${manual}${cases?`<h3>Checks and defects</h3><ul>${cases}</ul>`:''}${evidence?`<h3>Recorded evidence</h3>${evidence}`:''}</section>`;
}

export function setupRoomWork(getState,getRoom,refresh,onOpen){
  let source=null,stage=null;
  document.body.insertAdjacentHTML('beforeend',`<dialog id="room-handoff-dialog" class="modal" aria-labelledby="room-handoff-title"><div class="modal-top"><h2 id="room-handoff-title">Pass to next room</h2><button type="button" class="icon-button" id="room-handoff-close" aria-label="Close room handoff">×</button></div><form id="room-handoff-form"><label>Next room name<input name="title" required maxlength="70"></label><label>Space<select name="spaceId" id="room-handoff-space"></select></label><fieldset><legend>Participants</legend><div id="room-handoff-members"></div></fieldset><fieldset><legend>Approved deliverables to pass</legend><div id="room-handoff-artifacts"></div></fieldset><label>Open questions<textarea name="openQuestions" maxlength="4000" rows="3"></textarea></label><label>Checkpoint (optional)<select id="room-handoff-checkpoint" name="checkpointId"></select></label><label>Destination workspace for checkpoint<select id="room-handoff-workspace" name="workspaceResourceId"></select></label><p class="field-hint">The next room receives only this selected package. Agent resource permissions stay unchanged.</p><p id="room-handoff-error" role="status"></p><button class="primary-button">Create next room</button></form></dialog>`);
  $('#room-handoff-close').onclick=()=>$('#room-handoff-dialog').close();
  const fillMembers=()=>{
    const state=getState(),spaceId=$('#room-handoff-space').value;
    const members=state.agents.filter(agent=>spaceId===state.security.legacySpaceId||state.security.memberships[agent.id]?.includes(spaceId));
    $('#room-handoff-members').innerHTML=members.map(agent=>`<label class="room-work-choice"><input type="checkbox" name="memberIds" value="${esc(agent.id)}" ${(stage?.room.memberIds||source.memberIds).includes(agent.id)?'checked':''}>${esc(agent.customization?.name||'Agent')}</label>`).join('')||'<p>No agents belong to this Space.</p>';
    $('#room-handoff-workspace').innerHTML='<option value="">Choose a workspace</option>'+(state.resources||[]).filter(item=>item.type==='workspace'&&item.spaceId===spaceId).map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
  };
  $('#room-handoff-space').onchange=fillMembers;
  $('#room-handoff-form').onsubmit=async event=>{
    event.preventDefault();const form=event.target,button=form.querySelector('button[type=submit],button.primary-button');button.disabled=true;
    try{
      const data=new FormData(form),memberIds=data.getAll('memberIds');
      const sourceRoles=source.governance,governance=sourceRoles?{facilitatorId:memberIds.includes(sourceRoles.facilitatorId)?sourceRoles.facilitatorId:null,reviewerIds:sourceRoles.reviewerIds.filter(id=>memberIds.includes(id)),observerIds:sourceRoles.observerIds.filter(id=>memberIds.includes(id))}:undefined;
      const room=stage?structuredClone(stage.room):{title:data.get('title'),spaceId:data.get('spaceId'),memberIds,...(governance?{governance}:{})};
      const result=await api(`/api/rooms/${source.id}/handoff`,{room,artifactIds:data.getAll('artifactIds'),openQuestions:data.get('openQuestions'),...(data.get('checkpointId')?{checkpointId:data.get('checkpointId'),workspaceResourceId:data.get('workspaceResourceId')}:{})});
      $('#room-handoff-dialog').close();await refresh();onOpen(result.id);
    }catch(error){$('#room-handoff-error').textContent=error.message;}finally{button.disabled=false;}
  };
  document.addEventListener('submit',async event=>{
    const uat=event.target.closest('[data-room-uat]');if(uat){event.preventDefault();const data=new FormData(uat),option=uat.querySelector('select[name=caseId]').selectedOptions[0];try{await api(`/api/rooms/${uat.dataset.roomUat}/evidence`,{checkpointId:uat.dataset.checkpoint,caseId:data.get('caseId'),caseRevision:Number(option.dataset.revision),status:data.get('status'),summary:data.get('summary')});await refresh();}catch(error){uat.querySelector('[role=status]').textContent=error.message;}return;}
    const form=event.target.closest('[data-room-owner]');if(!form)return;event.preventDefault();const buttons=[...form.querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);
    try{await api(`/api/rooms/${form.dataset.roomOwner}/decision`,{proposalId:form.dataset.proposal,decision:event.submitter?.value||'approve',summary:new FormData(form).get('summary')});await refresh();}catch(error){form.querySelector('[role=status]').textContent=error.message;buttons.forEach(button=>button.disabled=false);}
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.id==='room-pass-next'){
      source=getRoom();if(!source||source.discussion?.status!=='completed')return;const state=getState();
      const run=state.workflowRuns.find(item=>item.id===source.roomWorkflowRunId),current=run?.workflow.steps.find(item=>item.id===source.roomWorkflowStepId);stage=current?.next?run.workflow.steps.find(item=>item.id===current.next):null;
      $('#room-handoff-form').reset();$('#room-handoff-error').textContent='';
      $('#room-handoff-space').innerHTML=state.security.spaces.map(space=>`<option value="${esc(space.id)}">${esc(space.name)}</option>`).join('');$('#room-handoff-space').value=stage?.room.spaceId||source.spaceId;
      const title=$('#room-handoff-form input[name=title]');title.value=stage?.room.title||'';title.readOnly=!!stage;$('#room-handoff-space').disabled=!!stage;
      $('#room-handoff-artifacts').innerHTML=(source.artifacts||[]).filter(artifact=>artifactApproved(source,artifact)).map(artifact=>`<label class="room-work-choice"><input type="checkbox" name="artifactIds" value="${esc(artifact.id)}" checked>${esc(artifact.title)} · Version ${artifact.versions.length}</label>`).join('')||'<p>Shared result and next plan only.</p>';
      $('#room-handoff-checkpoint').innerHTML='<option value="">No checkpoint</option>'+(source.checkpoints||[]).filter(item=>!item.conflict).map(item=>`<option value="${esc(item.id)}">${esc(item.label||item.id.slice(0,12))}</option>`).join('');
      try{const resources=await api('/api/resources',undefined,'GET');state.resources=resources;fillMembers();for(const input of $('#room-handoff-members').querySelectorAll('input'))input.disabled=!!stage;$('#room-handoff-dialog').showModal();$('#room-handoff-form input[name=title]').focus();}catch(error){handleError(error);}
    }
    if(button.dataset.roomStart){button.disabled=true;try{await api(`/api/rooms/${button.dataset.roomStart}/start`,{});await refresh();}catch(error){handleError(error);button.disabled=false;}}
    if(button.dataset.roomCheckpoint){button.disabled=true;try{const room=getRoom(),record=room.checkpoints.find(item=>item.id===button.dataset.roomCheckpoint);await api(`/api/rooms/${room.id}/checkpoint`,{resourceId:record.resourceId,checkpointId:record.id,expectedHeadId:getState().executionHeads?.[record.resourceId]||null});await refresh();}catch(error){handleError(error);button.disabled=false;}}
    if(button.dataset.roomPublish){button.disabled=true;try{await api(`/api/rooms/${button.dataset.roomPublish}/publish`,{});await refresh();}catch(error){handleError(error);button.disabled=false;}}
  });
}
