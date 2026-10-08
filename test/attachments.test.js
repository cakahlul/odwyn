import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { createRoom } from '../store.js';
import { defaults } from '../public/profile.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64');
const imageUrl = `data:image/png;base64,${png.toString('base64')}`;
const wait = async predicate => { for (let i=0;i<500;i++) { if (predicate()) return; await Bun.sleep(10); } throw new Error('Timed out'); };
function fakeCodex(inputs) {
  const codex = Object.assign(new EventEmitter(),{stop(){},child:{},request:async(method,params)=>{
    if (method === 'account/read') return {account:{type:'chatgpt'}};
    if (method.startsWith('thread/')) return {thread:{id:params.threadId || crypto.randomUUID()}};
    if (method === 'turn/start') {
      inputs.push(params.input);
      const id = crypto.randomUUID();
      setTimeout(()=>codex.emit('notification',{method:'turn/completed',params:{threadId:params.threadId,turn:{id,status:'completed'}}}),5);
      return {turn:{id}};
    }
    return {};
  }});
  return codex;
}

for (const type of ['codex','claude','openai']) test(`${type} receives attachment bytes; previews, history, rooms and isolation survive`,async()=>{
  const directory = mkdtempSync(join(tmpdir(),'odwyn-attachments-')), inputs = [];
  const origin = 'https://assistant.test';
  const app = createApp({directory,origin,user:'owner',password:'test-password-long-enough',codex:fakeCodex(inputs),browser:{close:async()=>{}},providerOptions:{
    claudeAuth:async()=>({loggedIn:true}),
    query:({prompt})=>(async function*(){
      inputs.push((await prompt[Symbol.asyncIterator]().next()).value.message.content);
      yield {type:'assistant',message:{content:[{type:'text',text:'Seen.'}]}};
      yield {type:'result',subtype:'success'};
    })(),
    fetch:async(url,options)=>{ inputs.push(JSON.parse(options.body).messages.at(-1).content); return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'Seen.'}}]}); },
  }});
  const headers = {authorization:'Basic '+Buffer.from('owner:test-password-long-enough').toString('base64'),origin};
  const request = (path,method='GET',body)=>app.fetch(new Request(origin+path,{method,headers:{...headers,...(body && !(body instanceof FormData) ? {'content-type':'application/json'} : {})},...(body ? {body:body instanceof FormData ? body : JSON.stringify(body)} : {})}));
  const upload = async(name,bytes)=>{
    const form = new FormData(); form.append('file',new File([bytes],name,{type:'text/plain'}));
    const response = await request('/api/files','POST',form); expect(response.status).toBe(201); return response.json();
  };
  const expectImage = content=>{
    expect(Array.isArray(content)).toBe(true);
    if (type === 'codex') expect(content.find(p=>p.type==='image').url).toBe(imageUrl);
    if (type === 'claude') expect(content.find(p=>p.type==='image').source).toEqual({type:'base64',media_type:'image/png',data:png.toString('base64')});
    if (type === 'openai') expect(content.find(p=>p.type==='image_url').image_url.url).toBe(imageUrl);
  };
  try {
    expect((await request('/api/provider','PUT',{type,model:type==='claude' ? 'sonnet' : 'vision-model'})).status).toBe(200);
    await app.runtime.refreshAccount();
    const image = await upload('photo-with-wrong-mime',png), notes = await upload('notes.txt',Buffer.from('Attachment-specific evidence.'));
    expect(image.mimeType).toBe('image/png'); expect(image.size).toBe(png.length);
    const preview = await request(`/api/files/${image.id}/preview`);
    expect(preview.headers.get('content-type')).toBe('image/png'); expect(Buffer.from(await preview.arrayBuffer())).toEqual(png);
    const first = app.runtime.submit({prompt:'Inspect these',attachments:[image.id,notes.id,image.id]});
    await wait(()=>first.status==='completed');
    expectImage(inputs[0]); expect(inputs[0].some(p=>p.text?.includes('Attachment-specific evidence.'))).toBe(true);
    expect(first.attachments).toEqual([image.id,notes.id]); expect(app.runtime.conversation(first).messages[0].attachments).toEqual(first.attachments);
    const follow = app.runtime.submit({conversationId:first.conversationId,prompt:'What about that image?'});
    await wait(()=>follow.status==='completed'); expectImage(inputs[1]);
    const separate = app.runtime.submit({prompt:'Separate conversation'});
    await wait(()=>separate.status==='completed'); expect(JSON.stringify(inputs[2])).not.toContain(png.toString('base64'));
    const second = {id:crypto.randomUUID(),customization:{...defaults,name:'Second'}};
    app.runtime.state.agents.push(second);
    const room = createRoom(app.runtime.state,{title:'Attachment room',memberIds:[first.agentId,second.id]});
    const roomJob = app.runtime.submitRoom(room.id,{prompt:'',agentId:first.agentId,attachments:[image.id]})[0];
    await wait(()=>inputs.length===4); expectImage(inputs[3]); await app.runtime.cancelRoom(room.id);
    const count = app.runtime.state.jobs.length;
    for (const attachments of [['../../etc/passwd'],[null],null,'bad',Array(21).fill(image.id)]) expect(()=>app.runtime.submit({prompt:'Invalid',attachments})).toThrow('uploaded files');
    expect(app.runtime.state.jobs.length).toBe(count);
    expect((await request('/api/jobs','POST',{prompt:'Invalid',attachments:['missing']})).status).toBe(400);
  } finally {await app.close();rmSync(directory,{recursive:true,force:true});}
});

