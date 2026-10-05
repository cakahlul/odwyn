export const defaults = { palette:'paper', shape:'squircle', bodyColor:'#f26945', eyeColor:'#292b28', mouthColor:'#292b28', eyes:'bars', mouth:'smile', accessory:'none', name:'Sidekick', specialization:'', ownerName:'', tone:'warm' };
export const palettes = {
  paper: { name:'Paper & ember', colors:['#faf9f5','#f0efe9','#f26945'], vars:{ paper:'#faf9f5', sidebar:'#f0efe9', surface:'#fffefa', ink:'#292b28', muted:'#596052', line:'#dedfd5', orange:'#f26945', 'orange-deep':'#b93d20', 'orange-light':'#fff0e8', wash:'#e8ebdf', selected:'#e1e3d8' } },
  fern: { name:'Fern', colors:['#f6f8f1','#e7eddf','#81ae76'], vars:{ paper:'#f6f8f1', sidebar:'#e7eddf', surface:'#fffffa', ink:'#28372b', muted:'#536450', line:'#d5dfcc', orange:'#81ae76', 'orange-deep':'#326341', 'orange-light':'#e9f2e3', wash:'#e2ebd9', selected:'#d4e2cb' } },
  harbor: { name:'Harbor', colors:['#f5f8fa','#e7edf2','#78acd0'], vars:{ paper:'#f5f8fa', sidebar:'#e7edf2', surface:'#fcfeff', ink:'#26333f', muted:'#506473', line:'#d5dfe6', orange:'#78acd0', 'orange-deep':'#285f87', 'orange-light':'#e5f1fa', wash:'#e1ebf2', selected:'#d3e3ef' } },
  rose: { name:'Rose', colors:['#fcf7f6','#f1e8e7','#dc9d9f'], vars:{ paper:'#fcf7f6', sidebar:'#f1e8e7', surface:'#fffdfb', ink:'#3e2c30', muted:'#735a60', line:'#e6d8d8', orange:'#dc9d9f', 'orange-deep':'#9a3f54', 'orange-light':'#fce8ee', wash:'#f2e2e5', selected:'#ead6dc' } },
  clay: { name:'Clay', colors:['#faf7f0','#eee6d8','#d9a06e'], vars:{ paper:'#faf7f0', sidebar:'#eee6d8', surface:'#fffdf6', ink:'#3d3229', muted:'#70604f', line:'#e1d7c7', orange:'#d9a06e', 'orange-deep':'#94532a', 'orange-light':'#faebda', wash:'#eee2d0', selected:'#e5d5bc' } },
};
export const choices = { shape:{ squircle:'Pocket', bean:'Bean', orb:'Orbit', cat:'Cat' }, eyes:{ bars:'Classic', dots:'Dots', happy:'Happy', wink:'Wink' }, mouth:{ smile:'Smile', grin:'Grin', o:'Surprised', flat:'Calm' }, accessory:{ none:'None', antenna:'Antenna', spark:'Spark', cap:'Cap' }, tone:{ warm:'Warm', crisp:'Direct', playful:'Playful', formal:'Professional' } };
export const toneInstructions = { warm:'Friendly and supportive, with plain language.', crisp:'Concise and direct. Lead with the answer; skip filler.', playful:'Light wit and a relaxed voice. Keep serious matters clear and respectful.', formal:'Professional, courteous and precise.' };

export function validateProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose your customization.');
  const result = {};
  for (const key of Object.keys(defaults)) {
    const value = input[key];
    if (typeof value !== 'string') throw new Error(`Choose ${key}.`);
    if (key === 'palette' && !Object.hasOwn(palettes,value) || choices[key] && !Object.hasOwn(choices[key],value)) throw new Error(`Invalid ${key}.`);
    if (key.endsWith('Color') && !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Use a six-digit hex color.');
    const limit = key === 'specialization' ? 500 : 40;
    if (value.length > limit || key !== 'specialization' && /[\x00-\x1f\x7f]/.test(value)) throw new Error(`${key} must be at most ${limit} characters.`);
    result[key] = value.trim();
  }
  if (!result.name) throw new Error('Give your agent a name.');
  return result;
}

export function avatarSvg(profile = defaults, className = 'agent-avatar') {
  const p = {...defaults,...profile};
  const color = key => /^#[0-9a-f]{6}$/i.test(p[key]) ? p[key] : defaults[key];
  const bodies = { squircle:'<rect x="20" y="22" width="80" height="80" rx="26"/>', bean:'<path d="M22 60c0-28 14-43 37-43 29 0 42 19 42 43v15c0 20-17 29-40 29S22 95 22 76Z"/>', orb:'<circle cx="60" cy="63" r="42"/>', cat:'<path d="m22 44-3-27 25 15q16-8 32 0l25-15-3 27q9 14 4 34c-4 18-21 27-42 27S22 96 18 78q-5-20 4-34Z"/>' };
  const eyes = { bars:'<path d="M45 49v10m30-10v10"/>', dots:'<circle cx="45" cy="54" r="2"/><circle cx="75" cy="54" r="2"/>', happy:'<path d="M39 56q6-12 12 0m18 0q6-12 12 0"/>', wink:'<path d="M45 49v10m23-5 7-4 6 4"/>' };
  const mouths = { smile:'<path d="M46 74q14 14 28 0"/>', grin:'<path d="M46 73h28q-2 16-14 16T46 73Z"/>', o:'<ellipse cx="60" cy="78" rx="6" ry="8"/>', flat:'<path d="M49 77h22"/>' };
  const accessories = { none:'', antenna:'<path d="M60 20V9" stroke="#292b28" stroke-width="3"/><circle cx="60" cy="7" r="4" fill="currentColor"/>', spark:'<path d="m102 9 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="currentColor"/>', cap:'<path d="M29 28q5-24 31-24t31 24H29Z" fill="currentColor" stroke="#292b28" stroke-width="2"/><path d="M25 28h74" stroke="#292b28" stroke-width="4" stroke-linecap="round"/>' };
  return `<svg class="${className}" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g fill="${color('bodyColor')}" stroke="#292b28" stroke-width="2">${bodies[p.shape] || bodies.squircle}</g><g class="avatar-eyes" fill="none" stroke="${color('eyeColor')}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${eyes[p.eyes] || eyes.bars}</g><g fill="none" stroke="${color('mouthColor')}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${mouths[p.mouth] || mouths.smile}</g><g color="${color('bodyColor')}">${accessories[p.accessory] || ''}</g></svg>`;
}

export function sampleReply(profile) {
  const address = profile.ownerName ? `, ${profile.ownerName}` : '';
  return {warm:`Of course${address}. I’ll put together a short list and check the details before you decide.`,crisp:`I’ll compare the options${address}. You’ll get the top three, with sources.`,playful:`On it${address}. I’ll wrangle the tabs. You get the shortlist.`,formal:`Certainly${address}. I will compare the options and provide a sourced recommendation.`}[profile.tone];
}
