import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { openStore } from '../store.js';
import { createJob } from '../store.js';
import { AIProvider, validateProvider } from '../providers.js';
import { Runtime } from '../runtime.js';
import { defaults } from '../public/profile.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const wait = async condition => {
  for (let i = 0; i < 300 && !condition(); i++) await Bun.sleep(10);
  expect(condition()).toBe(true);
};
const fakeCodex = () => Object.assign(new EventEmitter(), { request: async () => ({ account: null }), stop() {} });

test('provider settings validate, persist, protect keys, and preserve chats and knowledge', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-provider-api-'));
  const browser = { close: async () => {} };
  const options = { directory, user: 'owner', password: 'test-password-long-enough', origin: 'https://assistant.test', browser, codex: fakeCodex(), providerOptions: { claudeAuth: async () => ({ loggedIn: true }) } };
  let app = createApp(options);
  const headers = { authorization: 'Basic ' + Buffer.from('owner:test-password-long-enough').toString('base64'), origin: options.origin, 'content-type': 'application/json' };
  const request = (path, method = 'GET', body) => app.fetch(new Request(`${options.origin}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
  try {
    const primaryId = app.runtime.state.agents[0].id;
    const added = await (await request('/api/agents', 'POST', { ...defaults, name:'Researcher' })).json();
    expect((await request(`/api/provider?agentId=${added.id}`, 'PUT', { type:'openai', model:'research-model', effort:'xhigh', baseUrl:'https://research.example/v1', apiKey:'research-secret' })).status).toBe(200);
    expect(app.runtime.state.provider.type).toBe('codex');
    expect(await (await request('/api/state')).text()).not.toContain('research-secret');
    const saved = await request('/api/provider', 'PUT', { type: 'openai', model: 'custom-model', baseUrl: 'https://llm.example/v1/', apiKey: 'secret-test-key' });
    expect(saved.status).toBe(200); expect(await saved.text()).not.toContain('secret-test-key');
    expect(await (await request('/api/state')).text()).not.toContain('secret-test-key');
    await request('/api/preferences', 'PUT', { text: 'Use Jakarta time.' });
    const job = createJob(app.runtime.state, { prompt: 'Discuss the Serpong trip budget' });
    app.runtime.state.customization = { ...defaults, name: 'Pip' };
    app.runtime.state.conversations[0].messages[0].text += ' filler'.repeat(300) + ' afterchunk';
    job.status = 'completed'; app.runtime.changed();
    expect((await request('/api/provider', 'PUT', { type: 'invalid', model: 'x' })).status).toBe(400);
    expect((await request('/api/provider', 'PUT', { type: 'openai', model: '', baseUrl: 'file:///tmp/key' })).status).toBe(400);
    app.runtime.active = job;
    expect((await request('/api/provider', 'PUT', { type: 'claude', model: 'sonnet' })).status).toBe(400);
    app.runtime.active = null;
    expect((await request('/api/provider', 'PUT', { type: 'claude', model: 'sonnet', effort:'high' })).status).toBe(200);
    expect(app.runtime.account.type).toBe('claude');
    expect((await request('/api/account/login', 'POST', {})).status).toBe(400);
    expect(app.runtime.state.conversations).toHaveLength(1); expect(app.runtime.state.preferences).toBe('Use Jakarta time.');
    await app.close(); app = createApp({ ...options, codex: fakeCodex() });
    expect(app.runtime.state.provider.type).toBe('claude');
    expect(app.runtime.state.provider.effort).toBe('high');
    expect(app.runtime.state.conversations[0].messages[0].text).toContain('Serpong');
    expect(app.runtime.state.customization.name).toBe('Pip');
    expect(app.runtime.state.agents.find(a => a.id === added.id).provider.model).toBe('research-model');
    expect(app.runtime.state.agents.find(a => a.id === added.id).provider.effort).toBe('xhigh');
    expect((await request('/api/provider','PUT',{type:'claude',model:'sonnet',effort:'xhigh'})).status).toBe(400);
    expect(validateProvider({type:'claude',model:'sonnet'},app.runtime.state.provider).effort).toBe('high');
    expect(validateProvider({type:'openai',model:'different'},app.runtime.state.provider).effort).toBe('default');
    expect(app.runtime.state.agents[0].id).toBe(primaryId);
    expect(app.runtime.store.search('Serpong')[0].text).toContain('trip budget');
    const chunks = app.runtime.store.search('afterchunk');
    expect(chunks[0].text).toContain('afterchunk'); expect(chunks[0].text.length).toBeLessThanOrEqual(1500);
    expect(app.runtime.store.search('" OR (***')).toEqual([]);
    const old = { baseUrl: 'https://llm.example/v1', apiKey: 'saved' };
    expect(validateProvider({ type: 'openai', model: 'x' }, old).apiKey).toBe('saved');
    expect(validateProvider({ type: 'openai', model: 'x', baseUrl: 'http://localhost:1234/v1' }, old).apiKey).toBe('');
    expect(() => validateProvider({ type: 'openai', model: 'x', baseUrl: 'https://user:pass@llm.example' })).toThrow();
  } finally { await app.close(); rmSync(directory, { recursive: true }); }
});

test('OpenAI-compatible requests execute owner questions, screenshots, and chat search; resume and cancel', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-provider-openai-'));
  const store = openStore(directory); const requests = []; let hanging = false, aborted = false;
  const completion = (content, tool_calls) => Response.json({ choices: [{ finish_reason: tool_calls ? 'tool_calls' : 'stop', message: { role: 'assistant', content, ...(tool_calls ? { tool_calls } : {}) } }] });
  const call = (name, args) => [{ type: 'function', id: `call-${requests.length}`, function: { name, arguments: JSON.stringify(args) } }];
  const provider = new AIProvider({ workspace: directory, config: validateProvider({ type: 'openai', model: 'vision-model', baseUrl: 'http://localhost:1234/v1', apiKey: 'private-key' }), codex: fakeCodex(), fetch: async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, options, body });
    if (hanging) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('Aborted')); }, { once: true }));
    if (requests.length === 1) return completion(null, call('odwyn_ask', { question: 'Budget?' }));
    if (requests.length === 2) return completion(null, call('odwyn_browser', { action: 'screenshot', reason: 'Inspect the page' }));
    if (requests.length === 3) return completion(null, call('odwyn_search', { query: 'Serpong' }));
    if (requests.length === 4) return completion(null, call('odwyn_terminal', { command: 'printf api-terminal', reason: 'Check terminal access' }));
    return completion('Result saved.');
  } });
  const old = createJob(store.state, { prompt: 'Serpong hotel budget: Rp2 million.' }); old.status = 'completed';
  const runtime = new Runtime({ store, codex: provider, browser: { action: async () => ({ image: 'test-base64', text: 'Screenshot' }) }, workspace: directory, model: 'vision-model' });
  try {
    await runtime.refreshAccount(); const job = runtime.submit({ prompt: 'Research hotels' });
    await wait(() => job.status === 'waiting'); expect(requests).toHaveLength(1);
    runtime.answer(job.id, { requestId: job.pending.id, answer: 'Rp2 million' });
    await wait(() => job.pending?.type === 'terminal');
    runtime.answer(job.id, { requestId: job.pending.id, decision: 'allow' });
    await wait(() => job.status === 'completed');
    expect(requests[0].url).toBe('http://localhost:1234/v1/chat/completions');
    expect(requests[0].options.headers.authorization).toBe('Bearer private-key');
    expect(requests[0].body.tools[0].function.parameters.type).toBe('object');
    expect(Object.hasOwn(requests[0].body,'reasoning_effort')).toBe(false);
    expect(requests[1].body.messages.some(m => m.role === 'tool' && m.content.includes('Rp2 million'))).toBe(true);
    expect(requests[2].body.messages.at(-1).content[1].image_url.url).toBe('data:image/jpeg;base64,test-base64');
    expect(requests[3].body.messages.at(-1).content).toContain('Serpong hotel budget');
    expect(requests[4].body.messages.at(-1).content).toContain('api-terminal');
    const follow = runtime.submit({ conversationId: job.conversationId, prompt: 'Recall the result' });
    await wait(() => follow.status === 'completed');
    expect(requests.at(-1).body.messages.some(m => m.role === 'assistant' && m.content === 'Result saved.')).toBe(true);
    hanging = true; const stop = runtime.submit({ prompt: 'Long task' }); await wait(() => requests.length === 7);
    await runtime.cancel(stop.id); expect(stop.status).toBe('cancelled'); expect(aborted).toBe(true);
    await Bun.sleep(20); expect(stop.status).toBe('cancelled');
  } finally { runtime.close(); provider.stop(); store.close(); rmSync(directory, { recursive: true }); }
});

test('Claude SDK uses restricted tools, streams output, waits for owner input, and resumes sessions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-provider-claude-'));
  const store = openStore(directory); const optionsSeen = [];
  const previous = createJob(store.state, { prompt: 'Remember the Serpong hotel budget.' }); previous.status = 'completed';
  const conversation = store.state.conversations[0]; conversation.threadId = 'legacy-codex-thread';
  const provider = new AIProvider({ workspace: directory, config: validateProvider({ type: 'claude', model: 'sonnet' }), codex: fakeCodex(), claudeAuth: async () => ({ loggedIn: true }), query: ({ prompt, options }) => (async function* () {
    optionsSeen.push(options); const input = (await prompt[Symbol.asyncIterator]().next()).value;
    expect(input.message.content).toContain('Ask');
    if (optionsSeen.length === 1) { expect(input.message.content).toContain('Serpong hotel budget'); expect(options.resume).toBeUndefined(); }
    expect(options.tools).toEqual([]); expect(options.settingSources).toEqual([]);
    expect(options.strictMcpConfig).toBe(true); expect(options.settings.disableAllHooks).toBe(true);
    expect((await options.canUseTool('Bash', {})).behavior).toBe('deny');
    const client = new Client({ name: 'test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await options.mcpServers.odwyn.instance.connect(serverTransport); await client.connect(clientTransport);
    try {
      const listed = await client.listTools(); expect(listed.tools.some(t => t.name === 'odwyn_search')).toBe(true);
      expect(listed.tools.some(t => t.name === 'odwyn_terminal')).toBe(true);
      const answer = await client.callTool({ name: 'odwyn_ask', arguments: { question: 'Your preference?' } }, undefined, { timeout: 5000 });
      expect(answer.content[0].text).toContain('Morning');
      const terminal = await client.callTool({ name: 'odwyn_terminal', arguments: { command: 'printf claude-terminal', reason: 'Check terminal access' } }, undefined, { timeout: 5000 });
      expect(terminal.content[0].text).toContain('claude-terminal');
      yield { type: 'stream_event', event: { type: 'message_start' } };
      yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Understood.' } } };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Understood.' }] } };
      yield { type: 'result', subtype: 'success', result: 'Understood.' };
    } finally { await client.close(); }
  })() });
  const runtime = new Runtime({ store, codex: provider, browser: {}, workspace: directory, model: 'sonnet' });
  try {
    await runtime.refreshAccount(); const job = runtime.submit({ conversationId: conversation.id, prompt: 'Ask my preference' });
    await wait(() => job.status === 'waiting'); runtime.answer(job.id, { requestId: job.pending.id, answer: 'Morning' });
    await wait(() => job.pending?.type === 'terminal'); runtime.answer(job.id, { requestId: job.pending.id, decision: 'allow' });
    await wait(() => job.status === 'completed');
    expect(runtime.conversation(job).messages.filter(m => m.role === 'assistant').map(m => m.text)).toEqual(['Understood.']);
    const follow = runtime.submit({ conversationId: job.conversationId, prompt: 'Ask again' });
    await wait(() => follow.status === 'waiting'); runtime.answer(follow.id, { requestId: follow.pending.id, answer: 'Morning' });
    await wait(() => follow.pending?.type === 'terminal'); runtime.answer(follow.id, { requestId: follow.pending.id, decision: 'allow' });
    await wait(() => follow.status === 'completed');
    expect(optionsSeen[1].resume).toBe(optionsSeen[0].sessionId);
  } finally { runtime.close(); provider.stop(); store.close(); rmSync(directory, { recursive: true }); }
});

test('Codex, Claude and API agents route queued work to their own model and session', async () => {
  const directory = mkdtempSync(join(tmpdir(),'odwyn-mixed-agents-'));
  const codex = fakeCodex(), claudeOptions = [], claudeInputs = [], apiRequests = [];
  codex.request = async (method, params) => method === 'account/read' ? {account:{type:'chatgpt'}} : method.startsWith('thread/') ? {thread:{id:params.threadId || 'codex-thread'}} : {turn:{id:'codex-turn'}};
  const app = createApp({directory,user:'owner',password:'test-password-long-enough',origin:'https://assistant.test',codex,browser:{close:async()=>{}},providerOptions:{
    claudeAuth:async()=>({loggedIn:true}),
    query:({prompt,options}) => (async function* () {
      claudeOptions.push(options); claudeInputs.push((await prompt[Symbol.asyncIterator]().next()).value.message.content);
      yield {type:'assistant',message:{content:[{type:'text',text:'Claude-only answer'}]}};
      yield {type:'result',subtype:'success'};
    })(),
    fetch:async (url,options) => {
      apiRequests.push({url,headers:options.headers,body:JSON.parse(options.body)});
      return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'API-only answer'}}]});
    },
  }});
  const headers = {authorization:'Basic '+Buffer.from('owner:test-password-long-enough').toString('base64'),origin:'https://assistant.test','content-type':'application/json'};
  const request = (path,body) => app.fetch(new Request(`https://assistant.test${path}`,{method:'POST',headers,body:JSON.stringify(body)}));
  try {
    await app.runtime.refreshAccount();
    const claude = await (await request('/api/agents',{...defaults,name:'Claude researcher'})).json();
    const api = await (await request('/api/agents',{...defaults,name:'API researcher'})).json();
    const configure = (id,body) => app.fetch(new Request(`https://assistant.test/api/provider?agentId=${id}`,{method:'PUT',headers,body:JSON.stringify(body)}));
    expect((await configure(claude.id,{type:'claude',model:'claude-agent-model',effort:'max'})).status).toBe(200);
    expect((await configure(api.id,{type:'openai',model:'api-agent-model',effort:'low',baseUrl:'https://agent.example/v1',apiKey:'agent-private-key'})).status).toBe(200);
    const first = app.runtime.submit({prompt:'Codex-only question'}); await app.runtime.drain();
    const second = app.runtime.submit({conversationId:first.conversationId,prompt:'Claude-only question',agentId:claude.id});
    const third = app.runtime.submit({conversationId:first.conversationId,prompt:'API-only question',agentId:api.id});
    expect(second.status).toBe('queued'); expect(third.status).toBe('queued'); expect(claudeOptions).toHaveLength(0); expect(apiRequests).toHaveLength(0);
    codex.emit('notification',{method:'turn/completed',params:{threadId:first.threadId,turn:{id:first.turnId,status:'completed'}}});
    await app.runtime.drain(); await wait(()=>second.status==='completed');
    await app.runtime.drain(); await wait(()=>third.status==='completed');
    expect(claudeOptions[0].model).toBe('claude-agent-model'); expect(claudeOptions[0].effort).toBe('max'); expect(claudeOptions[0].systemPrompt).toContain('"Claude researcher"');
    expect(apiRequests[0].url).toBe('https://agent.example/v1/chat/completions'); expect(apiRequests[0].headers.authorization).toBe('Bearer agent-private-key');
    expect(apiRequests[0].body.model).toBe('api-agent-model'); expect(apiRequests[0].body.reasoning_effort).toBe('low'); expect(apiRequests[0].body.messages[0].content).toContain('"API researcher"');
    expect(claudeInputs[0]).toContain('Codex-only question'); expect(claudeInputs[0]).not.toContain('API-only question');
    expect(apiRequests[0].body.messages.find(m => m.role === 'assistant').content).toBe('Reply from Claude researcher:\nClaude-only answer');
    const follow = app.runtime.submit({agentId:claude.id,conversationId:second.conversationId,prompt:'Continue Claude'});
    await app.runtime.drain(); await wait(()=>follow.status==='completed');
    expect(claudeOptions[1].resume).toBe(claudeOptions[0].sessionId);
    expect(claudeOptions[1].systemPrompt).toContain('API-only answer');
    expect(app.runtime.state.conversations).toHaveLength(1);
    expect(app.runtime.conversation(third).messages.filter(m=>m.role==='assistant').map(m=>m.agentId)).toEqual([claude.id,api.id,claude.id]);
  } finally {await app.close();rmSync(directory,{recursive:true});}
});
