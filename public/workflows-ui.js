import { $, esc, icon, api, toast, handleError, date, badge, workspaceUrl } from './ui.js';
import { createWorkflowEditor } from './workflow-editor.js';

const blank=()=>({name:'',command:'',description:'',inputs:[],start:null,maxSteps:100,steps:[]});
const text=value=>typeof value==='string' ? value:JSON.stringify(value,null,2);

const listState = {};
export function libraryList(key, title, items, row, empty) {
  const controls = listState[key] ||= {query:'',page:1};
  const query = controls.query.trim().toLowerCase();
  const matches = items.filter(item=>[item.name,item.command,item.description,item.summary,item.status,item.createdAt,item.error].some(value=>String(value || '').toLowerCase().includes(query)));
  const pages = Math.max(1,Math.ceil(matches.length/10));
  controls.page = Math.min(controls.page,pages);
  return `<section class="library-section" aria-labelledby="${key}-title"><div class="library-heading"><h2 id="${key}-title">${title}</h2><span>${items.length} total</span></div><label class="library-search" for="${key}-search">Search ${title.toLowerCase()}<input type="search" id="${key}-search" data-library-search="${key}" value="${esc(controls.query)}" placeholder="${key==='knowledge'?'Search by name or summary':`Search by name, command${key.endsWith('Runs') ? ' or status' : ' or description'}`}"></label><div class="library-results">${matches.length ? matches.slice((controls.page-1)*10,controls.page*10).map(row).join('') : `<p class="workflow-empty">${query ? 'No matches. Try another search.' : empty}</p>`}</div><nav class="library-pagination" aria-label="${title} pages"><span role="status">${matches.length ? (controls.page-1)*10+1 : 0}–${Math.min(controls.page*10,matches.length)} of ${matches.length}</span><button class="secondary-button" data-library-page="${key}" data-page="${controls.page-1}" ${controls.page===1?'disabled':''}>Previous</button><span>Page ${controls.page} of ${pages}</span><button class="secondary-button" data-library-page="${key}" data-page="${controls.page+1}" ${controls.page===pages?'disabled':''}>Next</button></nav></section>`;
}

export function renderWorkflows(state, view='workflows') {
  const skills = view === 'skills';
  let history;
  if (skills) {
    const messages = new Map(state.conversations.flatMap(c=>c.messages.filter(m=>m.role==='user' && m.jobId).map(m=>[m.jobId,m.text])));
    history = state.jobs.filter(j=>!j.workflowRunId).flatMap(job=>{
      const command = messages.get(job.id)?.match(/^[/$]([a-z][a-z0-9_-]*)(?:\s|$)/)?.[1];
      const skill = job.skill || state.skills.find(s=>s.command===command);
      return skill ? [{...job,name:skill.name,command:skill.command}] : [];
    });
  } else history = state.workflowRuns.map(run=>({...run,name:run.workflow.name,command:run.workflow.command}));
  const catalog = skills
    ? libraryList('skills','Saved skills',state.skills,s=>`<article class="workflow-row"><div><h3>${esc(s.name)}</h3><code>/${esc(s.command)}</code><p>${esc(s.description)}</p></div><div class="workflow-actions"><button class="secondary-button" data-skill-edit="${esc(s.id)}">Edit</button><button class="icon-button" data-skill-delete="${esc(s.id)}" aria-label="Delete ${esc(s.name)}">${icon('trash')}</button></div></article>`,'No skills yet. Save instructions once, then reuse them in chat or workflows.')
    : libraryList('workflows','Saved workflows',state.workflows,w=>`<article class="workflow-row"><div><h3>${esc(w.name)}</h3><code>/${esc(w.command)}</code><p>${esc(w.description || `${w.steps.length} steps`)}</p></div><div class="workflow-actions"><button class="primary-button" data-workflow-run="${esc(w.id)}">Run</button><button class="secondary-button" data-workflow-edit="${esc(w.id)}">Edit</button><button class="secondary-button" data-workflow-export="${esc(w.id)}">Export</button><button class="icon-button" data-workflow-delete="${esc(w.id)}" aria-label="Delete ${esc(w.name)}">${icon('trash')}</button></div></article>`,'No workflows yet. Create a workflow or import a saved definition.');
  return `<section class="collection workflows library-page"><div class="collection-heading"><h1>${skills?'Skills':'Workflows'}</h1><p>${skills?'Reusable instructions for your agents. Call a skill from chat with /command or $command.':'Build reusable processes. Review saved workflows and follow each run.'}</p></div><div class="collection-toolbar">${skills?'<button class="primary-button" data-skill-new>New skill +</button><button class="secondary-button" data-skill-import>Import skill</button><button class="secondary-button" data-skill-import-folder>Import folder</button>':'<button class="primary-button" data-workflow-new>New workflow +</button><button class="secondary-button" data-workflow-import>Import workflow</button>'}</div>${catalog}${libraryList(skills?'skillRuns':'workflowRuns',skills?'Skill runs':'Workflow runs',history,r=>`<article class="workflow-row"><div><h3>${esc(r.name)}</h3><code>/${esc(r.command)}</code><p>${esc(date(r.createdAt))}${skills?'':` · ${r.visits} completed steps · ${esc(r.currentStep || '')}`}</p>${r.error?`<p class="run-error">${esc(r.error)}</p>`:''}</div><div class="workflow-actions">${badge(r.status)}${skills?'':`<button class="secondary-button" data-workflow-history="${esc(r.id)}">Details</button>`}<button class="secondary-button" data-conversation="${esc(r.conversationId)}">Open chat</button></div></article>`,skills?'Call a skill from chat to see its progress here.':'Run a workflow to see its saved outputs and progress.')}</section>`;
}

