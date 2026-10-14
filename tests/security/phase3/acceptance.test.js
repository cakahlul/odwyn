import {test,expect} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {Database} from 'bun:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,createJob,createRoom,updateRoom,enqueueSchedules} from '../../../store.js';
import {Runtime} from '../../../runtime.js';
import {FixtureProvider} from '../fixtures.js';
import {createApp} from '../../../server.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {z} from 'zod';
import {isolatedBrowsers,browserProbe} from '../browser-fixture.js';
import {fixture as sandboxFixture} from '../phase2/fixture.js';

function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'odwyn-data-')),store=openStore(directory),provider=new FixtureProvider();
  const runtime=new Runtime({store,codex:provider,browser:{close:async()=>{}},workspace:directory});
  const p=store.security,a=store.state.agents[0].id,b=randomUUID();store.state.agents.push({id:b,customization:{name:'Clay comet'}});runtime.addProvider(b,provider);
  const A=p.createSpace({name:'Lichen '+randomUUID()}),B=p.createSpace({name:'Ceramic '+randomUUID()});
  const memoryA=p.createResource({spaceId:A.id,type:'memory',name:'A notes'}),memoryB=p.createResource({spaceId:B.id,type:'memory',name:'B notes'});
  const grant=(agent,spaces,grants)=>p.putAccess(agent,{revision:p.revision,spaceIds:spaces.map(s=>s.id),grants:grants.map(([r,action])=>({spaceId:r.spaceId,resourceId:r.id,action,mode:'auto'}))});
  grant(a,[A,B],[[memoryA,'memory.read'],[memoryA,'memory.write']]);grant(b,[A,B],[[memoryB,'memory.read']]);
  const job=(agent=a,space=A)=>createJob(store.state,{agentId:agent,spaceId:space.id,prompt:'Synthetic task'});
  const invoke=async(j,tool,args)=>{runtime.active=j;j.status='running';j.threadId ||= randomUUID();const id=randomUUID();await runtime.executeRequest({id,method:'item/tool/call',params:{threadId:j.threadId,tool,arguments:args}});return provider.replies.find(r=>r.id===id).result;};
  return {directory,store,provider,runtime,p,a,b,A,B,memoryA,memoryB,grant,job,invoke,async close(){await runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}};
}
async function probe(id,run){let f;try{f=fixture();const observations=await run(f);record(id,'PASS',observations);}catch(error){record(id,error.message.startsWith('BLOCKED:')?'BLOCKED':'FAIL',{assertionsFailed:true});throw error;}finally{await f?.close();}}
const records=new Map();
function record(caseId,status,observations){const dir=process.env.ODWYN_SECURITY_REPORT_DIR;if(!dir)throw new Error('BLOCKED: ODWYN_SECURITY_REPORT_DIR required');const previous=records.get(caseId);if(previous&&previous.status!=='PASS')status=previous.status;observations={...previous?.observations,...observations,probeExecuted:status!=='BLOCKED'};records.set(caseId,{status,observations});for(const sub of ['proof','execution'])mkdirSync(join(dir,sub),{recursive:true});writeFileSync(join(dir,'proof',caseId+'.json'),JSON.stringify({caseId,status,verified:status==='PASS',environment:`${process.platform}/${process.arch}; disposable SQLite, real Chromium and local MCP/HTTP only`,observations,noLiveSystemsTouched:true},null,2));writeFileSync(join(dir,'execution',caseId+'.json'),JSON.stringify({caseId,status,probeExecuted:status!=='BLOCKED',...(status==='BLOCKED'?{reason:'BLOCKED: Required disposable browser/sandbox environment unavailable.'}:{})},null,2));}
const value=reply=>JSON.parse(reply.contentItems[0].text);

async function browserFixture(f){
  let forbidden=0,reads=0,release,seen,hold=false,html='<title>Synthetic site</title><body>Read-only fixture</body>';
  const site=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){if(new URL(req.url).pathname!=='/read'||req.method!=='GET'){forbidden++;return new Response('forbidden');}reads++;if(hold){hold=false;seen?.();await new Promise(resolve=>{release=resolve;});}return new Response(html,{headers:{'content-type':'text/html'}});}});
  const browsers=await isolatedBrowsers(f.store,async raw=>({url:new URL(raw.replace('https://fixture.invalid',`http://fixture.invalid:${site.port}`)),address:'127.0.0.1',family:4}));
  f.runtime.scopedBrowsers=browsers;
  const rA=f.p.createResource({spaceId:f.A.id,type:'browser',name:'Read site A',metadata:{readUrls:['https://fixture.invalid/read']}}),rB=f.p.createResource({spaceId:f.B.id,type:'browser',name:'Read site B',metadata:{readUrls:['https://fixture.invalid/read']}});
  f.grant(f.a,[f.A,f.B],[[rA,'browser.read'],[rA,'browser.navigate'],[rB,'browser.read'],[rB,'browser.navigate']]);
  return {browsers,rA,rB,site,html(text){html='<body>'+text+'</body>';},hold(){hold=true;return new Promise(resolve=>{seen=resolve;});},release(){release?.();},get forbidden(){return forbidden;},get reads(){return reads;},async close(){release?.();await browsers.close();site.stop(true);}};
}
test('DATA-001 Browser cookie isolation',()=>probe('DATA-001',async f=>{
  const b=await browserFixture(f);try{
    const jA=f.job(),jB=f.job(f.a,f.B),jA2=f.job();
    expect((await f.invoke(jA,'odwyn_browser',{resourceId:b.rA.id,action:'navigate',url:'https://fixture.invalid/read',reason:'fixture'})).success).toBe(true);
    const first=b.browsers.get(jA,b.rA.id);
    const original=await browserProbe(b.browsers,jA,b.rA.id,async({context,page})=>{await context.addCookies([{name:'fixture',value:'space_a_session',url:page.url()}]);await page.evaluate(()=>localStorage.setItem('fixture','space_a_session'));return {cookies:await context.cookies(page.url()),namespace:(await import('node:fs')).readlinkSync('/proc/self/ns/pid')};});
    const namespaces=[original.namespace];expect(original.cookies.some(c=>c.value==='space_a_session')).toBe(true);
    for(const [job,resource] of [[jB,b.rB],[jA2,b.rA]]){
      expect((await f.invoke(job,'odwyn_browser',{resourceId:resource.id,action:'navigate',url:'https://fixture.invalid/read',reason:'fixture'})).success).toBe(true);
      const other=b.browsers.get(job,resource.id);expect(other).not.toBe(first);
      const state=await browserProbe(b.browsers,job,resource.id,async({context,page})=>({cookies:await context.cookies(),storage:await page.evaluate(()=>localStorage.getItem('fixture')),namespace:(await import('node:fs')).readlinkSync('/proc/self/ns/pid')}));expect(state.cookies.some(c=>c.value==='space_a_session')).toBe(false);expect(state.storage).toBe(null);namespaces.push(state.namespace);
    }
    expect((await f.invoke(jA2,'odwyn_browser',{resourceId:b.rA.id,action:'navigate',url:'https://fixture.invalid/write',reason:'fixture'})).success).toBe(false);
    expect(await browserProbe(b.browsers,jA2,b.rA.id,async({page})=>page.evaluate(async()=>{try{await fetch('/write',{method:'POST',body:'synthetic'});return false;}catch{return true;}}))).toBe(true);
    expect(b.forbidden).toBe(0);expect(b.reads).toBe(3);expect(new Set(namespaces).size).toBe(3);return {realChromium:true,distinctPIDNamespaces:3,profiles:3,cookiePositiveControl:true,localStorageIsolated:true,permittedReads:3,forbiddenUpstreamRequests:0};
  }finally{await b.close();}
}),120000);

