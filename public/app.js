import {renderAudit,setupAudit} from './audit-ui.js';
import {setupChatComposer} from './chat-composer.js';
import {setupOddy} from './oddy-ui.js';
import {setupTutorials} from './tutorials.js';
import {renderKnowledge,setupKnowledge} from './knowledge-ui.js';
import {setupRoomWork} from './room-work-ui.js';
import {setupWorkspaceHomes} from './workspace-homes.js';
import {setupWorkspaceSettings} from './workspace-settings.js';
import { renderWorkflows, setupWorkflows } from './workflows-ui.js';
import { $, esc, icon, hydrateIcons, api, toast, handleError, activeStatuses, date, workspaceUrl, workspaceId, storageKey } from './ui.js';
import { renderHome, renderAgentRoster, renderChat, insertMessages, colorMentions, renderRuns, renderRoutines, renderFiles, renderActivity, recentConversations } from './views.js';
import { setupBrowser, updateBrowser } from './browser-ui.js';
import { setupCustomization, applyProfile, openCustomization, fillWorkspaceAppearance, readWorkspaceAppearance } from './customize.js';
import { defaults, agentColor, choices, ownerPreferenceKeys, avatarSvg, currencies, effortLevels } from './profile.js';

// Carry browser preferences forward from the previous product name.
if (workspaceId === 'default') for (const [storage, keys] of [[localStorage, ['agent','closed-agents','bubble-positions']], [sessionStorage, ['drafts']]]) {
  for (const key of keys) {
    const previous = storage.getItem(`sidekick-${key}`);
    if (previous !== null && storage.getItem(`odwyn-${key}`) === null) storage.setItem(`odwyn-${key}`, previous);
    storage.removeItem(`sidekick-${key}`);
  }
}

function setSidebarCollapsed(collapsed) {
  document.documentElement.classList.toggle('sidebar-collapsed',collapsed);
  const button = $('#sidebar-collapse'), label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  button.setAttribute('aria-expanded',String(!collapsed));
  button.setAttribute('aria-label',label);button.title = label;
  button.querySelector('img').src = `/icons/lucide/panel-left-${collapsed ? 'open' : 'close'}.svg`;
  button.querySelector('span').textContent = collapsed ? 'Expand' : 'Collapse';
}
setSidebarCollapsed(localStorage.getItem(storageKey('odwyn-sidebar-collapsed')) === 'true' || (localStorage.getItem(storageKey('odwyn-sidebar-collapsed')) === null && matchMedia('(max-width:760px)').matches));
matchMedia('(max-width:760px)').addEventListener('change',event => {
  setSidebarCollapsed(event.matches || localStorage.getItem(storageKey('odwyn-sidebar-collapsed')) === 'true');
});
document.addEventListener('pointerdown',event => {
  if (document.documentElement.dataset.navigation === 'dock' && document.documentElement.dataset.dockAutoHide === 'true' && !event.target.closest('.dock-region') && document.activeElement.closest('.dock-region')) document.activeElement.blur();
});
$('.dock-region').onclick = event => {
  if (event.target === event.currentTarget || event.target.closest('.dock-reveal-button')) $('#menu-button').focus({preventScroll:true});
};
$('#sidebar-collapse').onclick = () => {
  const collapsed = !document.documentElement.classList.contains('sidebar-collapsed');
  setSidebarCollapsed(collapsed);localStorage.setItem(storageKey('odwyn-sidebar-collapsed'),String(collapsed));
};

const mobileLayout = matchMedia('(max-width:760px)');
function positionWorkspacePicker() {
  const picker = $('.workspace-home-picker');
  const parent = mobileLayout.matches ? (document.documentElement.dataset.screen === 'home' ? $('.breadcrumb') : $('#conversation-menu')) : $('.rail-heading');
  if (picker.parentElement !== parent) parent.append(picker);
}
function syncConversationMenu() {
  const menu = $('#conversation-menu');
  if (menu.matches(':popover-open')) menu.hidePopover();
  menu.setAttribute('popover','auto');
  positionWorkspacePicker();
}
syncConversationMenu();
mobileLayout.addEventListener('change',syncConversationMenu);
$('#conversation-menu').addEventListener('click',event => {
  if (event.target.closest('button:not([popovertarget])') && event.currentTarget.matches(':popover-open')) event.currentTarget.hidePopover();
});

const navigationDock = $('#workspace-navigation'), dockItems = [...navigationDock.querySelectorAll('.dock-item')];
function magnifyDock(clientX = null) {
  for (const item of dockItems) {
    const bounds = item.getBoundingClientRect();
    const distance = clientX === null ? 1 : Math.min(1,Math.abs(clientX - bounds.x - bounds.width / 2) / (bounds.width * 2));
    item.style.setProperty('--dock-weight',(1 + Math.cos(distance * Math.PI)) / 2);
  }
}
navigationDock.addEventListener('pointermove',event => { if (event.pointerType === 'mouse' || event.pointerType === 'pen') magnifyDock(event.clientX); });
navigationDock.addEventListener('pointerleave',() => {
  const focused = dockItems.find(item=>item.matches(':focus-visible'));
  const bounds = focused?.getBoundingClientRect();magnifyDock(bounds ? bounds.x + bounds.width / 2 : null);
});
navigationDock.addEventListener('focusin',event => {
  const bounds = event.target.matches('.dock-item:focus-visible') ? event.target.getBoundingClientRect() : null;
  magnifyDock(bounds ? bounds.x + bounds.width / 2 : null);
});
navigationDock.addEventListener('focusout',() => magnifyDock());

for (const key of ['language','detail']) $(`#global-${key}`).innerHTML = Object.entries(choices[key]).map(([value,label])=>`<option value="${value}">${label}</option>`).join('');

let state = null, conversationId = null, view = 'home', filter = 'all', signature = '', busy = false, attachments = [], pendingAttachments = [], providerAgentId = null, providerGlobal = false, providerAdding = false;
let workspace = null, agentId = localStorage.getItem(storageKey('odwyn-agent')), switching = false, dockSignature = '', rosterSignature = '';
const drafts = new Map(JSON.parse(sessionStorage.getItem(storageKey('odwyn-drafts')) || '[]'));
const closedAgents = new Set(JSON.parse(localStorage.getItem(storageKey('odwyn-closed-agents')) || '[]'));
const bubblePositions = JSON.parse(localStorage.getItem(storageKey('odwyn-bubble-positions')) || '{}');
let transitionAgentId = null, drag = null, suppressBubbleClick = null;
let renamingConversationId = null;
let editingRoomId = null, saveRoomStage = null, roomListSignature = '', roomMembersSignature = '';
const roomRecipients = new Map();
const currentRoom = () => view === 'chat' && workspace?.conversations.find(c => c.id === conversationId && c.kind === 'room');
const providers = { codex: ['Codex','gpt-6.1-sol'], claude: ['Claude Code','sonnet'], antigravity:['Antigravity CLI','default'], openai: ['OpenAI-compatible API',''] };
const currencyNames = new Intl.DisplayNames(['en'],{type:'currency'});
$('#preferred-currency').innerHTML = currencies.map(code=>`<option value="${code}">${code === 'source' ? 'Original currency' : `${code} · ${esc(currencyNames.of(code))}`}</option>`).join('');
hydrateIcons(); setupBrowser(() => state);
const visitTutorial=setupTutorials();
setupWorkspaceSettings(refresh);
setupKnowledge(() => state,refresh);
setupCustomization(() => state, async (result, adding, onboarding) => { $('#provider-api-key').value = ''; signature = ''; await refresh(); if (adding) await switchAgent(result.id); if (onboarding && !workspace.globalProvider.configured) openSettings(); }, () => $('#provider-source').value === 'global' ? {inherit:true} : {...providerInput(),inherit:false});

function selectState() {
  if (!workspace) return;
  const agent = workspace.agents.find(a => a.id === agentId) || workspace.agents[0];
  const running = workspace.jobs.find(j => j.id === workspace.runtime.activeJobId);
  state = { ...workspace, agentId:agent.id, customization:agent.customization, provider:agent.provider, schedules:workspace.schedules.filter(s => (s.agentId || workspace.agents[0].id) === agent.id), runtime:{ ...workspace.runtime, ...agent.runtime, model:agent.provider.model, activeAgentName:workspace.agents.find(a => a.id === running?.agentId)?.customization?.name } };
}

