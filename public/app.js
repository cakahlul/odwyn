import { renderWorkflows, setupWorkflows } from './workflows-ui.js';
import { $, esc, icon, hydrateIcons, api, toast, handleError, activeStatuses, date } from './ui.js';
import { renderChat, insertMessages, colorMentions, renderRuns, renderRoutines, renderFiles, renderActivity, recentConversations } from './views.js';
import { setupBrowser, updateBrowser } from './browser-ui.js';
import { setupCustomization, applyProfile, openCustomization, fillWorkspaceAppearance, readWorkspaceAppearance } from './customize.js';
import { defaults, agentColor, choices, ownerPreferenceKeys, avatarSvg, currencies, effortLevels } from './profile.js';

// Carry browser preferences forward from the previous product name.
for (const [storage, keys] of [[localStorage, ['agent','closed-agents','bubble-positions']], [sessionStorage, ['drafts']]]) {
  for (const key of keys) {
    const previous = storage.getItem(`sidekick-${key}`);
    if (previous !== null && storage.getItem(`odwyn-${key}`) === null) storage.setItem(`odwyn-${key}`, previous);
    storage.removeItem(`sidekick-${key}`);
  }
}

for (const key of ['language','detail']) $(`#global-${key}`).innerHTML = Object.entries(choices[key]).map(([value,label])=>`<option value="${value}">${label}</option>`).join('');

let state = null, conversationId = null, view = 'chat', filter = 'all', signature = '', busy = false, attachments = [], providerAgentId = null, providerGlobal = false, providerAdding = false;
let workspace = null, agentId = localStorage.getItem('odwyn-agent'), switching = false, dockSignature = '';
const drafts = new Map(JSON.parse(sessionStorage.getItem('odwyn-drafts') || '[]'));
const closedAgents = new Set(JSON.parse(localStorage.getItem('odwyn-closed-agents') || '[]'));
const bubblePositions = JSON.parse(localStorage.getItem('odwyn-bubble-positions') || '{}');
let transitionAgentId = null, drag = null, suppressBubbleClick = null;
let renamingConversationId = null;
let editingRoomId = null, roomListSignature = '', roomMembersSignature = '';
const roomRecipients = new Map();
const currentRoom = () => view === 'chat' && workspace?.conversations.find(c => c.id === conversationId && c.kind === 'room');
const providers = { codex: ['Codex','gpt-6.1-sol'], claude: ['Claude Code','sonnet'], openai: ['OpenAI-compatible API',''] };
const currencyNames = new Intl.DisplayNames(['en'],{type:'currency'});
$('#preferred-currency').innerHTML = currencies.map(code=>`<option value="${code}">${code === 'source' ? 'Original currency' : `${code} · ${esc(currencyNames.of(code))}`}</option>`).join('');
hydrateIcons(); setupBrowser(() => state);
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
  $('#minimize-agent').disabled = !agentId || busy || switching;
  $('#reply-agent').disabled = $('#close-conversation').disabled = busy || switching;
  $('.conversation-controls').hidden = !agentId;
  $('#add-agent').disabled = workspace.agents.length >= 5 || busy || switching;
  $('#agent-count').textContent = `${workspace.agents.length} of 5`;
  $('#add-agent').title = workspace.agents.length >= 5 ? 'Maximum 5 agents reached' : `Add agent (${workspace.agents.length}/5)`;
}

function renderRooms() {
  const rooms = workspace.conversations.filter(c => c.kind === 'room'), room = currentRoom();
  const listSignature = JSON.stringify([conversationId,view,workspace.agents.length,rooms.map(r=>[r.id,r.title,r.memberIds])]);
  if (listSignature !== roomListSignature) {
    $('#room-list').innerHTML = rooms.length ? rooms.map(r=>`<button class="room-list-item ${r.id === room?.id ? 'selected' : ''}" data-conversation="${esc(r.id)}" aria-label="${esc(r.title)}" title="${esc(r.title)}">${icon('chat')}<span class="room-initial" aria-hidden="true">${esc(Array.from(r.title)[0]?.toUpperCase() || '#')}</span><span><strong>${esc(r.title)}</strong><small>${r.memberIds.length} agents</small></span></button>`).join('') : `<p class="sidebar-empty">${workspace.agents.length < 2 ? 'Add another agent to create a room.' : 'Create a room for your agents.'}</p>`;
    roomListSignature = listSignature;
  }
  $('#new-room').disabled = workspace.agents.length < 2 || busy || switching;
  const inRoom = !!room && !!agentId;
  $('#room-composer-hint').hidden = !inRoom;
  if (inRoom) $('#prompt').setAttribute('aria-describedby','room-composer-hint');
  else $('#prompt').removeAttribute('aria-describedby');
  renderMentions();
  document.body.classList.toggle('room-chat',inRoom);
  $('#room-details-open').hidden = !inRoom; $('#page-title').hidden = inRoom;
  $('#delete-conversation').disabled = busy || state.jobs.some(j=>j.conversationId===renamingConversationId && activeStatuses.includes(j.status));
  if ($('#room-header').open && (!inRoom || $('#room-header').dataset.room !== room.id)) $('#room-header').close();
  $('#room-header').dataset.room = room?.id || '';
  $('.reply-agent>span').textContent = room ? 'Send to' : 'Reply with';
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
    return {...agent,status:job && activeStatuses.includes(job.status) ? job.status === 'queued' ? 'Queued' : job.pending ? 'Needs you' : 'Speaking' : job?.error ? 'Needs attention' : agent.runtime.account ? 'Ready' : 'Connect provider'};
  });
  const membersSignature = JSON.stringify([room.id,members.map(a=>[a.id,a.customization,a.status])]);
  if (membersSignature !== roomMembersSignature) {
    $('#room-members').innerHTML = members.map(a=>`<button class="room-member" data-room-agent="${esc(a.id)}" title="Settings for ${esc(a.customization?.name || defaults.name)}">${avatarSvg(a.customization || defaults)}<span><strong>${esc(a.customization?.name || defaults.name)}</strong><small>${esc(a.status)}</small></span></button>`).join('');
    roomMembersSignature = membersSignature;
  }
  $('#composer-area').setAttribute('aria-label','Message the conversation room');
  $('label[for="prompt"]').textContent = `Message ${room.title}`;
}

