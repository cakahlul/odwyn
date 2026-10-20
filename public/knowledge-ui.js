import {$,esc,api,toast,handleError} from './ui.js';

export function setupKnowledgeSettings(refresh){
 const panel=$('#settings-knowledge-controls');
 let documents=[],editing=null,busy=false;
 panel.innerHTML=`<h3 id="workspace-knowledge-title">Knowledge</h3><p class="field-hint">Reusable facts and guidance for your agents. Create a document, then assign it in Customize agent → Knowledge.</p><label>Knowledge document<select id="workspace-knowledge"></select></label><p id="workspace-knowledge-description" class="field-hint"></p><div class="access-buttons"><button type="button" class="secondary-button" id="knowledge-new">Create knowledge</button><button type="button" class="secondary-button" id="knowledge-edit">Edit</button><button type="button" class="secondary-button danger-button" id="knowledge-delete">Delete</button></div><div id="knowledge-editor" class="management-editor" hidden><h4 id="knowledge-editor-heading"></h4><label>Name<input id="knowledge-name" maxlength="200" autocomplete="off"></label><label>Summary (optional)<textarea id="knowledge-summary" rows="2" maxlength="500"></textarea></label><label>Content (text or Markdown)<textarea id="knowledge-content" rows="12" maxlength="20000" spellcheck="true" placeholder="Architecture, terminology, product rules, coding standards…"></textarea></label><p class="field-hint">Editing creates a new version for future tasks. Knowledge may be sent to the agent’s AI provider. Keep passwords and other secrets out.</p><div class="access-buttons"><button type="button" class="primary-button" id="knowledge-save">Save knowledge</button><button type="button" class="secondary-button" id="knowledge-cancel">Cancel</button></div></div><p id="knowledge-status" role="status" aria-live="polite"></p>`;
 const status=(message,tone='success')=>{$('#knowledge-status').textContent=message==='Working…'?message:'';if(message&&message!=='Working…')toast(message,tone);};
 const selected=()=>documents.find(row=>row.id===$('#workspace-knowledge').value);
 function availability(){
  panel.querySelectorAll('button,input,select,textarea').forEach(node=>node.disabled=busy);
  $('#knowledge-edit').disabled=$('#knowledge-delete').disabled=busy||!selected();
  $('#knowledge-new').disabled=busy;
 }
 function describe(){
  const row=selected();
  $('#workspace-knowledge-description').textContent=row?`Version ${row.version}${row.summary?' · '+row.summary:''}`:'No knowledge yet. Create a document to assign it to agents.';
  availability();
 }
 function reset(){editing=null;$('#knowledge-editor').hidden=true;for(const field of panel.querySelectorAll('#knowledge-editor input,#knowledge-editor textarea'))field.value='';}
 async function load(preferred){
  documents=await api('/api/knowledge',null,'GET');
  const previous=preferred||$('#workspace-knowledge').value;
  $('#workspace-knowledge').innerHTML=documents.map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
  if(documents.some(row=>row.id===previous))$('#workspace-knowledge').value=previous;
  describe();
 }
 const run=fn=>async()=>{
  if(busy)return;busy=true;availability();status('Working…');
  try{await fn();if($('#knowledge-status').textContent==='Working…')status('');}
  catch(error){status('');handleError(error);}
  finally{busy=false;availability();}
 };
 function openEditor(row=null){
  editing=row;$('#knowledge-editor').hidden=false;$('#knowledge-editor-heading').textContent=row?'Edit knowledge':'Create knowledge';
  $('#knowledge-name').value=row?.name||'';$('#knowledge-summary').value=row?.summary||'';$('#knowledge-content').value=row?.content||'';
  status('');availability();$('#knowledge-name').focus();
 }
 $('#workspace-knowledge').onchange=()=>{reset();describe();status('');};
 $('#knowledge-new').onclick=()=>openEditor();
 $('#knowledge-edit').onclick=()=>{if(selected())openEditor(selected());};
 $('#knowledge-cancel').onclick=()=>{reset();availability();status('');};
 $('#knowledge-save').onclick=run(async()=>{
  const name=$('#knowledge-name').value.trim(),summary=$('#knowledge-summary').value.trim(),content=$('#knowledge-content').value;
  if(!name)throw new Error('Enter a knowledge name.');
  if(!content.trim())throw new Error('Enter knowledge content.');
  const wasEditing=!!editing,previousVersion=editing?.version;
  const result=await api('/api/knowledge'+(editing?'/'+editing.id:''),{name,summary,content,...(editing?{version:editing.version}:{})},editing?'PUT':'POST');
  reset();await load(result.id);await refresh();status(wasEditing?result.version===previousVersion?'Saved. No changes.':'Saved a new version.':'Created. Assign this knowledge in Customize agent.',wasEditing&&result.version===previousVersion?'success':'warning');
 });
 $('#knowledge-delete').onclick=run(async()=>{
  const row=selected();if(!row)return;
  if(!confirm(`Delete "${row.name}"? It will no longer load on future tasks. Its agent assignments will be removed.`)){status('Deletion cancelled.','warning');return;}
  await api('/api/knowledge/'+row.id,{version:row.version},'DELETE');reset();await load();await refresh();status('Knowledge deleted.');
 });
 document.querySelector('[data-settings-section="knowledge"]').addEventListener('click',run(async()=>{reset();await load();}));
 $('#settings-dialog').addEventListener('close',reset);
 panel.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('input,select'))event.preventDefault();});
 availability();
}
