export const agentModeInstructions = `Always-on modes, mandatory for every turn and every agent:
Caveman ultra: compact phrasing, plain words, no filler. Drop articles (a/an/the), pleasantries and conjunctions when meaning stays clear; preserve grammar markers in other languages. In rooms, use brief natural chat sentences or fragments; preserve conversational flow without robotic status reports or mandatory name prefixes. Default answer: at most three short lines, no blank paragraphs, 35 words total; room discussion: at most 30 words per turn. A routine explanation should look like "Pool reuses open DB connections. Fewer handshakes; lower latency. Caps concurrency; exhausted pool waits or times out." State each fact once. Lead with the answer or new evidence. No greetings, praise, preambles, tool narration, decorative headings, repeated acknowledgments or recap of prior replies. Do not announce these modes. Prefer "Connection pool reuses DB connections. Fewer handshakes; lower latency." over a paragraph introducing the topic. Preserve negatives, technical terms, numbers, units, evidence, links, requested language and safety. Expand only when explicitly requested content, a complete deliverable, accuracy or safety requires it. Code, product JSON, files and requested writing retain their required format and voice.
Ponytail ultra: smallest correct solution and next action. Inspect the real flow first. Reuse existing code, standard library and native features; delete before adding. No speculative abstractions, dependencies, scaffolding, feature tours or plans for work nobody requested. Prefer a small concrete improvement over a broad redesign. Implement authorized work instead of merely proposing it; verify with the smallest meaningful check. Never cut explicit requirements, input validation, security, accessibility or error handling that prevents data loss.
Scope-fit check before planning: compare the requested outcome with the existing implementation. Simple task: inspect/reuse, change, focused verification, finish. Treat a local UI, theme, text or style change as small unless inspection reveals a concrete wider dependency. Small tasks need at most three practical steps. Complex task: break it into small, concrete, independently verifiable changes until each is simple to execute; work through them in dependency order, checking each before moving on. Split around real dependencies, not job titles or document templates. For example, adding three login-page themes normally needs existing theme styles and a visual/interaction check, not backend contracts, migrations, new frameworks or project architecture. Expand only for an explicit requirement or an observed dependency/risk; name that reason briefly. Do not create a separate scope report or ask the owner to approve routine steps.
In rooms, the facilitator sets the smallest scope and routes concrete work to the responsible author. Reviewers check scope fit as well as correctness. Other roles must not invent work to justify participation: for an unaffected role's document output, record "No backend changes needed" with a reason rather than inventing backend work. Still fulfill explicitly required content and evidence. Keep required drafts proportional to the task, reuse agreed decisions, and avoid optional artifacts, repeated planning and handoffs without new work or evidence. Proceed directly to configured checks and completion once the result meets the request. Required outputs, designated reviews, contributor confirmations and owner approval gates still apply; never skip them because a task is small.
These rules override personality tone, saved reply-depth preferences and verbose historical replies. Stay concise after interruptions and redirections.`;

export const currencies = ['source', ...Intl.supportedValuesOf('currency')];
export const effortLevels = {codex:['default','none','minimal','low','medium','high','xhigh','max'],claude:['default','low','medium','high','max'],openai:['default','none','minimal','low','medium','high','xhigh','max']};
export const defaults = { palette:'paper', motion:'system', shape:'squircle', bodyColor:'#f26945', eyeColor:'#292b28', mouthColor:'#292b28', eyes:'bars', mouth:'smile', accessory:'none', name:'Odwyn', specialization:'', ownerName:'', tone:'warm', language:'auto', detail:'adaptive', userContext:'' };
export const agentColor = profile => /^#[0-9a-f]{6}$/i.test(profile?.bodyColor) ? profile.bodyColor : defaults.bodyColor;
export const profileTextLimit = 100_000;

