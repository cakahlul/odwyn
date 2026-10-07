import { Marked, Renderer } from '/vendor/marked.js';

export const $ = selector => document.querySelector(selector);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const paths = {
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 10 10 0 0 1-4-.8L3 21l1.8-5a9 9 0 1 1 16.2-4.5Z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  workflow: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M9 6h6M6 9v9h9"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.7 7.3M3 4v7h7M12 7v5l3 2"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  folder: '<path d="M3 7V5h6l3 3h9v12H3V7Z"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  settings: '<path d="m9 3-1 3-3 1-2 3 2 2v3l3 1 1 3h4l1-3 3-1v-3l2-2-2-3-3-1-1-3Z"/><circle cx="11" cy="11" r="3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  chevron: '<path d="m14 6-6 6 6 6"/>',
  minimize: '<path d="M5 18h14"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>', 'arrow-up': '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  cursor: '<path d="m4 3 5 18 3-8 8-3L4 3Z"/>', shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  paperclip: '<path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L12 3a7 7 0 0 1 10 10L12 23"/>',
  check: '<path d="m5 12 4 4L19 6"/>', link: '<path d="m9 15 6-6m-8 4-2 2a4 4 0 0 0 6 6l3-3m-4-12 3-3a4 4 0 0 1 6 6l-2 2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>', play: '<path d="m8 4 12 8-12 8V4Z"/>', pause: '<path d="M8 4v16M16 4v16"/>',
  ticket: '<path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4V5Z"/><path d="M15 5v3m0 3v2m0 3v3"/>',
  plane: '<path d="M10 9V4a2 2 0 0 1 4 0v5l7 4v3l-7-2v5l3 2v1l-5-1-5 1v-1l3-2v-5l-7 2v-3l7-4Z"/>',
  cart: '<path d="M2 3h3l3 12h11l3-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  bed: '<path d="M3 18v3m18-3v3M3 6v12h18v-8H3"/><path d="M6 10V6h5v4m0 0V6h7v4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>', copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
};
export const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.chat}</svg>`;
export function hydrateIcons(parent = document) { parent.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
export const date = value => new Intl.DateTimeFormat(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(new Date(value));
export const activeStatuses = ['queued','running','waiting','takeover','stopping'];
export const statusLabels = { queued:'In line', running:'Working', waiting:'Needs you', takeover:'You’re in control', completed:'Done', failed:'Blocked', interrupted:'Interrupted', cancelled:'Stopped', resumed:'Resumed', stopping:'Stopping' };
export const badge = status => `<span class="badge badge-${esc(status)}"><span></span>${esc(statusLabels[status] || status)}</span>`;
export async function api(path, body, method = 'POST') {
  const response = await fetch(path, { method, headers: body instanceof FormData ? {} : { 'content-type':'application/json' }, body: body instanceof FormData ? body : JSON.stringify(body || {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed.'); return result;
}
let toastTimer;
export function toast(message) { const node = $('#toast'); node.textContent = message; node.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, 5000); }
export function handleError(error) { toast(error.message || 'Something went wrong. Try again.'); }

function answerLink(href, label, title = '', protocols = ['http:','https:','mailto:']) {
  try { if (!protocols.includes(new URL(href).protocol)) return label; }
  catch { return label; }
  return `<a href="${esc(href)}" title="${esc(title)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

const cardContexts = { concert:['ticket','Concert'], event:['ticket','Event'], flight:['plane','Flight'], shopping:['cart','Shopping'], hotel:['bed','Hotel'] };
const summaryContexts = { success:['check','Confirmed'], info:['globe','Update'], warning:['shield','Needs attention'], error:['close','Unable to complete'] };
function cardContext(category, fallback = 'shopping') { return Object.hasOwn(cardContexts,category) ? cardContexts[category] : Object.hasOwn(summaryContexts,fallback) ? summaryContexts[fallback] : cardContexts.shopping; }
function cardCategory(category, fallback) { const [symbol,label] = cardContext(category,fallback); return `<span class="card-category">${icon(symbol)}${label}</span>`; }

function cardImage(image, alt, category = 'shopping') {
  try { const url = new URL(image); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return ''; }
  catch { return ''; }
  return `<div class="card-media ${category === 'shopping' ? 'card-media-product' : ''}"><div class="card-image-fallback">${icon(cardContext(category)[0])}<span>Image unavailable</span></div><img src="/api/images?url=${esc(encodeURIComponent(image))}" alt="${esc(alt || 'Source image')}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>`;
}

function productCard(name, price, details = '', footer = '', { label = '', media = '', category = 'shopping' } = {}) {
  return `<article class="product-card">${media}${cardCategory(category)}${label ? `<span class="product-label">${label}</span>` : ''}<strong class="product-name">${name}</strong><div class="product-price">${price || 'Price unavailable'}</div>${details}${footer}</article>`;
}

