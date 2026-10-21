import {newPageWithoutTutorials} from '../tests/browser-page.js';
import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {defaults} from '../public/profile.js';

test('Knowledge tools search, import, paginate, edit, assign and delete documents through the browser',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-knowledge-ui-')),password='test-password-long-enough';
 const codex=Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}});let app;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
 app=createApp({directory,user:'owner',password,origin:server.url.origin,providerOptions:{codex},browser:{close:async()=>{}}});
 const agent=app.runtime.state.agents[0];
 app.runtime.state.globalProvider.configured=true;agent.provider.configured=true;app.runtime.state.customization=agent.customization={...defaults,name:'Knowledge tester'};app.runtime.changed();
 const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'owner',password},viewport:{width:1000,height:700}}),page=await newPageWithoutTutorials(context),errors=[];
 page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
 const tools=async()=>{await page.locator('#tools-open').click();await page.locator('[data-view=knowledge]').click();await page.locator('#knowledge-new').waitFor();};
 try{
  await page.goto(server.url.href);await tools();
  expect(await page.locator('[data-settings-section=knowledge]').count()).toBe(0);
  expect(await page.locator('.library-results').textContent()).toContain('No knowledge yet');
  await page.locator('#knowledge-new').click();
  await page.locator('#knowledge-name').fill('API <standards>');
  await page.locator('#knowledge-content').fill('Use versioned API contracts.');await page.locator('#knowledge-summary').fill('Shared API guidance');
  await page.locator('#knowledge-save').click();await page.locator('#knowledge-editor').waitFor({state:'hidden'});
  expect(app.runtime.state.knowledge).toHaveLength(1);const doc=app.runtime.state.knowledge[0];
  expect(await page.locator('.workflow-row h3').textContent()).toBe('API <standards>');
  await page.locator('[data-knowledge-edit]').click();await page.locator('#knowledge-save').click();await page.locator('#knowledge-editor').waitFor({state:'hidden'});
  expect(doc.version).toBe(1);expect(await page.locator('#toast').textContent()).toContain('No changes');
  await page.locator('[data-knowledge-edit]').click();await page.locator('#knowledge-content').fill('Use versioned API contracts and stable schemas.');await page.locator('#knowledge-save').click();await page.locator('#knowledge-editor').waitFor({state:'hidden'});
  expect(app.runtime.state.knowledge[0].version).toBe(2);
  await page.evaluate(async()=>{const {openCustomization}=await import('/customize.js');openCustomization();});
  await page.locator(`#agent-knowledge-options input[value="${doc.id}"]`).check();await page.locator('#customize-save').click();await page.locator('#customize-dialog').waitFor({state:'hidden'});
  expect(agent.customization.knowledgeIds).toEqual([doc.id]);
  await page.locator('#knowledge-import-file').setInputFiles({name:'Team guide.md',mimeType:'text/markdown',buffer:Buffer.from('# Team guide\n\nKeep contracts stable.')});
  await page.locator('#knowledge-editor[open]').waitFor();expect(await page.locator('#knowledge-name').inputValue()).toBe('Team guide');
  expect(await page.locator('#knowledge-content').inputValue()).toContain('Keep contracts stable');expect(app.runtime.state.knowledge).toHaveLength(1);
  await page.locator('#knowledge-save').click();await page.locator('#knowledge-editor').waitFor({state:'hidden'});expect(app.runtime.state.knowledge).toHaveLength(2);
  await page.locator('#knowledge-import-file').setInputFiles({name:'oversized.txt',mimeType:'text/plain',buffer:Buffer.alloc(80001,65)});
  await page.locator('#toast').filter({hasText:'80 KB'}).waitFor();expect(app.runtime.state.knowledge).toHaveLength(2);
  await page.evaluate(async()=>{const {dismissToast}=await import('/ui.js');dismissToast();});
  for(let i=0;i<10;i++)app.runtime.store.knowledge.create({name:`Reference ${i}`,content:'Searchable guidance'});app.runtime.changed();
  await page.locator('[data-library-page=knowledge][data-page="2"]:not([disabled])').waitFor();
  expect(await page.locator('.workflow-row').count()).toBe(10);
  await page.locator('[data-library-page=knowledge][data-page="2"]').click();expect(await page.locator('.workflow-row').count()).toBe(2);
  await page.locator('#knowledge-search').fill('Shared API');await page.locator('.workflow-row h3').filter({hasText:'API <standards>'}).waitFor();expect(await page.locator('.workflow-row').count()).toBe(1);
  for(const width of [320,768,1440]){
   await page.setViewportSize({width,height:900});
   expect(await page.locator('#view').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
   await page.locator('[data-knowledge-edit]').click();
   expect(await page.locator('#knowledge-editor').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
   await page.screenshot({path:join(import.meta.dir,`../artifacts/knowledge-tools-${width}.png`)});
   const save=await page.locator('#knowledge-save').boundingBox();expect(save.y+save.height).toBeLessThanOrEqual(900);
   await page.locator('#knowledge-cancel').click();
   await page.screenshot({path:join(import.meta.dir,`../artifacts/knowledge-catalog-${width}.png`)});
  }
  await Promise.all([page.waitForEvent('dialog').then(dialog=>dialog.dismiss()),page.locator('[data-knowledge-delete]').click()]);
  expect(app.runtime.state.knowledge.some(row=>row.id===doc.id)).toBe(true);
  await Promise.all([page.waitForEvent('dialog').then(dialog=>dialog.accept()),page.locator('[data-knowledge-delete]').click()]);
  await page.locator('.workflow-row').waitFor({state:'hidden'});expect(agent.customization.knowledgeIds).toEqual([]);
  await page.reload();await page.locator('#view h1').filter({hasText:'Knowledge'}).waitFor();expect(errors).toEqual([]);
 }finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},60000);
