import { $, esc, icon, hydrateIcons, api, toast, handleError, activeStatuses } from './ui.js';
import { renderChat, insertMessages, renderRuns, renderRoutines, renderFiles, renderActivity } from './views.js';
import { setupBrowser, updateBrowser } from './browser-ui.js';
import { setupCustomization, applyProfile, openCustomization } from './customize.js';

let state = null, conversationId = null, view = 'chat', filter = 'all', signature = '', busy = false, attachments = [];
hydrateIcons(); setupBrowser(() => state);
setupCustomization(() => state, async profile => { state.customization = profile; signature = ''; render(); await refresh(); });
const mobile = matchMedia('(max-width: 760px)');
function setNavigation(open) {
  document.body.classList.toggle('nav-open',open);
  $('#menu-button').setAttribute('aria-expanded',String(open));
  $('.sidebar').inert = mobile.matches && !open;
  if (open && mobile.matches) $('#new-chat').focus();
}
mobile.addEventListener('change', () => setNavigation(false)); setNavigation(false);

function navigate(next = 'chat', id = null) {
  view = next; conversationId = id; signature = ''; render();
  $('#main').scrollTop = 0;
  setNavigation(false);
  if (view === 'chat') $('#prompt').focus();
  history.replaceState(null, '', id ? `#chat/${id}` : `#${view}`);
}

function render() {
  if (!state) return;
  applyProfile(state.customization);
  $('#run-status').hidden = !state.jobs.some(job => activeStatuses.includes(job.status));
  $('.connection').classList.toggle('connected', !!state.runtime.account);
  $('#connection-label').textContent = state.runtime.account ? 'Codex connected' : 'Connect Codex';
  $('#connection-button').title = state.runtime.connectionError || (state.runtime.account ? `${state.runtime.account.planType} subscription` : 'Connect your subscription in Settings');
  const conversation = state.conversations.find(c => c.id === conversationId);
  $('#prompt').placeholder = conversation ? 'Reply or ask a follow-up…' : 'A task, a question, a little thing you keep putting off…';
  $('#main').classList.toggle('chat-start', view === 'chat' && !conversation);
  $('#page-title').textContent = view === 'chat' ? conversation?.title || 'New conversation' : { runs:'Task runs', routines:'Routines', files:'Files & results' }[view];
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active',button.dataset.view === view));
  $('#history').innerHTML = state.conversations.length ? state.conversations.map(c => {
    const job = state.jobs.find(job => job.conversationId === c.id);
    return `<button class="history-item ${c.id === conversationId && view === 'chat' ? 'selected' : ''}" data-conversation="${esc(c.id)}"><span class="history-bullet ${job?.status === 'running' ? 'running' : ''}"></span><span>${esc(c.title)}</span>${job?.status === 'waiting' ? '<span class="needs-you-dot" title="Needs your input">!</span>' : ''}</button>`;
  }).join('') : '<p class="sidebar-empty">Room for your next idea.</p>';
  const routines = state.schedules.filter(s => s.enabled);
  $('#routine-note').textContent = routines.length ? `${routines.length} routine${routines.length === 1 ? '' : 's'} on my clock.` : 'Your time. Your pace.';
  $('#routine-note-detail').textContent = routines.length ? 'A little ahead of the day.' : "Set a routine. I'll keep track.";
  $('#composer-area').hidden = view !== 'chat';
  const nextSignature = JSON.stringify({ view, conversationId, filter, customization:state.customization, data: view === 'chat' ? [conversation?.messages, state.jobs.filter(j => j.conversationId === conversationId), !!state.runtime.account] : view === 'runs' ? state.jobs : view === 'routines' ? state.schedules : state.files });
  if (signature !== nextSignature) {
    const nearBottom = $('#view').scrollHeight - $('#view').scrollTop - $('#view').clientHeight < 100;
    const previousScroll = $('#view').scrollTop;
    $('#view').innerHTML = view === 'chat' ? renderChat(state, conversationId) : view === 'runs' ? renderRuns(state,filter) : view === 'routines' ? renderRoutines(state) : renderFiles(state);
    if (view === 'chat') insertMessages(state,conversationId);
    $('#view').scrollTop = nearBottom ? $('#view').scrollHeight : previousScroll;
    signature = nextSignature;
  }
  renderActivity(state,conversationId); updateBrowser(state);
  const disabled = !!state.jobs.find(job => job.conversationId === conversationId && activeStatuses.includes(job.status));
  $('#send-button').disabled = disabled || busy; $('#send-button').title = disabled ? 'Finish or stop the active run before a follow-up.' : 'Send message';
  if ($('#settings-dialog').open) updateAccount();
}

