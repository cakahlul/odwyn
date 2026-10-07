import { $, esc, icon, api, toast } from './ui.js';

const blocks={
  agent:{label:'AI agent',symbol:'chat',detail:'Give an agent instructions, skills and tools.'},
  browser:{label:'Browser',symbol:'globe',detail:'Open a page or interact with a website.'},
  terminal:{label:'Terminal',symbol:'terminal',detail:'Run a command in your workspace.'},
  condition:{label:'Condition',symbol:'workflow',detail:'Choose a path based on previous results.'},
  approval:{label:'Human review',symbol:'shield',detail:'Pause for your feedback or item selection.'},
  output:{label:'Output',symbol:'folder',detail:'Show a result in the conversation.'},
};
const browserActions=['read','navigate','click','fill','type','press','scroll','select','tab','new_tab','close_tab','back','wait','screenshot','save_screenshot','upload','dialog'];
const toolNames=['browser','terminal','search','ask','send_file','remember','schedule'];
const text=value=>typeof value==='string' ? value:JSON.stringify(value,null,2);
const options=(items,value)=>items.map(([id,label])=>`<option value="${esc(id)}" ${id===value ? 'selected':''}>${esc(label)}</option>`).join('');
const field=(label,name,value='',kind='input',extra='')=>`<label>${esc(label)}${kind==='textarea' ? `<textarea data-wf-field="${name}" rows="5" ${extra}>${esc(value)}</textarea>`:`<input data-wf-field="${name}" value="${esc(value)}" ${extra}>`}</label>`;
const slug=name=>{const value=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50);return /^[a-z]/.test(value) && !['constructor','prototype'].includes(value) ? value:`workflow-${value || 'new'}`;};
const WIDTH=200,HEIGHT=112;