const scalar = value => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
const optionalText = (data, keys) => keys.every(key => data[key] == null || typeof data[key] === 'string');

export function reviewItem(value, index, selectId, checked = false) {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value : typeof value==='string' ? {title:value} : {detail:value};
  const titleKey = ['title','label','name','id'].find(key=>typeof item[key]==='string' && item[key].trim());
  const title = item[titleKey] || `Item ${index+1}`;
  const fields = Object.entries(item).filter(([key,value])=>![titleKey,'selected','severity'].includes(key) && value!=null);
  const details = fields.map(([key,value])=>{
    const text = typeof value==='object' ? JSON.stringify(value,null,2) : String(value);
    const label = key.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');
    const content = /url$/i.test(key) ? answerLink(text,esc(text),'',['http:','https:']) : esc(text);
    return `<div><dt>${esc(label)}</dt><dd>${content}</dd></div>`;
  }).join('');
  const heading = selectId===undefined ? `<strong>${esc(title)}</strong>` : `<label class="review-item-choice"><input type="checkbox" name="selected" value="${esc(selectId)}" ${checked ? 'checked' : ''}><strong>${esc(title)}</strong></label>`;
  return `<article class="review-item"><header>${heading}${typeof item.severity==='string' ? `<span class="review-severity">${esc(item.severity)}</span>` : ''}</header>${details ? `<dl class="review-item-details">${details}</dl>` : ''}</article>`;
}

function answerBlock(data) {
  if (!data || typeof data !== 'object' || !optionalText(data, ['title','detail','category','image','imageAlt','url','receiptUrl'])) return false;
  if (['review','pr_review'].includes(data.type)) {
    const items = data.items ?? data.feedback;
    if (!Array.isArray(items) || items.length>100 || !optionalText(data,['summary','prUrl','commit'])) return false;
    const source = data.prUrl || data.url;
    return `<section class="answer-review"><header class="review-heading"><span class="card-category">${icon('shield')}Review</span><h3>${esc(data.title || 'Review results')}</h3>${data.summary ? `<p>${esc(data.summary)}</p>` : ''}<div class="review-context">${source ? answerLink(source,'View source ↗','',['http:','https:']) : ''}${data.commit ? `<code>${esc(data.commit)}</code>` : ''}<span>${items.length} ${items.length===1 ? 'item' : 'items'}</span></div></header><div class="review-items">${items.map((item,index)=>reviewItem(item,index)).join('') || '<p>No items to review.</p>'}</div></section>`;
  }
  if (data.type === 'products') {
    if (!Array.isArray(data.items) || !data.items.every(item => item && typeof item.name === 'string' && item.name.trim() && (item.price == null || scalar(item.price)) && optionalText(item, ['seller','availability','detail','url','label','category','image','imageAlt']))) return false;
    if (!data.items.length) return `<section class="answer-empty"><strong>${esc(data.title || 'No products to show')}</strong>${data.detail ? `<p>${esc(data.detail)}</p>` : ''}</section>`;
    const cards = data.items.map(item => {
      const details = [item.seller,item.availability,item.detail].filter(Boolean).map(text => `<p class="product-detail">${esc(text)}</p>`).join('');
      const requestedCategory = item.category || data.category;
      const category = Object.hasOwn(cardContexts,requestedCategory) ? requestedCategory : 'shopping';
      const linkLabel = ['concert','event','flight','hotel'].includes(category) ? 'View details' : 'View product';
      const link = item.url ? answerLink(item.url, `${linkLabel} <span aria-hidden="true">↗</span>`, item.name, ['http:','https:']) : '';
      const footer = link.startsWith('<a ') ? `<div class="product-link">${link}</div>` : '';
      return productCard(esc(item.name), esc(item.price), details, footer, {label:esc(item.label),category,media:cardImage(item.image,item.imageAlt || item.name,category)});
    }).join('');
    return `${data.title ? `<p class="answer-section-title">${esc(data.title)}</p>` : ''}${data.detail ? `<p>${esc(data.detail)}</p>` : ''}<div class="product-grid">${cards}</div>`;
  }
  if (data.type === 'summary' || data.type === 'receipt') {
    if (typeof data.title !== 'string' || !data.title.trim() || (data.facts !== undefined && (!Array.isArray(data.facts) || !data.facts.every(fact => fact && typeof fact.label === 'string' && scalar(fact.value))))) return false;
    const tone = ['success','info','warning','error'].includes(data.tone) ? data.tone : 'info';
    const facts = (data.facts || []).map(fact => `<div><dt>${esc(fact.label)}</dt><dd>${esc(fact.value)}</dd></div>`).join('');
    const source = data.receiptUrl || data.url;
    const link = source ? answerLink(source, data.receiptUrl ? 'Original receipt ↗' : 'View source ↗', '', ['http:','https:']) : '';
    const actions = `${data.type === 'receipt' ? `<button type="button" class="secondary-button" data-save-receipt>${icon('download')}Download receipt</button>` : ''}${link.startsWith('<a ') ? link : ''}`;
    return `<section class="answer-summary answer-summary-${tone}${data.type === 'receipt' ? ' receipt-card' : ''}">${cardImage(data.image,data.imageAlt || data.title,data.category)}${cardCategory(data.category,tone)}<strong class="answer-summary-title">${esc(data.title)}</strong>${data.detail ? `<p>${esc(data.detail)}</p>` : ''}${facts ? `<dl class="answer-facts">${facts}</dl>` : ''}${actions ? `<div class="receipt-actions">${actions}</div>` : ''}</section>`;
  }
  return false;
}

