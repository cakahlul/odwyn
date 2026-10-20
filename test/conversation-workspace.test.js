import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {defaults} from '../public/profile.js';
import {newPageWithoutTutorials} from '../tests/browser-page.js';

test('persistent roster restores drafts, updates previews and keeps menus keyboard accessible',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-workspace-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex:Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}}),browser:{close:async()=>{}}});
  const state=app.runtime.state,first=state.agents[0].id,at=new Date().toISOString();
  state.customization={...defaults};state.globalProvider.configured=true;state.agents[0].provider.configured=true;
  state.agents.push({id:'rei',customization:{...defaults,name:'Rei',bodyColor:'#668ad6',specialization:'Research and careful comparisons'},provider:{...state.provider,configured:false}});
  state.conversations=[{id:'trip',agentId:first,title:'A quieter weekend',createdAt:at,spaceId:app.runtime.store.security.legacySpaceId,messages:[{id:'user',role:'user',text:'Find a quiet place near the coast for the weekend.',at},{id:'reply',role:'assistant',agentId:first,text:'I can help narrow it down. How far would you like to travel, and will you be taking the train?',at}]}];
  state.conversations.push({id:'research',agentId:'rei',title:'Train routes',createdAt:at,spaceId:app.runtime.store.security.legacySpaceId,messages:[{id:'research-result',role:'assistant',agentId:'rei',text:'Two direct trains run each morning.',at}]});
  app.runtime.changed();
  const browser=await chromium.launch(),page=await newPageWithoutTutorials(browser,{httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:960}});
  page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const artifacts=join(import.meta.dir,'../artifacts');mkdirSync(artifacts,{recursive:true});
  try {
    const css=await page.request.get(server.url.href+'workspace.css');expect(css.ok()).toBe(true);expect(css.headers()['content-type']).toContain('text/css');
    await page.goto(server.url.href+'#chat/trip');await page.locator('.message-assistant').waitFor();
    expect(await page.locator('#agent-roster .roster-item').count()).toBe(2);
    expect(await page.locator(`#agent-roster [data-agent="${first}"]`).getAttribute('aria-pressed')).toBe('true');
    expect(await page.locator('#agent-workspace').evaluate(node=>node.getBoundingClientRect().left)).toBeGreaterThan(200);
    await page.locator('#prompt').fill('No more than two hours by train.');
    expect(await page.locator('#prompt').evaluate(node=>getComputedStyle(node).color)).toBe('rgba(0, 0, 0, 0)');
    expect(await page.locator('#prompt').evaluate(node=>getComputedStyle(node).padding)).toBe(await page.locator('#prompt-highlights').evaluate(node=>getComputedStyle(node).padding));
    await page.locator('#agent-roster [data-agent=rei]').click();await page.waitForFunction(()=>document.querySelector('#agent-name').textContent==='Rei' && !document.querySelector('#agent-workspace').inert);
    await page.locator('.message-assistant').filter({hasText:'Two direct trains'}).waitFor();
    await page.locator('#prompt').fill('Compare the local train routes.');
    await page.locator(`#agent-roster [data-agent="${first}"]`).click();await page.waitForFunction(()=>document.querySelector('#prompt').value==='No more than two hours by train.' && !document.querySelector('#agent-workspace').inert);
    await page.locator('#agent-roster [data-agent=rei]').focus();
    state.conversations[1].messages[0].text='Research, with sources';app.runtime.changed();
    await page.locator('#agent-roster [data-agent=rei]').filter({hasText:'Research, with sources'}).waitFor();
    expect(await page.locator('#agent-roster [data-agent=rei]').evaluate(node=>node===document.activeElement)).toBe(true);
    await page.screenshot({path:join(artifacts,'conversation-workspace-desktop.png'),animations:'disabled'});
    await page.locator('#conversation-menu-open').focus();await page.keyboard.press('Enter');
    expect(await page.locator('#new-room-top').isVisible()).toBe(true);
    await page.keyboard.press('Escape');expect(await page.locator('#conversation-menu-open').evaluate(node=>node===document.activeElement)).toBe(true);
    await page.locator('#browser-toggle').click();await page.locator('#browser-panel').waitFor({state:'visible'});
    await page.screenshot({path:join(artifacts,'conversation-workspace-computer.png'),animations:'disabled'});
    await page.locator('#browser-close').click();expect(await page.locator('#browser-toggle').evaluate(node=>node===document.activeElement)).toBe(true);
    for(const section of ['tools','settings','agents']) {
      await page.locator('#'+section+'-open').click();await page.locator('#'+section+'-dialog').waitFor({state:'visible'});
      expect(await page.locator('#'+section+'-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      if(section==='settings') {
        for(const selector of ['#preferences-form > .form-footer .primary-button','#settings-palette-choices .palette-option','.navigation-choice label']) {
          const material=await page.locator(selector).first().evaluate(node=>({image:getComputedStyle(node).backgroundImage,shadow:getComputedStyle(node).boxShadow}));
          expect(material.image).toBe('none');expect(material.shadow).toBe('none');
        }
        const summary=page.locator('#settings-dialog details>summary').first();
        if(await summary.count()) {expect(await summary.evaluate(node=>getComputedStyle(node).listStyleType)).toBe('none');await summary.focus();await page.keyboard.press('Enter');expect(await summary.evaluate(node=>node.parentElement.open)).toBe(true);expect(await summary.evaluate(node=>getComputedStyle(node,'::after').content)).toBe('"−"');}
      }
      if(section==='settings') await page.locator('.settings-scroll').evaluate(node=>node.scrollTop=0);
      await page.screenshot({path:join(artifacts,'conversation-workspace-'+section+'.png'),animations:'disabled'});await page.keyboard.press('Escape');
    }
    state.appearance={...state.appearance,palette:'graphite',motion:'reduced'};app.runtime.changed();
    await page.waitForFunction(()=>document.documentElement.dataset.scheme==='dark');
    await page.screenshot({path:join(artifacts,'conversation-workspace-dark.png'),animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    expect(await page.locator('.agent-rail').isVisible()).toBe(false);
    expect(await page.locator('.shell').evaluate(node=>node.scrollWidth===node.clientWidth)).toBe(true);
    await page.screenshot({path:join(artifacts,'conversation-workspace-mobile.png'),animations:'disabled'});
    await page.locator('.mobile-back').click();await page.locator('.home').waitFor();
    expect(await page.locator('.home .roster-copy').first().isVisible()).toBe(true);
    expect(await page.locator('.dock-tooltip').first().isVisible()).toBe(true);
    expect(errors).toEqual([]);
  }finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30000);
