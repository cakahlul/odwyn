export const agentModeInstructions = `Always-on modes, mandatory for every turn and every agent:
Caveman ultra: compact phrasing, plain words, no filler. Drop articles (a/an/the), pleasantries and conjunctions when meaning stays clear; preserve grammar markers in other languages. In rooms, use brief natural chat sentences or fragments; preserve conversational flow without robotic status reports or mandatory name prefixes. Default answer: at most three short lines, no blank paragraphs, 35 words total; room discussion: at most 30 words per turn. A routine explanation should look like "Pool reuses open DB connections. Fewer handshakes; lower latency. Caps concurrency; exhausted pool waits or times out." State each fact once. Lead with the answer or new evidence. No greetings, praise, preambles, tool narration, decorative headings, repeated acknowledgments or recap of prior replies. Do not announce these modes. Prefer "Connection pool reuses DB connections. Fewer handshakes; lower latency." over a paragraph introducing the topic. Preserve negatives, technical terms, numbers, units, evidence, links, requested language and safety. Expand only when explicitly requested content, a complete deliverable, accuracy or safety requires it. Code, product JSON, files and requested writing retain their required format and voice.
Ponytail ultra: smallest correct solution and next action. Inspect the real flow first. Reuse existing code, standard library and native features; delete before adding. No speculative abstractions, dependencies, scaffolding, feature tours or plans for work nobody requested. Prefer a small concrete improvement over a broad redesign. Implement authorized work instead of merely proposing it; verify with the smallest meaningful check. Never cut explicit requirements, input validation, security, accessibility or error handling that prevents data loss.
These rules override personality tone, saved reply-depth preferences and verbose historical replies. Stay concise after interruptions and redirections.`;

