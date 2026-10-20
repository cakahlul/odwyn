import {newPageWithoutTutorials} from '../tests/browser-page.js';
import {test,expect} from 'bun:test';
import {chromium} from 'playwright';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createApp} from '../server.js';
import {defaults} from '../public/profile.js';

test('header exposes workspace actions and room creation in dock and sidebar layouts',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-entrypoints-')),password='test-password-long-enough',codex=Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}});let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app=createApp({directory,user:'owner',password,origin:server.url.origin,providerOptions:{codex},browser:{close:async()=>{}}});
  app.runtime.state.globalProvider.configured=true;app.runtime.state.customization={...defaults,name:'Lead'};app.runtime.changed();
  const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'owner',password},viewport:{width:1440,height:960}}),page=await newPageWithoutTutorials(context),errors=[];
  page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
  const screenshots=resolve('artifacts/ui/workspace-navigation');mkdirSync(screenshots,{recursive:true});
  try{
    await page.goto(server.url.href);await page.locator('#workspace-home:not([disabled])').waitFor();
    expect(await page.locator('.topbar #new-workspace').count()).toBe(0);
    if(!await page.locator('#new-room-top').isVisible())await page.locator('#conversation-menu-open').click();await page.locator('#new-room-top').click();await page.locator('#room-dialog').waitFor({state:'visible'});expect(await page.locator('#room-setup-hint').isVisible()).toBe(true);expect(await page.locator('#room-save').isDisabled()).toBe(true);
    await page.locator('#room-add-agent').click();await page.locator('#customize-dialog').waitFor({state:'visible'});await page.locator('#customize-close').click();
    const added=await page.evaluate(async profile=>{const response=await fetch('/api/agents',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(profile)});return response.json();},{...defaults,name:'Engineer'});
    await page.reload();await page.locator('#workspace-home:not([disabled])').waitFor();
    if(!await page.locator('#new-room-top').isVisible())await page.locator('#conversation-menu-open').click();await page.locator('#new-room-top').click();await page.locator('#room-name').fill('Studio grooming');await page.locator(`#room-agent-options input[value="${added.id}"]`).check();await page.locator('#room-save').click();await page.locator('#room-dialog').waitFor({state:'hidden'});
    expect(app.runtime.state.conversations.find(room=>room.title==='Studio grooming')?.memberIds.length).toBe(2);
    if(await page.locator('.toast').isVisible())await page.getByRole('button',{name:'Dismiss notification'}).click();
    for(const navigation of ['dock','sidebar']){
      await page.evaluate(async navigation=>fetch('/api/appearance',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({palette:'paper',navigation,motion:'reduced'})}),navigation);await page.waitForFunction(n=>document.documentElement.dataset.navigation===n,navigation);
      for(const width of [320,768,1024,1440]){
        await page.setViewportSize({width,height:960});
        if(width===320)await page.waitForFunction(()=>document.documentElement.classList.contains('sidebar-collapsed'));
        expect(await page.locator('.topbar').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);if(!await page.locator('#new-room-top').isVisible())await page.locator('#conversation-menu-open').click();expect(await page.locator('#new-room-top').isVisible()).toBe(true);const entry=await page.locator('#new-room-top').boundingBox();expect(entry.x).toBeGreaterThanOrEqual(0);expect(entry.x+entry.width).toBeLessThanOrEqual(width);if(!await page.locator('#new-room-top').isVisible())await page.locator('#conversation-menu-open').click();await page.locator('#new-room-top').click();await page.locator('#room-dialog').waitFor({state:'visible'});await page.locator('#room-dialog-close').click();
        await page.screenshot({path:join(screenshots,`${navigation}-${width}-header.png`)});
        if(!await page.locator('#workspace-home').isVisible())await page.locator('#conversation-menu-open').click();await page.locator('#workspace-home').click();await page.locator('#workspace-menu').waitFor({state:'visible'});const bounds=await page.locator('#workspace-menu').boundingBox();expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
        await page.screenshot({path:join(screenshots,`${navigation}-${width}.png`)});await page.keyboard.press('Escape');
      }
    }
    if(!await page.locator('#workspace-home').isVisible())await page.locator('#conversation-menu-open').click();await page.locator('#workspace-home').click();await page.locator('#workspace-menu-settings').click();await page.locator('#settings-workspaces-controls').waitFor({state:'visible'});await page.getByRole('button',{name:'Close settings',exact:true}).click();
    if(!await page.locator('#workspace-home').isVisible())await page.locator('#conversation-menu-open').click();await page.locator('#workspace-home').click();await page.locator('#new-workspace').click();await page.locator('#workspace-create-dialog').waitFor({state:'visible'});expect(await page.locator('#workspace-home-name').evaluate(node=>node===document.activeElement)).toBe(true);
    await page.keyboard.press('Escape');expect(await page.locator('#workspace-home').evaluate(node=>node===document.activeElement)).toBe(true);
    expect(errors).toEqual([]);
  }finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30000);
