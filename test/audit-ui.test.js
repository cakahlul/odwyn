import {test,expect} from 'bun:test';
import {chromium} from 'playwright';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createApp} from '../server.js';
import {createJob} from '../store.js';
import {FixtureProvider} from '../tests/provider.js';
import {newPageWithoutTutorials} from '../tests/browser-page.js';
import {defaults} from '../public/profile.js';

test('Tools audit filters, pages, shows duration and activity on desktop and mobile',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-audit-ui-'));let app;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
 app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex:new FixtureProvider(),browser:{close:async()=>{}}});
 const state=app.runtime.state;state.customization={...defaults,name:'Audited agent'};state.agents[0].customization=state.customization;state.globalProvider.configured=true;
 for(let i=0;i<23;i++){const job=createJob(state,{prompt:'Audit task '+i});job.status='completed';job.providerSnapshot={type:'codex',model:'gpt-6.1-sol'};job.usage={inputTokens:1000,outputTokens:100,cachedInputTokens:200,cacheWriteTokens:0};job.createdAt=job.startedAt='2026-01-01T00:00:00.000Z';job.endedAt='2026-01-01T00:00:05.000Z';job.events.push({id:crypto.randomUUID(),at:job.endedAt,label:'Finished',detail:'Done safely'});}
 app.runtime.changed();
 const browser=await chromium.launch(),page=await newPageWithoutTutorials(browser,{httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:960}}),errors=[];page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(server.url.href);await page.locator('#tools-open').click();await page.getByRole('button',{name:'Audit log',exact:true}).click();
  await page.getByText('23 tasks',{exact:true}).waitFor();expect(await page.locator('#audit-results .audit-entry').count()).toBe(20);
  expect(await page.locator('#audit-results').textContent()).toContain('Duration: 5s');expect(await page.locator('#audit-results').textContent()).toContain('$0.002620 estimated API equivalent');
  await page.locator('[data-audit-page="2"]').click();await page.waitForFunction(()=>document.querySelectorAll('#audit-results .audit-entry').length===3);
  await page.locator('[data-audit-id]').first().click();await page.getByText('Done safely',{exact:true}).waitFor();expect(await page.getByRole('link',{name:'Official pricing'}).getAttribute('href')).toBe('https://developers.openai.com/api/docs/pricing');expect(await page.locator('#audit-detail').textContent()).toContain('verified 2026-10-20');
  await page.locator('[name=from]').fill('2027-01-01T00:00');await page.getByRole('button',{name:'Apply',exact:true}).click();await page.getByText('No activity matches these filters.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Clear',exact:true}).click();await page.getByText('23 tasks',{exact:true}).waitFor();
  await page.setViewportSize({width:360,height:800});expect(await page.locator('.audit-page').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  const artifacts=resolve(import.meta.dir,'../artifacts/ui/audit');mkdirSync(artifacts,{recursive:true});await page.screenshot({path:join(artifacts,'mobile.png')});expect(errors).toEqual([]);
 }finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},20000);
