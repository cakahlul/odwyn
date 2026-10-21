export function setupWorkspaceSettings(){
  const show=section=>{
    document.querySelectorAll('[data-settings-panel]').forEach(panel=>panel.hidden=panel.dataset.settingsPanel!==section);
    document.querySelectorAll('[data-settings-section]').forEach(button=>button.dataset.settingsSection===section?button.setAttribute('aria-current','page'):button.removeAttribute('aria-current'));
    document.querySelector('#preferences-form > .form-footer').hidden=['sharing','workspaces','tutorials'].includes(section);
    document.querySelector('.settings-scroll').scrollTop=0;
  };
  document.querySelectorAll('[data-settings-section]').forEach(button=>button.onclick=()=>show(button.dataset.settingsSection));
  document.querySelector('#settings-dialog').addEventListener('settings-open',()=>show('appearance'));
  show('appearance');
}
