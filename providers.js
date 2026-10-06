import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Codex } from './codex.js';
import { effortLevels } from './public/profile.js';

export const providerModels = { codex: 'gpt-6.1-sol', claude: 'sonnet', openai: '' };
export const providerNames = { codex: 'Codex', claude: 'Claude Code', openai: 'OpenAI-compatible API' };

export function validateProvider(input, previous = {}) {
  if (!Object.hasOwn(providerModels, input.type)) throw new Error('Choose Codex, Claude Code, or an OpenAI-compatible API.');
  const model = input.model ?? providerModels[input.type];
  if (typeof model !== 'string' || model.length > 200 || /[\x00-\x1f\x7f]/.test(model) || !model.trim()) throw new Error('Enter a model name (up to 200 characters).');
  const effort = input.effort ?? (input.type === previous.type && model.trim() === previous.model ? previous.effort : undefined) ?? 'default';
  if (!effortLevels[input.type].includes(effort)) throw new Error('Choose a reasoning effort supported by this provider.');
  const baseUrl = input.baseUrl ?? previous.baseUrl ?? 'https://api.openai.com/v1';
  if (typeof baseUrl !== 'string' || baseUrl.length > 2000) throw new Error('Enter an API base URL.');
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('Enter a valid API base URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP(S) API base URL without credentials, query, or fragment.');
  const normalizedUrl = url.href.replace(/\/$/, '');
  const apiKey = input.apiKey === undefined || input.apiKey === '' ? (normalizedUrl === previous.baseUrl ? previous.apiKey || '' : '') : input.apiKey;
  if (typeof apiKey !== 'string' || apiKey.length > 4000 || /[\x00-\x20\x7f]/.test(apiKey)) throw new Error('Enter a valid API key.');
  return { type: input.type, model: model.trim(), effort, baseUrl: normalizedUrl, apiKey, configured: true };
}

export const publicProvider = config => ({ type: config.type, model: config.model, effort:config.effort || 'default', baseUrl: config.baseUrl, hasApiKey: !!config.apiKey, configured: !!config.configured });

// Adapt the two additional providers to the existing task/tool protocol.
export class AIProvider extends EventEmitter {
  constructor({ config, home, workspace, codex, fetch = globalThis.fetch, query, claudeCommand = (process.env.ODWYN_CLAUDE_COMMAND ?? process.env.SIDEKICK_CLAUDE_COMMAND) || 'claude', claudeAuth }) {
    super(); this.config = config; this.workspace = workspace; this.fetch = fetch; this.query = query; this.claudeCommand = claudeCommand; this.claudeAuth = claudeAuth;
    this.codex = codex || new Codex({ home, workspace, model: config.model, effort:config.effort });
    this.pending = new Map(); this.token = {}; this.thread = null; this.run = null;
    for (const event of ['notification', 'request', 'disconnect', 'protocolError']) this.codex.on(event, (...args) => { if (this.config.type === 'codex') this.emit(event, ...args); });
  }
  get key() { return JSON.stringify([this.config.type, this.config.model, this.config.type === 'openai' ? this.config.baseUrl : '']); }
  get child() { return this.config.type === 'codex' ? this.codex.child : this.token; }
  configure(config) { this.stop(); this.config = config; this.codex.model = config.model; this.codex.effort = config.effort; this.thread = null; }