export function setupWorkflows(getState,getAgent,onRun,refresh,redraw) {
  document.body.insertAdjacentHTML('beforeend',`<dialog id="skill-editor" class="modal" aria-labelledby="skill-title"><div class="modal-top"><span class="eyebrow">SKILL</span><button type="button" class="icon-button" data-skill-close aria-label="Close skill editor">${icon('close')}</button></div><h2 id="skill-title">Reusable instructions</h2><form id="skill-form"><label>Name<input name="name" required maxlength="80" aria-describedby="skill-error"></label><label>Command<input name="command" required pattern="[a-z][a-z0-9_-]{0,59}" placeholder="review-code"></label><label>Description<input name="description" maxlength="500"></label><label>Instructions<textarea name="instructions" required rows="10" maxlength="20000"></textarea></label><details id="skill-resources" hidden><summary></summary><ul></ul></details><div class="form-footer"><small id="skill-error" role="status"></small><button class="primary-button">Save skill</button></div></form></dialog><dialog id="workflow-run-dialog" class="modal" aria-labelledby="workflow-run-title"><div class="modal-top"><span class="eyebrow">RUN WORKFLOW</span><button type="button" class="icon-button" data-run-close aria-label="Close run form">${icon('close')}</button></div><h2 id="workflow-run-title"></h2><form id="workflow-run-form"><div class="modal-fields"><div id="workflow-run-inputs"></div><div id="workflow-run-attachments" class="attachments" aria-live="polite"></div><button type="button" class="secondary-button" id="workflow-run-attach">${icon('paperclip')} Attach files</button><input type="file" id="workflow-run-files" multiple hidden><p class="field-hint">Attach files, paste images or drop files here. Up to 20 files, 20 MB each. Attachments go to the first task or room.</p></div><div class="form-footer"><small id="workflow-run-error" role="status"></small><button class="primary-button">Run workflow</button></div></form></dialog><dialog id="workflow-history" class="modal workflow-modal" aria-labelledby="workflow-history-title"><div class="modal-top"><span class="eyebrow">WORKFLOW RUN</span><button type="button" class="icon-button" data-history-close aria-label="Close run details">${icon('close')}</button></div><h2 id="workflow-history-title"></h2><div id="workflow-history-content"></div></dialog><input type="file" id="workflow-import-file" accept="application/json,.json" hidden><input type="file" id="skill-import-folder" webkitdirectory multiple hidden><input type="file" id="skill-import-file" accept="text/markdown,.md" hidden>`);
  let skillFiles=[],skillId=null,running=null,runFiles=[],uploading=false;
  document.addEventListener('input',event=>{
    const key=event.target.dataset.librarySearch;if(!key)return;
    listState[key]={query:event.target.value,page:1};redraw();
    document.querySelector(`[data-library-search="${key}"]`).focus({preventScroll:true});
  });
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-library-page]');if(!button)return;
    listState[button.dataset.libraryPage].page=Number(button.dataset.page);redraw();
    document.querySelector(`[data-library-search="${button.dataset.libraryPage}"]`).focus({preventScroll:true});
  });

  function openSkill(skill={},id=null){skillId=id;skillFiles=skill.files || [];$('#skill-resources').hidden=!skillFiles.length;$('#skill-resources summary').textContent=`${skillFiles.length} bundled files`;$('#skill-resources ul').innerHTML=skillFiles.map(file=>`<li>${esc(file.path)}</li>`).join('');for(const name of ['name','command','description','instructions'])$('#skill-form').elements[name].value=skill[name] || '';$('#skill-error').textContent='';$('#skill-editor').showModal();}
  function openRun(workflow){running=workflow;runFiles=[];$('#workflow-run-files').value='';$('#workflow-run-attachments').replaceChildren();$('#workflow-run-title').textContent=running.name;const rooms=running.steps.every(step=>step.type==='room');$('#workflow-run-inputs').innerHTML=running.inputs.map((f,index)=>`<label>${esc(f.label || f.name)}${rooms&&index>0?`<textarea name="${esc(f.name)}" rows="8" maxlength="20000" ${f.required?'required':''}>${esc(f.default??'')}</textarea>`:`<input name="${esc(f.name)}" value="${esc(f.default??'')}" ${f.required?'required':''}>`}</label>${rooms&&index===0?'<p class="field-hint">Used to name rooms: identifier · stage.</p>':''}`).join('') || '<p>This workflow has no required inputs.</p>';$('#workflow-run-error').textContent='';$('#workflow-run-dialog').showModal();}
  function drawRunFiles(){
    $('#workflow-run-attachments').innerHTML=runFiles.map(file=>`<div class="attachment-chip"><div class="attachment-preview">${file.mimeType?.startsWith('image/')?`<img src="${esc(workspaceUrl('/api/files/'+file.id+'/preview'))}" alt="Preview of ${esc(file.name)}">`:`<span class="attachment-file-icon">${icon('paperclip')}</span>`}<span class="attachment-info"><strong>${esc(file.name)}</strong><small>${Math.ceil(file.size/1024)} KB</small></span></div><button type="button" class="attachment-remove" data-run-remove="${esc(file.id)}" aria-label="Remove ${esc(file.name)}">${icon('close')}</button></div>`).join('');
  }
  async function attachRunFiles(files){
    if(uploading||$('#workflow-run-form button.primary-button').disabled||!files.length)return;
    try{
      if(runFiles.length+files.length>20)throw Error('Choose up to 20 uploaded files.');
      if(files.some(file=>!file.size||file.size>20*1024*1024))throw Error('Choose files up to 20 MB each.');
      uploading=true;$('#workflow-run-error').textContent='Uploading…';$('#workflow-run-attachments').setAttribute('aria-busy','true');$('#workflow-run-form button.primary-button').disabled=true;$('#workflow-run-attach').disabled=true;
      for(const file of files){const form=new FormData();form.append('file',file);runFiles.push(await api('/api/files',form));drawRunFiles();}
      $('#workflow-run-error').textContent='';
    }catch(error){$('#workflow-run-error').textContent='';handleError(error);}
    finally{uploading=false;$('#workflow-run-attachments').setAttribute('aria-busy','false');$('#workflow-run-form button.primary-button').disabled=false;$('#workflow-run-attach').disabled=false;$('#workflow-run-files').value='';}
  }
  $('#workflow-run-attach').onclick=()=>$('#workflow-run-files').click();
  $('#workflow-run-files').onchange=event=>void attachRunFiles(Array.from(event.target.files));
  $('#workflow-run-attachments').onclick=event=>{const button=event.target.closest('[data-run-remove]');if(button&&!uploading){runFiles=runFiles.filter(file=>file.id!==button.dataset.runRemove);drawRunFiles();}};
  $('#workflow-run-form').addEventListener('paste',event=>{const files=Array.from(event.clipboardData?.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();void attachRunFiles(files);}});
  $('#workflow-run-form').ondragover=event=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files'))event.preventDefault();};
  $('#workflow-run-form').ondrop=event=>{const files=Array.from(event.dataTransfer?.files||[]);if(files.length){event.preventDefault();void attachRunFiles(files);}};
  $('#workflow-run-dialog').addEventListener('cancel',event=>{if(uploading)event.preventDefault();});
  const editor=createWorkflowEditor(getState,refresh,openRun);
  const showError=(id,error)=>{$(id).textContent=error.message;handleError(error);};
  $('.prompt-editor').insertAdjacentHTML('afterend','<div id="command-suggestions" class="command-suggestions" role="group" aria-label="Workflow and skill commands" hidden></div>');
  const suggest=()=>{const state=getState(),match=$('#prompt').value.match(/^([/$])([a-z0-9_-]*)$/);const commands=state && match ? [...state.workflows,...state.skills].filter(item=>item.command.startsWith(match[2])):[];$('#command-suggestions').innerHTML=commands.map(item=>`<button type="button" data-workflow-command="${esc(match[1]+item.command)}"><strong class="skill-mention">${esc(match[1]+item.command)}</strong><small>${esc(item.name)}</small></button>`).join('');$('#command-suggestions').hidden=!commands.length;};
  $('#prompt').addEventListener('input',suggest);
  $('#prompt').addEventListener('keydown',event=>{if(event.key==='ArrowDown' && !$('#command-suggestions').hidden){event.preventDefault();$('#command-suggestions button')?.focus();}if(event.key==='Escape')$('#command-suggestions').hidden=true;});
  $('#skill-form').onsubmit=async event=>{event.preventDefault();try{const name=event.target.elements.name.value.trim().toLowerCase();if(getState().skills.some(s=>s.id!==skillId && s.name.trim().toLowerCase()===name))throw Error('Skill name already exists.');await api(skillId ? `/api/skills/${skillId}`:'/api/skills',{...Object.fromEntries(new FormData(event.target)),files:skillFiles},skillId ? 'PUT':'POST');$('#skill-editor').close();toast('Skill saved.');await refresh();}catch(error){showError('#skill-error',error);}};
  $('#workflow-run-form').onsubmit=async event=>{event.preventDefault();if(uploading)return;const button=event.target.querySelector('button.primary-button');button.disabled=true;try{const inputs=Object.fromEntries(new FormData(event.target));const job=await api(`/api/workflows/${running.id}/run`,{agentId:getAgent(),inputs,attachments:runFiles.map(file=>file.id),interactionMode:$('#interaction-mode').value});$('#workflow-run-dialog').close();await refresh();onRun(job);}catch(error){showError('#workflow-run-error',error);}finally{button.disabled=false;}};
  $('#workflow-import-file').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>30000)throw new Error('Choose a workflow definition under 30 KB.');const imported=JSON.parse(await file.text());delete imported.id;editor.open(imported);}catch(error){handleError(error);}finally{event.target.value='';}};
  $('#skill-import-folder').onchange=async event=>{
    try {
      const files=Array.from(event.target.files);if(!files.length)return;
      const root=files[0].webkitRelativePath.split('/')[0]+'/';
      const source=files.find(file=>file.webkitRelativePath===root+'SKILL.md');
      if(!source)throw Error('Choose a folder containing SKILL.md at its root.');
      if(source.size>30000)throw Error('Choose a SKILL.md file under 30 KB.');
      const resources=files.filter(file=>file!==source);
      if(resources.length>100 || resources.reduce((sum,file)=>sum+file.size,0)>5*1024*1024)throw Error('Choose up to 100 resource files totaling at most 5 MB.');
      const bundled=await Promise.all(resources.map(async file=>({path:file.webkitRelativePath.slice(root.length),content:await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('Could not read '+file.name));reader.readAsDataURL(file);})})));
      openSkill(await api('/api/skills/import',{source:await source.text(),files:bundled}));
    }catch(error){handleError(error);}finally{event.target.value='';}
  };
  $('#skill-import-file').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>30000)throw new Error('Choose a SKILL.md file under 30 KB.');openSkill(await api('/api/skills/import',{source:await file.text()}));}catch(error){handleError(error);}finally{event.target.value='';}};
  document.addEventListener('click',async event=>{
    const target=event.target.closest('button,[data-mention-link]');if(!target)return;const state=getState();if(!state)return;
    const workflowEdit=target.dataset.workflowEdit || state.workflows.find(w=>w.command===target.dataset.mentionCommand)?.id;
    const skillEdit=target.dataset.skillEdit || state.skills.find(s=>s.command===target.dataset.mentionCommand)?.id;
    try {
      if(target.dataset.workflowCommand){$('#prompt').value=target.dataset.workflowCommand+' ';$('#prompt').dispatchEvent(new Event('input'));$('#prompt').focus();}
      if(target.hasAttribute('data-workflow-new'))editor.open(blank());
      if(target.hasAttribute('data-workflow-import'))$('#workflow-import-file').click();
      if(target.hasAttribute('data-skill-import-folder'))$('#skill-import-folder').click();
      if(target.hasAttribute('data-skill-import'))$('#skill-import-file').click();
      if(workflowEdit)editor.open(state.workflows.find(w=>w.id===workflowEdit));
      if(target.dataset.workflowDelete && confirm('Delete this workflow? Existing run history stays saved.')){await api(`/api/workflows/${target.dataset.workflowDelete}`,{},'DELETE');await refresh();}
      if(target.dataset.workflowExport){const workflow=structuredClone(state.workflows.find(w=>w.id===target.dataset.workflowExport));delete workflow.id;const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(workflow,null,2)],{type:'application/json'}));link.href=url;link.download=`${workflow.command}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
      if(target.hasAttribute('data-skill-close'))$('#skill-editor').close();
      if(target.hasAttribute('data-run-close')&&!uploading)$('#workflow-run-dialog').close();
      if(target.hasAttribute('data-history-close'))$('#workflow-history').close();
      if(target.hasAttribute('data-skill-new') || skillEdit)openSkill(state.skills.find(s=>s.id===skillEdit),skillEdit || null);
      if(target.dataset.skillDelete && confirm('Delete this skill?')){await api(`/api/skills/${target.dataset.skillDelete}`,{},'DELETE');await refresh();}
      if(target.dataset.workflowRun)openRun(state.workflows.find(w=>w.id===target.dataset.workflowRun));
      if(target.dataset.workflowHistory){const run=state.workflowRuns.find(r=>r.id===target.dataset.workflowHistory);$('#workflow-history-title').textContent=run.workflow.name;$('#workflow-history-content').innerHTML=`<p>${esc(run.status)} · ${esc(run.currentStep)} · ${run.visits} completed steps</p>${run.error ? `<p class="run-error">${esc(run.error)}</p>`:''}<h3>Inputs</h3><pre>${esc(JSON.stringify(run.inputs,null,2))}</pre>${Object.entries(run.outputs).map(([id,value])=>`<details open><summary>${esc(id)}</summary><pre>${esc(text(value))}</pre></details>`).join('')}<h3>Step history</h3>${state.jobs.filter(j=>j.workflowRunId===run.id).reverse().map(j=>`<p>${esc(j.workflowStepId)} · ${esc(j.status)} ${j.error ? `· ${esc(j.error)}`:''}</p>${j.workflowOutput!==undefined ? `<details><summary>Saved step result</summary><pre>${esc(text(j.workflowOutput))}</pre></details>`:''}`).join('')}`;$('#workflow-history').showModal();}
    }catch(error){handleError(error);}
  });
}
