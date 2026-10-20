import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {FixtureProvider} from '../tests/security/fixtures.js';
import {defaults} from '../public/profile.js';

test('tutorials guide first visits, replay, persist, hide, reset and fit mobile',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-tutorials-')),password='tutorial-test-password';let app,browser;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
 try{
  app=createApp({directory,user:'owner',password,origin:server.url.origin,codex:new FixtureProvider(),browser:{close:async()=>{}}});
  const store=app.runtime.store;store.state.customization=store.state.agents[0].customization={...defaults,name:'Guide tester'};store.state.globalProvider.configured=true;store.state.agents[0].provider.configured=true;
  browser=await chromium.launch({headless:true});const context=await browser.newContext({httpCredentials:{username:'owner',password},viewport:{width:1024,height:800}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const card=page.locator('#tutorial-card'),skip=async()=>{await page.locator('#tutorial-skip').click();await expectHidden();},expectHidden=async()=>expect(await card.isVisible()).toBe(false);
  await page.goto(server.url.href);await card.waitFor();expect(await card.textContent()).toContain('Home');
  await page.locator('#tutorial-next').click();expect(await page.locator('#tutorial-progress').textContent()).toContain('2 /');await page.locator('#tutorial-back').click();expect(await page.locator('#tutorial-progress').textContent()).toContain('1 /');
  await page.keyboard.press('Escape');await expectHidden();await page.reload();await page.locator('#view h1').first().waitFor();await expectHidden();
  await page.locator('#main-tutorial').click();await card.waitFor();await skip();
  await page.locator('#settings-open').click();await card.waitFor();await skip();
  await page.locator('[data-settings-section=tutorials]').click();await card.waitFor();await skip();
  await page.locator('#tutorial-hide').check();await page.reload();await page.locator('#view h1').first().waitFor();await expectHidden();
  await page.locator('#agents-open').click();await page.locator('#agents-dialog[open]').waitFor();await expectHidden();
  await page.locator('#agents-dialog .tutorial-replay').click();await card.waitFor();await skip();await page.getByRole('button',{name:'Close agents',exact:true}).click();
  await page.locator('#settings-open').click();await page.locator('[data-settings-section=tutorials]').click();expect(await page.locator('#tutorial-hide').isChecked()).toBe(true);
  await page.locator('#tutorial-reset').click();expect(await page.locator('#tutorial-settings-status').textContent()).toContain('reset');await expectHidden();
  await page.locator('#tutorial-hide').uncheck();await page.locator('[data-settings-section=resources]').click();await card.waitFor();await skip();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();await page.locator('#agents-open').click();await card.waitFor();await skip();
  await page.locator('.agent-menu summary').first().click();await page.locator('[data-agent-action=customize]').first().click();await card.waitFor();await skip();
  await page.locator('#agent-access-tab').click();await card.waitFor();expect(await card.textContent()).toContain('Spaces');
  const before=store.security.access(store.state.agents[0].id);
  for(const width of [320,768,1440]){
   await page.setViewportSize({width,height:600});await page.locator('#tutorial-next').click();
   const bounds=await card.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);expect(bounds.y+bounds.height).toBeLessThanOrEqual(600);
  }
  while(await card.isVisible())await page.locator('#tutorial-next').click();
  expect(store.security.access(store.state.agents[0].id)).toEqual(before);expect(errors).toEqual([]);
 }finally{await browser?.close();await app?.close();server.stop(true);rmSync(directory,{recursive:true,force:true});}
},60000);
