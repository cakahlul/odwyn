import {$,storageKey} from './ui.js';

// Tutorials explain live controls; they never submit forms or change permissions.
const guides = {
 home: ['Home', [['#view h1','Your starting point','Resume a conversation here, or start a new one.'],['#workspace-navigation','Explore Odwyn','Use the navigation to open conversations, tools, agents and settings.']]],
 chat: ['Conversations', [['#view','Your conversation','Messages, results and approval requests appear here.'],['#prompt','Give your agent a task','Describe your goal and include any constraints. Sending a message starts real work.'],['#interaction-mode','Choose how to work','Review the interaction mode before sending. Resource permissions still apply.']]],
 runs: ['Activity', [['#view','Follow your tasks','Review task status and open a run to inspect its result.']]],
 routines: ['Routines', [['#view','Scheduled work','Routines run tasks on a schedule. Review their agent, Space and timing before enabling them.']]],
 workflows: ['Workflows', [['#view','Repeat a process','Workflows organize reusable steps. Review the steps and agent access before running one.']]],
 files: ['Files', [['#view','Task files','Find files produced by your agents. Open a file to inspect or download it.']]],
 'search-dialog': ['Conversations', [['#search-input','Find a conversation','Search your history, then select a conversation to continue it.']]],
 'agents-dialog': ['Agents', [['#agents-dialog h2','Your agents','Each agent has its own focus and AI provider.'],['#sidebar-agent-list','Manage an agent','Open an agent to chat. Use its menu to customize it or choose its AI provider.']]],
 'tools-dialog': ['Tools', [['#tools-dialog h2','Tools for your work','Choose a tool to manage workflows, routines, files or task activity.']]],
 'customize-dialog': ['Agent settings', [['#customize-title','Customize this agent','Set its focus, appearance, replies and AI provider.'],['#agent-access-tab','Access & Autonomy','Click here to choose which resources the agent can use and when it must ask you.']]],
 'security-dialog': ['Access & Autonomy', [
  ['#access-memberships','1. Choose Spaces','Spaces group resources. Check the Spaces this agent needs. Membership alone does not grant access to their resources.'],
  ['#access-space','2. Choose the task Space','This is the default Space for new tasks. Choose a checked Space that contains the resource you need.'],
  ['#access-resource','3. Choose a resource','Configure one specific target at a time. Save your changes before switching resources. Add missing resources in Settings → Resources.'],
  ['#access-actions','4. Decide when it can act','Blocked prevents an action. Ask first requires approval. Automatic lets the agent act within its saved scope. Some actions always require approval. Review each action separately.'],
  ['#access-advanced > summary','5. Optional restrictions','Click to see permission templates, branch restrictions and expiry. Templates suggest choices; review them before saving.'],
  ['#access-preview','6. Preview first','Preview changes checks your unsaved permissions without executing an action. Use it to understand what the agent would be allowed to do.'],
  ['#access-save','7. Save when ready','Only Save access applies your choices to subsequent calls. This tutorial does not save anything. Skip or finish to return to your settings.']
 ]],
 'workspace-create-dialog': ['New workspace', [['#workspace-home-name','Name your workspace','A workspace has separate agents, conversations, files and browser sessions. Enter a name, then create it when ready.']]],
 'room-header': ['Room details', [['#room-heading','Your shared conversation','Review participants here. Open an agent to manage its settings.'],['#edit-room','Adjust collaboration','Change participants, roles and review requirements. These choices do not grant resource access.']]],
 'workflow-editor': ['Workflow editor', [['#workflow-name','Name your workflow','Give this reusable process a clear name and command.'],['#workflow-viewport','Build the steps','Add blocks and connect their outputs. Review each block’s instructions and permissions before saving.']]],
 'skill-editor': ['Skill editor', [['#skill-form','Reusable instructions','Describe what the skill should do. Saving makes its instructions available for future tasks.']]],
 'workflow-run-dialog': ['Run a workflow', [['#workflow-run-inputs','Review workflow inputs','Fill in the task inputs and attach any needed files. Starting the workflow performs real work using the agents’ saved permissions.']]],
 'workflow-history': ['Workflow history', [['#workflow-history-content','Review previous runs','Inspect past runs and their status before deciding whether to run this workflow again.']]],
 'room-dialog': ['Rooms', [['#room-name','Name the room','Give the shared conversation a clear purpose.'],['#room-agent-options','Choose participants','Select agents from the same Space. Roles and reviews organize collaboration; they do not grant resource access.']]],
 'schedule-dialog': ['Schedule a routine', [['#schedule-dialog h2','Plan recurring work','Choose a task, agent and schedule. Saving creates a real routine; review its permissions first.']]]
};
const settingsCopy = {
 appearance:'Choose navigation, colors and motion. Preview your changes before saving.',
 provider:'Connect the default AI provider used by your agents. Individual agents can override it.',
 preferences:'Set your name, language, reply length and context shared with your agents.',
 workspaces:'Workspaces keep agents, conversations and files separate. Choose the workspace you want to manage.',
 sharing:'Choose which settings are shared between workspaces. Review the scope before applying changes.',
 spaces:'Create named groups for related resources. Assign agent membership in Access & Autonomy afterwards.',
 resources:'Create specific targets, such as a repository, browser or file. Creation grants no access. Configure the agent separately in Access & Autonomy.',
 knowledge:'Save reference documents for agents. Select documents in agent settings and allow Read knowledge in Access & Autonomy.',
 isolated:'Configure isolated projects and repositories here. Each task uses a separate copy. Grant workspace and repository permissions separately.',
 connections:'Configure endpoints and credentials used by resources. Saving a connection grants no agent access. Changing credentials revokes linked permissions.',
 presets:'Create reusable action selections. Apply a template in Access & Autonomy, then review and save the agent’s permissions.',
 tutorials:'Hide automatic tutorials for every menu, or reset visited menus. Manual replay stays available. Changes here are saved immediately in this browser for this workspace.'
};

