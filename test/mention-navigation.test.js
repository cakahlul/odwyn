import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { defaults } from '../public/profile.js';

test('agent, workflow and skill mentions navigate from messages and composer without submitting',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-mention-links-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  const provider=Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex:provider,browser:{close:async()=>{}}});
  const first=app.runtime.state.agents[0],at=new Date().toISOString();
  app.runtime.state.customization={...defaults,name:'Oddy'};app.runtime.state.globalProvider.configured=true;first.provider.configured=true;
  app.runtime.state.agents.push({id:'rei',customization:{...defaults,name:'Rei',bodyColor:'#668ad6'},provider:{...first.provider,configured:false}});
  app.runtime.state.skills=[{id:'skill',name:'Review code',command:'review-code',description:'Review code.',instructions:'Review code.'}];
  app.runtime.state.workflows=[{id:'workflow',name:'PR Review FE',command:'pr-review-fe',inputs:[],steps:[{id:'review',type:'output',name:'Review',prompt:'Review'}],start:'review'}];
  app.runtime.state.conversations=[{id:'mentions',agentId:first.id,title:'Mention navigation',createdAt:at,messages:[{id:'message',agentId:first.id,role:'user',text:'@Rei /pr-review-fe /review-code',at}]}];app.runtime.changed();
  const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000);
  const returnToChat=async()=>{await page.locator('#history [data-conversation="mentions"]').click();await page.waitForFunction(()=>document.querySelector('#agent-name').textContent==='Oddy' && !document.querySelector('#agent-workspace').inert && location.hash==='#chat/mentions');await page.locator('#messages').waitFor();};
  try {
    await page.goto(server.url.href+'#chat/mentions');await page.locator('#messages').waitFor();
    await page.locator('#messages').getByRole('button',{name:'/pr-review-fe',exact:true}).click();
    await page.locator('#workflow-editor').waitFor();expect(await page.locator('#workflow-name').inputValue()).toBe('PR Review FE');expect(await page.locator('#page-title').textContent()).toBe('Workflows & skills');
    await page.locator('[data-wf-close]').click();await returnToChat();
    await page.locator('#messages').getByRole('button',{name:'/review-code',exact:true}).focus();await page.keyboard.press('Enter');
    await page.locator('#skill-editor').waitFor();expect(await page.locator('#skill-form [name=command]').inputValue()).toBe('review-code');
    await page.locator('[data-skill-close]').click();await returnToChat();
    await page.locator('#messages').getByRole('button',{name:'@Rei',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#agent-name').textContent==='Rei' && !document.querySelector('#agent-workspace').inert);
    await page.getByRole('heading',{name:'Message Rei',exact:true}).waitFor();await returnToChat();
    await page.locator('#prompt').fill('/pr-review-fe keep this draft');
    const box=await page.locator('#prompt-highlights .skill-mention').boundingBox();await page.mouse.click(box.x+5,box.y+box.height/2);
    await page.locator('#workflow-editor').waitFor();expect(await page.locator('#workflow-name').inputValue()).toBe('PR Review FE');
    await page.locator('[data-wf-close]').click();await returnToChat();expect(await page.locator('#prompt').inputValue()).toBe('/pr-review-fe keep this draft');
    await page.locator('#prompt').fill('/review-code');await page.locator('#prompt').evaluate(node=>node.setSelectionRange(4,4));await page.keyboard.press('Alt+Enter');
    await page.locator('#skill-editor').waitFor();expect(await page.locator('#skill-form [name=command]').inputValue()).toBe('review-code');
    await page.locator('[data-skill-close]').click();await returnToChat();
    await page.locator('#prompt').fill('@Rei');
    const agentBox=await page.locator('#prompt-highlights .agent-mention').boundingBox();await page.mouse.click(agentBox.x+5,agentBox.y+agentBox.height/2);
    await page.waitForFunction(()=>document.querySelector('#agent-name').textContent==='Rei' && !document.querySelector('#agent-workspace').inert);
    expect(app.runtime.state.jobs).toHaveLength(0);expect(errors).toEqual([]);
  } finally {await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30_000);