function renderMentions() {
  const room = currentRoom(), prompt = $('#prompt');
  const highlights = $('#prompt-highlights');
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

function openRoomEditor(room = null) {
  editingRoomId = room?.id || null; $('#room-header').close(); setNavigation(false);
  $('#room-dialog-title').textContent = room ? 'Edit conversation room' : 'Create a conversation room';
  $('#room-save').childNodes[0].textContent = room ? 'Save changes' : 'Create room';
  $('#room-name').value = room?.title || ''; $('#room-status').textContent = '';
  $('#room-agent-options').innerHTML = workspace.agents.map(a=>`<label class="room-agent-option"><input type="checkbox" name="memberIds" value="${esc(a.id)}" ${room ? room.memberIds.includes(a.id) ? 'checked' : '' : a.id === agentId ? 'checked' : ''}>${avatarSvg(a.customization || defaults)}<span><strong>${esc(a.customization?.name || defaults.name)}</strong><small>${esc(providers[a.provider.type][0])} · ${a.runtime.account ? 'Ready' : 'Connect provider'}</small></span></label>`).join('');
  $('#room-dialog').showModal(); $('#room-name').focus();
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
  localStorage.setItem('odwyn-bubble-positions',JSON.stringify(bubblePositions));
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
  const small = { transform:`translate(${target.x-box.x}px,${target.y-box.y}px) scale(${target.width/box.width},${target.height/box.height})`, opacity:0 };
  const full = { transform:'none', opacity:1 };
  await panel.animate(restoring ? [small,full] : [full,small], { duration:200, easing:restoring ? 'cubic-bezier(.2,.8,.2,1)' : 'ease-in' }).finished;
}

async function switchAgent(nextId, { closing = false, sharedChat = null, keepDraft = false } = {}) {
  if (!workspace || nextId === agentId || switching || busy || nextId && !workspace.agents.some(a => a.id === nextId)) return;
  if (nextId) closedAgents.delete(nextId);
  if (closing && agentId) closedAgents.add(agentId);
  localStorage.setItem('odwyn-closed-agents',JSON.stringify([...closedAgents]));
  switching = true; transitionAgentId = agentId; renderDock();
  const panel = $('#agent-workspace'); panel.inert = true;
  try {
    if (agentId) {
      drafts.set(agentId, { view, conversationId, filter, prompt:$('#prompt').value, height:$('#prompt').style.height, attachments, mode:$('#interaction-mode').value, scroll:$('#view').scrollTop, mainScroll:panel.scrollTop, paused:document.body.classList.contains('mascot-paused') });
      sessionStorage.setItem('odwyn-drafts',JSON.stringify([...drafts]));
    }
    const currentDraft = drafts.get(agentId);
    await animateAgent(agentId,false);
    agentId = nextId; localStorage.setItem('odwyn-agent',nextId || 'minimized');
    transitionAgentId = nextId;
    if (sharedChat || keepDraft) {
      const previous = keepDraft ? currentDraft : drafts.get(nextId);
      drafts.set(nextId,{...previous,view:'chat',conversationId:sharedChat,...(keepDraft || previous?.conversationId === sharedChat ? {} : {prompt:'',attachments:[],mode:'confirm',height:''})});
      sessionStorage.setItem('odwyn-drafts',JSON.stringify([...drafts]));
    }
    selectState(); const draft = restoreDraft();
    signature = ''; render(); setNavigation(false);
    $('#view').scrollTo({top:draft?.scroll || 0,behavior:'instant'}); panel.scrollTo({top:draft?.mainScroll || 0,behavior:'instant'});
    history.replaceState(null,'',conversationId ? `#chat/${conversationId}` : `#${view}`);
    await animateAgent(agentId,true);
    $('#agent-announcement').textContent = agentId ? `${state.customization?.name || 'Odwyn'} restored` : closing ? 'Conversation closed. Available in history.' : 'All agents minimized';
  } finally { switching = false; transitionAgentId = null; panel.inert = false; renderDock(); renderRooms(); }
  if (agentId && view === 'chat') $('#prompt').focus();
  else document.querySelector('.bubble-restore')?.focus();
}

function closeAgent(id) {
  if (busy || switching) return;
  if (id === agentId) { void switchAgent(null,{closing:true}); return; }
  closedAgents.add(id); localStorage.setItem('odwyn-closed-agents',JSON.stringify([...closedAgents])); signature = ''; render();
  $('#agent-announcement').textContent = 'Conversation closed. Available in history.';
}

function restoreDraft() {
  const draft = drafts.get(agentId);
  view = draft?.view || 'chat'; conversationId = draft?.conversationId || null; filter = draft?.filter || 'all'; attachments = draft?.attachments || [];
  $('#prompt').value = draft?.prompt || ''; $('#prompt').style.height = draft?.height || '';
  $('#interaction-mode').value = draft?.mode || 'confirm'; renderAttachments();
  document.body.classList.toggle('mascot-paused',!!draft?.paused);
  return draft;
}

function renderAttachments() {
  $('#attachments').innerHTML = attachments.map(f => `<span class="attachment-chip">${icon('paperclip')}${esc(f.name)}<button type="button" data-remove-attachment="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">${icon('close')}</button></span>`).join('');
}
const mobile = matchMedia('(max-width: 760px)');
function setNavigation(open) {
  document.body.classList.toggle('nav-open',open);
  $('#menu-button').setAttribute('aria-expanded',String(open));
  $('.sidebar').inert = mobile.matches && !open;
  if (open && mobile.matches) ($('#new-chat').disabled ? $('.sidebar-agent') : $('#new-chat'))?.focus();
}
function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed',collapsed);
  $('#sidebar-toggle').setAttribute('aria-expanded',String(!collapsed));
  $('#sidebar-toggle').title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  $('#sidebar-toggle').setAttribute('aria-label',$('#sidebar-toggle').title);
  if (collapsed) document.querySelectorAll('.agent-menu[open]').forEach(menu=>menu.open=false);
}
setSidebarCollapsed(localStorage.getItem('odwyn-sidebar-collapsed') === 'true');
$('#sidebar-toggle').onclick = () => {
  const collapsed = !document.body.classList.contains('sidebar-collapsed');
  setSidebarCollapsed(collapsed); localStorage.setItem('odwyn-sidebar-collapsed',String(collapsed));
};
mobile.addEventListener('change', () => setNavigation(false)); setNavigation(false);

