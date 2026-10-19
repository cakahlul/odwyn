import {newPageWithoutTutorials} from '../tests/browser-page.js';
import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { openStore } from '../store.js';
import { defaults } from '../public/profile.js';

const options = directory => ({directory,user:'owner',password:'test-password-long-enough',origin:'http://127.0.0.1',codex:Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}}),browser:{close:async()=>{}},providerOptions:{claudeAuth:async()=>({loggedIn:true,email:'test@example.com'}),query:()=>({supportedModels:async()=>[{value:'sonnet',displayName:'Sonnet'}],close(){}})}});

// Separate process in the baseline runner avoids macOS Bun guarded-FD reuse after repeated fixtures.
test('settings own global provider; customization saves profile and provider together', async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-provider-ui-'));
  let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app=createApp({...options(directory),origin:server.url.origin});
  app.runtime.state.customization={...defaults,name:'Oddy'};app.runtime.state.globalProvider.configured=true;app.runtime.state.provider.configured=true;app.runtime.changed();
  const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:900}}),page=await newPageWithoutTutorials(context),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000);
  const edit=async()=>{if(!await page.locator('#agents-dialog').evaluate(node=>node.open)) await page.locator('#agents-open').click();await page.locator('.sidebar-agent-row').filter({has:page.locator('.sidebar-agent[aria-pressed="true"]')}).locator('summary').click();await page.getByRole('button',{name:'Customize agent',exact:true}).click();};
  const save=async()=>{await page.locator('#customize-save').click();await page.locator('#customize-dialog').waitFor({state:'hidden'});};
  try {
    await page.goto(server.url.href);expect(await page.locator('.topbar #connection-button').count()).toBe(0);
    await page.locator('#settings-open').click();await page.locator('[data-settings-section=provider]').click();expect(await page.locator('#settings-dialog #provider-type').count()).toBe(1);
    await page.locator('#provider-type').selectOption('openai');await page.locator('#provider-model').fill('workspace-model');await page.locator('#provider-base-url').fill('http://localhost:1234/v1');await page.locator('#provider-api-key').fill('saved-global-key');
    await page.locator('[data-settings-section=preferences]').click();await page.locator('#global-ownerName').fill('Alex');await page.locator('#preferences-form > .form-footer button.primary-button').click();await page.locator('#settings-dialog').waitFor({state:'hidden'});
    expect(app.runtime.state.globalProvider.model).toBe('workspace-model');expect(app.runtime.state.owner.ownerName).toBe('Alex');
    await edit();await page.locator('[data-custom-step="3"]').click();expect(await page.locator('#provider-source').inputValue()).toBe('global');expect(await page.locator('#provider-editor').isVisible()).toBe(false);
    await page.locator('#provider-source').selectOption('custom');await page.locator('#provider-model').fill('agent-model');await page.locator('#provider-api-key').fill('saved-agent-key');
    await page.locator('[data-custom-step="1"]').click();await page.locator('#agent-name-input').fill('Oddy edited');await save();
    expect(app.runtime.state.agents[0].customization.name).toBe('Oddy edited');expect(app.runtime.state.agents[0].providerOverride).toBe(true);expect(app.runtime.state.agents[0].provider.model).toBe('agent-model');
    await page.locator('#settings-open').click();await page.locator('[data-settings-section=provider]').click();expect(await page.locator('#provider-model').inputValue()).toBe('workspace-model');await page.locator('#provider-model').fill('workspace-v2');await page.locator('#preferences-form > .form-footer button.primary-button').click();await page.locator('#settings-dialog').waitFor({state:'hidden'});
    expect(app.runtime.state.agents[0].provider.model).toBe('agent-model');expect(app.runtime.state.globalProvider.apiKey).toBe('saved-global-key');
    await edit();await page.locator('[data-custom-step="3"]').click();expect(await page.locator('#provider-source').inputValue()).toBe('custom');expect(await page.locator('#provider-model').inputValue()).toBe('agent-model');
    const artifacts=resolve(import.meta.dir,'../artifacts');mkdirSync(artifacts,{recursive:true});await page.screenshot({path:join(artifacts,'agent-provider-override.png')});
    await page.locator('#provider-source').selectOption('global');await save();expect(app.runtime.state.agents[0].provider.model).toBe('workspace-v2');expect(app.runtime.state.agents[0].providerOverride).toBe(false);
    await page.locator('#agents-open').click();await page.locator('#add-agent').click();await page.locator('[data-custom-step="3"]').click();await page.locator('#provider-source').selectOption('custom');await page.locator('#provider-type').selectOption('claude');await save();
    expect(app.runtime.state.agents[1].provider.type).toBe('claude');expect(app.runtime.state.agents[1].providerOverride).toBe(true);
    await page.waitForFunction(id=>document.querySelector(`[data-select-agent="${id}"]`)?.getAttribute("aria-pressed")==="true",app.runtime.state.agents[1].id);
    await page.reload();await edit();await page.locator('[data-custom-step="3"]').click();expect(await page.locator('#provider-type').inputValue()).toBe('claude');
    await page.locator('#customize-cancel').click();await page.locator('#settings-open').click();await page.locator('[data-settings-section=provider]').click();expect(await page.locator('#provider-type').inputValue()).toBe('openai');
    await page.screenshot({path:join(artifacts,'settings-provider.png')});
    await page.setViewportSize({width:320,height:700});expect(await page.locator('#settings-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30_000);