test('image picker and paste show removable previews; image-only sends persist in chat',async()=>{
  const directory = mkdtempSync(join(tmpdir(),'odwyn-attachment-ui-')), inputs = []; let app;
  const server = Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app = createApp({directory,origin:server.url.origin,user:'owner',password:'test-password-long-enough',codex:fakeCodex(inputs),browser:{close:async()=>{}}});
  app.runtime.state.customization={...defaults};app.runtime.state.agents[0].customization={...defaults};
  app.runtime.state.globalProvider.configured=true;app.runtime.state.agents[0].provider.configured=true;await app.runtime.refreshAccount();app.runtime.changed();
  const browser = await chromium.launch(), page = await browser.newPage({httpCredentials:{username:'owner',password:'test-password-long-enough'}});
  page.setDefaultTimeout(5000); const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto(server.url.href);await page.locator('#prompt').waitFor();
    await page.locator('#file-input').setInputFiles([{name:'photo.png',mimeType:'image/png',buffer:png},{name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('Notes')}]);
    await page.waitForFunction(()=>document.querySelectorAll('.attachment-chip').length===2 && !document.querySelector('#send-button').disabled);
    expect(await page.locator('.attachment-chip img').evaluate(img=>img.complete && img.naturalWidth===1)).toBe(true);
    await page.locator('#prompt').evaluate((node,data)=>{
      const clipboard = new DataTransfer();clipboard.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'pasted.png',{type:'image/png'}));
      node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));
    },png.toString('base64'));
    await page.waitForFunction(()=>document.querySelectorAll('.attachment-chip').length===3 && !document.querySelector('#send-button').disabled);
    expect(await page.locator('.attachment-chip img').count()).toBe(2);
    expect(await page.locator('#prompt').evaluate(node=>{
      const clipboard = new DataTransfer();clipboard.setData('text/plain','normal text');
      return node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));
    })).toBe(true);
    await page.locator('[aria-label="Remove photo.png"]').click();
    expect(await page.locator('.attachment-chip').count()).toBe(2);
    await page.route('**/api/jobs',route=>route.fulfill({status:400,json:{error:'Try again.'}}));
    const rejected = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/jobs' && response.status()===400);
    await page.locator('#send-button').click();await rejected;
    await page.waitForFunction(()=>!document.querySelector('#send-button').disabled);
    expect(await page.locator('.attachment-chip').count()).toBe(2);expect(app.runtime.state.jobs).toHaveLength(0);
    await page.unroute('**/api/jobs');
    const submitted = page.waitForRequest(req=>new URL(req.url()).pathname==='/api/jobs' && req.method()==='POST');
    await page.locator('#send-button').click();
    const body = (await submitted).postDataJSON();expect(body.prompt).toBe('');expect(body.attachments).toHaveLength(2);
    await page.locator('.message-user .answer-file img').waitFor();
    expect(await page.locator('.message-user .answer-file img').evaluate(img=>img.complete && img.naturalWidth===1)).toBe(true);
    expect(await page.locator('.attachment-chip').count()).toBe(0);
    await page.reload();await page.locator('.message-user .answer-file img').waitFor();
    expect(inputs[0].find(p=>p.type==='image').url).toBe(imageUrl);expect(errors).toEqual([]);
  } finally {await browser.close();await app.close();await server.stop(true);rmSync(directory,{recursive:true,force:true});}
},20_000);
