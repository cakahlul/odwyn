import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { defaults } from '../public/profile.js';

test('minimized agents float as staggered circles, preserve dragging, and respect reduced motion', async () => {
  const directory=mkdtempSync(join(tmpdir(),'odwyn-bubbles-'));
  const codex=Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}});
  let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex,browser:{close:async()=>{}}});
  app.runtime.state.customization={...defaults,name:'Oddy',bodyColor:'#81ae76'};app.runtime.state.provider.configured=true;app.runtime.state.globalProvider.configured=true;
  app.runtime.state.appearance={palette:'harbor',motion:'system'};
  for (const [index,name] of ['Rei','Kai','Eve','Momo'].entries()) app.runtime.state.agents.push({id:'agent-'+index,customization:{...defaults,name,bodyColor:['#658bbd','#b8d7ec','#d98bab','#d6a77e'][index],shape:['orb','robot','cat','bean'][index]},provider:{...app.runtime.state.provider}});
  app.runtime.changed();
  const browser=await chromium.launch(), context=await browser.newContext({httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:900}});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000);
  try {
    await page.goto(server.url.href);
    expect(await page.locator('.sidebar-agent .agent-avatar').first().evaluate(node=>getComputedStyle(node).animationName)).toBe('agent-breathe');
    await page.locator('[data-mascot-toggle]').click();
    expect(await page.locator('.sidebar-agent .agent-avatar').first().evaluate(node=>getComputedStyle(node).animationPlayState)).toBe('paused');
    await page.locator('[data-mascot-toggle]').click();await page.locator('#minimize-agent').click();
    await page.getByRole('heading',{name:'Your agents are minimized'}).waitFor();
    const slots=page.locator('.agent-slot');expect(await slots.count()).toBe(5);
    const boxes=await slots.evaluateAll(nodes=>nodes.map(node=>({x:node.offsetLeft,y:node.offsetTop,width:node.offsetWidth,height:node.offsetHeight})));
    expect(new Set(boxes.map(box=>box.x)).size).toBe(5);expect(new Set(boxes.map(box=>box.y)).size).toBe(5);
    for (const box of boxes) {expect(box.x).toBeGreaterThan(1440-260);expect(box.x+box.width).toBeLessThanOrEqual(1440);expect(box.y+box.height).toBeLessThanOrEqual(900);}
    expect(await page.locator('.bubble-avatar').first().evaluate(node=>[node.offsetWidth,node.offsetHeight,getComputedStyle(node).borderRadius])).toEqual([64,64,'50%']);
    expect(await page.locator('.bubble-avatar').first().evaluate(node=>getComputedStyle(node).animationName)).toBe('agent-float');
    expect(await page.locator('#main').evaluate(node=>getComputedStyle(node).paddingBottom)).toBe('0px');
    const artifacts=resolve(import.meta.dir,'../artifacts');mkdirSync(artifacts,{recursive:true});
    await page.screenshot({path:join(artifacts,'floating-agents-desktop.png'),fullPage:true});
    const bubble=slots.first(),id=await bubble.getAttribute('data-bubble');
    const avatar=await bubble.locator('.bubble-avatar').boundingBox(),before=await bubble.boundingBox();
    await page.mouse.move(avatar.x+24,avatar.y+32);await page.mouse.down();await page.mouse.move(avatar.x-96,avatar.y-88,{steps:8});await page.mouse.up();
    const moved=await bubble.boundingBox();expect(moved.x).toBeLessThan(before.x-100);expect(moved.y).toBeLessThan(before.y-100);
    expect(await page.getByRole('heading',{name:'Your agents are minimized'}).isVisible()).toBe(true);
    await bubble.locator('.bubble-restore').focus();await page.keyboard.press('Alt+ArrowUp');
    expect((await bubble.boundingBox()).y).toBeLessThanOrEqual(moved.y-23);
    const saved=await page.evaluate(id=>JSON.parse(localStorage.getItem('odwyn-bubble-positions'))[id],id);
    await page.reload();await page.locator(`[data-bubble="${id}"]`).waitFor();
    expect(await page.evaluate(id=>JSON.parse(localStorage.getItem('odwyn-bubble-positions'))[id],id)).toEqual(saved);
    await page.emulateMedia({reducedMotion:'reduce'});
    expect(await page.locator('.sidebar-agent .agent-avatar').first().evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
    await page.locator('#new-chat').hover();expect(await page.locator('#new-chat').evaluate(node=>getComputedStyle(node).transform)).toBe('none');
    expect(await page.locator('.bubble-avatar').first().evaluate(node=>getComputedStyle(node).animationName)).toBe('none');
    for (const width of [320,768,1024]) {
      await page.setViewportSize({width,height:700});
      await page.waitForFunction(()=>[...document.querySelectorAll('.agent-slot')].every(node=>node.offsetLeft+node.offsetWidth<=innerWidth && node.offsetTop+node.offsetHeight<=innerHeight));
      for (const box of await slots.evaluateAll(nodes=>nodes.map(node=>({x:node.offsetLeft,y:node.offsetTop,width:node.offsetWidth,height:node.offsetHeight})))) {expect(box.x).toBeGreaterThanOrEqual(8);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y).toBeGreaterThanOrEqual(8);expect(box.y+box.height).toBeLessThanOrEqual(700);}
      if(width===320) await page.screenshot({path:join(artifacts,'floating-agents-mobile.png'),fullPage:true});
    }
    await page.locator(`[data-agent="${id}"]`).click();await page.getByRole('heading',{name:'Your agents are minimized'}).waitFor({state:'hidden'});
    expect(await slots.count()).toBe(4);
    const closedId=await slots.first().getAttribute('data-bubble');await page.locator(`[data-close-agent="${closedId}"]`).click();
    expect(await page.locator(`[data-bubble="${closedId}"]`).count()).toBe(0);
    expect(await page.locator(`[data-select-agent="${closedId}"]`).count()).toBe(1);
    expect(errors).toEqual([]);
  } finally {await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30_000);
