import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {defaults} from '../public/profile.js';
import {newPageWithoutTutorials} from '../tests/browser-page.js';

test('mobile shell keeps conversations, actions and sheets within thumb reach',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-mobile-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex:Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}}),browser:{close:async()=>{}}});
  app.runtime.state.customization={...defaults,name:'Odwyn'};app.runtime.state.globalProvider.configured=true;app.runtime.state.agents[0].provider.configured=true;app.runtime.changed();
  const browser=await chromium.launch(),page=await newPageWithoutTutorials(browser,{httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const artifacts=join(import.meta.dir,'../artifacts');mkdirSync(artifacts,{recursive:true});
  try {
    await page.goto(server.url.href);await page.locator('.home .home-agent').waitFor();
    await page.screenshot({path:join(artifacts,'mobile-home.png'),animations:'disabled'});
    await page.locator('.home .home-agent').first().tap();await page.locator('#prompt').waitFor({state:'visible'});
    for(const width of [320,390,760]) {
      await page.setViewportSize({width,height:844});
      expect(await page.locator('#view').evaluate(node=>node.getBoundingClientRect().left)).toBe(0);
      expect(await page.locator('.shell').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      expect(await page.locator('.workspace-dock').evaluate(node=>node.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(843);
      await page.locator('#prompt').fill('Plan a quiet weekend.\nInclude the train journey.');
      await page.locator('#conversation-menu-open').tap();
      for(const id of ['search-open','new-room-top','reply-agent','minimize-agent','close-conversation','browser-toggle','oddy-open']) expect(await page.locator('#'+id).isVisible()).toBe(true);
      await page.locator('#conversation-menu-open').tap();
      await page.locator('#browser-toggle').tap();
      expect(await page.locator('#conversation-menu').evaluate(node=>node.matches(':popover-open'))).toBe(false);
      await page.locator('#browser-close').tap();
      expect(await page.locator('#browser-toggle').evaluate(node=>node===document.activeElement)).toBe(true);
      expect(await page.locator('#prompt').inputValue()).toContain('quiet weekend');
      await page.locator('#agents-open').tap();
      await page.waitForFunction(()=>Math.abs(document.querySelector('#agents-dialog').getBoundingClientRect().bottom-innerHeight)<.1);
      expect(await page.locator('#agents-dialog').evaluate(node=>Math.round(node.getBoundingClientRect().bottom))).toBe(844);
      expect(await page.locator('#agents-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      await page.getByRole('button',{name:'Close agents',exact:true}).tap();
      for(const id of ['new-chat','conversation-menu-open']) expect(await page.locator('#'+id).evaluate(node=>{const box=node.getBoundingClientRect();return box.width>=44 && box.left>=0 && box.right<=innerWidth && node.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));})).toBe(true);
      await page.screenshot({path:join(artifacts,`mobile-chat-${width}.png`),animations:'disabled'});
    }
    await page.setViewportSize({width:390,height:480});
    await page.locator('#prompt').focus();
    expect(await page.locator('#composer').evaluate(node=>node.getBoundingClientRect().bottom<=innerHeight)).toBe(true);
    await page.setViewportSize({width:1024,height:800});
    expect(await page.locator('#conversation-menu').getAttribute('popover')).toBe('auto');
    expect(await page.locator('#browser-toggle').isVisible()).toBe(true);
    expect(errors).toEqual([]);
  } finally {await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30000);
