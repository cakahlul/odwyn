import { timingSafeEqual, createHash } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export function authorize(header, user, password) {
  if (!user || !password || !header?.startsWith('Basic ')) return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(Buffer.from(header.slice(6), 'base64').toString()), digest(`${user}:${password}`));
}

export function allowedOrigin(origin, expected) { return origin === expected; }

const denied = new BlockList();
for (const [ip, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) denied.addSubnet(ip, prefix, 'ipv4');
denied.addSubnet('2001:db8::', 32, 'ipv6');
denied.addSubnet('2002::', 16, 'ipv6');
export function publicAddress(ip) {
  const family = isIP(ip);
  if (family === 4) return !denied.check(ip, 'ipv4');
  if (family === 6) return /^[23]/.test(ip) && !denied.check(ip, 'ipv6');
  return false;
}

export function webUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw new Error('Use a public HTTP or HTTPS website on port 80 or 443.');
  return url;
}

export async function resolvePublic(raw) {
  const url = webUrl(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('Private and reserved network destinations are blocked.');
  return { url, address: addresses[0].address, family: addresses[0].family };
}

export const actions = ['read','navigate','click','fill','type','press','scroll','select','tab','new_tab','close_tab','back','wait','screenshot','save_screenshot','upload','dialog'];
export const interactions = new Set(['click','fill','type','press','select','upload','dialog']);

export const interactionModes = ['confirm','safe','allow'];

export const browserApprovalRequired = (mode, risk) => mode === 'confirm' || !['safe','interaction'].includes(risk) || mode === 'safe' && risk !== 'safe';

export function browserActionRisk(action, context = {}) {
  if (!interactions.has(action.action)) return 'safe';
  const el = context.element;
  // ponytail: conservative DOM heuristics; unknown targets ask rather than guessing site-side effects.
  const payment = /\b(pay(?:ment)?|checkout|billing|credit card|card number|cvv|cvc|buy|purchase|place order|donat(?:e|ion)|transfer|subscribe|subscription|book now|confirm booking|bayar|pembayaran|beli)\b/i;
  if (context.hasPaymentFields || payment.test([context.url,el?.label,el?.context,el?.autocomplete,el?.href,action.reason].join(' ')) || /^cc-/.test(el?.autocomplete || '')) return 'payment';
  if (action.action === 'dialog') return action.choice === 'dismiss' ? 'safe' : 'unknown';
  if (action.action === 'press' && ['Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End'].includes(action.text)) return 'safe';
  if (!el || el.type === 'password' || /password|one-time-code/.test(el.autocomplete || '')) return 'unknown';
  const safeField = /\b(search|filter|sort|check.?in|check.?out|destination|dates?|adults?|children|rooms?|guests?|city|location|departure|arrival|budget)\b/i;
  if (['fill','select'].includes(action.action)) return el.type === 'search' || safeField.test(el.label) ? 'safe' : 'interaction';
  if (action.action === 'click') {
    if (el.tag === 'a' && /^https?:/.test(el.href || '') && !/delete|remove|unsubscribe|logout|action=/i.test(el.href)) return 'safe';
    if (/^(search|find|filter|sort|next page|previous page|close|dismiss|accept (all )?cookies|reject (all )?cookies|cookie settings|show more|load more)\b/i.test(el.label)) return 'safe';
    return 'interaction';
  }
  if (action.action === 'upload') return 'interaction';
  return 'unknown';
}

export function validateAction(input) {
  if (!input || !actions.includes(input.action)) throw new Error('Unknown browser action.');
  const result = { ...input };
  if (input.url !== undefined) { if (typeof input.url !== 'string' || input.url.length > 4000) throw new Error('Invalid URL.'); webUrl(input.url); }
  if (['navigate','new_tab'].includes(input.action) && !input.url) throw new Error('A website URL is required.');
  if (input.ref !== undefined && !/^\d{1,5}$/.test(String(input.ref))) throw new Error('Use an element reference from the latest page snapshot.');
  for (const key of ['x','y']) if (input[key] !== undefined && (!Number.isFinite(input[key]) || input[key] < 0 || input[key] > (key === 'x' ? 1280 : 800))) throw new Error('Invalid screen coordinate.');
  if (input.action === 'click' && input.ref === undefined && !(Number.isFinite(input.x) && Number.isFinite(input.y))) throw new Error('Click needs a reference or coordinates.');
  if (['fill','select','upload'].includes(input.action) && input.ref === undefined) throw new Error('An element reference is required.');
  if (['fill','type','select','press'].includes(input.action) && (typeof input.text !== 'string' || input.text.length > 20_000)) throw new Error('Text is required (maximum 20,000 characters).');
  if (input.action === 'press' && !/^(?:Control\+|Meta\+|Shift\+|Alt\+)*(?:[A-Za-z0-9]|Enter|Tab|Escape|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Space)$/.test(input.text)) throw new Error('Unsupported browser key.');
  if (input.action === 'tab' && (!Number.isInteger(input.index) || input.index < 0)) throw new Error('Choose a tab index.');
  if (input.action === 'scroll' && (!Number.isFinite(input.delta) || Math.abs(input.delta) > 4000)) throw new Error('Scroll must be between -4000 and 4000 pixels.');
  if (input.action === 'wait' && (!Number.isFinite(input.ms) || input.ms < 0 || input.ms > 10_000)) throw new Error('Wait must be at most 10 seconds.');
  if (input.action === 'upload' && (typeof input.fileId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.fileId))) throw new Error('Choose an uploaded file ID.');
  if (input.action === 'dialog' && !['accept','dismiss'].includes(input.choice)) throw new Error('Choose accept or dismiss.');
  return result;
}

export function textInput(value, maximum = 20_000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`Enter text between 1 and ${maximum} characters.`);
  return value.trim();
}
