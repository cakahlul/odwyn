import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {defaults} from '../public/profile.js';
import {openStore} from '../store.js';
import {newPageWithoutTutorials} from '../tests/browser-page.js';

test('one agent selects Antigravity CLI, saves its model override, reloads and refreshes without API login',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-antigravity-ui-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex:Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}}),browser:{close:async()=>{}},providerOptions:{antigravityCommand:resolve(import.meta.dir,'../tests/antigravity-cli.js')}});
  app.runtime.state.customization={...defaults,name:'Researcher'};app.runtime.state.globalProvider.configured=true;app.runtime.changed();
  const browser=await chromium.launch(),page=await newPageWithoutTutorials(browser,{httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:960}}),errors=[],requests=[];
  page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  const open=()=>page.evaluate(async()=>{const {openCustomization}=await import('/customize.js');openCustomization(false,false,false,true);});
  try{
    await page.goto(server.url.href+'#chat');await page.locator('#prompt').waitFor();await open();
    await page.locator('#provider-source').selectOption('custom');await page.locator('#provider-type').selectOption('antigravity');
    await page.locator('#provider-model-list option[value=default]').waitFor({state:'attached'});
    expect(await page.locator('#provider-model-list').inputValue()).toBe('default');
    expect(await page.locator('#provider-api-fields').isVisible()).toBe(false);
    expect(await page.locator('#provider-effort option').count()).toBe(1);
    expect(await page.locator('#provider-hint').textContent()).toContain('subscription');
    await page.locator('#provider-model-list').selectOption('');await page.locator('#provider-model').fill('custom-model');
    await page.locator('#customize-save').click();await page.locator('#customize-dialog').waitFor({state:'hidden'});
    expect(app.runtime.state.agents[0].provider).toMatchObject({type:'antigravity',model:'custom-model'});
    expect(app.runtime.state.agents[0].providerOverride).toBe(true);expect(app.runtime.state.globalProvider.type).toBe('codex');
    await page.reload();await open();expect(await page.locator('#provider-type').inputValue()).toBe('antigravity');expect(await page.locator('#provider-model').inputValue()).toBe('custom-model');
    expect(await page.locator('#connect-account').textContent()).toBe('Refresh');await page.locator('#connect-account').click();
    expect(requests.some(url=>url.includes('/api/account/refresh'))).toBe(true);expect(requests.some(url=>url.includes('/api/account/login'))).toBe(false);
    const artifacts=resolve(import.meta.dir,'../artifacts/ui/antigravity');mkdirSync(artifacts,{recursive:true});await page.screenshot({path:join(artifacts,'provider.png')});
    await page.setViewportSize({width:320,height:800});expect(await page.locator('#customize-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    await page.locator('#customize-cancel').click();
    const reopened=openStore(directory);expect(reopened.state.agents[0].provider.type).toBe('antigravity');reopened.close();expect(errors).toEqual([]);
  }finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},20000);
