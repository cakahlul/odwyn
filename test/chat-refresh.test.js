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
    for(let i=0;i<120 && requests<2;i++) await Bun.sleep(100);
    expect(requests).toBeGreaterThan(1);
    await page.waitForFunction(()=>!document.querySelector('.working-row')?.textContent.includes('Sending…'));
    expect(await page.locator('#composer').getAttribute('aria-busy')).toBe('false');
  }finally{release();await browser.close();await app.close();await server.stop(true);rmSync(directory,{recursive:true,force:true});}
},20_000);


test('messages appear before sending completes, failures keep drafts, and progress remains available',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-instant-chat-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>app.fetch(req)});
  const codex=Object.assign(new EventEmitter(),{stop(){},request:async method=>method==='account/read' ? {account:{type:'chatgpt'}} : method.startsWith('thread/') ? {thread:{id:'thread-test'}} : {turn:{id:'turn-test'}}});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex,browser:{close:async()=>{}}});
  app.runtime.state.customization={...defaults};app.runtime.state.globalProvider.configured=true;await app.runtime.refreshAccount();
  const browser=await chromium.launch(),page=await newPageWithoutTutorials(browser,{httpCredentials:{username:'owner',password:'test-password-long-enough'}});
  page.setDefaultTimeout(5000);let release;const gate=new Promise(resolve=>{release=resolve;});
  try{
    await page.goto(server.url.href+'#chat');
    await page.route('**/api/jobs',async route=>{await gate;await route.fulfill({status:400,json:{error:'Try again.'}});});
    await page.locator('#prompt').fill('Hello immediately');await page.locator('#send-button').click();
    await page.locator('.message-user').filter({hasText:'Hello immediately'}).waitFor();
    expect(await page.locator('.working-row').textContent()).toContain('Sending…');
    expect(app.runtime.state.jobs).toHaveLength(0);
    expect(await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));return JSON.parse(sessionStorage.getItem('odwyn-drafts'))[0][1].prompt;})).toBe('Hello immediately');
    release();await page.waitForFunction(()=>!document.querySelector('#prompt').readOnly);
    expect(await page.locator('#prompt').inputValue()).toBe('Hello immediately');
    expect(await page.locator('.message-user').count()).toBe(0);
    await page.unroute('**/api/jobs');await page.locator('#send-button').click();
    await page.locator('.working-row strong').filter({hasText:'is typing'}).waitFor();
    expect(await page.locator('.typing-dots i').count()).toBe(3);
    expect(await page.locator('.message-user').count()).toBe(1);
    await page.getByRole('button',{name:'View progress'}).click();
    await page.locator('#activity-content:not([hidden])').waitFor();
    expect(await page.locator('#activity-list').textContent()).toContain('Starting');
    const job=app.runtime.state.jobs[0];app.runtime.finish(job,'completed');
    await page.waitForFunction(()=>!document.querySelector('.typing-dots'));
  }finally{release();await browser.close();await app.close();await server.stop(true);rmSync(directory,{recursive:true,force:true});}
},20_000);
