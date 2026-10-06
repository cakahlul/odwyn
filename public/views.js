import { $, esc, icon, mascot, badge, date, richText, activeStatuses } from './ui.js';
import { defaults, avatarSvg } from './profile.js';

const suggestions = [
  ['globe','Research a topic','Find information and include sources.','Research the best places to visit in Yogyakarta for a relaxed weekend. Use the browser and include your sources.'],
  ['folder','Compare options','Compare prices, features, or availability.','Help me compare options for a new desk. Ask me about budget and size before browsing.'],
  ['clock','Monitor a website','Schedule a recurring check.','Help me set up a recurring check of my KPI dashboard. Ask for the website and schedule first.'],
];

export function recentConversations(state) {
  const activity = new Map(state.conversations.map(c => [c.id,c.messages.reduce((latest,m)=>Math.max(latest,Date.parse(m.at)),Date.parse(c.createdAt))]));
  for (const job of state.jobs) {
    if (!activity.has(job.conversationId)) continue;
    for (const at of [job.createdAt,job.endedAt,job.events.at(-1)?.at]) if (at) activity.set(job.conversationId,Math.max(activity.get(job.conversationId),Date.parse(at)));
  }
  return state.conversations.map(c=>({...c,activityAt:new Date(activity.get(c.id)).toISOString()})).sort((a,b)=>b.activityAt.localeCompare(a.activityAt));
}