export function setupTutorials() {
 const key=storageKey('odwyn-tutorials');let saved;
 try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
 let preferences={hidden:saved?.hidden===true,seen:Array.isArray(saved?.seen)?saved.seen.filter(id=>typeof id==='string'):[]};
 let main='home',ready=false,context=null,active=null,index=0,previousFocus=null,frame=0;
 const persist=()=>{try{localStorage.setItem(key,JSON.stringify(preferences));return true;}catch{$('#tutorial-settings-status').textContent='Tutorial preferences could not be saved. Allow browser storage to keep them after reloading.';return false;}};
 const tab=document.createElement('button');tab.type='button';tab.dataset.settingsSection='tutorials';tab.setAttribute('aria-controls','settings-tutorials-controls');tab.textContent='Tutorials';$('.settings-steps').append(tab);
 const panel=document.createElement('section');panel.id='settings-tutorials-controls';panel.dataset.settingsPanel='tutorials';panel.className='profile-controls';panel.hidden=true;
 panel.innerHTML='<h3>Tutorials</h3><p class="field-hint">Step-by-step help for each menu. Preferences apply to this workspace in this browser.</p><label class="check-label"><input type="checkbox" id="tutorial-hide">Hide automatic tutorials in all menus</label><p class="field-hint">You can always use a menu’s Tutorial button to replay its guide.</p><button type="button" class="secondary-button" id="tutorial-reset">Reset tutorial progress</button><p class="field-hint">Visited menus will show their tutorial next time you open them, unless automatic tutorials are hidden.</p><p id="tutorial-settings-status" role="status"></p>';
 $('.settings-scroll').append(panel);
 $('#tutorial-hide').checked=preferences.hidden;
 $('#tutorial-hide').onchange=event=>{preferences.hidden=event.target.checked;if(!persist())return;$('#tutorial-settings-status').textContent=preferences.hidden?'Automatic tutorials hidden. Manual replay is still available.':'Automatic tutorials enabled for unvisited menus.';};
 $('#tutorial-reset').onclick=()=>{preferences.seen=[];if(!persist())return;$('#tutorial-settings-status').textContent='Tutorial progress reset. Guides will appear when you next open each menu.';};
 const overlay=document.createElement('div');overlay.id='tutorial-overlay';overlay.setAttribute('popover','manual');
 overlay.innerHTML='<div class="tutorial-shade"></div><div class="tutorial-shade"></div><div class="tutorial-shade"></div><div class="tutorial-shade"></div><div id="tutorial-light" aria-hidden="true"></div><section id="tutorial-card" role="dialog" aria-labelledby="tutorial-title" aria-describedby="tutorial-copy"><small id="tutorial-progress" aria-live="polite"></small><h2 id="tutorial-title"></h2><p id="tutorial-copy"></p><div class="tutorial-actions"><button type="button" class="text-button" id="tutorial-skip">Skip</button><button type="button" class="secondary-button" id="tutorial-back">Back</button><button type="button" class="primary-button" id="tutorial-next">Next</button></div></section>';
 const card=overlay.querySelector('#tutorial-card');
 function stop(restore=true){
  if(!active)return;active=null;
  if(overlay.matches(':popover-open'))overlay.hidePopover();
  overlay.remove();if(restore&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
 }
 function visible(node){return node&&node.getClientRects().length&&!node.closest('[hidden]');}
 function position(){
  if(!active)return;
  const step=active.steps[index],target=active.root.querySelector(step[0])||document.querySelector(step[0]);
  if(!visible(target)){stop(false);return;}
  const r=target.getBoundingClientRect(),w=innerWidth,h=innerHeight;
  const left=Math.max(0,r.left-5),top=Math.max(0,r.top-5),right=Math.min(w,r.right+5),bottom=Math.min(h,r.bottom+5);
  const boxes=[[0,0,w,top],[0,top,left,Math.max(0,bottom-top)],[right,top,w-right,Math.max(0,bottom-top)],[0,bottom,w,h-bottom]];
  overlay.querySelectorAll('.tutorial-shade').forEach((shade,i)=>{const [x,y,width,height]=boxes[i];Object.assign(shade.style,{left:x+'px',top:y+'px',width:Math.max(0,width)+'px',height:Math.max(0,height)+'px'});});
  Object.assign(overlay.querySelector('#tutorial-light').style,{left:left+'px',top:top+'px',width:Math.max(0,right-left)+'px',height:Math.max(0,bottom-top)+'px'});
  const height=card.getBoundingClientRect().height,width=card.getBoundingClientRect().width;
  const below=bottom+12,above=top-height-12;
  Object.assign(card.style,{left:Math.max(8,Math.min(left,w-width-8))+'px',top:Math.max(8,Math.min(below+height<=h-8?below:above>=8?above:h-height-8,h-height-8))+'px'});
 }
 function show(){
  const step=active.steps[index];
  overlay.querySelector('#tutorial-progress').textContent=`${active.title} · ${index+1} / ${active.steps.length}`;
  overlay.querySelector('#tutorial-title').textContent=step[1];overlay.querySelector('#tutorial-copy').textContent=step[2];
  overlay.querySelector('#tutorial-back').disabled=index===0;overlay.querySelector('#tutorial-next').textContent=index===active.steps.length-1?'Finish':'Next';
  const target=active.root.querySelector(step[0])||document.querySelector(step[0]);target?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  position();overlay.querySelector('#tutorial-next').focus({preventScroll:true});
 }
 function start(){
  stop(false);if(!context)return;
  const steps=context.steps.filter(step=>visible(context.root.querySelector(step[0])||document.querySelector(step[0])));
  if(!steps.length)return;
  previousFocus=document.activeElement;active={...context,steps};index=0;
  if(!preferences.seen.includes(context.id)){preferences.seen.push(context.id);persist();}
  context.root.append(overlay);overlay.showPopover();show();
 }
 overlay.querySelector('#tutorial-skip').onclick=()=>stop();
 overlay.querySelector('#tutorial-back').onclick=()=>{if(index>0){index--;show();}};
 overlay.querySelector('#tutorial-next').onclick=()=>{if(index===active.steps.length-1)stop();else{index++;show();}};
 document.addEventListener('keydown',event=>{
  if(!active)return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();stop();}
  if(event.key==='Tab'){
   const target=active.root.querySelector(active.steps[index][0])||document.querySelector(active.steps[index][0]);
   const nodes=[...card.querySelectorAll('button:not(:disabled)'),...(target?.matches('button,input,select,textarea,summary,a[href]')?[target]:target?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href]')||[])].filter(node=>visible(node)&&!node.disabled);
   const current=nodes.indexOf(document.activeElement);event.preventDefault();nodes[(current+(event.shiftKey?-1:1)+nodes.length)%nodes.length]?.focus();
  }
 },true);
 document.addEventListener('pointerdown',event=>{
  if(!active||overlay.contains(event.target))return;
  const target=active.root.querySelector(active.steps[index][0])||document.querySelector(active.steps[index][0]);
  if(!target?.contains(event.target))stop(false);
 },true);
 document.addEventListener('scroll',()=>{if(active)position();},true);window.addEventListener('resize',position);
 function sync(){
  frame=0;if(!ready)return;
  const dialogs=[...document.querySelectorAll('dialog[open]')];
  // The most recently opened modal owns the tour, including nested agent settings.
  const root=dialogs.sort((a,b)=>(a.tutorialOpened||0)-(b.tutorialOpened||0)).at(-1)||$('#view');
  let id=root.id==='view'?main:root.id,title,steps;
  if(id==='settings-dialog'){
   const section=root.querySelector('[data-settings-section][aria-current]');const name=section?.dataset.settingsSection||'appearance';
   id='settings-'+name;title=section?.textContent||'Settings';
   const target=`#settings-${name}-controls`;
   steps=[[`${target} h3`,title,settingsCopy[name]||'Review the settings for this menu before applying changes.']];
   const control=root.querySelector(`${target} input,${target} select,${target} [data-manage-new],${target} button`);
   const selector=control?.id?'#'+control.id:control?.dataset.manageNew?`[data-manage-new="${control.dataset.manageNew}"]`:null;
   if(selector)steps.push([selector,'Try the controls','Click the highlighted control to explore. Changes apply only when saved, except tutorial preferences, which save immediately.']);
  }else [title,steps]=guides[id]||[];
  if(context?.id===id&&context.root===root){
   if(active){if(!overlay.isConnected){root.append(overlay);overlay.showPopover();}position();}
   return;
  }
  stop(false);document.querySelectorAll('.tutorial-replay').forEach(button=>button.remove());context=null;
  if(!steps||!visible(root))return;
  context={id,title,steps,root};
  const replay=document.createElement('button');replay.type='button';replay.className='secondary-button tutorial-replay';replay.textContent='Tutorial';replay.setAttribute('aria-label',`Tutorial: ${title}`);replay.onclick=start;
  if(root.id==='view'){replay.id='main-tutorial';$('#agent-workspace').prepend(replay);}else (root.querySelector('.profile-top,.modal-top')||root).append(replay);
  if(!preferences.hidden&&!preferences.seen.includes(id))start();
 }
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(sync);};
 document.addEventListener('toggle',event=>{if(event.target.matches('dialog')){if(event.newState==='open')event.target.tutorialOpened=performance.now();schedule();}},true);
 new MutationObserver(records=>{if(records.some(record=>!overlay.contains(record.target)&&!record.target.closest?.('.tutorial-replay')&&(record.type==='attributes'||[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&node!==overlay&&!node.matches?.('.tutorial-replay')))))schedule();}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','hidden','aria-current']});
 return view=>{main=view;ready=true;schedule();};
}
