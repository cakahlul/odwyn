import {setupChatComposer} from './chat-composer.js';
import { $, esc, icon, richText, activeStatuses, statusLabels, workspaceId } from './ui.js';

export function setupOddy(getScreen=()=>({})) {
  const launcher=document.createElement('button');
  launcher.id='oddy-open';launcher.className='icon-button oddy-launcher';launcher.type='button';
  launcher.setAttribute('aria-haspopup','dialog');launcher.setAttribute('aria-controls','oddy-dialog');
  launcher.setAttribute('aria-label','Ask Oddy');launcher.setAttribute('aria-expanded','false');launcher.title='Oddy (⌘/Ctrl Shift O)';
  launcher.innerHTML=icon('chat')+'<span>Oddy</span>';
  const dialog=document.createElement('dialog');dialog.id='oddy-dialog';dialog.className='oddy-panel';dialog.setAttribute('aria-labelledby','oddy-title');
  dialog.innerHTML=`<header class="oddy-header"><div class="oddy-heading"><h2 id="oddy-title">Oddy</h2><p id="oddy-context" class="oddy-context"></p></div><details class="oddy-menu" id="oddy-menu"><summary class="icon-button" aria-label="Oddy conversation options" title="Conversation options">${icon('menu')}</summary><div class="oddy-menu-items"><button type="button" id="oddy-new">New chat</button><button type="button" id="oddy-new-room">New room</button><label for="oddy-history">Chat history</label><select id="oddy-history" aria-label="Oddy chat history"></select><button type="button" id="oddy-clear" class="danger-button">Clear this chat</button></div></details><button type="button" class="icon-button" id="oddy-close" aria-label="Close Oddy">${icon('close')}</button></header>
    <div id="oddy-messages" class="oddy-messages" role="log" aria-label="Conversation with Oddy"></div>
    <div id="oddy-pending" class="oddy-pending" hidden></div>
    <p id="oddy-status" class="oddy-status" role="status"></p><a id="oddy-provider-settings" class="oddy-provider-settings" href="/?settings=provider&provider=oddy" hidden>Open Oddy AI settings</a>
    <form id="oddy-form" class="composer oddy-form"><label class="sr-only" for="oddy-prompt">Ask Oddy or answer its question</label><textarea id="oddy-prompt" rows="1" maxlength="20000" required aria-describedby="oddy-keyboard-hint" placeholder="Ask Oddy to do something…"></textarea><div class="composer-toolbar oddy-form-actions"><small id="oddy-keyboard-hint">Enter to send<span class="oddy-newline-hint"> · Shift+Enter for a new line</span></small><button type="button" class="text-button" id="oddy-stop" hidden>Stop</button><button type="submit" class="send-button" id="oddy-send" aria-label="Send to Oddy" title="Send message (Enter)" disabled>${icon('arrow-up')}</button></div></form>`;
  $('#browser-toggle').before(launcher);document.body.append(dialog);
  let state=null,timer=null,loading=false,sending=false,messageKey='',pendingKey='',errorMessage='',uploading=false,attachments=[],stateVersion=0;
  const context=$('#oddy-context');let historyKey='';
  const uploads=document.createElement('div');uploads.id='oddy-attachments';uploads.className='oddy-attachments';$('#oddy-prompt').before(uploads);
  const fileInput=document.createElement('input');fileInput.type='file';fileInput.multiple=true;fileInput.hidden=true;fileInput.id='oddy-file-input';
  const attach=document.createElement('button');attach.type='button';attach.className='icon-button';attach.id='oddy-attach';attach.setAttribute('aria-label','Attach files to Oddy');attach.title='Attach files (up to 20 MB each)';attach.innerHTML=icon('paperclip');
  $('#oddy-keyboard-hint').after(attach);$('#oddy-form').append(fileInput);
  function screen(){
    const modal=[...document.querySelectorAll('dialog[open]')].filter(node=>node!==dialog).at(-1);
    return {...getScreen(),dialog:modal?.id||'',section:modal?.querySelector('[data-settings-section][aria-current]')?.dataset.settingsSection||''};
  }
  async function request(path,body){
    const response=await fetch(path,{method:body?'POST':'GET',headers:body instanceof FormData?{}:{'content-type':'application/json'},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})});
    const value=await response.json();if(!response.ok)throw Error(value.error||'Oddy could not complete this request.');return value;
  }
  function draw(){
    const job=state.job,pending=job?.pending,busy=activeStatuses.includes(job?.status),feed=$('#oddy-messages');
    const current=screen(),modal=current.dialog?document.getElementById(current.dialog):null;
    const label=modal?.querySelector('[data-settings-section][aria-current]')?.textContent||modal?.querySelector('h2')?.textContent||({home:'Home',chat:'Conversation',runs:'Activity',routines:'Routines',workflows:'Workflows',files:'Files'}[current.view]);
    context.textContent=[$('#workspace-current-name')?.textContent,label].filter(Boolean).join(' · ');context.title=context.textContent;
    const nextHistory=JSON.stringify([state.conversations,state.conversationId]);
    if(nextHistory!==historyKey){historyKey=nextHistory;$('#oddy-history').innerHTML='<option value="">New chat</option>'+(state.conversations||[]).map(row=>`<option value="${esc(row.id)}">${esc(row.title)}</option>`).join('');$('#oddy-history').value=state.conversationId||'';}
    for(const id of ['oddy-new','oddy-clear','oddy-history'])$('#'+id).disabled=sending||uploading||busy||(id==='oddy-clear'&&!state.messages.length);
    uploads.innerHTML=attachments.map(file=>`<span class="oddy-file"><span>${esc(file.name)}</span><button type="button" class="icon-button" data-oddy-remove="${esc(file.id)}" aria-label="Remove ${esc(file.name)}">${icon('close')}</button></span>`).join('');
    uploads.setAttribute('aria-busy',String(uploading));
    const key=JSON.stringify(state.messages);
    if(key!==messageKey || !feed.childNodes.length){
      const follow=feed.scrollHeight-feed.scrollTop-feed.clientHeight<60 || !messageKey;
      messageKey=key;feed.replaceChildren();
      if(!state.messages.length)feed.innerHTML='<div class="oddy-empty"><h3>What needs doing?</h3><p>I can set up agents and workflows, run jobs, and check progress in any workspace.</p><button type="button" class="secondary-button" data-oddy-example>What can you help me do here?</button></div>';
      for(const message of state.messages){
        if(!['user','assistant'].includes(message.role))continue;
        const item=document.createElement('article');item.className='oddy-message';item.dataset.role=message.role;
        const label=document.createElement('strong');label.textContent=message.role==='user'?'You':'Oddy';
        item.append(label);
        if(message.role==='assistant')item.append(richText(message.text));
        else{const text=document.createElement('p');text.textContent=message.text;item.append(text);}
        for(const id of message.attachments||[]){const file=state.files?.find(file=>file.id===id);if(!file)continue;const link=document.createElement('a');link.href='/api/oddy/files/'+encodeURIComponent(id);link.textContent=file.name;link.className='oddy-file';item.append(link);}
        feed.append(item);
      }
      if(follow)feed.scrollTop=feed.scrollHeight;
    }
    const nextPending=JSON.stringify(pending||null),box=$('#oddy-pending');
    if(nextPending!==pendingKey){
      pendingKey=nextPending;box.hidden=!pending;
      box.innerHTML=pending?`<strong>${esc(pending.title)}</strong><p>${esc(pending.detail)}</p>${pending.type==='oddy-confirmation'?`${pending.destructive?'<p>This cannot be undone.</p>':''}<details><summary>Review change</summary><pre>${esc(JSON.stringify(pending.proposal||{},null,2))}</pre></details><div class="oddy-decisions"><button type="button" class="secondary-button" data-oddy-decision="deny">Reject</button><button type="button" class="secondary-button danger-button" data-oddy-decision="allow">${pending.destructive?'Confirm deletion':'Approve change'}</button></div>`:''}`:'';
    }
    $('#oddy-status').textContent=uploading?'Uploading files…':errorMessage||job?.error||state.connectionError||(!state.connected?'Connect Oddy’s AI provider in Settings.':busy?pending?'Needs your input':statusLabels[job.status]||job.status:'');
    $('#oddy-send').disabled=(!$('#oddy-prompt').value.trim()&&!attachments.length)||sending||uploading||!state.connected||busy&&pending?.type!=='question';
    $('#oddy-prompt').required=!attachments.length;
    $('#oddy-new-room').disabled=$('#new-room-top').disabled;
    attach.disabled=sending||uploading||busy;attach.title=busy?'Attach files to your next request after this task finishes.':'Attach files (up to 20 MB each)';
    $('#oddy-prompt').disabled=sending||pending?.type==='oddy-confirmation';
    $('#oddy-prompt').placeholder=pending?.type==='question'?'Your answer…':'Ask Oddy to do something…';
    $('#oddy-stop').hidden=!busy;$('#oddy-stop').disabled=sending;
    $('#oddy-provider-settings').hidden=state.connected;
    box.querySelectorAll('button').forEach(button=>button.disabled=sending);
  }
  async function refresh(){
    if(loading)return;loading=true;clearTimeout(timer);const version=stateVersion;
    try{const next=await request('/api/oddy');if(version!==stateVersion)return;if(next.job?.id!==state?.job?.id||next.job?.pending?.id!==state?.job?.pending?.id)errorMessage='';state=next;draw();}
    catch(error){$('#oddy-status').textContent=error.message;}
    finally{loading=false;if(dialog.open)timer=setTimeout(refresh,1200);}
  }
  async function act(path,body){
    if(sending)return;stateVersion++;errorMessage='';sending=true;if(state)draw();
    try{state=await request(path,body);return true;}
    catch(error){errorMessage=error.message;$('#oddy-status').textContent=errorMessage;return false;}
    finally{stateVersion++;sending=false;if(state)draw();}
  }
  launcher.onclick=()=>{if(dialog.open){dialog.close();return;}if(document.querySelector('dialog:modal'))dialog.showModal();else dialog.show();launcher.setAttribute('aria-expanded','true');if(state)draw();else $('#oddy-status').textContent='Connecting to Oddy…';void refresh();$('#oddy-prompt').focus();};
  $('#oddy-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{clearTimeout(timer);launcher.setAttribute('aria-expanded','false');launcher.focus();});
  $('#oddy-form').onsubmit=async event=>{
    event.preventDefault();const prompt=$('#oddy-prompt').value.trim();if((!prompt&&!attachments.length)||$('#oddy-send').disabled)return;
    const job=state?.job,pending=job?.pending;
    const ok=await act(pending?.type==='question'?'/api/oddy/answer':'/api/oddy',pending?.type==='question'?{jobId:job.id,requestId:pending.id,answer:prompt,screen:screen()}:{prompt,workspaceId,conversationId:state.conversationId??null,screen:screen(),attachments:attachments.map(file=>file.id)});
    if(ok){attachments=[];$('#oddy-prompt').value='';$('#oddy-prompt').style.height='';draw();}if(!$('#oddy-prompt').disabled)$('#oddy-prompt').focus();
  };
  async function changeChat(path,body){
    if(await act(path,body)){attachments=[];$('#oddy-prompt').value='';$('#oddy-prompt').style.height='';messageKey='';draw();$('#oddy-menu').open=false;$('#oddy-prompt').focus();}
  }
  $('#oddy-new').onclick=()=>void changeChat('/api/oddy/new',{});
  $('#oddy-clear').onclick=()=>{const conversationId=state.conversationId;if(confirm('Delete this Oddy conversation and its saved messages? Uploaded files remain.'))void changeChat('/api/oddy/clear',{confirm:true,conversationId});};
  $('#oddy-history').onchange=event=>void changeChat(event.target.value?'/api/oddy/select':'/api/oddy/new',event.target.value?{conversationId:event.target.value}:{});
  $('#oddy-new-room').onclick=()=>{dialog.close();$('#oddy-menu').open=false;$('#new-room-top').click();};
  attach.onclick=()=>fileInput.click();
  async function attachFiles(selected){
    if(uploading||attach.disabled)return;
    uploading=true;errorMessage='';draw();
    try{
      if(attachments.length+selected.length>20)throw Error('Choose up to 20 files.');
      if(selected.some(file=>!file.size||file.size>20*1024*1024))throw Error('Choose nonempty files up to 20 MB each.');
      for(const file of selected){const body=new FormData();body.append('file',file);attachments.push(await request('/api/oddy/files',body));}
    }catch(error){errorMessage=error.message;}finally{uploading=false;draw();$('#oddy-prompt').focus();}
  };
  fileInput.onchange=()=>{const files=[...fileInput.files];fileInput.value='';void attachFiles(files);};
  setupChatComposer({form:$('#oddy-form'),input:$('#oddy-prompt'),send:$('#oddy-send'),onInput:()=>{if(state)draw();},onFiles:attachFiles});
  $('#oddy-stop').onclick=()=>void act('/api/oddy/cancel',{jobId:state.job.id});
  dialog.addEventListener('click',event=>{
    const remove=event.target.closest('[data-oddy-remove]');if(remove&&!sending&&!uploading){attachments=attachments.filter(file=>file.id!==remove.dataset.oddyRemove);draw();}
    const decision=event.target.closest('[data-oddy-decision]');
    if(decision)void act('/api/oddy/answer',{jobId:state.job.id,requestId:state.job.pending.id,decision:decision.dataset.oddyDecision});
    if(event.target.closest('[data-oddy-example]')){$('#oddy-prompt').value='What can you help me do here?';$('#oddy-prompt').dispatchEvent(new Event('input'));$('#oddy-prompt').focus();}
  });
  addEventListener('keydown',event=>{if(event.key==='Escape'&&dialog.open){event.preventDefault();dialog.close();return;}if((event.metaKey||event.ctrlKey)&&event.shiftKey&&event.key.toLowerCase()==='o'){event.preventDefault();if(dialog.open)dialog.close();else launcher.click();}});
  // Keep Oddy reachable while Settings or another modal owns the top layer.
  document.addEventListener('toggle',event=>{
    if(!event.target.matches('dialog') || event.target===dialog)return;
    if(event.newState==='open'&&dialog.open)dialog.close();
    const modal=[...document.querySelectorAll('dialog[open]')].filter(node=>node!==dialog).at(-1);
    if(modal){const toolbar=modal.querySelector('.modal-top')||modal;toolbar.insertBefore(launcher,toolbar.lastElementChild);}else $('#browser-toggle').before(launcher);
  },true);
}
