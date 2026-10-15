import { test } from 'bun:test';
import { chromium } from 'playwright';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { defaults } from '../public/profile.js';

test('room stages reuse room configuration and preserve reviewed output gates without creating rooms',async()=>{
const directory=mkdtempSync(join(tmpdir(),'odwyn-workflow-ui-'));
class Provider extends EventEmitter {
  child={};config={type:'codex',model:'test'};
  async request(method){return method==='account/read' ? {account:{type:'chatgpt'}}:{thread:{id:'test'},turn:{id:'test'}};}
  stop(){} respond(){} reject(){}
}
let app;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>app.fetch(request)});
app=createApp({directory,user:'check',password:'workflow-test-password',origin:server.url.origin,codex:new Provider(),browser:{close:async()=>{},reset:async()=>{}}});
app.runtime.state.customization={...defaults,name:'Test'};
app.runtime.state.globalProvider.configured=true;
app.runtime.state.agents[0].provider.configured=true;
app.runtime.changed();await app.runtime.refreshAccount();
const browser=await chromium.launch();
const context=await browser.newContext({httpCredentials:{username:'check',password:'workflow-test-password'},viewport:{width:1440,height:960}});
const page=await context.newPage(),errors=[];
page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto(server.url.href);
  const headers={authorization:'Basic '+Buffer.from('check:workflow-test-password').toString('base64'),origin:server.url.origin,'content-type':'application/json'};
  const created=await app.fetch(new Request(new URL('/api/agents',server.url),{method:'POST',headers,body:JSON.stringify({...defaults,name:'Reviewer'})}));
  assert.equal(created.status,201);const second=await created.json();
  await page.reload();await page.locator('#tools-open').click();await page.locator('[data-view="workflows"]').click();
  await page.locator('[data-workflow-new]').click();
  await page.locator('.workflow-first-step').click();
  await page.locator('[data-wf-add-type="room"]').click();
  await page.locator('[data-wf-field="step.prompt"]').fill('Prepare a reviewed research brief.');
  await page.locator('[data-wf-room-configure]').click();
  assert.equal(await page.locator('#room-space').isDisabled(),false);
  await page.locator('#room-name').fill('Research review');
  await page.locator(`#room-agent-options input[value="${second.id}"]`).check();
  await page.locator('#room-governance').check();
  await page.locator('#room-owner-approval').check();
  await page.locator('#room-output-add').click();
  await page.locator('#room-output-options input').fill('Research brief');
  await page.locator('#room-save').click();await page.locator('#room-dialog').waitFor({state:'hidden'});
  assert.match(await page.locator('#workflow-step-editor').innerText(),/Research review/);
  assert.match(await page.locator('#workflow-step-editor').innerText(),/1 required outputs/);
  assert.match(await page.locator('#workflow-step-editor').innerText(),/Owner approval required/);
  assert.equal(app.runtime.state.conversations.filter(c=>c.kind==='room').length,0,'Configuring a stage creates no real room');
  await page.locator('[data-wf-room-configure]').click();
  assert.equal(await page.locator('#room-name').inputValue(),'Research review');
  assert.equal(await page.locator('#room-owner-approval').isChecked(),true);
  assert.equal(await page.locator('#room-output-options input').inputValue(),'Research brief');
  for(const width of [320,768,1440]){await page.setViewportSize({width,height:960});assert.equal(await page.locator('#room-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth),true);}
  await page.locator('#room-name').fill('Discarded change');await page.locator('#room-dialog-close').click();
  await page.locator('[data-wf-room-configure]').click();
  assert.equal(await page.locator('#room-name').inputValue(),'Research review');
  await page.locator('#room-dialog-close').click();
  assert.equal(await page.locator('[data-wf-field="step.prompt"]').inputValue(),'Prepare a reviewed research brief.');
  await page.locator('#workflow-form button[type="submit"]').click();await page.locator('#workflow-editor').waitFor({state:'hidden'});
  const saved=app.runtime.state.workflows.find(workflow=>workflow.steps[0]?.type==='room');
  assert.ok(saved);assert.equal(saved.steps[0].room.title,'Research review');
  assert.equal(saved.steps[0].room.governance.outputs[0].title,'Research brief');
  assert.equal(saved.steps[0].room.governance.ownerApproval,true);
  assert.equal(saved.steps[0].prompt,'Prepare a reviewed research brief.');
  await page.reload();await page.locator('#tools-open').click();await page.locator('[data-view="workflows"]').click();
  await page.locator(`[data-workflow-edit="${saved.id}"]`).click();await page.locator('[data-wf-select="0"]').click();
  await page.locator('[data-wf-room-configure]').click();assert.equal(await page.locator('#room-name').inputValue(),'Research review');
  assert.equal(await page.locator('#room-space').isDisabled(),false);
  assert.equal(await page.locator('#room-output-options input').inputValue(),'Research brief');
  assert.deepEqual(errors,[]);
} catch(error){console.log(await page.locator('body').innerText());console.log(errors);throw error;} finally {await context.close();await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}

},30000);