function navigate(next = 'chat', id = null) {
  if (switching) return;
  const chat = workspace.conversations.find(c => c.id === id), owner = chat?.lastAgentId || chat?.agentId;
  if (owner && id !== conversationId && owner !== agentId || !agentId) { void switchAgent(owner || workspace.agents[0].id,{sharedChat:id}).then(() => { if (agentId) navigate(next,id); }); return; }
  view = next; conversationId = id; signature = ''; render();
  $('#agent-workspace').scrollTop = 0;
  setNavigation(false);
  if (view === 'chat') $('#prompt').focus();
  history.replaceState(null, '', id ? `#chat/${id}` : `#${view}`);
}

function render() {
  if (!state) return;
  renderDock();
  applyProfile(agentId ? state.customization : null,state.appearance,state.owner);
  $('#composer-area').setAttribute('aria-label','Message your assistant');
  renderRooms();
  $('.connection').classList.toggle('connected', !!workspace.globalRuntime.account);
  const providerName = providers[workspace.globalProvider.type][0], globalRuntime = workspace.globalRuntime;
  $('#connection-label').textContent = globalRuntime.account ? `${providerName} ready` : `Connect ${providerName}`;
  $('#connection-button').setAttribute('aria-label',$('#connection-label').textContent);
  $('#connection-button').title = globalRuntime.connectionError || `${providerName} · ${workspace.globalProvider.model}`;

  $('#new-chat').disabled = !agentId;
  document.querySelectorAll('[data-view]').forEach(button => button.disabled = !agentId);
  if (!agentId) {
    $('#agent-workspace').classList.remove('chat-start'); $('#main').classList.remove('chat-start'); $('#composer-area').hidden = true;
    $('#page-title').textContent = 'No conversation open';
    if (signature !== 'minimized') $('#view').innerHTML = `<div class="agents-empty"><h1>${workspace.agents.every(a => closedAgents.has(a.id)) ? 'No conversation open' : 'Your agents are minimized'}</h1><p>Choose an agent in the sidebar or restore a floating bubble. Your conversations stay in history.</p></div>`;
    signature = 'minimized';
    updateBrowser(state); return;
  }
  $('#run-status').hidden = !state.jobs.some(job => activeStatuses.includes(job.status));
  const conversation = state.conversations.find(c => c.id === conversationId);
  const permissionJob = state.jobs.find(job=>job.conversationId === conversationId && job.id === state.runtime.activeJobId) || state.jobs.find(job=>job.conversationId === conversationId && job.status === 'queued');
  if (permissionJob && !$('#interaction-mode').disabled) $('#interaction-mode').value = permissionJob.interactionMode;
  $('#prompt').placeholder = conversation?.kind === 'room' ? 'Message the room, or @mention an agent…' : conversation ? 'Reply or ask a follow-up…' : 'Describe a task or ask a question…';
  $('#main').classList.toggle('chat-start', view === 'chat' && !conversation);
  $('#agent-workspace').classList.toggle('chat-start', view === 'chat' && !conversation);
  $('#page-title').textContent = view === 'chat' ? conversation?.title || 'New conversation' : { runs:'Task runs', routines:'Routines', files:'Files & results', workflows:'Workflows & skills' }[view];
  $('#page-title').disabled = view !== 'chat' || !conversation;
  $('#page-title').title = conversation && view === 'chat' ? 'Rename conversation' : '';
  $('#page-title').setAttribute('aria-label',conversation && view === 'chat' ? `Rename conversation: ${conversation.title}` : $('#page-title').textContent);
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active',button.dataset.view === view));
  const chats = recentConversations(state).filter(c=>c.kind !== 'room');
  $('#history').innerHTML = chats.length ? chats.map(c => {
    const job = state.jobs.find(job => job.conversationId === c.id);
    return `<button class="history-item ${c.id === conversationId && view === 'chat' ? 'selected' : ''}" data-conversation="${esc(c.id)}"><span class="history-bullet ${job?.status === 'running' ? 'running' : ''}"></span><span>${esc(c.title)}</span>${job?.status === 'waiting' ? '<span class="needs-you-dot" title="Needs your input">!</span>' : ''}</button>`;
  }).join('') : '<p class="sidebar-empty">No conversations yet.</p>';
  const nextRoutine = state.schedules.filter(s=>s.enabled).sort((a,b)=>Date.parse(a.nextAt)-Date.parse(b.nextAt))[0];
  $('.routine-summary').hidden = !nextRoutine;
  $('#routine-note').textContent = nextRoutine?.prompt || '';
  $('#routine-note-detail').textContent = nextRoutine ? `Next: ${date(nextRoutine.nextAt)}` : '';
  $('#composer-area').hidden = view !== 'chat';
  const nextSignature = JSON.stringify({ view, conversationId, filter, customization:state.customization, owner:state.owner, mentions:[state.agents.map(a=>[a.id,a.customization]),state.skills,state.workflows.map(w=>w.command)], data: view === 'chat' ? [conversation || state.conversations, state.jobs.filter(j => !conversation || j.conversationId === conversationId), !!state.runtime.account] : view === 'runs' ? state.jobs : view === 'routines' ? state.schedules : view === 'workflows' ? [state.workflows,state.skills,state.workflowRuns,state.jobs] : state.files });
  if (signature !== nextSignature) {
    const nearBottom = $('#view').scrollHeight - $('#view').scrollTop - $('#view').clientHeight < 100;
    const previousScroll = $('#view').scrollTop;
    const pendingCard = $('#view .approval-card');
    const pendingFocus = pendingCard?.contains(document.activeElement) ? document.activeElement : null;
    $('#view').innerHTML = view === 'chat' ? renderChat(state, conversationId) : view === 'runs' ? renderRuns(state,filter) : view === 'routines' ? renderRoutines(state) : view === 'workflows' ? renderWorkflows(state) : renderFiles(state);
    const nextPendingCard = $('#view .approval-card');
    if (pendingCard && nextPendingCard?.dataset.request === pendingCard.dataset.request) {
      nextPendingCard.replaceWith(pendingCard);
      pendingFocus?.focus({preventScroll:true});
    }
    if (view === 'chat') insertMessages(state,conversationId);
    updateBrowser(state);
    $('#view').scrollTop = nearBottom ? $('#view').scrollHeight : previousScroll;
    signature = nextSignature;
  } else updateBrowser(state);
  renderActivity(state,conversationId);
  const disabled = !!state.jobs.find(job => job.conversationId === conversationId && activeStatuses.includes(job.status));
  $('#send-button').disabled = busy || disabled && conversation?.kind !== 'room'; $('#send-button').title = disabled ? conversation?.kind === 'room' ? 'Stop current discussion and send this direction' : 'Finish or stop the active run before a follow-up.' : 'Send message';
  if (providerGlobal ? $('#settings-dialog').open : $('#customize-dialog').open && providerAgentId === state.agentId) updateAccount();
}

