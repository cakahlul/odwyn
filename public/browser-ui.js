import { $, esc, icon, api, handleError } from './ui.js';

let frame = null; let frameBusy = false; let getState; let emptyMarkup;
export function setBrowserVisible(visible) {
  document.body.classList.toggle('browser-closed', !visible);
  $('#browser-toggle').setAttribute('aria-expanded', String(visible));
  if (visible) void refreshFrame();
}

export async function refreshFrame() {
  if (frameBusy || document.hidden || document.body.classList.contains('browser-closed')) return;
  frameBusy = true;
  try {
    const response = await fetch('/api/browser/frame');
    if (!response.ok) return;
    frame = await response.json();
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
  } catch {} finally { frameBusy = false; }
}

export function updateBrowser(state) {
  const controlled = state.runtime.takeover;
  $('#takeover-button').innerHTML = controlled ? `Hand back ${icon('play')}` : `Take control ${icon('cursor')}`;
  $('#control-state').textContent = controlled ? 'You’re in control' : state.runtime.activeJobId ? 'Sidekick is working' : state.runtime.browserOpen ? 'Ready when you are' : 'Browser resting';
  $('#takeover-controls').hidden = !controlled; $('#browser-navigate').hidden = !controlled;
  $('#browser-viewport').classList.toggle('controlled', controlled);
  $('#panel-footer-text').textContent = controlled ? 'Finish your step, then hand the browser back.' : 'One thing at a time. Done properly.';
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
  $('#browser-toggle').onclick = () => setBrowserVisible(document.body.classList.contains('browser-closed'));
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
  const narrow = matchMedia('(max-width: 1100px)');
  if (narrow.matches) setBrowserVisible(false);
  narrow.addEventListener('change', event => { if (event.matches) setBrowserVisible(false); });
}
