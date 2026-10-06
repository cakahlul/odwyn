import { $, api, toast } from './ui.js';
import { defaults, palettes, choices, paletteDetails, specializations, avatarSvg, sampleReply, validateProfile } from './profile.js';

let getState, saved, step = 0, firstRun = false, adding = false, editingId = null, lastApplied = '', appearanceOnly = false;
const toneDetails = {warm:'Friendly, thoughtful, plainspoken.',crisp:'The answer first. Keep it short.',playful:'A little wit, plenty of useful work.',formal:'Courteous, precise, professional.',patient:'Calm explanations, one step at a time.',coach:'Practical next steps and encouragement.'};
const shapeDetails = {squircle:'Your everyday companion',bean:'Soft and easygoing',orb:'Curious and bright',cat:'A little independent',robot:'Ready to get things done',fox:'Quick and resourceful'};
const readDraft = () => Object.fromEntries(new FormData($('#customize-form')));
const setPalette = (node, palette) => Object.entries(palettes[palette].vars).forEach(([key,value])=>node.style.setProperty(`--${key}`,value));

export function applyProfile(profile, appearance = {}) {
  const p = {...defaults,...profile,...appearance}, signature = JSON.stringify(p);
  if (signature === lastApplied) return;
  lastApplied = signature; setPalette(document.documentElement,p.palette);
  document.documentElement.dataset.motion = p.motion;
  $('#agent-name').textContent = p.name;
  $('#reply-agent').title = p.name;
  document.querySelectorAll('[data-agent-avatar]').forEach(node=>node.innerHTML=avatarSvg(p));
  $('#owner-name').textContent = p.ownerName || 'Your space';
  $('.owner-avatar').textContent = Array.from(p.ownerName || 'You')[0].toUpperCase();
  $('#settings-title').textContent = 'Settings';
  $('#settings-agent-name').textContent = p.name;
  $('#settings-profile-summary').textContent = `${choices.shape[p.shape]} · ${choices.tone[p.tone]}`;
  $('label[for="prompt"]').textContent = `What would you like ${p.name} to do?`;
  document.title = p.name === 'Odwyn' ? 'Odwyn' : `Odwyn · ${p.name}`;
  $('link[rel="icon"]').href = `data:image/svg+xml,${encodeURIComponent(avatarSvg(p))}`;
  $('meta[name="theme-color"]').content = palettes[p.palette].vars.paper;
}

function preview() {
  const draft = readDraft(), p = {...draft,name:draft.name.trim() || defaults.name};
  setPalette($('#profile-preview'),p.palette);
  $('#profile-preview').dataset.motion = p.motion;
  $('#preview-preferences').textContent = `${choices.language[p.language]} · ${choices.detail[p.detail]}`;
  $('#preview-brand-name').textContent = $('#preview-agent-name').textContent = p.name;
  $('#preview-owner').textContent = p.ownerName || 'You';
  $('#preview-heading').textContent = `Message ${p.name}`;
  $('#preview-specialty').textContent = p.specialization || 'Ask a question or give a task.';
  $('#preview-reply').textContent = sampleReply(p);
  for (const id of ['preview-brand-avatar','preview-message-avatar','preview-mascot']) $(`#${id}`).innerHTML = avatarSvg(p);
  document.querySelectorAll('#avatar-choices label').forEach(label=>label.querySelector('span').innerHTML=avatarSvg({...p,shape:label.querySelector('input').value}));
  document.querySelectorAll('[data-specialty]').forEach(button=>button.setAttribute('aria-pressed',String(p.specialization === specializations[button.dataset.specialty])));
}