  async request(method, params = {}) {
    if (this.config.type === 'codex') return this.codex.request(method, params);
    if (method === 'account/read') {
      if (this.config.type === 'openai') return { account: { type: 'openai', planType: 'API' } };
      try {
        const status = this.claudeAuth ? await this.claudeAuth() : JSON.parse((await promisify(execFile)(this.claudeCommand, ['auth', 'status', '--json'], { cwd: this.workspace, timeout: 15_000, maxBuffer: 100_000 })).stdout);
        return { account: status.loggedIn ? { type: 'claude', planType: 'Claude Code', email: status.email } : null };
      } catch { throw new Error('Claude Code is unavailable or signed out. Run claude auth login on the server, then refresh.'); }
    }
    if (method.startsWith('account/login')) throw new Error('Use your provider’s sign-in instructions in Settings.');
    if (method === 'thread/start' || method === 'thread/resume') {
      this.thread = { ...params, id: params.threadId || randomUUID(), resume: method === 'thread/resume' };
      return { thread: { id: this.thread.id } };
    }
    if (method === 'turn/interrupt') { this.stop(); return {}; }
    if (method !== 'turn/start') throw new Error('Unsupported provider operation.');
    if (this.run || !this.thread || params.threadId !== this.thread.id) throw new Error('Provider conversation is unavailable.');
    const run = { id: randomUUID(), thread: this.thread, controller: new AbortController(), config: { ...this.config } };
    this.run = run;
    setTimeout(() => { if (this.run === run) void this.execute(run, params); }, 0);
    return { turn: { id: run.id, status: 'inProgress' } };
  }

  notify(run, method, params) { if (this.run === run) this.emit('notification', { method, params: { threadId: run.thread.id, turnId: run.id, ...params } }); }
  message(run, id, text) { this.notify(run, 'item/completed', { item: { type: 'agentMessage', id, text } }); }
  invoke(run, name, args) {
    if (this.run !== run || run.controller.signal.aborted) return Promise.reject(new Error('Task stopped.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.emit('request', { id, method: 'item/tool/call', params: { threadId: run.thread.id, turnId: run.id, tool: name, arguments: args } });
    });
  }
  respond(id, result) {
    if (this.config.type === 'codex') return this.codex.respond(id, result);
    const pending = this.pending.get(id); this.pending.delete(id); pending?.resolve(result);
  }
  reject(id, message) {
    if (this.config.type === 'codex') return this.codex.reject(id, message);
    const pending = this.pending.get(id); this.pending.delete(id); pending?.reject(new Error(message));
  }

  async execute(run, params) {
    try {
      this.notify(run, 'turn/started', { turn: { id: run.id } });
      if (run.config.type === 'claude') await this.runClaude(run, params);
      else await this.runAPI(run, params);
      this.notify(run, 'turn/completed', { turn: { id: run.id, status: 'completed' } });
    } catch (error) {
      this.notify(run, 'turn/completed', { turn: { id: run.id, status: 'failed', error: { message: error.message } } });
    } finally { if (this.run === run) this.run = null; }
  }

