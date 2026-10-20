import {esc,api} from './ui.js';
export const renderAudit=()=>`<section class="audit-page"><h1>Audit log</h1><p>Agent task activity. Duration includes time waiting for input. Costs show reported charges only; estimates are excluded. Older records may have incomplete activity and usage.</p><form id="audit-filters"><label>Agent<select name="agent"><option value="">All agents</option></select></label><label>From<input type="datetime-local" name="from"></label><label>To<input type="datetime-local" name="to"></label><button class="primary-button">Apply</button><button type="reset" class="secondary-button">Clear</button></form><div id="audit-results" aria-live="polite">Loading…</div><div id="audit-detail"></div></section>`;
const duration=row=>!row.startedAt?(row.status==='queued'?'Not started':'Unavailable'):!row.endedAt&&!['running','waiting','takeover','stopping'].includes(row.status)?'Unavailable':`${Math.max(0,Math.floor(((row.endedAt?Date.parse(row.endedAt):Date.now())-Date.parse(row.startedAt))/1000))}s${row.endedAt?'':' · ongoing'}`;
const time=value=>value?new Date(value).toLocaleString():'—';
const tokens=value=>value==null?'Unavailable':Number(value).toLocaleString();
const cost=row=>row.usage?.costUSD==null?'Cost unavailable':`$${row.usage.costUSD.toFixed(6)}${row.usage.costPartial?' · partial':''}`;
function replace(container,html){
  if(container.innerHTML===html)return;
  const active=document.activeElement,key=container.contains(active)?['data-audit-id','data-audit-page','data-event-page'].find(name=>active.hasAttribute(name)):null;
  const value=key?active.getAttribute(key):null;
  container.innerHTML=html;
  if(key)container.querySelector(`[${key}="${CSS.escape(value)}"]`)?.focus({preventScroll:true});
}
export function setupAudit(getView){
  let root=null,params=new URLSearchParams(),selected=null,detailPage=1,busy=false,pending=false,generation=0;
  async function detail(){
    if(!selected)return;const id=selected,epoch=generation;
    try{const row=await api(`/api/audit/${id}?page=${detailPage}`,undefined,'GET');if(epoch!==generation||id!==selected||!root?.isConnected)return;
      replace(root.querySelector('#audit-detail'),`<article class="audit-entry"><h2>Activity</h2><p>${esc(row.title)}</p><dl><dt>Started</dt><dd>${esc(time(row.startedAt))}</dd><dt>Ended</dt><dd>${esc(time(row.endedAt))}</dd><dt>Duration</dt><dd>${esc(duration(row))}</dd><dt>Input / output tokens</dt><dd>${tokens(row.usage?.inputTokens)} / ${tokens(row.usage?.outputTokens)}</dd><dt>Cached input tokens</dt><dd>${tokens(row.usage?.cachedInputTokens)}</dd><dt>Charge</dt><dd>${esc(cost(row))}</dd></dl>${row.error?`<p>${esc(row.error)}</p>`:''}<ol>${row.events.map(event=>`<li><time>${esc(time(event.at))}</time> <strong>${esc(event.label)}</strong><p>${esc(event.detail)}</p></li>`).join('')}</ol><nav aria-label="Activity pages"><button data-event-page="${row.page-1}" ${row.page===1?'disabled':''}>Previous</button> ${row.page} / ${row.pages} <button data-event-page="${row.page+1}" ${row.page===row.pages?'disabled':''}>Next</button></nav></article>`);
    }catch(error){if(epoch===generation&&root?.isConnected)root.querySelector('#audit-detail').textContent=error.message;}
  }
  async function load(){
    if(!root?.isConnected)return;if(busy){pending=true;return;}busy=true;const epoch=generation;
    try{const result=await api('/api/audit?'+params,undefined,'GET');if(epoch!==generation||!root?.isConnected)return;
      const select=root.querySelector('[name=agent]'),value=select.value;
      if(document.activeElement!==select){select.innerHTML='<option value="">All agents</option>'+result.agents.map(agent=>`<option value="${esc(agent.id)}">${esc(agent.name)}</option>`).join('');select.value=value;}
      replace(root.querySelector('#audit-results'),`<p>${result.total} tasks</p>${result.rows.map(row=>`<article class="audit-entry"><button data-audit-id="${esc(row.id)}"><strong>${esc(row.title)}</strong></button><p>${esc(row.agentName)} · ${esc(row.status)} · ${esc(row.provider?.type||'Provider not recorded')} · ${esc(row.provider?.model||'Model not recorded')}</p><p>Started: ${esc(time(row.startedAt))} · Ended: ${esc(time(row.endedAt))} · Duration: ${esc(duration(row))}</p><p>${tokens(row.usage?.totalTokens)} tokens${row.usage?.partial?' · partial':''} · ${esc(cost(row))}</p></article>`).join('')||'<p>No activity matches these filters.</p>'}<nav aria-label="Audit pages"><button data-audit-page="${result.page-1}" ${result.page===1?'disabled':''}>Previous</button> ${result.page} / ${result.pages} <button data-audit-page="${result.page+1}" ${result.page===result.pages?'disabled':''}>Next</button></nav>`);
      await detail();
    }catch(error){if(epoch===generation&&root?.isConnected)root.querySelector('#audit-results').textContent=error.message;}finally{busy=false;if(pending){pending=false;void load();}}
  }
  document.addEventListener('submit',event=>{if(event.target.id!=='audit-filters')return;event.preventDefault();generation++;params=new URLSearchParams();for(const [key,value] of new FormData(event.target)){if(value)params.set(key,key==='agent'?value:new Date(value).toISOString());}selected=null;root.querySelector('#audit-detail').replaceChildren();void load();});
  document.addEventListener('reset',event=>{if(event.target.id!=='audit-filters')return;generation++;params=new URLSearchParams();selected=null;root.querySelector('#audit-detail').replaceChildren();setTimeout(()=>void load(),0);});
  document.addEventListener('click',event=>{const button=event.target.closest('[data-audit-page],[data-audit-id],[data-event-page]');if(!button||!root?.contains(button))return;if(button.dataset.auditPage){generation++;params.set('page',button.dataset.auditPage);void load();}else if(button.dataset.auditId){selected=button.dataset.auditId;detailPage=1;void detail();}else{detailPage=Number(button.dataset.eventPage);void detail();}});
  setInterval(()=>{if(getView()!=='audit'||document.hidden)return;const next=document.querySelector('.audit-page');if(next!==root){root=next;generation++;params=new URLSearchParams();selected=null;}void load();},1000);
}
