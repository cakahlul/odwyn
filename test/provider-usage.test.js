import {newPageWithoutTutorials} from '../tests/browser-page.js';
import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { AIProvider, validateProvider } from '../providers.js';
import { defaults } from '../public/profile.js';

test('provider usage refreshes, stays per-agent, handles failures, and appears in settings',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-usage-'));let app,fail=false;
  const requests=[],codex=Object.assign(new EventEmitter(),{stop(){},request:async method=>{
    requests.push(method);
    if (method === 'account/read') return {account:{type:'chatgpt',email:'test@example.com'}};
    if (method === 'account/rateLimits/read') {
      if (fail) throw new Error('private provider error');
      return {rateLimitsByLimitId:{codex:{limitId:'codex',primary:{usedPercent:35,windowDurationMins:300,resetsAt:1900000000},secondary:{usedPercent:12,windowDurationMins:10080,resetsAt:1900100000}}}};
    }
    return {data:[]};
  }});
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex,browser:{close:async()=>{}},providerOptions:{claudeAuth:async()=>({loggedIn:true}),query:()=>({supportedModels:async()=>[],close(){}})}});
  const state=app.runtime.state,agent=state.agents[0],provider=app.runtime.providers.get(agent.id);
  state.customization={...defaults,name:'Oddy'};state.globalProvider.configured=true;agent.provider.configured=true;
  const browser=await chromium.launch(),page=await newPageWithoutTutorials(browser,{httpCredentials:{username:'owner',password:'test-password-long-enough'}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  try {
    await app.runtime.refreshAccount();
    expect(requests).toContain('account/rateLimits/read');
    expect(app.runtime.accounts.get(agent.id).usage.limits).toHaveLength(2);
    await page.goto(server.url.href);await page.locator('#settings-open').click();await page.locator('[data-settings-section=provider]').click();
    await page.getByText('35% used',{exact:false}).waitFor();
    expect(await page.locator('#provider-usage meter').count()).toBe(2);
    expect(await page.locator('#provider-usage').textContent()).toContain('codex · 5-hour');
    expect(await page.locator('#provider-usage').textContent()).toContain('Resets');
    await page.locator('#provider-usage').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/odwyn-provider-usage.png'});
    fail=true;await page.locator('#connect-account').click();
    await page.getByText('Usage refresh failed.',{exact:false}).waitFor();
    expect(await page.locator('#provider-usage').textContent()).toContain('35% used');
    expect(await page.locator('#provider-usage').textContent()).not.toContain('private provider error');
    const second=new AIProvider({config:validateProvider({type:'claude'}),workspace:directory,codex:Object.assign(new EventEmitter(),{stop(){}}),claudeAuth:async()=>({loggedIn:true})});
    app.runtime.addProvider('second',second);
    second.updateUsage({limits:[{id:'five_hour',name:'5-hour limit',status:'rejected',usedPercent:100}]});
    expect(app.runtime.accounts.get('second').usage.limits[0].usedPercent).toBe(100);
    expect(app.runtime.accounts.get(agent.id).usage.limits[0].usedPercent).toBe(35);
    codex.emit('notification',{method:'account/rateLimits/updated',params:{rateLimits:{limitId:'codex',primary:{usedPercent:50,windowDurationMins:300,resetsAt:1900000000}}}});
    await page.getByText('50% used',{exact:false}).waitFor();
    expect(app.runtime.accounts.get(agent.id).usageError).toBeNull();
    const config=validateProvider({type:'claude'});provider.configure(config);agent.provider=config;state.provider=config;state.globalProvider=config;
    await app.runtime.refreshAccount();await page.reload();await page.locator('#settings-open').click();await page.locator('[data-settings-section=provider]').click();
    await page.getByText('No limits reported yet.',{exact:false}).waitFor();
    provider.updateUsage({limits:[{id:'five_hour',name:'5-hour limit',status:'allowed',resetsAt:1900000000,usedPercent:null}],lastRun:{inputTokens:123,outputTokens:45}});
    await page.getByText('Usage percentage unavailable',{exact:false}).waitFor();
    expect(await page.locator('#provider-usage meter').count()).toBe(0);
    expect(await page.locator('#provider-usage').textContent()).toContain('Available');
    expect(await page.locator('#provider-usage').textContent()).toContain('123 input · 45 output tokens');
    expect(errors).toEqual([]);
  } finally {await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30000);
