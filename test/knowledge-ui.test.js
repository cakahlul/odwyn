import {newPageWithoutTutorials} from '../tests/browser-page.js';
import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {defaults} from '../public/profile.js';

test('Knowledge settings create, edit, assign and delete documents through the browser',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-knowledge-ui-')),password='test-password-long-enough';
 const codex=Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}});let app;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
 app=createApp({directory,user:'owner',password,origin:server.url.origin,providerOptions:{codex},browser:{close:async()=>{}}});
 const spaces=[app.runtime.store.security.createSpace({name:'Grooming'}),app.runtime.store.security.createSpace({name:'Execution'})],agent=app.runtime.state.agents[0];
 app.runtime.state.globalProvider.configured=true;agent.provider.configured=true;app.runtime.state.customization=agent.customization={...defaults,name:'Knowledge tester'};app.runtime.changed();
 const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'owner',password},viewport:{width:1000,height:700}}),page=await newPageWithoutTutorials(context),errors=[];
 page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
 const settings=async()=>{await page.locator('#settings-open').click();await page.locator('[data-settings-section=knowledge]').click();await page.locator('#knowledge-new:not([disabled])').waitFor();};
 const finished=()=>page.waitForFunction(()=>document.querySelector('#knowledge-status').textContent!=='Working…');
 try{
  await page.goto(server.url.href);await settings();expect(await page.locator('#preferences-form > .form-footer').isVisible()).toBe(false);
  expect(await page.locator('#workspace-knowledge-description').textContent()).toContain('No knowledge yet');
  await page.locator('#knowledge-new').click();await page.locator('#knowledge-save').click();await finished();expect(await page.locator('#toast').textContent()).toBe('Enter a knowledge name.');
  await page.locator('#knowledge-name').fill('API <standards>');await page.locator('#knowledge-save').click();await finished();expect(await page.locator('#toast').textContent()).toBe('Enter knowledge content.');
  await page.locator('#knowledge-content').fill('Use versioned API contracts.');await page.locator('#knowledge-save').click();await finished();expect(await page.locator('#toast').textContent()).toBe('Select at least one Space.');
  await page.locator('#knowledge-summary').fill('Shared API guidance');for(const space of spaces)await page.locator(`[data-knowledge-space="${space.id}"]`).check();
  await page.locator('#knowledge-save').click();await page.locator('#knowledge-editor').waitFor({state:'hidden'});await finished();
  expect(app.runtime.state.knowledge).toHaveLength(1);const doc=app.runtime.state.knowledge[0];expect(doc.version).toBe(1);expect(doc.resources.map(resource=>resource.spaceId).sort()).toEqual(spaces.map(space=>space.id).sort());
  expect(await page.locator('#workspace-knowledge option').textContent()).toBe('API <standards>');expect(await page.locator('#workspace-knowledge-description').textContent()).toContain('Grooming');
  await page.locator('#knowledge-edit').click();await page.screenshot({path:join(import.meta.dir,'../artifacts/knowledge-settings-desktop.png')});for(const space of spaces){const choice=page.locator(`[data-knowledge-space="${space.id}"]`);expect(await choice.isChecked()).toBe(true);expect(await choice.isDisabled()).toBe(true);}
  await page.locator('#knowledge-save').click();await page.locator('#knowledge-editor').waitFor({state:'hidden'});await finished();expect(await page.locator('#toast').textContent()).toContain('No changes');expect(app.runtime.state.knowledge[0].version).toBe(1);
  await page.locator('#knowledge-edit').click();await page.locator('#knowledge-content').fill('Use versioned API contracts and stable response schemas.');await page.locator('#knowledge-save').click();await page.locator('#knowledge-editor').waitFor({state:'hidden'});await finished();expect(app.runtime.state.knowledge[0].version).toBe(2);expect(await page.locator('#workspace-knowledge-description').textContent()).toContain('Version 2');expect(await page.locator('#toast').textContent()).toContain('Read grants were revoked');
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await page.evaluate(async()=>{const {openCustomization}=await import('/customize.js');openCustomization();});
  expect(await page.locator('#agent-knowledge-options strong').textContent()).toBe('API <standards>');await page.locator(`#agent-knowledge-options input[value="${doc.id}"]`).check();await page.locator('#customize-save').click();await page.locator('#customize-dialog').waitFor({state:'hidden'});expect(agent.customization.knowledgeIds).toEqual([doc.id]);
  await page.reload();await page.evaluate(async()=>{const {openCustomization}=await import('/customize.js');openCustomization();});expect(await page.locator(`#agent-knowledge-options input[value="${doc.id}"]`).isChecked()).toBe(true);await page.locator('#customize-cancel').click();
  for(const width of [320,768,1024,1440]){
   await page.setViewportSize({width,height:width===320?568:800});await settings();
   const dialog=page.locator('#settings-dialog'),scroll=page.locator('.settings-scroll');
   expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
   expect(await scroll.evaluate(node=>node.clientHeight)).toBeGreaterThanOrEqual(180);
   await page.locator('#knowledge-edit').focus();await page.locator('#knowledge-edit').press('Enter');await page.locator('#knowledge-editor').waitFor({state:'visible'});
   expect(await scroll.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
   await page.locator('#knowledge-save').scrollIntoViewIfNeeded();
   const button=await page.locator('#knowledge-save').boundingBox(),viewport=await scroll.boundingBox();
   expect(button.y).toBeGreaterThanOrEqual(viewport.y);expect(button.y+button.height).toBeLessThanOrEqual(viewport.y+viewport.height+1);
   if(width===320||width===1440)await page.screenshot({path:join(import.meta.dir,`../artifacts/knowledge-settings-${width===320?'mobile':'desktop'}.png`)});
   await page.locator('#knowledge-cancel').click();
   if(width!==1440)await page.getByRole('button',{name:'Close settings',exact:true}).click();
  }
  page.once('dialog',dialog=>dialog.dismiss());await page.locator('#knowledge-delete').click();await finished();expect(app.runtime.state.knowledge).toHaveLength(1);expect(await page.locator('#toast').textContent()).toBe('Deletion cancelled.');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#knowledge-delete').click();await finished();expect(app.runtime.state.knowledge).toHaveLength(0);expect(agent.customization.knowledgeIds).toEqual([]);expect(app.runtime.state.customization.knowledgeIds).toEqual([]);expect(await page.locator('#knowledge-edit').isDisabled()).toBe(true);
  await page.getByRole('button',{name:'Close settings',exact:true}).click();await page.evaluate(async()=>{const {openCustomization}=await import('/customize.js');openCustomization();});expect(await page.locator('#agent-knowledge-options input').count()).toBe(0);expect(errors).toEqual([]);
 }finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30000);
