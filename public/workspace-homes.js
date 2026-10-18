import { $, esc, api, handleError, workspaceId, icon, toast } from './ui.js';
import { freshPassword } from './security-ui.js';

export function setupWorkspaceHomes() {
  const picker = $('#workspace-home');
  const menu=$('#workspace-menu');
  const position=()=>{const rect=picker.getBoundingClientRect(),width=Math.min(320,innerWidth-24);menu.style.left=Math.max(12,Math.min(rect.left,innerWidth-width-12))+'px';menu.style.top=(rect.bottom+8)+'px';};
  menu.addEventListener('beforetoggle',event=>{picker.setAttribute('aria-expanded',String(event.newState==='open'));if(event.newState==='open')position();});
  addEventListener('resize',()=>{if(menu.matches(':popover-open'))position();});
  menu.addEventListener('toggle',event=>{if(event.newState==='open')menu.querySelector('[aria-current=page]')?.focus();});
  const management=$('#workspace-manage-home');let homes=[],managing=false;
  function selected(){return homes.find(row=>row.id===management.value);}
  function drawManagement(){const row=selected();$('#workspace-rename-name').value=row?.name||'';$('#workspace-rename').disabled=!row;$('#workspace-delete').disabled=!row||row.id==='default';$('#workspace-delete-hint').hidden=row?.id!=='default';}
  async function load() {
    const result = await api('/api/workspaces',undefined,'GET');
    homes=result.workspaces;
    const current=homes.find(row=>row.id===workspaceId);
    $('#workspace-current-name').textContent=current?.name||'Workspace';
    picker.querySelector('.workspace-monogram').textContent=Array.from(current?.name||'W')[0].toUpperCase();
    picker.setAttribute('aria-label',`Switch workspace: ${current?.name||'Workspace'}`);
    $('#workspace-options').innerHTML=homes.map(row=>`<a href="${row.id==='default'?'/':'/?workspace='+encodeURIComponent(row.id)}" data-workspace-id="${esc(row.id)}" ${row.id===workspaceId?'aria-current="page"':''}><span class="workspace-monogram" aria-hidden="true">${esc(Array.from(row.name)[0].toUpperCase())}</span><span>${esc(row.name)}</span>${row.id===workspaceId?icon('check'):''}</a>`).join('');
    picker.disabled=false;$('#workspace-picker-status').textContent='';
    if(!managing){const id=management.value||workspaceId;management.innerHTML=homes.map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');management.value=homes.some(row=>row.id===id)?id:workspaceId;drawManagement();}
    for (const checkbox of document.querySelectorAll('[data-share-setting]')) if (!checkbox.disabled) checkbox.checked=!!result.sharing[checkbox.dataset.shareSetting];
  }
  let createReturn=picker;
  $('#workspace-create-dialog').addEventListener('close',()=>{(createReturn.getClientRects().length?createReturn:picker).focus();});
  const create=event => { createReturn=event?.currentTarget||picker; if(menu.matches(':popover-open'))menu.hidePopover(); $('#workspace-create-status').textContent=''; $('#workspace-create-dialog').showModal(); $('#workspace-home-name').focus(); };
  $('#workspace-menu-settings').onclick=()=>{menu.hidePopover();$('#settings-open').click();document.querySelector('[data-settings-section=workspaces]').click();};
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
      managing=false;await load();toast(deleting?'Workspace deleted.':'Workspace renamed.');
    }catch(error){handleError(error);}
    finally{managing=false;$('#settings-workspaces-controls').querySelectorAll('input,select,button').forEach(node=>node.disabled=false);drawManagement();}
  }
  $('#workspace-rename').onclick=()=>manage(false);$('#workspace-delete').onclick=()=>manage(true);
  $('#workspace-create-form').onsubmit = async event => {
    event.preventDefault(); const button=event.submitter; button.disabled=true;
    try {
      const row=await api('/api/workspaces',{name:$('#workspace-home-name').value});
      try{sessionStorage.setItem('odwyn-workspace-created',row.id);}catch{}location.href=`/?workspace=${encodeURIComponent(row.id)}`;
    } catch(error) { handleError(error); button.disabled=false; }
  };
  for (const checkbox of document.querySelectorAll('[data-share-setting]')) checkbox.onchange = async () => {
    const kind=checkbox.dataset.shareSetting, enabled=checkbox.checked;
    if (enabled && !confirm(`Share saved ${kind} settings with all workspaces? Current settings in every workspace will be replaced. Future changes stay linked.`)) { checkbox.checked=false; return; }
    checkbox.disabled=true;
    try { const ownerPassword=kind==='provider' ? await freshPassword() : undefined; await api('/api/workspaces/share',{kind,enabled,ownerPassword}); toast(enabled ? 'Shared. Future changes apply to all workspaces.' : 'Separate. Existing settings stay in each workspace.'); }
    catch(error) { checkbox.checked=!enabled; handleError(error); }
    finally { checkbox.disabled=false; }
  };
  $('#settings-dialog').addEventListener('toggle',event=>{if(event.newState==='open')void load().catch(handleError);});
  try{if(sessionStorage.getItem('odwyn-workspace-created')===workspaceId){sessionStorage.removeItem('odwyn-workspace-created');toast('Workspace created.');}}catch{}
  void load().catch(error=>{$('#workspace-picker-status').textContent=error.message;handleError(error);});
}
