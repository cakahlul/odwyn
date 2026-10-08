import { test, expect } from 'bun:test';
import { validateWorkflow, validateSkill, importSkill, interpolate, workflowInvocation } from '../workflows.js';

const state = {agents:[{id:'a'}],skills:[],workflows:[]};
const definition = {name:'Research',command:'research',inputs:[{name:'topic',required:true}],steps:[{id:'read',type:'agent',prompt:'Research {{inputs.topic}}',next:'report'},{id:'report',type:'output',prompt:'{{steps.read}}'}]};
test('SKILL.md import reads YAML scalars, preserves Markdown, and rejects invalid or oversized input', () => {
  const body = '# Review\n\n```js\nconst value = 1;\n```\n\n---\nKeep this separator.';
  const imported = importSkill(`---\nname: "Review Code"\ndescription: >-\n  Check bugs and\n  cite locations.\nmetadata:\n  version: 1\n---\n${body}`);
  expect(imported.name).toBe('Review Code');
  expect(imported.command).toBe('review-code');
  expect(imported.description).toBe('Check bugs and cite locations.');
  expect(imported.instructions).toBe(body);
  expect(importSkill('\uFEFF---\r\nname: review\r\ncommand: custom-review\r\n---\r\nReview carefully.').command).toBe('custom-review');
  for (const source of ['# No frontmatter','---\nname: [\n---\nBody','---\ndescription: Missing name\n---\nBody','---\nname: review\n---\n','---\nname: review\n---\n'+'x'.repeat(30001)]) expect(()=>importSkill(source)).toThrow();
});
test('workflow definitions validate connections, skills and agents without executable expressions', () => {
  const workflow = validateWorkflow(definition,state);
  expect(validateWorkflow({...definition,steps:[{id:'mcp',type:'agent',prompt:'Use MCP',tools:['mcp']}]},state).steps[0].tools).toEqual(['mcp']);
  expect(workflow.start).toBe('read');
  expect(() => validateWorkflow({...definition,steps:[{id:'read',type:'agent',prompt:'Read',next:'missing'}]},state)).toThrow();
  expect(() => validateWorkflow({...definition,steps:[{id:'read',type:'agent',prompt:'Read',agentId:'missing'}]},state)).toThrow();
  expect(() => validateWorkflow({...definition,command:'Bad command'},state)).toThrow();
  expect(() => validateWorkflow({...definition,inputs:[{name:'__proto__'}]},state)).toThrow();
  expect(validateSkill({name:'Research',command:'research-skill',instructions:'Cite sources.'}).instructions).toBe('Cite sources.');
});
test('mapping preserves native values and rejects missing or unsafe paths', () => {
  const context = {inputs:{topic:'Bun'},steps:{read:{items:[1,2]}}};
  expect(interpolate('{{steps.read.items}}',context)).toEqual([1,2]);
  expect(interpolate('Read {{inputs.topic}}',context)).toBe('Read Bun');
  expect(() => interpolate('{{steps.missing}}',context)).toThrow();
  expect(() => interpolate('{{inputs.__proto__}}',context)).toThrow();
});
test('commands and explicit skill mentions resolve registered workflows only', () => {
  const workflow = validateWorkflow(definition,state); state.workflows=[workflow];
  expect(workflowInvocation('/research Bun',state).inputs).toEqual({topic:'Bun'});
  expect(workflowInvocation('$research {"topic":"Bun"}',state).workflow.id).toBe(workflow.id);
  expect(workflowInvocation('ordinary chat',state)).toBeNull();
  expect(() => workflowInvocation('/missing',state)).toThrow();
});

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../store.js';
import { Runtime } from '../runtime.js';