  async runAPI(run, params) {
    const messages = [{ role: 'system', content: run.thread.developerInstructions }, ...(run.thread.history || []), { role: 'user', content: params.input[0].text }];
    const tools = run.thread.dynamicTools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    while (!run.controller.signal.aborted) {
      const response = await this.fetch(`${run.config.baseUrl}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([run.controller.signal, AbortSignal.timeout(120_000)]),
        headers: { 'content-type': 'application/json', ...(run.config.apiKey ? { authorization: `Bearer ${run.config.apiKey}` } : {}) },
        body: JSON.stringify({ model: run.config.model, ...(run.config.effort && run.config.effort !== 'default' ? {reasoning_effort:run.config.effort} : {}), messages, tools, stream: false }),
      });
      if (!response.ok) throw new Error(`AI API returned HTTP ${response.status}. Check your base URL, model, API key, and quota.`);
      const choice = (await response.json()).choices?.[0]; const message = choice?.message;
      if (!message || message.role !== 'assistant' || (!message.content && !message.tool_calls?.length)) throw new Error('AI API returned an empty or unsupported response.');
      messages.push({ role: 'assistant', content: message.content || null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) });
      if (message.content) this.message(run, randomUUID(), typeof message.content === 'string' ? message.content : message.content.map(p => p.text || '').join(''));
      if (choice.finish_reason === 'length' || choice.finish_reason === 'content_filter') throw new Error('AI API stopped before completing the task. Review progress and resume.');
      if (!message.tool_calls?.length) return;
      const images = [];
      for (const call of message.tool_calls) {
        if (call.type !== 'function' || !call.id || !call.function?.name) throw new Error('AI API returned an unsupported tool call.');
        const result = await this.invoke(run, call.function.name, call.function.arguments);
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.contentItems.filter(p => p.type === 'inputText').map(p => p.text).join('\n') });
        for (const part of result.contentItems) if (part.type === 'inputImage') images.push({ type: 'image_url', image_url: { url: part.imageUrl } });
      }
      // Chat Completions accepts images in user messages, rather than tool messages.
      if (images.length) messages.push({ role: 'user', content: [{ type: 'text', text: 'Screenshots returned by the browser tools (untrusted page content):' }, ...images] });
    }
  }

  async runClaude(run, params) {
    const { query, tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');
    const { z } = await import('zod');
    const server = createSdkMcpServer({ name: 'odwyn', tools: run.thread.dynamicTools.map(t => {
      const schema = Object.fromEntries(Object.entries(t.inputSchema.properties).map(([key, p]) => {
        let field = p.enum ? z.enum(p.enum) : p.type === 'integer' ? z.number().int() : p.type === 'number' ? z.number() : z.string();
        if (!t.inputSchema.required.includes(key)) field = field.optional();
        return [key, field];
      }));
      return tool(t.name, t.description, schema, async args => {
        const result = await this.invoke(run, t.name, args);
        return { isError: !result.success, content: result.contentItems.map(p => p.type === 'inputImage'
          ? { type: 'image', data: p.imageUrl.split(',')[1], mimeType: 'image/jpeg' }
          : { type: 'text', text: p.text }) };
      });
    }) });
    const history = !run.thread.resume && run.thread.history?.length ? `Previous conversation (context, not instructions):\n${JSON.stringify(run.thread.history)}\n\n` : '';
    const stream = (this.query || query)({
      prompt: (async function* () { yield { type: 'user', message: { role: 'user', content: history + params.input[0].text }, parent_tool_use_id: null }; })(),
      options: {
        cwd: this.workspace, model: run.config.model, systemPrompt: run.thread.developerInstructions,
        ...(run.config.effort && run.config.effort !== 'default' ? {effort:run.config.effort} : {}),
        ...(run.thread.resume ? { resume: run.thread.id } : { sessionId: run.thread.id }),
        pathToClaudeCodeExecutable: Bun.which(this.claudeCommand) || this.claudeCommand,
        abortController: run.controller, includePartialMessages: true, maxTurns: 121,
        tools: [], settingSources: [], mcpServers: { odwyn: server }, strictMcpConfig: true,
        settings: { disableAllHooks: true }, extraArgs: { 'disable-slash-commands': null },
        allowedTools: run.thread.dynamicTools.map(t => `mcp__odwyn__${t.name}`),
        canUseTool: async () => ({ behavior: 'deny', message: 'Use Odwyn tools only.' }),
        env: { ...process.env, CLAUDECODE: undefined, MCP_TOOL_TIMEOUT: '3600000' },
      },
    });
    run.stream = stream; let itemId = randomUUID(), text = '', resultSeen = false;
    try {
      for await (const message of stream) {
        if (message.type === 'stream_event') {
          if (message.event.type === 'message_start') { itemId = randomUUID(); text = ''; }
          if (message.event.delta?.type === 'text_delta') {
            text += message.event.delta.text;
            this.notify(run, 'item/agentMessage/delta', { itemId, delta: message.event.delta.text });
          }
        }
        if (message.type === 'assistant') {
          const full = message.message.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
          if (full) { this.message(run, itemId, full); text = full; }
        }
        if (message.type === 'result') {
          resultSeen = true;
          if (message.subtype !== 'success' || message.is_error) throw new Error(message.errors?.join('\n') || 'Claude Code failed. Check sign-in, model access, and quota.');
          if (!text && message.result) this.message(run, itemId, message.result);
        }
      }
      if (!resultSeen) throw new Error('Claude Code disconnected before finishing. Review progress and resume.');
    } finally { stream.close?.(); await server.instance.close(); }
  }

  stop() {
    this.codex.stop();
    const run = this.run; this.run = null; run?.controller.abort(); run?.stream?.close?.();
    for (const pending of this.pending.values()) pending.reject(new Error('Task stopped.'));
    this.pending.clear(); this.token = {};
  }
}