function renderDock() {
  const active = workspace.jobs.find(j => j.id === workspace.runtime.activeJobId);
  const data = workspace.agents.map(agent => ({ ...agent, status:active?.agentId === agent.id ? active.status : workspace.jobs.find(j => j.agentId === agent.id && activeStatuses.includes(j.status))?.status }));
  const room = currentRoom();
  const next = JSON.stringify([agentId, transitionAgentId, [...closedAgents], room?.id,room?.memberIds, data.map(a => [a.id,a.customization,a.provider.type,a.status])]);
  if (dockSignature !== next && !drag) {
    const focused = document.activeElement.dataset.agent, closeFocus = document.activeElement.dataset.closeAgent, sidebarFocus = document.activeElement.dataset.selectAgent;
    const openMenu = $('.agent-menu[open]')?.dataset.manageAgent, menuFocus = document.activeElement.closest('.agent-menu')?.dataset.manageAgent, menuAction = document.activeElement.dataset.agentAction;
    $('#sidebar-agent-list').innerHTML = data.map(agent => {
      const p = {...defaults,...agent.customization}, selected = agent.id === agentId;
      const label = selected ? 'Active' : closedAgents.has(agent.id) ? 'Closed' : 'Minimized';
      return `<div class="sidebar-agent-row"><button class="sidebar-agent" aria-label="Open ${esc(p.name)}" data-status="${esc(agent.status || '')}" data-select-agent="${esc(agent.id)}" aria-pressed="${selected}" title="Open ${esc(p.name)}">${avatarSvg(p)}<span><strong>${esc(p.name)}</strong><small>${esc(providers[agent.provider.type][0])} · ${agent.status === 'waiting' ? 'Needs you' : label}</small></span></button><details class="agent-menu" data-manage-agent="${esc(agent.id)}" ${openMenu === agent.id ? 'open' : ''}><summary aria-label="Manage ${esc(p.name)}" title="Manage ${esc(p.name)}">⋯</summary><div class="agent-menu-actions"><button data-agent-action="customize" data-agent-id="${esc(agent.id)}">Customize agent</button><button data-agent-action="settings" data-agent-id="${esc(agent.id)}">AI provider</button><button class="delete-agent" data-agent-action="delete" data-agent-id="${esc(agent.id)}" ${data.length === 1 ? 'disabled title="Add a replacement before deleting your last agent"' : ''}>Delete agent</button></div></details></div>`;
    }).join('');
    $('#reply-agent').innerHTML = (room ? '<option value="all">All agents</option>' : '') + data.filter(a => !room || room.memberIds.includes(a.id)).map(a => `<option value="${esc(a.id)}">${esc(a.customization?.name || defaults.name)}</option>`).join('');
    const recipient = roomRecipients.get(room?.id) || 'all';
    $('#reply-agent').value = room ? room.memberIds.includes(recipient) ? recipient : 'all' : agentId || '';
    $('#agent-dock').innerHTML = data.filter(a => (a.id !== agentId || a.id === transitionAgentId) && !closedAgents.has(a.id)).map((agent,index) => {
      const p = {...defaults,...agent.customization};
      const status = agent.status === 'waiting' || agent.status === 'takeover' ? 'Needs your input' : agent.status === 'queued' ? 'Queued' : agent.status ? 'Working' : '';
      return `<div class="agent-slot" data-bubble="${esc(agent.id)}" style="--float-delay:-${index*1.3}s;--float-duration:${5+index*.6}s"><button class="bubble-restore" data-agent="${esc(agent.id)}" aria-label="Restore ${esc(p.name)}${status ? `, ${status}` : ''}" aria-describedby="bubble-help" title="Restore ${esc(p.name)}${status ? ` · ${status}` : ''}"><span class="agent-slot-note"><strong class="agent-slot-name">${esc(p.name)}</strong>${status ? `<small>${esc(status === 'Needs your input' ? 'Needs you' : status)}</small>` : ''}</span><span class="bubble-avatar">${avatarSvg(p)}</span></button><button class="bubble-close" data-close-agent="${esc(agent.id)}" aria-label="Close ${esc(p.name)}" title="Close ${esc(p.name)}">${icon('close')}</button>${status ? `<span class="agent-slot-status ${agent.status === 'running' ? 'running' : ''}" aria-hidden="true">${agent.status === 'waiting' || agent.status === 'takeover' ? '!' : '•'}</span>` : ''}</div>`;
    }).join(''); dockSignature = next;
    if (focused) $('#agent-dock').querySelector(`[data-agent="${focused}"]`)?.focus({preventScroll:true});
    if (closeFocus) $('#agent-dock').querySelector(`[data-close-agent="${closeFocus}"]`)?.focus({preventScroll:true});
    if (sidebarFocus) $('#sidebar-agent-list').querySelector(`[data-select-agent="${sidebarFocus}"]`)?.focus({preventScroll:true});
    if (menuFocus) $(`[data-manage-agent="${menuFocus}"] ${menuAction ? `[data-agent-action="${menuAction}"]` : 'summary'}`)?.focus({preventScroll:true});
  }
  $('#agent-dock').hidden = !!room && !!agentId;
  positionBubbles();
  document.querySelectorAll('[data-view]').forEach(button=>button.disabled = switching);
  $('#new-chat').disabled = $('.header-new-chat').disabled = switching;
  $('#minimize-agent').disabled = !agentId || busy || switching;
  $('#reply-agent').disabled = $('#close-conversation').disabled = busy || switching;
  $('.conversation-controls').hidden = !agentId || view === 'home';
  $('#add-agent').disabled = workspace.agents.length >= 5 || busy || switching;
  const needsYou = data.filter(a => ['waiting','takeover'].includes(a.status)).length;
  $('#agent-count').textContent = needsYou ? `${needsYou} needs you` : `${workspace.agents.length} of 5`;
  $('#agent-alert').hidden = !needsYou;
  $('#agent-alert').textContent = needsYou;
  $('#agents-open').title = needsYou ? `${needsYou} agents need your input` : 'Choose or manage your agents';
  $('#add-agent').title = workspace.agents.length >= 5 ? 'Maximum 5 agents reached' : `Add agent (${workspace.agents.length}/5)`;
}

function renderRooms() {
  const rooms = workspace.conversations.filter(c => c.kind === 'room'), room = currentRoom();
  $('#room-count').textContent = rooms.length;
  const listSignature = JSON.stringify([conversationId,view,workspace.agents.length,rooms.map(r=>[r.id,r.title,r.memberIds])]);
  if (listSignature !== roomListSignature) {
    $('#room-list').innerHTML = rooms.length ? rooms.map(r=>`<button class="room-list-item ${r.id === room?.id ? 'selected' : ''}" data-conversation="${esc(r.id)}" aria-label="${esc(r.title)}" title="${esc(r.title)}">${icon('chat')}<span class="room-initial" aria-hidden="true">${esc(Array.from(r.title)[0]?.toUpperCase() || '#')}</span><span><strong>${esc(r.title)}</strong><small>${r.memberIds.length} agents</small></span></button>`).join('') : `<p class="sidebar-empty">${workspace.agents.length < 2 ? 'Add another agent to create a room.' : 'Create a room for your agents.'}</p>`;
    roomListSignature = listSignature;
  }
  $('#new-room').disabled = workspace.agents.length < 2 || busy || switching;
  $('#new-room-top').disabled=busy||switching;
  const inRoom = !!room && !!agentId;
  $('#room-composer-hint').hidden = !inRoom;
  const roomRun=room?.roomWorkflowRunId && workspace.workflowRuns?.find(run=>run.id===room.roomWorkflowRunId);
  const roomStage=roomRun?.workflow.steps.find(step=>step.id===room.roomWorkflowStepId);
  $('#room-pass-next').hidden=!inRoom||room.discussion?.status!=='completed'||!!roomRun&&(roomRun.conversationId!==room.id||!roomStage?.next||roomRun.status!=='awaiting_handoff');
  $('#prompt').setAttribute('aria-describedby',inRoom?'room-composer-hint composer-keyboard-hint':'composer-keyboard-hint');
  renderMentions();
  document.body.classList.toggle('room-chat',inRoom);
  $('#room-details-open').hidden = !inRoom; $('#page-title').hidden = inRoom;
  $('#delete-conversation').disabled = busy || state.jobs.some(j=>j.conversationId===renamingConversationId && activeStatuses.includes(j.status));
  if ($('#room-header').open && (!inRoom || $('#room-header').dataset.room !== room.id)) $('#room-header').close();
  $('#room-header').dataset.room = room?.id || '';
  $('.reply-agent>span').textContent = room ? 'Send to' : 'Agent';
  $('.permission-picker').hidden = $('#schedule-open').hidden = false;
  if (!room || !agentId) return;
  $('#room-heading').textContent = $('#room-label').textContent = room.title;
  $('#room-participant-count').textContent = `${room.memberIds.length} agents · Shared conversation`;
  $('#room-details-open').setAttribute('aria-label',`Room details for ${room.title}`);
  $('#room-details-open').title = `${room.memberIds.length} agents · View room details`;
  const jobs = state.jobs.filter(j => j.conversationId === room.id);
  $('#edit-room').disabled = $('#room-discuss').disabled = busy || switching || jobs.some(j=>activeStatuses.includes(j.status));
  $('#delete-room').disabled = busy || switching || jobs.some(j=>activeStatuses.includes(j.status));
  $('#room-discuss').hidden = !room.messages.some(m=>m.role === 'assistant');
  const members = room.memberIds.map(id => {
    const agent = workspace.agents.find(a=>a.id===id), job = jobs.find(j=>j.agentId===id);
    const role=room.governance ? [room.governance.facilitatorId===id ? 'Facilitator' : room.governance.observerIds.includes(id) ? 'Observer' : 'Contributor',...(room.governance.reviewerIds.includes(id)?['Required reviewer']:[])].join(' · ') : '';
    return {...agent,role,status:job && activeStatuses.includes(job.status) ? job.status === 'queued' ? 'Queued' : job.pending ? 'Needs you' : 'Speaking' : job?.error ? 'Needs attention' : agent.runtime.account ? 'Ready' : 'Connect provider'};
  });
  const membersSignature = JSON.stringify([room.id,members.map(a=>[a.id,a.customization,a.role,a.status])]);
  if (membersSignature !== roomMembersSignature) {
    $('#room-members').innerHTML = members.map(a=>`<button class="room-member" data-room-agent="${esc(a.id)}" title="Settings for ${esc(a.customization?.name || defaults.name)}">${avatarSvg(a.customization || defaults)}<span><strong>${esc(a.customization?.name || defaults.name)}</strong>${a.role?`<small>${esc(a.role)}</small>`:''}<small>${esc(a.status)}</small></span></button>`).join('');
    roomMembersSignature = membersSignature;
  }
  $('#composer-area').setAttribute('aria-label','Message the conversation room');
  $('label[for="prompt"]').textContent = `Message ${room.title}`;
}