export function renderChat(state, conversationId) {
  const profile = {...defaults,...state.customization};
  const conversation = state.conversations.find(c => c.id === conversationId);
  const jobs = state.jobs.filter(j => j.conversationId === conversationId);
  const roundJobs = conversation?.kind === 'room' && jobs[0]?.roomRoundId ? jobs.filter(j=>j.roomRoundId===jobs[0].roomRoundId) : jobs;
  const latest = roundJobs.find(j=>activeStatuses.includes(j.status) && j.status !== 'queued') || roundJobs.find(j=>j.status === 'queued') || (conversation?.kind === 'room' && roundJobs.find(j=>j.error)) || jobs[0];
  if (!conversation) {
    const recent = recentConversations(state).slice(0,3);
    const rows = recent.length ? recent.map(c=> {
      const job = state.jobs.find(j=>j.conversationId === c.id);
      return `<button class="suggestion recent-conversation" data-conversation="${esc(c.id)}">${icon('chat')}<span class="suggestion-copy"><strong>${esc(c.title)}</strong><small><time datetime="${esc(c.activityAt)}">${esc(date(c.activityAt))}</time></small></span>${job ? badge(job.status) : ''}<span class="suggestion-arrow">${icon('arrow-up-right')}</span></button>`;
    }).join('') : suggestions.map(([symbol,title,description,prompt])=>`<button class="suggestion" data-prompt="${esc(prompt)}">${icon(symbol)}<span class="suggestion-copy"><strong>${title}</strong><small>${description}</small></span><span class="suggestion-arrow">${icon('arrow-up-right')}</span></button>`).join('');
    const paused = document.body.classList.contains('mascot-paused');
    return `<div class="welcome"><div class="welcome-title"><div><h1>Message ${esc(profile.name)}</h1><p>${esc(profile.specialization || 'Ask a question or give a task. Attach files for context.')}</p></div><button type="button" class="mascot-stage" data-mascot-toggle aria-label="Animate agent avatar" aria-pressed="${!paused}" title="${paused ? 'Resume' : 'Pause'} avatar animation">${state.customization ? avatarSvg(profile,'mascot') : mascot}<i class="mascot-spark spark-one" aria-hidden="true"></i><i class="mascot-spark spark-two" aria-hidden="true"></i><i class="mascot-spark spark-three" aria-hidden="true"></i></button></div><section class="suggestions" aria-label="${recent.length ? 'Recent conversations' : 'Example tasks'}"><h2 class="suggestions-heading">${recent.length ? 'Recent conversations' : 'Example tasks'}</h2>${rows}</section></div>`;
  }
  if (conversation.kind === 'room' && !conversation.messages.length) return '<div class="room-welcome"><span class="eyebrow">A SHARED SPACE FOR DIFFERENT PERSPECTIVES</span><h2>Start the conversation</h2><p>Set a goal and your agents will discuss, work, and verify the result together. Type @ to call an agent. Send a new direction anytime; all replies stay visible here.</p></div>';
  const browsing = jobs.find(job => job.id === state.runtime.activeJobId && (job.browserUsed || job.events.some(event=>/^(Reading page|navigate|click|fill|type|press|scroll|select|tab|new tab|back|screenshot|save screenshot|wait|upload|dialog)$/.test(event.label))));
  const waiting = jobs.find(job => job.pending);
  const workingAgent = state.agents.find(a => a.id === latest?.agentId);
  const workingProfile = workingAgent?.customization || profile;
  return `<div class="conversation"><div class="conversation-start"><span>${esc(date(conversation.createdAt))}</span><span class="conversation-line"></span></div><div class="messages" id="messages"></div>${conversation.discussion ? `<p id="room-discussion-status" class="field-hint" role="status">${esc({active:`Working toward your goal · Round ${conversation.discussion.round}`,completed:'Goal complete · Shared result agreed',stopped:'Discussion stopped',paused:'Discussion paused · Review progress and send a message to continue'}[conversation.discussion.status] || '')}</p>` : ''}${browsing ? `<details class="conversation-browser" id="conversation-browser" data-job="${esc(browsing.id)}"><summary>${icon('globe')}<strong>Live browser</strong><span class="preview-minimize">Minimize</span><span class="preview-expand">Show browser</span></summary><div class="conversation-browser-content"><div id="conversation-browser-url" class="conversation-browser-url"></div><img id="conversation-browser-image" width="1280" height="800" alt="Live view of the page the assistant is browsing" draggable="false" hidden><p id="conversation-browser-status" role="status">Opening browser…</p><div class="conversation-browser-footer"><span>What ${esc(state.runtime.activeAgentName || profile.name)} sees · updates live</span><button type="button" class="text-button" data-browser-controls>Browser controls${icon('arrow-up-right')}</button></div></div></details><button type="button" class="browser-preview-bubble" data-restore-browser aria-label="Show live browser" hidden>${icon('globe')}<span>Live browser</span>${icon('arrow-up-right')}</button>` : ''}${waiting ? pendingCard(waiting) : ''}${latest && activeStatuses.includes(latest.status) ? `<div class="working-row">${avatarSvg(workingProfile,"working-avatar")}<span><strong>${esc(workingProfile.name)}</strong>${badge(latest.status)}<small>${esc(latest.events.at(-1)?.detail || (latest.status === 'queued' && !workingAgent?.runtime.account ? 'Configure your AI provider in Customize agent to begin.' : 'Working through your request.'))}</small></span><button class="text-button" ${conversation.kind === 'room' ? `data-stop-room="${esc(conversation.id)}"` : `data-cancel="${esc(latest.id)}"`}>${conversation.kind === 'room' ? 'Stop discussion' : 'Stop'}</button></div>` : ''}${latest?.error ? `<div class="task-error"><strong>${esc(badgeText(latest.status))}</strong><p>${esc(latest.error)}</p><button class="secondary-button" data-retry="${esc(latest.id)}">Review & resume${icon('play')}</button></div>` : ''}${renderAttachments(state,jobs.filter(job=>!conversation.messages.some(m=>m.role==='assistant' && !m.roomReport && m.jobId===job.id)).flatMap(job=>job.files))}</div>`;
}

function badgeText(status) { return status === 'interrupted' ? 'Paused after an interruption' : 'This needs a little attention'; }

function pendingCard(job) {
  const pending = job.pending;
  return `<section class="approval-card" data-request="${esc(pending.id)}" aria-label="Pending owner input"><div class="approval-heading"><span class="approval-icon">${icon(pending.type === 'question' ? 'chat' : 'shield')}</span><span class="eyebrow">OVER TO YOU</span></div><h2>${esc(pending.title)}</h2><p>${esc(pending.detail)}</p>${pending.url ? `<div class="approval-target">${icon('globe')}<span>${esc(pending.url)}</span></div>` : ''}${pending.target ? `<p class="approval-preview">Target: <strong>${esc(pending.target)}</strong>${pending.preview ? `<br>${pending.type === 'terminal' ? `Command: <code>${esc(pending.preview)}</code>` : `Text: ${esc(pending.preview)}`}` : ''}</p>` : ''}${pending.type === 'question' ? `<form class="answer-form" data-answer-job="${esc(job.id)}" data-request="${esc(pending.id)}"><label class="sr-only" for="owner-answer">Your answer</label><textarea id="owner-answer" name="answer" required rows="2" maxlength="8000" placeholder="Add the missing detail, or take browser control…"></textarea><button class="primary-button">Continue${icon('arrow-up')}</button></form>` : `<div class="approval-actions"><button class="primary-button" data-decision="allow" data-job="${esc(job.id)}" data-request="${esc(pending.id)}">Allow action${icon('check')}</button><button class="secondary-button" data-decision="deny" data-job="${esc(job.id)}" data-request="${esc(pending.id)}">Decline</button>${!['payment','credential'].includes(pending.risk) ? `<button class="text-button" data-decision="allow-run" data-job="${esc(job.id)}" data-request="${esc(pending.id)}">Always approve · except payments</button>` : ''}</div>`}</section>`;
}

