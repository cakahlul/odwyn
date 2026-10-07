import { $, esc, icon, api, handleError } from './ui.js';

let frame = null; let frameBusy = false; let getState; let emptyMarkup;
const minimizedPreviews = new Set();
let previewJobId = null;
export function setBrowserVisible(visible) {
  document.body.classList.toggle('browser-closed', !visible);
  const toggle = $('#browser-toggle'), panel = $('#browser-panel');
  if (!visible && panel.contains(document.activeElement)) toggle.focus();
  panel.inert = !visible;
  toggle.setAttribute('aria-expanded', String(visible));
  toggle.title = visible ? 'Hide browser panel' : 'Open browser panel';
  toggle.setAttribute('aria-label', toggle.title);
  if (visible) void refreshFrame();
}

function updateConversationFrame() {
  const preview = $('#conversation-browser');
  if (!preview) return;
  const current = frame?.jobId === preview.dataset.job || frame?.jobId === undefined && getState()?.runtime.activeJobId === preview.dataset.job ? frame : null;
  const image = $('#conversation-browser-image'), status = $('#conversation-browser-status');
  image.hidden = !current?.image;
  if (current?.image) image.src = `data:image/jpeg;base64,${current.image}`;
  else image.removeAttribute('src');
  status.hidden = !!current?.image;
  status.textContent = current?.dialog ? `Website confirmation: ${current.dialog}. Open browser controls to respond.` : 'Waiting for the browser preview…';
  $('#conversation-browser-url').textContent = current?.url === 'about:blank' ? 'Ready for a website' : current?.url || '';
}

export async function refreshFrame() {
  if (frameBusy || document.hidden || (document.body.classList.contains('browser-closed') && !$('#conversation-browser')?.open)) return;
  frameBusy = true;
  try {
    const response = await fetch('/api/browser/frame');
    if (!response.ok) throw new Error('Browser preview unavailable');
    frame = await response.json();
    updateConversationFrame();
    if (!frame) {
      if ($('#browser-image') || $('.browser-dialog')) $('#browser-viewport').innerHTML = emptyMarkup;
      $('#browser-url').textContent = 'No page open'; return;
    }
    const current = $('#browser-viewport');
    if (frame.dialog) current.innerHTML = `<div class="browser-dialog"><h2>Website confirmation</h2><p>${esc(frame.dialog)}</p><button class="secondary-button" data-dialog="accept">Accept</button><button class="secondary-button" data-dialog="dismiss">Dismiss</button></div>`;
    else if (frame.image) {
      let image = $('#browser-image');
      if (!image) { current.innerHTML = '<img id="browser-image" alt="Live preview of the assistant browser. Take control to interact." draggable="false">'; image = $('#browser-image'); }
      image.src = `data:image/jpeg;base64,${frame.image}`;
    }
    $('#browser-url').textContent = frame.url === 'about:blank' ? 'Ready for a website' : frame.url;
    $('#browser-url').title = frame.url;
    const tabs = frame.tabs || [];
    let select = $('#browser-tabs');
    if (tabs.length > 1) {
      if (!select) { select = document.createElement('select'); select.id = 'browser-tabs'; select.setAttribute('aria-label','Browser tab'); $('#browser-navigate').before(select); }
      const options = tabs.map(tab => `<option value="${tab.index}" ${tab.active ? 'selected' : ''}>${esc(tab.url === 'about:blank' ? 'New tab' : tab.url)}</option>`).join('');
      if (select.innerHTML !== options) select.innerHTML = options;
    } else select?.remove();
  } catch {
    const status = $('#conversation-browser-status');
    if (status) { status.hidden = false; status.textContent = 'Preview unavailable. Retrying…'; }
  } finally { frameBusy = false; }
}

function positionPreviewButton() {
  const restore = $('[data-restore-browser]');
  if (!restore) return;
  restore.style.top = `${$('#view').getBoundingClientRect().top + 12}px`;
  restore.style.right = `${innerWidth - $('#main').getBoundingClientRect().right + 16}px`;
}

