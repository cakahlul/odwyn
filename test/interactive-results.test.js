import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { defaults } from '../public/profile.js';

test('workflow result cards configure, select, send a follow-up, and persist after reload',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-interactive-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  const provider=Object.assign(new EventEmitter(),{calls:[],child:{},stop(){},async request(method,params){this.calls.push({method,params});return method==='account/read' ? {account:{type:'chatgpt'}}:{thread:{id:'test'},turn:{id:'test'}};}});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex:provider,browser:{close:async()=>{},reset:async()=>{}}});
  app.runtime.state.customization={...defaults,name:'Momo'};app.runtime.state.globalProvider.configured=true;app.runtime.state.agents[0].provider.configured=true;
  await app.runtime.refreshAccount();app.runtime.changed();
  const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:960}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10_000);
  const artifacts=resolve(import.meta.dir,'../artifacts');mkdirSync(artifacts,{recursive:true});
  const data={type:'pr_review',prUrl:'https://example.com/pull/1676',commit:'f3a60313bba05fe23fceb78787d3a9616c622cb9',summary:'Probe guard looks correct. Included auth changes need QA evidence.',feedback:[{id:'F1',severity:'major',location:'PR description',comment:'Link confirmation and production-like QR login QA results.',sourceUrl:'https://example.com/issue/14217'},{id:'F2',severity:'minor',location:'Login tests',comment:'Add coverage for the fallback login route.'}]};
  try {
    await page.goto(server.url.href);await page.locator('.welcome').waitFor();
    await page.evaluate(async data=>{
      const {api}=await import('/ui.js');
      await api('/api/workflows',{name:'PR review',command:'pr-review',steps:[{id:'review',name:'Review result',type:'output',prompt:JSON.stringify(data)}]});
    },data);
    await page.locator('[data-view=workflows]').click();await page.locator('[data-workflow-edit]').click();
    await page.locator('[data-wf-select="0"]').click();await page.getByText('Interactive response',{exact:true}).click();
    await page.locator('[data-wf-field="step.responseItems"]').fill('feedback');
    await page.locator('[data-wf-field="step.responseLabel"]').fill('Post selected feedback');
    await page.locator('[data-wf-field="step.responsePrompt"]').fill('Post only the selected feedback to the original PR.');
    await page.screenshot({path:join(artifacts,'interactive-response-editor.png'),animations:'disabled'});
    await page.locator('#workflow-form button[type=submit]').click();await page.locator('#workflow-editor').waitFor({state:'hidden'});
    const step=app.runtime.state.workflows[0].steps[0];expect(step.responseItems).toBe('feedback');expect(step.responseLabel).toBe('Post selected feedback');
    await page.locator('[data-workflow-run]').click();await page.locator('#workflow-run-form .primary-button').click();
    await page.locator('.result-response').waitFor();await page.getByRole('button',{name:'Post selected feedback',exact:true}).waitFor();
    expect(await page.locator('.result-response input[name=selected]').count()).toBe(2);
    expect(await page.locator('.review-item').first().textContent()).toContain(data.feedback[0].comment);
    const source=app.runtime.state.jobs.find(job=>job.workflowRunId),message=app.runtime.conversation(source).messages.find(m=>m.jobId===source.id && m.role==='assistant');
    const invalid=await page.evaluate(async ({jobId,messageId})=>{
      const response=await fetch(`/api/jobs/${jobId}/respond`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messageId,selected:['99']})});return response.status;
    },{jobId:source.id,messageId:message.id});expect(invalid).toBe(400);
    await page.getByRole('button',{name:'Post selected feedback',exact:true}).click();
    expect(await page.locator('.result-response-status').textContent()).toBe('Select at least one item.');
    await page.getByRole('checkbox',{name:'F2',exact:true}).check();await page.locator('.result-response textarea').fill('Use concise wording.');
    for(const width of [320,768,1024,1440]){
      await page.setViewportSize({width,height:960});
      expect(await page.locator('#view').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
      expect(await page.getByRole('checkbox',{name:'F2',exact:true}).isChecked()).toBe(true);
      await page.screenshot({path:join(artifacts,`interactive-review-${width}.png`),animations:'disabled'});
    }
    await page.getByRole('button',{name:'Post selected feedback',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.result-response button')?.textContent.includes('Sent to agent'));
    const followup=app.runtime.state.jobs.find(job=>!job.workflowRunId);
    expect(followup.prompt).toContain('Selected items: [{"id":"F2"');expect(followup.prompt).toContain('Use concise wording.');expect(followup.agentId).toBe(source.agentId);
    expect(message.responseJobId).toBe(followup.id);
    await page.reload();await page.locator('.result-response').waitFor();
    expect(await page.getByRole('button',{name:'Sent to agent',exact:true}).isEnabled()).toBe(false);
    expect(await page.getByRole('checkbox',{name:'F2',exact:true}).isChecked()).toBe(true);
    expect(await page.locator('.result-response textarea').inputValue()).toBe('Use concise wording.');
    const repeated=await page.evaluate(async ({jobId,messageId})=>{
      const response=await fetch(`/api/jobs/${jobId}/respond`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messageId,selected:['1']})});return response.status;
    },{jobId:source.id,messageId:message.id});expect(repeated).toBe(400);
    expect(errors).toEqual([]);
  } finally {await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},45_000);
