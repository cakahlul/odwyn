import { Marked, Renderer } from '/vendor/marked.js';

export const $ = selector => document.querySelector(selector);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const paths = {
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 10 10 0 0 1-4-.8L3 21l1.8-5a9 9 0 1 1 16.2-4.5Z"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  folder: '<path d="M3 7V5h6l3 3h9v12H3V7Z"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  settings: '<path d="m9 3-1 3-3 1-2 3 2 2v3l3 1 1 3h4l1-3 3-1v-3l2-2-2-3-3-1-1-3Z"/><circle cx="11" cy="11" r="3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>', 'arrow-up': '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  cursor: '<path d="m4 3 5 18 3-8 8-3L4 3Z"/>', shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  paperclip: '<path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L12 3a7 7 0 0 1 10 10L12 23"/>',
  check: '<path d="m5 12 4 4L19 6"/>', link: '<path d="m9 15 6-6m-8 4-2 2a4 4 0 0 0 6 6l3-3m-4-12 3-3a4 4 0 0 1 6 6l-2 2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>', play: '<path d="m8 4 12 8-12 8V4Z"/>', pause: '<path d="M8 4v16M16 4v16"/>',
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

function answerLink(href, label, title = '') {
  try { if (!['http:','https:','mailto:'].includes(new URL(href).protocol)) return label; }
  catch { return label; }
  return `<a href="${esc(href)}" title="${esc(title)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

const markdown = new Marked({ gfm:true, breaks:true, renderer: {
  // Replies are untrusted: escape raw HTML and allow only safe link protocols.
  html({ text }) { return esc(text); },
  link({ href, title, tokens }) { return answerLink(href,this.parser.parseInline(tokens),title); },
  image({ href, text, title }) { return answerLink(href,esc(text || 'View image'),title); },
  heading({ depth, tokens }) { const level = Math.min(depth+1,6); return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>`; },
  table(token) { return `<div class="table-scroll" tabindex="0" role="region" aria-label="Comparison table">${Renderer.prototype.table.call(this,token)}</div>`; },
} });

export function richText(text) {
  const container = document.createElement('div'); container.className = 'message-text';
  container.innerHTML = markdown.parse(String(text || ''));
  return container;
}

export const mascot = `<svg class="mascot" viewBox="0 0 240 180" fill="none" aria-hidden="true"><path d="M25 131c-13-30 4-68 35-87M171 36c23 4 42 20 43 40" stroke="#b9bcb2" stroke-width="1.5" stroke-dasharray="4 6"/><path d="m192 27 4 10 11 2-9 7 1 11-9-7-10 4 4-10-6-9 11 1Z" fill="#ff6946"/><ellipse cx="118" cy="161" rx="53" ry="6" fill="#e6e7df"/><path d="M67 98c-14 0-24 7-23 19 1 9 14 12 26 3m103-28c14-2 28 3 26 15-1 9-16 15-28 10" stroke="#292b28" stroke-width="3" stroke-linecap="round"/><path d="M91 142v15m50-15 6 14" stroke="#292b28" stroke-width="4" stroke-linecap="round"/><path d="M68 74c0-27 20-40 54-40 32 0 52 13 52 40v39c0 27-22 40-53 40-32 0-53-13-53-40V74Z" fill="#b8d7ec" stroke="#292b28" stroke-width="2.5"/><path d="M76 67c5-17 18-24 39-25" stroke="#fffaf1" stroke-width="5" stroke-linecap="round"/><g class="mascot-eyes"><path d="M100 79v14m38-14v14" stroke="#292b28" stroke-width="6" stroke-linecap="round"/></g><path d="M110 108q10 9 21 0" stroke="#292b28" stroke-width="3" stroke-linecap="round"/><path d="M126 140h48l-6-30h-45l3 30Z" fill="#fffaf1" stroke="#292b28" stroke-width="2"/><path d="M123 140h57" stroke="#292b28" stroke-width="3" stroke-linecap="round"/><circle cx="146" cy="125" r="4" fill="#ff6946"/><path d="m41 40 3-12m-11 8 13 3" stroke="#292b28" stroke-width="2" stroke-linecap="round"/><circle cx="205" cy="123" r="3" fill="#292b28"/></svg>`;
