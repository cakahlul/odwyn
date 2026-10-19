import {newPageWithoutTutorials} from '../tests/browser-page.js';
import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {defaults} from '../public/profile.js';

class Agent extends EventEmitter{
  child={};replies=[];
  async request(method,params){
    if(method==='account/read')return {account:{type:'chatgpt'}};
    if(method.startsWith('thread/'))return {thread:{id:params.threadId||randomUUID()}};
    if(method==='turn/start')return {turn:{id:randomUUID(),status:'inProgress'}};
    return {};
  }
  respond(id,result){this.replies.push(result);}
  reject(){}
  stop(){}
}

test('owner configures room roles and sees version-specific review progress on desktop and mobile',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-review-ui-')),lead=new Agent();let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  const password='test-password-long-enough',headers={authorization:'Basic '+Buffer.from('owner:'+password).toString('base64'),origin:server.url.origin,'content-type':'application/json'};
  app=createApp({directory,user:'owner',password,origin:server.url.origin,codex:lead,browser:{close:async()=>{}}});
  const runtime=app.runtime,primary=runtime.state.agents[0].id;
  runtime.state.customization={...defaults,name:'Lead'};runtime.state.globalProvider.configured=true;
  const add=async name=>{const response=await app.fetch(new Request(new URL('/api/agents',server.url),{method:'POST',headers,body:JSON.stringify({...defaults,name})}));expect(response.status).toBe(201);const agent=await response.json();runtime.providers.get(agent.id).stop();runtime.addProvider(agent.id,new Agent());return agent.id;};
  const engineer=await add('Engineer'),observer=await add('Observer');
  for(const id of [primary,engineer,observer])await runtime.refreshAccount(id);runtime.changed();
  const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'owner',password},viewport:{width:1440,height:960}}),page=await newPageWithoutTutorials(context),errors=[];
  page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
  const call=async(tool,args)=>{const job=runtime.active,provider=job.agentId===primary ? lead : runtime.providers.get(job.agentId);await runtime.handleRequest({id:randomUUID(),method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool,arguments:args}});expect(provider.replies.at(-1).success).toBe(true);};
  const finish=async()=>{const job=runtime.active;runtime.providers.get(job.agentId).emit('notification',{method:'turn/completed',params:{threadId:job.threadId,turn:{id:job.turnId,status:'completed'}}});await runtime.drain();};
  try{
    await page.goto(server.url.href+'#chat');await page.getByRole('heading',{name:'Message Lead',exact:true}).waitFor();
    if(!await page.locator('#search-dialog').evaluate(node=>node.open))await page.locator('#menu-button').click();await page.locator('#new-room').click();
    await page.locator('#room-name').fill('Feature review');
    for(const id of [engineer,observer])await page.locator(`#room-agent-options input[value="${id}"]`).check();
    await page.locator('#room-governance').focus();await page.keyboard.press('Space');
    expect(await page.locator('#room-governance').isChecked()).toBe(true);
    await page.locator('#room-facilitator').selectOption(primary);
    await page.getByLabel('Require review from Lead',{exact:true}).check();
    await page.getByLabel('Participation for Observer',{exact:true}).selectOption('observer');
    expect(await page.getByLabel('Require review from Observer',{exact:true}).isDisabled()).toBe(true);
    await page.locator('#room-save').click();await page.locator('#room-label').filter({hasText:'Feature review'}).waitFor();
    const room=runtime.state.conversations.find(c=>c.kind==='room');
    expect(room.governance).toEqual({facilitatorId:primary,reviewerIds:[primary],observerIds:[observer]});
    await page.locator('#room-details-open').click();
    expect(await page.locator('#room-members').textContent()).toContain('Required reviewer');
    await page.locator('#edit-room').click();
    expect(await page.locator('#room-governance').isChecked()).toBe(true);
    expect(await page.locator('#room-facilitator').inputValue()).toBe(primary);
    expect(await page.getByLabel('Require review from Lead',{exact:true}).isChecked()).toBe(true);
    for(const width of [320,768,1024,1440]){
      await page.setViewportSize({width,height:960});
      expect(await page.locator('#room-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      await page.locator('#room-save').scrollIntoViewIfNeeded();expect(await page.locator('#room-save').isVisible()).toBe(true);
      if(width===320){mkdirSync(resolve('artifacts'),{recursive:true});await page.locator('#room-facilitator').scrollIntoViewIfNeeded();await page.screenshot({path:resolve('artifacts/room-roles-mobile.png'),fullPage:true});}
    }
    await page.locator('#room-save').click();await page.locator('#room-dialog').waitFor({state:'hidden'});
    await page.locator('#prompt').fill('Prepare a reviewed result.');await page.locator('#composer').evaluate(form=>form.requestSubmit());await runtime.drain();
    await page.locator('#room-review-status').filter({hasText:'Work in progress'}).waitFor();
    await call('odwyn_room_done',{result:'Draft <script>bad()</script>',nextPlan:'Validate',summary:'Checked requirements.'});
    const proposalId=room.discussion.outcome.id;
    await page.locator('#room-review-status').filter({hasText:'Awaiting review'}).waitFor();
    expect(await page.locator('#room-review-card').textContent()).toContain('Review pending');
    await call('odwyn_room_review',{proposalId,decision:'approve',summary:'Checked the draft.'});await finish();
    expect(runtime.active.agentId).toBe(engineer);
    await call('odwyn_room_done',{proposalId,summary:'Verified implementation.'});await finish();
    expect(room.discussion.status).toBe('completed');
    await page.locator('#room-review-status').filter({hasText:'Required reviews passed'}).waitFor();
    await page.setViewportSize({width:320,height:960});
    expect(await page.locator('#room-review-card').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    const artifacts=resolve('artifacts');mkdirSync(artifacts,{recursive:true});
    await page.screenshot({path:join(artifacts,'room-reviews-mobile.png'),fullPage:true});
    await page.reload();await page.locator('#room-review-status').filter({hasText:'Required reviews passed'}).waitFor();
    expect(await page.locator('#room-review-card').textContent()).toContain('Checked the draft.');
    expect(await page.locator('#room-review-card script').count()).toBe(0);
    expect(errors).toEqual([]);
  }catch(error){console.error({errors,body:(await page.locator('body').innerText()).slice(0,2500)});throw error;}
  finally{await browser.close();await app.close();server.stop(true);rmSync(directory,{recursive:true,force:true});}
},30000);