test('configured result selections send a durable follow-up to the producing agent',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'odwyn-response-')),store=openStore(dir),runtime=new Runtime({store,codex:new Provider(),browser:{},workspace:dir});
  try {
    await runtime.refreshAccount();
    const data={type:'pr_review',prUrl:'https://example.com/pr/1',summary:'Review findings',feedback:[{id:'F1',comment:'First'},{id:'F2',comment:'Second'}]};
    const workflow=validateWorkflow({name:'Review',command:'review',steps:[{id:'result',type:'agent',prompt:'Review the PR.',responseItems:'feedback',responseLabel:'Post selected feedback',responsePrompt:'Post only the selected feedback to the PR.'}]},store.state);
    expect(workflow.steps[0].responseLabel).toBe('Post selected feedback');
    expect(workflow.steps[0].format).toBe('json');
    store.state.workflows.push(workflow);const source=runtime.submit({prompt:'/review'});await runtime.starting;await runtime.drain();
    runtime.codex.emit('notification',{method:'item/completed',params:{threadId:source.threadId,item:{type:'agentMessage',id:'review-result',text:JSON.stringify(data)}}});
    runtime.finish(source,'completed');await runtime.drain();
    const message=runtime.conversation(source).messages.find(m=>m.jobId===source.id && m.role==='assistant');
    expect(()=>runtime.respondToResult(source.id,{messageId:message.id,selected:['3']})).toThrow();
    expect(()=>runtime.respondToResult(source.id,{messageId:message.id,selected:['1','1']})).toThrow();
    expect(()=>runtime.respondToResult(source.id,{messageId:message.id,selected:[]})).toThrow();
    const followup=runtime.respondToResult(source.id,{messageId:message.id,selected:['1']});
    expect(followup.agentId).toBe(source.agentId);expect(followup.conversationId).toBe(source.conversationId);
    expect(followup.prompt).toContain('Post only the selected feedback');
    expect(followup.prompt).toContain('Selected items: [{"id":"F2","comment":"Second"}]');
    expect(followup.prompt).toContain(data.prUrl);expect(followup.workflowRunId).toBeUndefined();
    expect(message.responseJobId).toBe(followup.id);
    expect(()=>runtime.respondToResult(source.id,{messageId:message.id,selected:['1']})).toThrow();
    const reloaded=openStore(dir);
    try {
      const saved=reloaded.state.conversations.find(c=>c.id===source.conversationId).messages.find(m=>m.id===message.id);
      expect(saved.responseJobId).toBe(followup.id);expect(saved.responseSelected).toEqual(['1']);
      expect(reloaded.state.jobs.find(job=>job.id===source.id).workflowStep.responsePrompt).toBe(workflow.steps[0].responsePrompt);
    } finally {reloaded.close();}
  } finally {runtime.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
class Provider extends EventEmitter {
  child={}; calls=[];
  async request(method,params) {this.calls.push({method,params});return method==='account/read' ? {account:{type:'chatgpt'}}:method.startsWith('thread/') ? {thread:{id:'thread'}}:{turn:{id:'turn'}};}
  respond() {} reject() {}
}
test('workflow runs hand off agents, retain outputs, pause for approval and resume only the failed step', async () => {
  const dir=mkdtempSync(join(tmpdir(),'odwyn-workflow-')),store=openStore(dir),provider=new Provider();
  const runtime=new Runtime({store,codex:provider,browser:{},workspace:dir});
  try {
    await runtime.refreshAccount();
    const workflow=validateWorkflow({name:'Draft',command:'draft',inputs:[],steps:[{id:'draft',type:'agent',prompt:'Draft',format:'json',tools:[],next:'check'},{id:'check',type:'condition',value:'{{steps.draft.ok}}',operator:'equals',compare:true,next:'approval',otherwise:'end'},{id:'approval',type:'approval',prompt:'Approve {{steps.draft.text}}',next:'end'},{id:'end',type:'output',prompt:'{{steps.draft.text}}'}]},store.state);
    store.state.workflows.push(workflow);
    const first=runtime.submit({prompt:'/draft'});await runtime.drain();
    expect(first.workflowRunId).toBeTruthy();
    const run=store.state.workflowRuns[0];
    provider.emit('notification',{method:'item/completed',params:{threadId:first.threadId,item:{type:'agentMessage',id:'draft-result',text:'{"ok":true,"text":"Hello"}'}}});
    runtime.finish(first,'completed');await runtime.drain();
    // Condition completes without provider inference; approval is the next queued step.
    await new Promise(resolve=>setTimeout(resolve,0));void runtime.drain();await new Promise(resolve=>setTimeout(resolve,0));
    expect(runtime.active.pending.type).toBe('question');
    const approval=runtime.active;
    runtime.answer(approval.id,{requestId:approval.pending.id,answer:'Post only Hello'});
    await runtime.starting;await runtime.drain();
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(run.status).toBe('completed');expect(run.outputs.approval.answer).toBe('Post only Hello');
    expect(run.outputs.end).toBe('Hello');
    expect(provider.calls.find(c=>c.method==='thread/start').params.dynamicTools.map(t=>t.name)).toEqual(['odwyn_ask']);
    expect(provider.calls.find(c=>c.method==='thread/start').params.mcpEnabled).toBe(false);
    const bad=validateWorkflow({name:'Bad',command:'bad',steps:[{id:'first',type:'output',prompt:'Saved'},{id:'second',type:'output',prompt:'{{steps.missing}}'}]},store.state);
    store.state.workflows.push(bad);runtime.submit({prompt:'/bad'});await runtime.drain();await new Promise(resolve=>setTimeout(resolve,0));await runtime.drain();
    const failed=store.state.jobs.find(j=>j.workflowStepId==='second' && j.status==='failed');
    expect(failed).toBeTruthy();const retry=runtime.retry(failed.id);expect(retry.workflowStepId).toBe('second');
    expect(store.state.workflowRuns[0].outputs.first).toBe('Saved');
  } finally {runtime.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

import { createApp } from '../server.js';
test('workflow and skill APIs validate, persist and launch versioned runs', async () => {
  const directory=mkdtempSync(join(tmpdir(),'odwyn-workflow-api-')),provider=new Provider();provider.stop=()=>{};
  const app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:'https://assistant.test',codex:provider,browser:{close:async()=>{}}});
  const headers={authorization:'Basic '+Buffer.from('owner:test-password-long-enough').toString('base64'),origin:'https://assistant.test','content-type':'application/json'};
  const request=(path,method='GET',body)=>app.fetch(new Request('https://assistant.test'+path,{method,headers,...(body ? {body:JSON.stringify(body)}:{})}));
  try {
    const imported=await request('/api/skills/import','POST',{source:'---\nname: imported-review\ndescription: Review code\n---\nRead the diff.'});
    expect(imported.status).toBe(200);
    expect((await imported.json()).instructions).toBe('Read the diff.');
    expect((await request('/api/skills/import','POST',{source:'---\nname: quoted\n---\n'+'"'.repeat(19000)})).status).toBe(200);
    expect(app.runtime.state.skills).toHaveLength(0);
    expect((await request('/api/skills/import','POST',{source:'broken'})).status).toBe(400);
    const skill=await (await request('/api/skills','POST',{name:'Sources',command:'sources',instructions:'Cite sources.'})).json();expect(skill.id).toBeTruthy();
    const res=await request('/api/workflows','POST',{...definition,steps:[{id:'read',type:'agent',prompt:'Read {{inputs.topic}}',skills:[skill.id]}]});expect(res.status).toBe(201);
    const workflow=await res.json();
    expect((await request('/api/workflows','POST',{...definition})).status).toBe(400);
    const job=await (await request(`/api/workflows/${workflow.id}/run`,'POST',{inputs:{topic:'Bun'}})).json();expect(job.workflowRunId).toBeTruthy();
    const edit=await request(`/api/workflows/${workflow.id}`,'PUT',{...workflow,name:'Edited'});expect(edit.status).toBe(200);
    expect(app.runtime.state.workflowRuns[0].workflow.name).toBe('Research');
    expect((await request(`/api/skills/${skill.id}`,'DELETE')).status).toBe(400);
    const reopened=openStore(directory);expect(reopened.state.workflows[0].name).toBe('Edited');reopened.close();
    expect((await request('/workflows-ui.js')).status).toBe(200);
  } finally {await app.close();rmSync(directory,{recursive:true,force:true});}
});

import { commandParameters } from '../workflows.js';
test('terminal mappings quote untrusted values and reject templates inside shell quotes', () => {
  const context={inputs:{value:"x'; touch unexpected; echo '"}};
  expect(commandParameters({command:"printf '%s' {{inputs.value}}",reason:'Check'},context).command).toBe("printf '%s' 'x'\\''; touch unexpected; echo '\\''' ".trim());
  expect(()=>commandParameters({command:'echo "{{inputs.value}}"'},context)).toThrow();
});

test('loops stop at the configured limit and restarts never continue queued workflow steps silently', async () => {
  const dir=mkdtempSync(join(tmpdir(),'odwyn-workflow-loops-')),store=openStore(dir),provider=new Provider();
  const runtime=new Runtime({store,codex:provider,browser:{},workspace:dir});
  try {
    await runtime.refreshAccount();
    const loop=validateWorkflow({name:'Loop',command:'loop',maxSteps:4,steps:[{id:'repeat',type:'output',prompt:'Visit {{run.visits}}',next:'repeat'}]},store.state);
    store.state.workflows.push(loop);runtime.submit({prompt:'/loop'});
    for(let i=0;i<5;i++){await runtime.drain();await new Promise(resolve=>setTimeout(resolve,0));}
    const run=store.state.workflowRuns[0];expect(run.visits).toBe(4);expect(run.status).toBe('failed');expect(run.error).toContain('limit');
    const failed=store.state.jobs.find(j=>j.workflowRunId===run.id && j.status==='failed');runtime.retry(failed.id);await runtime.drain();expect(run.visits).toBe(4);
    const workflow=validateWorkflow({name:'Queued',command:'queued',steps:[{id:'wait',type:'agent',prompt:'Wait'}]},store.state);
    store.state.workflows.push(workflow);runtime.accounts.clear();const job=runtime.submit({prompt:'/queued'});expect(job.status).toBe('queued');
    store.save();const reopened=openStore(dir);
    const other=new Runtime({store:reopened,codex:new Provider(),browser:{},workspace:dir});
    try {expect(reopened.state.jobs.find(j=>j.id===job.id).status).toBe('interrupted');expect(reopened.state.workflowRuns[0].status).toBe('interrupted');}
    finally {other.close();reopened.close();}
  } finally {runtime.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('required inputs and selectable approval items pause with validated answers', async () => {
  const dir=mkdtempSync(join(tmpdir(),'odwyn-workflow-inputs-')),store=openStore(dir),runtime=new Runtime({store,codex:new Provider(),browser:{},workspace:dir});
  try {
    await runtime.refreshAccount();
    const workflow=validateWorkflow({name:'Selection',command:'select',inputs:[{name:'topic',required:true}],steps:[{id:'review',type:'approval',prompt:'Select feedback for {{inputs.topic}}',options:[{label:'First',comment:'One'},{label:'Second',comment:'Two'}],next:'result'},{id:'result',type:'output',prompt:'{{steps.review.selected}}'}]},store.state);
    store.state.workflows.push(workflow);runtime.submit({prompt:'/select'});await new Promise(resolve=>setTimeout(resolve,0));
    expect(runtime.active.workflowStepId).toBe('$inputs');
    const inputJob=runtime.active;runtime.answer(inputJob.id,{requestId:inputJob.pending.id,answer:'My topic'});await runtime.starting;
    void runtime.drain();await new Promise(resolve=>setTimeout(resolve,0));
    const review=runtime.active;expect(review.pending.options).toHaveLength(2);expect(store.state.workflowRuns[0].status).toBe('waiting');
    expect(()=>runtime.answer(review.id,{requestId:review.pending.id,selected:['8']})).toThrow();
    runtime.answer(review.id,{requestId:review.pending.id,answer:'Post selected comments',selected:['1']});await runtime.starting;await runtime.drain();
    expect(store.state.workflowRuns[0].outputs.result).toEqual([{label:'Second',comment:'Two'}]);
  } finally {runtime.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('agents receive snapshotted skills and disabled tools cannot execute', async () => {
  const dir=mkdtempSync(join(tmpdir(),'odwyn-workflow-agent-')),store=openStore(dir),first=new Provider(),second=new Provider();
  store.state.agents.push({id:'second',customization:{...store.state.customization,name:'Second'}});
  const runtime=new Runtime({store,codex:first,browser:{},workspace:dir});runtime.addProvider('second',second);
  first.replies=[];first.respond=(id,result)=>first.replies.push(result);
  try {
    for(const agent of store.state.agents)await runtime.refreshAccount(agent.id);
    const skill=validateSkill({name:'Careful',command:'careful',instructions:'Verify assumptions.'});store.state.skills.push(skill);
    const workflow=validateWorkflow({name:'Handoff',command:'handoff',steps:[{id:'first',type:'agent',prompt:'Draft',tools:[],skills:[skill.id],next:'second'},{id:'second',type:'agent',agentId:'second',prompt:'Check {{steps.first}}',tools:[]}]},store.state);
    store.state.workflows.push(workflow);const job=runtime.submit({prompt:'/handoff'});await runtime.drain();skill.instructions='Changed instructions';
    expect(first.calls.find(c=>c.method==='turn/start').params.input[0].text).toContain('Verify assumptions.');
    await runtime.handleRequest({id:'disabled',method:'item/tool/call',params:{threadId:job.threadId,tool:'odwyn_terminal',arguments:{command:'touch forbidden',reason:'Test'}}});
    expect(first.replies.at(-1).success).toBe(false);
    store.state.conversations[0].messages.push({id:'result',jobId:job.id,role:'assistant',text:'Draft output'});runtime.finish(job,'completed');await runtime.drain();
    expect(runtime.active.agentId).toBe('second');expect(second.calls.find(c=>c.method==='turn/start').params.input[0].text).toContain('Draft output');
  } finally {runtime.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('a workflow retains the shared browser queue across steps before another workflow starts', async () => {
  const dir=mkdtempSync(join(tmpdir(),'odwyn-workflow-queue-')),store=openStore(dir),runtime=new Runtime({store,codex:new Provider(),browser:{},workspace:dir});
  try {
    await runtime.refreshAccount();
    const workflow=validateWorkflow({name:'Queue',command:'queue',steps:[{id:'one',type:'agent',prompt:'One',next:'two'},{id:'two',type:'agent',prompt:'Two'}]},store.state);
    store.state.workflows.push(workflow);
    const first=runtime.submit({prompt:'/queue'});await runtime.drain();
    const second=runtime.submit({prompt:'/queue'});
    store.state.conversations.find(c=>c.id===first.conversationId).messages.push({id:'one-result',jobId:first.id,role:'assistant',text:'One'});
    runtime.finish(first,'completed');await runtime.drain();
    expect(runtime.active.workflowRunId).toBe(first.workflowRunId);expect(second.status).toBe('queued');
  } finally {runtime.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

import { enqueueSchedules } from '../store.js';
test('a deleted command pauses its routine instead of crashing the scheduler', () => {
  const state={jobs:[],schedules:[{id:'schedule',enabled:true,prompt:'/deleted',nextAt:'2020-01-01T00:00:00Z',intervalMinutes:60}]};
  expect(()=>enqueueSchedules(state,new Date(),()=>{throw new Error('Unknown command');})).not.toThrow();
  expect(state.schedules[0].enabled).toBe(false);expect(state.schedules[0].error).toBe('Unknown command');
});

test('direct terminal steps use existing permissions, quote mapped data, and pause on unsuccessful exits', async () => {
  const dir=mkdtempSync(join(tmpdir(),'odwyn-workflow-terminal-')),store=openStore(dir),runtime=new Runtime({store,codex:new Provider(),browser:{},workspace:dir});
  try {
    await runtime.refreshAccount();
    const workflow=validateWorkflow({name:'Terminal',command:'terminal',inputs:[{name:'value'}],steps:[{id:'shell',type:'terminal',action:{command:"printf '%s' {{inputs.value}}",reason:'Print data'},next:'report'},{id:'report',type:'output',prompt:'{{steps.shell.stdout}}'}]},store.state);
    store.state.workflows.push(workflow);const value="'; touch unexpected; $(echo injected)";
    runtime.submit({prompt:'/terminal '+JSON.stringify({value})});await new Promise(resolve=>setTimeout(resolve,0));
    const job=runtime.active;expect(job.pending.type).toBe('terminal');runtime.answer(job.id,{requestId:job.pending.id,decision:'allow'});await runtime.starting;await runtime.drain();
    expect(store.state.workflowRuns[0].outputs.report).toBe(value);
    const bad=validateWorkflow({name:'Failure',command:'failure',steps:[{id:'shell',type:'terminal',action:{command:'exit 7',reason:'Check exit status'}}]},store.state);
    store.state.workflows.push(bad);runtime.submit({prompt:'/failure',interactionMode:'allow'});await runtime.drain();
    expect(store.state.workflowRuns[0].status).toBe('failed');expect(store.state.jobs[0].workflowOutput.exitCode).toBe(7);
    store.deleteConversation(store.state.workflowRuns[0].conversationId);expect(store.state.workflowRuns).toHaveLength(1);
  } finally {runtime.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('canvas positions persist and invalid coordinates are rejected', () => {
  const workflow=validateWorkflow({...definition,steps:[{id:'read',type:'agent',prompt:'Read',position:{x:320,y:220}}]},{...state,workflows:[]});
  expect(workflow.steps[0].position).toEqual({x:320,y:220});
  expect(()=>validateWorkflow({...definition,steps:[{id:'read',type:'agent',prompt:'Read',position:{x:-1,y:0}}]},{...state,workflows:[]})).toThrow();
});