async function refresh() {
  try {
    const response = await fetch(`/api/state${state ? `?revision=${state.revision}` : ''}`);
    if (response.status === 204) return;
    if (!response.ok) throw new Error('Connection lost. Reload to sign in.');
    state = await response.json(); render();
  } catch (error) { $('#connection-label').textContent = 'Reconnecting…'; $('.connection').classList.remove('connected'); if (!state) handleError(error); }
}

async function perform(fn) { try { await fn(); await refresh(); } catch (error) { handleError(error); } }
function openSchedule() {
  $('#schedule-prompt').value = $('#prompt').value;
  const soon = new Date(Date.now() + 60 * 60_000); const local = new Date(soon.valueOf() - soon.getTimezoneOffset() * 60_000);
  $('#schedule-at').value = local.toISOString().slice(0,16); $('#schedule-status').textContent = ''; $('#schedule-dialog').showModal();
}
function updateAccount() {
  const account = state?.runtime.account;
  $('#account-title').textContent = account ? `${account.planType} subscription` : 'Codex subscription';
  $('#account-description').textContent = account?.email || state?.runtime.connectionError || 'Connect your ChatGPT account to start working.';
  $('#connect-account').textContent = account ? 'Refresh' : 'Connect';
  const login = state?.runtime.login;
  $('#login-instructions').hidden = !login;
  if (login?.verificationUrl) {
    const node = $('#login-instructions'); node.replaceChildren();
    const p = document.createElement('p'); p.textContent = 'Open the sign-in page and enter this one-time code:';
    const code = document.createElement('code'); code.textContent = login.userCode;
    const link = document.createElement('a'); link.textContent = 'Open ChatGPT sign-in ↗'; link.href = login.verificationUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; node.append(p,code,link);
  } else if (login?.error) $('#login-instructions').textContent = login.error;
}
function openSettings() { $('#preferences').value = state?.preferences || ''; $('#settings-status').textContent = ''; updateAccount(); $('#settings-dialog').showModal(); }
function search() {
  const query = $('#search-input').value.toLowerCase();
  const found = state?.conversations.filter(c => c.title.toLowerCase().includes(query) || c.messages.some(m => m.text.toLowerCase().includes(query))) || [];
  $('#search-results').innerHTML = found.length ? found.map(c => `<button class="search-result" data-conversation="${esc(c.id)}">${icon('chat')}<span>${esc(c.title)}</span>${icon('arrow-up-right')}</button>`).join('') : '<p class="search-empty">No conversations found. Start a fresh one.</p>';
}

$('#new-chat').onclick = () => navigate();
$('#settings-open').onclick = openSettings; $('#connection-button').onclick = openSettings;
$('#schedule-open').onclick = openSchedule;
$('#menu-button').onclick = () => setNavigation(!document.body.classList.contains('nav-open'));
$('#nav-scrim').onclick = () => { setNavigation(false); $('#menu-button').focus(); };
$('#search-open').onclick = () => { $('#search-dialog').showModal(); $('#search-input').focus(); search(); };
$('#search-input').oninput = search;
$('#attach-button').onclick = () => $('#file-input').click();
$('#file-input').onchange = async () => {
  const file = $('#file-input').files[0]; if (!file) return;
  const form = new FormData(); form.append('file',file);
  await perform(async () => { const saved = await api('/api/files',form); attachments.push(saved); $('#attachments').innerHTML = attachments.map(f => `<span class="attachment-chip">${icon('paperclip')}${esc(f.name)}<button type="button" data-remove-attachment="${esc(f.id)}" aria-label="Remove ${esc(f.name)}">${icon('close')}</button></span>`).join(''); toast('File ready for your task.'); });
  $('#file-input').value = '';
};
$('#composer').onsubmit = async event => {
  event.preventDefault(); const prompt = $('#prompt').value.trim();
  if (!prompt || busy || $('#send-button').disabled) return;
  busy = true; $('#send-button').disabled = true;
  await perform(async () => {
    const job = await api('/api/jobs', { prompt: prompt + (attachments.length ? `\n\nAttached files: ${attachments.map(f => `${f.name} (fileId: ${f.id})`).join(', ')}` : ''), conversationId, interactionMode:$('#interaction-mode').value });
    $('#prompt').value = ''; $('#prompt').style.height = ''; attachments = []; $('#attachments').replaceChildren(); navigate('chat',job.conversationId);
  });
  busy = false; render();
};
$('#prompt').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#composer').requestSubmit(); } };
$('#prompt').oninput = () => { $('#prompt').style.height = 'auto'; $('#prompt').style.height = Math.min($('#prompt').scrollHeight,260) + 'px'; };
$('#preferences-form').onsubmit = event => { event.preventDefault(); void perform(async () => { await api('/api/preferences',{ text:$('#preferences').value },'PUT'); $('#settings-status').textContent = 'Remembered. Applies to your next run.'; }); };
$('#connect-account').onclick = () => perform(async () => { $('#connect-account').disabled = true; try { await api(state?.runtime.account ? '/api/account/refresh' : '/api/account/login',{}); } finally { $('#connect-account').disabled = false; } });
$('#schedule-form').onsubmit = event => { event.preventDefault(); void perform(async () => {
  await api('/api/schedules',{ prompt:$('#schedule-prompt').value, at:new Date($('#schedule-at').value).toISOString(), intervalMinutes:Number($('#schedule-interval').value), interactionMode:'confirm' });
  $('#schedule-dialog').close(); navigate('routines'); toast('On my clock.');
}); };