export function insertMessages(state, conversationId) {
  const container = $('#messages');
  if (!container) return;
  const conversation = state.conversations.find(c => c.id === conversationId);
  for (const message of conversation?.messages || []) {
    const author = message.agentId || state.jobs.find(j => j.id === message.jobId)?.agentId || conversation.agentId || state.agentId;
    const profile = {...defaults,...(state.agents.find(a => a.id === author)?.customization || message.agentProfile || state.customization)};
    const article = document.createElement('article'); article.className = `message message-${message.role === 'user' ? 'user' : 'assistant'}`;
    article.innerHTML = `<div class="message-meta">${message.role === 'assistant' ? avatarSvg(profile,'message-avatar') : `<span class="message-owner">${esc(Array.from(profile.ownerName || 'You')[0].toUpperCase())}</span>`}<strong>${esc(message.role === 'assistant' ? profile.name : profile.ownerName || 'You')}</strong><time>${esc(new Intl.DateTimeFormat(undefined, { hour:'numeric', minute:'2-digit' }).format(new Date(message.at)))}</time><button class="icon-button copy-message" data-copy="${esc(message.id)}" aria-label="Copy message">${icon('copy')}</button></div>`;
    article.append(richText(message.text, { cards:message.role === 'assistant' }));
    if (message.role === 'assistant' && !message.roomReport && conversation.messages.findLast(m=>m.role==='assistant' && !m.roomReport && m.jobId===message.jobId) === message) {
      const files = state.jobs.find(j=>j.id===message.jobId)?.files || [];
      article.insertAdjacentHTML('beforeend',renderAttachments(state,files));
      article.querySelectorAll('.answer-file img').forEach(img=>img.addEventListener('error',()=>{ img.parentElement.hidden=true; },{once:true}));
    }
    container.append(article);
  }
}

function renderAttachments(state, ids) {
  const files = [...new Set(ids)].map(id=>state.files.find(file=>file.id===id)).filter(Boolean);
  if (!files.length) return '';
  return `<div class="result-files" aria-label="Answer files">${files.map(file=> {
    const image = file.mimeType ? file.mimeType.startsWith('image/') : file.kind === 'screenshot' || /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(file.name);
    return `<div class="answer-file">${image ? `<a href="/api/files/${esc(file.id)}/preview" target="_blank" rel="noopener" aria-label="Preview ${esc(file.name)}"><img src="/api/files/${esc(file.id)}/preview" alt="Preview of ${esc(file.name)}" loading="lazy"></a>` : ''}<a href="/api/files/${esc(file.id)}" class="file-chip" download="${esc(file.name)}">${icon('download')}<span>${esc(file.name)}</span></a></div>`;
  }).join('')}</div>`;
}

export function renderRuns(state, filter) {
  const jobs = filter === 'active' ? state.jobs.filter(j => activeStatuses.includes(j.status)) : state.jobs;
  return `<section class="collection"><div class="collection-heading"><h1>Task runs</h1><p>Track progress, review results, or resume interrupted work.</p></div><div class="collection-toolbar"><div class="segmented"><button data-filter="all" class="${filter === 'all' ? 'selected' : ''}">All runs <span>${state.jobs.length}</span></button><button data-filter="active" class="${filter === 'active' ? 'selected' : ''}">In motion <span>${state.jobs.filter(j => activeStatuses.includes(j.status)).length}</span></button></div></div>${jobs.length ? `<div class="run-list">${jobs.map(job => `<article class="run-row"><span class="run-symbol">${icon(job.scheduleId ? 'clock' : 'chat')}</span><div class="run-copy"><button data-conversation="${esc(job.conversationId)}" class="run-title">${esc(job.prompt.slice(0,140))}</button><small>${esc(date(job.createdAt))} · ${job.toolCount} browser/tool steps</small>${job.error ? `<p class="run-error">${esc(job.error)}</p>` : ''}</div>${badge(job.status)}<button class="icon-button" data-conversation="${esc(job.conversationId)}" aria-label="Open task conversation">${icon('arrow-up-right')}</button></article>`).join('')}</div>` : empty('activity', filter === 'active' ? 'No active tasks' : 'No task runs yet', 'Send a message to start a task.', 'Start a conversation', 'data-new-chat') }</section>`;
}

