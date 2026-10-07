import { $, api, toast } from './ui.js';
import { defaults, resolveProfile, ownerPreferenceKeys, palettes, choices, paletteDetails, materialDefaults, customColorKeys, appearanceVars, validateAppearance, specializations, avatarSvg, sampleReply, validateProfile } from './profile.js';

let getState, saved, providerDraft = () => undefined, step = 0, firstRun = false, adding = false, editingId = null, lastApplied = '', appearanceOnly = false;
const toneDetails = {warm:'Friendly, thoughtful, plainspoken.',crisp:'The answer first. Keep it short.',playful:'A little wit, plenty of useful work.',formal:'Courteous, precise, professional.',patient:'Calm explanations, one step at a time.',coach:'Practical next steps and encouragement.'};
let ownerDraft = {};
const readDraft = () => ({...Object.fromEntries(new FormData($('#customize-form'))),...Object.fromEntries(ownerPreferenceKeys.map(key=>[key,$('#customize-form').elements.namedItem(key).disabled ? ownerDraft[key] : $('#customize-form').elements.namedItem(key).value])),overrideWorkspace:$('#workspace-override').checked});
export const setAppearance = (node, appearance) => Object.entries(appearanceVars(appearance)).forEach(([key,value])=>node.style.setProperty(`--${key}`,value));
const setPalette = (node, palette) => setAppearance(node,{palette});

export function applyProfile(profile, appearance = {}, owner = {}) {
  const p = resolveProfile(profile,appearance,owner), signature = JSON.stringify([p,appearance,owner]);
  if (signature === lastApplied) return;
  lastApplied = signature; setAppearance(document.documentElement,{...appearance,palette:p.palette,customColors:profile?.overrideWorkspace ? {} : appearance.customColors});
  document.documentElement.style.setProperty('--workspace-accent',appearanceVars(appearance).orange);
  document.documentElement.dataset.motion = p.motion;
  $('#agent-name').textContent = p.name;
  $('#reply-agent').title = p.name;
  document.querySelectorAll('[data-agent-avatar]').forEach(node=>node.innerHTML=avatarSvg(p));
  $('#owner-name').textContent = owner.ownerName || 'Your space';
  $('.owner-avatar').textContent = Array.from(owner.ownerName || 'You')[0].toUpperCase();
  $('label[for="prompt"]').textContent = `What would you like ${p.name} to do?`;
  document.title = p.name === 'Odwyn' ? 'Odwyn' : `Odwyn · ${p.name}`;
  $('link[rel="icon"]').href = `data:image/svg+xml,${encodeURIComponent(avatarSvg(p))}`;
  $('meta[name="theme-color"]').content = appearanceVars({...appearance,palette:p.palette,customColors:profile?.overrideWorkspace ? {} : appearance.customColors}).paper;
}

function preview() {
  const draft = readDraft(), p = {...resolveProfile(draft,appearanceOnly ? {} : getState().appearance,getState().owner),name:draft.name.trim() || defaults.name};
  ownerDraft = Object.fromEntries(ownerPreferenceKeys.map(key=>[key,draft[key]]));
  for (const key of ownerPreferenceKeys) { const field = $('#customize-form').elements.namedItem(key); field.disabled = !draft.overrideWorkspace; field.value = draft.overrideWorkspace ? ownerDraft[key] : p[key]; }
  $('#workspace-override-fields').hidden = !appearanceOnly && !draft.overrideWorkspace;
  setPalette($('#profile-preview'),p.palette);
  $('#profile-preview').dataset.motion = p.motion;
  $('#appearance-inherit-hint').hidden = appearanceOnly || draft.overrideWorkspace;
  $('#preview-brand-name').textContent = p.name;
  $('#preview-specialty').textContent = p.specialization || 'General assistant';
  $('#preview-reply').textContent = sampleReply(p);
  $('#preview-mascot').innerHTML = avatarSvg(p);
  document.querySelectorAll('#avatar-choices label').forEach(label=>label.querySelector('span').innerHTML=avatarSvg({...p,shape:label.querySelector('input').value}));
  document.querySelectorAll('[data-specialty]').forEach(button=>button.setAttribute('aria-pressed',String(p.specialization === specializations[button.dataset.specialty])));
}