function renderMentions() {
  const room = currentRoom(), prompt = $('#prompt');
  const highlights = $('#prompt-highlights');
  highlights.style.width = prompt.clientWidth + 'px';
  highlights.textContent = prompt.value;
  colorMentions(highlights,workspace?.agents.filter(a=>!room || room.memberIds.includes(a.id)),[...(workspace?.skills || []),...(workspace?.workflows || [])],true);
  if (prompt.value.endsWith('\n')) highlights.append('\n');
  highlights.scrollTop = prompt.scrollTop;
  highlights.scrollLeft = prompt.scrollLeft;
  const match = prompt.value.slice(0,prompt.selectionStart).match(/(?:^|\s)@([^@\n"]*)$/);
  const members = room && match ? workspace.agents.filter(a=>room.memberIds.includes(a.id) && (a.customization?.name || defaults.name).toLowerCase().startsWith(match[1].toLowerCase())) : [];
  const html = members.map(a=>`<button type="button" class="text-button agent-mention" data-mention-agent="${esc(a.id)}">@${esc(a.customization?.name || defaults.name)}</button>`).join('');
  if ($('#room-mentions').innerHTML !== html) {
    $('#room-mentions').innerHTML = html;
    $('#room-mentions').querySelectorAll('button').forEach((button,index)=>button.style.setProperty('--agent-color',agentColor(members[index].customization)));
  }
  $('#room-mentions').hidden = !members.length;
}

function openRoomEditor(room = null, save = null) {
  saveRoomStage=save;
  editingRoomId = room?.id || null; $('#room-header').close(); setNavigation(false);
  $('#room-dialog-title').textContent = save ? 'Configure room stage' : room ? 'Edit conversation room' : 'Create a conversation room';
  $('#room-save').childNodes[0].textContent = save ? 'Apply stage' : room ? 'Save' : 'Create room';
  $('#room-dialog .modal-description').textContent = save ? 'Apply this stage to your draft, then click Save at the top of the workflow editor to save the whole workflow.' : 'Choose a name and 2–5 agents to share the conversation.';
  $('#room-name').value = room?.title || ''; $('#room-status').textContent = '';
  $('#room-governance').checked=!!room?.governance || !!save && !room;
  renderRoomAgents(room);
  $('#room-dialog').showModal(); $('#room-name').focus();
}

document.addEventListener('room-stage-edit',event=>openRoomEditor(event.detail.room,event.detail.save));

function renderRoomAgents(room = null) {
  $('#room-agent-options').innerHTML = workspace.agents.map(a=>`<label class="room-agent-option"><input type="checkbox" name="memberIds" value="${esc(a.id)}" ${room ? room.memberIds.includes(a.id) ? 'checked' : '' : a.id === agentId ? 'checked' : ''}>${avatarSvg(a.customization || defaults)}<span><strong>${esc(a.customization?.name || defaults.name)}</strong><small>${esc(providers[a.provider.type][0])} · ${a.runtime.account ? 'Ready' : 'Connect provider'}</small></span></label>`).join('');
  if (!$('#room-agent-options').children.length) $('#room-agent-options').innerHTML = '<p class="field-hint">Add agents to this workspace.</p>';
  const needsAgent=$('#room-agent-options').querySelectorAll('input').length<2;$('#room-setup-hint').hidden=!needsAgent;$('#room-save').disabled=needsAgent;
  renderRoomRoles(room?.governance || {});
}

function roomRoleValues(){
  const outputs=[...document.querySelectorAll('#room-output-options .room-output-row')].map(row=>({id:row.dataset.outputId,title:row.querySelector('input').value,agentId:row.querySelector('[data-output-agent]').value,kind:row.querySelector('[data-output-kind]').value}));
  return {facilitatorId:$('#room-facilitator').value||null,reviewerIds:[...document.querySelectorAll('#room-role-options input:checked')].map(node=>node.value),observerIds:[...document.querySelectorAll('#room-role-options select')].filter(node=>node.value==='observer').map(node=>node.dataset.agent),...(outputs.length?{outputs}:{}),...($('#room-owner-approval').checked?{ownerApproval:true}:{})};
}

function renderRoomRoles(governance={}){
  const ids=[...document.querySelectorAll('#room-agent-options input:checked')].map(node=>node.value);
  const members=workspace.agents.filter(agent=>ids.includes(agent.id));
  $('#room-role-settings').hidden=!$('#room-governance').checked;
  $('#room-facilitator').innerHTML='<option value="">No facilitator</option>'+members.map(agent=>`<option value="${esc(agent.id)}">${esc(agent.customization?.name||defaults.name)}</option>`).join('');
  $('#room-facilitator').value=governance.facilitatorId||'';
  $('#room-role-options').innerHTML=members.map((agent,index)=>{
    const name=agent.customization?.name||defaults.name,observer=governance.observerIds?.includes(agent.id);
    return `<fieldset class="room-role-row"><legend>${esc(name)}</legend><label for="room-role-${index}">Participation for ${esc(name)}</label><select id="room-role-${index}" data-agent="${esc(agent.id)}"><option value="contributor">Contributor</option><option value="observer" ${observer?'selected':''}>Observer</option></select><label class="room-review-choice"><input type="checkbox" value="${esc(agent.id)}" ${governance.reviewerIds?.includes(agent.id)?'checked':''}>Require review from ${esc(name)}</label></fieldset>`;
  }).join('');
  $('#room-owner-approval').checked=!!governance.ownerApproval;
  $('#room-output-options').innerHTML=(governance.outputs||[]).map(output=>roomOutputRow(output,members)).join('');
  updateRoomRoleAvailability();
}

function roomOutputRow(output,members){return `<div class="room-output-row" data-output-id="${esc(output.id)}"><label>Output title<input maxlength="120" required value="${esc(output.title)}"></label><label>Responsible agent<select data-output-agent><option value="">Choose contributor</option>${members.map(agent=>`<option value="${esc(agent.id)}" ${agent.id===output.agentId?'selected':''}>${esc(agent.customization?.name||defaults.name)}</option>`).join('')}</select></label><label>Output kind<select data-output-kind><option value="document">Document</option><option value="evidence" ${output.kind==='evidence'?'selected':''}>Evidence</option></select></label><button type="button" class="text-button" data-output-remove>Remove output</button></div>`;}

function updateRoomRoleAvailability(){
  const {observerIds}=roomRoleValues();
  for(const input of document.querySelectorAll('#room-role-options input')){input.disabled=observerIds.includes(input.value);if(input.disabled)input.checked=false;}
  for(const option of $('#room-facilitator').options)option.disabled=observerIds.includes(option.value);
  if(observerIds.includes($('#room-facilitator').value))$('#room-facilitator').value='';
}

function positionBubbles() {
  if ($('#agent-dock').hidden) return;
  const offsets = [[0,0],[100,48],[12,136],[112,180],[38,266]];
  [...$('#agent-dock').children].forEach((bubble,index) => {
    if (drag?.bubble === bubble) return;
    const [dx,dy] = offsets[index], saved = bubblePositions[bubble.dataset.bubble];
    const width = bubble.offsetWidth, height = bubble.offsetHeight;
    placeBubble(bubble,saved ? saved.x*(innerWidth-width) : innerWidth-width-24-dx, saved ? saved.y*(innerHeight-height) : innerHeight-height-24-dy);
  });
}

function placeBubble(bubble,x,y) {
  bubble.style.left = `${Math.max(8,Math.min(x,innerWidth-bubble.offsetWidth-8))}px`;
  bubble.style.top = `${Math.max(8,Math.min(y,innerHeight-bubble.offsetHeight-8))}px`;
}

function saveBubblePosition(bubble) {
  bubblePositions[bubble.dataset.bubble] = {x:parseFloat(bubble.style.left)/Math.max(1,innerWidth-bubble.offsetWidth),y:parseFloat(bubble.style.top)/Math.max(1,innerHeight-bubble.offsetHeight)};
  localStorage.setItem(storageKey('odwyn-bubble-positions'),JSON.stringify(bubblePositions));
}

$('#agent-dock').addEventListener('pointerdown',event => {
  const button = event.target.closest('.bubble-restore');
  if (!button || event.button !== 0 || !event.isPrimary || busy || switching) return;
  suppressBubbleClick = null;
  const bubble = button.closest('.agent-slot'), box = bubble.getBoundingClientRect();
  drag = {button,bubble,pointerId:event.pointerId,x:event.clientX,y:event.clientY,left:box.x,top:box.y,moved:false};
  button.setPointerCapture(event.pointerId);
});
$('#agent-dock').addEventListener('pointermove',event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX-drag.x, dy = event.clientY-drag.y;
  if (!drag.moved && Math.hypot(dx,dy)<5) return;
  drag.moved = true; drag.bubble.classList.add('dragging');
  placeBubble(drag.bubble,drag.left+dx,drag.top+dy);
});
function endBubbleDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (drag.moved) { saveBubblePosition(drag.bubble); suppressBubbleClick = event.type === 'pointerup' ? drag.button.dataset.agent : null; }
  drag.bubble.classList.remove('dragging'); drag = null;
  requestAnimationFrame(() => renderDock());
}
$('#agent-dock').addEventListener('pointerup',endBubbleDrag);
$('#agent-dock').addEventListener('pointercancel',endBubbleDrag);
$('#agent-dock').addEventListener('click',event => {
  if (event.detail > 0 && suppressBubbleClick && event.target.closest('[data-agent]')?.dataset.agent === suppressBubbleClick) { event.preventDefault(); event.stopPropagation(); suppressBubbleClick = null; }
});
$('#agent-dock').addEventListener('keydown',event => {
  const button = event.target.closest('.bubble-restore'), moves = {ArrowLeft:[-24,0],ArrowRight:[24,0],ArrowUp:[0,-24],ArrowDown:[0,24]};
  if (!button || !event.altKey || !moves[event.key]) return;
  event.preventDefault(); const bubble = button.closest('.agent-slot'), [dx,dy] = moves[event.key];
  placeBubble(bubble,parseFloat(bubble.style.left)+dx,parseFloat(bubble.style.top)+dy); saveBubblePosition(bubble);
});
addEventListener('resize',positionBubbles);

async function animateAgent(id, restoring) {
  if (!id || state.appearance?.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const panel = $('#agent-workspace'), slot = document.querySelector(`#agent-dock [data-bubble="${id}"]`);
  if (!slot) return;
  const box = panel.getBoundingClientRect(), target = slot.getBoundingClientRect();
  if (!target.width) {
    if (restoring) await panel.animate([{opacity:.6,transform:'translateY(5px)'},{opacity:1,transform:'none'}],{duration:120,easing:'ease-out'}).finished;
    return;
  }
  const small = { transform:`translate(${target.x-box.x}px,${target.y-box.y}px) scale(${target.width/box.width},${target.height/box.height})`, opacity:0 };
  const full = { transform:'none', opacity:1 };
  await panel.animate(restoring ? [small,full] : [full,small], { duration:200, easing:restoring ? 'cubic-bezier(.2,.8,.2,1)' : 'ease-in' }).finished;
}

async function switchAgent(nextId, { closing = false, sharedChat = null, keepDraft = false } = {}) {
  if (!workspace || nextId === agentId || switching || busy || nextId && !workspace.agents.some(a => a.id === nextId)) return;
  if (nextId) closedAgents.delete(nextId);
  if (closing && agentId) closedAgents.add(agentId);
  localStorage.setItem(storageKey('odwyn-closed-agents'),JSON.stringify([...closedAgents]));
  switching = true; transitionAgentId = agentId; renderDock();
  const panel = $('#agent-workspace'); panel.inert = true;
  try {
    saveDraft();
    const currentDraft = drafts.get(agentId);
    await animateAgent(agentId,false);
    agentId = nextId; localStorage.setItem(storageKey('odwyn-agent'),nextId || 'minimized');
    transitionAgentId = nextId;
    if (sharedChat || keepDraft) {
      const previous = keepDraft ? currentDraft : drafts.get(nextId);
      drafts.set(nextId,{...previous,view:'chat',conversationId:sharedChat,...(keepDraft || previous?.conversationId === sharedChat ? {} : {prompt:'',attachments:[],mode:'confirm',height:''})});
      sessionStorage.setItem(storageKey('odwyn-drafts'),JSON.stringify([...drafts]));
    }
    selectState(); const draft = restoreDraft();
    signature = ''; render(); setNavigation(false);
    $('#view').scrollTo({top:draft?.scroll || 0,behavior:'instant'}); panel.scrollTo({top:draft?.mainScroll || 0,behavior:'instant'});
    history.replaceState(null,'',view === 'chat' && conversationId ? `#chat/${conversationId}` : `#${view}`);
    await animateAgent(agentId,true);
    $('#agent-announcement').textContent = agentId ? `${state.customization?.name || 'Odwyn'} restored` : closing ? 'Conversation closed. Available in history.' : 'All agents minimized';
  } finally { switching = false; transitionAgentId = null; panel.inert = false; renderDock(); renderRooms(); }
  if (agentId && view === 'chat') $('#prompt').focus();
  else document.querySelector('.bubble-restore')?.focus();
}

function closeAgent(id) {
  if (busy || switching) return;
  if (id === agentId) { void switchAgent(null,{closing:true}); return; }
  closedAgents.add(id); localStorage.setItem(storageKey('odwyn-closed-agents'),JSON.stringify([...closedAgents])); signature = ''; render();
  $('#agent-announcement').textContent = 'Conversation closed. Available in history.';
}

function saveDraft() {
  if (!agentId) return;
  drafts.set(agentId, { view, conversationId, filter, prompt:$('#prompt').value, height:$('#prompt').style.height, attachments, mode:$('#interaction-mode').value, scroll:$('#view').scrollTop, mainScroll:$('#agent-workspace').scrollTop, paused:document.body.classList.contains('mascot-paused') });
  sessionStorage.setItem(storageKey('odwyn-drafts'),JSON.stringify([...drafts]));
}
addEventListener('pagehide',saveDraft);
addEventListener('workspace-deleted',event=>{if(event.detail===workspaceId)agentId=null;});

function restoreDraft() {
  const draft = drafts.get(agentId);
  view = draft?.view || 'chat'; conversationId = draft?.conversationId || null; filter = draft?.filter || 'all'; attachments = draft?.attachments || [];
  $('#prompt').value = draft?.prompt || ''; $('#prompt').style.height = draft?.height || '';
  $('#interaction-mode').value = draft?.mode || 'confirm'; renderAttachments();
  document.body.classList.toggle('mascot-paused',!!draft?.paused);
  return draft;
}

function renderAttachments() {
  $('#attachments').setAttribute('aria-busy',String(pendingAttachments.length > 0));
  $('#attachments').innerHTML = [...attachments,...pendingAttachments].map(file => {
    const image = file.mimeType?.startsWith('image/');
    const type = file.name.includes('.') ? file.name.split('.').at(-1).toUpperCase() : image ? file.mimeType.split('/')[1].toUpperCase() : 'FILE';
    const size = file.size ? (file.size < 1024 * 1024 ? `${Math.ceil(file.size / 1024)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`) : '';
    const thumbnail = file.uploading ? `<span class="attachment-loading" role="status" aria-label="Uploading ${esc(file.name)}">Uploading…</span>` : image ? `<img src="${esc(workspaceUrl(`/api/files/${file.id}/preview`))}" alt="Preview of ${esc(file.name)}">` : `<span class="attachment-file-icon">${icon('paperclip')}</span>`;
    const content = `${thumbnail}<span class="attachment-info"><strong title="${esc(file.name)}">${esc(file.name)}</strong><small>${file.uploading ? 'Uploading' : esc([type,size].filter(Boolean).join(' · '))}</small></span>`;
    return `<div class="attachment-chip">${image && !file.uploading ? `<button type="button" class="attachment-preview" data-preview-file="${esc(file.id)}" aria-label="Preview ${esc(file.name)}">${content}</button>` : `<div class="attachment-preview">${content}</div>`}${file.uploading ? '' : `<button type="button" class="attachment-remove" data-remove-attachment="${esc(file.id)}" aria-label="Remove ${esc(file.name)}">${icon('close')}</button>`}</div>`;
  }).join('');
}
function setNavigation(open) {
  if (open && $('#search-dialog').open) { $('#search-input').focus(); return; }
  for (const id of ['search-dialog','agents-dialog','tools-dialog']) {
    if ($('#'+id).open) $('#'+id).close();
  }
  if (open) { $('#search-dialog').showModal(); search(); $('#search-input').focus(); }
}
for (const [buttonId, dialogId] of [['menu-button','search-dialog'],['agents-open','agents-dialog'],['tools-open','tools-dialog']]) {
  $('#'+dialogId).addEventListener('close', () => $('#'+buttonId).setAttribute('aria-expanded','false'));
  $('#'+buttonId).setAttribute('aria-expanded','false');
}

function navigate(next = 'chat', id = null) {
  if (switching) return;
  if (next === 'home') id = conversationId;
  const chat = workspace.conversations.find(c => c.id === id), owner = chat?.lastAgentId || chat?.agentId;
  if (!['home','audit'].includes(next) && (owner && id !== conversationId && owner !== agentId || !agentId)) { void switchAgent(owner || workspace.agents[0].id,{sharedChat:id}).then(() => { if (agentId) navigate(next,id); }); return; }
  view = next; if (next === 'chat') conversationId = id; signature = ''; render();
  $('#agent-workspace').scrollTop = 0;
  setNavigation(false);
  if (view === 'chat') $('#prompt').focus();
  history.replaceState(null, '', view === 'home' ? '#home' : id ? `#chat/${id}` : `#${view}`);
  if (view === 'home') $('#view').scrollTop = 0;
}

function render() {
  if (!state) return;
  visitTutorial(view);
  renderDock();
  const roster = renderAgentRoster(workspace,view === 'chat' ? agentId : null);
  if (roster !== rosterSignature) {
    const focused = $('#agent-roster').contains(document.activeElement) ? document.activeElement.dataset.agent : null;
    $('#agent-roster').innerHTML = roster; rosterSignature = roster;
    if (focused) $('#agent-roster').querySelector(`[data-agent="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
  }
  document.documentElement.dataset.screen = view;
  positionWorkspacePicker();
  applyProfile(agentId ? state.customization : null,state.appearance,state.owner);
  $('#composer-area').setAttribute('aria-label','Message your assistant');
  renderRooms();
  $('.connection').classList.toggle('connected', !!workspace.globalRuntime.account);
  const providerName = providers[workspace.globalProvider.type][0], globalRuntime = workspace.globalRuntime;
  $('#connection-label').textContent = globalRuntime.account ? `${providerName} ready` : `Connect ${providerName}`;
  $('#connection-button').setAttribute('aria-label',$('#connection-label').textContent);
  $('#connection-button').title = globalRuntime.connectionError || `${providerName} · ${workspace.globalProvider.model}`;

  $('#run-status').hidden = !state.jobs.some(job => activeStatuses.includes(job.status));
  const conversation = state.conversations.find(c => c.id === conversationId);
  const permissionJob = state.jobs.find(job=>job.conversationId === conversationId && job.id === state.runtime.activeJobId) || state.jobs.find(job=>job.conversationId === conversationId && job.status === 'queued');
  if (permissionJob && !$('#interaction-mode').disabled) $('#interaction-mode').value = permissionJob.interactionMode;
  $('#prompt').placeholder = conversation?.kind === 'room' ? 'Message the room, or @mention an agent…' : conversation ? 'Reply or ask a follow-up…' : 'Describe a task or ask a question…';
  $('#main').classList.toggle('chat-start', view === 'chat' && !conversation);
  $('#agent-workspace').classList.toggle('chat-start', view === 'chat' && !conversation);
  $('#page-title').textContent = view === 'chat' ? conversation?.title || 'New conversation' : { home:'Home', audit:'Audit log', runs:'Task runs', routines:'Routines', files:'Files & results', workflows:'Workflows', skills:'Skills', knowledge:'Knowledge' }[view];
  $('#agent-name').textContent = view === 'home' ? 'Odwyn' : state.customization?.name || defaults.name;
  $('#page-title').disabled = view !== 'chat' || !conversation;
  $('#page-title').title = conversation && view === 'chat' ? 'Rename conversation' : '';
  $('#page-title').setAttribute('aria-label',conversation && view === 'chat' ? `Rename conversation: ${conversation.title}` : $('#page-title').textContent);
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active',button.dataset.view === view));
  const chats = recentConversations(state).filter(c=>c.kind !== 'room');
  $('#history').innerHTML = chats.length ? chats.map(c => {
    const job = state.jobs.find(job => job.conversationId === c.id);
    return `<button class="history-item ${c.id === conversationId && view === 'chat' ? 'selected' : ''}" data-conversation="${esc(c.id)}"><span class="history-bullet ${job?.status === 'running' ? 'running' : ''}"></span><span>${esc(c.title)}</span>${job?.status === 'waiting' ? '<span class="needs-you-dot" title="Needs your input">!</span>' : ''}</button>`;
  }).join('') : '<p class="sidebar-empty">No conversations yet.</p>';
  $('#menu-button').classList.toggle('active',view === 'chat');
  $('#tools-open').classList.toggle('active',['audit','routines','workflows','skills','knowledge','files','runs'].includes(view));
  if ($('#search-dialog').open) search();
  if (!agentId && !['home','audit'].includes(view)) {
    $('#agent-workspace').classList.remove('chat-start'); $('#main').classList.remove('chat-start'); $('#composer-area').hidden = true;
    $('#page-title').textContent = 'No conversation open';
    if (signature !== 'minimized') $('#view').innerHTML = `<div class="agents-empty"><h1>${workspace.agents.every(a => closedAgents.has(a.id)) ? 'No conversation open' : 'Your agents are minimized'}</h1><p>Choose an agent from Agents or restore a floating bubble. Your conversations stay in history.</p></div>`;
    signature = 'minimized';
    updateBrowser(state); return;
  }
  $('#composer-area').hidden = view !== 'chat';
  const nextSignature = view==='audit'?'audit':JSON.stringify({ view, conversationId, filter, customization:state.customization, owner:state.owner, mentions:[state.agents.map(a=>[a.id,a.customization]),state.skills,state.workflows.map(w=>w.command)], data: view === 'knowledge' ? state.knowledge : view === 'home' ? [workspace.conversations,workspace.jobs,workspace.agents.map(agent=>[agent.id,!!agent.runtime?.account]),$('#prompt').value,attachments] : view === 'chat' ? [conversation || state.conversations, state.jobs.filter(j => !conversation || j.conversationId === conversationId), !!state.runtime.account] : view === 'runs' ? state.jobs : view === 'routines' ? [state.schedules,state.jobs] : ['workflows','skills'].includes(view) ? [state.workflows,state.skills,state.workflowRuns,state.jobs] : state.files });
  if (signature !== nextSignature) {
    const nearBottom = $('#view').scrollHeight - $('#view').scrollTop - $('#view').clientHeight < 100;
    const previousScroll = $('#view').scrollTop;
    const libraryFocus = document.activeElement?.dataset.librarySearch ? {key:document.activeElement.dataset.librarySearch,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd} : null;
    const homeFocus = view === 'home' && $('#view').contains(document.activeElement) ? document.activeElement.closest('[data-conversation],[data-agent]') : null;
    const disclosures=[...$('#view').querySelectorAll('[data-room-disclosure]')].map(node=>({key:node.dataset.roomDisclosure,open:node.open,focused:node.querySelector('summary')===document.activeElement}));
    const pendingCards=[...document.querySelectorAll('#view .approval-card[data-request],#view form[data-room-owner]')].map(node=>({node,focus:node.contains(document.activeElement)?document.activeElement:null}));
    $('#view').innerHTML = view === 'knowledge' ? renderKnowledge(state) : view === 'audit' ? renderAudit() : view === 'home' ? renderHome(workspace,{conversationId,hasDraft:!!$('#prompt').value.trim() || attachments.length > 0}) : view === 'chat' ? renderChat(state, conversationId) : view === 'runs' ? renderRuns(state,filter) : view === 'routines' ? renderRoutines(state,filter) : ['workflows','skills'].includes(view) ? renderWorkflows(state,view) : renderFiles(state);
    for(const saved of disclosures){const node=$('#view').querySelector(`[data-room-disclosure="${CSS.escape(saved.key)}"]`);if(node){node.open=saved.open;if(saved.focused)node.querySelector('summary').focus({preventScroll:true});}}
    if (libraryFocus) { const input=$('#view').querySelector(`[data-library-search="${libraryFocus.key}"]`); input?.focus({preventScroll:true}); if(input && libraryFocus.start!==null)input.setSelectionRange(libraryFocus.start,libraryFocus.end); }
    if (homeFocus) { const key = homeFocus.dataset.conversation ? 'conversation' : 'agent'; $('#view').querySelector(`[data-${key}="${CSS.escape(homeFocus.dataset[key])}"]`)?.focus({preventScroll:true}); }
    for(const {node,focus} of pendingCards){const selector=node.dataset.request?`[data-request="${CSS.escape(node.dataset.request)}"]`:`form[data-room-owner="${CSS.escape(node.dataset.roomOwner)}"][data-proposal="${CSS.escape(node.dataset.proposal)}"]`;const next=$('#view').querySelector(selector);if(next){next.replaceWith(node);focus?.focus({preventScroll:true});}}
    if (view === 'chat') insertMessages(state,conversationId);
    updateBrowser(state);
    $('#view').scrollTop = view !== 'home' && nearBottom ? $('#view').scrollHeight : previousScroll;
    signature = nextSignature;
  } else updateBrowser(state);
  renderActivity(state,conversationId);
  updateComposerSend();
  if (providerGlobal ? $('#settings-dialog').open : $('#customize-dialog').open && providerAgentId === state.agentId) updateAccount();
}

function updateComposerSend(){
  if(!state)return;
  const disabled=state.jobs.some(job=>job.conversationId===conversationId&&activeStatuses.includes(job.status)),room=currentRoom();
  $('#send-button').disabled=busy||disabled&&!room||!$('#prompt').value.trim()&&!attachments.length;
  $('#send-button').title=disabled?room?'Stop current discussion and send this direction':'Finish or stop the active run before a follow-up.':'Send message (Enter)';
}

async function refresh() {
  try {
    const response = await fetch(workspaceUrl(`/api/state${state ? `?revision=${state.revision}` : ''}`));
    if (response.status === 204) return;
    if (!response.ok) throw new Error('Connection lost. Reload to sign in.');
    workspace = await response.json();
    if (agentId === 'minimized') agentId = null;
    else if (agentId !== null && !workspace.agents.some(a => a.id === agentId) || !state && agentId === null && localStorage.getItem(storageKey('odwyn-agent')) !== 'minimized') agentId = workspace.agents[0].id;
    selectState(); render();
  } catch (error) { $('#connection-label').textContent = 'Reconnecting…'; $('.connection').classList.remove('connected'); if (!state) handleError(error); }
}

async function perform(fn) { try { await fn(); await refresh(); } catch (error) { handleError(error); } }
function openSchedule(id = null) {
  const schedule=state.schedules.find(s=>s.id===id);
  $('#schedule-form').dataset.scheduleId=schedule?.id || '';
  $('#schedule-dialog h2').textContent=schedule ? 'Edit routine' : 'Schedule a task';
  $('#schedule-form button').innerHTML=(schedule ? 'Save' : 'Set routine')+icon('arrow-up-right');
  const room=currentRoom(), members=workspace.agents;
  $('#schedule-agent').innerHTML=members.map(a=>`<option value="${esc(a.id)}">${esc(a.customization?.name || defaults.name)}</option>`).join('');
  $('#schedule-agent').value=room && room.memberIds.includes($('#reply-agent').value) ? $('#reply-agent').value : members.find(a=>a.id===agentId)?.id || members[0]?.id;
  $('#schedule-call').innerHTML='<option value="">Task</option>'+[['Skills',workspace.skills],['Workflows',workspace.workflows]].map(([label,items])=>`<optgroup label="${label}">${items.map(item=>`<option value="${esc(item.command)}">/${esc(item.command)} · ${esc(item.name)}</option>`).join('')}</optgroup>`).join('');
  if (schedule) $('#schedule-agent').value=schedule.agentId;
  const match=schedule?.prompt.match(/^[/$](\S+)(?:\s+([\s\S]*))?$/);
  const command=match && [...workspace.skills,...workspace.workflows].find(item=>item.command===match[1]);
  $('#schedule-call').value=command?.command || '';
  $('#schedule-prompt').value = command ? match[2] || '' : schedule?.prompt || $('#prompt').value;
  updateScheduleCall();
  if (command && workspace.workflows.some(w=>w.command===command.command)) {
    const workflow=workspace.workflows.find(w=>w.command===command.command), argument=(match[2] || '').trim();
    const inputs=argument.startsWith('{') ? JSON.parse(argument) : {[workflow.inputs[0]?.name || 'args']:argument};
    for (const input of $('#schedule-inputs').querySelectorAll('input')) input.value=inputs[input.name] ?? input.value;
  }
  const interval=schedule?.intervalMinutes ?? 1440;
  $('#schedule-interval').value=[0,60,1440,10080].includes(interval) ? String(interval) : 'custom';
  $('#schedule-repeat-unit').value='1'; $('#schedule-repeat-count').value=interval || 15;
  updateScheduleRepeat();
  const soon = schedule && new Date(schedule.nextAt) > new Date() ? new Date(schedule.nextAt) : new Date(Date.now() + 60 * 60_000); const local = new Date(soon.valueOf() - soon.getTimezoneOffset() * 60_000);
  $('#schedule-at').value = local.toISOString().slice(0,16); $('#schedule-status').textContent = ''; $('#schedule-dialog').showModal();
}
function updateScheduleCall() {
  const command=$('#schedule-call').value, workflow=workspace.workflows.find(w=>w.command===command), skill=workspace.skills.find(s=>s.command===command);
  $('#schedule-task-field').hidden=!!workflow;
  $('#schedule-prompt').required=!command;
  $('#schedule-prompt-label').textContent=skill ? 'Instructions or arguments (optional)' : 'What needs doing?';
  $('#schedule-call-hint').textContent=workflow ? `${workflow.description || ''} Workflow steps use their assigned agents, or the selected agent.` : skill?.description || 'Enter a task, or a /skill or /workflow command.';
  $('#schedule-inputs').innerHTML=workflow ? workflow.inputs.map(f=>`<label>${esc(f.label || f.name)}<input name="${esc(f.name)}" value="${esc(f.default ?? '')}" ${f.required ? 'required':''}></label>`).join('') : '';
}
$('#schedule-call').onchange=updateScheduleCall;
function updateScheduleRepeat() {
  const custom=$('#schedule-interval').value === 'custom', count=$('#schedule-repeat-count'), unit=Number($('#schedule-repeat-unit').value);
  $('#schedule-custom-repeat').hidden=!custom;
  count.disabled=!custom;
  count.min=Math.ceil(15/unit);
  count.max=Math.floor(525600/unit);
}
$('#schedule-interval').onchange=updateScheduleRepeat;
$('#schedule-repeat-unit').onchange=updateScheduleRepeat;
let providerOddy=false, oddyProviderState=null, providerSelection=0;
const selectedProvider=()=>providerOddy?oddyProviderState.provider:providerGlobal?workspace.globalProvider:state.provider;
const selectedConnection=()=>providerOddy?oddyProviderState.runtime:providerGlobal?workspace.globalRuntime:state.runtime;
async function providerApi(path,body,method){
  const result=await api(providerOddy?path.replace('/api/','/api/oddy/'):path,body,method);
  if(providerOddy && !path.startsWith('/api/provider/models')){oddyProviderState=await api('/api/oddy/provider');updateAccount();}
  return result;
}
$('#settings-provider-target').onchange=async()=>{
  const selection=++providerSelection, oddy=$('#settings-provider-target').value==='oddy';
  const save=$('#preferences-form > .form-footer button.primary-button');save.disabled=true;
  $('#provider-editor').hidden=true;
  try{
    if(oddy)oddyProviderState=await api('/api/oddy/provider');
    if(selection!==providerSelection)return;
    providerOddy=oddy;
    $('#oddy-provider-inherit-row').hidden=!oddy;
    $('#oddy-provider-inherit').checked=!!oddyProviderState?.inherit;
    $('#provider-editor').hidden=false;fillProvider(selectedProvider());oddyProviderSource();
  }catch(error){if(selection===providerSelection){$('#settings-provider-target').value=providerOddy?'oddy':'workspace';$('#provider-editor').hidden=false;oddyProviderSource();handleError(error);}}
  finally{if(selection===providerSelection)save.disabled=false;}
};
function oddyProviderSource(){if(providerOddy)$('#provider-editor').hidden=$('#oddy-provider-inherit').checked;}
$('#oddy-provider-inherit').onchange=oddyProviderSource;
function updateAccount() {
  const connection = selectedConnection();
  const account = connection.account;
  const type = selectedProvider().type;
  $('#account-title').textContent = providers[type][0];
  $('#account-description').textContent = connection.connectionError || (type === 'claude' ? (account ? `Signed in${account.email ? ` as ${account.email}` : ''}.` : 'Connect your Claude account to start working.') : type === 'antigravity' ? 'Uses your signed-in Antigravity subscription on this server. Run agy to sign in, set AI Credit Overages to Never, then Refresh.' : type === 'openai' ? 'Requests use your configured API URL and model. Provider API billing applies.' : account?.email || 'Connect your ChatGPT account to start working.');
  $('#connect-account').textContent = account || ['openai','antigravity'].includes(type) ? 'Refresh' : 'Connect';
  const usage=connection.usage, usagePanel=$('#provider-usage');
  usagePanel.hidden=type === 'openai';
  const limits=(usage?.limits || []).map(limit=>{
    const minutes=limit.windowMinutes, window=minutes ? (minutes%1440 === 0 ? `${minutes/1440}-day` : minutes%60 === 0 ? `${minutes/60}-hour` : `${minutes}-minute`) : '';
    const label=[limit.name,window].filter(Boolean).join(' · '), percent=Number.isFinite(limit.usedPercent) ? limit.usedPercent : null;
    const status={allowed:'Available',allowed_warning:'Near limit',rejected:'Limit reached'}[limit.status] || '';
    const reset=Number.isFinite(limit.resetsAt) ? ` · Resets ${date(new Date(limit.resetsAt*1000).toISOString())}` : '';
    return `<p><strong>${esc(label)}</strong><br>${percent === null ? 'Usage percentage unavailable' : `${esc(Math.round(percent*10)/10)}% used`}${status ? ` · ${esc(status)}` : ''}${esc(reset)}</p>${percent === null ? '' : `<meter min="0" max="100" value="${Math.max(0,Math.min(100,percent))}" aria-label="${esc(label)} usage"></meter>`}`;
  }).join('');
  const lastRun=usage?.lastRun;
  usagePanel.innerHTML=`<strong>Usage & limits</strong>${account ? `${limits || `<p>${type === 'claude' ? 'No limits reported yet. Updates arrive during tasks.' : 'Usage limits unavailable from this provider.'}</p>`}${lastRun && Number.isFinite(lastRun.inputTokens) && Number.isFinite(lastRun.outputTokens) ? `<p>Last task: ${esc(lastRun.inputTokens.toLocaleString())} input · ${esc(lastRun.outputTokens.toLocaleString())} output tokens</p>` : ''}${connection.usageError ? `<p>${esc(connection.usageError)}</p>` : ''}${usage?.updatedAt ? `<p>Last reported: ${esc(date(usage.updatedAt))}</p>` : ''}` : '<p>Connect to view usage.</p>'}`;
  const login = connection.login;
  $('#login-instructions').hidden = !login || $('#provider-account-box').hidden;
  if (login?.verificationUrl) {
    const node = $('#login-instructions');
    if (node.dataset.loginId === login.loginId) return;
    node.dataset.loginId = login.loginId; node.replaceChildren();
    const p = document.createElement('p'); p.textContent = login.manual ? 'Open Claude sign-in, then paste the code shown after authorization.' : 'Open the sign-in page and enter this one-time code:';
    const link = document.createElement('a'); link.textContent = `Open ${login.manual ? 'Claude' : 'ChatGPT'} sign-in ↗`; link.href = login.verificationUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; node.append(p,link);
    if (login.manual) {
      const label = document.createElement('label'); label.htmlFor = 'provider-login-code'; label.textContent = 'Sign-in code';
      const input = document.createElement('input'); input.id = 'provider-login-code'; input.type = 'password'; input.autocomplete = 'off'; input.maxLength = 4000;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = 'Complete sign-in';
      input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); button.click(); } };
      const status = document.createElement('p'); status.setAttribute('role','status');
      button.onclick = async () => {
        button.disabled = true; status.textContent = 'Connecting…';
        try { await providerApi(`/api/account/login/complete?${providerGlobal ? 'scope=global' : `agentId=${providerAgentId}`}`,{code:input.value}); input.value = ''; await refresh(); }
        catch (error) { status.textContent = error.message; }
        finally { button.disabled = false; }
      };
      node.append(label,input,button,status);
    } else { const code = document.createElement('code'); code.textContent = login.userCode; node.insertBefore(code,link); }
  } else { delete $('#login-instructions').dataset.loginId; if (login?.error) $('#login-instructions').textContent = login.error; }
}
function providerFields() {
  const type = $('#provider-type').value, isAPI = type === 'openai';
  const needsSave = providerAdding || type !== selectedProvider().type;
  $('#provider-account-box').hidden = needsSave; $('#provider-save-hint').hidden = !needsSave;
  if (needsSave) $('#login-instructions').hidden = true;
  const selected=$('#provider-effort').value || 'default';
  $('#provider-effort').innerHTML=effortLevels[type].map(value=>`<option value="${value}">${value==='default' ? 'Model default' : value==='xhigh' ? 'Extra high' : value==='max' ? 'Maximum' : value[0].toUpperCase()+value.slice(1)}</option>`).join('');
  $('#provider-effort').value=effortLevels[type].includes(selected) ? selected : 'default';
  $('#provider-api-fields').hidden = !isAPI;
  $('#provider-base-url').disabled = $('#provider-api-key').disabled = !isAPI;
  $('#provider-base-url').required = isAPI;
  $('#provider-hint').textContent = type === 'antigravity' ? 'Uses your Antigravity subscription via agy. Set AI Credit Overages to Never. Use default, or a model slug from agy models.' : type === 'claude' ? 'Uses Claude Code on this server with your Claude account. Connect below after saving.' : isAPI ? 'Use a base URL such as https://api.openai.com/v1. Model must support tool calling; screenshots need vision.' : 'Uses Codex App Server with your ChatGPT subscription. Connect below after saving.';
}
let workspaceSetup = false;
function openSettings(onboarding = false) {
  workspaceSetup = onboarding === true;
  $('#settings-title').textContent = workspaceSetup ? 'Set up your workspace' : 'Odwyn settings';
  $('#preferences-form > .form-footer button.primary-button').innerHTML = workspaceSetup ? `Continue to first agent${icon('arrow-up-right')}` : `Save${icon('check')}`;
  providerGlobal = true; providerAdding = false; providerOddy=false; providerSelection++; $('#preferences-form > .form-footer button.primary-button').disabled=false; $('#settings-provider-target').value='workspace'; $('#oddy-provider-inherit-row').hidden=true;
  $('#settings-provider-editor').append($('#provider-editor'));
  $('#provider-editor').hidden = false;
  $('#provider-form').querySelectorAll('input,select').forEach(field => field.disabled = false);
  fillProvider(workspace.globalProvider);
  fillWorkspaceAppearance(workspace.appearance);
  for (const key of ownerPreferenceKeys) $(`#global-${key}`).value = workspace.owner?.[key] ?? defaults[key];
  $('#preferred-currency').value = workspace.currency || 'source';
  $('#preferences').value = workspace.preferences || ''; $('#settings-status').textContent = '';
  $('#settings-dialog').dispatchEvent(new CustomEvent('settings-open'));
  $('#settings-dialog').showModal();
}
function openAgentProvider() {
  openCustomization(false,false,false,true);
}
function fillProvider(config) {
  $('#provider-status').textContent = '';
  $('#provider-type').value = config.type; $('#provider-model').value = config.model;
  $('#provider-base-url').value = config.baseUrl; $('#provider-api-key').value = '';
  $('#provider-api-key').placeholder = config.hasApiKey ? 'Saved key — leave blank to keep' : 'Optional for local models';
  providerFields(); $('#provider-effort').value = config.effort || 'default'; updateAccount(); void loadProviderModels();
}
let modelRequest = 0;
async function loadProviderModels() {
  const request = ++modelRequest, input = providerInput(), list = $('#provider-model-list');
  list.hidden = true; list.replaceChildren(); $('#provider-model').hidden = false;
  $('#provider-model-label').htmlFor = 'provider-model';
  $('#provider-model-hint').textContent = 'Loading available models…';
  try {
    const {models} = await providerApi(`/api/provider/models?${providerGlobal ? 'scope=global' : `agentId=${providerAgentId || state.agentId}`}`,input);
    if (request !== modelRequest) return;
    if (!models.length) throw new Error('No models returned.');
    list.innerHTML = models.map(model => `<option value="${esc(model.id)}">${esc(model.name)}</option>`).join('') + '<option value="">Enter model manually…</option>';
    list.value = models.some(model => model.id === $('#provider-model').value) ? $('#provider-model').value : '';
    list.hidden = false; $('#provider-model').hidden = !!list.value;
    $('#provider-model-label').htmlFor = 'provider-model-list';
    $('#provider-model-hint').textContent = 'Choose a model, or enter one manually.';
  } catch {
    if (request === modelRequest) $('#provider-model-hint').textContent = 'Model list unavailable. Enter a model name manually.';
  }
}
$('#provider-model-list').onchange = () => {
  const value = $('#provider-model-list').value;
  $('#provider-model').hidden = !!value;
  if (value) $('#provider-model').value = value;
  else $('#provider-model').focus();
};
$('#provider-base-url').onchange = $('#provider-api-key').onchange = () => { void loadProviderModels(); };
function providerSource() {
  const inherited = $('#provider-source').value === 'global';
  $('#provider-editor').hidden = inherited;
  $('#provider-inherit-hint').hidden = !inherited;
  $('#provider-inherit-hint').textContent = `${providers[workspace.globalProvider.type][0]} · ${workspace.globalProvider.model}. Change the workspace provider in Odwyn Settings.`;
  $('#provider-form').querySelectorAll('input,select').forEach(field => field.disabled = inherited);
  if (!inherited) providerFields();
}
$('#provider-source').onchange = providerSource;
$('#customize-dialog').addEventListener('customization-open', event => {
  providerOddy=false; providerSelection++; providerGlobal = false; providerAdding = event.detail.adding; providerAgentId = state.agentId;
  $('#agent-provider-editor').append($('#provider-editor'));
  $('#provider-editor').hidden = false;
  $('#provider-form').querySelectorAll('input,select').forEach(field => field.disabled = false);
  fillProvider(event.detail.adding ? workspace.globalProvider : state.provider);
  $('#provider-source').value = !event.detail.adding && workspace.agents.find(agent => agent.id === state.agentId).providerOverride ? 'custom' : 'global';
  providerSource();
});
$('#customize-dialog').addEventListener('close', () => { if (!$('#customize-dialog').open) { providerAgentId = null; } });
$('#provider-type').onchange = () => {
  const config = selectedProvider(), type = $('#provider-type').value;
  $('#provider-model').value = type === config.type ? config.model : providers[type][1];
  providerFields(); $('#provider-effort').value = type === config.type ? config.effort || 'default' : 'default';
  void loadProviderModels();
};
const providerInput = () => ({type:$('#provider-type').value,model:$('#provider-model').value,effort:$('#provider-effort').value,baseUrl:$('#provider-base-url').value,apiKey:$('#provider-api-key').value});
function search() {
  const query = $('#search-input').value.trim().toLowerCase();
  $('.library-browse').hidden = !!query;
  $('#search-results').hidden = !query;
  if (!query) return;
  const found = state?.conversations.filter(c => c.title.toLowerCase().includes(query) || c.messages.some(m => m.text.toLowerCase().includes(query))) || [];
  $('#search-results').innerHTML = found.length ? found.map(c => `<button class="search-result" data-conversation="${esc(c.id)}">${icon('chat')}<span>${esc(c.title)}</span>${icon('arrow-up-right')}</button>`).join('') : '<p class="search-empty">No conversations found. Start a fresh one.</p>';
}

$('#new-chat').onclick = () => navigate();
$('#new-room').onclick = () => openRoomEditor();
$('#new-room-top').onclick = () => openRoomEditor();
$('#room-add-agent').onclick=()=>{$('#room-dialog').close();openCustomization(false,true);};
function openRename() {
  const conversation=workspace.conversations.find(c=>c.id===conversationId); if (!conversation) return;
  renamingConversationId=conversation.id; $('#room-header').close();
  $('#rename-title').textContent=conversation.kind==='room' ? 'Rename room' : 'Rename conversation';
  $('#delete-conversation').childNodes[0].textContent=conversation.kind==='room' ? 'Delete room' : 'Delete conversation';
  $('#conversation-name').value=conversation.title; $('#rename-status').textContent='';
  $('#delete-conversation').disabled=state.jobs.some(j=>j.conversationId===conversation.id && activeStatuses.includes(j.status));
  $('#rename-dialog').showModal(); $('#conversation-name').focus(); $('#conversation-name').select();
}
$('#page-title').onclick = openRename;
$('#rename-room').onclick = openRename;
async function deleteConversation(id) {
  const conversation=workspace.conversations.find(c=>c.id===id);
  if (!conversation || busy) return;
  busy=true; $('#delete-conversation').disabled=$('#delete-room').disabled=true;
  try {
    const plan=await api(`/api/conversations/${id}/deletion`,undefined,'GET');
    const linked=plan.conversations.filter(c=>c.id!==id);
    const dependencies=linked.length?`\n\nLinked rooms and stages will also be deleted:\n${linked.map(c=>`• ${c.title}`).join('\n')}`:'';
    const runs=plan.workflowRunIds.length?`\n${plan.workflowRunIds.length} associated workflow run(s) will also be deleted.`:'';
    if(!confirm(`Delete “${conversation.title}” permanently?${dependencies}${runs}\n\nMessages and task runs will be removed. Agents, saved files and workflow templates are kept.`))return;
    const deleted=await api(`/api/conversations/${id}`,{conversationIds:plan.conversationIds,workflowRunIds:plan.workflowRunIds},'DELETE');
    const ids=new Set(deleted.conversationIds);
    for (const [key,draft] of drafts) if (ids.has(draft.conversationId)) drafts.delete(key);
    sessionStorage.setItem(storageKey('odwyn-drafts'),JSON.stringify([...drafts]));
    for(const deletedId of ids)roomRecipients.delete(deletedId);
    if (ids.has(conversationId)) { $('#prompt').value=''; $('#prompt').style.height=''; attachments=[]; renderAttachments(); }
    $('#rename-dialog').close(); $('#room-header').close();
    await refresh(); navigate(); toast('Conversation and linked stages deleted. Agents and files kept.');
    $('#prompt').focus();
  } catch(error) { handleError(error); }
  finally { busy=false; render(); }
}
$('#delete-conversation').onclick = () => deleteConversation(renamingConversationId);
$('#delete-room').onclick = () => deleteConversation(currentRoom()?.id);
$('#rename-dialog').onclose = () => (currentRoom() ? $('#room-details-open') : $('#page-title')).focus();
$('#rename-form').onsubmit = async event => {
  event.preventDefault(); $('#rename-save').disabled=true;
  try {
    await api(`/api/conversations/${renamingConversationId}`,{title:$('#conversation-name').value},'PATCH');
    $('#rename-dialog').close(); await refresh(); toast('Conversation renamed.');
    (currentRoom() ? $('#room-details-open') : $('#page-title')).focus();
  } catch(error) { $('#rename-status').textContent='';handleError(error); }
  finally { $('#rename-save').disabled=false; }
};
$('#room-details-open').onclick = () => $('#room-header').showModal();
$('#edit-room').onclick = () => openRoomEditor(currentRoom());
$('#room-dialog-close').onclick = () => $('#room-dialog').close();
$('#room-dialog').onclose = () => { saveRoomStage=null; if (editingRoomId && currentRoom()) $('#room-details-open').focus(); };
$('#room-governance').onchange=()=>{$('#room-role-settings').hidden=!$('#room-governance').checked;};
$('#room-agent-options').onchange=()=>renderRoomRoles(roomRoleValues());
$('#room-role-options').onchange=updateRoomRoleAvailability;
$('#room-output-add').onclick=()=>{const members=workspace.agents.filter(agent=>document.querySelector(`#room-agent-options input[value="${CSS.escape(agent.id)}"]`)?.checked);$('#room-output-options').insertAdjacentHTML('beforeend',roomOutputRow({id:crypto.randomUUID(),title:'',agentId:members[0]?.id,kind:'document'},members));};
$('#room-output-options').onclick=event=>{if(event.target.closest('[data-output-remove]'))event.target.closest('.room-output-row').remove();};
$('#room-form').oninput = () => { $('#room-status').textContent = ''; };
$('#room-form').onsubmit = async event => {
  event.preventDefault(); const memberIds = new FormData(event.target).getAll('memberIds');
  if (memberIds.length < 2) { toast('Choose at least two agents.','warning'); return; }
  $('#room-save').disabled = true; $('#room-status').textContent = 'Saving…';
  try {
    const governance=$('#room-governance').checked ? roomRoleValues() : null;
    const config={title:$('#room-name').value,memberIds,governance};
    if(saveRoomStage){saveRoomStage(config);$('#room-dialog').close();toast('Stage updated in the draft. Save the workflow to keep changes.','warning');return;}
    const room = await api(editingRoomId ? `/api/rooms/${editingRoomId}` : '/api/rooms',config,editingRoomId ? 'PATCH' : 'POST');
    $('#room-dialog').close(); await refresh(); navigate('chat',room.id); toast(editingRoomId ? 'Room updated.' : 'Room ready. Send a message to start the discussion.');
  } catch (error) { $('#room-status').textContent = '';handleError(error); }
  finally { $('#room-save').disabled = false; }
};
$('#room-discuss').onclick = () => {
  const room = currentRoom(); if (!room || busy || $('#room-discuss').disabled) return;
  $('#room-header').close();
  roomRecipients.set(room.id,'all'); $('#reply-agent').value = 'all';
  if (!$('#prompt').value.trim()) $('#prompt').value = room.discussion?.direction || room.discussion?.goal || 'Continue toward the shared goal from existing progress. Resolve only remaining issues and finish the requested result.';
  updateComposerSend();
  $('#composer').requestSubmit();
};
$('#add-agent').onclick = () => { setNavigation(false); openCustomization(false,true); };
$('#minimize-agent').onclick = () => { void switchAgent(null); };
$('#close-conversation').onclick = () => closeAgent(agentId);
$('#reply-agent').onchange = () => {
  const room = currentRoom();
  if (room) { roomRecipients.set(room.id,$('#reply-agent').value); render(); }
  else void switchAgent($('#reply-agent').value,{sharedChat:conversationId,keepDraft:true});
};
$('#interaction-mode').onchange = async () => {
  const selector = $('#interaction-mode'), mode = selector.value;
  const jobs = state.jobs.filter(job => job.conversationId === conversationId && ['queued','running','waiting','takeover'].includes(job.status));
  selector.disabled = true;
  try { await perform(async () => { for (const job of jobs) await api(`/api/jobs/${job.id}/permissions`,{interactionMode:mode}); }); }
  finally { selector.disabled = false; render(); }
};
$('#settings-open').onclick = () => openSettings();
$('#schedule-open').onclick = () => openSchedule();
$('#menu-button').onclick = $('#search-open').onclick = () => { setNavigation(true); $('#menu-button').setAttribute('aria-expanded','true'); };
for (const id of ['agents','tools']) $('#'+id+'-open').onclick = () => { setNavigation(false); $('#'+id+'-dialog').showModal(); $('#'+id+'-open').setAttribute('aria-expanded','true'); };
$('#search-input').oninput = search;
$('#image-preview-image').onload = () => { $('#image-preview-status').textContent = ''; };
$('#image-preview-image').onerror = () => { $('#image-preview-image').hidden = true; $('#image-preview-status').textContent = 'Image preview unavailable.'; };
$('#image-preview').onclick = event => { if (event.target === $('#image-preview')) $('#image-preview').close(); };
$('#attach-button').onclick = () => $('#file-input').click();
async function attachFiles(files) {
  if (busy || !files.length) return;
  busy = true; render();
  await perform(async () => {
    if (attachments.length + files.length > 20) throw new Error('Choose up to 20 uploaded files.');
    pendingAttachments = files.map(file=>({name:file.name,mimeType:file.type,size:file.size,uploading:true})); renderAttachments();
    for (const file of files) {
      const form = new FormData(); form.append('file',file);
      const saved = await api('/api/files',form); attachments.push(saved); pendingAttachments.shift(); renderAttachments();
    }
  });
  pendingAttachments = []; renderAttachments();
  busy = false; render();
}
$('#file-input').onchange = async () => {
  await attachFiles(Array.from($('#file-input').files));
  $('#file-input').value = '';
};
$('#composer').onsubmit = async event => {
  event.preventDefault(); const prompt = $('#prompt').value.trim();
  if ((!prompt && !attachments.length) || busy || $('#send-button').disabled) return;
  busy = true; $('#send-button').disabled = true;
  await perform(async () => {
    const room = currentRoom();
    const result = await api(room ? `/api/rooms/${room.id}/messages` : '/api/jobs', { prompt, attachments:attachments.map(file=>file.id), agentId:room ? $('#reply-agent').value : agentId, conversationId, interactionMode:$('#interaction-mode').value });
    $('#prompt').value = ''; $('#prompt').style.height = ''; attachments = []; $('#attachments').replaceChildren(); navigate('chat',room?.id || result.conversationId);
    if (room) { roomRecipients.delete(room.id); $('#reply-agent').value = 'all'; }
  });
  busy = false; render();
};
$('#prompt').onkeydown = event => {
  if(event.isComposing||event.keyCode===229)return;
  if (event.key === 'Enter' && event.altKey) { event.preventDefault(); promptMention()?.click(); }
  else if (event.key === 'ArrowDown' && !$('#room-mentions').hidden) { event.preventDefault(); $('#room-mentions button')?.focus(); }
  else if (event.key === 'Escape') $('#room-mentions').hidden = true;
};
setupChatComposer({form:$('#composer'),input:$('#prompt'),send:$('#send-button'),onInput:()=>{renderMentions();updateComposerSend();},onFiles:attachFiles});
function promptMention(event) {
  const prompt=$('#prompt');if(prompt.selectionStart!==prompt.selectionEnd) return;
  return [...$('#prompt-highlights').querySelectorAll('[data-mention-link]')].find(mention=>event ? [...mention.getClientRects()].some(box=>event.clientX>=box.left && event.clientX<=box.right && event.clientY>=box.top && event.clientY<=box.bottom) : prompt.selectionStart>=Number(mention.dataset.start) && prompt.selectionStart<=Number(mention.dataset.end));
}
$('#prompt').onclick = event => { renderMentions();if(!event.shiftKey)promptMention(event)?.click(); };
$('#prompt').title = 'Click a highlighted mention to open it. Alt + Enter opens the mention at the cursor.';
new ResizeObserver(() => { $('#prompt-highlights').style.width = $('#prompt').clientWidth + 'px'; }).observe($('#prompt'));
$('#prompt').onscroll = () => { $('#prompt-highlights').scrollTop = $('#prompt').scrollTop; $('#prompt-highlights').scrollLeft = $('#prompt').scrollLeft; };
$('#room-mentions').onclick = event => {
  const button = event.target.closest('[data-mention-agent]'); if (!button) return;
  const prompt = $('#prompt'), end = prompt.selectionStart;
  const start = prompt.value.slice(0,end).lastIndexOf('@');
  const name = workspace.agents.find(a=>a.id===button.dataset.mentionAgent)?.customization?.name || defaults.name;
  prompt.setRangeText(`@${/^[\p{L}\p{N}_-]+$/u.test(name) ? name : JSON.stringify(name)} `,start,end,'end');
  prompt.focus(); prompt.dispatchEvent(new Event('input'));
};
$('#preferences-form').onsubmit = async event => {
  event.preventDefault();
  const continueSetup = workspaceSetup, button = $('#preferences-form > .form-footer button.primary-button');
  button.disabled = true; $('#settings-status').textContent = 'Saving…';
  try {
    if(providerOddy) await api('/api/oddy/provider',{inherit:$('#oddy-provider-inherit').checked,provider:providerInput()},'PUT');
    await api('/api/preferences',{ ...Object.fromEntries(ownerPreferenceKeys.map(key=>[key,$(`#global-${key}`).value])), ...(providerOddy?{}:{provider:providerInput()}), text:$('#preferences').value, currency:$('#preferred-currency').value, appearance:readWorkspaceAppearance() },'PUT');
    await refresh(); $('#provider-api-key').value = ''; $('#settings-dialog').close();
    if (continueSetup) openCustomization(true);
    toast('Settings saved. Applies to your next task.');
  } catch (error) { $('#settings-status').textContent = '';handleError(error); }
  finally { button.disabled = false; }
};
$('#connect-account').onclick = () => perform(async () => {
  const connection = selectedConnection(), config = selectedProvider();
  $('#connect-account').disabled = true;
  try { await providerApi(`${connection.account || ['openai','antigravity'].includes(config.type) ? '/api/account/refresh' : '/api/account/login'}?${providerGlobal ? 'scope=global' : `agentId=${providerAgentId}`}`,{}); }
  finally { $('#connect-account').disabled = false; }
});
$('#schedule-form').onsubmit = event => { event.preventDefault(); void perform(async () => {
  const selectedAgent=$('#schedule-agent').value || agentId, command=$('#schedule-call').value;
  const argumentsText=workspace.workflows.some(w=>w.command===command) ? JSON.stringify(Object.fromEntries([...$('#schedule-inputs').querySelectorAll('input')].map(input=>[input.name,input.value]))) : $('#schedule-prompt').value.trim();
  const intervalMinutes=$('#schedule-interval').value === 'custom' ? Number($('#schedule-repeat-count').value)*Number($('#schedule-repeat-unit').value) : Number($('#schedule-interval').value);
  const editingId=$('#schedule-form').dataset.scheduleId;
  await api(editingId ? `/api/schedules/${editingId}` : '/api/schedules',{ agentId:selectedAgent, prompt:command ? `/${command}${argumentsText ? ' '+argumentsText : ''}` : $('#schedule-prompt').value, at:new Date($('#schedule-at').value).toISOString(), intervalMinutes },editingId ? 'PATCH' : 'POST');
  $('#schedule-dialog').close(); await refresh(); await switchAgent(selectedAgent); navigate('routines'); toast(editingId ? 'Routine updated.' : 'Routine scheduled.');
}); };

document.addEventListener('click', event => {
  document.querySelectorAll('.agent-menu[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
  const target = event.target.closest('button,a,[data-mention-link]'); if (!target) return;
  if (target.dataset.previewFile) {
    event.preventDefault();
    const file = attachments.find(file=>file.id===target.dataset.previewFile) || state.files.find(file=>file.id===target.dataset.previewFile); if (!file) return;
    $('#image-preview-title').textContent = file.name;
    $('#image-preview-image').alt = `Preview of ${file.name}`;
    $('#image-preview-image').hidden = false;
    $('#image-preview-status').textContent = 'Loading image…';
    $('#image-preview-image').src = workspaceUrl(`/api/files/${encodeURIComponent(file.id)}/preview`);
    $('#image-preview').showModal(); return;
  }
  if (target.dataset.mentionCommand) { navigate(workspace.skills.some(s=>s.command===target.dataset.mentionCommand) ? 'skills' : 'workflows');return; }
  if (target.dataset.agentAction) {
    if (busy || switching) return;
    const id = target.dataset.agentId, action = target.dataset.agentAction, agent = workspace.agents.find(a=>a.id===id);
    target.closest('details').open = false;
    if (action === 'delete') {
      if (confirm(`Delete ${agent.customization?.name || defaults.name}? Its routines will be removed. Chat history and files stay saved.`)) void perform(async () => {
        await api(`/api/agents/${id}`,{},'DELETE');
        drafts.delete(id); closedAgents.delete(id); delete bubblePositions[id];
        sessionStorage.setItem(storageKey('odwyn-drafts'),JSON.stringify([...drafts])); localStorage.setItem(storageKey('odwyn-closed-agents'),JSON.stringify([...closedAgents])); localStorage.setItem(storageKey('odwyn-bubble-positions'),JSON.stringify(bubblePositions));
        await refresh(); localStorage.setItem(storageKey('odwyn-agent'),agentId || 'minimized');
        toast('Agent deleted. Chat history and files kept.');
      });
    } else void switchAgent(id).then(() => { setNavigation(false); if (action === 'customize') openCustomization(); else openAgentProvider(); });
    return;
  }
  if (target.dataset.roomAgent) { $('#room-header').close(); const room = currentRoom(); void switchAgent(target.dataset.roomAgent,{sharedChat:room.id,keepDraft:true}).then(()=>openAgentProvider()); return; }
  if (target.dataset.selectAgent) { setNavigation(false); void switchAgent(target.dataset.selectAgent).then(()=>{ navigate('chat',conversationId); }); return; }
  if (target.dataset.closeAgent) { closeAgent(target.dataset.closeAgent); return; }
  if (target.dataset.agent) {
    if (busy || switching) return;
    const latest = target.matches('.roster-item') && !drafts.has(target.dataset.agent) ? recentConversations(workspace).find(c=>c.kind !== 'room' && c.agentId === target.dataset.agent) : null;
    void switchAgent(target.dataset.agent).then(()=>{ if (latest) navigate('chat',latest.id); else navigate('chat',conversationId); });
    return;
  }
  if (target.hasAttribute('data-mascot-toggle')) {
    const paused = document.body.classList.toggle('mascot-paused');
    target.setAttribute('aria-pressed',String(!paused));
    target.title = `${paused ? 'Resume' : 'Pause'} avatar animation`;
  }
  if (target.hasAttribute('data-open-agents')) { $('#agents-open').click(); return; }
  if (target.hasAttribute('data-home-search')) { $('#search-open').click(); return; }
  if (target.dataset.view) { event.preventDefault(); navigate(target.dataset.view); }
  if (target.dataset.conversation) { $('#search-dialog').close(); navigate('chat',target.dataset.conversation); }
  if (target.hasAttribute('data-new-chat')) { setNavigation(false); navigate(); }
  if (target.dataset.prompt) { $('#prompt').value = target.dataset.prompt; $('#prompt').focus(); $('#prompt').dispatchEvent(new Event('input')); }
  if (target.hasAttribute('data-schedule-open')) openSchedule();
  if (target.hasAttribute('data-upload')) $('#file-input').click();
  if (target.dataset.filter) { filter = target.dataset.filter; signature = ''; render(); }
  if (target.dataset.cancel) void perform(() => api(`/api/jobs/${target.dataset.cancel}/cancel`,{}));
  if (target.dataset.stopRoom) void perform(() => api(`/api/rooms/${target.dataset.stopRoom}/cancel`,{}));
  if (target.dataset.retry) void perform(() => api(`/api/jobs/${target.dataset.retry}/retry`,{}));
  if (target.dataset.decision) void perform(() => api(`/api/jobs/${target.dataset.job}/answer`,{ requestId:target.dataset.request, decision:target.dataset.decision }));
  if (target.dataset.scheduleEdit) openSchedule(target.dataset.scheduleEdit);
  if (target.dataset.scheduleToggle) { const s = state.schedules.find(s => s.id === target.dataset.scheduleToggle); void perform(() => api(`/api/schedules/${s.id}`,{ enabled:!s.enabled },'PATCH')); }
  if (target.dataset.scheduleDelete && confirm('Delete this routine? Its previous results stay saved.')) void perform(() => api(`/api/schedules/${target.dataset.scheduleDelete}`,{},'DELETE'));
  if (target.dataset.copy) { const message = state.conversations.flatMap(c => c.messages).find(m => m.id === target.dataset.copy); void navigator.clipboard.writeText(message.text).then(() => toast('Copied.')).catch(handleError); }
  if (target.dataset.removeAttachment) { attachments = attachments.filter(f => f.id !== target.dataset.removeAttachment); target.closest('.attachment-chip').remove(); updateComposerSend(); }
});
document.addEventListener('submit', event => {
  const form = event.target.closest('[data-answer-job]'); if (!form) return;
  event.preventDefault(); void perform(() => api(`/api/jobs/${form.dataset.answerJob}/answer`,{ requestId:form.dataset.request, answer:new FormData(form).get('answer'), selected:new FormData(form).getAll('selected') }));
});
document.addEventListener('result-response-sent',() => { signature='';void refresh(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('#agents-dialog[open] .agent-menu[open]')) { const menu = $('#agents-dialog[open] .agent-menu[open]'); menu.open = false; menu.querySelector('summary').focus(); event.preventDefault(); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search-open').click(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); navigate(); }
});

new ResizeObserver(() => {
  const feed = $('#view');
  const atBottom = feed.scrollHeight-feed.scrollTop-feed.clientHeight<100;
  if (view === 'chat' && conversationId && atBottom) feed.scrollTo({top:feed.scrollHeight,behavior:'instant'});
}).observe($('#composer-area'));

$('#view').innerHTML = '<div class="loading-state" role="status"><img src="/mark.svg" width="48" height="48" alt=""><p>Making room for your day…</p></div>';
setupRoomWork(()=>workspace,currentRoom,refresh,id=>navigate('chat',id));
setupWorkspaceHomes();
setupOddy(()=>({view,conversationId:conversationId||'',agentId:agentId||''}));
await refresh();
if (state && agentId) { restoreDraft(); signature = ''; render(); }
const initial = location.hash.slice(1).split('/');
if (['home','chat','audit','runs','routines','files','workflows','skills','knowledge'].includes(initial[0]) && (agentId || ['home','audit'].includes(initial[0]))) { view = initial[0]; conversationId = initial[0] === 'home' ? conversationId : initial[1] || null; signature = ''; render(); }
if (!initial[0] && state) { view = 'home'; signature = ''; render(); }
if (state && agentId && !state.customization) openSettings(true);
else if (state && agentId && !workspace.globalProvider.configured) openSettings();
if(state && new URLSearchParams(location.search).get('settings')==='provider'){
  openSettings();document.querySelector('[data-settings-section="provider"]').click();
  if(new URLSearchParams(location.search).get('provider')==='oddy'){$('#settings-provider-target').value='oddy';void $('#settings-provider-target').onchange();}
}
setInterval(() => { if (!document.hidden) {
  void refresh();
  if(providerOddy&&$('#settings-dialog').open)void api('/api/oddy/provider').then(value=>{if(providerOddy){oddyProviderState=value;updateAccount();}}).catch(()=>{});
} }, 1000);

setupWorkflows(()=>workspace,()=>agentId,job=>navigate('chat',job.conversationId),refresh,()=>{signature='';render();});

setupAudit(()=>view);