export function renderRoutines(state) {
  return `<section class="collection"><div class="collection-heading"><h1>Routines</h1><p>Scheduled tasks and recurring checks.</p></div><div class="collection-toolbar"><span>${state.schedules.filter(s => s.enabled).length} active routines</span><button class="primary-button" data-schedule-open>New routine ${icon('clock')}</button></div>${state.schedules.length ? `<div class="routine-list">${state.schedules.map(schedule => `<article class="routine-row"><span class="routine-symbol">${icon('clock')}</span><div><span class="routine-frequency">${schedule.intervalMinutes === 1440 ? 'DAILY' : schedule.intervalMinutes === 10080 ? 'WEEKLY' : schedule.intervalMinutes === 60 ? 'HOURLY' : schedule.intervalMinutes ? `EVERY ${schedule.intervalMinutes} MINUTES` : 'ONE TIME'}</span><h2>${esc(schedule.prompt.slice(0,150))}</h2><p>${schedule.enabled ? `Next: ${esc(date(schedule.nextAt))}` : 'Paused'}${schedule.lastAt ? ` · Last: ${esc(date(schedule.lastAt))}` : ''}</p></div><button class="icon-button" data-schedule-toggle="${esc(schedule.id)}" aria-label="${schedule.enabled ? 'Pause' : 'Enable'} routine">${icon(schedule.enabled ? 'pause' : 'play')}</button><button class="icon-button" data-schedule-delete="${esc(schedule.id)}" aria-label="Delete routine">${icon('trash')}</button></article>`).join('')}</div>` : empty('clock', 'No routines yet', 'A daily KPI check, a weekly shortlist, a reminder to follow up.', 'Create your first routine', 'data-schedule-open')}</section>`;
}

export function renderFiles(state) {
  return `<section class="collection"><div class="collection-heading"><h1>Files & results</h1><p>Downloads, screenshots, and files you’ve shared.</p></div><div class="collection-toolbar"><span>${state.files.length} files</span><button class="primary-button" data-upload>Share a file ${icon('paperclip')}</button></div>${state.files.length ? `<div class="file-list">${[...state.files].reverse().map(file => `<a class="file-row" href="/api/files/${esc(file.id)}" download><span class="file-symbol">${icon(file.kind === 'screenshot' ? 'globe' : 'folder')}</span><span><strong>${esc(file.name)}</strong><small>${esc(file.kind)} · ${esc(date(file.createdAt))}</small></span>${icon('download')}</a>`).join('')}</div>` : empty('folder', 'No files yet', 'Ask for a screenshot or download. Or share a file for a task.', 'Share a file', 'data-upload')}</section>`;
}

function empty(symbol, title, description, button, attribute) { return `<div class="collection-empty"><span class="empty-symbol">${icon(symbol)}</span><h2>${title}</h2><p>${description}</p><button class="secondary-button" ${attribute}>${button}${icon('arrow-up-right')}</button></div>`; }

export function renderActivity(state, conversationId) {
  const jobs = state.jobs.filter(job => job.conversationId === conversationId);
  $('#activity-count').textContent = jobs.reduce((sum, job) => sum + job.events.length, 0) || '';
  $('#activity-list').innerHTML = jobs.length ? jobs.map(job => `<div class="activity-job"><div class="activity-job-heading">${badge(job.status)}<small>${esc(date(job.createdAt))}</small></div>${job.events.map((event,index) => `<div class="activity-item"><span class="activity-marker">${index === job.events.length - 1 && job.status === 'running' ? '<i></i>' : icon('check')}</span><div><strong>${esc(event.label)}</strong>${event.detail ? `<p>${esc(event.detail)}</p>` : ''}<time>${esc(new Intl.DateTimeFormat(undefined, { hour:'numeric', minute:'2-digit' }).format(new Date(event.at)))}</time></div></div>`).join('')}</div>`).join('') : `<div class="activity-empty">${icon('activity')}<h2>No activity yet</h2><p>Browser actions and task progress appear here.</p></div>`;
}