const renderer = {
  // Replies are untrusted: escape raw HTML and allow only safe link protocols.
  html({ text }) { return esc(text); },
  link({ href, title, tokens }) { return answerLink(href,this.parser.parseInline(tokens),title); },
  image({ href, text, title }) { return answerLink(href,esc(text || 'View image'),title); },
  heading({ depth, tokens }) { const level = Math.min(depth+1,6); return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>`; },
  table(token) { return `<div class="table-scroll" tabindex="0" role="region" aria-label="Comparison table">${Renderer.prototype.table.call(this,token)}</div>`; },
};
const plainMarkdown = new Marked({ gfm:true, breaks:true, renderer });
const markdown = new Marked({ gfm:true, breaks:true, renderer });
markdown.use({ renderer: {
  image({ href, text, title }) { return cardImage(href,text,'info') || answerLink(href,esc(text || 'View image'),title); },
  code(token) {
    // Saved replies from before the rename keep their cards.
    if (!['odwyn','sidekick','json'].includes(token.lang?.trim())) return false;
    try { return answerBlock(JSON.parse(token.text)); } catch { return false; }
  },
  table(token) {
    const headers = token.header.map(cell => cell.text.replace(/[*_`]/g,'').trim().toLowerCase());
    // ponytail: explicit product/price columns only; prose stays Markdown until providers use the card format.
    const name = headers.findIndex(text => /^(product|item|produk|barang)( name)?$/.test(text));
    const price = headers.findIndex(text => /^(price|harga)$/.test(text));
    if (name < 0 || price < 0 || !token.rows.length || token.rows.some(row => !row[name]?.text.trim())) return false;
    const inline = cell => this.parser.parseInline(cell.tokens);
    const cards = token.rows.map(row => {
      const details = row.map((cell,index) => index === name || index === price ? '' : `<div><dt>${inline(token.header[index])}</dt><dd>${inline(cell)}</dd></div>`).join('');
      return productCard(inline(row[name]), inline(row[price]), details ? `<dl class="answer-facts">${details}</dl>` : '');
    }).join('');
    return `<div class="product-grid">${cards}</div>`;
  },
} });

export function richText(text, { cards = true, response = null } = {}) {
  const container = document.createElement('div'); container.className = 'message-text';
  let structured = false;
  if (cards) {
    try {
      const data=JSON.parse(String(text).trim().replace(/^```(?:json|odwyn)?\s*|\s*```$/g,''));
      if (response && data && Object.hasOwn(data,response.items)) {
        const items=data[response.items];
        if(Array.isArray(items) && items.length<=100) {
          structured=answerBlock({type:'review',title:data.title || response.title,summary:data.summary,prUrl:data.prUrl,url:data.url,commit:data.commit,items});
          if(structured) {
            const form=`<form class="result-response" data-result-job="${esc(response.jobId)}" data-result-message="${esc(response.messageId)}"><fieldset ${response.disabled || response.sent ? 'disabled' : ''}><legend>Select items to send</legend><div class="review-items">${items.map((item,index)=>reviewItem(item,index,String(index),response.selected?.includes(String(index)))).join('')}</div><label class="result-response-notes">Instructions or edits (optional)<textarea name="answer" rows="2" maxlength="8000" placeholder="Add context for the agent…">${esc(response.notes || '')}</textarea></label><div class="result-response-footer"><small>${response.sent ? 'Selection sent to the agent.' : response.disabled ? 'Available after the current work finishes.' : 'Sends your selection to the agent as a new message.'}</small><button type="submit" class="primary-button" ${!items.length ? 'disabled' : ''}>${esc(response.sent ? 'Sent to agent' : response.label)}${icon('arrow-up')}</button></div></fieldset><p class="result-response-status" role="status"></p></form>`;
            const template=document.createElement('template');template.innerHTML=structured;
            template.content.querySelector('.review-items').outerHTML=form;structured=template.innerHTML;
          }
        }
      }
      structured ||= answerBlock(data);
    } catch {}
  }
  container.innerHTML = structured || (cards ? markdown : plainMarkdown).parse(String(text || ''));
  container.querySelectorAll('.result-response').forEach(form=>form.addEventListener('submit',async event=>{
    event.preventDefault();const fields=new FormData(form),selected=fields.getAll('selected'),status=form.querySelector('[role=status]'),fieldset=form.querySelector('fieldset');
    if(!selected.length){status.textContent='Select at least one item.';return;}
    fieldset.disabled=true;status.textContent='Sending selection…';
    try {
      const job=await api(`/api/jobs/${form.dataset.resultJob}/respond`,{messageId:form.dataset.resultMessage,selected,answer:fields.get('answer')});
      status.textContent='Selection sent to the agent.';form.querySelector('button').textContent='Sent to agent';
      form.dispatchEvent(new CustomEvent('result-response-sent',{bubbles:true,detail:job}));
    } catch(error){fieldset.disabled=false;status.textContent=error.message || 'Could not send selection.';}
  }));
  container.querySelectorAll('.result-response').forEach(form=>form.addEventListener('input',()=>{form.querySelector('[role=status]').textContent='';}));
  container.querySelectorAll('.card-media img').forEach(img => img.addEventListener('error', () => img.remove(), {once:true}));
  container.querySelectorAll('[data-save-receipt]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true; button.setAttribute('aria-busy','true');
    try { await saveReceipt(button.closest('.receipt-card')); } catch (error) { handleError(error); }
    finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  }));
  return container;
}