document.addEventListener('click', event => {
  const target = event.target.closest('button,a'); if (!target) return;
  if (target.dataset.view) navigate(target.dataset.view);
  if (target.dataset.conversation) { $('#search-dialog').close(); navigate('chat',target.dataset.conversation); }
  if (target.hasAttribute('data-new-chat')) navigate();
  if (target.dataset.prompt) { $('#prompt').value = target.dataset.prompt; $('#prompt').focus(); $('#prompt').dispatchEvent(new Event('input')); }
  if (target.hasAttribute('data-schedule-open')) openSchedule();
  if (target.hasAttribute('data-upload')) $('#file-input').click();
  if (target.dataset.filter) { filter = target.dataset.filter; signature = ''; render(); }
  if (target.dataset.cancel) void perform(() => api(`/api/jobs/${target.dataset.cancel}/cancel`,{}));
  if (target.dataset.retry) void perform(() => api(`/api/jobs/${target.dataset.retry}/retry`,{}));
  if (target.dataset.decision) void perform(() => api(`/api/jobs/${target.dataset.job}/answer`,{ requestId:target.dataset.request, decision:target.dataset.decision }));
  if (target.dataset.scheduleToggle) { const s = state.schedules.find(s => s.id === target.dataset.scheduleToggle); void perform(() => api(`/api/schedules/${s.id}`,{ enabled:!s.enabled },'PATCH')); }
  if (target.dataset.scheduleDelete && confirm('Delete this routine? Its previous results stay saved.')) void perform(() => api(`/api/schedules/${target.dataset.scheduleDelete}`,{},'DELETE'));
  if (target.dataset.copy) { const message = state.conversations.flatMap(c => c.messages).find(m => m.id === target.dataset.copy); void navigator.clipboard.writeText(message.text).then(() => toast('Copied.')).catch(handleError); }
  if (target.dataset.removeAttachment) { attachments = attachments.filter(f => f.id !== target.dataset.removeAttachment); target.closest('.attachment-chip').remove(); }
});
document.addEventListener('submit', event => {
  const form = event.target.closest('[data-answer-job]'); if (!form) return;
  event.preventDefault(); void perform(() => api(`/api/jobs/${form.dataset.answerJob}/answer`,{ requestId:form.dataset.request, answer:new FormData(form).get('answer') }));
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search-open').click(); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); navigate(); }
  if (event.key === 'Escape' && document.body.classList.contains('nav-open')) { setNavigation(false); $('#menu-button').focus(); }
  if (event.key === 'Tab' && mobile.matches && document.body.classList.contains('nav-open')) {
    const focusable = [...$('.sidebar').querySelectorAll('a,button')]; const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

$('#view').innerHTML = '<div class="loading-state" role="status"><img src="/mark.svg" width="48" height="48" alt=""><p>Making room for your day…</p></div>';
await refresh();
const initial = location.hash.slice(1).split('/'); if (['chat','runs','routines','files'].includes(initial[0])) navigate(initial[0],initial[1] || null);
if (state && !state.customization) openCustomization(true);
setInterval(() => { if (!document.hidden) void refresh(); }, 1000);
