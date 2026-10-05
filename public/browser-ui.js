import { $, esc, icon, api, handleError } from './ui.js';

let frame = null; let frameBusy = false; let getState; let emptyMarkup; let previouslyControlled = false;
export function setBrowserVisible(visible) {
  document.body.classList.toggle('browser-closed', !visible);
  $('#browser-panel').inert = !visible;
  $('#browser-toggle').setAttribute('aria-expanded', String(visible));
  if (!visible) setBrowserExpanded(false);
  if (visible) void refreshFrame();
}

function setBrowserExpanded(expanded) {
  document.body.classList.toggle('browser-expanded',expanded);
  $('#main').inert = expanded;
  $('#browser-expand').setAttribute('aria-pressed',String(expanded));
  $('#browser-expand').setAttribute('aria-label',expanded ? 'Shrink browser' : 'Expand browser');
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
  $('#control-state').textContent = controlled ? 'You have control' : state.runtime.activeJobId ? 'Agent has control' : state.runtime.browserOpen ? 'Session ready' : 'Not started';
  $('#takeover-controls').hidden = !controlled; $('#browser-navigate').hidden = !controlled;
  $('#browser-viewport').classList.toggle('controlled', controlled);
  $('#panel-footer-text').textContent = controlled ? 'Agent paused until you hand back control' : 'Session stored on your server';
  $('#browser-toggle').classList.toggle('owner-controls',controlled);
  $('#browser-toggle>span:last-child').textContent = controlled ? 'You have control' : 'Browser';
  if (controlled && !previouslyControlled) setBrowserVisible(true);
  previouslyControlled = controlled;
}

async function control(enabled) {
  try { await api('/api/browser/takeover', { enabled: typeof enabled === 'boolean' ? enabled : !getState()?.runtime.takeover }); setBrowserVisible(true); await refreshFrame(); }
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
  $('#browser-close').onclick = () => { setBrowserVisible(false); $('#browser-toggle').focus(); };
  $('#browser-expand').onclick = () => setBrowserExpanded(!document.body.classList.contains('browser-expanded'));
  $('#browser-refresh').onclick = refreshFrame;
  $('#takeover-button').onclick = control;
  $('#browser-viewport').addEventListener('click', event => { if (event.target.closest('#open-browser')) void control(); });
  const tabs = [$('#browser-tab'),$('#activity-tab')];
  tabs.forEach((tab,index) => {
    tab.onclick = () => {
      $('#browser-content').hidden = index !== 0; $('#activity-content').hidden = index !== 1;
      tabs.forEach((item,i) => { item.classList.toggle('selected',i === index); item.setAttribute('aria-selected',String(i === index)); item.tabIndex = i === index ? 0 : -1; });
    };
    tab.onkeydown = event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault(); const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1-index]; next.click(); next.focus();
    };
  });
  document.addEventListener('click',event => { if (event.target.closest('[data-takeover]')) void control(true); });
  document.addEventListener('keydown',event => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]') && !document.body.classList.contains('browser-closed')) { setBrowserVisible(false); $('#browser-toggle').focus(); }
  });
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