test('DATA-001 Browser cookie isolation: broker and kernel deny alternate egress',()=>probe('DATA-001',async f=>{
  let sinkCalls=0;const sink=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){sinkCalls++;return new Response('forbidden');}}),calls=[];
  const site=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
    const path=new URL(req.url).pathname;calls.push({path,authorization:req.headers.get('authorization'),cookie:req.headers.get('cookie')});
    if(path==='/redirect')return Response.redirect(sink.url.href,302);
    if(path==='/oversize')return new Response('x'.repeat(262145),{headers:{'content-type':'text/html'}});
    if(path==='/json')return Response.json({text:'not HTML'});
    return new Response(`<body>Scoped read<iframe src="${sink.url}"></iframe><img src="file:///etc/passwd"><script>fetch('${sink.url}')</script></body>`,{headers:{'content-type':'text/html'}});
  }});
  const browsers=await isolatedBrowsers(f.store,async raw=>({url:new URL(raw.replace('https://fixture.invalid',`http://fixture.invalid:${site.port}`)),address:'127.0.0.1',family:4}));f.runtime.scopedBrowsers=browsers;
  try{
    expect((await fetch(sink.url)).status).toBe(200);expect(sinkCalls).toBe(1);sinkCalls=0;
    const urls=['read','redirect','oversize','json'].map(p=>'https://fixture.invalid/'+p),r=f.p.createResource({spaceId:f.A.id,type:'browser',name:'Broker deny fixture',metadata:{readUrls:urls}});f.grant(f.a,[f.A],[[r,'browser.read'],[r,'browser.navigate']]);
    const j=f.job();expect((await f.invoke(j,'odwyn_browser',{resourceId:r.id,action:'navigate',url:urls[0]})).success).toBe(true);
    const worker=browsers.get(j,r.id);
    expect((await f.invoke(j,'odwyn_browser',{resourceId:r.id,action:'navigate',url:'https://fixture.invalid/write'})).success).toBe(false);
    for(const url of urls.slice(1))expect((await f.invoke(f.job(),'odwyn_browser',{resourceId:r.id,action:'navigate',url})).success).toBe(false);
    expect(sinkCalls).toBe(0);expect(calls.map(c=>c.path)).toEqual(['/read','/redirect','/oversize','/json']);expect(calls.every(c=>c.authorization===null&&c.cookie===null)).toBe(true);
    f.grant(f.a,[f.A],[]);expect((await f.invoke(j,'odwyn_browser',{resourceId:r.id,action:'read'})).success).toBe(false);await browsers.stop(j.id);
    expect((await browsers.executor.docker(['inspect',worker.id])).exitCode).not.toBe(0);
    return {realContainerChromium:true,allowedHTMLReads:1,deniedRedirects:1,deniedOversize:1,deniedContentTypes:1,rendererSelectedRequests:0,upstreamCookies:0,upstreamCredentials:0,sinkPositiveControl:true,forbiddenUpstreamCalls:0,revokedReadDenied:true,profileCgroupRemoved:true};
  }finally{await browsers.close();site.stop(true);sink.stop(true);}
}),120000);

