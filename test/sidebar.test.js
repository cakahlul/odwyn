import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { defaults } from '../public/profile.js';

test('workspace dock separates conversations, agents, and tools while keeping chat controls reachable',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-sidebar-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex:Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}}),browser:{close:async()=>{}}});
  app.runtime.state.customization={...defaults,name:'Oddy'};app.runtime.state.provider.configured=true;app.runtime.state.globalProvider.configured=true;
  for(const [index,name] of ['Rei','Kai','Eve','Momo'].entries())app.runtime.state.agents.push({id:'agent-'+index,customization:{...defaults,name,bodyColor:['#668ad6','#80baba','#ba7ca8','#cd9865'][index]},provider:{...app.runtime.state.provider,configured:false}});
  const first=app.runtime.state.agents[0].id;
  app.runtime.state.conversations=[{id:'weekend',kind:'room',memberIds:[first,'agent-0'],agentId:first,title:'Weekend plans',createdAt:new Date().toISOString(),messages:[]}];for(let index=0;index<30;index++) app.runtime.state.conversations.push({id:'chat-'+index,agentId:first,title:'Conversation '+(index+1),createdAt:new Date().toISOString(),messages:[]});
  app.runtime.changed();
  const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000);
  try{
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto(server.url.href);
    expect(await page.locator('.shell>.sidebar').count()).toBe(0);
    expect(await page.locator('#settings-open [data-icon=settings]').count()).toBe(1);
    expect(await page.locator('.workspace-dock .dock-item').count()).toBe(3);
    expect(await page.locator('#main').evaluate(node=>node.clientWidth)).toBe(1440);
    expect(await page.locator('#search-dialog').evaluate(node=>node.open)).toBe(false);
    expect(await page.locator('#agents-dialog').evaluate(node=>node.open)).toBe(false);
    const artifacts=resolve(import.meta.dir,'../artifacts');mkdirSync(artifacts,{recursive:true});
    await page.screenshot({path:join(artifacts,'workspace-dock-desktop.png')});
    for(const label of ['Routines','Workflows & skills','Files & results','Task runs']){
      await page.getByRole('button',{name:'Tools',exact:true}).click();
      expect(await page.locator('#tools-dialog').evaluate(node=>node.matches(':modal'))).toBe(true);
      await page.getByRole('button',{name:label,exact:true}).click();
      expect(await page.locator('#tools-dialog').evaluate(node=>node.open)).toBe(false);
      expect(await page.locator('#tools-open').getAttribute('class')).toContain('active');
    }
    await page.locator('#tools-open').click();await page.screenshot({path:join(artifacts,'workspace-tools.png')});await page.keyboard.press('Escape');
    expect(await page.locator('#tools-open').evaluate(node=>node===document.activeElement)).toBe(true);
    await page.locator('#settings-open').click();await page.getByRole('heading',{name:'Odwyn settings'}).waitFor();await page.getByRole('button',{name:'Close settings'}).click();
    await page.locator('#agents-open').click();
    await page.locator('#agents-dialog .agent-menu summary').first().click();
    await page.keyboard.press('Escape');expect(await page.locator('#agents-dialog').evaluate(node=>node.open)).toBe(true);
    await page.screenshot({path:join(artifacts,'workspace-agents.png')});
    await page.getByRole('button',{name:'Open Rei',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#agent-name').textContent==='Rei' && !document.querySelector('#minimize-agent').disabled);
    expect(await page.locator('#agents-dialog').evaluate(node=>node.open)).toBe(false);
    await page.locator('#menu-button').click();
    expect(await page.locator('#search-dialog').evaluate(node=>node.matches(':modal'))).toBe(true);
    expect(await page.locator('#history [data-conversation]').count()).toBe(30);
    await page.locator('#search-input').fill('Conversation 30');
    expect(await page.locator('.library-browse').isVisible()).toBe(false);
    expect(await page.locator('#search-results .search-result').count()).toBe(1);
    await page.locator('#search-input').fill('');
    expect(await page.locator('.library-browse').isVisible()).toBe(true);
    await page.screenshot({path:join(artifacts,'workspace-conversations.png')});
    await page.getByRole('button',{name:'Weekend plans',exact:true}).click();await page.locator('#room-label').filter({hasText:'Weekend plans'}).waitFor();
    expect(await page.locator('#search-dialog').evaluate(node=>node.open)).toBe(false);
    for(const width of [320,768,1024,1700]){
      await page.setViewportSize({width,height:700});
      await page.waitForFunction(()=>document.querySelector('.shell').scrollWidth<=document.querySelector('.shell').clientWidth);
      const dock=await page.locator('.workspace-dock').boundingBox();expect(dock.x).toBeGreaterThanOrEqual(0);expect(dock.x+dock.width).toBeLessThanOrEqual(width);
      await page.locator('#new-chat').click();expect(await page.locator('#prompt').evaluate(node=>node===document.activeElement)).toBe(true);
      for(const id of ['agents','tools']){
        await page.locator('#'+id+'-open').click();
        expect(await page.locator('#'+id+'-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
        await page.keyboard.press('Escape');
      }
      await page.locator('#menu-button').click();expect(await page.locator('#search-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);await page.keyboard.press('Escape');
      await page.locator('#browser-toggle').click();expect(await page.locator('#browser-panel').evaluate(node=>node.inert)).toBe(false);await page.keyboard.press('Escape');
      expect(await page.locator('#browser-toggle').evaluate(node=>node===document.activeElement)).toBe(true);
      if(width===320) await page.screenshot({path:join(artifacts,'workspace-dock-mobile.png')});
    }
    await page.locator('#minimize-agent').click();await page.getByRole('heading',{name:'Your agents are minimized'}).waitFor();
    await page.locator('#new-chat').click();await page.locator('#prompt').waitFor({state:'visible'});
    await page.reload();expect(await page.locator('.workspace-dock').isVisible()).toBe(true);
    await page.keyboard.press('Control+k');expect(await page.locator('#search-input').evaluate(node=>node===document.activeElement)).toBe(true);await page.keyboard.press('Escape');
    await page.setViewportSize({width:1440,height:480});
    const newChat=await page.locator('#new-chat').boundingBox();expect(newChat.y+newChat.height).toBeLessThanOrEqual(480);
    expect(errors).toEqual([]);
  }finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30_000);
