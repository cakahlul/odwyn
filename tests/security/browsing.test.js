import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,createJob} from '../../store.js';
import {browserUrl,browserCapability} from '../../security/browser-scope.js';
import {ScopedBrowsers} from '../../security/scoped-browser.js';
function fixture(){const directory=mkdtempSync(join(tmpdir(),'odwyn-browsing-')),store=openStore(directory);return {store,p:store.security,a:store.state.agents[0].id,close(){store.close();rmSync(directory,{recursive:true,force:true});}};}
test('Browsing blocklist covers subdomains, normalized domains and private destinations',()=>{
 const metadata={blockedDomains:['example.com','xn--bcher-kva.example']};
 for(const url of ['https://example.com/','https://deep.example.com/a','https://EXAMPLE.com./','https://bücher.example/','http://127.0.0.1/','http://[::1]/','https://user:pass@public.example/','file:///tmp/file'])expect(()=>browserUrl(metadata,url)).toThrow();
 expect(browserUrl(metadata,'https://notexample.com/research').hostname).toBe('notexample.com');
 expect(browserUrl({blockedDomains:[]},'https://research.example/new')).not.toBeNull();
 expect(()=>browserUrl({readUrls:['https://reviewed.example/read']},'https://reviewed.example/other')).toThrow();
 expect(browserUrl({readUrls:['https://reviewed.example/read']},'https://reviewed.example/read').href).toBe('https://reviewed.example/read');expect(()=>browserUrl({},'https://public.example/')).toThrow();
});
test('Browsing configuration is validated, legacy scopes preserved, and Interaction independently granted',()=>{
 const f=fixture();try{
  const {p,a}=f,s=p.createSpace({name:'Research'}),legacy=p.createResource({spaceId:s.id,type:'browser',name:'Legacy',metadata:{readUrls:['https://reviewed.example/read']}});
  const r=p.createResource({spaceId:s.id,type:'browser',name:'Browsing',metadata:{blockedDomains:['Example.COM.']}});expect(r.metadata.blockedDomains).toEqual(['example.com']);
  for(const domains of [['https://example.com'],['example.com/path'],['*.example.com'],['example.com:443'],['bad host'],[null]])expect(()=>p.createResource({spaceId:s.id,type:'browser',name:'Bad',metadata:{blockedDomains:domains}})).toThrow();
  expect(()=>p.createResource({spaceId:s.id,type:'browser',name:'Mixed',metadata:{readUrls:['https://reviewed.example/read'],blockedDomains:[]}})).toThrow();
  p.configureBrowser(true);p.putAccess(a,{revision:p.revision,spaceIds:[s.id],grants:[{spaceId:s.id,resourceId:r.id,action:'browser.read',mode:'auto'},{spaceId:s.id,resourceId:r.id,action:'browser.navigate',mode:'auto'}]});
  const request={agentId:a,spaceId:s.id,resourceId:r.id};expect(p.simulate({...request,action:'browser.navigate'}).mode).toBe('auto');expect(p.simulate({...request,action:'browser.interact'}).mode).toBe('deny');expect(p.catalog().find(c=>c.action==='browser.interact').available).toBe(true);
  p.putAccess(a,{revision:p.revision,spaceIds:[s.id],grants:[...p.access(a).grants.map(({spaceId,resourceId,action,mode})=>({spaceId,resourceId,action,mode})),{spaceId:s.id,resourceId:r.id,action:'browser.interact',mode:'ask'}]});expect(p.simulate({...request,action:'browser.interact'}).mode).toBe('ask');
  p.updateResource(legacy.id,{name:'Renamed legacy',metadata:legacy.metadata});expect(p.resource(legacy.id).metadata).toEqual(legacy.metadata);expect(browserCapability('click')).toBe('browser.interact');expect(browserCapability('navigate')).toBe('browser.navigate');expect(()=>browserCapability('upload')).toThrow();
 }finally{f.close();}
});
test('public-web redirects are checked before fetching; legacy redirects stay denied',async()=>{
 const f=fixture(),calls=[],site=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){const path=new URL(req.url).pathname;calls.push(path);if(path==='/blocked')return Response.redirect('https://blocked.example/secret',302);if(path==='/allowed')return Response.redirect('/result',302);if(path==='/loop')return Response.redirect('/loop',302);return new Response('<body>Research result</body>',{headers:{'content-type':'text/html'}});}});
 const browsers=new ScopedBrowsers(f.store,{resolver:async raw=>({url:new URL('http://fixture.example:'+site.port+new URL(raw).pathname),address:'127.0.0.1',family:4})});
 try{
  const metadata={blockedDomains:['blocked.example']},signal=AbortSignal.timeout(5000);
  const result=await browsers.page('https://fixture.example/allowed',()=>{},signal,metadata);expect(result.url).toBe('https://fixture.example/result');expect(result.html).toContain('Research result');
  await expect(browsers.page('https://fixture.example/blocked',()=>{},signal,metadata)).rejects.toThrow();expect(calls).not.toContain('/secret');
  await expect(browsers.page('https://fixture.example/allowed',()=>{},signal,{readUrls:['https://fixture.example/allowed']})).rejects.toThrow();
  await expect(browsers.page('https://fixture.example/loop',()=>{},signal,metadata)).rejects.toThrow();
 }finally{site.stop(true);await browsers.close();f.close();}
});
test('browser Interaction and navigation Ask modes use exact approvals, and read denial always wins',async()=>{
 const {createApp}=await import('../../server.js'),{FixtureProvider}=await import('./fixtures.js'),provider=new FixtureProvider(),directory=mkdtempSync(join(tmpdir(),'odwyn-browser-approval-')),origin='http://127.0.0.1:4317',password='disposable-password';
 const app=createApp({directory,user:'owner',password,origin,codex:provider,browser:{close:async()=>{}}}),store=app.runtime.store,p=store.security,a=store.state.agents[0].id,s=p.createSpace({name:'Research'}),r=p.createResource({spaceId:s.id,type:'browser',name:'Browsing',metadata:{blockedDomains:['blocked.example']}}),effects=[];
 const browsers=new ScopedBrowsers(store,{image:'sha256:'+'0'.repeat(64)});let currentUrl='https://research.example/';
 browsers.executor.create=async()=>{};browsers.executor.docker=async()=>({exitCode:0});browsers.page=async url=>({url,html:'<button>Show more</button>'});
 browsers.executor.inside=async(_worker,_argv,{input})=>{const value=JSON.parse(input);effects.push(value);if(value.url)currentUrl=value.url;return {exitCode:0,stdout:Buffer.from(JSON.stringify({url:currentUrl,text:'Research',elements:[]}))};};
 app.runtime.scopedBrowsers=browsers;p.configureBrowser(true);
 const grant=(read,navigate,interact)=>p.putAccess(a,{revision:p.revision,spaceIds:[s.id],grants:[['browser.read',read],['browser.navigate',navigate],['browser.interact',interact]].map(([action,mode])=>({spaceId:s.id,resourceId:r.id,action,mode}))});
 const request=(path,body,cookie)=>app.fetch(new Request(origin+path,{method:'POST',headers:{origin,authorization:'Basic '+btoa('owner:'+password),'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)}));
 const invoke=async(job,args)=>{app.runtime.active=job;const id=crypto.randomUUID();await app.runtime.executeRequest({id,method:'item/tool/call',params:{threadId:job.threadId,tool:'odwyn_browser',arguments:{resourceId:r.id,...args}}});return provider.replies.find(reply=>reply.id===id).result;};
 const approve=async reply=>{const id=JSON.parse(reply.contentItems[0].text).approvalId;expect(id).toBeDefined();const auth=await request('/api/security/reauth',{password,approvalId:id});expect(auth.status).toBe(200);expect((await request('/api/approvals/'+id+'/decision',{decision:'approve'},auth.headers.get('set-cookie').split(';')[0])).status).toBe(200);return id;};
 try{
  grant('auto','auto','deny');const job=createJob(store.state,{agentId:a,spaceId:s.id,prompt:'Research'});job.status='running';job.threadId=crypto.randomUUID();
  expect((await invoke(job,{action:'click',ref:'0'})).success).toBe(false);expect(effects).toHaveLength(0);
  grant('auto','auto','ask');const pending=await invoke(job,{action:'click',ref:'0'});expect(pending.success).toBe(false);expect(effects).toHaveLength(0);const id=await approve(pending);
  expect((await invoke(job,{action:'click',ref:'0',approvalId:id})).success).toBe(true);expect(effects[0].control).toEqual({action:'click',ref:'0'});
  grant('ask','ask','deny');const navigation=await invoke(job,{action:'navigate',url:'https://research.example/'});expect(effects).toHaveLength(1);const navigationId=await approve(navigation);expect((await invoke(job,{action:'navigate',url:'https://research.example/',approvalId:navigationId})).success).toBe(true);expect(effects).toHaveLength(2);
  grant('ask','auto','auto');const readPending=await invoke(job,{action:'navigate',url:'https://research.example/other'});expect(effects).toHaveLength(2);const readId=await approve(readPending);expect((await invoke(job,{action:'navigate',url:'https://research.example/other',approvalId:readId})).success).toBe(true);expect(effects).toHaveLength(3);
  grant('deny','auto','auto');expect(p.simulate({agentId:a,spaceId:s.id,resourceId:r.id,action:'browser.interact'}).mode).toBe('deny');expect((await invoke(job,{action:'click',ref:'0'})).success).toBe(false);expect(effects).toHaveLength(3);
  grant('auto','auto','auto');expect((await invoke(job,{action:'navigate',url:'https://blocked.example/'})).success).toBe(false);expect(effects).toHaveLength(3);
 }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});