async function connectorFixture(f){
  const secret='synthetic_token_'+randomUUID(),calls=[];let leaking=false,hold=false,seen,release;
  const site=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
    if(req.headers.get('authorization')!=='Bearer '+secret)return new Response('unauthorized',{status:401});
    const server=new McpServer({name:'synthetic-scoped-service',version:'1'}),transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    server.registerTool('read_document',{inputSchema:z.object({id:z.string()}).strict()},async({id})=>{calls.push({tool:'read_document',id});if(hold){hold=false;seen?.();await new Promise(resolve=>{release=resolve;});}return {content:[{type:'text',text:leaking?JSON.stringify({text:secret,error:'Bearer '+secret,logs:secret}):'Synthetic allowed document'}]};});
    server.registerTool('write_document',{inputSchema:z.object({id:z.string()})},async({id})=>{calls.push({tool:'write_document',id});return {content:[{type:'text',text:'forbidden mutation'}]};});
    await server.connect(transport);try{return await transport.handleRequest(req);}finally{await server.close();}
  }});
  f.runtime.connectors.resolve=async raw=>({url:new URL(raw.replace('https://mcp.invalid',`http://mcp.invalid:${site.port}`)),address:'127.0.0.1',family:4});
  const connection=f.store.connectors.create({spaceId:f.A.id,type:'mcp-document-v1',name:'Disposable MCP',endpoint:'https://mcp.invalid/mcp',credential:secret});
  const resource=f.p.createResource({spaceId:f.A.id,type:'connector',name:'Document A',metadata:{connectionId:connection.id,upstreamId:'doc-a'}});
  f.grant(f.a,[f.A,f.B],[[resource,'mcp.invoke']]);return {secret,calls,resource,connection,site,leak(){leaking=true;},hold(){hold=true;return new Promise(resolve=>{seen=resolve;});},release(){release?.();},close(){release?.();site.stop(true);}};
}
test('DATA-002 MCP server allowlist',()=>probe('DATA-002',async f=>{
  const c=await connectorFixture(f);try{
    const j=f.job();expect((await f.invoke(j,'odwyn_mcp',{resourceId:c.resource.id,operation:'document.read'})).success).toBe(true);
    for(const args of [{resourceId:c.resource.id,operation:'document.write'},{resourceId:c.resource.id,operation:'document.read',id:'doc-b'},{resourceId:randomUUID(),operation:'document.read'}])expect((await f.invoke(j,'odwyn_mcp',args)).success).toBe(false);
    expect((await f.invoke(j,'mcp_write_document',{id:'doc-a'})).success).toBe(false);
    f.store.connectors.disable(c.connection.id);expect((await f.invoke(j,'odwyn_mcp',{resourceId:c.resource.id,operation:'document.read'})).success).toBe(false);
    expect(c.calls).toEqual([{tool:'read_document',id:'doc-a'}]);return {realMCPTransport:true,permittedReads:1,writeCalls:0,foreignResourceCalls:0,disabledConnectionCalls:0};
  }finally{c.close();}
}));
test('DATA-003 Credential redaction',()=>probe('DATA-003',async f=>{
  const c=await connectorFixture(f);try{
    c.leak();const j=f.job(),reply=await f.invoke(j,'odwyn_mcp',{resourceId:c.resource.id,operation:'document.read'});expect(reply.success).toBe(true);expect(JSON.stringify(reply)).not.toContain(c.secret);expect(JSON.stringify(reply)).toContain('[REDACTED]');
    f.store.save();expect(JSON.stringify(f.store.state)).not.toContain(c.secret);expect(JSON.stringify(f.store.connectors.list())).not.toContain(c.secret);
    for(const filename of ['odwyn.db','odwyn.db-wal']){try{expect(readFileSync(join(f.directory,filename)).includes(Buffer.from(c.secret))).toBe(false);}catch(e){if(e.code!=='ENOENT')throw e;}}
    await f.runtime.startJob(j);expect(JSON.stringify(f.provider.calls)).not.toContain(c.secret);expect(JSON.stringify(j.events)).not.toContain(c.secret);
    return {upstreamSecretEchoed:true,resultRedacted:true,encryptedSQLite:true,providerSecretDisclosure:false,taskEventsSecretDisclosure:false};
  }finally{c.close();}
}));
test('DATA-003 Credential redaction: provider settings encrypt and reload without changing configured keys',()=>probe('DATA-003',async f=>{
  const secret='synthetic_provider_key_'+randomUUID();f.store.state.provider={type:'openai',model:'fixture-only',apiKey:secret};f.store.state.globalProvider={...f.store.state.provider};f.store.state.agents[0].provider={...f.store.state.provider};f.store.save();
  for(const filename of ['odwyn.db','odwyn.db-wal']){try{expect(readFileSync(join(f.directory,filename)).includes(Buffer.from(secret))).toBe(false);}catch(e){if(e.code!=='ENOENT')throw e;}}
  const reopened=openStore(f.directory);try{expect(reopened.state.provider.apiKey).toBe(secret);expect(reopened.state.globalProvider.apiKey).toBe(secret);expect(reopened.state.agents[0].provider.apiKey).toBe(secret);expect(reopened.connectors.redact(secret)).toBe('[REDACTED]');}finally{reopened.close();}
  return {providerKeysEncrypted:true,providerConfigurationPreserved:true,providerKeyRedaction:true};
}));
test('DATA-003 Credential redaction: legacy key migration preserves chat and fails closed without its key',()=>probe('DATA-003',async f=>{
  const directory=join(f.directory,'legacy-key-migration'),secret='synthetic_legacy_provider_'+randomUUID(),conversationId=randomUUID();mkdirSync(directory,{mode:0o700});
  const legacy=new Database(join(directory,'odwyn.db'));legacy.exec('CREATE TABLE state(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');legacy.query('INSERT INTO state VALUES(1,?)').run(JSON.stringify({agents:[{id:f.a,provider:{type:'openai',apiKey:secret}}],provider:{type:'openai',apiKey:secret},conversations:[{id:conversationId,agentId:f.a,messages:[{id:randomUUID(),role:'user',text:'Preserved legacy chat'}]}]}));legacy.close();
  const migrated=openStore(directory);try{
    expect(migrated.state.agents[0].provider.apiKey).toBe(secret);expect(migrated.state.conversations.find(c=>c.id===conversationId).messages[0].text).toBe('Preserved legacy chat');expect(migrated.security.access(f.a).grants).toHaveLength(0);
    expect(readFileSync(join(directory,'odwyn.db')).includes(Buffer.from(secret))).toBe(false);expect(statSync(join(directory,'broker.key')).mode&0o077).toBe(0);
    const backup=readdirSync(directory).find(n=>n.startsWith('pre-data-security-'));expect(backup).toBeDefined();expect(statSync(join(directory,backup)).mode&0o077).toBe(0);expect(statSync(join(directory,backup,'state.sqlite')).mode&0o077).toBe(0);
  }finally{migrated.close();}
  rmSync(join(directory,'broker.key'));expect(()=>openStore(directory)).toThrow('Credential key unavailable');expect(existsSync(join(directory,'broker.key'))).toBe(false);return {legacyChatPreserved:true,implicitGrants:0,currentDatabasePlaintextRemoved:true,privateRollbackBackup:true,missingKeyFailsClosed:true};
}));
test('DATA-001 Browser cookie isolation: visual output cannot bypass credential redaction',()=>probe('DATA-001',async f=>{
  const b=await browserFixture(f);try{
    const secret='synthetic_visual_key_'+randomUUID();f.store.connectors.create({spaceId:f.A.id,type:'mcp-document-v1',name:'Visual redaction fixture',endpoint:'https://inactive.invalid/mcp',credential:secret});
    b.html(secret);const job=f.job();expect((await f.invoke(job,'odwyn_browser',{resourceId:b.rA.id,action:'navigate',url:'https://fixture.invalid/read'})).success).toBe(true);
    const cached=await b.browsers.executor.inside(b.browsers.get(job,b.rA.id),['cat','/tmp/browser-page.json']);expect(cached.exitCode).toBe(0);expect(cached.stdout.toString()).not.toContain(secret);expect(cached.stdout.toString()).toContain('[REDACTED]');
    await b.browsers.executor.inside(b.browsers.get(job,b.rA.id),['bun','-e',`const fs=require('node:fs');const p=JSON.parse(fs.readFileSync('/tmp/browser-page.json','utf8'));p.html='<body>'+${JSON.stringify(secret)}+'</body>';fs.writeFileSync('/tmp/browser-page.json',JSON.stringify(p));`]);
    const read=await f.invoke(job,'odwyn_browser',{resourceId:b.rA.id,action:'read'});expect(read.success).toBe(true);expect(JSON.stringify(read)).not.toContain(secret);
    expect((await f.invoke(job,'odwyn_browser',{resourceId:b.rA.id,action:'screenshot'})).success).toBe(false);return {realChromiumCredentialEcho:true,browserTextRedacted:true,visualSecretDisclosureDenied:true};
  }finally{await b.close();}
}),120000);
test('DATA-003 Credential redaction: raw credentials cannot become downloadable artifacts',()=>probe('DATA-003',async f=>{
  const secret='synthetic_artifact_key_'+randomUUID();f.store.connectors.create({spaceId:f.A.id,type:'mcp-document-v1',name:'Credential quarantine fixture',endpoint:'https://inactive.invalid/mcp',credential:secret});writeFileSync(join(f.directory,'unsafe.txt'),secret);
  const legacy={id:f.p.legacySpaceId},resource=f.p.createResource({spaceId:legacy.id,type:'file',name:'Explicit artifact grant',metadata:{path:'unsafe.txt'}});f.grant(f.a,[legacy],[[resource,'file.download']]);const j=f.job(f.a,legacy);
  expect((await f.invoke(j,'odwyn_send_file',{resourceId:resource.id,path:'unsafe.txt'})).success).toBe(false);expect(j.files).toHaveLength(0);expect(f.store.state.files).toHaveLength(0);return {credentialArtifactBlockedBeforeWrite:true,downloadableSecretFiles:0};
}));
test('DATA-003 Credential redaction: encrypted Git connection reaches only its granted remote',()=>probe('DATA-003',async()=>{
  const f=await sandboxFixture();try{
    const p=f.store.security,spaceId=f.job.spaceId,endpoint=f.repository.metadata.endpoint,connection=f.store.connectors.create({spaceId,type:'git-https-v1',name:'Synthetic Git connection',endpoint,credential:f.canary}),repository=p.createResource({spaceId,type:'repository',name:'Encrypted broker repository',metadata:{endpoint,connectionId:connection.id}});
    f.runtime.gitGateway.credentialResolver=(resourceId,context)=>f.store.connectors.credential(resourceId,context,'repository.branch.push');
    p.putAccess(f.job.agentId,{revision:p.revision,spaceIds:[spaceId],grants:[{spaceId,resourceId:f.resource.id,action:'sandbox.exec',mode:'auto'},{spaceId,resourceId:repository.id,action:'repository.branch.push',mode:'auto',constraints:{branchPrefixes:['agent/']}}]});
    expect((await f.exec("git checkout -b agent/encrypted && git config user.name Fixture && git config user.email fixture@example.invalid && printf 'Scoped encrypted Git' > encrypted.txt && git add encrypted.txt && git commit -m 'Synthetic encrypted broker commit'")).exitCode).toBe(0);
    const reply=await f.invoke('odwyn_repository_push',{resourceId:repository.id,ref:'refs/heads/agent/encrypted'});expect(reply.success).toBe(true);expect(f.refs()).toContain('refs/heads/agent/encrypted');expect(JSON.stringify(reply)).not.toContain(f.canary);expect(JSON.stringify(f.job)).not.toContain(f.canary);
    const before=f.refs(),requests=f.requests.length;f.store.connectors.disable(connection.id);expect((await f.invoke('odwyn_repository_push',{resourceId:repository.id,ref:'refs/heads/agent/after-disable'})).success).toBe(false);expect(f.refs()).toBe(before);expect(f.requests.length).toBe(requests);return {realGitPushWithEncryptedBroker:true,workerTokenDisclosure:false,disabledGitUpstreamCalls:0};
  }finally{await f.close();}
}),60000);
test('DATA-004 File ID and path isolation',()=>probe('DATA-004',async f=>{
  const id=randomUUID();mkdirSync(join(f.directory,'files'));writeFileSync(join(f.directory,'files',id),'foreign_file_canary');f.store.state.files.push({id,name:'private.txt',kind:'upload',spaceId:f.B.id});f.store.save();
  expect(()=>createJob(f.store.state,{agentId:f.a,spaceId:f.A.id,prompt:'Foreign attachment',attachments:[id]})).toThrow();
  const own=randomUUID();writeFileSync(join(f.directory,'files',own),'own_file');f.store.state.files.push({id:own,name:'own.txt',kind:'upload',spaceId:f.A.id});f.store.save();const attached=createJob(f.store.state,{agentId:f.a,spaceId:f.A.id,prompt:'Explicit owner attachment',attachments:[own]});f.store.save();expect(f.store.data.file(attached,own).id).toBe(own);
  expect(()=>f.store.data.file(f.job(),id)).toThrow();for(const path of ['../private','/etc/passwd','..\\private'])expect(()=>f.store.data.file(f.job(),path)).toThrow();
  expect((await f.invoke(f.job(),'odwyn_send_file',{path:'../private',resourceId:id})).success).toBe(false);
  const isolated=await sandboxFixture();try{
    await isolated.exec("printf 'Synthetic deliverable' > report.txt; ln -s /etc/passwd linked.txt");
    const p=isolated.store.security,spaceId=isolated.job.spaceId,granted=p.createResource({spaceId,type:'file',name:'Task artifact',metadata:{path:'report.txt',workspaceId:isolated.resource.id}}),linked=p.createResource({spaceId,type:'file',name:'Symlink probe',metadata:{path:'linked.txt',workspaceId:isolated.resource.id}}),host=p.createResource({spaceId,type:'file',name:'No shared host path',metadata:{path:'public.txt'}});
    p.putAccess(isolated.job.agentId,{revision:p.revision,spaceIds:[spaceId],grants:[{spaceId,resourceId:isolated.resource.id,action:'sandbox.exec',mode:'auto'},...[granted,linked,host].map(r=>({spaceId,resourceId:r.id,action:'file.download',mode:'auto'}))]});
    expect((await isolated.invoke('odwyn_send_file',{path:'report.txt',resourceId:granted.id})).success).toBe(true);
    const saved=isolated.store.state.files[0];expect(readFileSync(join(isolated.store.directory,'files',saved.id),'utf8')).toBe('Synthetic deliverable');
    for(const [resourceId,path] of [[linked.id,'linked.txt'],[host.id,'public.txt'],[granted.id,'../report.txt'],[granted.id,'/workspace/report.txt']])expect((await isolated.invoke('odwyn_send_file',{resourceId,path})).success).toBe(false);
    expect(isolated.job.files).toHaveLength(1);return {foreignAttachmentDenied:true,foreignDownloadDenied:true,permittedOwnFile:true,realOSWorker:true,isolatedArtifactExport:true,symlinkExportDenied:true,sharedHostFileDenied:true,traversalDenials:5};
  }finally{await isolated.close();}
}),60000);
test('DATA-005 FTS/memory isolation',()=>probe('DATA-005',async f=>{
  const j=f.job(),foreign=f.job(f.b,f.B),canary='foreignmemorycanary';f.store.state.conversations.find(c=>c.id===foreign.conversationId).messages.push({id:randomUUID(),role:'assistant',agentId:f.b,jobId:foreign.id,text:canary});
  const own=f.store.state.conversations.find(c=>c.id===j.conversationId);own.messages.push({id:randomUUID(),role:'assistant',agentId:f.a,jobId:j.id,text:'ownmemorycanary'});f.store.save();
  expect(value(await f.invoke(j,'odwyn_search',{resourceId:f.memoryA.id,query:'ownmemorycanary'})).matches.length).toBe(1);expect(value(await f.invoke(j,'odwyn_search',{resourceId:f.memoryA.id,query:canary})).matches).toEqual([]);
  expect((await f.invoke(j,'odwyn_remember',{resourceId:f.memoryA.id,note:'private durable preference'})).success).toBe(true);expect(f.store.state.preferences).toBe('');
  await f.runtime.startJob(f.job(f.b,f.B));expect(JSON.stringify(f.provider.calls)).not.toContain('private durable preference');return {actualFTSPositiveControl:true,foreignFTSMatches:0,globalPreferencesUnchanged:true};
}));
test('DATA-005 FTS/memory isolation: read-only grants expose only selected note resources',()=>probe('DATA-005',async f=>{
  const other=f.p.createResource({spaceId:f.A.id,type:'memory',name:'Private second notes'});
  f.grant(f.a,[f.A,f.B],[[f.memoryA,'memory.read'],[f.memoryA,'memory.write'],[other,'memory.read'],[other,'memory.write']]);
  const source=f.job();expect((await f.invoke(source,'odwyn_remember',{resourceId:f.memoryA.id,note:'selected-note-canary'})).success).toBe(true);expect((await f.invoke(f.job(),'odwyn_remember',{resourceId:other.id,note:'unselected-note-canary'})).success).toBe(true);
  f.grant(f.b,[f.A,f.B],[[f.memoryA,'memory.read']]);const reader=f.job(f.b,f.A);expect(f.store.data.memory(reader)).toEqual(['selected-note-canary']);
  f.runtime.active=reader;reader.status='running';await f.runtime.startJob(reader);const sent=f.provider.calls.findLast(c=>c.method==='thread/start').params;expect(sent.developerInstructions).toContain('selected-note-canary');expect(sent.developerInstructions).not.toContain('unselected-note-canary');
  expect((await f.invoke(reader,'odwyn_remember',{resourceId:f.memoryA.id,note:'cannot write'})).success).toBe(false);
  const third=randomUUID();f.store.state.agents.push({id:third,customization:{name:'Paper kite'}});f.grant(third,[f.A],[]);
  const room=createRoom(f.store.state,{title:'Scoped notes room',memberIds:[f.b,third],spaceId:f.A.id}),turn=createJob(f.store.state,{agentId:f.b,conversationId:room.id,prompt:'Core room assistance'});
  expect(f.store.data.memory(turn)).toEqual([]);
  f.grant(f.b,[f.A,f.B],[]);expect(f.store.data.memory(reader)).toEqual([]);return {readOnlyNoteAccess:true,unselectedMemoryResourceDisclosed:false,noteRevocationEnforced:true};
}));
test('DATA-006 Room privilege intersection',()=>probe('DATA-006',async f=>{
  const room=createRoom(f.store.state,{title:'Unrelated room',memberIds:[f.a,f.b],spaceId:f.A.id});
  const source=createJob(f.store.state,{agentId:f.a,conversationId:room.id,prompt:'Owner goal'});f.store.data.note(source,f.memoryA.id,'memory.read');room.messages.push({id:randomUUID(),role:'assistant',agentId:f.a,jobId:source.id,text:'restrictedroomcanary'});f.store.save();
  const next=createJob(f.store.state,{agentId:f.b,conversationId:room.id,prompt:'Continue'});f.runtime.active=next;next.status='running';await f.runtime.startJob(next);
  expect(JSON.stringify(f.provider.calls)).not.toContain('restrictedroomcanary');expect(f.store.data.history(next,room.id).some(m=>m.text==='Owner goal')).toBe(true);
  expect((await f.invoke(next,'odwyn_search',{resourceId:f.memoryA.id,query:'restrictedroomcanary'})).success).toBe(false);return {realProviderContextCaptured:true,restrictedTranscriptDisclosed:false,ownerGoalPreserved:true,privilegeUnionDenied:true};
}));
test('DATA-006 Room privilege intersection: explicit Space binding and membership edits',()=>probe('DATA-006',async f=>{
  const input={title:'Scoped room',spaceId:f.A.id,memberIds:[f.a,f.b]},before=f.p.access(f.b);
  expect(()=>createRoom(f.store.state,{...input,spaceId:undefined})).toThrow();
  for(const spaceId of [null,'',randomUUID()])expect(()=>createRoom(f.store.state,{...input,spaceId})).toThrow();
  const room=createRoom(f.store.state,input);
  expect(room.spaceId).toBe(f.A.id);expect(f.p.access(f.b)).toEqual(before);
  expect(()=>updateRoom(f.store.state,room.id,{...input,spaceId:f.B.id})).toThrow('Space cannot change');
  updateRoom(f.store.state,room.id,{...input,title:'Updated room'});
  const outsider=randomUUID();f.store.state.agents.push({id:outsider});f.grant(outsider,[f.B],[]);
  expect(()=>createRoom(f.store.state,{...input,memberIds:[f.a,outsider]})).toThrow('Space membership denied');
  expect(()=>updateRoom(f.store.state,room.id,{...input,memberIds:[f.a,outsider]})).toThrow('Space membership denied');
  const queued=createJob(f.store.state,{agentId:f.a,conversationId:room.id,prompt:'Queued before revocation'});
  f.grant(f.b,[f.B],[[f.memoryB,'memory.read']]);
  expect(()=>updateRoom(f.store.state,room.id,{...input,title:'Revoked edit'})).toThrow('Space membership denied');
  expect(()=>createJob(f.store.state,{agentId:f.a,conversationId:room.id,prompt:'Target only remaining member'})).toThrow('Space membership denied');
  expect(room.title).toBe('Updated room');expect(room.memberIds).toEqual(input.memberIds);
  f.runtime.active=queued;queued.status='running';await f.runtime.startJob(queued);
  expect(queued.status).toBe('failed');expect(f.provider.calls.some(call=>call.method==='thread/start')).toBe(false);
  return {explicitSpaceRequired:true,immutableRoomSpace:true,crossSpaceMembersDenied:true,retainedMembersRevalidated:true,targetedRevocationDenied:true,grantsUnchanged:true};
}));
test('DATA-006 Room privilege intersection: provenance survives edits and live revocation',()=>probe('DATA-006',async f=>{
  f.grant(f.b,[f.A,f.B],[[f.memoryA,'memory.read']]);
  const room=createRoom(f.store.state,{title:'Shared provenance',spaceId:f.A.id,memberIds:[f.a,f.b]});
  const source=createJob(f.store.state,{agentId:f.a,conversationId:room.id,prompt:'Read shared notes'});
  f.store.data.note(source,f.memoryA.id,'memory.read');
  const message={id:randomUUID(),role:'assistant',agentId:f.a,jobId:source.id,text:'sharedsourcecanary'};room.messages.push(message);f.store.save();
  const next=createJob(f.store.state,{agentId:f.b,conversationId:room.id,prompt:'Continue'});
  expect(f.store.data.history(next,room.id)).toContainEqual(message);
  f.store.data.assertHandoff(next,[source.id]);
  const proposal={id:randomUUID(),result:'Shared result',nextPlan:'Review'};f.store.data.propose(source,proposal);
  expect(f.store.data.proposal(next,proposal)).toEqual(proposal);
  source.status=next.status='completed';
  const third=randomUUID();f.store.state.agents.push({id:third});f.grant(third,[f.A],[]);
  updateRoom(f.store.state,room.id,{title:room.title,memberIds:[f.a,f.b,third]});
  expect(f.store.data.history(next,room.id)).not.toContainEqual(message);
  expect(()=>f.store.data.roomCheck(next)).toThrow('permission intersection');
  expect(f.store.data.proposal(next,proposal)).toBe(null);
  f.grant(third,[f.A],[[f.memoryA,'memory.read']]);
  expect(f.store.data.history(next,room.id)).toContainEqual(message);
  f.grant(third,[],[]);
  expect(()=>f.store.data.roomCheck(next,[])).toThrow('Space membership denied');
  expect(f.store.data.history(next,room.id)).not.toContainEqual(message);
  return {positiveSharedRead:true,provenanceInherited:true,newParticipantIntersectionEnforced:true,grantRevocationDenied:true,membershipRevocationWithoutSourcesDenied:true};
}));
test('DATA-006 Room privilege intersection: in-flight membership revocation blocks tool results',()=>probe('DATA-006',async f=>{
  const c=await connectorFixture(f);try{
    f.grant(f.b,[f.A],[[c.resource,'mcp.invoke']]);
    const room=createRoom(f.store.state,{title:'Revocation room',spaceId:f.A.id,memberIds:[f.a,f.b]});
    const job=createJob(f.store.state,{agentId:f.a,conversationId:room.id,prompt:'Read shared document'});
    const seen=c.hold(),pending=f.invoke(job,'odwyn_mcp',{resourceId:c.resource.id,operation:'document.read'});
    await seen;f.grant(f.b,[],[]);c.release();
    const reply=await pending;
    expect(c.calls).toHaveLength(1);expect(reply.success).toBe(false);
    expect(JSON.stringify(reply)).not.toContain('Synthetic allowed document');
    return {realMCPReadExecuted:true,inFlightMembershipRevoked:true,toolResultDisclosed:false};
  }finally{c.close();}
}));
test('DATA-006 Room privilege intersection: revocation before completion blocks agreed report',()=>probe('DATA-006',async f=>{
  f.grant(f.b,[f.A],[[f.memoryA,'memory.read']]);
  const room=createRoom(f.store.state,{title:'Agreed room',spaceId:f.A.id,memberIds:[f.a,f.b]});
  const job=createJob(f.store.state,{agentId:f.a,conversationId:room.id,prompt:'Shared task'});
  f.store.data.note(job,f.memoryA.id,'memory.read');
  const outcome={id:randomUUID(),result:'revokedreportcanary',nextPlan:'Review',confirmations:{[f.a]:'Verified',[f.b]:'Verified'}};
  room.discussion={id:randomUUID(),status:'active',round:1,memberIds:room.memberIds,outcome};
  job.roomRoundId=room.discussion.id;job.roomCycle=1;f.store.data.propose(job,outcome);
  f.grant(f.b,[f.A],[]);f.runtime.finish(job,'completed');
  expect(room.discussion.status).toBe('paused');
  expect(room.messages.some(m=>m.text.includes('revokedreportcanary'))).toBe(false);
  return {agreedProposalRevoked:true,reportDisclosed:false};
}));
test('DATA-006 Room privilege intersection: Legacy Workspace migration preserves history',()=>probe('DATA-006',async f=>{
  const directory=join(f.directory,'legacy');mkdirSync(directory);
  const db=new Database(join(directory,'sidekick.db'));
  const old={agents:[{id:f.a},{id:f.b}],conversations:[{id:randomUUID(),kind:'room',title:'Legacy room',agentId:f.a,memberIds:[f.a,f.b],messages:[{id:randomUUID(),role:'assistant',agentId:f.b,text:'legacyroomhistory'}]}],jobs:[]};
  db.exec('CREATE TABLE state(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');db.query('INSERT INTO state VALUES(1,?)').run(JSON.stringify(old));db.close();
  let store=openStore(directory);try{
    const room=store.state.conversations[0],legacy=store.security.legacySpaceId;
    expect(room).toEqual({...old.conversations[0],spaceId:legacy});
    const custom=store.security.createSpace({name:'No automatic migration'});
    expect(()=>updateRoom(store.state,room.id,{title:room.title,memberIds:room.memberIds,spaceId:custom.id})).toThrow('Space cannot change');
    updateRoom(store.state,room.id,{title:'Legacy renamed',memberIds:room.memberIds});
    const job=createJob(store.state,{agentId:f.a,conversationId:room.id,prompt:'Recall history'});store.save();
    expect(store.data.history(job,room.id).some(m=>m.text==='legacyroomhistory')).toBe(true);
    store.close();store=openStore(directory);
    expect(store.state.conversations[0].spaceId).toBe(legacy);
    expect(store.state.conversations[0].messages[0]).toEqual(old.conversations[0].messages[0]);
    expect(store.security.access(f.a).grants).toEqual([]);
  }finally{store.close();}
  return {legacyRoomAndTranscriptPreserved:true,legacyBindingStableAcrossReload:true,implicitCustomMigrationDenied:true,noGrantsAdded:true};
}));
test('DATA-006 Room privilege intersection: provider IDs cannot relabel owner content',()=>probe('DATA-006',async f=>{
  const j=f.job();f.runtime.active=j;j.status='running';j.threadId=randomUUID();f.store.save();
  const conversation=f.store.state.conversations.find(c=>c.id===j.conversationId),owner=conversation.messages[0];
  f.runtime.notification({method:'item/agentMessage/delta',params:{threadId:j.threadId,itemId:owner.id,delta:'privateproviderinjection'}});
  expect(owner.text).toBe('Synthetic task');expect(conversation.messages.filter(m=>m.role==='assistant')).toHaveLength(1);
  f.runtime.notification({method:'item/completed',params:{threadId:j.threadId,item:{type:'agentMessage',id:owner.id,text:'privateproviderinjection'}}});
  expect(owner.role).toBe('user');expect(owner.text).toBe('Synthetic task');expect(conversation.messages.filter(m=>m.role==='assistant')).toHaveLength(1);return {providerMessageIdSpoofDenied:true,ownerMessageUnchanged:true};
}));
test('DATA-007 Workflow agent escalation',()=>probe('DATA-007',async f=>{
  const first=f.job();f.store.data.note(first,f.memoryA.id,'memory.read');const conversation=f.store.state.conversations.find(c=>c.id===first.conversationId);conversation.messages.push({id:randomUUID(),role:'assistant',agentId:f.a,jobId:first.id,text:'workflowprivatecanary'});f.store.save();
  const run={id:randomUUID(),conversationId:conversation.id,agentId:f.a,spaceId:f.A.id,inputs:{},outputs:{one:'workflowprivatecanary'},workflow:{maxSteps:5,command:'fixture'},visits:1,skills:[],status:'running'};f.store.state.workflowRuns.push(run);f.store.data.workflowOutput(run,{id:'one'},first);
  const step={id:'two',type:'agent',agentId:f.b,prompt:'{{steps.one}}',tools:[],skills:[],format:'text'};
  expect(()=>f.runtime.queueWorkflowStep(run,step,first)).toThrow();
  f.grant(f.b,[f.A,f.B],[[f.memoryA,'memory.read'],[f.memoryB,'memory.read']]);const permitted=f.runtime.queueWorkflowStep(run,step,first);expect(permitted.agentId).toBe(f.b);expect(permitted.spaceId).toBe(f.A.id);
  f.grant(f.b,[f.A,f.B],[[f.memoryB,'memory.read']]);f.runtime.active=permitted;permitted.status='running';await f.runtime.startJob(permitted);expect(permitted.status).toBe('failed');expect(JSON.stringify(f.provider.calls)).not.toContain('workflowprivatecanary');return {handoffDeniedBeforeInterpolation:true,actualStepPrincipal:true,revocationBeforeStartDenied:true,providerDisclosure:false};
}));
test('DATA-007 Workflow agent escalation: separate Spaces consume only an explicit bounded export',()=>probe('DATA-007',async f=>{
  const source=f.job(),conversation=f.store.state.conversations.find(c=>c.id===source.conversationId),message={id:randomUUID(),role:'assistant',agentId:f.a,jobId:source.id,text:JSON.stringify({summary:'Approved workflow summary',private:'unapprovedworkflowsecret'})};f.store.data.note(source,f.memoryA.id,'memory.read');conversation.messages.push(message);f.store.save();
  const exported=f.store.data.export({messageId:message.id,destinationSpaceId:f.B.id,fields:['summary'],purpose:'Separate workflow summary'}),run={id:randomUUID(),conversationId:conversation.id,agentId:f.a,spaceId:f.A.id,inputs:{exportId:exported.id},outputs:{one:JSON.parse(message.text)},visits:1,status:'running',skills:[],workflow:{maxSteps:5,command:'scoped'}};f.store.state.workflowRuns.push(run);f.store.data.workflowOutput(run,{id:'one'},source);
  const step={id:'two',type:'agent',agentId:f.b,spaceId:f.B.id,prompt:'Read the owner export {{inputs.exportId}}',tools:['export_read'],skills:[],format:'text'},next=f.runtime.queueWorkflowStep(run,step,source);
  expect(next.spaceId).toBe(f.B.id);f.runtime.active=next;next.status='running';await f.runtime.startJob(next);expect(next.status).toBe('running');expect(JSON.stringify(f.provider.calls)).not.toContain('unapprovedworkflowsecret');
  const reply=await f.invoke(next,'odwyn_export_read',{exportId:exported.id});expect(reply.success).toBe(true);expect(value(reply)).toEqual({summary:'Approved workflow summary'});
  expect(()=>f.runtime.queueWorkflowStep(run,{...step,prompt:'{{steps.one.private}}'},source)).toThrow();return {realCrossSpaceStep:true,boundedExportRead:true,rawForeignOutputDenied:true,foreignPromptDisclosure:false};
}));
test('DATA-008 Routines and recovery context',()=>probe('DATA-008',async f=>{
  const j=f.job();j.status='failed';f.runtime.addProvider(f.a,f.provider);const routine=f.runtime.schedule({agentId:f.a,spaceId:f.A.id,prompt:'Scoped scheduled fixture',at:new Date(Date.now()+60000).toISOString()});
  f.grant(f.a,[f.A,f.B],[]);enqueueSchedules(f.store.state,new Date(Date.now()+120000));const scheduled=f.store.state.jobs.find(x=>x.scheduleId===routine.id);expect(scheduled.spaceId).toBe(f.A.id);expect((await f.invoke(scheduled,'odwyn_search',{resourceId:f.memoryA.id,query:'secret'})).success).toBe(false);
  j.status='failed';f.store.state.customization={name:'Changed profile'};const resumed=f.runtime.retry(j.id);expect(resumed.spaceId).toBe(f.A.id);expect((await f.invoke(resumed,'odwyn_search',{resourceId:f.memoryA.id,query:'secret'})).success).toBe(false);
  resumed.spaceId=f.B.id;expect(()=>f.p.context(resumed)).toThrow();resumed.spaceId=f.A.id;return {routineSpacePreserved:true,retrySpacePreserved:true,currentGrantsEnforced:true,contextSubstitutionDenied:true};
}));
test('DATA-009 Search and file API direct access',()=>probe('DATA-009',async f=>{
  const app=createApp({directory:join(f.directory,'http'),user:'fixture',password:'disposable-password-long',origin:'http://fixture.invalid',codex:new FixtureProvider(),browser:{close:async()=>{}}});try{
    const store=app.runtime.store,p=store.security,A=p.createSpace({name:'A'}),B=p.createSpace({name:'B'}),agent=store.state.agents[0].id;p.putAccess(agent,{revision:p.revision,spaceIds:[A.id,B.id],grants:[]});
    const j=createJob(store.state,{agentId:agent,spaceId:A.id,prompt:'Task HTTP'});j.status='running';const id=randomUUID();mkdirSync(join(store.directory,'files'));writeFileSync(join(store.directory,'files',id),'foreignapicanary');store.state.files.push({id,name:'foreign.txt',kind:'upload',spaceId:B.id});store.save();
    const token=store.data.issueToken(j),request=path=>app.fetch(new Request('http://fixture.invalid'+path,{headers:{authorization:'Bearer '+token}}));
    expect((await request('/api/files/'+id)).status).toBe(403);expect((await request('/api/state')).status).toBe(403);expect((await request('/api/conversations/'+randomUUID())).status).toBe(403);expect((await request('/api/search?query=foreignapicanary')).status).toBe(403);
    expect((await request('/api/conversations/'+j.conversationId)).status).toBe(200);j.status='completed';expect((await request('/api/conversations/'+j.conversationId)).status).toBe(403);return {realHTTPBoundary:true,foreignFileDenied:true,adminStateDenied:true,ownHistoryAllowed:true,endedTaskTokenDenied:true};
  }finally{await app.close();}
}));
test('DATA-004 File ID and path isolation: shared owner-browser downloads stay in Legacy Workspace',()=>probe('DATA-004',async f=>{
  const app=createApp({directory:join(f.directory,'manual-browser'),user:'fixture',password:'disposable-password-long',origin:'http://fixture.invalid',codex:new FixtureProvider()});try{
    const store=app.runtime.store,p=store.security,space=p.createSpace({name:'Unrelated task Space'}),agent=store.state.agents[0].id;p.putAccess(agent,{revision:p.revision,spaceIds:[space.id],grants:[]});const job=createJob(store.state,{agentId:agent,spaceId:space.id,prompt:'Scoped task'}),id=randomUUID();mkdirSync(join(store.directory,'files'));writeFileSync(join(store.directory,'files',id),'owner_browser_legacy_canary');
    app.browser.onFile({id,name:'manual-download.txt',kind:'download',jobId:job.id});
    expect(store.state.files.find(f=>f.id===id).spaceId).toBe(p.legacySpaceId);expect(job.files).toHaveLength(0);expect(()=>store.data.file(job,id)).toThrow();return {manualBrowserLegacyClassification:true,automaticForeignTaskAttachment:false,foreignTaskDownloadDenied:true};
  }finally{await app.close();}
}));
test('DATA-010 Explicit cross-Space export',()=>probe('DATA-010',async f=>{
  const j=f.job(),c=f.store.state.conversations.find(c=>c.id===j.conversationId),m={id:randomUUID(),role:'assistant',agentId:f.a,jobId:j.id,text:JSON.stringify({summary:'Owner-approved short result',private:'exportprivatecanary'})};c.messages.push(m);f.store.save();
  const exported=f.store.data.export({messageId:m.id,destinationSpaceId:f.B.id,fields:['summary'],purpose:'Bounded report'}),target=f.job(f.b,f.B);
  expect(f.store.data.readExport(target,exported.id)).toEqual({summary:'Owner-approved short result'});
  const derived=f.store.state.conversations.find(c=>c.id===target.conversationId);derived.messages.push({id:randomUUID(),role:'assistant',agentId:f.b,jobId:target.id,text:'Owner-approved short result'});f.store.save();const later=f.job(f.b,f.B);expect(f.store.data.history(later,derived.id).some(m=>m.text==='Owner-approved short result')).toBe(true);
  m.text=JSON.stringify({summary:'New unapproved result',private:'newprivate'});f.store.save();expect(()=>f.store.data.readExport(target,exported.id)).toThrow();expect(f.store.data.history(later,derived.id).some(m=>m.text==='Owner-approved short result')).toBe(false);
  f.store.data.revokeExport(exported.id);expect(()=>f.store.data.readExport(target,exported.id)).toThrow();expect(JSON.stringify(exported)).not.toContain('exportprivatecanary');return {boundedApprovedFields:1,privateFieldsDisclosed:false,newSourceDataDenied:true,revocationDenied:true};
}));
test('DATA-011 Session switch defense',()=>probe('DATA-011',async f=>{
  const b=await browserFixture(f);try{
    const j=f.job(),other=f.job(f.a,f.B);expect((await f.invoke(j,'odwyn_browser',{resourceId:b.rA.id,action:'navigate',url:'https://fixture.invalid/read',reason:'fixture'})).success).toBe(true);
    await browserProbe(b.browsers,j,b.rA.id,async({context,page})=>{await context.addCookies([{name:'original',value:'original_cookie',url:page.url()}]);return true;});
    f.runtime.active=other;expect(()=>b.browsers.get(other,b.rA.id)).toThrow();expect((await browserProbe(b.browsers,j,b.rA.id,async({context})=>context.cookies())).some(c=>c.value==='original_cookie')).toBe(true);
    j.spaceId=f.B.id;expect((await f.invoke(j,'odwyn_browser',{resourceId:b.rB.id,action:'read',reason:'fixture'})).success).toBe(false);j.spaceId=f.A.id;expect(b.reads).toBe(1);return {realChromium:true,immutableTaskProfile:true,spaceRewriteDenied:true,foreignProfileRequests:0};
  }finally{await b.close();}
}),60000);
test('DATA-011 Session switch defense: in-flight navigation rejects changed active task',()=>probe('DATA-011',async f=>{
  const b=await browserFixture(f);try{
    const A=f.job(),B=f.job(f.a,f.B),navigate={action:'navigate',url:'https://fixture.invalid/read',reason:'fixture'};
    expect((await f.invoke(A,'odwyn_browser',{...navigate,resourceId:b.rA.id})).success).toBe(true);
    expect((await f.invoke(B,'odwyn_browser',{...navigate,resourceId:b.rB.id})).success).toBe(true);
    await browserProbe(b.browsers,B,b.rB.id,async({context,page})=>{await context.addCookies([{name:'B',value:'only_space_B',url:page.url()}]);return true;});
    const seen=b.hold(),pending=f.invoke(A,'odwyn_browser',{...navigate,resourceId:b.rA.id});await seen;f.runtime.active=B;b.release();
    expect((await pending).success).toBe(false);expect((await browserProbe(b.browsers,B,b.rB.id,async({context})=>context.cookies())).some(c=>c.value==='only_space_B')).toBe(true);expect(b.browsers.profiles.has(A.id+':'+b.rA.id)).toBe(false);expect(b.forbidden).toBe(0);return {inFlightRealNavigation:true,changedActiveTaskResultDenied:true,foreignCookiesUnchanged:true,oldProfileDestroyed:true};
  }finally{await b.close();}
}),60000);
