import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {newPageWithoutTutorials} from '../tests/browser-page.js';

test('agent history searches only that agent and opens current or latest activity',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-history-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex:Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}}),browser:{close:async()=>{}}});
  const state=app.runtime.state,id=state.agents[0].id;
  state.globalProvider.configured=true;state.agents[0].provider.configured=true;
  const chat=(id,agentId,title,at,text='')=>({id,agentId,title,createdAt:at,messages:text?[{id:id+'-message',role:'user',text,at}]:[]});
  state.conversations=[chat('older',id,'Older chat','2026-01-01T00:00:00Z','needle'),{...chat('latest',id,'Latest activity','2025-01-01T00:00:00Z'),messages:[{id:'new-message',role:'user',text:'Recent work',at:'2026-02-01T00:00:00Z'}]},chat('foreign','other','Foreign needle','2026-03-01T00:00:00Z')];
  app.runtime.changed();
  const browser=await chromium.launch({channel:process.env.ODWYN_TEST_BROWSER_CHANNEL}),page=await newPageWithoutTutorials(browser,{httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:960}});
  page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.goto(server.url.href);
    await page.locator('#agent-roster [data-agent]').first().waitFor();
    await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
    await page.locator('#agent-roster [data-agent]').first().click();
    await page.locator('#search-dialog[open]').waitFor();
    expect(await page.locator('#history [data-conversation]').count()).toBe(2);
    expect(await page.locator('#agent-history-latest').getAttribute('data-conversation')).toBe('latest');
    await page.locator('#search-input').fill('needle');
    expect(await page.locator('#search-results [data-conversation]').count()).toBe(1);
    expect(await page.locator('#search-results [data-conversation]').getAttribute('data-conversation')).toBe('older');
    await page.locator('#search-results [data-conversation]').click();
    await page.waitForURL('**/#chat/older');
    await page.locator('#agent-roster [data-agent]').first().click();
    expect(await page.locator('#agent-history-latest').getAttribute('data-conversation')).toBe('older');
    await page.locator('#agent-history-latest').click();
    expect(await page.locator('#search-dialog').evaluate(n=>n.open)).toBe(false);
    await page.locator('#sidebar-collapse').click();
    expect(await page.locator('.rail-search [data-icon]').isVisible()).toBe(true);
    expect(await page.locator('#menu-button .dock-tooltip').isVisible()).toBe(false);
    mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/agent-history-rail.png'});
    expect(errors).toEqual([]);
  } finally {await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},20000);