async function refresh() {
  try {
    const response = await fetch(`/api/state${state ? `?revision=${state.revision}` : ''}`);
    if (response.status === 204) return;
    if (!response.ok) throw new Error('Connection lost. Reload to sign in.');
    workspace = await response.json();
    if (agentId === 'minimized') agentId = null;
    else if (agentId !== null && !workspace.agents.some(a => a.id === agentId) || !state && agentId === null && localStorage.getItem('odwyn-agent') !== 'minimized') agentId = workspace.agents[0].id;
    selectState(); render();
  } catch (error) { $('#connection-label').textContent = 'Reconnecting…'; $('.connection').classList.remove('connected'); if (!state) handleError(error); }
}

async function perform(fn) { try { await fn(); await refresh(); } catch (error) { handleError(error); } }
function openSchedule() {
  const room=currentRoom(), members=room ? workspace.agents.filter(a=>room.memberIds.includes(a.id)) : workspace.agents.filter(a=>a.id===agentId);
  $('#schedule-agent-field').hidden = !room;
  $('#schedule-agent').innerHTML=members.map(a=>`<option value="${esc(a.id)}">${esc(a.customization?.name || defaults.name)}</option>`).join('');
  $('#schedule-agent').value=room && room.memberIds.includes($('#reply-agent').value) ? $('#reply-agent').value : members.find(a=>a.id===agentId)?.id || members[0]?.id;
  $('#schedule-prompt').value = $('#prompt').value;
  const soon = new Date(Date.now() + 60 * 60_000); const local = new Date(soon.valueOf() - soon.getTimezoneOffset() * 60_000);
  $('#schedule-at').value = local.toISOString().slice(0,16); $('#schedule-status').textContent = ''; $('#schedule-dialog').showModal();
}
function updateAccount() {
  const connection = providerGlobal ? workspace.globalRuntime : state.runtime;
  const account = connection.account;
  const type = (providerGlobal ? workspace.globalProvider : state.provider).type;
  $('#account-title').textContent = providers[type][0];
  $('#account-description').textContent = connection.connectionError || (type === 'claude' ? (account ? `Signed in${account.email ? ` as ${account.email}` : ''}.` : 'Run claude auth login on the server, then refresh.') : type === 'openai' ? 'Requests use your configured API URL and model. Provider API billing applies.' : account?.email || 'Connect your ChatGPT account to start working.');
  $('#connect-account').textContent = account || type !== 'codex' ? 'Refresh' : 'Connect';
  const login = connection.login;
  $('#login-instructions').hidden = !login || $('#provider-account-box').hidden;
  if (login?.verificationUrl) {
    const node = $('#login-instructions'); node.replaceChildren();
    const p = document.createElement('p'); p.textContent = 'Open the sign-in page and enter this one-time code:';
    const code = document.createElement('code'); code.textContent = login.userCode;
    const link = document.createElement('a'); link.textContent = 'Open ChatGPT sign-in ↗'; link.href = login.verificationUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; node.append(p,code,link);
  } else if (login?.error) $('#login-instructions').textContent = login.error;
}
function providerFields() {
  const type = $('#provider-type').value, isAPI = type === 'openai';
  const needsSave = providerAdding || type !== (providerGlobal ? workspace.globalProvider : state.provider).type;
  $('#provider-account-box').hidden = needsSave; $('#provider-save-hint').hidden = !needsSave;
  if (needsSave) $('#login-instructions').hidden = true;
  const selected=$('#provider-effort').value || 'default';
  $('#provider-effort').innerHTML=effortLevels[type].map(value=>`<option value="${value}">${value==='default' ? 'Model default' : value==='xhigh' ? 'Extra high' : value==='max' ? 'Maximum' : value[0].toUpperCase()+value.slice(1)}</option>`).join('');
  $('#provider-effort').value=effortLevels[type].includes(selected) ? selected : 'default';
  $('#provider-api-fields').hidden = !isAPI;
  $('#provider-base-url').disabled = $('#provider-api-key').disabled = !isAPI;
  $('#provider-base-url').required = isAPI;
  $('#provider-hint').textContent = type === 'claude' ? 'Uses Claude Code on this server. Sign in with claude auth login, then refresh below.' : isAPI ? 'Use a base URL such as https://api.openai.com/v1. Model must support tool calling; screenshots need vision.' : 'Uses Codex App Server with your ChatGPT subscription. Connect below after saving.';
}
function openSettings() {
  providerGlobal = true; providerAdding = false;
  $('#settings-provider-editor').append($('#provider-editor'));
  $('#provider-editor').hidden = false;
  $('#provider-form').querySelectorAll('input,select').forEach(field => field.disabled = false);
  fillProvider(workspace.globalProvider);
  fillWorkspaceAppearance(workspace.appearance);
  for (const key of ownerPreferenceKeys) $(`#global-${key}`).value = workspace.owner?.[key] ?? defaults[key];
  $('#preferred-currency').value = workspace.currency || 'source';
  $('#preferences').value = workspace.preferences || ''; $('#settings-status').textContent = '';
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
  providerFields(); $('#provider-effort').value = config.effort || 'default'; updateAccount();
}
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
  providerGlobal = false; providerAdding = event.detail.adding; providerAgentId = state.agentId;
  $('#agent-provider-editor').append($('#provider-editor'));
  $('#provider-editor').hidden = false;
  $('#provider-form').querySelectorAll('input,select').forEach(field => field.disabled = false);
  fillProvider(event.detail.adding ? workspace.globalProvider : state.provider);
  $('#provider-source').value = !event.detail.adding && workspace.agents.find(agent => agent.id === state.agentId).providerOverride ? 'custom' : 'global';
  providerSource();
});
$('#customize-dialog').addEventListener('close', () => { if (!$('#customize-dialog').open) { providerAgentId = null; } });
$('#provider-type').onchange = () => {
  const config = providerGlobal ? workspace.globalProvider : state.provider, type = $('#provider-type').value;
  $('#provider-model').value = type === config.type ? config.model : providers[type][1];
  providerFields(); $('#provider-effort').value = type === config.type ? config.effort || 'default' : 'default';
};
const providerInput = () => ({type:$('#provider-type').value,model:$('#provider-model').value,effort:$('#provider-effort').value,baseUrl:$('#provider-base-url').value,apiKey:$('#provider-api-key').value});
function search() {
  const query = $('#search-input').value.toLowerCase();
  const found = state?.conversations.filter(c => c.title.toLowerCase().includes(query) || c.messages.some(m => m.text.toLowerCase().includes(query))) || [];
  $('#search-results').innerHTML = found.length ? found.map(c => `<button class="search-result" data-conversation="${esc(c.id)}">${icon('chat')}<span>${esc(c.title)}</span>${icon('arrow-up-right')}</button>`).join('') : '<p class="search-empty">No conversations found. Start a fresh one.</p>';
}

