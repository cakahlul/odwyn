import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {newPageWithoutTutorials} from '../tests/browser-page.js';
import {defaults} from '../public/profile.js';

function fixture(origin){
  const directory=mkdtempSync(join(tmpdir(),'odwyn-report-api-')),codex=Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}});
  let fail=false,calls=[];
  const app=createApp({directory,user:'owner',password:'test-password-long-enough',origin,codex,browser:{close:async()=>{}},providerOptions:{codex,fetch:async(url,options)=>{
    const input=JSON.parse(options.body);calls.push(input);
    expect(input.tools).toBeUndefined();expect(url).toBe('https://reports.example/v1/chat/completions');
    if(fail)return new Response('',{status:503});
    return Response.json({choices:[{message:{role:'assistant',content:'## Overview\nThe launch is planned for June.\n\n## Decisions\nBudget approved: $500.\n\n## Open questions\nVenue remains undecided.\n\n## Next steps\nChoose a venue. [Research](https://example.com/research)'},finish_reason:'stop'}]});
  }}});
  const state=app.runtime.state,agent=state.agents[0],id=randomUUID(),roomId=randomUUID();
  state.customization={...defaults};
  agent.provider={configured:true,type:'openai',model:'report-model',baseUrl:'https://reports.example/v1',apiKey:'report-secret'};state.globalProvider.configured=true;
  state.conversations=[{id,agentId:agent.id,title:'Launch plan',createdAt:new Date().toISOString(),messages:[{id:randomUUID(),role:'user',text:'Plan the June launch with a $500 budget.',at:new Date().toISOString()}]},{id:roomId,kind:'room',memberIds:[agent.id],agentId:agent.id,title:'Launch review',createdAt:new Date().toISOString(),messages:[{id:randomUUID(),agentId:agent.id,role:'assistant',text:'Budget approved; venue remains undecided.',at:new Date().toISOString()}]}];app.runtime.changed();
  const headers={authorization:'Basic '+Buffer.from('owner:test-password-long-enough').toString('base64'),origin,'content-type':'application/json'};
  const request=(path,method='GET',body)=>app.fetch(new Request(origin+path,{method,headers,body:body?JSON.stringify(body):undefined}));
  return {app,state,id,roomId,request,calls,setFail:value=>{fail=value;},async close(){await app.close();rmSync(directory,{recursive:true,force:true});}};
}

test('report endpoints enforce authentication, origin and workspace isolation and return a PDF without modifying source',async()=>{
  const f=fixture('https://odwyn.test'),before=JSON.stringify(f.state.conversations);
  try{
    expect((await f.app.fetch(new Request('https://odwyn.test/api/conversations/'+f.id+'/report',{method:'POST'}))).status).toBe(401);
    expect((await f.app.fetch(new Request('https://odwyn.test/api/conversations/'+f.id+'/report',{method:'POST',headers:{authorization:'Basic '+Buffer.from('owner:test-password-long-enough').toString('base64'),origin:'https://elsewhere.test'}}))).status).toBe(403);
    expect((await f.request('/api/conversations/'+randomUUID()+'/report','POST')).status).toBe(400);
    const started=await f.request('/api/conversations/'+f.id+'/report','POST');expect(started.status).toBe(202);
    const {id}=await started.json();let report;
    for(let n=0;n<100;n++){report=await (await f.request('/api/reports/'+id)).json();if(report.status!=='generating')break;await Bun.sleep(5);}
    expect(report.status).toBe('ready');expect(report.markdown).toContain('## Decisions');
    const preview=await f.request('/api/reports/'+id+'/preview');expect(preview.headers.get('content-type')).toContain('text/html');expect(await preview.text()).toContain('<h2>Overview</h2>');
    const pdf=await f.request('/api/reports/'+id+'/pdf');expect(pdf.headers.get('content-type')).toBe('application/pdf');expect(pdf.headers.get('content-disposition')).toContain('Launch-plan.pdf');
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString()).toBe('%PDF-');
    const other=await (await f.request('/api/workspaces','POST',{name:'Other'})).json();
    expect((await f.request('/api/reports/'+id+'?workspace='+other.id)).status).toBe(404);
    expect(JSON.stringify(f.state.conversations)).toBe(before);expect(f.state.jobs).toHaveLength(0);
    await f.request('/api/reports/'+id,'DELETE');expect((await f.request('/api/reports/'+id)).status).toBe(404);
  }finally{await f.close();}
},20_000);

test('desktop and mobile export preview, retry failed generation, and download reports from chats and rooms',async()=>{
  let f;const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>f.app.fetch(req,srv)});
  f=fixture(server.url.origin);
  const browser=await chromium.launch(),page=await newPageWithoutTutorials(browser,{httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:960}});
  page.setDefaultTimeout(10_000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(server.url.href+'#chat/'+f.id);
    f.setFail(true);
    await page.locator('#conversation-menu-open').click();await page.locator('#export-report').click();
    await page.locator('#report-status').filter({hasText:'failed'}).waitFor();
    expect(await page.locator('#report-download').isDisabled()).toBe(true);
    f.setFail(false);await page.locator('#report-retry').click();
    await page.frameLocator('#report-preview').getByRole('heading',{name:'Overview',exact:true}).waitFor();
    expect(await page.frameLocator('#report-preview').locator('main').textContent()).toContain('Venue remains undecided');
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#report-download').click()]);
    expect(download.suggestedFilename()).toBe('Launch-plan.pdf');expect(await download.failure()).toBeNull();
    mkdirSync('artifacts',{recursive:true});await page.screenshot({path:'artifacts/conversation-report-desktop.png'});
    await page.getByRole('button',{name:'Close report',exact:true}).click();
    for(const width of [320,375]){
      await page.setViewportSize({width,height:812});
      await page.goto(server.url.href+'#chat/'+f.roomId);
      await page.locator('#conversation-menu-open').click();await page.locator('#export-report').click();
      await page.frameLocator('#report-preview').getByRole('heading',{name:'Overview',exact:true}).waitFor();
      expect(await page.locator('#report-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      expect(await page.frameLocator('#report-preview').locator('body').evaluate(node=>node.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      expect(await page.locator('#report-download').isVisible()).toBe(true);
      await page.screenshot({path:`artifacts/conversation-report-${width}.png`});
      await page.getByRole('button',{name:'Close report',exact:true}).click();
    }
    expect(f.state.jobs).toHaveLength(0);expect(f.state.conversations[0].messages).toHaveLength(1);expect(errors).toEqual([]);
  }finally{await browser.close();server.stop(true);await f.close();}
},30_000);
