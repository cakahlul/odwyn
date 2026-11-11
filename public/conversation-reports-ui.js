import {$,api,icon,workspaceUrl} from './ui.js';

export function setupConversationReports(getConversation){
  document.body.insertAdjacentHTML('beforeend',`<dialog id="report-dialog" class="modal report-dialog" aria-labelledby="report-heading"><form method="dialog" class="modal-top"><div><span class="eyebrow">SHARE YOUR WORK</span><h2 id="report-heading">Conversation report</h2></div><button class="icon-button" aria-label="Close report">${icon('close')}</button></form><p id="report-status" role="status" aria-live="polite"></p><iframe id="report-preview" title="Report preview" sandbox referrerpolicy="no-referrer" hidden></iframe><div class="report-actions"><button type="button" id="report-retry" class="secondary-button" disabled>Generate again</button><button type="button" id="report-download" class="primary-button" disabled>${icon('download')}Download PDF</button></div></dialog>`);
  const dialog=$('#report-dialog'),status=$('#report-status'),preview=$('#report-preview'),retry=$('#report-retry'),download=$('#report-download');
  let conversationId=null,report=null,timer=null,generation=0;
  const discard=id=>api(`/api/reports/${id}`,{},'DELETE').catch(()=>{});
  function failed(error){status.textContent=error.message;retry.disabled=false;retry.textContent='Try again';download.disabled=true;dialog.setAttribute('aria-busy','false');}
  async function poll(current){
    try{
      const result=await api(`/api/reports/${report.id}`,undefined,'GET');
      if(current!==generation)return;
      report=result;
      if(result.status==='generating'){timer=setTimeout(()=>poll(current),600);return;}
      dialog.setAttribute('aria-busy','false');
      if(result.status==='failed'){failed(new Error(result.error));return;}
      status.textContent='Review before sharing. Covers messages as of '+new Date(result.createdAt).toLocaleString()+'.';
      $('#report-heading').textContent=result.title;
      preview.src=workspaceUrl(`/api/reports/${result.id}/preview`);preview.hidden=false;
      retry.disabled=download.disabled=false;retry.textContent='Generate again';
    }catch(error){if(current===generation)failed(error);}
  }
  async function generate(){
    const current=++generation,previous=report?.id;
    clearTimeout(timer);report=null;preview.hidden=true;preview.removeAttribute('src');
    retry.disabled=download.disabled=true;dialog.setAttribute('aria-busy','true');status.textContent='Preparing your report… Summarizing topics, decisions, outcomes, and next steps.';
    if(previous)await discard(previous);
    if(current!==generation)return;
    try{
      const result=await api(`/api/conversations/${conversationId}/report`,{});
      if(current!==generation){void discard(result.id);return;}
      report=result;void poll(current);
    }catch(error){if(current===generation)failed(error);}
  }
  $('#export-report').onclick=()=>{
    const conversation=getConversation();if(!conversation)return;
    conversationId=conversation.id;$('#report-heading').textContent=conversation.title||'Conversation report';
    dialog.showModal();void generate();
  };
  retry.onclick=()=>void generate();
  download.onclick=async()=>{
    const current=generation;download.disabled=true;status.textContent='Preparing PDF…';
    try{
      const response=await fetch(workspaceUrl(`/api/reports/${report.id}/pdf`));
      if(!response.ok)throw Error((await response.json()).error||'Could not download the report.');
      const bytes=await response.blob();if(current!==generation)return;
      const url=URL.createObjectURL(bytes),link=document.createElement('a');
      link.href=url;link.download=(report.title.replace(/[^\p{L}\p{N}-]+/gu,'-').slice(0,80)||'Discussion-report')+'.pdf';
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      status.textContent='PDF downloaded. Ready to share.';
    }catch(error){if(current===generation)status.textContent=error.message;}
    finally{if(current===generation)download.disabled=false;}
  };
  dialog.addEventListener('close',()=>{
    generation++;clearTimeout(timer);if(report)void discard(report.id);report=null;preview.removeAttribute('src');
    $('#conversation-menu-open').focus({preventScroll:true});
  });
}