$('#new-chat').onclick = () => navigate();
$('#new-room').onclick = () => openRoomEditor();
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
  if (!conversation || busy || !confirm(`Delete “${conversation.title}” permanently? Its messages and task runs will be removed. Agents and saved files are kept.`)) return;
  busy=true; $('#delete-conversation').disabled=$('#delete-room').disabled=true;
  try {
    await api(`/api/conversations/${id}`,{},'DELETE');
    for (const [key,draft] of drafts) if (draft.conversationId===id) drafts.delete(key);
    sessionStorage.setItem('odwyn-drafts',JSON.stringify([...drafts])); roomRecipients.delete(id);
    if (conversationId===id) { $('#prompt').value=''; $('#prompt').style.height=''; attachments=[]; renderAttachments(); }
    $('#rename-dialog').close(); $('#room-header').close();
    await refresh(); navigate(); toast('Conversation deleted. Agents and files kept.');
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
  } catch(error) { $('#rename-status').textContent=error.message; }
  finally { $('#rename-save').disabled=false; }
};
$('#room-details-open').onclick = () => $('#room-header').showModal();
$('#edit-room').onclick = () => openRoomEditor(currentRoom());
$('#room-dialog-close').onclick = () => $('#room-dialog').close();
$('#room-dialog').onclose = () => { if (editingRoomId && currentRoom()) $('#room-details-open').focus(); };
$('#room-form').oninput = () => { $('#room-status').textContent = ''; };
$('#room-form').onsubmit = async event => {
  event.preventDefault(); const memberIds = new FormData(event.target).getAll('memberIds');
  if (memberIds.length < 2) { $('#room-status').textContent = 'Choose at least two agents.'; return; }
  $('#room-save').disabled = true; $('#room-status').textContent = 'Saving…';
  try {
    const room = await api(editingRoomId ? `/api/rooms/${editingRoomId}` : '/api/rooms',{title:$('#room-name').value,memberIds},editingRoomId ? 'PATCH' : 'POST');
    $('#room-dialog').close(); await refresh(); navigate('chat',room.id); toast(editingRoomId ? 'Room updated.' : 'Room ready. Send a message to start the discussion.');
  } catch (error) { $('#room-status').textContent = error.message; }
  finally { $('#room-save').disabled = false; }
};
$('#room-discuss').onclick = () => {
  const room = currentRoom(); if (!room || busy || $('#room-discuss').disabled) return;
  $('#room-header').close();
  roomRecipients.set(room.id,'all'); $('#reply-agent').value = 'all';
  if (!$('#prompt').value.trim()) $('#prompt').value = room.discussion?.direction || room.discussion?.goal || 'Continue toward the shared goal from existing progress. Resolve only remaining issues and finish the requested result.';
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
$('#schedule-open').onclick = openSchedule;
$('#menu-button').onclick = () => setNavigation(!document.body.classList.contains('nav-open'));
$('#nav-scrim').onclick = () => { setNavigation(false); $('#menu-button').focus(); };
$('#search-open').onclick = () => { $('#search-dialog').showModal(); $('#search-input').focus(); search(); };
$('#search-input').oninput = search;
$('#attach-button').onclick = () => $('#file-input').click();
$('#file-input').onchange = async () => {
  const file = $('#file-input').files[0]; if (!file) return;
  const form = new FormData(); form.append('file',file);
  busy = true; renderDock();
  await perform(async () => { const saved = await api('/api/files',form); attachments.push(saved); renderAttachments(); toast('File ready for your task.'); });
  busy = false; render();
  $('#file-input').value = '';
};
$('#composer').onsubmit = async event => {
  event.preventDefault(); const prompt = $('#prompt').value.trim();
  if (!prompt || busy || $('#send-button').disabled) return;
  busy = true; $('#send-button').disabled = true;
  await perform(async () => {
    const room = currentRoom();
    const result = await api(room ? `/api/rooms/${room.id}/messages` : '/api/jobs', { prompt: prompt + (attachments.length ? `\n\nAttached files: ${attachments.map(f => `${f.name} (fileId: ${f.id})`).join(', ')}` : ''), agentId:room ? $('#reply-agent').value : agentId, conversationId, interactionMode:$('#interaction-mode').value });
    $('#prompt').value = ''; $('#prompt').style.height = ''; attachments = []; $('#attachments').replaceChildren(); navigate('chat',room?.id || result.conversationId);
    if (room) { roomRecipients.delete(room.id); $('#reply-agent').value = 'all'; }
  });
  busy = false; render();
};
$('#prompt').onkeydown = event => {
  if (event.key === 'ArrowDown' && !$('#room-mentions').hidden) { event.preventDefault(); $('#room-mentions button')?.focus(); }
  else if (event.key === 'Escape') $('#room-mentions').hidden = true;
  else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#composer').requestSubmit(); }
};
$('#prompt').oninput = () => { $('#prompt').style.height = 'auto'; $('#prompt').style.height = Math.min($('#prompt').scrollHeight,260) + 'px'; renderMentions(); };
$('#prompt').onclick = renderMentions;
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
$('#preferences-form').onsubmit = event => { event.preventDefault(); void perform(async () => { await api('/api/preferences',{ ...Object.fromEntries(ownerPreferenceKeys.map(key=>[key,$(`#global-${key}`).value])), provider:providerInput(), text:$('#preferences').value, currency:$('#preferred-currency').value, appearance:readWorkspaceAppearance() },'PUT'); $('#provider-api-key').value = ''; $('#settings-dialog').close(); toast('Settings saved. Applies to your next task.'); }); };
$('#connect-account').onclick = () => perform(async () => {
  const connection = providerGlobal ? workspace.globalRuntime : state.runtime, config = providerGlobal ? workspace.globalProvider : state.provider;
  $('#connect-account').disabled = true;
  try { await api(`${connection.account || config.type !== 'codex' ? '/api/account/refresh' : '/api/account/login'}?${providerGlobal ? 'scope=global' : `agentId=${providerAgentId}`}`,{}); }
  finally { $('#connect-account').disabled = false; }
});
$('#schedule-form').onsubmit = event => { event.preventDefault(); void perform(async () => {
  await api('/api/schedules',{ agentId:$('#schedule-agent').value || agentId, prompt:$('#schedule-prompt').value, at:new Date($('#schedule-at').value).toISOString(), intervalMinutes:Number($('#schedule-interval').value), interactionMode:'confirm' });
  $('#schedule-dialog').close(); navigate('routines'); toast('Routine scheduled.');
}); };

document.addEventListener('click', event => {
  document.querySelectorAll('.agent-menu[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
  const target = event.target.closest('button,a'); if (!target) return;
  if (target.dataset.agentAction) {
    if (busy || switching) return;
    const id = target.dataset.agentId, action = target.dataset.agentAction, agent = workspace.agents.find(a=>a.id===id);
    target.closest('details').open = false;
    if (action === 'delete') {
      if (confirm(`Delete ${agent.customization?.name || defaults.name}? Its routines will be removed. Chat history and files stay saved.`)) void perform(async () => {
        await api(`/api/agents/${id}`,{},'DELETE');
        drafts.delete(id); closedAgents.delete(id); delete bubblePositions[id];
        sessionStorage.setItem('odwyn-drafts',JSON.stringify([...drafts])); localStorage.setItem('odwyn-closed-agents',JSON.stringify([...closedAgents])); localStorage.setItem('odwyn-bubble-positions',JSON.stringify(bubblePositions));
        await refresh(); localStorage.setItem('odwyn-agent',agentId || 'minimized');
        toast('Agent deleted. Chat history and files kept.');
      });
    } else void switchAgent(id).then(() => { setNavigation(false); if (action === 'customize') openCustomization(); else openAgentProvider(); });
    return;
  }
  if (target.dataset.roomAgent) { $('#room-header').close(); const room = currentRoom(); void switchAgent(target.dataset.roomAgent,{sharedChat:room.id,keepDraft:true}).then(()=>openAgentProvider()); return; }
  if (target.dataset.selectAgent) { void switchAgent(target.dataset.selectAgent); return; }
  if (target.dataset.closeAgent) { closeAgent(target.dataset.closeAgent); return; }
  if (target.dataset.agent) { void switchAgent(target.dataset.agent); return; }
  if (target.hasAttribute('data-mascot-toggle')) {
    const paused = document.body.classList.toggle('mascot-paused');
    target.setAttribute('aria-pressed',String(!paused));
    target.title = `${paused ? 'Resume' : 'Pause'} avatar animation`;
  }
  if (target.dataset.view) navigate(target.dataset.view);
  if (target.dataset.conversation) { $('#search-dialog').close(); navigate('chat',target.dataset.conversation); }
  if (target.hasAttribute('data-new-chat')) navigate();
  if (target.dataset.prompt) { $('#prompt').value = target.dataset.prompt; $('#prompt').focus(); $('#prompt').dispatchEvent(new Event('input')); }
  if (target.hasAttribute('data-schedule-open')) openSchedule();
  if (target.hasAttribute('data-upload')) $('#file-input').click();
  if (target.dataset.filter) { filter = target.dataset.filter; signature = ''; render(); }
  if (target.dataset.cancel) void perform(() => api(`/api/jobs/${target.dataset.cancel}/cancel`,{}));
  if (target.dataset.stopRoom) void perform(() => api(`/api/rooms/${target.dataset.stopRoom}/cancel`,{}));
  if (target.dataset.retry) void perform(() => api(`/api/jobs/${target.dataset.retry}/retry`,{}));
  if (target.dataset.decision) void perform(() => api(`/api/jobs/${target.dataset.job}/answer`,{ requestId:target.dataset.request, decision:target.dataset.decision }));
  if (target.dataset.scheduleToggle) { const s = state.schedules.find(s => s.id === target.dataset.scheduleToggle); void perform(() => api(`/api/schedules/${s.id}`,{ enabled:!s.enabled },'PATCH')); }
  if (target.dataset.scheduleDelete && confirm('Delete this routine? Its previous results stay saved.')) void perform(() => api(`/api/schedules/${target.dataset.scheduleDelete}`,{},'DELETE'));
  if (target.dataset.copy) { const message = state.conversations.flatMap(c => c.messages).find(m => m.id === target.dataset.copy); void navigator.clipboard.writeText(message.text).then(() => toast('Copied.')).catch(handleError); }
  if (target.dataset.removeAttachment) { attachments = attachments.filter(f => f.id !== target.dataset.removeAttachment); target.closest('.attachment-chip').remove(); }
});
document.addEventListener('submit', event => {
  const form = event.target.closest('[data-answer-job]'); if (!form) return;
  event.preventDefault(); void perform(() => api(`/api/jobs/${form.dataset.answerJob}/answer`,{ requestId:form.dataset.request, answer:new FormData(form).get('answer'), selected:new FormData(form).getAll('selected') }));
});
document.addEventListener('result-response-sent',() => { signature='';void refresh(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('.agent-menu[open]')) { const menu = $('.agent-menu[open]'); menu.open = false; menu.querySelector('summary').focus(); event.preventDefault(); return; }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search-open').click(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); navigate(); }
  if (event.key === 'Escape' && document.body.classList.contains('nav-open')) { setNavigation(false); $('#menu-button').focus(); }
  if (event.key === 'Tab' && mobile.matches && document.body.classList.contains('nav-open')) {
    const focusable = [...$('.sidebar').querySelectorAll('a,button,summary')].filter(button => !button.disabled && button.getClientRects().length); const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

new ResizeObserver(() => {
  const feed = $('#view');
  const atBottom = feed.scrollHeight-feed.scrollTop-feed.clientHeight<100;
  if (view === 'chat' && conversationId && atBottom) feed.scrollTo({top:feed.scrollHeight,behavior:'instant'});
}).observe($('#composer-area'));

$('#view').innerHTML = '<div class="loading-state" role="status"><img src="/mark.svg" width="48" height="48" alt=""><p>Making room for your day…</p></div>';
await refresh();
if (state && agentId) { restoreDraft(); signature = ''; render(); }
const initial = location.hash.slice(1).split('/');
if (agentId && ['chat','runs','routines','files','workflows'].includes(initial[0])) { view = initial[0]; conversationId = initial[1] || null; signature = ''; render(); }
if (state && agentId && !state.customization) openCustomization(true,false,true);
else if (state && agentId && !workspace.globalProvider.configured) openSettings();
setInterval(() => { if (!document.hidden) void refresh(); }, 1000);

setupWorkflows(()=>workspace,()=>agentId,job=>navigate('chat',job.conversationId),refresh);
