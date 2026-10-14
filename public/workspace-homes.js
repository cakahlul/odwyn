import { $, esc, api, handleError, workspaceId } from './ui.js';
import { freshPassword } from './security-ui.js';

export function setupWorkspaceHomes() {
  const picker = $('#workspace-home');
  const management=$('#workspace-manage-home');let homes=[],managing=false;
  function selected(){return homes.find(row=>row.id===management.value);}
  function drawManagement(){const row=selected();$('#workspace-rename-name').value=row?.name||'';$('#workspace-rename').disabled=!row;$('#workspace-delete').disabled=!row||row.id==='default';$('#workspace-delete-hint').hidden=row?.id!=='default';}
  async function load() {
    const result = await api('/api/workspaces',undefined,'GET');
    homes=result.workspaces;
    picker.innerHTML = result.workspaces.map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
    picker.value=workspaceId; picker.disabled=false;
    if(!managing){const id=management.value||workspaceId;management.innerHTML=picker.innerHTML;management.value=homes.some(row=>row.id===id)?id:workspaceId;drawManagement();}
    for (const checkbox of document.querySelectorAll('[data-share-setting]')) if (!checkbox.disabled) checkbox.checked=!!result.sharing[checkbox.dataset.shareSetting];
  }
  picker.onchange = () => { location.href=picker.value==='default' ? '/' : `/?workspace=${encodeURIComponent(picker.value)}`; };
  const create=() => { $('#workspace-create-status').textContent=''; $('#workspace-create-dialog').showModal(); $('#workspace-home-name').focus(); };
  $('#new-workspace').onclick=create;$('#workspace-manage-create').onclick=create;
  management.onchange=()=>{drawManagement();$('#workspace-homes-status').textContent='';};
  $('#workspace-rename-name').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();$('#workspace-rename').click();}};
  async function manage(deleting){
    const row=selected();if(!row||managing)return;
    if(deleting && !confirm(`Permanently delete workspace "${row.name}"? This deletes its agents, conversations, files, browser sessions, connections, and settings. This cannot be undone.`))return;
    managing=true;$('#settings-workspaces-controls').querySelectorAll('input,select,button').forEach(node=>node.disabled=true);
    try{
      await api(`/api/workspaces/${row.id}`,deleting?{confirm:true}:{name:$('#workspace-rename-name').value},deleting?'DELETE':'PUT');
      if(deleting){
        for(const key of ['odwyn-agent','odwyn-closed-agents','odwyn-bubble-positions','odwyn-sidebar-collapsed'])localStorage.removeItem(`${key}:${row.id}`);
        sessionStorage.removeItem(`odwyn-drafts:${row.id}`);dispatchEvent(new CustomEvent('workspace-deleted',{detail:row.id}));
        if(row.id===workspaceId){location.href='/';return;}
      }
      managing=false;await load();$('#workspace-homes-status').textContent=deleting?'Workspace deleted.':'Workspace renamed.';
    }catch(error){$('#workspace-homes-status').textContent=error.message;}
    finally{managing=false;$('#settings-workspaces-controls').querySelectorAll('input,select,button').forEach(node=>node.disabled=false);drawManagement();}
  }
  $('#workspace-rename').onclick=()=>manage(false);$('#workspace-delete').onclick=()=>manage(true);
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