export const currencies = ['source', ...Intl.supportedValuesOf('currency')];
export const effortLevels = {codex:['default','none','minimal','low','medium','high','xhigh','max'],claude:['default','low','medium','high','max'],openai:['default','none','minimal','low','medium','high','xhigh','max']};
export const defaults = { palette:'paper', motion:'system', shape:'squircle', bodyColor:'#f26945', eyeColor:'#292b28', mouthColor:'#292b28', eyes:'bars', mouth:'smile', accessory:'none', name:'Odwyn', specialization:'', ownerName:'', tone:'warm', language:'auto', detail:'adaptive', userContext:'' };
export const agentColor = profile => /^#[0-9a-f]{6}$/i.test(profile?.bodyColor) ? profile.bodyColor : defaults.bodyColor;
export const ownerPreferenceKeys = ['ownerName','language','detail','userContext'];
export function resolveProfile(profile, appearance = {}, owner = {}) {
  return {...defaults,...profile,...(profile?.overrideWorkspace ? {} : {...appearance,...Object.fromEntries(ownerPreferenceKeys.filter(key=>owner[key] !== undefined).map(key=>[key,owner[key]]))})};
}
export const palettes = {
  paper: { name:'Mineral', colors:['#e8edf2', '#dce4ed', '#df603b'], vars:{'paper':'#e8edf2','sidebar':'#dce4ed','orange':'#df603b','surface':'#fbfcfe','ink':'#192330','muted':'#4c5c70','line':'#c4cfdd','orange-deep':'#a43b20','orange-light':'#fff0e8','wash':'#dfe6ef','selected':'#cdd9e8','shadow-ink':'#08111e','scheme':'light','green':'#246b4d','green-light':'#dfe6ef','danger':'#a73532'} },
  fern: { name:'Forest', colors:['#dce8e3', '#ccddd5', '#278369'], vars:{'paper':'#dce8e3','sidebar':'#ccddd5','orange':'#278369','surface':'#f7fcfa','ink':'#17352c','muted':'#365749','line':'#b8cec3','orange-deep':'#16634c','orange-light':'#e1f3eb','wash':'#d4e5dc','selected':'#bbd5c8','shadow-ink':'#08111e','scheme':'light','green':'#246b4d','green-light':'#d4e5dc','danger':'#a73532'} },
  harbor: { name:'Tidal', colors:['#dce6f2', '#cad9eb', '#3378d1'], vars:{'paper':'#dce6f2','sidebar':'#cad9eb','orange':'#3378d1','surface':'#f7faff','ink':'#1a304a','muted':'#365575','line':'#b3c9e1','orange-deep':'#215ca7','orange-light':'#e2edfc','wash':'#d3e0f0','selected':'#b8cfe9','shadow-ink':'#08111e','scheme':'light','green':'#246b4d','green-light':'#d3e0f0','danger':'#a73532'} },
  rose: { name:'Garnet', colors:['#eae0e6', '#deccd6', '#ad466a'], vars:{'paper':'#eae0e6','sidebar':'#deccd6','orange':'#ad466a','surface':'#fff9fc','ink':'#3c2532','muted':'#634555','line':'#d1b8c6','orange-deep':'#923554','orange-light':'#fae4ee','wash':'#e6d5df','selected':'#d8bccd','shadow-ink':'#08111e','scheme':'light','green':'#246b4d','green-light':'#e6d5df','danger':'#a73532'} },
  clay: { name:'Bronze', colors:['#e9e1d5', '#ddd0bd', '#ae6737'], vars:{'paper':'#e9e1d5','sidebar':'#ddd0bd','orange':'#ae6737','surface':'#fffbf4','ink':'#382b20','muted':'#594835','line':'#cebea8','orange-deep':'#884a22','orange-light':'#fae9d6','wash':'#e6d9c5','selected':'#d5bea0','shadow-ink':'#08111e','scheme':'light','green':'#246b4d','green-light':'#e6d9c5','danger':'#a73532'} },
  graphite: { name:'Graphite', colors:['#151b23', '#1b2430', '#ed976b'], vars:{'paper':'#151b23','sidebar':'#1b2430','orange':'#ed976b','surface':'#253140','ink':'#eff4fa','muted':'#bfccdb','line':'#43536a','orange-deep':'#ffba95','orange-light':'#49342e','wash':'#303e50','selected':'#40516a','shadow-ink':'#08111e','scheme':'dark','green':'#92d7b5','green-light':'#303e50','danger':'#ffaaa7'} },
  midnight: { name:'Midnight', colors:['#101d2d', '#162b40', '#6dbbe7'], vars:{'paper':'#101d2d','sidebar':'#162b40','orange':'#6dbbe7','surface':'#20374e','ink':'#eef6fc','muted':'#c3d4e3','line':'#3c5c77','orange-deep':'#a5ddfc','orange-light':'#254c67','wash':'#2a455f','selected':'#375b7b','shadow-ink':'#08111e','scheme':'dark','green':'#92d7b5','green-light':'#2a455f','danger':'#ffaaa7'} },
};
export const choices = { motion:{system:'Follow device',reduced:'Less motion'}, shape:{ squircle:'Pocket', bean:'Bean', orb:'Orbit', cat:'Cat', robot:'Robot', fox:'Fox' }, eyes:{ bars:'Classic', dots:'Dots', happy:'Happy', wink:'Wink', sleepy:'Relaxed', wide:'Curious' }, mouth:{ smile:'Smile', grin:'Grin', o:'Surprised', flat:'Calm', cheerful:'Cheerful' }, accessory:{ none:'None', antenna:'Antenna', spark:'Spark', cap:'Cap', headphones:'Headphones', bow:'Bow' }, tone:{ warm:'Warm', crisp:'Direct', playful:'Playful', formal:'Professional', patient:'Patient', coach:'Encouraging' }, language:{auto:'Match my message',en:'English',id:'Bahasa Indonesia',es:'Español',fr:'Français',ja:'日本語'}, detail:{adaptive:'Adapt to the task',brief:'Keep it brief',detailed:'Explain in detail'} };
export const toneInstructions = { warm:'Friendly and supportive, with plain language.', crisp:'Concise and direct. Lead with the answer; skip filler.', playful:'Light wit and a relaxed voice. Keep serious matters clear and respectful.', formal:'Professional, courteous and precise.', patient:'Patient and calm. Explain unfamiliar ideas step by step, without assuming prior knowledge.', coach:'Encouraging and practical. Break work into achievable next steps without empty praise.' };
export const detailInstructions = {adaptive:'Match the depth to the task.',brief:'Keep replies short, with the answer first and only essential details.',detailed:'Explain the reasoning, relevant details and useful examples.'};
export const paletteDetails = {paper:'Cool mineral glass. Fired orange accent.',fern:'Forest greens. Polished jade accent.',harbor:'Ocean glass. Deep blue accent.',rose:'Smoked rose. Garnet accent.',clay:'Sandstone glass. Burnished bronze accent.',graphite:'Dark graphite. Copper light.',midnight:'Deep navy glass. Ice blue light.'};
export const materialDefaults = {opacity:78,blur:24,depth:65,radius:16};
export const materialLimits = {opacity:[60,100],blur:[0,32],depth:[0,100],radius:[4,24]};
export const customColorKeys = ['paper','surface','orange'];
const hexColor = /^#[0-9a-f]{6}$/i;
const rgb = color => [1,3,5].map(start=>parseInt(color.slice(start,start+2),16));
const mixColor = (a,b,weight) => '#'+rgb(a).map((value,i)=>Math.round(value*(1-weight)+rgb(b)[i]*weight).toString(16).padStart(2,'0')).join('');
const luminance = color => rgb(color).map(value=>{value/=255;return value<=.04045 ? value/12.92 : ((value+.055)/1.055)**2.4;}).reduce((sum,value,i)=>sum+value*[.2126,.7152,.0722][i],0);
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);

