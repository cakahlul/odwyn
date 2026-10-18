import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {validateWorkflow} from '../workflows.js';
import {defaults} from '../public/profile.js';

class Provider extends EventEmitter{child={};async request(method,params){return method==='account/read'?{account:{type:'chatgpt'}}:method.startsWith('thread/')?{thread:{id:params.threadId||randomUUID()}}:{turn:{id:randomUUID()}};}stop(){}respond(){}reject(){}}

test('workflow launch accepts multiline requirements and scoped chat-style attachments, naming every room from its identifier',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-workflow-launch-')),password='test-workflow-password';let app,browser;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(request,srv)=>app.fetch(request,srv)});
 try{
  app=createApp({directory,user:'owner',password,origin:server.url.origin,codex:new Provider(),browser:{close:async()=>{}}});
  const runtime=app.runtime,state=runtime.state,p=runtime.store.security,first=state.agents[0];state.customization=first.customization={...defaults,name:'Lead'};first.provider.configured=true;state.globalProvider.configured=true;
  const peer={...structuredClone(first),id:randomUUID(),customization:{...defaults,name:'Engineer'}};state.agents.push(peer);runtime.addProvider(peer.id,new Provider());
  const space=p.createSpace({name:'Grooming'});for(const agent of [first,peer])p.putAccess(agent.id,{revision:p.revision,spaceIds:[space.id],grants:[]});await runtime.refreshAccount();await runtime.refreshAccount(peer.id);
  const workflow=validateWorkflow({name:'Feature Delivery',command:'feature-delivery',inputs:[{name:'feature',label:'Feature Identifier',required:true,default:'Feature001'},{name:'requirement',label:'Requirement or feature brief',required:true}],steps:['Grooming','Planning'].map((name,index)=>({id:'stage-'+index,name,type:'room',prompt:'Review {{inputs.feature}}: {{inputs.requirement}}',room:{title:name,spaceId:space.id,memberIds:[first.id,peer.id],governance:{facilitatorId:first.id,reviewerIds:[first.id]}}}))},state);state.workflows.push(workflow);runtime.changed();
  // Foreign-Space files must fail before creating a room or run.
  const foreign={id:randomUUID(),kind:'upload',spaceId:p.legacySpaceId,name:'foreign.txt'};state.files.push(foreign);runtime.store.data.sync();const rooms=state.conversations.length;
  expect(()=>runtime.launchWorkflow(workflow,{agentId:first.id,inputs:{feature:'Wrong',requirement:'Test'},attachments:[foreign.id]})).toThrow();expect(state.conversations).toHaveLength(rooms);expect(state.workflowRuns).toHaveLength(0);
  expect(()=>runtime.launchWorkflow(workflow,{agentId:first.id,inputs:{feature:'Wrong',requirement:'Test'},attachments:['missing']})).toThrow();
  browser=await chromium.launch();const context=await browser.newContext({httpCredentials:{username:'owner',password}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(7000);
  await page.goto(server.url.href);await page.locator('#tools-open').click();await page.locator('[data-view=workflows]').click();await page.locator('[data-workflow-run]').click();
  const input=page.locator('#workflow-run-inputs textarea[name=requirement]');expect(await input.getAttribute('rows')).toBe('8');expect((await input.boundingBox()).height).toBeGreaterThanOrEqual(150);
  const requirement='Build a feature.\n\nAcceptance criteria:\n'+('Preserve existing API contracts.\n'.repeat(50));await input.fill(requirement);await page.locator('#workflow-run-inputs input[name=feature]').fill('Feature007');
  const chooser=page.waitForEvent('filechooser');await page.locator('#workflow-run-attach').click();await(await chooser).setFiles({name:'brief.md',mimeType:'text/markdown',buffer:Buffer.from('Requirement details')});
  await page.waitForFunction(()=>document.querySelector('#workflow-run-attachments').textContent.includes('brief.md')&&document.querySelector('#workflow-run-attachments').getAttribute('aria-busy')==='false');
  await input.evaluate(node=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9uoAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'mock.png',{type:'image/png'}));node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  await page.waitForFunction(()=>document.querySelectorAll('#workflow-run-attachments .attachment-chip').length===2&&document.querySelector('#workflow-run-attachments').getAttribute('aria-busy')==='false');expect(await page.locator('#workflow-run-attachments img').count()).toBe(1);
  await page.locator('#workflow-run-attachments button[aria-label="Remove brief.md"]').click();expect(await page.locator('#workflow-run-attachments .attachment-chip').count()).toBe(1);
  await page.locator('#workflow-run-form').evaluate(node=>{const data=new DataTransfer();data.items.add(new File(['API contract'],'contract.txt',{type:'text/plain'}));node.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));});
  await page.waitForFunction(()=>document.querySelector('#workflow-run-attachments').textContent.includes('contract.txt')&&document.querySelector('#workflow-run-attachments').getAttribute('aria-busy')==='false');
  const uploaded=state.files.filter(file=>['brief.md','mock.png','contract.txt'].includes(file.name));expect(uploaded).toHaveLength(3);expect(uploaded.every(file=>file.spaceId===space.id)).toBe(true);
  await page.locator('#workflow-run-files').setInputFiles(Array.from({length:21},(_,i)=>({name:'too-many-'+i+'.txt',mimeType:'text/plain',buffer:Buffer.from('x')})));await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('20 uploaded files'));expect(state.files.filter(file=>file.name.startsWith('too-many-'))).toHaveLength(0);
  for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:600});expect(await page.locator('#workflow-run-form button.primary-button').evaluate(button=>{const rect=button.getBoundingClientRect();return button.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));})).toBe(true);expect(await page.locator('#workflow-run-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);}
  await page.setViewportSize({width:1440,height:900});await page.locator('#workflow-run-form>.modal-fields').evaluate(node=>node.scrollTop=0);await page.screenshot({path:join(tmpdir(),'odwyn-workflow-launch-preview.png')});
  expect(await input.inputValue()).toBe(requirement);const request=page.waitForRequest(request=>new URL(request.url()).pathname.endsWith('/run')&&request.method()==='POST');await page.locator('#workflow-run-form button.primary-button').click();const payload=(await request).postDataJSON();expect(payload.inputs.requirement).toBe(requirement);expect(payload.attachments).toHaveLength(2);
  await page.locator('#workflow-run-dialog').waitFor({state:'hidden'});const run=state.workflowRuns[0],room=state.conversations.find(room=>room.id===run.conversationId);expect(room.title).toBe('Feature007 · Grooming');expect(run.workflow.steps[1].room.title).toBe('Feature007 · Planning');expect(workflow.steps[0].room.title).toBe('Grooming');
  const retained=uploaded.filter(file=>file.name!=='brief.md').map(file=>file.id).sort();expect(room.messages[0].attachments.toSorted()).toEqual(retained);const jobs=state.jobs.filter(job=>job.conversationId===room.id);expect(jobs).toHaveLength(2);expect(jobs.every(job=>JSON.stringify(job.attachments.toSorted())===JSON.stringify(retained))).toBe(true);expect(errors).toEqual([]);
 }finally{await browser?.close();server.stop(true);await app?.close();rmSync(directory,{recursive:true,force:true});}
},30000);
