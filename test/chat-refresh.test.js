import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {defaults} from '../public/profile.js';
import {newPageWithoutTutorials} from '../tests/browser-page.js';

test('accepted messages unlock while a stalled workspace refresh recovers without overlapping polls',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-chat-refresh-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  const codex=Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex,browser:{close:async()=>{}}});
  app.runtime.state.customization={...defaults};app.runtime.state.globalProvider.configured=true;app.runtime.changed();
  const browser=await chromium.launch(),page=await newPageWithoutTutorials(browser,{httpCredentials:{username:'owner',password:'test-password-long-enough'}});
  page.setDefaultTimeout(3000);
  let release;const gate=new Promise(resolve=>{release=resolve;});
  try{
    await page.goto(server.url.href+'#chat');await page.locator('#prompt').fill('Persist this message');
    let requests=0;
    await page.route('**/api/state?*',async route=>{requests++;if(requests===1)await gate;await route.continue();});
    await page.locator('#send-button').click();
    await page.waitForFunction(()=>document.querySelector('#prompt').value==='');
    await page.waitForFunction(()=>document.querySelector('#composer').getAttribute('aria-busy')==='false');
    expect(await page.locator('#composer-status').textContent()).toBe('');
    expect(await page.locator('#prompt').evaluate(node=>node.readOnly)).toBe(false);
    await page.waitForTimeout(2200);
    expect(requests).toBe(1);
    expect(app.runtime.state.jobs).toHaveLength(1);
    await page.locator('.message-user').filter({hasText:'Persist this message'}).waitFor({timeout:12_000});
    expect(requests).toBeGreaterThan(1);
    expect(await page.locator('#composer').getAttribute('aria-busy')).toBe('false');
  }finally{release();await browser.close();await app.close();await server.stop(true);rmSync(directory,{recursive:true,force:true});}
},20_000);