export function appearanceVars(appearance = {}) {
  const vars = {...(palettes[appearance.palette] || palettes.paper).vars}, custom = appearance.customColors || {};
  if (Object.keys(custom).length) {
    Object.assign(vars,custom);
    const score = color => Math.min(contrast(color,vars.paper),contrast(color,vars.surface));
    vars.ink = score('#17212e')>=score('#f4f7fb') ? '#17212e' : '#f4f7fb';
    if (score(vars.ink)<4.5) vars.ink = score('#000000')>=score('#ffffff') ? '#000000' : '#ffffff';
    vars.scheme = luminance(vars.paper)<.2 ? 'dark' : 'light';
    vars.muted = mixColor(vars.ink,vars.surface,.2);
    if (score(vars.muted)<4.5) vars.muted = vars.ink;
    vars.sidebar = mixColor(vars.paper,vars.surface,.25);
    vars.wash = mixColor(vars.surface,vars.paper,.6);
    vars.selected = mixColor(vars.wash,vars.orange,.12);
    vars.line = mixColor(vars.surface,vars.ink,.22);
    vars['orange-light'] = mixColor(vars.surface,vars.orange,.12);
    vars['orange-deep'] = mixColor(vars.orange,vars.ink,.45);
    vars.green = vars.scheme==='dark' ? '#92d7b5' : '#246b4d';
    vars['green-light'] = vars.wash;
    vars.danger = vars.scheme==='dark' ? '#ffaaa7' : '#a73532';
    for (const key of ['orange-deep','green','danger']) if (contrast(vars[key],vars.surface)<4.5) vars[key] = vars.ink;
  }
  vars['accent-ink'] = contrast('#17212e',vars.orange)>=contrast('#f4f7fb',vars.orange) ? '#17212e' : '#f4f7fb';
  return {...vars,...Object.fromEntries(Object.entries(materialDefaults).map(([key,value])=>['ui-'+key,appearance[key] ?? value]))};
}

export function validateAppearance(input) {
  if (!input || typeof input!=='object' || Array.isArray(input) || !Object.hasOwn(palettes,input.palette) || !Object.hasOwn(choices.motion,input.motion)) throw new Error('Choose a palette and motion preference.');
  const result = {palette:input.palette,motion:input.motion};
  for (const [key,[min,max]] of Object.entries(materialLimits)) {
    if (input[key]===undefined) continue;
    if (!Number.isInteger(input[key]) || input[key]<min || input[key]>max) throw new Error(`Choose ${key} between ${min} and ${max}.`);
    result[key] = input[key];
  }
  if (input.customColors!==undefined) {
    if (!input.customColors || typeof input.customColors!=='object' || Array.isArray(input.customColors)) throw new Error('Choose custom colors.');
    result.customColors = {};
    for (const [key,color] of Object.entries(input.customColors)) {
      if (!customColorKeys.includes(key) || typeof color!=='string' || !hexColor.test(color)) throw new Error('Use six-digit hex colors for background, surface, and accent.');
      result.customColors[key] = color.toLowerCase();
    }
    const vars = appearanceVars(result);
    if ([vars.paper,vars.surface,vars.selected].some(color=>contrast(vars.ink,color)<4.5)) throw new Error('Choose background and surface colors with similar brightness for readable text.');
  }
  return result;
}

