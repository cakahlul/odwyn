import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { authorize, allowedOrigin, textInput } from './security.js';
import { openStore, findAgent, deleteAgent, createRoom, updateRoom, createJob } from './store.js';
import { oddyAction, oddyScreen, oddyHistory, historyCollections } from './oddy.js';
import { AIProvider, validateProvider, publicProvider, providerModels } from './providers.js';
import { Browser } from './browser.js';
import { Runtime } from './runtime.js';
import { validateWorkflow, validateSkill, importSkill } from './workflows.js';
import { validateProfile, defaults, profileTextLimit, ownerPreferenceKeys, currencies, validateAppearance } from './public/profile.js';
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
  const type = options.workspaceId ? 'codex' : (process.env.ODWYN_PROVIDER ?? process.env.SIDEKICK_PROVIDER) || 'codex';
  store.state.provider ||= options.workspaceId ? {...validateProvider({type,model:providerModels[type]}),configured:false} : { ...validateProvider({ type, model: (process.env.ODWYN_MODEL ?? process.env.SIDEKICK_MODEL) || providerModels[type], baseUrl: (process.env.ODWYN_API_BASE_URL ?? process.env.SIDEKICK_API_BASE_URL), apiKey: (process.env.ODWYN_API_KEY ?? process.env.SIDEKICK_API_KEY) }), configured: !!(process.env.ODWYN_PROVIDER ?? process.env.SIDEKICK_PROVIDER) };
  for (const agent of store.state.agents) agent.provider ||= { ...store.state.provider };
  store.state.globalProvider ||= { ...store.state.provider };
  for (const agent of store.state.agents) {
    // Preserve existing connections; matching agents follow the workspace default.
    agent.providerOverride ??= ['type','model','effort','baseUrl','apiKey'].some(key => (agent.provider[key] || '') !== (store.state.globalProvider[key] || ''));
    if (!agent.providerOverride) agent.provider = { ...store.state.globalProvider };
  }
  store.state.provider = store.state.agents[0].provider;
  const home = options.oddyHome || (options.workspaceId ? join(directory, 'codex') : resolve((process.env.ODWYN_CODEX_HOME ?? process.env.SIDEKICK_CODEX_HOME) || join(directory, 'codex')));
  const codex = new AIProvider({ config: store.state.provider, home, workspace, isolated:!!options.workspaceId&&!options.oddyHome, codex: options.codex, ...options.providerOptions });
  let runtime;
  const browser = options.browser || new Browser({ directory, executablePath: (process.env.ODWYN_BROWSER_EXECUTABLE ?? process.env.SIDEKICK_BROWSER_EXECUTABLE) || undefined, headless: (process.env.ODWYN_HEADLESS ?? process.env.SIDEKICK_HEADLESS) !== 'false',
    findFile: id => store.state.files.find(file => file.id === id),
    onFile: file => {
      const path=join(directory,'files',file.id);
      try { store.credentials.assertNoSecret(readFileSync(path)); } catch { rmSync(path,{force:true}); return; }
      const job=store.state.jobs.find(job=>job.id===file.jobId);
      if(job)job.files.push(file.id);else file.jobId=null;
      store.state.files.push(file);runtime.changed();
    },
  });
  runtime = new Runtime({store,codex,browser,workspace,workspaceId:options.workspaceId,model:store.state.provider.model});
  const logins = new Map();
  function watchLogin(agent, provider) {
    provider.on('notification', ({ method, params }) => {
      if (method === 'account/login/completed') { logins.set(agent.id, params.success ? null : { error: params.error || 'Sign-in failed. Try again.' }); runtime.changed(); }
    });
  }
  watchLogin(store.state.agents[0], codex);
  function addProvider(agent) {
    const provider = new AIProvider({ config:agent.provider, home, workspace, isolated:!!options.workspaceId&&!options.oddyHome, ...options.providerOptions });
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
    const checkActive = () => { if (agents.some(agent => runtime.activeJobs().some(job=>job.agentId===agent.id))) throw new Error('Stop the active task before changing AI provider.'); };
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

  function freshOwner(value){const supplied=Buffer.from(typeof value==='string'?value:''),expected=Buffer.from(password);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new Error('Fresh owner password required.');}
  const homes = new Map();
  let oddyApp=null;
  async function openOddy() {
    if(!oddyApp){
      oddyApp=createApp({...options,codex:undefined,browser:undefined,directory:join(directory,'oddy'),workspaceId:'oddy',oddyHome:home,});
      oddyApp.runtime.oddy=async(job,input)=>{
        const action=oddyAction({workspaceId:job.oddyWorkspaceId||'default',...input}), target=homes.get(action.workspaceId);
        if(action.action==='list_workspaces')return {workspaces:store.state.workspaces};
        if(!target)throw Error('Workspace not found.');
        const state=target.runtime.state, broker=target.runtime.store.credentials;
        if(['search_history','read_history'].includes(action.action)){
          const targetStore=target.runtime.store;
          const clean=value=>{
            if(Array.isArray(value))return value.map(clean);
            if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/^(api[_-]?key|credential|credentialRef|password|token|secret|authorization|cookie|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)$/i.test(key)?'[REDACTED]':clean(item)]));
            return typeof value==='string'?value.replaceAll(password,'[REDACTED]'):value;
          };
          const sanitize=value=>[...homes.values(),oddyApp].reduce((value,home)=>home.runtime.store.credentials.sanitize(value),clean(value));
          let records;
          if(action.body.collection==='configuration')records=[
            {id:'preferences',owner:state.owner,preferences:state.preferences,currency:state.currency},
            {id:'appearance',...state.appearance},
            {id:'providers',default:publicProvider(state.globalProvider),agents:state.agents.map(agent=>({id:agent.id,override:agent.providerOverride,provider:publicProvider(agent.provider),connected:!!target.runtime.accounts.get(agent.id)?.account,connectionError:target.runtime.accounts.get(agent.id)?.connectionError}))},
            {id:'agents',agents:state.agents.map(agent=>({id:agent.id,profile:agent===state.agents[0]?state.customization:agent.customization}))},
            {id:'sharing',sharing:store.state.workspaceSharing},
          ];
          else if(action.body.collection==='oddyChats')records=oddyApp.runtime.state.conversations;
          else if(action.body.collection==='oddyJobs')records=oddyApp.runtime.state.jobs;
          else if(action.body.collection==='messages')records=state.conversations.flatMap(conversation=>conversation.messages.map(message=>({...message,conversationId:conversation.id,conversationTitle:conversation.title})));
          else records=state[action.body.collection];
          const result=oddyHistory(records,action,sanitize);
          oddyApp.runtime.event(job,'History inspected',`${action.action}: ${action.body.collection} in ${action.workspaceId}`);
          return {workspaceId:action.workspaceId,collection:action.body.collection,...result};
        }
        if(action.action==='update_agent'){
          const agent=findAgent(state,input.targetId);
          action.body={...defaults,...(agent===state.agents[0]?state.customization:agent.customization),...action.body};
        }
        if(['update_workflow','update_skill'].includes(action.action)){
          const collection=action.action==='update_workflow'?state.workflows:state.skills;
          const existing=collection.find(row=>row.id===input.targetId);
          if(!existing)throw Error('Definition not found.');
          action.body={...existing,...action.body};
        }
        if(action.action==='inspect_workspace')return broker.sanitize({
          historyCollections,
          workspace:store.state.workspaces.find(row=>row.id===action.workspaceId),
          agents:state.agents.map(agent=>({id:agent.id,profile:agent===state.agents[0]?state.customization:agent.customization,connected:!!target.runtime.accounts.get(agent.id)?.account})),
          workflows:state.workflows,skills:state.skills,schedules:state.schedules,
          rooms:state.conversations.filter(row=>row.kind==='room').map(({id,title,memberIds,governance,discussion})=>({id,title,memberIds,governance,status:discussion?.status})),
          jobs:state.jobs.slice(0,50).map(({id,agentId,conversationId,prompt,status,error,createdAt})=>({id,agentId,conversationId,prompt:prompt.slice(0,200),status,error,createdAt})),
        });
        const currentTarget=()=>{
          if(action.action.startsWith('create_'))return null;
          const kind=action.action.split('_').at(-1);
          const rows={agent:state.agents,workflow:state.workflows,skill:state.skills,schedule:state.schedules,room:state.conversations,workspace:store.state.workspaces};
          if(kind==='job'){const row=state.jobs.find(row=>row.id===input.targetId);return row?{id:row.id,status:row.status}:null;}
          return rows[kind]?.find(row=>row.id===(kind==='workspace'?action.workspaceId:input.targetId))||null;
        };
        const existing=currentTarget(), before=JSON.stringify(existing);
        if(input.targetId&&!existing)throw Error('Change target not found.');
        const workspaceName=store.state.workspaces.find(row=>row.id===action.workspaceId)?.name;
        const label=existing?.customization?.name||existing?.name||existing?.title||action.body.name||action.body.title||existing?.id;
        const answer=await oddyApp.runtime.waitForOwner(job,{type:'oddy-confirmation',title:action.destructive?'Confirm deletion':'Approve change',detail:broker.redact(`${action.action.replaceAll('_',' ')}${label?' “'+label+'”':''} in workspace “${workspaceName}”`),destructive:action.destructive,proposal:broker.sanitize({targetId:input.targetId||null,parameters:action.body})});
        if(answer.decision!=='allow')return {cancelled:true};
        if(homes.get(action.workspaceId)!==target || before!==JSON.stringify(currentTarget()))throw Error('The target changed while approval was pending. Inspect it and request a new approval.');
        if(oddyApp.runtime.active!==job || job.status!=='running')throw Error('Oddy task is no longer active.');
        const path=action.path+(action.path.includes('?')?'&':'?')+'workspace='+encodeURIComponent(action.workspaceId);
        const result=await app.fetch(new Request(origin+path,{method:action.method,headers:{authorization:'Basic '+Buffer.from(`${user}:${password}`).toString('base64'),origin,'content-type':'application/json'},body:JSON.stringify(action.body)}));
        const value=await result.json();
        if(!result.ok)throw Error(broker.redact(value.error||'Platform action failed.'));
        oddyApp.runtime.event(job,'Platform action',`${action.action} in ${action.workspaceId}`);
        return (homes.get(action.workspaceId)?.runtime.store.credentials||store.credentials).sanitize(value);
      };
    }
    // A running turn keeps its provider; changed defaults apply to the next idle turn.
    if(!oddyApp.runtime.state.oddyProviderOverride && !oddyApp.providerBusy() && JSON.stringify(oddyApp.settings('provider'))!==JSON.stringify(store.state.globalProvider))await oddyApp.applySettings('provider',store.state.globalProvider);
    return oddyApp.runtime;
  }
  let workspaceWrites = Promise.resolve();
  if (!options.workspaceId) {
    store.state.workspaces ||= [{id:'default',name:'Default'}];
    if (!store.state.workspaceDefaultNameMigrated) {
      const first=store.state.workspaces.find(row=>row.id==='default');
      if (first?.name==='Home') first.name='Default';
      store.state.workspaceDefaultNameMigrated=true;
    }
    store.state.workspaceSharing ||= {};
    store.save();
  }
  const settings = kind => kind === 'provider' ? store.state.globalProvider : kind === 'preferences' ? {owner:store.state.owner,text:store.state.preferences,currency:store.state.currency} : store.state.appearance;
  function checkSettings(kinds) {
    if (options.checkSettings) return options.checkSettings(kinds);
    if (kinds.includes('provider') && store.state.workspaceSharing.provider && [...homes.values()].some(home => home.providerBusy())) throw new Error('Stop tasks and finish sign-ins in all workspaces before changing the shared provider.');
  }
  async function settingsChanged(kinds,source=app) {
    if (options.settingsChanged) return options.settingsChanged(app,kinds);
    for (const kind of kinds.filter(kind => store.state.workspaceSharing[kind])) {
      const value = structuredClone(source.settings(kind));
      for (const target of homes.values()) if (target !== source) await target.applySettings(kind,value);
    }
  }
  function openHome(row) {
    const child = createApp({...options,browser:undefined,codex:undefined,directory:join(directory,'workspaces',row.id),workspaceId:row.id,
      checkSettings,settingsChanged:(source,kinds)=>settingsChanged(kinds,source)});
    homes.set(row.id,child); return child;
  }
  const app = {
    runtime, browser, codex,
    settings,
    providerState:()=>({provider:publicProvider(store.state.globalProvider),runtime:{...runtime.accounts.get(globalConnection().id),login:logins.get(globalConnection().id)||null}}),
    providerBusy:() => !!(runtime.activeJobs().length || runtime.starting || [...logins.values()].some(login=>login?.loginId)),
    async applySettings(kind,value) {
      value = structuredClone(value);
      if (kind === 'provider') {
        const changed = await changeGlobalProvider(value);
        runtime.changed();
        for (const agent of changed) void runtime.refreshAccount(agent.id);
        return;
      } else if (kind === 'preferences') { store.state.owner=value.owner; store.state.preferences=value.text; store.state.currency=value.currency; }
      else store.state.appearance=value;
      runtime.changed();
    },
    async fetch(req, server) {
      const url = new URL(req.url); const pathname = url.pathname;
      const workspaceId = url.searchParams.get('workspace') || 'default';
      if (!authorize(req.headers.get('authorization'), user, password)) {
        if (rateLimited(`auth:${server?.requestIP(req)?.address || 'local'}`, 20)) return response({ error: 'Too many sign-in attempts. Try again in one minute.' }, 429);
        return response({ error: 'Authentication required.' }, 401, { 'www-authenticate': 'Basic realm="Odwyn", charset="UTF-8"' });
      }
      if (!['GET','HEAD'].includes(req.method)) {
        if (!allowedOrigin(req.headers.get('origin'), origin) || req.headers.get('sec-fetch-site') === 'cross-site') return response({ error: 'Request origin rejected. Set ODWYN_ORIGIN to your tunnel HTTPS URL.' }, 403);
        if (rateLimited('writes', 120)) return response({ error: 'Too many requests. Try again shortly.' }, 429);
      }
      try {
        if(!options.workspaceId && pathname.startsWith('/api/oddy')){
          if(pathname==='/api/oddy/provider'){
            const assistant=await openOddy();
            if(req.method==='PUT'){
              const input=await json(req);
              if(typeof input.inherit!=='boolean')throw Error('Choose whether Oddy inherits the default provider.');
              if(oddyApp.providerBusy())throw Error('Stop Oddy tasks and finish sign-in before changing its provider.');
              const config=input.inherit?store.state.globalProvider:validateProvider(input.provider,oddyApp.settings('provider'));
              await oddyApp.applySettings('provider',config);
              assistant.state.oddyProviderOverride=!input.inherit;assistant.changed();
            }else if(req.method!=='GET')return response({error:'Method not allowed.'},405);
            return response({inherit:!assistant.state.oddyProviderOverride,...oddyApp.providerState()});
          }
          if(['/api/oddy/provider/models','/api/oddy/account/refresh','/api/oddy/account/login','/api/oddy/account/login/complete'].includes(pathname)){
            if(req.method!=='POST')return response({error:'Method not allowed.'},405);
            await openOddy();
            return oddyApp.fetch(new Request(origin+pathname.replace('/api/oddy','/api')+'?scope=global',req),server);
          }
          const fileRoute=pathname.match(/^\/api\/oddy\/files(?:\/([a-f0-9-]{36})(\/preview)?)?$/);
          if(fileRoute){
            if(!(req.method==='POST'&&!fileRoute[1]||req.method==='GET'&&fileRoute[1]))return response({error:'Method not allowed.'},405);
            await openOddy();
            return oddyApp.fetch(new Request(origin+pathname.replace('/api/oddy','/api'),req),server);
          }
          if(!['/api/oddy','/api/oddy/answer','/api/oddy/cancel','/api/oddy/new','/api/oddy/clear','/api/oddy/select'].includes(pathname))return response({error:'Endpoint not found.'},404);
          if(req.method!=='POST' && !(req.method==='GET'&&pathname==='/api/oddy'))return response({error:'Method not allowed.'},405);
          const assistant=await openOddy();
          if(assistant.state.oddyConversationId===undefined)assistant.state.oddyConversationId=assistant.state.conversations[0]?.id||null;
          if(req.method==='POST'){
            const input=await json(req);
            if(['/api/oddy/new','/api/oddy/clear','/api/oddy/select'].includes(pathname)){
              if(assistant.state.jobs.some(job=>['queued','running','waiting','takeover','stopping'].includes(job.status)))throw Error('Stop Oddy’s current task before changing conversations.');
              if(pathname==='/api/oddy/select'){
                if(Object.keys(input).some(key=>key!=='conversationId')||!assistant.state.conversations.some(row=>row.id===input.conversationId))throw Error('Choose an existing Oddy conversation.');
                assistant.state.oddyConversationId=input.conversationId;
              }else{
                if(pathname==='/api/oddy/clear'){
                  if(input.confirm!==true||Object.keys(input).some(key=>!['confirm','conversationId'].includes(key)))throw Error('Confirm clearing this Oddy conversation.');
                  if(!input.conversationId||input.conversationId!==assistant.state.oddyConversationId)throw Error('This Oddy conversation changed. Review it before clearing.');
                  if(assistant.state.oddyConversationId)assistant.store.deleteConversation(assistant.state.oddyConversationId);
                }else if(Object.keys(input).length)throw Error('New chat takes no parameters.');
                assistant.state.oddyConversationId=null;
              }
              assistant.changed();
            }else if(pathname==='/api/oddy/answer'){
              if(Object.keys(input).some(key=>!['jobId','requestId','answer','decision','screen'].includes(key)) || input.decision!==undefined&&!['allow','deny'].includes(input.decision))throw Error('Invalid Oddy answer.');
              const screen=input.screen===undefined?undefined:oddyScreen(input.screen);
              assistant.answer(input.jobId,input);
              if(screen){assistant.state.jobs.find(job=>job.id===input.jobId).oddyScreen=screen;assistant.changed();}
            }else if(pathname==='/api/oddy/cancel')await assistant.cancel(input.jobId);
            else{
              if(Object.keys(input).some(key=>!['prompt','workspaceId','screen','attachments','conversationId'].includes(key)) || !homes.has(input.workspaceId||'default'))throw Error('Choose an existing workspace.');
              if(input.conversationId!==undefined&&input.conversationId!==assistant.state.oddyConversationId)throw Error('This Oddy conversation changed. Reopen it before sending.');
              if(assistant.state.jobs.some(job=>['queued','running','waiting','takeover','stopping'].includes(job.status)))throw Error('Wait for Oddy or stop its current task.');
              const screen=oddyScreen(input.screen);
              const conversation=assistant.state.conversations.find(row=>row.id===assistant.state.oddyConversationId);
              const job=createJob(assistant.state,{prompt:input.prompt,attachments:input.attachments,conversationId:conversation?.id});
              job.oddyWorkspaceId=input.workspaceId||'default';job.oddyScreen=screen;assistant.state.oddyConversationId=job.conversationId;
              assistant.changed();void assistant.drain();
            }
          }
          const conversation=assistant.state.conversations.find(row=>row.id===assistant.state.oddyConversationId),job=assistant.state.jobs.find(job=>job.conversationId===conversation?.id);
          return response(assistant.store.credentials.sanitize({conversationId:conversation?.id||null,conversations:assistant.state.conversations.map(({id,title})=>({id,title})),messages:conversation?.messages||[],files:assistant.state.files.map(({id,name,mimeType,size})=>({id,name,mimeType,size})),job:job?{id:job.id,status:job.status,error:job.error,pending:job.pending}:null,connected:!!assistant.account,connectionError:assistant.connectionError}));
        }
        if (!options.workspaceId && workspaceId !== 'default' && !pathname.startsWith('/api/workspaces')) {
          const child=homes.get(workspaceId);
          return child ? child.fetch(req,server) : response({error:'Workspace not found.'},404);
        }
        if (!options.workspaceId && pathname === '/api/workspaces' && req.method === 'GET') return response({workspaces:store.state.workspaces,sharing:store.state.workspaceSharing});
        if (!options.workspaceId && pathname === '/api/workspaces' && req.method === 'POST') {
          const input = await json(req), name = textInput(input.name,70).trim();
          if (!name) throw new Error('Enter a workspace name.');
          const row = {id:randomUUID(),name};
          const child = openHome(row);
          try { for (const kind of Object.keys(store.state.workspaceSharing).filter(kind=>store.state.workspaceSharing[kind])) await child.applySettings(kind,settings(kind)); }
          catch(error) { homes.delete(row.id); await child.close(); throw error; }
          store.state.workspaces.push(row); runtime.changed(); return response(row,201);
        }
        const workspaceMatch=pathname.match(/^\/api\/workspaces\/(default|[a-f0-9-]{36})$/);
        if (!options.workspaceId && workspaceMatch && ['PUT','DELETE'].includes(req.method)) {
          const id=workspaceMatch[1], row=store.state.workspaces.find(row=>row.id===id);
          if (!row) return response({error:'Workspace not found.'},404);
          const input=await json(req);
          if (req.method==='PUT') {
            const name=textInput(input.name,70).trim();if(!name)throw new Error('Enter a workspace name.');
            row.name=name;runtime.changed();return response(row);
          }
          if (id==='default') throw new Error('The first workspace cannot be deleted.');
          if (input.confirm!==true) throw new Error('Confirm permanent workspace deletion.');
          const target=homes.get(id);
          if (target.providerBusy() || target.runtime.executions.size) throw new Error('Stop tasks and finish sign-ins in this workspace before deleting it.');
          homes.delete(id);await target.close();
          store.state.workspaces=store.state.workspaces.filter(row=>row.id!==id);runtime.changed();
          rmSync(join(directory,'workspaces',id),{recursive:true,force:true});return response({ok:true});
        }
        if (!options.workspaceId && pathname === '/api/workspaces/share' && req.method === 'POST') {
          const {kind,enabled,ownerPassword} = await json(req);
          if (!['appearance','preferences','provider'].includes(kind) || typeof enabled !== 'boolean') throw new Error('Choose a setting and sharing mode.');
          const source = homes.get(workspaceId); if (!source) return response({error:'Workspace not found.'},404);
          if (kind === 'provider') freshOwner(ownerPassword);
          if (enabled) {
            if (kind === 'provider' && [...homes.values()].some(home=>home.providerBusy())) throw new Error('Stop tasks and finish sign-ins in all workspaces before sharing the provider.');
            const value = structuredClone(source.settings(kind));
            for (const target of homes.values()) if (target !== source) await target.applySettings(kind,value);
          }
          store.state.workspaceSharing[kind]=enabled; runtime.changed(); return response({ok:true});
        }
        if (pathname === '/api/images' && req.method === 'GET') {
          if (req.headers.get('sec-fetch-site') === 'cross-site') return response({ error:'Request origin rejected.' }, 403);
          if (rateLimited('images', 120)) return response({ error:'Too many image requests.' }, 429);
          const image = await fetchImage(url.searchParams.get('url'));
          return new Response(image.body, { headers:{ ...headers, 'content-type':image.type, 'cache-control':'private, max-age=3600' } });
        }
        if(pathname === '/api/knowledge'){
          if(req.method==='GET')return response(store.credentials.sanitize(store.state.knowledge));
          if(req.method==='POST'){const result=store.knowledge.create(await json(req,90000));runtime.changed();return response(result,201);}
          return response({error:'Method not allowed.'},405);
        }
        const knowledgeMatch=pathname.match(/^\/api\/knowledge\/([a-f0-9-]{36})$/);
        if(knowledgeMatch&&['PUT','DELETE'].includes(req.method)){const input=await json(req,90000),result=req.method==='PUT'?store.knowledge.update(knowledgeMatch[1],input):store.knowledge.delete(knowledgeMatch[1],input);runtime.changed();return response(result);}
        if(pathname==='/api/audit'&&req.method==='GET')return response(store.audit.list(url.searchParams));
        const auditMatch=pathname.match(/^\/api\/audit\/([a-f0-9-]{36})$/);
        if(auditMatch&&req.method==='GET')return response(store.audit.detail(auditMatch[1],url.searchParams));
        if (pathname === '/api/state' && req.method === 'GET') {
          if (url.searchParams.get('revision') === String(runtime.revision)) return new Response(null, { status: 204, headers });
          // ponytail: a JSON state row suits one owner; use indexed tables when history gets large.
          return response({ revision: runtime.revision, ...store.state, agents:store.state.agents.map(agent => ({ ...agent, provider:publicProvider(agent.provider), runtime:{ ...runtime.accounts.get(agent.id), login:logins.get(agent.id) || null } })), globalProvider:publicProvider(store.state.globalProvider), globalRuntime:{...runtime.accounts.get(globalConnection().id),login:logins.get(globalConnection().id) || null}, provider: publicProvider(store.state.provider), runtime: { account: runtime.account, connectionError: runtime.connectionError, model: store.state.provider.model, activeJobId: runtime.activeJobs()[0]?.id || null, activeJobIds:runtime.activeJobs().map(job=>job.id), takeover: runtime.takeover, browserOpen: !!browser.context, rateLimits: runtime.rateLimits || null, login:logins.get(store.state.agents[0].id) || null } });
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
            if (collection==='skills' && items.some(s=>s.id!==id && s.name.trim().toLowerCase()===item.name.toLowerCase())) throw new Error('Skill name already exists.');
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
          if (runtime.activeJobs().some(job=>job.conversationId===conversationMatch[1])) throw new Error('Stop this conversation’s tasks before deleting it.');
          store.deleteConversation(conversationMatch[1]); runtime.changed(); return response({ok:true});
        }
        if (conversationMatch && req.method === 'PATCH') {
          const conversation = store.state.conversations.find(c=>c.id===conversationMatch[1]);
          if (!conversation) return response({error:'Conversation not found.'},404);
          const title = textInput((await json(req)).title,70);
          if (/[\x00-\x1f\x7f]/.test(title)) throw new Error('Use a single line for the conversation name.');
          conversation.title = title; runtime.changed(); return response({id:conversation.id,title});
        }
        const roomWorkAction=pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})\/(decision|publish|handoff|start)$/);
        if(roomWorkAction&&req.method==='POST'){
          const [,id,action]=roomWorkAction,input=await json(req,600_000);
          if(action==='start')return response(runtime.startRoomStage(id,input),201);
          if(action==='decision')return response(runtime.decideRoom(id,input));
          if(action==='publish'){if(Object.keys(input).length)throw new Error('Publication uses only the approved room versions.');return response(runtime.publishRoom(id));}
          return response(await runtime.handoffRoom(id,input),201);
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
          else {
            const input = await json(req);
            if ('prompt' in input) runtime.schedule(input, scheduleMatch[1]);
            else { if (typeof input.enabled !== 'boolean') throw new Error('Choose enabled or paused.'); store.state.schedules[index].enabled = input.enabled; }
          }
          runtime.changed(); return response({ ok: true });
        }
        if (pathname === '/api/agents' && req.method === 'POST') {
          const input = await json(req, 1_300_000), customization = validateProfile(input);
          if (customization.knowledgeIds?.some(id=>!store.state.knowledge.some(doc=>doc.id===id))) throw new Error('Choose existing knowledge documents.');
          if (customization.skillIds?.some(id=>!store.state.skills.some(skill=>skill.id===id))) throw new Error('Choose existing skills.');
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
          const input = await json(req, 1_300_000), customization = validateProfile(input);
          if (customization.knowledgeIds?.some(id=>!store.state.knowledge.some(doc=>doc.id===id))) throw new Error('Choose existing knowledge documents.');
          if (customization.skillIds?.some(id=>!store.state.skills.some(skill=>skill.id===id))) throw new Error('Choose existing skills.');
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
          store.state.appearance = validateAppearance(input); runtime.changed(); await settingsChanged(['appearance']); return response(store.state.appearance);
        }
        if (pathname === '/api/preferences' && req.method === 'PUT') {
          const input = await json(req, 1_300_000); if (typeof input.text !== 'string' || input.text.length > profileTextLimit) throw new Error(`Memory must be at most ${profileTextLimit.toLocaleString('en-US')} characters.`);
          if (input.currency !== undefined && !currencies.includes(input.currency)) throw new Error('Choose a supported currency.');
          const appearance = input.appearance === undefined ? undefined : validateAppearance(input.appearance);
          const owner = validateProfile({...defaults,...store.state.owner,...Object.fromEntries(ownerPreferenceKeys.filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]]))});
          const config = input.provider === undefined ? null : validateProvider(input.provider,store.state.globalProvider);
          checkSettings(config ? ['provider'] : []);
          const changedAgents = config ? await changeGlobalProvider(config) : [];
          store.state.owner = Object.fromEntries(ownerPreferenceKeys.map(key=>[key,owner[key]]));
          store.state.preferences = input.text.trim();
          if (input.currency !== undefined) store.state.currency = input.currency;
          if (appearance !== undefined) store.state.appearance = appearance;
          runtime.changed(); await settingsChanged(['preferences',...(appearance ? ['appearance'] : []),...(config ? ['provider'] : [])]); await Promise.all(changedAgents.map(agent => runtime.refreshAccount(agent.id))); return response({ ok: true });
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
          if (global) checkSettings(['provider']);
          if (input.inherit !== undefined && typeof input.inherit !== 'boolean') throw new Error('Choose a provider source.');
          const agent = global ? null : findAgent(store.state,url.searchParams.get('agentId') ?? undefined);
          const config = !global && input.inherit ? { ...store.state.globalProvider } : validateProvider(input,global ? store.state.globalProvider : agent.provider);
          const changedAgents = global ? await changeGlobalProvider(config) : await changeProviders(config,[agent]);
          if (agent) agent.providerOverride = !input.inherit;
          runtime.changed();
          if (global) await settingsChanged(['provider']);
          await Promise.all(changedAgents.map(agent => runtime.refreshAccount(agent.id)));
          return response(publicProvider(config));
        }
        if (pathname === '/api/account/refresh' && req.method === 'POST') { const agent = url.searchParams.get('scope') === 'global' ? globalConnection(true) : findAgent(store.state, url.searchParams.get('agentId') ?? undefined); await runtime.refreshAccount(agent.id); return response({ ok: true }); }
        if (pathname === '/api/account/login' && req.method === 'POST') {
          const agent = url.searchParams.get('scope') === 'global' ? globalConnection(true) : findAgent(store.state, url.searchParams.get('agentId') ?? undefined);
          const provider = runtime.providers.get(agent.id); let login = logins.get(agent.id);
          if (!['codex','claude'].includes(agent.provider.type)) throw new Error('Enter an API key in provider settings.');
          if (runtime.activeJobs().length) throw new Error('Stop the active task before changing your provider sign-in.');
          if (login?.loginId) await provider.request('account/login/cancel', { loginId: login.loginId }).catch(() => {});
          login = await provider.request('account/login/start', { type: 'chatgptDeviceCode' }); logins.set(agent.id, login); runtime.changed();
          return response(login);
        }
        if (pathname === '/api/account/login/complete' && req.method === 'POST') {
          const agent = url.searchParams.get('scope') === 'global' ? globalConnection(true) : findAgent(store.state,url.searchParams.get('agentId') ?? undefined);
          if (agent.provider.type !== 'claude') throw new Error('Code submission is only available for Claude Code.');
          if (runtime.activeJobs().length) throw new Error('Stop the active task before changing your provider sign-in.');
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
          const bytes = Buffer.from(await file.arrayBuffer());
          store.credentials.assertNoSecret(bytes);
          writeFileSync(join(directory, 'files', id), bytes, { mode: 0o600 });
          const saved = { id, name, kind: 'upload', mimeType:imageMime(bytes) || 'application/octet-stream', size:bytes.length, createdAt: new Date().toISOString() }; store.state.files.push(saved); runtime.changed(); return response(saved, 201);
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
        const files = { '/audit-ui.js':'audit-ui.js', '/': 'index.html', '/app.js': 'app.js', '/oddy-ui.js':'oddy-ui.js', '/chat-composer.js':'chat-composer.js', '/oddy.css':'oddy.css', '/workspace.css':'workspace.css', '/tutorials.js':'tutorials.js', '/knowledge-ui.js':'knowledge-ui.js', '/workspace-settings.js':'workspace-settings.js', '/workspace-homes.js':'workspace-homes.js', '/ui.js': 'ui.js', '/profile.js': 'profile.js', '/customize.js': 'customize.js', '/views.js': 'views.js', '/room-policy.js':'room-policy.js', '/room-work-ui.js':'room-work-ui.js', '/browser-ui.js': 'browser-ui.js', '/workflows-ui.js':'workflows-ui.js', '/workflow-editor.js':'workflow-editor.js', '/style.css': 'style.css', '/mark.svg': 'mark.svg', '/icons/studio/home.svg':'icons/studio/home.svg', '/icons/studio/conversations.svg':'icons/studio/conversations.svg', '/icons/studio/tools.svg':'icons/studio/tools.svg', '/icons/studio/agents.svg':'icons/studio/agents.svg', '/icons/studio/settings.svg':'icons/studio/settings.svg', '/icons/fluent/home.png':'icons/fluent/home.png', '/icons/fluent/conversations.png':'icons/fluent/conversations.png', '/icons/fluent/tools.png':'icons/fluent/tools.png', '/icons/fluent/agents.png':'icons/fluent/agents.png', '/icons/fluent/settings.png':'icons/fluent/settings.png', '/icons/lucide/panel-left-close.svg':'icons/lucide/panel-left-close.svg', '/icons/lucide/panel-left-open.svg':'icons/lucide/panel-left-open.svg', '/vendor/marked.js': '../node_modules/marked/lib/marked.esm.js' };
        if (!files[pathname]) return response({ error: 'Not found.' }, 404);
        return new Response(Bun.file(join(root, 'public', files[pathname])), { headers });
      } catch (error) { return response({ error: error.message || 'Something went wrong. Try again.' }, 400); }
    },
    async close() { if(oddyApp)await oddyApp.close(); await workspaceWrites; for (const child of homes.values()) if (child !== app) await child.close(); clearInterval(accountTimer); await runtime.close(); for (const provider of runtime.providers.values()) provider.stop(); await browser.close(); store.close(); },
  };
  const accountTimer = setInterval(() => { for (const agent of store.state.agents) if (agent.provider.configured || agent === store.state.agents[0]) void runtime.refreshAccount(agent.id); }, 30_000); accountTimer.unref();
  void runtime.refreshAccount();
  if (!options.workspaceId) {
    homes.set('default',app);
    for (const row of store.state.workspaces.filter(row=>row.id!=='default')) openHome(row);
    // Serialize settings writes so linked workspaces cannot diverge on concurrent saves.
    const fetch = app.fetch;
    app.fetch = (req,server) => {
      const path = new URL(req.url).pathname;
      if (['GET','HEAD'].includes(req.method) || !path.startsWith('/api/workspaces') && !['/api/preferences','/api/appearance','/api/provider','/api/oddy/provider'].includes(path)) return fetch(req,server);
      const result = workspaceWrites.then(()=>fetch(req,server)); workspaceWrites=result.catch(()=>{}); return result;
    };
  }
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
