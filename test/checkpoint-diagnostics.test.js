import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {createJob} from '../store.js';
import {ensureTaskWorkspace} from '../execution/work.js';
import {defaults} from '../public/profile.js';

test('fresh checkpoint restores identify the exact owner-only blocker without weakening grants or leaking labels to agents',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-checkpoint-diagnostic-')),password='test-password-long-enough',codex=Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}});let app,browser;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
 try{
  app=createApp({directory,user:'owner',password,origin:server.url.origin,providerOptions:{codex},browser:{close:async()=>{}}});
  const runtime=app.runtime,store=runtime.store,state=store.state,p=store.security,receiver=state.agents[0];
  receiver.customization={...defaults,name:'Current engineer'};receiver.provider.configured=true;state.customization=receiver.customization;state.globalProvider.configured=true;
  const source={...structuredClone(receiver),id:randomUUID(),customization:{...defaults,name:'Original <img src=x onerror="window.labelExecuted=true"> engineer'}};state.agents.push(source);
  const space=p.createSpace({name:'Execution'}),repo=p.createResource({spaceId:space.id,type:'repository',name:'Private project label',metadata:{endpoint:'https://example.invalid/project.git'}}),workspace=p.createResource({spaceId:space.id,type:'workspace',name:'Execution Code',metadata:{repositoryId:repo.id}});p.configureExecution(true);
  const access=(agent,read)=>p.putAccess(agent.id,{revision:p.revision,spaceIds:[space.id],defaultSpaceId:space.id,grants:[{spaceId:space.id,resourceId:workspace.id,action:'sandbox.exec',mode:'auto'},...(read?[{spaceId:space.id,resourceId:repo.id,action:'repository.read',mode:'auto'}]:[])]});access(source,true);access(receiver,true);
  const original=createJob(state,{agentId:source.id,spaceId:space.id,prompt:'Original checkpoint'});store.data.note(original,workspace.id,'sandbox.exec');store.data.note(original,repo.id,'repository.read');original.status='completed';
  const fresh=createJob(state,{agentId:receiver.id,spaceId:space.id,prompt:'Fresh checkout'});fresh.status='running';
  const checkpointId='a'.repeat(64),record={id:checkpointId,resourceId:workspace.id,spaceId:space.id,taskId:original.id};state.checkpoints=[record];state.executionHeads={[workspace.id]:checkpointId};let restores=0;
  runtime.sandbox.restore=async()=>{restores++;return {resourceId:workspace.id,checkpointId};};
  access(source,false);
  let denial;try{await ensureTaskWorkspace(runtime,fresh,workspace.id);}catch(error){denial=error.message;}
  expect(denial).toContain('Classified workflow disclosure denied');expect(denial).toContain('Recent activity');expect(denial).not.toContain('Private project label');expect(denial).not.toContain(source.id);expect(restores).toBe(0);expect(fresh.workspacePin).toBeFalsy();
  const event=p.audit().find(row=>row.action==='checkpoint.restore');expect(event.agentId).toBe(receiver.id);for(const detail of [checkpointId,original.id,source.id,repo.id,'repository.read','No grant.'])expect(event.reason).toContain(detail);
  const auth='Basic '+Buffer.from('owner:'+password).toString('base64'),owner=await fetch(new URL('/api/audit',server.url),{headers:{authorization:auth}});expect(owner.status).toBe(200);expect(JSON.stringify(await owner.json())).toContain(checkpointId);
  expect((await fetch(new URL('/api/audit',server.url))).status).toBe(401);const token=store.data.issueToken(fresh),agentResponse=await fetch(new URL('/api/audit',server.url),{headers:{authorization:'Bearer '+token}});expect(agentResponse.status).toBe(403);expect(await agentResponse.text()).not.toContain('Private project label');
  runtime.changed();browser=await chromium.launch();const context=await browser.newContext({httpCredentials:{username:'owner',password}}),page=await context.newPage();await page.goto(server.url.href);
  await page.evaluate(async()=>{(await import('/customize.js')).openCustomization();});await page.locator('#agent-access-tab').click();await page.locator('#security-dialog summary').filter({hasText:'Recent activity'}).click();await page.locator('#access-refresh').click();
  await page.waitForFunction(id=>document.querySelector('#access-audit').textContent.includes(id),checkpointId);expect(await page.locator('#access-audit').textContent()).toContain(source.customization.name);expect(await page.locator('#access-audit img').count()).toBe(0);expect(await page.evaluate(()=>window.labelExecuted)).toBeUndefined();
  access(source,true);access(receiver,false);await expect(ensureTaskWorkspace(runtime,fresh,workspace.id)).rejects.toThrow('disclosure denied');const receiving=p.audit().find(row=>row.action==='checkpoint.restore');expect(receiving.reason).toContain('Blocked agent: Current engineer ('+receiver.id+')');expect(receiving.reason).toContain(repo.id);expect(restores).toBe(0);
  access(receiver,true);record.taskId=randomUUID();await expect(ensureTaskWorkspace(runtime,fresh,workspace.id)).rejects.toThrow('disclosure denied');expect(p.audit().find(row=>row.action==='checkpoint.restore').reason).toContain('Source task unavailable.');expect(restores).toBe(0);
  record.taskId=original.id;record.exportId=randomUUID();await expect(ensureTaskWorkspace(runtime,fresh,workspace.id)).rejects.toThrow('Export denied');expect(p.audit().find(row=>row.action==='checkpoint.restore').reason).toContain(record.exportId);delete record.exportId;
  state.checkpoints=[];await expect(ensureTaskWorkspace(runtime,fresh,workspace.id)).rejects.toThrow('provenance unavailable');expect(p.audit().find(row=>row.action==='checkpoint.restore').reason).toContain('Checkpoint provenance unavailable.');expect(restores).toBe(0);state.checkpoints=[record];
  await ensureTaskWorkspace(runtime,fresh,workspace.id);expect(restores).toBe(1);expect(fresh.workspacePin.headId).toBe(checkpointId);
 }finally{await browser?.close();server.stop(true);await app?.close();rmSync(directory,{recursive:true,force:true});}
},30000);
