import {$,esc,icon,api,toast,handleError} from './ui.js';
import {libraryList} from './workflows-ui.js';

export function renderKnowledge(state){
 return `<section class="collection workflows library-page"><div class="collection-heading"><h1>Knowledge</h1><p>Reference documents for your agents. Assign them in Customize agent → Knowledge.</p></div><div class="collection-toolbar"><button class="primary-button" id="knowledge-new">New knowledge +</button><button class="secondary-button" id="knowledge-import">Import knowledge</button></div>${libraryList('knowledge','Saved knowledge',state.knowledge||[],doc=>`<article class="workflow-row"><div><h3>${esc(doc.name)}</h3><p>${esc(doc.summary||'Reference document')} · Version ${doc.version}</p></div><div class="workflow-actions"><button class="secondary-button" data-knowledge-edit="${esc(doc.id)}">Edit</button><button class="icon-button" data-knowledge-delete="${esc(doc.id)}" aria-label="Delete ${esc(doc.name)}">${icon('trash')}</button></div></article>`,'No knowledge yet. Create a document or import a text or Markdown file.')}</section>`;
}

export function setupKnowledge(getState,refresh){
 let editing=null,busy=false;
 document.body.insertAdjacentHTML('beforeend',`<dialog id="knowledge-editor" class="modal" aria-labelledby="knowledge-editor-heading"><div class="modal-top"><span class="eyebrow">KNOWLEDGE</span><button type="button" class="icon-button" id="knowledge-close" aria-label="Close knowledge editor">${icon('close')}</button></div><h2 id="knowledge-editor-heading">Create knowledge</h2><form id="knowledge-form"><div class="modal-fields"><label>Name<input id="knowledge-name" required maxlength="200" autocomplete="off"></label><label>Summary (optional)<textarea id="knowledge-summary" rows="2" maxlength="500"></textarea></label><label>Content (text or Markdown)<textarea id="knowledge-content" required rows="12" maxlength="20000" spellcheck="true" placeholder="Architecture, terminology, product rules, coding standards…"></textarea></label><p class="field-hint">Changes create a new version for future tasks. Assigned documents are shared with the agent’s AI provider.</p></div><div class="form-footer"><button type="button" class="secondary-button" id="knowledge-cancel">Cancel</button><button class="primary-button" id="knowledge-save">Save knowledge</button></div></form></dialog><input type="file" id="knowledge-import-file" accept=".md,.txt,.markdown,text/plain,text/markdown" hidden>`);
 const dialog=$('#knowledge-editor');
 function openEditor(doc=null){
  editing=doc?.id?doc:null;
  $('#knowledge-editor-heading').textContent=editing?'Edit knowledge':'Create knowledge';
  $('#knowledge-name').value=doc?.name||'';$('#knowledge-summary').value=doc?.summary||'';$('#knowledge-content').value=doc?.content||'';
  dialog.showModal();$('#knowledge-name').focus();
 }
 $('#knowledge-close').onclick=$('#knowledge-cancel').onclick=()=>dialog.close();
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 $('#knowledge-form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;busy=true;
  dialog.querySelectorAll('button').forEach(button=>button.disabled=true);
  try{
   const previous=editing;
   const result=await api('/api/knowledge'+(previous?'/'+previous.id:''),{name:$('#knowledge-name').value.trim(),summary:$('#knowledge-summary').value.trim(),content:$('#knowledge-content').value,...(previous?{version:previous.version}:{})},previous?'PUT':'POST');
   dialog.close();await refresh();toast(previous?result.version===previous.version?'Saved. No changes.':'Saved a new version.':'Knowledge created. Assign it in Customize agent.');
  }catch(error){handleError(error);}
  finally{busy=false;dialog.querySelectorAll('button').forEach(button=>button.disabled=false);}
 };
 $('#knowledge-import-file').onchange=async event=>{
  try{
   const file=event.target.files[0];if(!file)return;
   if(!/\.(md|markdown|txt)$/i.test(file.name))throw Error('Choose a Markdown or text file.');
   if(file.size>80000)throw Error('Choose a knowledge file under 80 KB.');
   const content=await file.text();if(!content.trim()||content.length>20000)throw Error('Knowledge content must contain 1–20000 characters.');
   openEditor({name:file.name.replace(/\.(md|markdown|txt)$/i,'').slice(0,200),content});
  }catch(error){handleError(error);}finally{event.target.value='';}
 };
 document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||busy)return;
  if(button.id==='knowledge-new')openEditor();
  if(button.id==='knowledge-import')$('#knowledge-import-file').click();
  const id=button.dataset.knowledgeEdit||button.dataset.knowledgeDelete,doc=getState()?.knowledge?.find(row=>row.id===id);if(!doc)return;
  if(button.dataset.knowledgeEdit)openEditor(doc);
  if(button.dataset.knowledgeDelete&&confirm(`Delete “${doc.name}”? Its agent assignments will be removed. Future tasks will no longer load it.`)){
   busy=true;button.disabled=true;
   try{await api('/api/knowledge/'+doc.id,{version:doc.version},'DELETE');await refresh();toast('Knowledge deleted.');}catch(error){handleError(error);}finally{busy=false;button.disabled=false;}
  }
 });
}
