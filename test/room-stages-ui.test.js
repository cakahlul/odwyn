import {newPageWithoutTutorials} from '../tests/browser-page.js';
import { test } from 'bun:test';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
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
const page=await newPageWithoutTutorials(context),errors=[];
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
  assert.equal(await page.locator('#room-output-options input').inputValue(),'Research brief');
  assert.deepEqual(errors,[]);
} catch(error){console.log(await page.locator('body').innerText());console.log(errors);throw error;} finally {await context.close();await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}

},30000);


test('owner approves and publishes a reviewed stage, passes its package, then explicitly starts the configured next room',async()=>{
  class Provider extends EventEmitter {
    child={};replies=[];
    async request(method,params){if(method==='account/read')return {account:{type:'chatgpt'}};if(method.startsWith('thread/'))return {thread:{id:params.threadId||randomUUID()}};return {turn:{id:randomUUID(),status:'inProgress'}};}
    respond(id,result){this.replies.push(result);}reject(){}stop(){}
  }
  const directory=mkdtempSync(join(tmpdir(),'odwyn-stage-handoff-ui-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>app.fetch(request)});
  const password='workflow-test-password',headers={authorization:'Basic '+Buffer.from('check:'+password).toString('base64'),origin:server.url.origin,'content-type':'application/json'};
  app=createApp({directory,user:'check',password,origin:server.url.origin,codex:new Provider(),browser:{close:async()=>{}}});
  const runtime=app.runtime,primary=runtime.state.agents[0].id;
  runtime.state.customization={...defaults,name:'Lead'};runtime.state.globalProvider.configured=true;
  const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'check',password},viewport:{width:1440,height:960}}),page=await newPageWithoutTutorials(context),errors=[];
  page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
  const call=async(tool,args)=>{const job=runtime.active,provider=runtime.providers.get(job.agentId);await runtime.handleRequest({id:randomUUID(),method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool,arguments:args}});const reply=provider.replies.at(-1);assert.equal(reply.success,true,reply.contentItems[0].text);return JSON.parse(reply.contentItems[0].text);};
  const finish=async()=>{runtime.finish(runtime.active,'completed');await runtime.drain();};
  try {
    const response=await app.fetch(new Request(new URL('/api/agents',server.url),{method:'POST',headers,body:JSON.stringify({...defaults,name:'Writer'})}));assert.equal(response.status,201);
    const peer=(await response.json()).id;runtime.providers.get(peer).stop();runtime.addProvider(peer,new Provider());runtime.addProvider(primary,new Provider());
    await runtime.refreshAccount(primary);await runtime.refreshAccount(peer);
    const rooms=['Research review','Editorial release'].map(title=>({title,spaceId:'legacy',memberIds:[primary,peer],governance:{facilitatorId:primary,reviewerIds:[primary],ownerApproval:true,outputs:[{id:'brief',title:'Research brief',agentId:peer}]}}));
    const created=await app.fetch(new Request(new URL('/api/workflows',server.url),{method:'POST',headers,body:JSON.stringify({name:'Research publication',command:'research-publication',inputs:[],steps:rooms.map((room,index)=>({id:`stage-${index}`,name:room.title,type:'room',prompt:index?'Validate and publish the reviewed brief.':'Prepare a research brief with cited evidence.',room}))})}));assert.equal(created.status,201);
    const workflow=await created.json(),job=runtime.launchWorkflow(workflow,{inputs:{}});await runtime.drain();
    const source=runtime.conversation(job),run=runtime.state.workflowRuns[0];
    await call('odwyn_room_next',{agentId:peer,reason:'Draft the research brief'});await finish();
    await call('odwyn_artifact_write',{outputId:'brief',text:'# Research brief\nVerified findings and citations.'});
    await call('odwyn_room_next',{agentId:primary,reason:'Review the exact brief'});await finish();
    const artifact=source.artifacts[0];await call('odwyn_artifact_review',{artifactId:artifact.id,versionId:artifact.versions[0].id,decision:'approve',summary:'Verified findings and sources.'});
    await call('odwyn_room_done',{result:'Research brief ready.',nextPlan:'Editorial release after owner approval.',summary:'Reviewed the draft.'});
    const proposalId=source.discussion.outcome.id;await call('odwyn_room_review',{proposalId,decision:'approve',summary:'Ready for owner approval.'});
    await call('odwyn_room_next',{agentId:peer,reason:'Confirm the reviewed brief'});await finish();await call('odwyn_room_done',{proposalId,summary:'Confirmed the exact brief.'});await finish();
    assert.equal(source.discussion.status,'awaiting_owner');assert.equal(runtime.state.files.length,0);
    await page.goto(server.url.href+`#chat/${source.id}`);
    await page.locator('.room-deliverables').waitFor();
    assert.equal(await page.locator('.room-deliverables').evaluate(node=>node.open),false);
    assert.equal(await page.locator('.room-deliverable').evaluate(node=>node.open),false);
    await page.locator('.room-deliverables > summary').focus();await page.keyboard.press('Enter');
    await page.locator('.room-deliverable > summary').click();
    assert.equal(await page.locator('.room-deliverable-content h2').innerText(),'Research brief');
    assert.equal(await page.locator('.room-deliverables > summary').evaluate(node=>getComputedStyle(node,'::after').display),'none');
    source.title='Research review updated';runtime.changed();
    await page.locator('#room-label').filter({hasText:'Research review updated'}).waitFor();
    assert.equal(await page.locator('.room-deliverables').evaluate(node=>node.open),true);
    assert.equal(await page.locator('.room-deliverable').evaluate(node=>node.open),true);
    for(const width of [320,1440]){
      await page.setViewportSize({width,height:960});
      assert.equal(await page.locator('.room-work').evaluate(node=>node.scrollWidth<=node.clientWidth),true);
      await page.locator('.room-deliverables > summary').click();
      await page.screenshot({path:join(import.meta.dir,`../artifacts/room-deliverables-${width}.png`)});
      await page.locator('.room-deliverables > summary').click();
    }
    await page.getByRole('heading',{name:'Ready for your approval'}).waitFor();
    assert.equal(await page.locator('[aria-label="Published files"]').count(),0);
    await page.locator('form[data-room-owner] textarea').fill('Reviewed the brief. Proceed to editorial release.');
    await page.getByRole('button',{name:'Approve and publish files',exact:true}).click();
    await page.locator('[aria-label="Published files"] a').waitFor();
    assert.equal(source.discussion.status,'completed');assert.equal(source.discussion.outcome.ownerDecision.proposalId,proposalId);
    assert.equal(run.status,'awaiting_handoff');assert.equal(runtime.state.files.length,1);
    const published=await context.request.get(new URL(await page.locator('[aria-label="Published files"] a').getAttribute('href'),server.url).href);assert.equal(published.status(),200);assert.match(await published.text(),/Verified findings and citations/);
    await page.locator('#room-pass-next').click();await page.locator('#room-handoff-dialog').waitFor({state:'visible'});
    assert.equal(await page.locator('#room-handoff-form input[name=title]').inputValue(),'Editorial release');
    assert.equal(await page.locator('#room-handoff-form input[name=title]').getAttribute('readonly'),'');
    for(const id of [primary,peer]){const input=page.locator(`#room-handoff-members input[value="${id}"]`);assert.equal(await input.isChecked(),true);assert.equal(await input.isDisabled(),true);}
    assert.equal(await page.locator('#room-handoff-artifacts input').isChecked(),true);
    await page.locator('#room-handoff-form textarea[name=openQuestions]').fill('Verify citations before release.');
    await page.getByRole('button',{name:'Create next room',exact:true}).click();
    await page.getByRole('button',{name:'Start stage',exact:true}).waitFor();
    const destination=runtime.state.conversations.find(room=>room.id===run.roomIds[1]);assert.ok(destination);
    assert.equal(destination.title,'Editorial release');assert.equal(destination.discussion,undefined);assert.equal(run.status,'ready');assert.equal(runtime.active,null);
    assert.deepEqual(destination.memberIds,rooms[1].memberIds);assert.deepEqual(destination.governance,run.workflow.steps[1].room.governance);
    assert.equal(destination.handoff.sourceRoomId,source.id);
    assert.match(await page.locator('.room-work').innerText(),/Validate and publish the reviewed brief/);
    await page.getByRole('button',{name:'Start stage',exact:true}).click();
    await page.getByRole('button',{name:'Start stage',exact:true}).waitFor({state:'hidden'});
    assert.equal(destination.discussion.status,'active');assert.equal(destination.discussion.goal,'Validate and publish the reviewed brief.');assert.equal(run.status,'running');assert.equal(runtime.active.conversationId,destination.id);
    assert.equal(await page.locator('#room-pass-next').isVisible(),false);
    assert.deepEqual(errors,[]);
  }catch(error){console.log(await page.locator('body').innerText());console.log(errors);throw error;}
  finally{await context.close();await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30000);
