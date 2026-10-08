import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { authorize, allowedOrigin, textInput } from './security.js';
import { openStore, findAgent, deleteAgent, createRoom, updateRoom } from './store.js';
import { AIProvider, validateProvider, publicProvider, providerModels } from './providers.js';
import { Browser } from './browser.js';
import { Runtime } from './runtime.js';
import { validateWorkflow, validateSkill, importSkill } from './workflows.js';
import { validateProfile, defaults, ownerPreferenceKeys, currencies, validateAppearance } from './public/profile.js';
import { fetchImage } from './proxy.js';
import { imageMime } from './files.js';

const root = import.meta.dir;
const headers = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

export function createApp(options = {}) {
  const directory = resolve(options.directory || (process.env.ODWYN_DATA_DIR ?? process.env.SIDEKICK_DATA_DIR) || join(root, 'data'));
  const user = options.user || (process.env.ODWYN_USER ?? process.env.SIDEKICK_USER);
  const password = options.password || (process.env.ODWYN_PASSWORD ?? process.env.SIDEKICK_PASSWORD);
  if (!user || !password || password.length < 16) throw new Error('Set ODWYN_USER and an ODWYN_PASSWORD of at least 16 characters. Run bun run setup.');
  const origin = options.origin || (process.env.ODWYN_ORIGIN ?? process.env.SIDEKICK_ORIGIN) || `http://127.0.0.1:${process.env.PORT || 4317}`;
  const store = openStore(directory);
  const workspace = join(directory, 'workspace');
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  const type = (process.env.ODWYN_PROVIDER ?? process.env.SIDEKICK_PROVIDER) || 'codex';
  store.state.provider ||= { ...validateProvider({ type, model: (process.env.ODWYN_MODEL ?? process.env.SIDEKICK_MODEL) || providerModels[type], baseUrl: (process.env.ODWYN_API_BASE_URL ?? process.env.SIDEKICK_API_BASE_URL), apiKey: (process.env.ODWYN_API_KEY ?? process.env.SIDEKICK_API_KEY) }), configured: !!(process.env.ODWYN_PROVIDER ?? process.env.SIDEKICK_PROVIDER) };
  for (const agent of store.state.agents) agent.provider ||= { ...store.state.provider };
  store.state.globalProvider ||= { ...store.state.provider };
  for (const agent of store.state.agents) {
    // Preserve existing connections; matching agents follow the workspace default.
    agent.providerOverride ??= ['type','model','effort','baseUrl','apiKey'].some(key => (agent.provider[key] || '') !== (store.state.globalProvider[key] || ''));
    if (!agent.providerOverride) agent.provider = { ...store.state.globalProvider };
  }
  store.state.provider = store.state.agents[0].provider;
  const home = resolve((process.env.ODWYN_CODEX_HOME ?? process.env.SIDEKICK_CODEX_HOME) || join(directory, 'codex'));
  const codex = new AIProvider({ config: store.state.provider, home, workspace, codex: options.codex, ...options.providerOptions });
  let runtime;
  const browser = options.browser || new Browser({ directory, executablePath: (process.env.ODWYN_BROWSER_EXECUTABLE ?? process.env.SIDEKICK_BROWSER_EXECUTABLE) || undefined, headless: (process.env.ODWYN_HEADLESS ?? process.env.SIDEKICK_HEADLESS) !== 'false',
    findFile: id => store.state.files.find(file => file.id === id),
    onFile: file => { store.state.files.push(file); const job = store.state.jobs.find(job => job.id === file.jobId); if (job) job.files.push(file.id); runtime.changed(); },
  });
  runtime = new Runtime({ store, codex, browser, workspace, model: store.state.provider.model });
  const logins = new Map();
  function watchLogin(agent, provider) {
    provider.on('notification', ({ method, params }) => {
      if (method === 'account/login/completed') { logins.set(agent.id, params.success ? null : { error: params.error || 'Sign-in failed. Try again.' }); runtime.changed(); }
    });
  }
  watchLogin(store.state.agents[0], codex);
  function addProvider(agent) {
    const provider = new AIProvider({ config:agent.provider, home, workspace, ...options.providerOptions });
    runtime.addProvider(agent.id, provider); watchLogin(agent, provider); if (agent.provider.configured) void runtime.refreshAccount(agent.id);
  }
  for (const agent of store.state.agents.slice(1)) addProvider(agent);
  function globalConnection(create = false) {
    const inherited = store.state.agents.find(agent => !agent.providerOverride);
    if (inherited) return inherited;
    const agent = { id:'global', provider:store.state.globalProvider };
    if (create && !runtime.providers.has(agent.id)) addProvider(agent);
    return agent;
  }
  async function changeProviders(config, agents) {
    agents = agents.filter(agent => JSON.stringify(runtime.providers.get(agent.id).config) !== JSON.stringify(config));
    const checkActive = () => { if (agents.some(agent => runtime.active?.agentId === agent.id)) throw new Error('Stop the active task before changing AI provider.'); };
    checkActive();
    for (const agent of agents) {
      const login = logins.get(agent.id);
      if (login?.loginId) await runtime.providers.get(agent.id).request('account/login/cancel', {loginId:login.loginId}).catch(() => {});
    }
    checkActive();
    for (const agent of agents) {
      logins.delete(agent.id); runtime.providers.get(agent.id).configure(config); agent.provider = { ...config };
      runtime.accounts.set(agent.id, {account:null,connectionError:null});
    }
    store.state.provider = store.state.agents[0].provider;
    if (agents.includes(store.state.agents[0])) { runtime.account = null; runtime.connectionError = null; runtime.rateLimits = null; }
    return agents;
  }
  async function changeGlobalProvider(config) {
    const agents = store.state.agents.filter(agent => !agent.providerOverride);
    if (runtime.providers.has('global')) agents.push({id:'global'});
    const changed = await changeProviders(config,agents);
    store.state.globalProvider = config;
    return changed;
  }
  const limits = new Map();
  const response = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });

  function rateLimited(key, max) {
    const now = Date.now(); let entry = limits.get(key);
    if (!entry || entry.until < now) { entry = { count: 0, until: now + 60_000 }; limits.set(key, entry); }
    // One owner behind a tunnel; cap accounting keys to avoid unbounded unauthenticated state.
    if (limits.size > 1000) for (const [key, value] of limits) if (value.until < now) limits.delete(key);
    if (limits.size > 1000) limits.clear();
    return ++entry.count > max;
  }

  async function json(req, maxLength = 30_000) {
    if (!req.headers.get('content-type')?.startsWith('application/json')) throw new Error('Use JSON for this request.');
    const body = await req.text();
    if (body.length > maxLength) throw new Error('Request is too large.');
    try { const value = JSON.parse(body); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
    catch { throw new Error('Invalid JSON request.'); }
  }

  const app = {
    runtime, browser, codex,
    async fetch(req, server) {
      const url = new URL(req.url); const pathname = url.pathname;
      if (!authorize(req.headers.get('authorization'), user, password)) {
        if (rateLimited(`auth:${server?.requestIP(req)?.address || 'local'}`, 20)) return response({ error: 'Too many sign-in attempts. Try again in one minute.' }, 429);
        return response({ error: 'Authentication required.' }, 401, { 'www-authenticate': 'Basic realm="Odwyn", charset="UTF-8"' });
      }
      if (!['GET','HEAD'].includes(req.method)) {
        if (!allowedOrigin(req.headers.get('origin'), origin) || req.headers.get('sec-fetch-site') === 'cross-site') return response({ error: 'Request origin rejected. Set ODWYN_ORIGIN to your tunnel HTTPS URL.' }, 403);
        if (rateLimited('writes', 120)) return response({ error: 'Too many requests. Try again shortly.' }, 429);
      }
      try {
        if (pathname === '/api/images' && req.method === 'GET') {
          if (req.headers.get('sec-fetch-site') === 'cross-site') return response({ error:'Request origin rejected.' }, 403);
          if (rateLimited('images', 120)) return response({ error:'Too many image requests.' }, 429);
          const image = await fetchImage(url.searchParams.get('url'));
          return new Response(image.body, { headers:{ ...headers, 'content-type':image.type, 'cache-control':'private, max-age=3600' } });
        }
        if (pathname === '/api/state' && req.method === 'GET') {
          if (url.searchParams.get('revision') === String(runtime.revision)) return new Response(null, { status: 204, headers });
          // ponytail: a JSON state row suits one owner; use indexed tables when history gets large.
          return response({ revision: runtime.revision, ...store.state, agents:store.state.agents.map(agent => ({ ...agent, provider:publicProvider(agent.provider), runtime:{ ...runtime.accounts.get(agent.id), login:logins.get(agent.id) || null } })), globalProvider:publicProvider(store.state.globalProvider), globalRuntime:{...runtime.accounts.get(globalConnection().id),login:logins.get(globalConnection().id) || null}, provider: publicProvider(store.state.provider), runtime: { account: runtime.account, connectionError: runtime.connectionError, model: store.state.provider.model, activeJobId: runtime.active?.id || null, takeover: runtime.takeover, browserOpen: !!browser.context, rateLimits: runtime.rateLimits || null, login:logins.get(store.state.agents[0].id) || null } });
        }
        // JSON escaping expands file contents; importSkill enforces the 30 KB source limit.
        if (pathname === '/api/skills/import' && req.method === 'POST') return response(importSkill((await json(req,200_000)).source));
        const definitionMatch = pathname.match(/^\/api\/(workflows|skills)(?:\/([a-f0-9-]{36}))?(?:\/(run))?$/);
        if (definitionMatch) {
          const [,collection,id,action]=definitionMatch, items=store.state[collection], existing=items.find(item=>item.id===id);
          if (id && !existing) return response({error:'Definition not found.'},404);
          if (collection==='workflows' && id && action==='run' && req.method==='POST') return response(runtime.launchWorkflow(existing,await json(req)),201);
          if (!action && (req.method==='POST' && !id || req.method==='PUT' && id)) {
            const input={...await json(req),id:id || randomUUID()};
            const item=collection==='workflows' ? validateWorkflow(input,store.state):validateSkill(input);
            if (collection==='skills' && (items.some(s=>s.id!==id && s.command===item.command) || store.state.workflows.some(w=>w.command===item.command))) throw new Error('Command already exists.');
            if(existing) items.splice(items.indexOf(existing),1,item);else items.unshift(item);
            runtime.changed();return response(item,existing ? 200:201);
          }
          if (!action && id && req.method==='DELETE') {
            if(collection==='skills' && store.state.workflows.some(w=>w.steps.some(s=>s.skills.includes(id)))) throw new Error('Remove this skill from workflow steps before deleting it.');
            items.splice(items.indexOf(existing),1);runtime.changed();return response({ok:true});
          }
          if (!action && req.method==='GET') return response(id ? existing:items);
          return response({error:'Method not allowed.'},405);
        }
        if (pathname === '/api/rooms' && req.method === 'POST') {
          const room = createRoom(store.state,await json(req)); runtime.changed(); return response(room,201);
        }
        const conversationMatch = pathname.match(/^\/api\/conversations\/([a-f0-9-]{36})$/);
        if (conversationMatch && req.method === 'DELETE') {
          if (!store.state.conversations.some(c=>c.id===conversationMatch[1])) return response({error:'Conversation not found.'},404);
          if (runtime.active?.conversationId === conversationMatch[1]) throw new Error('Stop this conversation’s tasks before deleting it.');
          store.deleteConversation(conversationMatch[1]); runtime.changed(); return response({ok:true});
        }
        if (conversationMatch && req.method === 'PATCH') {
          const conversation = store.state.conversations.find(c=>c.id===conversationMatch[1]);
          if (!conversation) return response({error:'Conversation not found.'},404);
          const title = textInput((await json(req)).title,70);
          if (/[\x00-\x1f\x7f]/.test(title)) throw new Error('Use a single line for the conversation name.');
          conversation.title = title; runtime.changed(); return response({id:conversation.id,title});
        }
        const roomAction = pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})(?:\/(messages|cancel))?$/);
        if (roomAction && req.method === 'PATCH' && !roomAction[2]) {
          const room = updateRoom(store.state,roomAction[1],await json(req)); runtime.changed(); return response(room);
        }
        if (roomAction && req.method === 'POST' && roomAction[2]) {
          if (roomAction[2] === 'messages') return response({jobs:await runtime.messageRoom(roomAction[1],await json(req))},201);
          await runtime.cancelRoom(roomAction[1]); return response({ok:true});
        }
        if (pathname === '/api/jobs' && req.method === 'POST') {
          const input = await json(req);
          const room = store.state.conversations.find(c=>c.id===input.conversationId && c.kind==='room');
          return response(room ? (await runtime.messageRoom(room.id,input))[0] : runtime.submit(input),201);
        }
        const jobAction = pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})\/(answer|respond|cancel|retry|permissions)$/);
        if (jobAction && req.method === 'POST') {
          const [, id, action] = jobAction;
          if (action === 'respond') return response(runtime.respondToResult(id,await json(req)),201);
          if (action === 'permissions') { runtime.setInteractionMode(id,(await json(req)).interactionMode); return response({ ok:true }); }
          if (action === 'answer') { runtime.answer(id, await json(req)); return response({ ok: true }); }
          if (action === 'cancel') { await runtime.cancel(id); return response({ ok: true }); }
          return response(runtime.retry(id), 201);
        }
        if (pathname === '/api/schedules' && req.method === 'POST') return response(runtime.schedule(await json(req)), 201);
        const scheduleMatch = pathname.match(/^\/api\/schedules\/([a-f0-9-]{36})$/);
        if (scheduleMatch && ['PATCH','DELETE'].includes(req.method)) {
          const index = store.state.schedules.findIndex(s => s.id === scheduleMatch[1]);
          if (index < 0) return response({ error: 'Schedule not found.' }, 404);
          if (req.method === 'DELETE') store.state.schedules.splice(index, 1);
          else { const input = await json(req); if (typeof input.enabled !== 'boolean') throw new Error('Choose enabled or paused.'); store.state.schedules[index].enabled = input.enabled; }
          runtime.changed(); return response({ ok: true });
        }
        if (pathname === '/api/agents' && req.method === 'POST') {
          const input = await json(req), customization = validateProfile(input);
          const config = input.provider === undefined || input.provider.inherit === true ? { ...store.state.globalProvider } : validateProvider(input.provider,store.state.globalProvider);
          if (input.provider?.inherit !== undefined && typeof input.provider.inherit !== 'boolean') throw new Error('Choose a provider source.');
          if (store.state.agents.length >= 5) throw new Error('You can have at most 5 agents.');
          const agent = { id: randomUUID(), customization, provider:config, providerOverride:input.provider !== undefined && input.provider.inherit !== true };
          store.state.agents.push(agent); addProvider(agent); runtime.changed(); return response({ ...agent, provider:publicProvider(agent.provider) }, 201);
        }
        const agentMatch = pathname.match(/^\/api\/agents\/([a-f0-9-]{36})$/);
        if (agentMatch && req.method === 'DELETE') {
          const agent = deleteAgent(store.state,agentMatch[1]), provider = runtime.providers.get(agent.id);
          runtime.providers.delete(agent.id); runtime.accounts.delete(agent.id); logins.delete(agent.id);
          provider.removeAllListeners(); provider.stop();
          if (runtime.codex === provider) runtime.codex = runtime.providers.get(store.state.agents[0].id);
          const account = runtime.accounts.get(store.state.agents[0].id);
          runtime.account = account?.account || null; runtime.connectionError = account?.connectionError || null;
          runtime.changed(); return response({ok:true});
        }
        if (pathname === '/api/customization' && req.method === 'PUT') {
          const agent = findAgent(store.state, url.searchParams.get('agentId') ?? undefined);
          const input = await json(req), customization = validateProfile(input);
          let changedAgents = [];
          if (input.provider !== undefined) {
            if (!input.provider || typeof input.provider.inherit !== 'boolean') throw new Error('Choose a provider source.');
            const config = input.provider.inherit ? {...store.state.globalProvider} : validateProvider(input.provider,agent.provider);
            changedAgents = await changeProviders(config,[agent]); agent.providerOverride = !input.provider.inherit;
          }
          agent.customization = customization;
          if (agent === store.state.agents[0]) store.state.customization = agent.customization;
          runtime.changed(); await Promise.all(changedAgents.map(agent => runtime.refreshAccount(agent.id))); return response(agent.customization);
        }
        if (pathname === '/api/appearance' && req.method === 'PUT') {
          const input = await json(req);
          store.state.appearance = validateAppearance(input); runtime.changed(); return response(store.state.appearance);
        }
        if (pathname === '/api/preferences' && req.method === 'PUT') {
          const input = await json(req); if (typeof input.text !== 'string' || input.text.length > 8000) throw new Error('Memory must be at most 8,000 characters.');
          if (input.currency !== undefined && !currencies.includes(input.currency)) throw new Error('Choose a supported currency.');
          const appearance = input.appearance === undefined ? undefined : validateAppearance(input.appearance);
          const owner = validateProfile({...defaults,...store.state.owner,...Object.fromEntries(ownerPreferenceKeys.filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]]))});
          const config = input.provider === undefined ? null : validateProvider(input.provider,store.state.globalProvider);
          const changedAgents = config ? await changeGlobalProvider(config) : [];
          store.state.owner = Object.fromEntries(ownerPreferenceKeys.map(key=>[key,owner[key]]));
          store.state.preferences = input.text.trim();
          if (input.currency !== undefined) store.state.currency = input.currency;
          if (appearance !== undefined) store.state.appearance = appearance;
          runtime.changed(); await Promise.all(changedAgents.map(agent => runtime.refreshAccount(agent.id))); return response({ ok: true });
        }
        if (pathname === '/api/provider/models' && req.method === 'POST') {
          const input = await json(req), global = url.searchParams.get('scope') === 'global';
          const agent = global ? globalConnection(true) : findAgent(store.state,url.searchParams.get('agentId') ?? undefined);
          const config = validateProvider({...input, model:input.model || providerModels[input.type] || 'discovery'}, global ? store.state.globalProvider : agent.provider);
          const models = await runtime.providers.get(agent.id).listModels(config);
          return response({models:models.filter(model => typeof model.id === 'string' && model.id.trim() && model.id.length <= 200 && !/[\x00-\x1f\x7f]/.test(model.id))});
        }
        if (pathname === '/api/provider' && req.method === 'PUT') {
          const input = await json(req), global = url.searchParams.get('scope') === 'global';
          if (input.inherit !== undefined && typeof input.inherit !== 'boolean') throw new Error('Choose a provider source.');
          const agent = global ? null : findAgent(store.state,url.searchParams.get('agentId') ?? undefined);
          const config = !global && input.inherit ? { ...store.state.globalProvider } : validateProvider(input,global ? store.state.globalProvider : agent.provider);
          const changedAgents = global ? await changeGlobalProvider(config) : await changeProviders(config,[agent]);
          if (agent) agent.providerOverride = !input.inherit;
          runtime.changed(); await Promise.all(changedAgents.map(agent => runtime.refreshAccount(agent.id)));
          return response(publicProvider(config));
        }
        if (pathname === '/api/account/refresh' && req.method === 'POST') { const agent = url.searchParams.get('scope') === 'global' ? globalConnection(true) : findAgent(store.state, url.searchParams.get('agentId') ?? undefined); await runtime.refreshAccount(agent.id); return response({ ok: true }); }
        if (pathname === '/api/account/login' && req.method === 'POST') {
          const agent = url.searchParams.get('scope') === 'global' ? globalConnection(true) : findAgent(store.state, url.searchParams.get('agentId') ?? undefined);
          const provider = runtime.providers.get(agent.id); let login = logins.get(agent.id);
          if (!['codex','claude'].includes(agent.provider.type)) throw new Error('Enter an API key in provider settings.');
          if (runtime.active) throw new Error('Stop the active task before changing your provider sign-in.');
          if (login?.loginId) await provider.request('account/login/cancel', { loginId: login.loginId }).catch(() => {});
          login = await provider.request('account/login/start', { type: 'chatgptDeviceCode' }); logins.set(agent.id, login); runtime.changed();
          return response(login);
        }
        if (pathname === '/api/account/login/complete' && req.method === 'POST') {
          const agent = url.searchParams.get('scope') === 'global' ? globalConnection(true) : findAgent(store.state,url.searchParams.get('agentId') ?? undefined);
          if (agent.provider.type !== 'claude') throw new Error('Code submission is only available for Claude Code.');
          if (runtime.active) throw new Error('Stop the active task before changing your provider sign-in.');
          const login = logins.get(agent.id);
          if (!login?.loginId) throw new Error('Sign-in expired. Connect again.');
          await runtime.providers.get(agent.id).request('account/login/complete',{loginId:login.loginId,code:textInput((await json(req)).code,4000)});
          logins.delete(agent.id); await runtime.refreshAccount(agent.id); return response({ok:true});
        }
        if (pathname === '/api/browser/frame' && req.method === 'GET') return response(await browser.frame());
        if (pathname === '/api/browser/takeover' && req.method === 'POST') {
          const { enabled } = await json(req); if (typeof enabled !== 'boolean') throw new Error('Choose browser control mode.');
          await runtime.setTakeover(enabled);
          if (enabled) { try { await browser.serial(() => browser.start()); runtime.changed(); } catch (error) { await runtime.setTakeover(false); throw error; } }
          return response({ ok: true });
        }
        if (pathname === '/api/browser/action' && req.method === 'POST') {
          if (!runtime.takeover) return response({ error: 'Take browser control first.' }, 409);
          const input = await json(req);
          const result = await browser.action(input, () => runtime.takeover);
          runtime.changed(); return response({ ok: true, url: result.url });
        }
        if (pathname === '/api/files' && req.method === 'POST') {
          const form = await req.formData(); const file = form.get('file');
          if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024) throw new Error('Choose a file up to 20 MB.');
          const id = randomUUID(); const name = file.name.replace(/[\x00-\x1f\/\\]/g, '_').slice(0, 180) || 'upload';
          mkdirSync(join(directory, 'files'), { recursive: true, mode: 0o700 });
          writeFileSync(join(directory, 'files', id), Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
          const saved = { id, name, kind: 'upload', createdAt: new Date().toISOString() }; store.state.files.push(saved); runtime.changed(); return response(saved, 201);
        }
        const fileMatch = pathname.match(/^\/api\/files\/([a-f0-9-]{36})(\/preview)?$/);
        if (fileMatch && req.method === 'GET') {
          const file = store.state.files.find(file => file.id === fileMatch[1]);
          if (!file) return response({ error: 'File not found.' }, 404);
          const local = Bun.file(join(directory, 'files', file.id));
          if (!await local.exists()) return response({ error: 'File no longer exists.' }, 404);
          if (fileMatch[2]) {
            const mimeType = imageMime(Buffer.from(await local.slice(0,512).arrayBuffer()));
            if (!mimeType) return response({error:'Image preview unavailable.'},415);
            return new Response(local,{headers:{...headers,'content-type':mimeType,'content-disposition':'inline','content-security-policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'"}});
          }
          return new Response(local, { headers: { ...headers, 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}` } });
        }
        if (pathname.startsWith('/api/')) return response({ error: 'Endpoint not found.' }, 404);
        if (!['GET','HEAD'].includes(req.method)) return response({ error: 'Method not allowed.' }, 405);
        const files = { '/': 'index.html', '/app.js': 'app.js', '/ui.js': 'ui.js', '/profile.js': 'profile.js', '/customize.js': 'customize.js', '/views.js': 'views.js', '/browser-ui.js': 'browser-ui.js', '/workflows-ui.js':'workflows-ui.js', '/workflow-editor.js':'workflow-editor.js', '/style.css': 'style.css', '/mark.svg': 'mark.svg', '/vendor/marked.js': '../node_modules/marked/lib/marked.esm.js' };
        if (!files[pathname]) return response({ error: 'Not found.' }, 404);
        return new Response(Bun.file(join(root, 'public', files[pathname])), { headers });
      } catch (error) { return response({ error: error.message || 'Something went wrong. Try again.' }, 400); }
    },
    async close() { clearInterval(accountTimer); runtime.close(); for (const provider of runtime.providers.values()) provider.stop(); await browser.close(); store.close(); },
  };
  const accountTimer = setInterval(() => { for (const agent of store.state.agents) if (agent.provider.configured || agent === store.state.agents[0]) void runtime.refreshAccount(agent.id); }, 30_000); accountTimer.unref();
  void runtime.refreshAccount();
  return app;
}

if (import.meta.main) {
  const app = createApp();
  const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT || 4317), maxRequestBodySize: 21 * 1024 * 1024, idleTimeout: 120, fetch: app.fetch });
  console.log(`Odwyn: http://127.0.0.1:${server.port}`);
  let stopping = false;
  const shutdown = async () => { if (stopping) return; stopping = true; server.stop(true); await app.close(); process.exit(0); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
