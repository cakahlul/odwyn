import {chromium} from 'playwright';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {Browser} from '../browser.js';
import {browserActionRisk,validateAction} from '../security.js';
const cookieFiles=new WeakMap();

export async function openBrowserPage(input,options={}){
  if(!input){const saved=JSON.parse(readFileSync('/tmp/browser-page.json','utf8'));input={url:saved.url,html:saved.html};}
  if(Object.keys(input).some(k=>!['url','html'].includes(k))||typeof input.url!=='string'||!/^https?:\/\//.test(input.url)||typeof input.html!=='string'||Buffer.byteLength(input.html)>262144)throw new Error('Invalid browser input.');
  // The full Chromium process is enclosed by the default-seccomp, network-none
  // container; no host IPC, sockets, profile mounts or renderer-selected egress.
  const context=await chromium.launchPersistentContext(options.profileDirectory||'/tmp/profile',{executablePath:options.executablePath||'/usr/bin/chromium',headless:true,javaScriptEnabled:options.interactive===true,acceptDownloads:false,serviceWorkers:'block',viewport:{width:1280,height:800},env:options.executablePath?undefined:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp'}});
  try{
    const cookiePath=options.cookiePath||'/tmp/browser-cookies.json';cookieFiles.set(context,cookiePath);
    if(existsSync(cookiePath))await context.addCookies(JSON.parse(readFileSync(cookiePath,'utf8')));
    let supplied=false;
    await context.route('**/*',route=>{
      const request=route.request();
      if(!supplied&&request.isNavigationRequest()&&request.frame()===context.pages()[0]?.mainFrame()&&request.url()===input.url&&request.method()==='GET'){
        supplied=true;return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:input.html});
      }
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*',socket=>socket.close());
    const page=context.pages()[0];page.setDefaultTimeout(5000);page.on('dialog',dialog=>dialog.dismiss());
    await page.goto(input.url,{waitUntil:'domcontentloaded',timeout:10000});
    return {context,page};
  }catch(error){await context.close();throw error;}
}

export async function closeBrowserPage(context){
  try{writeFileSync(cookieFiles.get(context)||'/tmp/browser-cookies.json',JSON.stringify(await context.cookies()),{mode:0o600});}
  finally{await context.close();}
}

export async function runBrowserPage(request,options={}){
  const statePath=options.statePath||'/tmp/browser-page.json';
  if(!request||Array.isArray(request)||typeof request!=='object'||Object.keys(request).some(k=>!['url','html','control'].includes(k))||request.control&&(request.url!==undefined||request.html!==undefined))throw new Error('Unsupported browser worker request.');
  const saved=request.url!==undefined?null:JSON.parse(readFileSync(statePath,'utf8'));
  const input=request.url!==undefined?request:{url:saved.url,html:saved.html};
  if(request.control){
    const command=validateAction(request.control),element=saved.elements?.find(e=>e.ref===String(command.ref));
    if(command.action==='click'&&element?.tag==='a'&&/^https?:/.test(element.href||'')){const target=new URL(element.href),fragment=target.hash;target.hash='';if(!fragment||target.href!==saved.url)throw new Error('Use Open pages (navigate) for links.');}
  }

  const {context,page}=await openBrowserPage(input,{...options,cookiePath:join(dirname(statePath),'browser-cookies.json'),interactive:!!request.control});
  try{
    const browser=new Browser({directory:options.profileDirectory||'/tmp/profile'});browser.context=context;browser.page=page;
    let snapshot=await browser.snapshot();
    if(request.control){
      const command=validateAction(request.control);
      if(!['click','fill','type','select','press','scroll','wait'].includes(command.action))throw new Error('Unsupported isolated page control.');
      if(command.ref!==undefined){
        const previous=saved.elements?.find(e=>e.ref===String(command.ref)),current=snapshot.elements.find(e=>e.ref===String(command.ref));
        if(!previous||!current||previous.tag!==current.tag||previous.label!==current.label||previous.href!==current.href)throw new Error('Page controls changed; read a fresh snapshot before interacting.');
      }
      const inspected=await browser.inspectAction(command),risk=browserActionRisk(command,inspected);
      if(['payment','credential'].includes(risk))throw new Error('Payments and credential entry require owner takeover.');
      if(command.action==='click'&&inspected.element?.tag==='a'&&/^https?:/.test(inspected.element.href||'')){const target=new URL(inspected.element.href),fragment=target.hash;target.hash='';if(!fragment||target.href!==input.url)throw new Error('Use Open pages (navigate) for links.');}
      snapshot=await browser.action(command);
    }
    const currentUrl=new URL(snapshot.url);currentUrl.hash='';if(currentUrl.href!==input.url)throw new Error('Page control attempted navigation. Use Open pages; network form submissions are unavailable.');
    snapshot.url=input.url;
    // Persist the visible DOM, not executable browser state, between bounded worker calls.
    await page.evaluate(()=>{for(const e of document.querySelectorAll('input,textarea,select')){if(e.tagName==='INPUT'){e.setAttribute('value',e.value);e.toggleAttribute('checked',e.checked);}else if(e.tagName==='TEXTAREA')e.textContent=e.value;else for(const o of e.options)o.toggleAttribute('selected',o.selected);}});
    const html=await page.content();if(Buffer.byteLength(html)>262144)throw new Error('Browser page exceeds bounds.');
    writeFileSync(statePath,JSON.stringify({url:input.url,html,elements:snapshot.elements}),{mode:0o600});return snapshot;
  }finally{await closeBrowserPage(context);}
}
if(import.meta.main){
  const bytes=await Bun.stdin.text();if(Buffer.byteLength(bytes)>270000)throw new Error('Bounded browser input required.');
  console.log(JSON.stringify(await runBrowserPage(JSON.parse(bytes))));
}
