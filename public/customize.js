import { $, api, toast } from './ui.js';
import { defaults, palettes, choices, avatarSvg, sampleReply, validateProfile } from './profile.js';

let getState, saved, step = 0, firstRun = false, lastApplied = '';
const toneDetails = {warm:'Friendly, thoughtful, plainspoken.',crisp:'The answer first. Keep it short.',playful:'A little wit, plenty of useful work.',formal:'Courteous, precise, professional.'};
const readDraft = () => Object.fromEntries(new FormData($('#customize-form')));
const setPalette = (node, palette) => Object.entries(palettes[palette].vars).forEach(([key,value])=>node.style.setProperty(`--${key}`,value));

export function applyProfile(profile) {
  const p = {...defaults,...profile}, signature = JSON.stringify(p);
  if (signature === lastApplied) return;
  lastApplied = signature; setPalette(document.documentElement,p.palette);
  $('#agent-name').textContent = p.name === 'Sidekick' ? 'sidekick' : p.name;
  $('.brand').title = p.name;
  document.querySelectorAll('[data-agent-avatar]').forEach(node=>node.innerHTML=avatarSvg(p));
  $('#owner-name').textContent = p.ownerName || 'Your space';
  $('.owner-avatar').textContent = Array.from(p.ownerName || 'You')[0].toUpperCase();
  $('#settings-title').textContent = `Your ${p.name}.`;
  $('#settings-agent-name').textContent = p.name;
  $('#settings-profile-summary').textContent = `${palettes[p.palette].name} · ${choices.tone[p.tone]}`;
  $('label[for="prompt"]').textContent = `What would you like ${p.name} to do?`;
  document.title = `${p.name} — your personal +1`;
  $('link[rel="icon"]').href = `data:image/svg+xml,${encodeURIComponent(avatarSvg(p))}`;
  $('meta[name="theme-color"]').content = palettes[p.palette].vars.paper;
}

function preview() {
  const draft = readDraft(), p = {...draft,name:draft.name.trim() || defaults.name};
  setPalette($('#profile-preview'),p.palette);
  $('#preview-brand-name').textContent = $('#preview-agent-name').textContent = p.name;
  $('#preview-owner').textContent = p.ownerName || 'You';
  $('#preview-specialty').textContent = p.specialization || 'A little help goes a long way.';
  $('#preview-reply').textContent = sampleReply(p);
  for (const id of ['preview-brand-avatar','preview-message-avatar','preview-mascot']) $(`#${id}`).innerHTML = avatarSvg(p);
  document.querySelectorAll('#avatar-choices label').forEach(label=>label.querySelector('span').innerHTML=avatarSvg({...p,shape:label.querySelector('input').value}));
}

function showStep(next) {
  step = next;
  document.querySelectorAll('[data-profile-step]').forEach((node,i)=>node.hidden = i !== step);
  document.querySelectorAll('[data-custom-step]').forEach((button,i)=>{ if (i === step) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current'); });
  $('#customize-back').hidden = step === 0;
  $('#customize-next').hidden = step === 2; $('#customize-save').hidden = step !== 2;
  $('.profile-layout').scrollTop = 0;
  $('#customize-preview').textContent = 'Preview';
}

export function openCustomization(onboarding = false) {
  firstRun = onboarding; const draft = {...defaults,...getState()?.customization};
  $('#settings-dialog').close(); $('#customize-form').reset();
  for (const [key,value] of Object.entries(draft)) $('#customize-form').elements.namedItem(key).value = value;
  $('#customize-eyebrow').textContent = firstRun ? 'WELCOME TO YOUR SPACE' : 'YOUR KIND OF SIDEKICK';
  $('#customize-save').childNodes[0].textContent = firstRun ? 'Save & start' : 'Save changes';
  $('#customize-defaults').hidden = !firstRun; $('#customize-status').textContent = '';
  showStep(0); preview(); $('#customize-dialog').showModal();
}

async function save(profile) {
  const buttons = $('#customize-form').querySelectorAll('button'); buttons.forEach(button=>button.disabled=true);
  $('#customize-status').textContent = 'Saving…';
  try {
    const result = await api('/api/customization',validateProfile(profile),'PUT');
    await saved(result); $('#customize-dialog').close(); toast(firstRun ? 'Your space is ready.' : 'Saved. Your agent gets the changes on its next task.');
  } catch (error) { $('#customize-status').textContent = error.message; }
  finally { buttons.forEach(button=>button.disabled=false); }
}

export function setupCustomization(state, onSaved) {
  getState = state; saved = onSaved;
  $('#palette-choices').innerHTML = Object.entries(palettes).map(([value,p])=>`<label class="palette-option"><input type="radio" name="palette" value="${value}"><svg viewBox="0 0 96 32" aria-hidden="true">${p.colors.map((color,i)=>`<rect x="${i*32}" width="32" height="32" fill="${color}"/>`).join('')}</svg><span>${p.name}</span></label>`).join('');
  $('#avatar-choices').innerHTML = Object.entries(choices.shape).map(([value,name])=>`<label class="avatar-option"><input type="radio" name="shape" value="${value}"><span></span><strong>${name}</strong></label>`).join('');
  for (const key of ['eyes','mouth','accessory']) $(`#customize-form select[name="${key}"]`).innerHTML = Object.entries(choices[key]).map(([value,name])=>`<option value="${value}">${name}</option>`).join('');
  $('#tone-choices').innerHTML = Object.entries(choices.tone).map(([value,name])=>`<label class="tone-option"><input type="radio" name="tone" value="${value}"><span><strong>${name}</strong><small>${toneDetails[value]}</small></span></label>`).join('');
  $('#customize-form').oninput = preview;
  $('#customize-open').onclick = () => openCustomization();
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
    if (step < 2) { $('#customize-next').click(); return; }
    const invalid = $('#customize-form').querySelector('input:invalid,textarea:invalid');
    if (invalid) { showStep(Number(invalid.closest('[data-profile-step]').dataset.profileStep)); invalid.reportValidity(); return; }
    void save(readDraft());
  };
}
