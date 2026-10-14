import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { createApp } from '../server.js';
import { AIProvider } from '../providers.js';

test('isolated providers use their own sign-in and MCP configuration directories', () => {
  const home=join(tmpdir(),'isolated-provider-home');
  const provider=new AIProvider({config:{type:'codex',model:'test'},home,workspace:tmpdir(),isolated:true});
  expect(provider.codex.home).toBe(home);
  expect(provider.codex.mcpHome).toBe(home);
  expect(provider.codex.isolated).toBe(true);
  expect(provider.env.CLAUDE_CONFIG_DIR).toBe(join(home,'claude'));
  expect(provider.env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(provider.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  provider.stop();
});

test('workspace homes isolate data and persist linked settings', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-workspaces-'));
  const codex = new EventEmitter(); codex.request = async () => ({ account:null }); codex.stop = () => {};
  const options = {directory, user:'owner', password:'test-password-long-enough', origin:'https://assistant.test', providerOptions:{codex}};
  let app = createApp(options);
  const headers = {authorization:'Basic '+Buffer.from('owner:'+options.password).toString('base64'), origin:options.origin, 'content-type':'application/json'};
  const request = (path, method='GET', body) => app.fetch(new Request(options.origin+path,{method,headers,...(body ? {body:JSON.stringify(body)} : {})}));
  try {
    expect((await request('/api/workspaces','POST',{name:''})).status).toBe(400);
    const created = await request('/api/workspaces','POST',{name:'Research'});
    expect(created.status).toBe(201);
    const {id} = await created.json();
    const other = path => `${path}?workspace=${id}`;
    const home = await (await request('/api/state')).json();
    const research = await (await request(other('/api/state'))).json();
    expect(research.agents[0].id).not.toBe(home.agents[0].id);
    expect((await request('/api/state?workspace=../../etc')).status).toBe(404);
    expect((await app.fetch(new Request(options.origin+other('/api/state')))).status).toBe(401);
    expect((await request(other('/api/preferences'),'PUT',{text:'Research only',ownerName:'Researcher'})).status).toBe(200);
    expect((await (await request('/api/state')).json()).preferences).not.toBe('Research only');
    expect((await request(other('/api/workspaces/share'),'POST',{kind:'preferences',enabled:true})).status).toBe(200);
    expect((await (await request('/api/state')).json()).preferences).toBe('Research only');
    await request('/api/preferences','PUT',{text:'Linked update'});
    expect((await (await request(other('/api/state'))).json()).preferences).toBe('Linked update');
    const third = await (await request('/api/workspaces','POST',{name:'Writing'})).json();
    expect((await (await request(`/api/state?workspace=${third.id}`)).json()).preferences).toBe('Linked update');
    await request('/api/workspaces/share','POST',{kind:'preferences',enabled:false});
    await request(other('/api/preferences'),'PUT',{text:'Separate again'});
    expect((await (await request('/api/state')).json()).preferences).toBe('Linked update');
    expect((await request('/api/workspaces/share','POST',{kind:'provider',enabled:true})).status).toBe(400);
    expect((await request(other('/api/workspaces/share'),'POST',{kind:'provider',enabled:true,ownerPassword:options.password})).status).toBe(200);
    expect((await request(other('/api/provider')+'&scope=global','PUT',{type:'openai',model:'test-model',apiKey:'shared-secret',baseUrl:'https://example.com/v1'})).status).toBe(200);
    expect(app.runtime.state.globalProvider.apiKey).toBe('shared-secret');
    expect((await (await request('/api/state')).text())).not.toContain('shared-secret');
    app.runtime.active={id:'held',agentId:home.agents[0].id};
    expect((await request(other('/api/provider')+'&scope=global','PUT',{type:'openai',model:'blocked-model'})).status).toBe(400);
    expect((await (await request(other('/api/state'))).json()).globalProvider.model).toBe('test-model');
    app.runtime.active=null;
    await app.close(); app = createApp(options);
    expect((await (await request('/api/workspaces')).json()).workspaces).toHaveLength(3);
    expect((await (await request(other('/api/state'))).json()).preferences).toBe('Separate again');
    expect((await (await request('/api/workspaces')).json()).sharing.provider).toBe(true);
  } finally { await app.close(); rmSync(directory,{recursive:true,force:true}); }
});