export function updateBrowser(state) {
  const preview = $('#conversation-browser'), restore = $('[data-restore-browser]');
  if (preview && previewJobId !== preview.dataset.job) {
    previewJobId = preview.dataset.job; frame = null;
    if (!state.runtime.takeover) setBrowserVisible(false);
  }
  if (preview && !preview.dataset.ready) {
    preview.dataset.ready = 'true';
    preview.open = !minimizedPreviews.has(preview.dataset.job);
    preview.hidden = !preview.open; restore.hidden = preview.open;
    preview.ontoggle = () => {
      if (!preview.isConnected) return;
      preview.hidden = !preview.open; restore.hidden = preview.open;
      if (!preview.open) restore.focus({preventScroll:true});
      if (preview.open) { minimizedPreviews.delete(preview.dataset.job); void refreshFrame(); }
      else minimizedPreviews.add(preview.dataset.job);
    };
    restore.onclick = () => { preview.hidden = false; preview.open = true; restore.hidden = true; preview.querySelector('summary').focus({preventScroll:true}); preview.scrollIntoView({block:'nearest'}); };
    preview.querySelector('[data-browser-controls]').onclick = () => { setBrowserVisible(true); $('#browser-tab').click(); $('#takeover-button').focus(); };
  }
  positionPreviewButton();
  updateConversationFrame();
  if (preview?.open && frame?.jobId !== preview.dataset.job) void refreshFrame();
  const controlled = state.runtime.takeover;
  $('#takeover-button').innerHTML = controlled ? `Hand back ${icon('play')}` : `Take control ${icon('cursor')}`;
  $('#control-state').textContent = controlled ? 'You’re in control' : state.runtime.activeJobId ? `${state.runtime.activeAgentName || state.customization?.name || 'Odwyn'} is working` : state.runtime.browserOpen ? 'Browser open' : 'Browser closed';
  $('#takeover-controls').hidden = !controlled; $('#browser-navigate').hidden = !controlled;
  $('#browser-viewport').classList.toggle('controlled', controlled);
  $('#panel-footer-text').textContent = controlled ? 'Finish your step, then hand the browser back.' : 'Browser actions appear in the Activity tab.';
  if (controlled) setBrowserVisible(true);
}

async function control() {
  try { await api('/api/browser/takeover', { enabled: !getState()?.runtime.takeover }); await refreshFrame(); }
  catch (error) { handleError(error); }
}
async function action(input) {
  try { await api('/api/browser/action', input); await refreshFrame(); }
  catch (error) { handleError(error); }
}

export function setupBrowser(stateGetter) {
  getState = stateGetter;
  emptyMarkup = $('#browser-viewport').innerHTML;
  $('#browser-toggle').onclick = () => {
    const visible = document.body.classList.contains('browser-closed');
    setBrowserVisible(visible);
    if (visible) $('#browser-close').focus();
  };
  $('#browser-panel').addEventListener('keydown', event => {
    if (event.key === 'Escape') { setBrowserVisible(false); event.preventDefault(); event.stopPropagation(); }
  });
  $('#browser-close').onclick = () => setBrowserVisible(false);
  $('#browser-refresh').onclick = refreshFrame;
  $('#takeover-button').onclick = control;
  $('#browser-viewport').addEventListener('click', event => { if (event.target.closest('#open-browser')) void control(); });
  $('#browser-tab').onclick = () => {
    $('#browser-content').hidden = false; $('#activity-content').hidden = true;
    $('#browser-tab').classList.add('selected'); $('#activity-tab').classList.remove('selected');
    $('#browser-tab').setAttribute('aria-selected','true'); $('#activity-tab').setAttribute('aria-selected','false');
  };
  $('#activity-tab').onclick = () => {
    $('#browser-content').hidden = true; $('#activity-content').hidden = false;
    $('#activity-tab').classList.add('selected'); $('#browser-tab').classList.remove('selected');
    $('#browser-tab').setAttribute('aria-selected','false'); $('#activity-tab').setAttribute('aria-selected','true');
  };
  $('#browser-navigate').onsubmit = event => { event.preventDefault(); void action({ action:'navigate', url:$('#navigate-url').value }); };
  $('#browser-type').onsubmit = event => { event.preventDefault(); const text = $('#browser-text').value; $('#browser-text').value = ''; void action({ action:'type', text }); };
  $('#browser-back').onclick = () => action({ action:'back' });
  $('#takeover-controls').onclick = event => {
    const key = event.target.closest('[data-key]'); const scroll = event.target.closest('[data-scroll]');
    if (key) void action({ action:'press', text:key.dataset.key });
    if (scroll) void action({ action:'scroll', delta:Number(scroll.dataset.scroll) });
  };
  $('#browser-viewport').onclick = event => {
    if (!getState()?.runtime.takeover) return;
    const dialog = event.target.closest('[data-dialog]'); if (dialog) { void action({ action:'dialog', choice:dialog.dataset.dialog }); return; }
    if (event.target.id !== 'browser-image' || !frame?.width) return;
    const bounds = event.target.getBoundingClientRect();
    void action({ action:'click', x:(event.clientX - bounds.left) / bounds.width * frame.width, y:(event.clientY - bounds.top) / bounds.height * frame.height });
  };
  $('#browser-panel').onchange = event => { if (event.target.id === 'browser-tabs' && getState()?.runtime.takeover) void action({ action:'tab', index:Number(event.target.value) }); };
  setInterval(refreshFrame, 1600);
  addEventListener('resize',positionPreviewButton);
  const narrow = matchMedia('(max-width: 1100px)');
  if (narrow.matches) setBrowserVisible(false);
  narrow.addEventListener('change', event => { if (event.matches) setBrowserVisible(false); });
}