export const specializations = {general:'',research:'Research and compare options. Verify facts and cite sources.',coding:'Help with coding, debugging and technical explanations.',travel:'Plan trips, compare flights and stays, and organize itineraries.',shopping:'Compare products, prices and sellers. Track purchase details and receipts.',writing:'Help draft, edit and improve clear, natural writing.'};

export function validateProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose your customization.');
  const result = {};
  if (input.overrideWorkspace !== undefined) {
    if (typeof input.overrideWorkspace !== 'boolean') throw new Error('Choose whether to override workspace settings.');
    result.overrideWorkspace = input.overrideWorkspace;
  }
  for (const key of Object.keys(defaults)) {
    const value = input[key] === undefined && ['motion','language','detail','userContext'].includes(key) ? defaults[key] : input[key];
    if (typeof value !== 'string') throw new Error(`Choose ${key}.`);
    if (key === 'palette' && !Object.hasOwn(palettes,value) || choices[key] && !Object.hasOwn(choices[key],value)) throw new Error(`Invalid ${key}.`);
    if (key.endsWith('Color') && !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Use a six-digit hex color.');
    const multiline = ['specialization','userContext'].includes(key), limit = multiline ? 500 : 40;
    if (value.length > limit || (!multiline && /[\x00-\x1f\x7f]/.test(value)) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new Error(`${key} must be at most ${limit} characters.`);
    result[key] = value.trim();
  }
  if (!result.name) throw new Error('Give your agent a name.');
  return result;
}

let artworkId = 0;
export function avatarSvg(profile = defaults, className = 'agent-avatar') {
  const p = {...defaults,...profile};
  const color = key => /^#[0-9a-f]{6}$/i.test(p[key]) ? p[key] : defaults[key];
  const bodies = { squircle:'<rect x="20" y="22" width="80" height="80" rx="26"/>', bean:'<path d="M22 60c0-28 14-43 37-43 29 0 42 19 42 43v15c0 20-17 29-40 29S22 95 22 76Z"/>', orb:'<circle cx="60" cy="63" r="42"/>', cat:'<path d="m22 44-3-27 25 15q16-8 32 0l25-15-3 27q9 14 4 34c-4 18-21 27-42 27S22 96 18 78q-5-20 4-34Z"/>', robot:'<rect x="18" y="29" width="84" height="68" rx="19"/><rect x="10" y="48" width="8" height="28" rx="4"/><rect x="102" y="48" width="8" height="28" rx="4"/>', fox:'<path d="m18 48 6-31 25 18q11-4 22 0l25-18 6 31q9 35-42 59Q9 83 18 48Z"/>' };
  const eyes = { bars:'<path d="M45 49v10m30-10v10"/>', dots:'<circle cx="45" cy="54" r="2"/><circle cx="75" cy="54" r="2"/>', happy:'<path d="M39 56q6-12 12 0m18 0q6-12 12 0"/>', wink:'<path d="M45 49v10m23-5 7-4 6 4"/>', sleepy:'<path d="M39 54q6 6 12 0m18 0q6 6 12 0"/>', wide:'<ellipse cx="44" cy="54" rx="4" ry="7"/><ellipse cx="76" cy="54" rx="4" ry="7"/>' };
  const mouths = { smile:'<path d="M46 74q14 14 28 0"/>', grin:'<path d="M46 73h28q-2 16-14 16T46 73Z"/>', o:'<ellipse cx="60" cy="78" rx="6" ry="8"/>', flat:'<path d="M49 77h22"/>', cheerful:'<path d="M43 72q17 23 34 0M40 70l4-2m32 0 4 2"/>' };
  const accessories = { none:'', antenna:'<path d="M60 20V9" stroke="#292b28" stroke-width="3"/><circle cx="60" cy="7" r="4" fill="currentColor"/>', spark:'<path d="m102 9 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="currentColor"/>', cap:'<path d="M29 28q5-24 31-24t31 24H29Z" fill="currentColor" stroke="#292b28" stroke-width="2"/><path d="M25 28h74" stroke="#292b28" stroke-width="4" stroke-linecap="round"/>', headphones:'<path d="M17 62V48a43 43 0 0 1 86 0v14" fill="none" stroke="#35465a" stroke-width="7"/><rect x="9" y="48" width="15" height="30" rx="7" fill="#526a81"/><rect x="96" y="48" width="15" height="30" rx="7" fill="#526a81"/>', bow:'<path d="m62 25-21-15q-8 16 0 25Zm0 0 21-15q8 16 0 25Z" fill="#b85170"/><circle cx="62" cy="25" r="6" fill="#e693ab"/>' };
  const id = `avatar-${++artworkId}`, body = bodies[p.shape] || bodies.squircle;
  return `<svg class="${className}" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><radialGradient id="${id}-light" cx="28%" cy="18%" r="85%"><stop stop-color="#fff" stop-opacity=".65"/><stop offset=".42" stop-color="#fff" stop-opacity=".08"/><stop offset=".75" stop-color="#000" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></radialGradient><filter id="${id}-shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="1" dy="2" stdDeviation="1" flood-opacity=".25"/></filter></defs><ellipse cx="62" cy="111" rx="33" ry="5" fill="#242a22" opacity=".12"/><g fill="${color('bodyColor')}"><g transform="translate(2 4)">${body}</g><g transform="translate(2 4)" fill="#000" opacity=".24">${body}</g>${body}<g fill="url(#${id}-light)">${body}</g></g><g class="avatar-eyes" fill="none" stroke="${color('eyeColor')}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}-shadow)">${eyes[p.eyes] || eyes.bars}</g><g class="avatar-mouth" fill="none" stroke="${color('mouthColor')}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}-shadow)">${mouths[p.mouth] || mouths.smile}</g><g color="${color('bodyColor')}" filter="url(#${id}-shadow)">${accessories[p.accessory] || ''}</g></svg>`;
}

export function sampleReply(profile) {
  const address = profile.ownerName ? `, ${profile.ownerName}` : '';
  if (profile.language && !['auto','en'].includes(profile.language)) {
    const samples = {id:[`Siap${address}. Saya akan membandingkan tiga pilihan dan memeriksa sumbernya.`,` Saya akan menjelaskan kelebihan, kekurangan, dan alasan setiap pilihan.`],es:[`Claro${address}. Compararé tres opciones y verificaré las fuentes.`,` Explicaré las ventajas, las desventajas y los motivos de cada opción.`],fr:[`Bien sûr${address}. Je comparerai trois options et vérifierai les sources.`,` Je détaillerai les avantages, les limites et les raisons de chaque choix.`],ja:[`${profile.ownerName ? profile.ownerName+'さん、' : ''}３つの候補を比較し、情報源を確認します。`,`それぞれの利点、注意点、選んだ理由を詳しく説明します。`]};
    const [reply,more] = samples[profile.language] || samples.id;
    return profile.detail === 'brief' ? (profile.language === 'ja' ? reply : reply.slice(reply.indexOf('. ')+2)) : reply + (profile.detail === 'detailed' ? more : '');
  }
  const reply = {warm:`Of course${address}. I’ll put together a short list and check the details before you decide.`,crisp:`I’ll compare the options${address}. You’ll get the top three, with sources.`,playful:`On it${address}. I’ll wrangle the tabs. You get the shortlist.`,formal:`Certainly${address}. I will compare the options and provide a sourced recommendation.`,patient:`Happy to help${address}. We’ll go one step at a time: choose what matters, compare options, then check the details.`,coach:`Let’s get started${address}. I’ll compare three options so you can take the next step with confidence.`}[profile.tone] || '';
  return profile.detail === 'brief' ? `I’ll compare three options${address}, with sources.` : reply + (profile.detail === 'detailed' ? ' I’ll explain the tradeoffs, include sources, and walk through why each option fits.' : '');
}