function showStep(next) {
  step = next;
  document.querySelectorAll('[data-profile-step]').forEach(node=>node.hidden = Number(node.dataset.profileStep) !== step);
  document.querySelectorAll('[data-custom-step]').forEach(button=>{ if (Number(button.dataset.customStep) === step) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
  $('#customize-save').hidden = false;
  $('.profile-layout').scrollTop = 0;
}

export function openCustomization(onboarding = false, newAgent = false, workspaceAppearance = false, providerOnly = false) {
  appearanceOnly = workspaceAppearance; firstRun = onboarding; adding = newAgent; editingId = getState()?.agentId;
  const count = getState().agents.length, palette = Object.keys(palettes)[count % Object.keys(palettes).length];
  const appearance = getState().appearance || {palette:getState()?.customization?.palette || defaults.palette,motion:getState()?.customization?.motion || defaults.motion};
  const draft = adding ? {...defaults,...appearance,bodyColor:palettes[palette].colors[2],shape:Object.keys(choices.shape)[count % Object.keys(choices.shape).length],...getState().owner,name:`Agent ${count+1}`} : {...defaults,...appearance,...getState()?.customization,...(appearanceOnly ? appearance : {})};
  ownerDraft = Object.fromEntries(ownerPreferenceKeys.map(key=>[key,draft[key]]));
  $('#settings-dialog').close(); $('#customize-form').reset();
  for (const key of ownerPreferenceKeys) $('#customize-form').elements.namedItem(key).disabled = false;
  for (const [key,value] of Object.entries(draft)) { const field = $('#customize-form').elements.namedItem(key); if (field) field.value = value; }
  $('#workspace-override').checked = !adding && !!getState()?.customization?.overrideWorkspace;
  $('#agent-appearance-controls').hidden = appearanceOnly;
  $('.profile-sidebar').hidden = appearanceOnly;
  $('#agent-provider-tab').hidden = appearanceOnly;
  $('.profile-layout').classList.toggle('profile-layout-single',appearanceOnly);
  $('#customize-form').querySelectorAll('details').forEach(node=>node.open = false);
  $('#customize-title').textContent = providerOnly ? 'AI provider' : appearanceOnly ? 'Workspace appearance' : adding ? 'Add agent' : firstRun ? 'Create your first agent' : 'Edit agent';
  $('#customize-description').textContent = providerOnly ? `Connection settings for ${draft.name}.` : appearanceOnly ? 'Choose the theme and animation for Odwyn.' : adding || firstRun ? 'Start with a name and focus. You can change everything later.' : 'Changes apply to this agent’s next task.';
  $('#customize-save').textContent = appearanceOnly ? firstRun ? 'Continue' : 'Save changes' : adding ? 'Create agent' : firstRun ? 'Create agent' : 'Save changes';
  $('#customize-defaults').textContent = 'Use defaults';
  $('#customize-defaults').hidden = !firstRun || adding; $('#customize-status').textContent = '';
  showStep(appearanceOnly ? 0 : providerOnly ? 3 : 1); preview();
  $('#customize-dialog').dispatchEvent(new CustomEvent('customization-open',{detail:{adding:adding || firstRun && !appearanceOnly}}));
  $('#customize-dialog').showModal();
  if (!appearanceOnly) $(providerOnly ? '#provider-source' : '#agent-name-input').focus();
}

async function save(profile, resetAppearance = false) {
  const workspaceSetup = appearanceOnly, newAgent = adding, continueSetup = firstRun && appearanceOnly, agentSetup = firstRun && !appearanceOnly;
  const buttons = $('#customize-form').querySelectorAll('button'); buttons.forEach(button=>button.disabled=true);
  $('#customize-status').textContent = 'Saving…';
  try {
    const result = workspaceSetup ? await api('/api/appearance',{...(resetAppearance ? {} : getState().appearance),palette:profile.palette,motion:profile.motion},'PUT') : await api(newAgent ? '/api/agents' : `/api/customization?agentId=${editingId}`,{...validateProfile(profile),provider:providerDraft()},newAgent ? 'POST' : 'PUT');
    $('#customize-dialog').close(); await saved(result,newAgent,agentSetup); toast(workspaceSetup ? 'Appearance saved.' : newAgent || agentSetup ? 'Agent created.' : 'Agent saved. Changes apply to its next task.');
    if (continueSetup) openCustomization(true);
  } catch (error) { $('#customize-status').textContent = error.message; }
  finally { buttons.forEach(button=>button.disabled=false); }
}

export function readWorkspaceAppearance() {
  return {palette:$('#preferences-form').elements.namedItem('workspacePalette').value,motion:$('#settings-motion').value,...Object.fromEntries(Object.keys(materialDefaults).map(key=>[key,Number($(`#appearance-${key}`).value)])),customColors:$('#appearance-custom-colors').checked ? Object.fromEntries(customColorKeys.map(key=>[key,$(`#appearance-color-${key}`).value])) : {}};
}

function previewWorkspaceAppearance() {
  const draft = readWorkspaceAppearance();
  for (const key of Object.keys(materialDefaults)) $(`#appearance-${key}-value`).textContent = `${draft[key]}${{opacity:'%',blur:'px',depth:'%',radius:'px'}[key]}`;
  for (const key of customColorKeys) $(`#appearance-color-${key}-value`).textContent = $(`#appearance-color-${key}`).value;
  $('#appearance-color-fields').hidden = !$('#appearance-custom-colors').checked;
  try {
    validateAppearance(draft);setAppearance($('#appearance-preview'),draft);
    $('#appearance-preview-status').textContent = '';
  } catch (error) { $('#appearance-preview-status').textContent = error.message; }
}

export function fillWorkspaceAppearance(appearance = {}) {
  $('#preferences-form').elements.namedItem('workspacePalette').value = appearance.palette || defaults.palette;
  $('#settings-motion').value = appearance.motion || defaults.motion;
  $('#appearance-custom-colors').checked = !!Object.keys(appearance.customColors || {}).length;
  const vars = appearanceVars(appearance);
  for (const key of customColorKeys) $(`#appearance-color-${key}`).value = vars[key];
  for (const [key,value] of Object.entries(materialDefaults)) $(`#appearance-${key}`).value = appearance[key] ?? value;
  previewWorkspaceAppearance();
}

export function setupCustomization(state, onSaved, readProvider = () => undefined) {
  getState = state; saved = onSaved; providerDraft = readProvider;
  for (const [id,name] of [['palette-choices','palette'],['settings-palette-choices','workspacePalette']]) $(`#${id}`).innerHTML = Object.entries(palettes).map(([value,p])=>`<label class="palette-option"><input type="radio" name="${name}" value="${value}"><svg viewBox="0 0 96 32" aria-hidden="true">${p.colors.map((color,i)=>`<rect x="${i*32}" width="32" height="32" fill="${color}"/>`).join('')}</svg><span><strong>${p.name}</strong><small>${paletteDetails[value]}</small></span></label>`).join('');
  $('#avatar-choices').innerHTML = Object.entries(choices.shape).map(([value,name])=>`<label class="avatar-option"><input type="radio" name="shape" value="${value}"><span></span><strong>${name}</strong></label>`).join('');
  for (const key of ['eyes','mouth','accessory','motion','language','detail']) $(`#customize-form select[name="${key}"]`).innerHTML = Object.entries(choices[key]).map(([value,name])=>`<option value="${value}">${name}</option>`).join('');
  $('#specialty-presets').innerHTML = Object.keys(specializations).map(key=>`<button type="button" data-specialty="${key}" aria-pressed="false">${key === 'general' ? 'All-rounder' : key[0].toUpperCase()+key.slice(1)}</button>`).join('');
  document.querySelectorAll('[data-specialty]').forEach(button=>button.onclick=()=>{ $('#agent-specialization').value = specializations[button.dataset.specialty]; preview(); });
  $('#tone-choices').innerHTML = Object.entries(choices.tone).map(([value,name])=>`<label class="tone-option"><input type="radio" name="tone" value="${value}"><span><strong>${name}</strong><small>${toneDetails[value]}</small></span></label>`).join('');
  $('#customize-form').oninput = preview;
  $('#settings-motion').innerHTML = $('#customize-form select[name="motion"]').innerHTML;
  $('#settings-appearance-controls').oninput = event => {
    if (event.target.name==='workspacePalette') {
      $('#appearance-custom-colors').checked = false;
      for (const key of customColorKeys) $(`#appearance-color-${key}`).value = palettes[event.target.value].vars[key];
    }
    previewWorkspaceAppearance();
  };
  $('#appearance-reset').onclick = () => {
    const draft = readWorkspaceAppearance();fillWorkspaceAppearance({palette:draft.palette,motion:draft.motion});
  };
  $('#customize-close').onclick = () => $('#customize-dialog').close();
  $('#customize-cancel').onclick = () => $('#customize-dialog').close();
  $('#customize-defaults').onclick = () => save({...defaults},true);
  document.querySelectorAll('[data-custom-step]').forEach(button=>button.onclick=()=>showStep(Number(button.dataset.customStep)));
  $('#customize-form').onsubmit = event => {
    event.preventDefault();
    const invalid = !appearanceOnly && $('#customize-form').querySelector(':invalid');
    if (invalid) { showStep(Number(invalid.closest('[data-profile-step]').dataset.profileStep)); const details = invalid.closest('details'); if (details) details.open = true; invalid.focus(); invalid.reportValidity(); return; }
    void save(readDraft());
  };
}
