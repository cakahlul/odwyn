import { $, esc, api, handleError, workspaceId } from './ui.js';
import { freshPassword } from './security-ui.js';

export function setupWorkspaceHomes() {
  const picker = $('#workspace-home');
  async function load() {
    const result = await api('/api/workspaces',undefined,'GET');
    picker.innerHTML = result.workspaces.map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
    picker.value=workspaceId; picker.disabled=false;
    for (const checkbox of document.querySelectorAll('[data-share-setting]')) if (!checkbox.disabled) checkbox.checked=!!result.sharing[checkbox.dataset.shareSetting];
  }
  picker.onchange = () => { location.href=picker.value==='default' ? '/' : `/?workspace=${encodeURIComponent(picker.value)}`; };
  $('#new-workspace').onclick = () => { $('#workspace-create-status').textContent=''; $('#workspace-create-dialog').showModal(); $('#workspace-home-name').focus(); };
  $('#workspace-create-form').onsubmit = async event => {
    event.preventDefault(); const button=event.submitter; button.disabled=true;
    try {
      const row=await api('/api/workspaces',{name:$('#workspace-home-name').value});
      location.href=`/?workspace=${encodeURIComponent(row.id)}`;
    } catch(error) { $('#workspace-create-status').textContent=error.message; button.disabled=false; }
  };
  for (const checkbox of document.querySelectorAll('[data-share-setting]')) checkbox.onchange = async () => {
    const kind=checkbox.dataset.shareSetting, enabled=checkbox.checked;
    if (enabled && !confirm(`Share saved ${kind} settings with all workspaces? Current settings in every workspace will be replaced. Future changes stay linked.`)) { checkbox.checked=false; return; }
    checkbox.disabled=true;
    try { const ownerPassword=kind==='provider' ? await freshPassword() : undefined; await api('/api/workspaces/share',{kind,enabled,ownerPassword}); $('#workspace-sharing-status').textContent=enabled ? 'Shared. Future changes apply to all workspaces.' : 'Separate. Existing settings stay in each workspace.'; }
    catch(error) { checkbox.checked=!enabled; $('#workspace-sharing-status').textContent=error.message; }
    finally { checkbox.disabled=false; }
  };
  $('#settings-dialog').addEventListener('toggle',event=>{if(event.newState==='open')void load().catch(handleError);});
  void load().catch(handleError);
}
