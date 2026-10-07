import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { defaults } from '../public/profile.js';

test('sidebar rail saves space, keeps menus usable, persists, and preserves the mobile drawer',async()=>{
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
    await page.goto(server.url.href);
    const floatingRail=await page.locator('#sidebar').boundingBox();expect(floatingRail.x).toBe(12);expect(floatingRail.y).toBe(12);expect(floatingRail.y+floatingRail.height).toBe(888);
    expect(await page.locator('#sidebar #sidebar-toggle').count()).toBe(1);
    expect(await page.locator('#browser-toggle [data-icon=chevron]').count()).toBe(0);
    const before=await page.locator('#main').boundingBox();
    await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().width===68);
    expect(await page.locator('#sidebar').evaluate(node=>node.offsetWidth)).toBe(68);
    expect((await page.locator('#main').boundingBox()).width-before.width).toBe(164);
    expect(await page.getByRole('button',{name:'Expand sidebar',exact:true}).getAttribute('aria-expanded')).toBe('false');
    expect(await page.locator('.navigation [data-view="runs"]').count()).toBe(0);
    expect(await page.locator('.history-label [data-view="runs"]').count()).toBe(1);
    expect(await page.locator('[data-view="workflows"] [data-icon]').getAttribute('data-icon')).toBe('workflow');
    for(const label of ['Chat','Routines','Workflows & skills','Files & results']){
      const button=page.locator('.navigation').getByRole('button',{name:label,exact:true});expect(await button.getAttribute('title')).toBe(label);await button.click();
    }
    await page.getByRole('button',{name:'Task runs',exact:true}).click();
    expect(await page.locator('.history-runs').getAttribute('title')).toBe('Task runs');
    await page.getByRole('heading',{name:'Task runs',exact:true}).waitFor();
    await page.getByRole('button',{name:'Odwyn settings',exact:true}).click();await page.getByRole('heading',{name:'Odwyn settings'}).waitFor();await page.getByRole('button',{name:'Close settings'}).click();
    await page.getByRole('button',{name:'Search conversations',exact:true}).click();expect(await page.locator('#search-dialog').isVisible()).toBe(true);await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Open Rei',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#agent-name').textContent==='Rei' && !document.querySelector('#minimize-agent').disabled);
    expect(await page.locator('[data-select-agent="agent-0"]').getAttribute('aria-pressed')).toBe('true');
    await page.getByRole('button',{name:'Weekend plans',exact:true}).click();await page.locator('#room-label').filter({hasText:'Weekend plans'}).waitFor();
    const artifacts=resolve(import.meta.dir,'../artifacts');mkdirSync(artifacts,{recursive:true});await page.screenshot({path:join(artifacts,'sidebar-collapsed.png')});
    await page.reload();await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().width===68);expect(await page.locator('#sidebar').evaluate(node=>node.offsetWidth)).toBe(68);
    for(const width of [768,1024,1700]){
      await page.setViewportSize({width,height:900});expect(await page.locator('#sidebar').evaluate(node=>node.offsetWidth)).toBe(68);expect(await page.locator('.shell').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      await page.getByRole('button',{name:'Open browser panel',exact:true}).click();
      expect(await page.locator('#browser-panel').evaluate(node=>node.inert)).toBe(false);
      expect(await page.locator('#browser-toggle').getAttribute('aria-expanded')).toBe('true');
      expect(await page.locator('#browser-close').evaluate(node=>node===document.activeElement)).toBe(true);
      expect(await page.locator('#sidebar').evaluate(node=>node.offsetWidth)).toBe(68);
      if(width===1700) { await page.waitForFunction(()=>document.querySelector('#browser-panel').getBoundingClientRect().width===390);await page.screenshot({path:join(artifacts,'panels-open.png')}); }
      await page.keyboard.press('Escape');
      expect(await page.locator('#browser-panel').evaluate(node=>node.inert)).toBe(true);
      expect(await page.locator('#browser-toggle').evaluate(node=>node===document.activeElement)).toBe(true);
      expect(await page.locator('#browser-toggle').getAttribute('aria-expanded')).toBe('false');
      await page.locator('#browser-toggle').click();await page.locator('#browser-close').click();
      expect(await page.locator('#browser-toggle').evaluate(node=>node===document.activeElement)).toBe(true);
    }
    await page.setViewportSize({width:320,height:700});await page.waitForFunction(()=>document.querySelector('#sidebar').inert);expect(await page.locator('#sidebar-toggle').isVisible()).toBe(false);expect(await page.locator('#sidebar').evaluate(node=>node.inert)).toBe(true);
    await page.getByRole('button',{name:'Open navigation',exact:true}).click();expect(await page.locator('#sidebar').evaluate(node=>node.offsetWidth)).toBe(260);expect(await page.locator('.navigation .sidebar-label').first().isVisible()).toBe(true);
    await page.getByRole('button',{name:'Task runs',exact:true}).click();expect(await page.locator('#sidebar').evaluate(node=>node.inert)).toBe(true);
    await page.setViewportSize({width:1440,height:900});await page.waitForFunction(()=>!document.querySelector('#sidebar').inert);await page.getByRole('button',{name:'Expand sidebar',exact:true}).focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().width===232);
    expect(await page.locator('#sidebar').evaluate(node=>node.offsetWidth)).toBe(232);expect(await page.locator('.agent-menu').first().isVisible()).toBe(true);
    await page.reload();expect(await page.locator('#sidebar').evaluate(node=>node.offsetWidth)).toBe(232);
    for(const height of [900,600]) {
      await page.setViewportSize({width:1440,height});
      const settings=await page.locator('#settings-open').boundingBox();expect(settings.y).toBeGreaterThan(0);expect(settings.y+settings.height).toBeLessThanOrEqual(height);
      expect(await page.locator('#history').evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(true);
      await page.locator('#history').evaluate(node=>node.scrollTop=node.scrollHeight);
      expect((await page.locator('#settings-open').boundingBox()).y).toBe(settings.y);
      await page.locator('#settings-open').click();await page.getByRole('button',{name:'Close settings'}).click();
    }
    await page.setViewportSize({width:320,height:700});await page.locator('#menu-button').click();
    const settings=await page.locator('#settings-open').boundingBox();expect(settings.y+settings.height).toBeLessThanOrEqual(700);
    expect(await page.locator('#history').evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(true);
    await page.locator('#settings-open').click();await page.getByRole('button',{name:'Close settings'}).click();
    await page.setViewportSize({width:1440,height:900});await page.screenshot({path:join(artifacts,'sidebar-expanded.png')});
    expect(errors).toEqual([]);
  }finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30_000);