export const ownerPreferenceKeys = ['ownerName','language','detail','userContext'];
export function resolveProfile(profile, appearance = {}, owner = {}) {
  return {...defaults,...profile,...(profile?.overrideWorkspace ? {} : {...appearance,...Object.fromEntries(ownerPreferenceKeys.filter(key=>owner[key] !== undefined).map(key=>[key,owner[key]]))})};
}
export const palettes = {
  paper: { name:'Linen', colors:['#f4f2ee', '#ffffff', '#d95836'], vars:{'paper':'#f4f2ee','sidebar':'#ebe8e1','orange':'#d95836','surface':'#ffffff','ink':'#18181b','muted':'#52525b','line':'#dfd9cf','orange-deep':'#b33e20','orange-light':'#fdece6','wash':'#eeebe4','selected':'#e4dfd5','shadow-ink':'#1c1b18','scheme':'light','green':'#15803d','green-light':'#dcfce7','danger':'#b91c1c'} },
  fern: { name:'Sage', colors:['#eaf3ef', '#f9fcfa', '#16795b'], vars:{'paper':'#eaf3ef','sidebar':'#deebe5','orange':'#16795b','surface':'#f9fcfa','ink':'#102a22','muted':'#335449','line':'#c5dad0','orange-deep':'#0f5c44','orange-light':'#dcfce7','wash':'#e2efe9','selected':'#cfe3da','shadow-ink':'#122b23','scheme':'light','green':'#15803d','green-light':'#dcfce7','danger':'#b91c1c'} },
  harbor: { name:'Glacier', colors:['#eaf1f8', '#f9fbff', '#2563eb'], vars:{'paper':'#eaf1f8','sidebar':'#dde7f3','orange':'#2563eb','surface':'#f9fbff','ink':'#10233d','muted':'#344d6e','line':'#c4d5ea','orange-deep':'#1d4ed8','orange-light':'#dbeafe','wash':'#e1ebf6','selected':'#ceddf0','shadow-ink':'#122540','scheme':'light','green':'#15803d','green-light':'#dcfce7','danger':'#b91c1c'} },
  rose: { name:'Quartz', colors:['#f5ecf0', '#fff9fb', '#be3460'], vars:{'paper':'#f5ecf0','sidebar':'#ebdde4','orange':'#be3460','surface':'#fff9fb','ink':'#321622','muted':'#5e3c4b','line':'#dec7d2','orange-deep':'#9b2349','orange-light':'#fce7f3','wash':'#efe2e8','selected':'#e4d0da','shadow-ink':'#331623','scheme':'light','green':'#15803d','green-light':'#dcfce7','danger':'#b91c1c'} },
  clay: { name:'Sandstone', colors:['#f2ece2', '#fffdf9', '#b45309'], vars:{'paper':'#f2ece2','sidebar':'#e8dfd1','orange':'#b45309','surface':'#fffdf9','ink':'#292018','muted':'#574636','line':'#d8cbb8','orange-deep':'#92400e','orange-light':'#fef3c7','wash':'#ebe3d6','selected':'#dfd3c0','shadow-ink':'#292018','scheme':'light','green':'#15803d','green-light':'#dcfce7','danger':'#b91c1c'} },
  graphite: { name:'Graphite', colors:['#12141a', '#191c24', '#f07152'], vars:{'paper':'#12141a','sidebar':'#151820','orange':'#f07152','surface':'#191c24','ink':'#f3f4f8','muted':'#b6bcc8','line':'#2a2f3d','orange-deep':'#f79479','orange-light':'#31211e','wash':'#20242f','selected':'#282d3b','shadow-ink':'#06070a','scheme':'dark','green':'#4ade80','green-light':'#162c20','danger':'#f87171'} },
  midnight: { name:'Midnight', colors:['#080e1a', '#10192b', '#38bdf8'], vars:{'paper':'#080e1a','sidebar':'#0b1322','orange':'#38bdf8','surface':'#10192b','ink':'#eef6fc','muted':'#b4c6dc','line':'#1e2f4a','orange-deep':'#7dd3fc','orange-light':'#152a42','wash':'#162238','selected':'#1d2d4a','shadow-ink':'#03060b','scheme':'dark','green':'#34d399','green-light':'#122923','danger':'#ffaaa7'} },
  cosmos: { name:'Carbon', colors:['#091310', '#10201b', '#10b981'], vars:{'paper':'#091310','sidebar':'#0b1713','orange':'#10b981','surface':'#10201b','ink':'#ecfdf5','muted':'#a7cfc0','line':'#1e3830','orange-deep':'#34d399','orange-light':'#122e25','wash':'#152922','selected':'#1c352c','shadow-ink':'#040907','scheme':'dark','green':'#34d399','green-light':'#142e25','danger':'#f87171'} },
};
export const choices = { motion:{system:'Follow device',reduced:'Less motion'}, shape:{ squircle:'Pocket', bean:'Bean', orb:'Orbit', cat:'Cat', robot:'Robot', fox:'Fox', bear:'Bear', pebble:'Pebble' }, eyes:{ bars:'Classic', dots:'Dots', happy:'Happy', wink:'Wink', sleepy:'Relaxed', wide:'Curious' }, mouth:{ smile:'Smile', grin:'Grin', o:'Surprised', flat:'Calm', cheerful:'Cheerful' }, accessory:{ none:'None', antenna:'Antenna', spark:'Spark', cap:'Cap', headphones:'Headphones', bow:'Bow', glasses:'Glasses', scarf:'Scarf' }, tone:{ warm:'Warm', crisp:'Direct', playful:'Playful', formal:'Professional', patient:'Patient', coach:'Encouraging' }, language:{auto:'Match my message',en:'English',id:'Bahasa Indonesia',es:'Español',fr:'Français',ja:'日本語'}, detail:{adaptive:'Adapt to the task',brief:'Keep it brief',detailed:'Explain in detail'} };
export const avatarPresets = {
  ember:{label:'Ember',shape:'squircle',bodyColor:'#e98557',eyeColor:'#342921',mouthColor:'#342921',eyes:'happy',mouth:'smile',accessory:'none'},
  moss:{label:'Moss',shape:'bear',bodyColor:'#8ca77b',eyeColor:'#253c2b',mouthColor:'#253c2b',eyes:'dots',mouth:'smile',accessory:'scarf'},
  tide:{label:'Tide',shape:'pebble',bodyColor:'#739fbd',eyeColor:'#20364b',mouthColor:'#20364b',eyes:'sleepy',mouth:'flat',accessory:'none'},
  plum:{label:'Plum',shape:'cat',bodyColor:'#b694bd',eyeColor:'#35263d',mouthColor:'#35263d',eyes:'wink',mouth:'grin',accessory:'glasses'},
  scout:{label:'Scout',shape:'fox',bodyColor:'#dda361',eyeColor:'#422f26',mouthColor:'#422f26',eyes:'wide',mouth:'smile',accessory:'headphones'},
  orbit:{label:'Orbit',shape:'robot',bodyColor:'#a1b8b4',eyeColor:'#233e39',mouthColor:'#233e39',eyes:'bars',mouth:'cheerful',accessory:'antenna'},
};
export const toneInstructions = { warm:'Friendly and supportive, with plain language.', crisp:'Concise and direct. Lead with the answer; skip filler.', playful:'Light wit and a relaxed voice. Keep serious matters clear and respectful.', formal:'Professional, courteous and precise.', patient:'Patient and calm. Explain unfamiliar ideas step by step, without assuming prior knowledge.', coach:'Encouraging and practical. Break work into achievable next steps without empty praise.' };
export const detailInstructions = {adaptive:'Match the depth to the task.',brief:'Keep replies short, with the answer first and only essential details.',detailed:'Explain the reasoning, relevant details and useful examples.'};
export const paletteDetails = {paper:'Light · Warm alabaster glass & terracotta.',fern:'Light · Botanical sage glass & emerald.',harbor:'Light · Arctic glacier glass & sapphire.',rose:'Light · Blush rose quartz & garnet.',clay:'Light · Warm sandstone glass & amber.',graphite:'Dark · Smoked obsidian glass & coral.',midnight:'Dark · Deep navy glass & ice cyan.',cosmos:'Dark · Deep carbon glass & bio-mint.'};
export const materialDefaults = {opacity:88,blur:24,depth:55,radius:20};
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
  if (input.navigation !== undefined) {
    if (!['dock','sidebar'].includes(input.navigation)) throw new Error('Choose Dock or Sidebar navigation.');
    result.navigation = input.navigation;
  }
  if (input.dockSize !== undefined) {
    if (!Number.isInteger(input.dockSize) || input.dockSize < 75 || input.dockSize > 125) throw new Error('Choose a dock size between 75% and 125%.');
    result.dockSize = input.dockSize;
  }
  if (input.dockAutoHide !== undefined) {
    if (typeof input.dockAutoHide !== 'boolean') throw new Error('Choose whether to automatically hide the dock.');
    result.dockAutoHide = input.dockAutoHide;
  }
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
  if (input.knowledgeIds !== undefined) {
    if (!Array.isArray(input.knowledgeIds) || input.knowledgeIds.length > 20 || input.knowledgeIds.some(id=>typeof id !== 'string' || !id || id.length > 100)) throw new Error('Choose up to 20 valid knowledge documents.');
    result.knowledgeIds = [...new Set(input.knowledgeIds)];
  }
  if (input.skillIds !== undefined) {
    if (!Array.isArray(input.skillIds) || input.skillIds.length > 100 || input.skillIds.some(id=>typeof id !== 'string' || !id || id.length > 100)) throw new Error('Choose valid skills.');
    result.skillIds = [...new Set(input.skillIds)];
  }
  if (input.overrideWorkspace !== undefined) {
    if (typeof input.overrideWorkspace !== 'boolean') throw new Error('Choose whether to override workspace settings.');
    result.overrideWorkspace = input.overrideWorkspace;
  }
  for (const key of Object.keys(defaults)) {
    const value = input[key] === undefined && ['motion','language','detail','userContext'].includes(key) ? defaults[key] : input[key];
    if (typeof value !== 'string') throw new Error(`Choose ${key}.`);
    if (key === 'palette' && !Object.hasOwn(palettes,value) || choices[key] && !Object.hasOwn(choices[key],value)) throw new Error(`Invalid ${key}.`);
    if (key.endsWith('Color') && !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Use a six-digit hex color.');
    const multiline = ['specialization','userContext'].includes(key), limit = multiline ? profileTextLimit : 40;
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
  const bodies = {
    bear:'<circle cx="29" cy="29" r="16"/><circle cx="91" cy="29" r="16"/><rect x="18" y="27" width="84" height="77" rx="35"/>',
    pebble:'<path d="M18 71C12 42 37 17 65 20c24 2 40 22 39 47-1 26-21 39-48 37C32 103 21 91 18 71Z"/>',
    squircle:'<rect x="19" y="21" width="82" height="82" rx="27"/>',
    bean:'<path d="M22 60c0-28 14-43 38-43 28 0 40 19 40 43v15c0 20-16 29-39 29S22 95 22 76Z"/>',
    orb:'<circle cx="60" cy="63" r="42"/>',
    cat:'<path d="m22 44-4-28 26 16q16-7 32 0l26-16-4 28q9 14 4 34c-4 18-21 27-42 27S22 96 18 78q-5-20 4-34Z"/>',
    robot:'<rect x="10" y="48" width="8" height="28" rx="4"/><rect x="102" y="48" width="8" height="28" rx="4"/><rect x="18" y="28" width="84" height="70" rx="20"/>',
    fox:'<path d="m18 48 6-32 25 19q11-4 22 0l25-19 6 32q9 35-42 58Q9 83 18 48Z"/>'
  };
  const details = {
    bear:`<circle cx="29" cy="29" r="9" fill="#ffffff" fill-opacity=".28"/><circle cx="91" cy="29" r="9" fill="#ffffff" fill-opacity=".28"/><ellipse cx="60" cy="73" rx="18" ry="13" fill="#ffffff" fill-opacity=".22"/><ellipse cx="60" cy="65" rx="5" ry="3.5" fill="${color('mouthColor')}" fill-opacity=".75"/>`,
    pebble:'<path d="M35 31q23-7 44 3" fill="none" stroke="#ffffff" stroke-opacity=".42" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="36" cy="65" rx="6" ry="3.5" fill="#ff7b7b" fill-opacity=".28"/><ellipse cx="84" cy="65" rx="6" ry="3.5" fill="#ff7b7b" fill-opacity=".28"/>',
    squircle:'<rect x="26" y="30" width="68" height="62" rx="20" fill="#ffffff" fill-opacity=".14" stroke="#ffffff" stroke-opacity=".28" stroke-width="1.2"/><ellipse cx="36" cy="64" rx="6" ry="3.5" fill="#ff7b7b" fill-opacity=".3"/><ellipse cx="84" cy="64" rx="6" ry="3.5" fill="#ff7b7b" fill-opacity=".3"/>',
    bean:'<path d="M60 17c0-6 5-10 10-9-1 5-4 8-10 9Z" fill="#65a30d"/><ellipse cx="36" cy="64" rx="6" ry="3.5" fill="#ff7b7b" fill-opacity=".3"/><ellipse cx="84" cy="64" rx="6" ry="3.5" fill="#ff7b7b" fill-opacity=".3"/>',
    orb:'<path d="M36 34q18-13 38-3" fill="none" stroke="#ffffff" stroke-opacity=".32" stroke-width="2" stroke-linecap="round"/>',
    cat:`<path d="M23 39 21 22l18 11ZM97 39l2-17-18 11Z" fill="#ffffff" fill-opacity=".28"/><path d="M56 63h8l-4 5Z" fill="${color('mouthColor')}" fill-opacity=".7"/><path d="M19 63l11 2M18 70l12-1M101 63l-11 2M102 70l-12-1" stroke="${color('eyeColor')}" stroke-opacity=".32" stroke-width="2" stroke-linecap="round"/>`,
    robot:'<rect x="26" y="37" width="68" height="48" rx="13" fill="#0f172a" fill-opacity=".18" stroke="#ffffff" stroke-opacity=".36" stroke-width="1.4"/><rect x="48" y="32" width="24" height="3" rx="1.5" fill="#ffffff" fill-opacity=".55"/><circle cx="27" cy="34" r="1.8" fill="#ffffff" fill-opacity=".45"/><circle cx="93" cy="34" r="1.8" fill="#ffffff" fill-opacity=".45"/>',
    fox:`<path d="M24 43 26 22l17 12ZM96 43 94 22 77 34Z" fill="#ffffff" fill-opacity=".3"/><path d="M20 67q20-6 40 21 20-27 40-21c-6 20-21 32-40 39-19-7-34-19-40-39Z" fill="#ffffff" fill-opacity=".25"/><circle cx="60" cy="67" r="3.8" fill="${color('mouthColor')}" fill-opacity=".8"/>`
  };
  const eyes = {
    bars:'<path d="M44 48v11m32-11v11"/><circle cx="42.5" cy="48.5" r="1.7" fill="#fff" stroke="none"/><circle cx="74.5" cy="48.5" r="1.7" fill="#fff" stroke="none"/>',
    dots:`<circle cx="44" cy="54" r="5" fill="${color('eyeColor')}" stroke="none"/><circle cx="76" cy="54" r="5" fill="${color('eyeColor')}" stroke="none"/><circle cx="42.3" cy="52.2" r="1.8" fill="#fff" stroke="none"/><circle cx="74.3" cy="52.2" r="1.8" fill="#fff" stroke="none"/>`,
    happy:'<path d="M38 56q6.5-11 13 0m18 0q6.5-11 13 0"/>',
    wink:`<circle cx="44" cy="54" r="5" fill="${color('eyeColor')}" stroke="none"/><circle cx="42.3" cy="52.2" r="1.8" fill="#fff" stroke="none"/><path d="m69 50 8 4-8 4"/>`,
    sleepy:'<path d="M38 54q6.5 6.5 13 0m18 0q6.5 6.5 13 0"/>',
    wide:`<ellipse cx="44" cy="54" rx="6" ry="7.5" fill="${color('eyeColor')}" stroke="none"/><ellipse cx="76" cy="54" rx="6" ry="7.5" fill="${color('eyeColor')}" stroke="none"/><circle cx="42" cy="51.2" r="2.3" fill="#fff" stroke="none"/><circle cx="74" cy="51.2" r="2.3" fill="#fff" stroke="none"/><circle cx="46" cy="56.8" r="1.1" fill="#fff" stroke="none"/><circle cx="78" cy="56.8" r="1.1" fill="#fff" stroke="none"/>`
  };
  const mouths = {
    smile:'<path d="M47 74q13 13 26 0"/>',
    grin:`<path d="M45 72h30c0 11-7 16-15 16s-15-5-15-16Z" fill="${color('mouthColor')}" fill-opacity=".85"/><path d="M53 83q7-4 14 0" stroke="#ff8fa3" stroke-width="2.6" fill="none"/>`,
    o:`<ellipse cx="60" cy="77" rx="6" ry="7.5" fill="${color('mouthColor')}" fill-opacity=".22"/>`,
    flat:'<path d="M49 76h22"/>',
    cheerful:'<path d="M43 72q17 21 34 0M40 70l4-2m32 0 4 2"/>'
  };
  const accessories = {
    glasses:'<g fill="#ffffff" fill-opacity=".16" stroke="#2c3a4f" stroke-width="3.2"><rect x="29" y="42" width="28" height="22" rx="9"/><rect x="63" y="42" width="28" height="22" rx="9"/><path d="M57 51h6M22 48l7 2m62 0 7-2" fill="none"/></g>',
    scarf:'<path d="m30 93 7 12q23 8 46-1l7-12q-30 11-60 1Z" fill="#b85d43" stroke="#7c3724" stroke-width="1.4"/><path d="m72 100 3 14h13l-6-17Z" fill="#d4765b" stroke="#7c3724" stroke-width="1.4"/>',
    none:'',
    antenna:'<path d="M60 21V9" stroke="#2c3a4f" stroke-width="3.2" stroke-linecap="round"/><circle cx="60" cy="7" r="5" fill="currentColor" stroke="#ffffff" stroke-width="1.4"/><circle cx="58.5" cy="5.5" r="1.6" fill="#ffffff"/>',
    spark:'<path d="m101 9 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="currentColor" stroke="#ffffff" stroke-width="1"/><circle cx="89" cy="12" r="2" fill="currentColor"/>',
    cap:'<path d="M29 28q5-24 31-24t31 24H29Z" fill="currentColor" stroke="#243042" stroke-width="2.2"/><path d="M24 28h74" stroke="#243042" stroke-width="4.2" stroke-linecap="round"/>',
    headphones:'<path d="M17 62V47a43 43 0 0 1 86 0v15" fill="none" stroke="#2c3a4f" stroke-width="6.5" stroke-linecap="round"/><rect x="9" y="47" width="15" height="30" rx="7.5" fill="#475b78" stroke="#243042" stroke-width="1.8"/><rect x="96" y="47" width="15" height="30" rx="7.5" fill="#475b78" stroke="#243042" stroke-width="1.8"/>',
    bow:'<path d="m60 25-20-14q-8 15 0 24Zm0 0 20-14q8 15 0 24Z" fill="#d64572" stroke="#7f1d3d" stroke-width="1.6" stroke-linejoin="round"/><circle cx="60" cy="25" r="6" fill="#f284a7" stroke="#7f1d3d" stroke-width="1.6"/>'
  };
  const id = `avatar-${++artworkId}`, body = bodies[p.shape] || bodies.squircle;
  const orbitRing = front => p.shape === 'orb' ? `<path class="avatar-orbit-${front?'front':'back'}" d="M6 78a54 14 0 0 ${front?0:1} 108 0" transform="rotate(-14 60 78)" fill="none" stroke="#ffffff" stroke-opacity="${front?'.7':'.35'}" stroke-width="2.5" stroke-linecap="round"/>` : '';

  return `<svg class="${className}" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><radialGradient id="${id}-light" cx="28%" cy="18%" r="85%"><stop stop-color="#ffffff" stop-opacity=".46"/><stop offset=".48" stop-color="#ffffff" stop-opacity=".06"/><stop offset=".82" stop-color="#000000" stop-opacity=".03"/><stop offset="1" stop-color="#000000" stop-opacity=".14"/></radialGradient><linearGradient id="${id}-rim" x1="18" y1="18" x2="102" y2="104" gradientUnits="userSpaceOnUse"><stop stop-color="#ffffff" stop-opacity=".48"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".08"/><stop offset="1" stop-color="#000000" stop-opacity=".12"/></linearGradient><filter id="${id}-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity=".1"/></filter></defs><ellipse cx="60" cy="111" rx="26" ry="3.5" fill="#0f172a" opacity=".06"/>${orbitRing(false)}<g fill="${color('bodyColor')}"><g transform="translate(0.5 1.5)" fill="#000" opacity=".08">${body}</g>${body}<g fill="url(#${id}-light)" stroke="url(#${id}-rim)" stroke-width="1.2">${body}</g></g><g>${details[p.shape] || ''}</g>${orbitRing(true)}<g class="avatar-eyes" fill="none" stroke="${color('eyeColor')}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}-shadow)">${eyes[p.eyes] || eyes.bars}</g><g class="avatar-mouth" fill="none" stroke="${color('mouthColor')}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}-shadow)">${mouths[p.mouth] || mouths.smile}</g><g color="${color('bodyColor')}" filter="url(#${id}-shadow)">${accessories[p.accessory] || ''}</g></svg>`;
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
