import {test,expect} from 'bun:test';
import {chromium} from 'playwright';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {createApp} from '../server.js';
import {defaults} from '../public/profile.js';

test('create and switch homes, preserve drafts, link settings, and scope downloads',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-homes-ui-'));
  const codex=new EventEmitter();codex.request=async()=>({account:null});codex.stop=()=>{};
  const options={directory,user:'owner',password:'test-password-long-enough',providerOptions:{codex}};
  let app;const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app=createApp({...options,origin:server.url.origin});
  app.runtime.state.globalProvider.configured=true;
  app.runtime.state.customization={...defaults,name:'Home agent'};app.runtime.state.agents[0].customization=app.runtime.state.customization;app.runtime.changed();
  const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:options.user,password:options.password}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());page.setDefaultTimeout(7000);
  try {
    await page.goto(server.url.href);await page.locator('#workspace-home:not([disabled])').waitFor();
    await page.locator('#new-chat').click();
    await page.locator('#prompt').fill('Home draft');
    await page.locator('#new-workspace').click();await page.locator('#workspace-home-name').fill('Research');
    await page.locator('#workspace-create-form button').click();
    await page.waitForURL('**/?workspace=*');await page.locator('#workspace-home:not([disabled])').waitFor();
    const id=await page.locator('#workspace-home').inputValue();
    expect(id).not.toBe('default');expect(await page.locator('#prompt').inputValue()).toBe('');
    // Configure the new home without connecting any external provider.
    await page.evaluate(async profile=>{
      await fetch('/api/customization'+location.search,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(profile)});
      await fetch('/api/provider'+location.search+'&scope=global',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({type:'codex',model:'gpt-6.1-sol'})});
    },{...defaults,name:'Research agent'});
    await page.reload();await page.locator('#workspace-home:not([disabled])').waitFor();
    await page.locator('#new-chat').click();
    await page.locator('#prompt').fill('Research draft');
    const uploaded=await page.evaluate(async()=>{
      const form=new FormData();form.append('file',new File(['Research file'],'research.txt'));
      return (await fetch('/api/files'+location.search,{method:'POST',body:form})).json();
    });
    expect(await page.evaluate(async fileId=>(await fetch('/api/files/'+fileId)).status,uploaded.id)).toBe(404);
    expect(await page.evaluate(async fileId=>(await fetch('/api/files/'+fileId+location.search)).text(),uploaded.id)).toBe('Research file');
    await page.locator('#settings-open').click();await page.locator('[data-settings-section=sharing]').click();
    await page.locator('[data-share-setting=appearance]').check();
    await page.locator('#workspace-sharing-status').filter({hasText:'Shared.'}).waitFor();
    await page.locator('[data-share-setting=provider]').check();
    await page.locator('#security-password').fill(options.password);
    const shared=page.waitForResponse(response=>response.url().includes('/api/workspaces/share') && response.request().postData()?.includes('"kind":"provider"'));
    await page.getByRole('button',{name:'Confirm exact request',exact:true}).click();expect((await shared).status()).toBe(200);
    await page.locator('#settings-dialog .modal-top button').click();
    await page.locator('#workspace-home').selectOption('default');await page.waitForURL(url=>!url.search);
    await page.waitForFunction(()=>document.querySelector('#prompt').value==='Home draft');
    await page.locator('#workspace-home').selectOption(id);await page.waitForURL('**/?workspace=*');
    await page.waitForFunction(()=>document.querySelector('#prompt').value==='Research draft');
    await page.evaluate(async()=>fetch('/api/appearance'+location.search,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({palette:'paper',motion:'reduced',navigation:'sidebar'})}));
    await page.waitForFunction(()=>document.documentElement.dataset.navigation==='sidebar');
    for(const width of [320,768,1440]) {
      await page.setViewportSize({width,height:900});
      if(width===320 && !await page.locator('html').evaluate(node=>node.classList.contains('sidebar-collapsed')))await page.locator('#sidebar-collapse').click();
      expect(await page.locator('.topbar').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      expect(await page.locator('#workspace-home').isVisible()).toBe(true);
      if(width===320)await page.screenshot({path:'/tmp/odwyn-workspace-mobile.png'});
    }
    expect(errors).toEqual([]);
  } finally {await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30000);