export function createWorkflowEditor(getState,refresh,onRun) {
  document.body.insertAdjacentHTML('beforeend',`<dialog id="workflow-editor" class="modal workflow-canvas-modal" aria-labelledby="workflow-editor-title"><h2 id="workflow-editor-title" class="sr-only">Create workflow</h2><form id="workflow-form" novalidate><header class="workflow-editor-bar"><span class="workflow-editor-mark" aria-hidden="true">${icon('workflow')}</span><div class="workflow-editor-identity"><label class="sr-only" for="workflow-name">Workflow name</label><input id="workflow-name" data-wf-field="workflow.name" required maxlength="80" placeholder="Name your workflow"><label class="workflow-command"><span>/</span><input aria-label="Workflow command" data-wf-field="workflow.command" required pattern="[a-z][a-z0-9_-]{0,59}" placeholder="command"></label></div><div class="workflow-editor-actions"><button type="button" class="secondary-button" data-wf-add>+ Add step</button><button type="button" class="icon-button" data-wf-settings aria-label="Workflow settings" title="Workflow settings">${icon('settings')}</button><button class="primary-button" type="submit">Save</button><button type="button" class="secondary-button" data-wf-save-run>${icon('play')}<span>Run</span></button><button type="button" class="icon-button" data-wf-close aria-label="Close workflow editor">${icon('close')}</button></div></header><div class="workflow-workspace"><section class="workflow-canvas" aria-label="Workflow canvas"><div id="workflow-viewport" tabindex="0" aria-label="Pan workflow canvas"><div id="workflow-world"><div id="workflow-plane"><svg id="workflow-edges" aria-label="Workflow connections"></svg><div id="workflow-steps"></div></div></div></div><div class="workflow-canvas-controls" role="group" aria-label="Canvas controls"><button type="button" class="icon-button" data-wf-zoom="out" aria-label="Zoom out">−</button><output id="workflow-zoom">100%</output><button type="button" class="icon-button" data-wf-zoom="in" aria-label="Zoom in">+</button><button type="button" class="secondary-button" data-wf-fit>Fit</button><button type="button" class="secondary-button" data-wf-arrange>Arrange</button></div><div id="workflow-link-controls" class="workflow-link-controls" hidden><span>Connection selected</span><button type="button" class="secondary-button" data-wf-unlink>Delete connection</button></div></section><aside id="workflow-panel" class="workflow-panel" aria-label="Workflow configuration" hidden><div class="workflow-panel-heading"><h3 id="workflow-panel-title"></h3><button type="button" class="icon-button" data-wf-panel-close aria-label="Back to canvas">${icon('close')}</button></div><div id="workflow-palette" hidden><label class="sr-only" for="workflow-block-search">Search steps</label><input id="workflow-block-search" type="search" placeholder="Search steps…"><div id="workflow-blocks"></div></div><section id="workflow-step-editor" aria-label="Selected step" hidden></section><section id="workflow-settings" hidden></section></aside></div><footer class="workflow-editor-footer"><span id="workflow-canvas-hint">Drag nodes to move · Connect output to input · Click a node to configure</span><small id="workflow-error" role="status"></small></footer></form></dialog>`);
  let draft,selected=-1,panel=null,addFrom=null,link=null,selectedLink=null,drag=null,zoom=1,suppressUntil=0,lastField=null,autoCommand=false;
  const viewport=$('#workflow-viewport'),plane=$('#workflow-plane'),editor=$('#workflow-editor');
  const error=problem=>{$('#workflow-error').textContent=problem.message || String(problem);};
  const position=index=>draft.steps[index].position;
  const source=id=>id==='$start' ? {position:{x:48,y:220},name:'When run',type:'trigger',next:draft.start}:draft.steps.find(s=>s.id===id);
  const setTarget=(id,port,target)=>{if(id==='$start')draft.start=target;else source(id)[port]=target;};
  const uniqueCommand=name=>{const base=slug(name);let result=base,index=2;while([...getState().workflows,...getState().skills].some(w=>w.command===result && w.id!==draft.id))result=`${base}-${index++}`;return result;};
  function sync() {
    if(!draft)return;
    const step=draft.steps[selected],oldId=step?.id;
    editor.querySelectorAll('[data-wf-field]').forEach(input=>{
      const [scope,name]=input.dataset.wfField.split('.');
      if(scope==='workflow')draft[name]=input.type==='number' ? Number(input.value):input.value;
      else if(scope==='action' && step){step.action ||= {};if(input.value==='')delete step.action[name];else step.action[name]=input.type==='number' ? Number(input.value):input.value;}
      else if(step){
        if(name==='action'){if(input.dataset.edited==='true')step.action=JSON.parse(input.value || '{}');}
        else if(['value','compare','options'].includes(name)){try{step[name]=JSON.parse(input.value);}catch{step[name]=input.value;}}
        else step[name]=input.type==='checkbox' ? input.checked:input.type==='number' ? Number(input.value):['agentId','next','otherwise'].includes(name) ? input.value || null:input.value;
      }
    });
    if(step && $('#workflow-step-editor').children.length){for(const name of ['skills','tools']){const checkboxes=editor.querySelectorAll(`[data-wf-check="${name}"]`);if(checkboxes.length)step[name]=[...checkboxes].filter(c=>c.checked).map(c=>c.value);}}
    if(step && oldId!==step.id){for(const other of draft.steps){if(other.next===oldId)other.next=step.id;if(other.otherwise===oldId)other.otherwise=step.id;for(const key of ['prompt','value','compare','options'])if(typeof other[key]==='string')other[key]=other[key].replaceAll(`steps.${oldId}`,`steps.${step.id}`);}if(draft.start===oldId)draft.start=step.id;}
    editor.querySelectorAll('[data-input-index]').forEach(row=>{const input=draft.inputs[Number(row.dataset.inputIndex)];for(const field of row.querySelectorAll('[data-input-field]')){const name=field.dataset.inputField;input[name]=field.type==='checkbox' ? field.checked:field.value;if(name==='default' && !field.value)delete input.default;}});
  }
  function dimensions(){return {width:Math.max(900,...draft.steps.map(s=>s.position.x+WIDTH+140)),height:Math.max(600,...draft.steps.map(s=>s.position.y+HEIGHT+140))};}
  function resizeWorld(){const size=dimensions();$('#workflow-world').style.width=`${size.width*zoom}px`;$('#workflow-world').style.height=`${size.height*zoom}px`;plane.style.width=`${size.width}px`;plane.style.height=`${size.height}px`;plane.style.transform=`scale(${zoom})`;$('#workflow-edges').setAttribute('width',size.width);$('#workflow-edges').setAttribute('height',size.height);$('#workflow-zoom').value=`${Math.round(zoom*100)}%`;}
  function endpoint(id,port){const node=source(id);return {x:node.position.x+WIDTH,y:node.position.y+(node.type==='condition' ? port==='otherwise' ? 84:36:56)};}
  function curve(from,to){if(to.x<from.x){const y=Math.max(20,Math.min(from.y,to.y)-100);return `M ${from.x} ${from.y} C ${from.x+70} ${from.y}, ${from.x+70} ${y}, ${from.x} ${y} L ${to.x} ${y} C ${to.x-70} ${y}, ${to.x-70} ${to.y}, ${to.x} ${to.y}`;}const distance=Math.max(70,Math.abs(to.x-from.x)*.45);return `M ${from.x} ${from.y} C ${from.x+distance} ${from.y}, ${to.x-distance} ${to.y}, ${to.x} ${to.y}`;}
  function paintEdges(){
    const edges=[];
    for(const id of ['$start',...draft.steps.map(s=>s.id)]){const node=source(id);for(const port of node.type==='condition' ? ['next','otherwise']:['next']){
      const target=draft.steps.find(s=>s.id===node[port]);if(!target)continue;
      const from=endpoint(id,port),to={x:target.position.x,y:target.position.y+56};
      edges.push(`<path class="workflow-edge ${selectedLink?.from===id && selectedLink.port===port ? 'selected':''}" d="${curve(from,to)}" data-wf-edge="${esc(id)}" data-port="${port}" role="button" tabindex="0" aria-label="Connection from ${esc(node.name)} to ${esc(target.name)}${node.type==='condition' ? port==='otherwise' ? ', if false':', if true':''}" marker-end="url(#workflow-arrow)"/>`);
    }}
    if(link?.point)edges.push(`<path class="workflow-edge preview" d="${curve(endpoint(link.from,link.port),link.point)}"/>`);
    $('#workflow-edges').innerHTML=`<defs><marker id="workflow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>${edges.join('')}`;
    $('#workflow-link-controls').hidden=!selectedLink;
    $('#workflow-canvas-hint').textContent=link ? 'Choose a node’s input to connect. Escape cancels.':'Drag nodes to move · Connect output to input · Click a node to configure';
  }
  function ports(id,node){return `${id==='$start' ? '':`<button type="button" class="workflow-port input" data-wf-input="${esc(id)}" aria-label="Connect to ${esc(node.name)}"></button>`}${(node.type==='condition' ? ['next','otherwise']:['next']).map(port=>`<button type="button" class="workflow-port output ${port==='otherwise' ? 'false':node.type==='condition' ? 'true':''}" data-wf-output="${esc(id)}" data-port="${port}" aria-label="Connect from ${esc(node.name)}${node.type==='condition' ? port==='otherwise' ? ' if false':' if true':''}"></button>${node[port] ? '':`<button type="button" class="workflow-node-add ${port==='otherwise' ? 'false':node.type==='condition' ? 'true':''}" data-wf-add-after="${esc(id)}" data-port="${port}" aria-label="Add step after ${esc(node.name)}${port==='otherwise' ? ' if false':''}">+</button>`}`).join('')}`;}
  function paintCanvas(){
    const start=source('$start');
    $('#workflow-steps').innerHTML=`<article class="workflow-node trigger" data-node="$start"><button type="button" class="workflow-node-select" data-wf-settings><span class="workflow-node-symbol">${icon('play')}</span><strong>When run</strong><small>/${esc(draft.command || 'your-command')}</small></button>${ports('$start',start)}</article>${draft.steps.map((step,index)=>`<article class="workflow-node ${selected===index && panel==='node' ? 'selected':''} ${step.type==='condition' ? 'condition':''}" data-node="${esc(step.id)}"><button type="button" class="workflow-node-select" data-wf-select="${index}" aria-pressed="${selected===index && panel==='node'}"><span class="workflow-node-symbol">${icon(blocks[step.type]?.symbol || 'workflow')}</span><strong>${esc(step.name || blocks[step.type]?.label || step.id)}</strong><small>${esc(blocks[step.type]?.label || step.type)}</small></button>${step.type==='condition' ? '<span class="workflow-branch-label true">True</span><span class="workflow-branch-label false">False</span>':''}${ports(step.id,step)}</article>`).join('')}${draft.steps.length ? '':`<button type="button" class="workflow-first-step" data-wf-add-after="$start"><span>+</span><strong>Add your first step</strong><small>Choose an agent, browser action, or another block.</small></button>`}`;
    for(const node of $('#workflow-steps').querySelectorAll('[data-node]')){const point=source(node.dataset.node).position;node.style.left=`${point.x}px`;node.style.top=`${point.y}px`;}
    resizeWorld();paintEdges();
  }
  function paintPalette(){const query=$('#workflow-block-search').value.toLowerCase();$('#workflow-blocks').innerHTML=Object.entries(blocks).filter(([type,block])=>`${type} ${block.label} ${block.detail}`.toLowerCase().includes(query)).map(([type,block])=>`<button type="button" class="workflow-block-choice" data-wf-add-type="${type}"><span>${icon(block.symbol)}</span><span><strong>${block.label}</strong><small>${block.detail}</small></span><span aria-hidden="true">+</span></button>`).join('') || '<p>No matching steps. Try another search.</p>';}
  function mappings(step){const entries=[...draft.inputs.map(f=>[`inputs.${f.name}`,f.label || f.name]),...draft.steps.filter(s=>s.id!==step.id).flatMap(s=>s.type==='approval' ? [[`steps.${s.id}.answer`,`${s.name} · answer`],[`steps.${s.id}.selected`,`${s.name} · selected items`]]:[[`steps.${s.id}`,`${s.name} · output`]]),['run.visits','Completed steps']];return `<details class="workflow-data"><summary>Insert data from another step</summary><p class="field-hint">Place the cursor in a field, then choose data to insert.</p><div class="workflow-mappings">${entries.map(([path,label])=>`<button type="button" class="secondary-button" data-wf-insert="{{${esc(path)}}}">${esc(label)}</button>`).join('')}</div></details>`;}
  function actionFields(step){const action=step.action || {};if(step.type==='terminal')return `${field('Command','action.command',action.command || '','textarea','placeholder="Enter a shell command…"')}${field('Why run this command?','action.reason',action.reason || 'Run workflow command')}<p class="field-hint">Inserted data is quoted automatically. Place references outside shell quotes.</p>`;
    const name=action.action || 'navigate';let fields=`<label>Action<select data-wf-field="action.action">${options(browserActions.map(a=>[a,a.replaceAll('_',' ')]),name)}</select></label>`;
    if(['navigate','new_tab'].includes(name))fields+=field('Website URL','action.url',action.url || '','input','placeholder="https://example.com or a workflow input"');
    if(['click','fill','select','upload','press'].includes(name))fields+=field('Element reference','action.ref',action.ref ?? '','input','placeholder="Reference from a previous page read"');
    if(['fill','type','press','select'].includes(name))fields+=field(name==='press' ? 'Key':'Text / value','action.text',action.text || '');
    if(name==='scroll')fields+=field('Scroll amount','action.delta',action.delta ?? 500,'input','type="number" min="-4000" max="4000"');
    if(name==='wait')fields+=field('Wait (milliseconds)','action.ms',action.ms ?? 1000,'input','type="number" min="0" max="10000"');
    if(name==='tab')fields+=field('Tab index','action.index',action.index ?? 0,'input','type="number" min="0"');
    if(name==='upload')fields+=field('Uploaded file ID','action.fileId',action.fileId || '');
    if(name==='dialog')fields+=`<label>Dialog response<select data-wf-field="action.choice">${options([['accept','Accept'],['dismiss','Dismiss']],action.choice || 'dismiss')}</select></label>`;
    return fields+field('Reason','action.reason',action.reason || 'Run browser step');
  }
  function paintNode(){
    const state=getState(),step=draft.steps[selected];if(!step)return;
    const connections=[['','Finish'],...draft.steps.map(s=>[s.id,s.name || s.id])];
    $('#workflow-step-editor').innerHTML=`${field('Step name','step.name',step.name)}<label>Block type<select data-wf-field="step.type">${options(Object.entries(blocks).map(([id,b])=>[id,b.label]),step.type)}</select></label>${step.type==='agent' ? `<label>Agent<select data-wf-field="step.agentId">${options([['','Agent selected when launched'],...state.agents.map(a=>[a.id,a.customization?.name || 'Odwyn'])],step.agentId || '')}</select></label>`:''}${['agent','approval','output'].includes(step.type) ? field(step.type==='approval' ? 'What should the owner review?':step.type==='output' ? 'Result to display':'What should this agent do?','step.prompt',step.prompt || '','textarea','placeholder="Write instructions and insert data from previous steps…" maxlength="20000"'):''}${['browser','terminal'].includes(step.type) ? actionFields(step):''}${step.type==='condition' ? `${field('Value to check','step.value',text(step.value ?? ''))}<label>Condition<select data-wf-field="step.operator">${options(['equals','not_equals','contains','exists','truthy','greater_than','less_than'].map(v=>[v,v.replaceAll('_',' ')]),step.operator || 'equals')}</select></label>${field('Compare with','step.compare',text(step.compare ?? ''))}`:''}${mappings(step)}${step.type==='agent' ? `<fieldset class="workflow-choice-list"><legend>Skills</legend>${state.skills.length ? state.skills.map(s=>`<label><input type="checkbox" data-wf-check="skills" value="${s.id}" ${step.skills?.includes(s.id) ? 'checked':''}><span>${esc(s.name)}<small>${esc(s.description)}</small></span></label>`).join(''):'<p class="field-hint">Create reusable skills in Workflows & skills.</p>'}</fieldset><fieldset class="workflow-choice-list tools"><legend>Allowed tools</legend>${toolNames.map(t=>`<label><input type="checkbox" data-wf-check="tools" value="${t}" ${t==='ask' || step.tools?.includes(t) ? 'checked':''} ${t==='ask' ? 'disabled':''}><span>${t.replaceAll('_',' ')}</span></label>`).join('')}</fieldset><label>Output format<select data-wf-field="step.format">${options([['text','Text'],['json','JSON']],step.format || 'text')}</select></label>`:''}${['agent','output'].includes(step.type) ? `<details class="workflow-response-settings"><summary>Interactive response</summary><p class="field-hint">Display returned items as selectable cards. Clicking the button sends a follow-up to this agent in the same chat.</p>${field('Items field in returned JSON','step.responseItems',step.responseItems || 'items','input','placeholder="items or feedback"')}${field('Button text','step.responseLabel',step.responseLabel || 'Send selected items','input','maxlength="80"')}${field('What should the agent do with the selection?','step.responsePrompt',step.responsePrompt || '','textarea','placeholder="Post only the selected feedback to the original PR." maxlength="8000"')}<p class="field-hint">Leave instructions empty for display only. Interactive replies use JSON with a title, summary, and the items field above. Selections and source context are included automatically.</p></details>`:''}${step.type==='approval' ? `<details><summary>Selectable review items</summary>${field('Items (JSON array or inserted data)','step.options',text(step.options || []),'textarea')}</details>`:''}<details><summary>Connections</summary><label>${step.type==='condition' ? 'If true':'Next step'}<select data-wf-field="step.next">${options(connections,step.next || '')}</select></label>${step.type==='condition' ? `<label>If false<select data-wf-field="step.otherwise">${options(connections,step.otherwise || '')}</select></label>`:''}<button type="button" class="secondary-button" data-wf-start>Start here</button></details><details><summary>Advanced</summary>${field('Step ID','step.id',step.id,'input','pattern="[a-z][a-z0-9_-]{0,59}"')}${field('Retry count','step.retries',step.retries || 0,'input','type="number" min="0" max="5"')}<label class="workflow-check"><input type="checkbox" data-wf-field="step.retrySafe" ${step.retrySafe ? 'checked':''}>Safe to repeat automatically</label>${['browser','terminal'].includes(step.type) ? field('All action parameters (JSON)','step.action',JSON.stringify(step.action || {},null,2),'textarea','data-wf-raw-action'):''}</details><button type="button" class="workflow-delete-step" data-wf-remove="${selected}">${icon('trash')} Delete step</button>`;
  }
  function paintSettings(){
    $('#workflow-settings').innerHTML=`${field('Description','workflow.description',draft.description || '','textarea','rows="3" maxlength="500"')}${field('Maximum executed steps','workflow.maxSteps',draft.maxSteps || 100,'input','type="number" min="1" max="1000"')}<h4>Inputs when running</h4><p class="field-hint">Ask for a URL, topic, or other information before the workflow starts.</p><div id="workflow-inputs">${draft.inputs.map((input,index)=>`<div class="workflow-input-row" data-input-index="${index}"><label>Name<input data-input-field="name" value="${esc(input.name)}" placeholder="topic" pattern="[a-z][a-z0-9_-]{0,59}"></label><label>Label<input data-input-field="label" value="${esc(input.label || '')}" placeholder="What should we research?"></label><label>Default<input data-input-field="default" value="${esc(input.default ?? '')}"></label><label class="workflow-check"><input type="checkbox" data-input-field="required" ${input.required ? 'checked':''}>Required</label><button type="button" class="icon-button" data-wf-input-remove="${index}" aria-label="Remove input">${icon('trash')}</button></div>`).join('')}</div><button type="button" class="secondary-button" data-wf-input-add>+ Add input</button><details><summary>Definition (JSON)</summary><textarea id="workflow-json" rows="12" aria-label="Workflow JSON">${esc(JSON.stringify(draft,null,2))}</textarea><button type="button" class="secondary-button" data-wf-json-apply>Apply definition</button></details>`;
  }
  function paintPanel(){
    const wasOpen=!$('#workflow-panel').hidden;$('#workflow-panel').hidden=!panel;$('.workflow-workspace').classList.toggle('panel-open',!!panel);
    for(const [id,mode] of [['#workflow-step-editor','node'],['#workflow-palette','palette'],['#workflow-settings','settings']])$(id).hidden=panel!==mode;
    $('#workflow-step-editor').replaceChildren();$('#workflow-settings').replaceChildren();lastField=null;
    $('#workflow-panel-title').textContent=panel==='palette' ? 'What happens next?':panel==='settings' ? 'Workflow settings':draft.steps[selected]?.name || 'Step';
    if(panel==='node')paintNode();if(panel==='settings')paintSettings();if(panel==='palette')paintPalette();
    if(wasOpen!==!!panel)fit();else resizeWorld();
  }
  function showPalette(from){sync();addFrom=from || {from:selected>=0 ? draft.steps[selected].id:draft.steps.at(-1)?.id || '$start',port:'next'};panel='palette';$('#workflow-block-search').value='';paintPanel();paintCanvas();$('#workflow-block-search').focus();}
  function fit(){const size=dimensions();zoom=Math.min(1,Math.max(.2,Math.min((viewport.clientWidth-48)/size.width,(viewport.clientHeight-48)/size.height)));resizeWorld();viewport.scrollLeft=0;viewport.scrollTop=0;}
  function open(workflow){draft=structuredClone(workflow);draft.inputs ||= [];draft.steps ||= [];selected=-1;panel=null;link=null;selectedLink=null;zoom=1;autoCommand=!draft.id;if(!draft.name)draft.name='Untitled workflow';if(!draft.command)draft.command=uniqueCommand(draft.name);draft.steps.forEach((step,index)=>{if(!step.position || !Number.isFinite(step.position.x) || !Number.isFinite(step.position.y))step.position={x:340+(index%4)*300,y:220+Math.floor(index/4)*240};if(step.next===undefined)step.next=draft.steps[index+1]?.id || null;});draft.start ||= draft.steps[0]?.id || null;$('#workflow-editor-title').textContent=draft.id ? 'Edit workflow':'Create workflow';$('#workflow-name').value=draft.name;editor.querySelector('[data-wf-field="workflow.command"]').value=draft.command;$('#workflow-error').textContent='';paintPanel();paintCanvas();editor.showModal();requestAnimationFrame(fit);}
  async function save(run=false){
    sync();if(!$('#workflow-name').reportValidity() || !editor.querySelector('[data-wf-field="workflow.command"]').reportValidity())return;
    if(!draft.steps.length){showPalette({from:'$start',port:'next'});throw new Error('Add your first step before saving.');}
    const invalid=draft.steps.findIndex(s=>['agent','approval','output'].includes(s.type) && !s.prompt?.trim() || s.type==='terminal' && !s.action?.command?.trim() || s.type==='browser' && ['navigate','new_tab'].includes(s.action?.action) && !s.action?.url?.trim());
    if(invalid>=0){selected=invalid;panel='node';paintPanel();paintCanvas();throw new Error(`Complete ${draft.steps[invalid].name} before saving.`);}
    draft=await api(draft.id ? `/api/workflows/${draft.id}`:'/api/workflows',draft,draft.id ? 'PUT':'POST');editor.close();toast('Workflow saved.');await refresh();if(run)onRun(draft);
  }
  editor.querySelector('#workflow-form').onsubmit=event=>{event.preventDefault();void save().catch(error);};
  editor.addEventListener('focusin',event=>{if(event.target.matches('[data-wf-field]') && ['INPUT','TEXTAREA'].includes(event.target.tagName) && /^(action\.|step\.(prompt|value|compare|options)$)/.test(event.target.dataset.wfField))lastField=event.target;});
  editor.addEventListener('input',event=>{if(event.target.hasAttribute('data-wf-raw-action'))event.target.dataset.edited='true';if(event.target.dataset.wfField?.startsWith('action.')){const raw=editor.querySelector('[data-wf-raw-action]');if(raw)raw.dataset.edited='false';}if(event.target.id==='workflow-name' && autoCommand)editor.querySelector('[data-wf-field="workflow.command"]').value=uniqueCommand(event.target.value);if(event.target.dataset.wfField==='workflow.command')autoCommand=false;});
  editor.addEventListener('change',event=>{if(['step.type','action.action','step.next','step.otherwise'].includes(event.target.dataset.wfField)){try{sync();paintPanel();paintCanvas();}catch(problem){error(problem);}}});
  $('#workflow-block-search').oninput=paintPalette;
  editor.addEventListener('click',event=>{
    const target=event.target.closest('button,[data-wf-edge]');if(!target)return;
    if(target.closest('#workflow-steps') && performance.now()<suppressUntil)return;
    try {
      if(target.hasAttribute('data-wf-close')){sync();editor.close();}
      if(target.hasAttribute('data-wf-save-run'))void save(true).catch(error);
      if(target.hasAttribute('data-wf-settings')){sync();panel='settings';selected=-1;paintPanel();paintCanvas();}
      if(target.hasAttribute('data-wf-panel-close')){sync();panel=null;paintPanel();paintCanvas();}
      if(target.hasAttribute('data-wf-add'))showPalette();
      if(target.hasAttribute('data-wf-add-after'))showPalette({from:target.dataset.wfAddAfter,port:target.dataset.port || 'next'});
      if(target.dataset.wfAddType){
        sync();const type=target.dataset.wfAddType,previous=source(addFrom.from);let id=`${type}-${draft.steps.length+1}`;while(draft.steps.some(s=>s.id===id))id+='-new';
        const next=previous[addFrom.port] || null,step={id,name:blocks[type].label,type,prompt:type==='output' && addFrom.from!=='$start' ? `{{steps.${addFrom.from}}}`:'',skills:[],tools:['browser','search','ask'],next,position:addFrom.point || {x:previous.position.x+300,y:previous.position.y+(addFrom.port==='otherwise' ? 200:0)}};
        if(type==='browser')step.action={action:'navigate',url:'',reason:'Open a website'};
        if(type==='terminal')step.action={command:'',reason:'Run workflow command',timeoutMs:30000};
        if(type==='condition')Object.assign(step,{value:'',compare:'',operator:'equals',otherwise:null});
        draft.steps.push(step);setTarget(addFrom.from,addFrom.port,id);selected=draft.steps.length-1;panel='node';link=null;paintPanel();paintCanvas();fit();$('#workflow-step-editor textarea, #workflow-step-editor input')?.focus();
      }
      if(target.hasAttribute('data-wf-select')){sync();selected=Number(target.dataset.wfSelect);panel='node';selectedLink=null;paintPanel();paintCanvas();}
      if(target.hasAttribute('data-wf-output')){sync();link={from:target.dataset.wfOutput,port:target.dataset.port};selectedLink=null;paintEdges();}
      if(target.hasAttribute('data-wf-input') && link){sync();setTarget(link.from,link.port,target.dataset.wfInput);link=null;paintCanvas();if(panel==='node')paintNode();}
      if(target.hasAttribute('data-wf-edge')){selectedLink={from:target.dataset.wfEdge,port:target.dataset.port};link=null;paintEdges();}
      if(target.hasAttribute('data-wf-unlink') && selectedLink){sync();setTarget(selectedLink.from,selectedLink.port,null);selectedLink=null;paintCanvas();if(panel==='node')paintNode();}
      if(target.hasAttribute('data-wf-start')){sync();draft.start=draft.steps[selected].id;paintCanvas();}
      if(target.hasAttribute('data-wf-remove')){sync();const [removed]=draft.steps.splice(Number(target.dataset.wfRemove),1);for(const step of draft.steps)for(const port of ['next','otherwise'])if(step[port]===removed.id)step[port]=removed.next===removed.id ? null:removed.next;if(draft.start===removed.id)draft.start=removed.next===removed.id ? draft.steps[0]?.id || null:removed.next || draft.steps[0]?.id || null;selected=-1;panel=null;link=null;selectedLink=null;paintPanel();paintCanvas();}
      if(target.hasAttribute('data-wf-insert')){const input=lastField?.isConnected ? lastField:$('#workflow-step-editor [data-wf-field="step.prompt"], #workflow-step-editor [data-wf-field="action.url"], #workflow-step-editor [data-wf-field="action.command"], #workflow-step-editor [data-wf-field="step.value"]');if(input){input.focus();input.setRangeText(target.dataset.wfInsert,input.selectionStart ?? input.value.length,input.selectionEnd ?? input.value.length,'end');input.dispatchEvent(new Event('input',{bubbles:true}));}}
      if(target.hasAttribute('data-wf-input-add')){sync();let name=`input-${draft.inputs.length+1}`;while(draft.inputs.some(i=>i.name===name))name+='-new';draft.inputs.push({name,label:'',required:true});paintSettings();}
      if(target.hasAttribute('data-wf-input-remove')){sync();draft.inputs.splice(Number(target.dataset.wfInputRemove),1);paintSettings();}
      if(target.hasAttribute('data-wf-json-apply')){const next=JSON.parse($('#workflow-json').value);if(!Array.isArray(next.steps) || !Array.isArray(next.inputs))throw new Error('Definition needs steps and inputs arrays.');const id=draft.id;editor.close();open({...next,id});}
      if(target.hasAttribute('data-wf-fit'))fit();
      if(target.dataset.wfZoom){zoom=Math.max(.2,Math.min(2,zoom+(target.dataset.wfZoom==='in' ? .1:-.1)));resizeWorld();}
      if(target.hasAttribute('data-wf-arrange')){sync();draft.steps.forEach((step,index)=>step.position={x:340+(index%4)*300,y:220+Math.floor(index/4)*240});paintCanvas();fit();}
    } catch(problem){error(problem);}
  });
  const canvasPoint=event=>{const bounds=viewport.getBoundingClientRect();return {x:(event.clientX-bounds.left+viewport.scrollLeft)/zoom,y:(event.clientY-bounds.top+viewport.scrollTop)/zoom};};
  viewport.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    const port=event.target.closest('[data-wf-output]'),node=event.target.closest('[data-node]');
    if(event.target.closest('[data-wf-input],[data-wf-add-after],[data-wf-edge]'))return;
    try{sync();}catch(problem){error(problem);return;}
    if(port){link={from:port.dataset.wfOutput,port:port.dataset.port};drag={kind:'wire',x:event.clientX,y:event.clientY};}
    else if(node && node.dataset.node!=='$start'){const index=draft.steps.findIndex(s=>s.id===node.dataset.node);drag={kind:'node',index,node,x:event.clientX,y:event.clientY,position:{...position(index)}};}
    else if(!event.target.closest('button'))drag={kind:'pan',x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
  });
  viewport.addEventListener('pointermove',event=>{
    if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4)drag.moved=true;if(drag.moved && !viewport.hasPointerCapture(event.pointerId))viewport.setPointerCapture(event.pointerId);
    if(drag.kind==='node' && drag.moved){const point={x:Math.max(0,Math.min(10000,drag.position.x+dx/zoom)),y:Math.max(0,Math.min(10000,drag.position.y+dy/zoom))};draft.steps[drag.index].position=point;drag.node.style.left=`${point.x}px`;drag.node.style.top=`${point.y}px`;resizeWorld();paintEdges();}
    if(drag.kind==='wire' && drag.moved){link.point=canvasPoint(event);paintEdges();}
    if(drag.kind==='pan'){viewport.scrollLeft=drag.left-dx;viewport.scrollTop=drag.top-dy;}
  });
  viewport.addEventListener('pointerup',event=>{
    if(!drag)return;const current=drag;drag=null;if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);if(!current.moved)return;suppressUntil=performance.now()+200;
    if(current.kind==='wire'){const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-wf-input]');if(target){setTarget(link.from,link.port,target.dataset.wfInput);link=null;paintCanvas();if(panel==='node')paintNode();}else {const from={from:link.from,port:link.port,point:canvasPoint(event)};link=null;showPalette(from);}}
    else if(current.kind==='node')paintCanvas();
  });
  viewport.addEventListener('pointercancel',()=>{drag=null;link=null;paintCanvas();});
  editor.addEventListener('keydown',event=>{
    if(event.key==='Escape' && link){event.preventDefault();link=null;drag=null;paintEdges();return;}
    if(event.target.matches('[data-wf-edge]') && ['Enter',' '].includes(event.key)){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}
    if(event.target.matches('[data-wf-edge]') && ['Delete','Backspace'].includes(event.key)){event.preventDefault();setTarget(event.target.dataset.wfEdge,event.target.dataset.port,null);selectedLink=null;paintCanvas();}
    if(event.target.matches('[data-wf-select]') && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const index=Number(event.target.dataset.wfSelect),point=position(index);point.x=Math.max(0,Math.min(10000,point.x+(event.key==='ArrowRight' ? 20:event.key==='ArrowLeft' ? -20:0)));point.y=Math.max(0,Math.min(10000,point.y+(event.key==='ArrowDown' ? 20:event.key==='ArrowUp' ? -20:0)));paintCanvas();editor.querySelector(`[data-wf-select="${index}"]`).focus();}
  });
  new ResizeObserver(()=>{if(editor.open)resizeWorld();}).observe(viewport);
  return {open};
}
