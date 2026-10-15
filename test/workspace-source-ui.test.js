import {test,expect} from 'bun:test';
import {chromium} from 'playwright';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.js';
import {defaults} from '../public/profile.js';

test('workspace resource source folder can be checked, created, edited and rejected through settings',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-source-ui-')),sourceRoot=join(directory,'sources'),password='test-password-long-enough';
 mkdirSync(join(sourceRoot,'project'),{recursive:true});writeFileSync(join(sourceRoot,'project','main.js'),'console.log("project");');
 const codex=Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}});let app;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
 app=createApp({directory,user:'owner',password,origin:server.url.origin,providerOptions:{codex},browser:{close:async()=>{}},execution:{snapshotRoot:sourceRoot}});
 app.runtime.store.security.createSpace({name:'Execution'});app.runtime.state.globalProvider.configured=true;app.runtime.state.agents[0].provider.configured=true;app.runtime.state.customization=app.runtime.state.agents[0].customization={...defaults,name:'Source tester'};app.runtime.changed();
 const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'owner',password}}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(server.url.href);await page.locator('#settings-open').click();await page.locator('[data-settings-section=resources]').click();
  await page.locator('[data-manage-new=resources]:not([disabled])').click();await page.locator('#workspace-resource-name').fill('Project development');await page.locator('#workspace-resource-type').selectOption('workspace');
  expect(await page.locator('#workspace-resource-source').isVisible()).toBe(true);expect(await page.locator('#workspace-source-help').textContent()).toContain(sourceRoot);
  const help=await page.locator('[data-workspace-field=source]').textContent();for(const text of ['never mounted live','16 MiB','4,096','no internet','browser computer','checkpoints'])expect(help).toContain(text);
  await page.locator('#workspace-resource-source').fill('project');await page.locator('#workspace-source-check').click();await page.waitForFunction(()=>document.querySelector('#workspace-source-status').textContent.includes('Folder exists:'));
  await page.locator('#workspace-resource-source').fill('../outside');await page.locator('#workspace-source-check').click();await page.waitForFunction(()=>document.querySelector('#workspace-management-status').textContent!=='Working…');
  expect(await page.locator('#workspace-management-status').textContent()).not.toBe('');
  await page.locator('#workspace-resource-source').fill('new-project');await page.locator('#workspace-source-check').click();await page.waitForFunction(()=>document.querySelector('#workspace-source-status').textContent.includes('does not exist'));expect(existsSync(join(sourceRoot,'new-project'))).toBe(false);
  await page.locator('[data-manage-save=resources]').click();await page.locator('#workspace-resources-editor').waitFor({state:'hidden'});expect(existsSync(join(sourceRoot,'new-project'))).toBe(true);
  await page.waitForFunction(()=>document.querySelector('#workspace-management-status').textContent.includes('Empty'));expect(await page.locator('#workspace-management-status').textContent()).toContain('unavailable');
  await page.locator('[data-manage-edit=resources]').click();expect(await page.locator('#workspace-resource-source').inputValue()).toBe('new-project');
  mkdirSync(join(sourceRoot,'project','node_modules'),{recursive:true});writeFileSync(join(sourceRoot,'project','node_modules','dependency.js'),'not source');writeFileSync(join(sourceRoot,'project','.env'),'PRIVATE=excluded');
  await page.locator('#workspace-source-files').setInputFiles(join(sourceRoot,'project'));await page.locator('#workspace-source-import').click();await page.waitForFunction(()=>document.querySelector('#workspace-source-status').textContent.includes('Imported 1 files'));expect(readFileSync(join(sourceRoot,'new-project','main.js'),'utf8')).toContain('project');expect(await page.locator('#workspace-source-status').textContent()).toContain('Skipped 2 excluded files');expect(existsSync(join(sourceRoot,'new-project','.env'))).toBe(false);expect(existsSync(join(sourceRoot,'new-project','node_modules'))).toBe(false);
  await page.locator('#workspace-source-files').setInputFiles(join(sourceRoot,'project'));await page.locator('#workspace-source-import').click();await page.waitForFunction(()=>document.querySelector('#workspace-management-status').textContent!=='Working…');expect(await page.locator('#workspace-management-status').textContent()).not.toBe('');await page.locator('[data-manage-cancel=resources]').click();
  await page.locator('[data-manage-new=resources]').click();await page.locator('#workspace-resource-name').fill('References');await page.locator('#workspace-resource-type').selectOption('workspace');await page.locator('#workspace-resource-source').fill('must-not-submit');await page.locator('#workspace-resource-type').selectOption('browser');
  expect(await page.locator('#workspace-resource-source').isVisible()).toBe(false);expect(await page.locator('#workspace-resource-source').isDisabled()).toBe(true);
  const request=page.waitForRequest(req=>new URL(req.url()).pathname==='/api/resources'&&req.method()==='POST');await page.locator('[data-manage-save=resources]').click();const body=(await request).postDataJSON();expect(body.metadata.sourceFolder).toBeUndefined();await page.locator('#workspace-resources-editor').waitFor({state:'hidden'});
  await page.locator('[data-manage-new=resources]').click();await page.locator('#workspace-resource-name').fill('Empty development');await page.locator('#workspace-resource-type').selectOption('workspace');
  const saved=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/resources'&&response.request().method()==='POST');await page.locator('[data-manage-save=resources]').click();const empty=await (await saved).json();expect(empty.workspaceSource.empty).toBe(true);expect(existsSync(empty.workspaceSource.path)).toBe(true);await page.locator('#workspace-resources-editor').waitFor({state:'hidden'});
  expect(errors).toEqual([]);
 }finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30000);
