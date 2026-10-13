import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../../store.js';
import { Runtime } from '../../runtime.js';
import { Browser } from '../../browser.js';
import { defaults } from '../../public/profile.js';

export class FixtureProvider extends EventEmitter {
  child = {}; calls = []; replies = [];
  async request(method, params) {
    this.calls.push({method, params});
    if (method === 'account/read') return {account: {type: 'chatgpt'}};
    if (method.startsWith('thread/')) return {thread: {id: randomUUID()}};
    if (method === 'turn/start') return {turn: {id: randomUUID(), status: 'inProgress'}};
    return {};
  }
  respond(id, result) { this.replies.push({id, result}); }
  reject(id, message) { this.replies.push({id, result: {success: false, message}}); }
  stop() {}
}

// All probes use application dispatch and real disposable storage/browser/shell.
// These characterize legacy exposure, not a sandbox or a replacement policy engine.
export async function legacyProbe(kind) {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-security-baseline-'));
  const workspace = join(directory, 'workspace'); mkdirSync(workspace);
  const store = openStore(join(directory, 'data'));
  const browser = new Browser({directory: join(directory, 'data')});
  const provider = new FixtureProvider();
  const runtime = new Runtime({store, codex: provider, browser, workspace});
  const canary = `synthetic_${randomUUID().replaceAll('-', '')}`;
  const agents = store.state.agents;
  agents[0].customization = store.state.customization = {...defaults, name: 'Orchid Planner'};
  for (const name of ['Invoice Owl', 'Dusty Telescope']) agents.push({id: randomUUID(), customization: {...defaults, name}});
  const invoke = async (job, tool, args) => {
    const id = randomUUID();
    await runtime.executeRequest({id, method: 'item/tool/call', params: {threadId: job.threadId, tool, arguments: args}});
    const result = provider.replies.find(reply => reply.id === id)?.result;
    if (!result?.success) return {denied:true};
    return JSON.parse(result.contentItems[0].text);
  };
  const activate = agentId => {
    const job = runtime.submit({agentId, prompt: 'Disposable boundary probe', interactionMode: 'allow'});
    job.status = 'running'; job.threadId = randomUUID(); runtime.active = job;
    return job;
  };
  try {
    const job = activate(agents[0].id);
    if (kind === 'terminal') {
      writeFileSync(join(directory, 'host-only-canary'), canary, {mode: 0o600});
      const result = await invoke(job, 'odwyn_terminal', {command: 'cat ../host-only-canary', reason: 'Read planted fixture only', timeoutMs: 1000});
      return {leaked: result.stdout === canary, denied:result.denied===true, exitCode: result.exitCode ?? null, outsideWorkspace: true};
    }
    if (kind === 'search') {
      store.state.conversations.push({id: randomUUID(), agentId: agents[1].id, title: 'Foreign fixture', messages: [{id: randomUUID(), role: 'user', text: canary, at: new Date().toISOString()}]});
      store.save();
      const result = await invoke(job, 'odwyn_search', {query: canary});
      return {leaked: (result.matches || []).some(match => match.text.includes(canary)), denied:result.denied===true, matches: (result.matches || []).length};
    }
    if (kind === 'memory') {
      const write=await invoke(job, 'odwyn_remember', {note: canary});
      if(write.denied)return {leaked:false,denied:true,memoryUnchanged:!store.state.preferences.includes(canary)};
      const next = activate(agents[2].id);
      await runtime.startJob(next);
      const params = provider.calls.find(call => call.method === 'thread/start')?.params;
      return {leaked: params?.developerInstructions.includes(canary) === true, differentAgent: next.agentId !== job.agentId};
    }
    if (kind === 'browser') {
      const opened=await invoke(job, 'odwyn_browser', {action: 'read', reason: 'Open disposable profile'});
      if(opened.denied)return {leaked:false,denied:true,profileNotStarted:!browser.context};
      // Fake origin is intercepted before DNS/network; no real site is contacted.
      await browser.context.route('**/*', route => route.fulfill({contentType: 'text/html', body: '<title>Fixture</title>'}));
      await browser.context.addCookies([{name: 'fixture_session', value: canary, domain: 'fixture.invalid', path: '/'}]);
      await browser.page.goto('https://fixture.invalid/');
      await browser.page.evaluate(value => localStorage.setItem('fixture', value), canary);
      const context = browser.context;
      const next = activate(agents[1].id); browser.owner = next.id;
      await invoke(next, 'odwyn_browser', {action: 'read', reason: 'Read next agent fixture session'});
      const cookies = await browser.context.cookies('https://fixture.invalid/');
      return {leaked: cookies.some(cookie => cookie.value === canary), sharedContext: context === browser.context,
        localStorageShared: await browser.page.evaluate(() => localStorage.getItem('fixture')) === canary};
    }
    throw new Error('Unknown legacy probe');
  } finally {
    runtime.close(); await browser.close(); store.close(); rmSync(directory, {recursive: true, force: true});
  }
}
