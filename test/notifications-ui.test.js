import {newPageWithoutTutorials} from '../tests/browser-page.js';
import {test,expect} from 'bun:test';
import {chromium} from 'playwright';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.js';
import {defaults} from '../public/profile.js';

test('save feedback keeps accessible contrast, escapes HTML and respects keyboard focus',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-notifications-')),password='test-password-long-enough',codex=Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}});let app;
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});app=createApp({directory,user:'owner',password,origin:server.url.origin,providerOptions:{codex},browser:{close:async()=>{}},execution:{snapshotRoot:join(directory,'sources')}});
 const state=app.runtime.state;state.globalProvider.configured=true;state.agents[0].provider.configured=true;state.customization=state.agents[0].customization={...defaults,name:'Tester'};app.runtime.changed();
 const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'owner',password}}),page=await newPageWithoutTutorials(context),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(8000);
 const notice=async(tone,text)=>{await page.locator('#toast[data-tone="'+tone+'"]').filter({hasText:text}).waitFor();expect(await page.locator('#toast').evaluate(node=>node.matches(':popover-open'))).toBe(true);};
 try{
  await page.goto(server.url.href);
  // All three variants remain readable in both schemes, without HTML injection.
  const variants=await page.evaluate(async()=>{const {toast}=await import('/ui.js'),result=[];for(const scheme of ['light','dark']){document.documentElement.dataset.scheme=scheme;for(const tone of ['success','error','warning']){toast('<img src=x onerror=alert(1)>',tone);const node=document.querySelector('#toast'),style=getComputedStyle(node);result.push({scheme,tone,color:style.color,background:style.backgroundColor,images:node.querySelectorAll('img').length,text:node.querySelector('.toast-message').textContent});}}return result;});
  const luminance=value=>{const rgb=value.match(/[\d.]+/g).slice(0,3).map(value=>{const n=Number(value)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
  for(const item of variants){const a=luminance(item.color),b=luminance(item.background);expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toBeGreaterThanOrEqual(4.5);expect(item.images).toBe(0);expect(item.text).toContain('<img');}
  expect(new Set(variants.map(item=>item.background)).size).toBe(6);
  await page.evaluate(async()=>{const {toast}=await import('/ui.js');document.documentElement.dataset.scheme='light';toast('Saved. Your changes are ready.');});await page.screenshot({path:join(tmpdir(),'odwyn-success-toast.png')});expect(errors).toEqual([]);
  await page.clock.install();await page.mouse.move(0,0);await page.evaluate(async()=>{const {toast}=await import('/ui.js');toast('Keyboard-readable notification.');});await page.locator('#toast button').focus();await page.clock.fastForward(6000);expect(await page.locator('#toast').isVisible()).toBe(true);await page.locator('#toast button').click();await page.evaluate(async()=>{const {toast}=await import('/ui.js');toast('Temporary success.');});await page.mouse.move(0,0);await page.clock.fastForward(5001);expect(await page.locator('#toast').isVisible()).toBe(false);
 }finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},45000);