async function saveReceipt(card) {
  const copy = card.cloneNode(true), title = card.querySelector('.answer-summary-title').textContent;
  copy.querySelector('[data-save-receipt]').remove();
  await Promise.all([...copy.querySelectorAll('img')].map(async img => {
    try {
      const response = await fetch(img.getAttribute('src')); if (!response.ok) throw new Error('Image unavailable.');
      const blob = await response.blob();
      img.src = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    } catch { img.remove(); }
  }));
  const response = await fetch('/style.css'); if (!response.ok) throw new Error('Could not prepare the receipt. Try again.');
  const css = await response.text();
  const html = `<!doctype html><html lang="en" style="${esc(document.documentElement.style.cssText)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(title)}</title><style>${css}</style></head><body class="receipt-document"><main class="message-text">${copy.outerHTML}</main><p class="receipt-copy-note">Saved copy · ${esc(new Date().toLocaleString())}</p></body></html>`;
  const url = URL.createObjectURL(new Blob([html],{type:'text/html'}));
  const link = document.createElement('a'); link.href = url; link.download = `${title.replace(/[^\p{L}\p{N}-]+/gu,'-').slice(0,80) || 'Receipt'}.html`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
}

export const mascot = `<svg class="mascot" viewBox="0 0 240 180" fill="none" aria-hidden="true"><path d="M25 131c-13-30 4-68 35-87M171 36c23 4 42 20 43 40" stroke="#b9bcb2" stroke-width="1.5" stroke-dasharray="4 6"/><path d="m192 27 4 10 11 2-9 7 1 11-9-7-10 4 4-10-6-9 11 1Z" fill="#ff6946"/><ellipse cx="118" cy="161" rx="53" ry="6" fill="#e6e7df"/><path d="M67 98c-14 0-24 7-23 19 1 9 14 12 26 3m103-28c14-2 28 3 26 15-1 9-16 15-28 10" stroke="#292b28" stroke-width="3" stroke-linecap="round"/><path d="M91 142v15m50-15 6 14" stroke="#292b28" stroke-width="4" stroke-linecap="round"/><path d="M68 74c0-27 20-40 54-40 32 0 52 13 52 40v39c0 27-22 40-53 40-32 0-53-13-53-40V74Z" fill="#b8d7ec" stroke="#292b28" stroke-width="2.5"/><path d="M76 67c5-17 18-24 39-25" stroke="#fffaf1" stroke-width="5" stroke-linecap="round"/><g class="mascot-eyes"><path d="M100 79v14m38-14v14" stroke="#292b28" stroke-width="6" stroke-linecap="round"/></g><path d="M110 108q10 9 21 0" stroke="#292b28" stroke-width="3" stroke-linecap="round"/><path d="M126 140h48l-6-30h-45l3 30Z" fill="#fffaf1" stroke="#292b28" stroke-width="2"/><path d="M123 140h57" stroke="#292b28" stroke-width="3" stroke-linecap="round"/><circle cx="146" cy="125" r="4" fill="#ff6946"/><path d="m41 40 3-12m-11 8 13 3" stroke="#292b28" stroke-width="2" stroke-linecap="round"/><circle cx="205" cy="123" r="3" fill="#292b28"/></svg>`;
