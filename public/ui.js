export const $ = selector => document.querySelector(selector);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const paths = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
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

export function richText(text) {
  const container = document.createElement('div'); container.className = 'message-text';
  const blocks = String(text || '').split(/```(?:\w+)?\n?([\s\S]*?)```/g);
  blocks.forEach((block, index) => {
    if (index % 2) { const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = block; pre.append(code); container.append(pre); return; }
    const paragraph = document.createElement('div');
    let offset = 0;
    for (const match of block.matchAll(/\*\*([^*]+)\*\*|`([^`]+)`|https?:\/\/[^\s<>]+/g)) {
      paragraph.append(document.createTextNode(block.slice(offset, match.index)));
      if (match[1] || match[2]) { const node = document.createElement(match[1] ? 'strong' : 'code'); node.textContent = match[1] || match[2]; paragraph.append(node); }
      else { const link = document.createElement('a'); link.href = match[0].replace(/[).,;]+$/, ''); link.textContent = match[0]; link.target = '_blank'; link.rel = 'noopener noreferrer'; paragraph.append(link); }
      offset = match.index + match[0].length;
    }
    paragraph.append(document.createTextNode(block.slice(offset))); container.append(paragraph);
  });
  return container;
}