function showStep(next) {
  step = next;
  document.querySelectorAll('[data-profile-step]').forEach((node,i)=>node.hidden = i !== step);
  document.querySelectorAll('[data-custom-step]').forEach((button,i)=>{ if (i === step) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current'); });
  $('#customize-back').hidden = appearanceOnly || step === 1;
  $('#customize-next').hidden = appearanceOnly || step === 2; $('#customize-save').hidden = !appearanceOnly && step !== 2;
  $('.profile-layout').scrollTop = 0;
  $('#customize-preview').textContent = 'Preview';
}

export function openCustomization(onboarding = false, newAgent = false, workspaceAppearance = false) {
  appearanceOnly = workspaceAppearance; firstRun = onboarding; adding = newAgent; editingId = getState()?.agentId;
  const count = getState().agents.length, palette = Object.keys(palettes)[count % Object.keys(palettes).length];
  const appearance = getState().appearance || {palette:getState()?.customization?.palette || defaults.palette,motion:getState()?.customization?.motion || defaults.motion};
  const draft = adding ? {...defaults,...appearance,bodyColor:palettes[palette].colors[2],shape:Object.keys(choices.shape)[count % Object.keys(choices.shape).length],ownerName:getState()?.customization?.ownerName || '',name:`Agent ${count+1}`} : {...defaults,...getState()?.customization,...appearance};
  $('#settings-dialog').close(); $('#customize-form').reset();
  for (const [key,value] of Object.entries(draft)) $('#customize-form').elements.namedItem(key).value = value;
  $('#customize-title').textContent = appearanceOnly ? 'Workspace appearance' : adding ? 'Add an agent' : 'Customize your agent';
  document.querySelectorAll('[data-custom-step]').forEach(button=>button.hidden = appearanceOnly ? true : button.dataset.customStep === '0');
  $('.profile-steps').hidden = appearanceOnly;
  $('#customize-eyebrow').textContent = appearanceOnly ? 'WORKSPACE · ALL AGENTS' : adding ? 'NEW AGENT · MAXIMUM 5' : firstRun ? 'FIRST-TIME SETUP' : 'AGENT & PERSONALITY';
  $('#customize-save').childNodes[0].textContent = appearanceOnly ? 'Save appearance' : adding ? 'Add agent' : firstRun ? 'Save & start' : 'Save changes';
  $('#customize-defaults').hidden = !firstRun || adding; $('#customize-status').textContent = '';
  showStep(appearanceOnly ? 0 : 1); preview(); $('#customize-dialog').showModal();
}

async function save(profile) {
  const buttons = $('#customize-form').querySelectorAll('button'); buttons.forEach(button=>button.disabled=true);
  $('#customize-status').textContent = 'Saving…';
  try {
    const result = appearanceOnly ? await api('/api/appearance',{palette:profile.palette,motion:profile.motion},'PUT') : await api(adding ? '/api/agents' : `/api/customization?agentId=${editingId}`,validateProfile(profile),adding ? 'POST' : 'PUT');
    $('#customize-dialog').close(); await saved(result,adding); toast(appearanceOnly ? 'Workspace appearance saved.' : adding ? 'Agent added. Choose its AI provider.' : firstRun ? 'Your space is ready.' : 'Saved. Your agent gets the changes on its next task.');
  } catch (error) { $('#customize-status').textContent = error.message; }
  finally { buttons.forEach(button=>button.disabled=false); }
}

export function setupCustomization(state, onSaved) {
  getState = state; saved = onSaved;
  $('#palette-choices').innerHTML = Object.entries(palettes).map(([value,p])=>`<label class="palette-option"><input type="radio" name="palette" value="${value}"><svg viewBox="0 0 96 32" aria-hidden="true">${p.colors.map((color,i)=>`<rect x="${i*32}" width="32" height="32" fill="${color}"/>`).join('')}</svg><span><strong>${p.name}</strong><small>${paletteDetails[value]}</small></span></label>`).join('');
  $('#avatar-choices').innerHTML = Object.entries(choices.shape).map(([value,name])=>`<label class="avatar-option"><input type="radio" name="shape" value="${value}"><span></span><strong>${name}</strong><small>${shapeDetails[value]}</small></label>`).join('');
  for (const key of ['eyes','mouth','accessory','motion','language','detail']) $(`#customize-form select[name="${key}"]`).innerHTML = Object.entries(choices[key]).map(([value,name])=>`<option value="${value}">${name}</option>`).join('');
  $('#specialty-presets').innerHTML = Object.keys(specializations).map(key=>`<button type="button" data-specialty="${key}" aria-pressed="false">${key === 'general' ? 'All-rounder' : key[0].toUpperCase()+key.slice(1)}</button>`).join('');
  document.querySelectorAll('[data-specialty]').forEach(button=>button.onclick=()=>{ $('#agent-specialization').value = specializations[button.dataset.specialty]; preview(); });
  document.querySelectorAll('[data-profile-icon]').forEach(node=>{
    const kind = node.dataset.profileIcon;
    if (kind === 'agent') { node.innerHTML = avatarSvg(defaults); return; }
    const id = `step-${kind}`, body = kind === 'look' ? '<path d="M60 18C34 18 15 35 15 58s20 42 43 42c12 0 17-7 12-15-5-9 0-16 12-16h8c26 0 16-51-30-51Z"/>' : '<circle cx="60" cy="36" r="21"/><path d="M24 98V86a36 36 0 0 1 72 0v12Z"/>';
    node.innerHTML = `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="${id}"><stop stop-color="#ffe1bb"/><stop offset=".5" stop-color="#ee9970"/><stop offset="1" stop-color="#a64b44"/></linearGradient></defs><g fill="#9c5047" transform="translate(2 5)">${body}</g><g fill="url(#${id})">${body}</g>${kind === 'look' ? '<circle cx="35" cy="53" r="8" fill="#84ad83"/><circle cx="57" cy="37" r="8" fill="#658bbd"/><circle cx="80" cy="44" r="8" fill="#d98bab"/>' : ''}</svg>`;
  });
  $('#tone-choices').innerHTML = Object.entries(choices.tone).map(([value,name])=>`<label class="tone-option"><input type="radio" name="tone" value="${value}"><span><strong>${name}</strong><small>${toneDetails[value]}</small></span></label>`).join('');
  $('#customize-form').oninput = preview;
  $('#customize-open').onclick = () => openCustomization();
  $('#appearance-open').onclick = () => openCustomization(false,false,true);
  $('#customize-close').onclick = () => $('#customize-dialog').close();
  $('#customize-preview').onclick = () => {
    const button = $('#customize-preview');
    if (button.textContent === 'Preview') { $('#profile-preview').scrollIntoView({block:'start',behavior:'smooth'}); button.textContent = 'Choices'; }
    else { $('.profile-layout').scrollTo({top:0,behavior:'smooth'}); button.textContent = 'Preview'; }
  };
  $('#customize-defaults').onclick = () => save({...defaults});
  $('#customize-back').onclick = () => showStep(step-1);
  $('#customize-next').onclick = () => { const invalid = $(`[data-profile-step="${step}"]`).querySelector(':invalid'); if (invalid) return invalid.reportValidity(); showStep(step+1); };
  document.querySelectorAll('[data-custom-step]').forEach(button=>button.onclick=()=>showStep(Number(button.dataset.customStep)));
  $('#preview-source').onclick = event => event.preventDefault();
  $('#customize-form').onsubmit = event => {
    event.preventDefault();
    if (!appearanceOnly && step < 2) { $('#customize-next').click(); return; }
    const invalid = !appearanceOnly && $('#customize-form').querySelector('input:invalid,textarea:invalid');
    if (invalid) { showStep(Number(invalid.closest('[data-profile-step]').dataset.profileStep)); invalid.reportValidity(); return; }
    void save(readDraft());
  };
}
