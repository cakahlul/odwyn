import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { openStore } from '../store.js';
import { defaults } from '../public/profile.js';

const options = directory => ({directory,user:'owner',password:'test-password-long-enough',origin:'http://127.0.0.1',codex:Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}}),browser:{close:async()=>{}},providerOptions:{claudeAuth:async()=>({loggedIn:true,email:'test@example.com'})}});

test('workspace provider inheritance, overrides, validation, and restart preserve connections', async () => {
  const directory=mkdtempSync(join(tmpdir(),'odwyn-provider-'));
  let app=createApp(options(directory));
  const request=async(path,body,method='PUT')=>app.fetch(new Request('http://127.0.0.1'+path,{method,headers:{authorization:'Basic '+Buffer.from('owner:test-password-long-enough').toString('base64'),origin:'http://127.0.0.1','content-type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})}));
  const global={type:'openai',model:'global-model',baseUrl:'http://localhost:1234/v1',apiKey:'global-secret'};
  try {
    const first=app.runtime.state.agents[0];
    expect((await request('/api/preferences',{text:'Shared memory',provider:global})).status).toBe(200);
    const second=await (await request('/api/agents',{...defaults,name:'Scout'},'POST')).json();
    expect(second.provider.model).toBe('global-model');expect(second.providerOverride).toBe(false);
    expect((await request(`/api/customization?agentId=${second.id}`,{...defaults,name:'Scout edited',provider:{inherit:false,type:'openai',model:'custom-model',baseUrl:'http://localhost:5678/v1',apiKey:'custom-secret'}})).status).toBe(200);
    const custom=app.runtime.state.agents[1];expect(custom.providerOverride).toBe(true);
    expect((await request('/api/preferences',{text:'Updated memory',provider:{...global,model:'global-v2',apiKey:''}})).status).toBe(200);
    expect(first.provider.model).toBe('global-v2');expect(first.provider.apiKey).toBe('global-secret');expect(custom.provider.model).toBe('custom-model');expect(custom.provider.apiKey).toBe('custom-secret');
    app.runtime.active={agentId:first.id};
    expect((await request('/api/preferences',{text:'Allowed while working',provider:{...global,model:'global-v2',apiKey:''}})).status).toBe(200);
    expect((await request('/api/preferences',{text:'Must not save',provider:{...global,model:'blocked-model'}})).status).toBe(400);
    expect(app.runtime.state.preferences).toBe('Allowed while working');expect(app.runtime.state.globalProvider.model).toBe('global-v2');
    app.runtime.active=null;
    expect((await request(`/api/customization?agentId=${custom.id}`,{...defaults,name:'Must not save',provider:{inherit:false,type:'invalid'}})).status).toBe(400);
    expect(custom.customization.name).toBe('Scout edited');
    expect((await request(`/api/provider?agentId=${first.id}`,{type:'claude',model:'sonnet',inherit:false})).status).toBe(200);
    expect(first.providerOverride).toBe(true);
    expect((await request('/api/account/refresh?scope=global',{},'POST')).status).toBe(200);
    const state=await (await request('/api/state',null,'GET')).json();
    expect(state.globalProvider.model).toBe('global-v2');expect(state.globalRuntime.account.type).toBe('openai');
    expect(JSON.stringify(state)).not.toContain('global-secret');expect(JSON.stringify(state)).not.toContain('custom-secret');
    await app.close();app=createApp(options(directory));
    expect(app.runtime.state.globalProvider.model).toBe('global-v2');expect(app.runtime.state.agents[0].provider.type).toBe('claude');expect(app.runtime.state.agents[1].provider.model).toBe('custom-model');
    expect((await request(`/api/provider?agentId=${custom.id}`,{inherit:true})).status).toBe(200);
    expect(app.runtime.state.agents[1].providerOverride).toBe(false);expect(app.runtime.state.agents[1].provider.apiKey).toBe('global-secret');
    expect((await request('/api/provider?scope=global',{...global,model:'global-v3'})).status).toBe(200);
    expect(app.runtime.state.agents[1].provider.model).toBe('global-v3');expect(app.runtime.state.agents[0].provider.type).toBe('claude');
  } finally {await app.close();rmSync(directory,{recursive:true,force:true});}
},10_000);

test('legacy distinct providers migrate without losing an agent connection', async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-provider-legacy-'));
  const store=openStore(directory);
  store.state.provider={type:'openai',model:'global',effort:'default',baseUrl:'http://localhost:1234/v1',apiKey:'old-key',configured:true};
  store.state.customization={...defaults};store.state.agents[0].provider={...store.state.provider};
  store.state.agents.push({id:'legacy-scout',customization:{...defaults,name:'Scout'},provider:{...store.state.provider,model:'own-model',apiKey:'own-key'}});store.save();store.close();
  const app=createApp(options(directory));
  try {expect(app.runtime.state.agents[0].providerOverride).toBe(false);expect(app.runtime.state.agents[1].providerOverride).toBe(true);expect(app.runtime.state.agents[1].provider.apiKey).toBe('own-key');expect(app.runtime.state.globalProvider.apiKey).toBe('old-key');}
  finally {await app.close();rmSync(directory,{recursive:true,force:true});}
});

test('settings own global provider; customization saves profile and provider together', async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-provider-ui-'));
  let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app=createApp({...options(directory),origin:server.url.origin});
  app.runtime.state.customization={...defaults,name:'Oddy'};app.runtime.state.globalProvider.configured=true;app.runtime.state.provider.configured=true;app.runtime.changed();
  const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000);
  const edit=async()=>{await page.locator('.sidebar-agent-row').filter({has:page.locator('.sidebar-agent[aria-pressed="true"]')}).locator('summary').click();await page.getByRole('button',{name:'Customize agent',exact:true}).click();};
  const save=async()=>{await page.locator('#customize-save').click();await page.locator('#customize-dialog').waitFor({state:'hidden'});};
  try {
    await page.goto(server.url.href);expect(await page.locator('.topbar #connection-button').count()).toBe(0);
    await page.locator('#settings-open').click();expect(await page.locator('#settings-dialog #provider-type').count()).toBe(1);
    await page.locator('#provider-type').selectOption('openai');await page.locator('#provider-model').fill('workspace-model');await page.locator('#provider-base-url').fill('http://localhost:1234/v1');await page.locator('#provider-api-key').fill('saved-global-key');
    await page.locator('#global-ownerName').fill('Alex');await page.locator('#preferences-form button.primary-button').click();await page.locator('#settings-dialog').waitFor({state:'hidden'});
    expect(app.runtime.state.globalProvider.model).toBe('workspace-model');expect(app.runtime.state.owner.ownerName).toBe('Alex');
    await edit();await page.locator('[data-custom-step="3"]').click();expect(await page.locator('#provider-source').inputValue()).toBe('global');expect(await page.locator('#provider-editor').isVisible()).toBe(false);
    await page.locator('#provider-source').selectOption('custom');await page.locator('#provider-model').fill('agent-model');await page.locator('#provider-api-key').fill('saved-agent-key');
    await page.locator('[data-custom-step="1"]').click();await page.locator('#agent-name-input').fill('Oddy edited');await save();
    expect(app.runtime.state.agents[0].customization.name).toBe('Oddy edited');expect(app.runtime.state.agents[0].providerOverride).toBe(true);expect(app.runtime.state.agents[0].provider.model).toBe('agent-model');
    await page.locator('#settings-open').click();expect(await page.locator('#provider-model').inputValue()).toBe('workspace-model');await page.locator('#provider-model').fill('workspace-v2');await page.locator('#preferences-form button.primary-button').click();await page.locator('#settings-dialog').waitFor({state:'hidden'});
    expect(app.runtime.state.agents[0].provider.model).toBe('agent-model');expect(app.runtime.state.globalProvider.apiKey).toBe('saved-global-key');
    await edit();await page.locator('[data-custom-step="3"]').click();expect(await page.locator('#provider-source').inputValue()).toBe('custom');expect(await page.locator('#provider-model').inputValue()).toBe('agent-model');
    const artifacts=resolve(import.meta.dir,'../artifacts');mkdirSync(artifacts,{recursive:true});await page.screenshot({path:join(artifacts,'agent-provider-override.png')});
    await page.locator('#provider-source').selectOption('global');await save();expect(app.runtime.state.agents[0].provider.model).toBe('workspace-v2');expect(app.runtime.state.agents[0].providerOverride).toBe(false);
    await page.locator('#add-agent').click();await page.locator('[data-custom-step="3"]').click();await page.locator('#provider-source').selectOption('custom');await page.locator('#provider-type').selectOption('claude');await save();
    expect(app.runtime.state.agents[1].provider.type).toBe('claude');expect(app.runtime.state.agents[1].providerOverride).toBe(true);
    await page.locator(`[data-select-agent="${app.runtime.state.agents[1].id}"][aria-pressed="true"]`).waitFor();
    await page.reload();await edit();await page.locator('[data-custom-step="3"]').click();expect(await page.locator('#provider-type').inputValue()).toBe('claude');
    await page.locator('#customize-cancel').click();await page.locator('#settings-open').click();expect(await page.locator('#provider-type').inputValue()).toBe('openai');
    await page.screenshot({path:join(artifacts,'settings-provider.png')});
    await page.setViewportSize({width:320,height:700});expect(await page.locator('#settings-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30_000);
