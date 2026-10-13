import {chromium} from 'playwright';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {Browser} from '../browser.js';

export async function openBrowserPage(input){
  input ||= JSON.parse(readFileSync('/tmp/browser-page.json','utf8'));
  if(Object.keys(input).some(k=>!['url','html'].includes(k))||typeof input.url!=='string'||!/^https?:\/\//.test(input.url)||typeof input.html!=='string'||Buffer.byteLength(input.html)>262144)throw new Error('Invalid browser input.');
  // The full Chromium process is enclosed by the default-seccomp, network-none
  // container; no host IPC, sockets, profile mounts or renderer-selected egress.
  const context=await chromium.launchPersistentContext('/tmp/profile',{executablePath:'/usr/bin/chromium',headless:true,javaScriptEnabled:false,acceptDownloads:false,serviceWorkers:'block',viewport:{width:1280,height:800},env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp'}});
  try{
    if(existsSync('/tmp/browser-cookies.json'))await context.addCookies(JSON.parse(readFileSync('/tmp/browser-cookies.json','utf8')));
    let supplied=false;
    await context.route('**/*',route=>{
      const request=route.request();
      if(!supplied&&request.isNavigationRequest()&&request.frame()===context.pages()[0]?.mainFrame()&&request.url()===input.url&&request.method()==='GET'){
        supplied=true;return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:input.html});
      }
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*',socket=>socket.close());
    const page=context.pages()[0];page.on('dialog',dialog=>dialog.dismiss());
    await page.goto(input.url,{waitUntil:'domcontentloaded',timeout:10000});
    return {context,page};
  }catch(error){await context.close();throw error;}
}

export async function closeBrowserPage(context){
  try{writeFileSync('/tmp/browser-cookies.json',JSON.stringify(await context.cookies()),{mode:0o600});}
  finally{await context.close();}
}

if(import.meta.main){
  const bytes=await Bun.stdin.text();if(Buffer.byteLength(bytes)>270000)throw new Error('Bounded browser input required.');
  let input=JSON.parse(bytes);if(!Object.keys(input).length)input=undefined;
  const {context,page}=await openBrowserPage(input);
  try{
    const browser=new Browser({directory:'/tmp/profile'});browser.context=context;browser.page=page;
    const snapshot=await browser.snapshot();
    if(input)writeFileSync('/tmp/browser-page.json',JSON.stringify(input),{mode:0o600});
    console.log(JSON.stringify(snapshot));
  }finally{await closeBrowserPage(context);}
}
