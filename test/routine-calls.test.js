import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { defaults } from '../public/profile.js';
import { enqueueSchedules } from '../store.js';

test('routines select agents and execute skill or workflow calls with inputs',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-routine-calls-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  const provider=Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex:provider,browser:{close:async()=>{}}});
  const state=app.runtime.state,first=state.agents[0];
  state.customization={...defaults,name:'Oddy'};state.globalProvider.configured=true;first.provider.configured=true;
  state.agents.push({id:'rei',customization:{...defaults,name:'Rei'},provider:{...first.provider,configured:false}});
  state.skills=[{id:'skill',name:'Review code',command:'review-code',description:'Review code.',instructions:'Check code carefully.'}];
  state.workflows=[{id:'workflow',name:'PR Review',command:'pr-review',inputs:[{name:'url',label:'PR URL',required:true},{name:'focus',label:'Focus',default:'Frontend'}],steps:[{id:'review',type:'agent',name:'Review',prompt:'Review {{inputs.url}} for {{inputs.focus}}',tools:[],skills:[]}],start:'review',maxSteps:10}];app.runtime.changed();
  const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'owner',password:'test-password-long-enough'}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  try {
    await page.goto(server.url.href+'#routines');await page.getByRole('button',{name:'New routine',exact:true}).click();
    expect(await page.locator('#schedule-agent option').count()).toBe(2);
    await page.locator('#schedule-agent').selectOption('rei');await page.locator('#schedule-call').selectOption('review-code');await page.locator('#schedule-prompt').fill('Check security');
    await page.locator('#schedule-form button').click();await page.waitForFunction(()=>location.hash==='#routines' && document.querySelector('#agent-name').textContent==='Rei' && !document.querySelector('#schedule-dialog').open);
    expect(state.schedules[0].agentId).toBe('rei');expect(state.schedules[0].prompt).toBe('/review-code Check security');
    await page.getByRole('button',{name:'New routine',exact:true}).click();await page.locator('#schedule-call').selectOption('pr-review');
    expect(await page.locator('#schedule-task-field').isVisible()).toBe(false);
    expect(await page.locator('#schedule-inputs [name=focus]').inputValue()).toBe('Frontend');
    await page.locator('#schedule-form button').click();expect(state.schedules.length).toBe(1);
    await page.locator('#schedule-inputs [name=url]').fill('https://example.com/pr/1');await page.locator('#schedule-form button').click();await page.waitForFunction(()=>!document.querySelector('#schedule-dialog').open);
    expect(state.schedules[0].prompt).toBe('/pr-review {"url":"https://example.com/pr/1","focus":"Frontend"}');
    expect(()=>app.runtime.schedule({agentId:'rei',prompt:'/missing',at:new Date(Date.now()+3600000).toISOString()})).toThrow('Unknown command');
    state.schedules.forEach(s=>s.nextAt='2020-01-01T00:00:00Z');
    enqueueSchedules(state,new Date(),input=>app.runtime.submit(input));
    const skillJob=state.jobs.find(j=>j.scheduleId===state.schedules[1].id),workflowJob=state.jobs.find(j=>j.scheduleId===state.schedules[0].id);
    expect(skillJob.agentId).toBe('rei');expect(skillJob.prompt).toContain('Check code carefully.');expect(skillJob.prompt).toContain('Check security');
    expect(workflowJob.agentId).toBe('rei');expect(workflowJob.prompt).toContain('https://example.com/pr/1');expect(state.workflowRuns[0].inputs.focus).toBe('Frontend');
    expect(errors).toEqual([]);
  } finally {await browser.close();server.stop(true);app.close();rmSync(directory,{recursive:true,force:true});}
});
