import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore, createJob, enqueueSchedules } from '../../../store.js';
import { Runtime } from '../../../runtime.js';
import { FixtureProvider } from '../fixtures.js';
import { createApp } from '../../../server.js';

function fixture(repositoryResolver) {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-auth-'));
  const store = openStore(directory), provider = new FixtureProvider();
  let browserCalls = 0;
  const browser = { action: async () => { browserCalls++; return {text:'fixture'}; }, close:async()=>{} };
  const runtime = new Runtime({store, codex:provider, browser, workspace:directory,repositoryResolver});
  const agentId = store.state.agents[0].id;
  const invoke = async (job, tool, args={}) => {
    runtime.active = job; job.status = 'running'; job.threadId ||= randomUUID();
    const id = randomUUID();
    await runtime.executeRequest({id, method:'item/tool/call', params:{threadId:job.threadId,tool,arguments:args}});
    return provider.replies.find(r=>r.id===id)?.result;
  };
  return {directory,store,provider,runtime,agentId,invoke,get browserCalls(){return browserCalls;},
    close(){runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}};
}
function configured(f) {
  const p=f.store.security, space=p.createSpace({name:`Ink ${randomUUID()}`});
  const resource=p.createResource({spaceId:space.id,type:'memory',name:'Recall'});
  p.putAccess(f.agentId,{revision:p.revision,spaceIds:[space.id],grants:[{spaceId:space.id,resourceId:resource.id,action:'memory.read',mode:'auto',constraints:{}}]});
  return {p,space,resource,job:createJob(f.store.state,{agentId:f.agentId,spaceId:space.id,prompt:'Fixture chat'})};
}
function proof(id, observations) {
  const dir=process.env.ODWYN_SECURITY_REPORT_DIR;
  if (!dir) throw new Error('BLOCKED: ODWYN_SECURITY_REPORT_DIR required');
  mkdirSync(join(dir,'proof'),{recursive:true});
  writeFileSync(join(dir,'proof',`${id}.json`),JSON.stringify({caseId:id,verified:true,environment:`${process.platform}/${process.arch}; disposable SQLite/runtime/HTTP fixtures`,observations,noLiveSystemsTouched:true},null,2));
}

test('AUTH-001 Zero-grant custom agent',async()=>{
  const f=fixture(); try {
    f.store.state.customization={name:`Fern ${randomUUID()}`};
    await f.runtime.refreshAccount();
    const job=f.runtime.submit({prompt:'Explain a poem',interactionMode:'allow'}); await f.runtime.drain();
    expect(f.provider.calls.some(c=>c.method==='turn/start')).toBe(true);
    const marker=join(f.directory,'forbidden-effect');
    for(const [tool,args] of [['odwyn_send_file',{path:'private'}],['odwyn_terminal',{command:`touch '${marker}'`,reason:'fixture'}],['odwyn_browser',{action:'read',reason:'fixture'}],['unreviewed_mcp',{}]])
      expect((await f.invoke(job,tool,args)).success).toBe(false);
    expect(await Bun.file(marker).exists()).toBe(false); expect(f.browserCalls).toBe(0);
    expect(f.provider.calls.find(c=>c.method==='thread/start').params.mcpEnabled).toBe(false);
  } finally {f.close();}
});
test('AUTH-002 Rename and provider independence',()=>{
  const f=fixture();try{
    const {p,space,resource}=configured(f), action={agentId:f.agentId,spaceId:space.id,resourceId:resource.id,action:'memory.read'};
    const before=p.simulate(action); expect(before.mode).toBe('auto');
    Object.assign(f.store.state.agents[0],{customization:{name:'New name',avatar:'fox',specialization:'anything'},provider:{type:'claude',model:'custom'}});
    expect(p.simulate(action)).toEqual(before);
    expect(p.simulate({...action,agentId:randomUUID()}).mode).toBe('deny');
  }finally{f.close();}
});
test('AUTH-003 Owner-defined Spaces',async()=>{
  const f=fixture();try{
    const {p,space,resource,job}=configured(f), other=p.createSpace({name:'陶芸 / Moss'});
    p.createResource({spaceId:other.id,type:'memory',name:'Foreign'});
    expect(p.visible(f.agentId,space.id).resources.map(r=>r.id)).toEqual([resource.id]);
    expect(()=>p.visible(f.agentId,other.id)).toThrow();
    expect(()=>createJob(f.store.state,{agentId:f.agentId,spaceId:other.id,prompt:'Forged Space'})).toThrow();
    f.runtime.active=job;job.status='running';await f.runtime.startJob(job);
    const instructions=f.provider.calls.find(c=>c.method==='thread/start').params.developerInstructions;
    expect(instructions).toContain(resource.id);expect(instructions).not.toContain(other.id);expect(instructions).not.toContain(other.name);
  }finally{f.close();}
});
test('AUTH-004 Resource-scoped repository',async()=>{
  let readsA=0, readsB=0,writes=0;
  const f=fixture(async raw=>({url:new URL(raw.replace('https://fixture.invalid',`http://fixture.invalid:${upstream.port}`)),address:'127.0.0.1',family:4}));
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){if(req.method!=='GET'){writes++;return new Response('no', {status:403});}if(new URL(req.url).pathname==='/repo-a'){readsA++;return new Response('synthetic read',{headers:{'content-type':'text/plain'}});}readsB++;return new Response('foreign');}});
  try{
    const p=f.store.security,space=p.createSpace({name:'Paper satellites'});
    const a=p.createResource({spaceId:space.id,type:'repository',name:'Repo A',metadata:{endpoint:'https://fixture.invalid/repo-a'}});
    const b=p.createResource({spaceId:space.id,type:'repository',name:'Repo B',metadata:{endpoint:'https://fixture.invalid/repo-b'}});
    p.putAccess(f.agentId,{revision:p.revision,spaceIds:[space.id],grants:[{spaceId:space.id,resourceId:a.id,action:'repository.read',mode:'auto',constraints:{}}]});
    const job=createJob(f.store.state,{agentId:f.agentId,spaceId:space.id,prompt:'Read allowed fixture'});
    const permitted=[];
    for(const tool of ['odwyn_repository_read','odwyn_mcp_repository_read']){
      permitted.push(await f.invoke(job,tool,{resourceId:a.id}));
      expect((await f.invoke(job,tool,{resourceId:b.id})).success).toBe(false);
    }
    expect((await f.invoke(job,'mcp_repository_write',{resourceId:a.id,content:'forbidden'})).success).toBe(false);
    expect(readsB).toBe(0);expect(writes).toBe(0);
    for(const result of permitted)expect(JSON.parse(result.contentItems[0].text).content).toBe('synthetic read');
    expect(permitted.every(result=>result.success===true)).toBe(true);expect(readsA).toBe(2);
  }finally{
    const dir=process.env.ODWYN_SECURITY_REPORT_DIR;
    if(dir){mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'repository-upstream.json'),JSON.stringify({readsA,readsB,writes,gatewayAvailable:true,noLiveSystemsTouched:true}));}
    upstream.stop(true);f.close();
  }
});
test('AUTH-005 Agent/Space spoofing',async()=>{
  const f=fixture();try{
    const {p,space,resource,job}=configured(f),other=p.createSpace({name:'Other'});
    expect(()=>createJob(f.store.state,{agentId:f.agentId,spaceId:other.id,prompt:'Spoof'})).toThrow();
    expect(()=>createJob(f.store.state,{agentId:randomUUID(),prompt:'Spoof'})).toThrow();
    expect((await f.invoke(job,'odwyn_search',{query:'fixture',resourceId:resource.id,spaceId:other.id,agentId:randomUUID()})).success).toBe(false);
    expect(()=>f.runtime.launchWorkflow({id:randomUUID(),steps:[],inputs:[]},{agentId:randomUUID(),spaceId:other.id})).toThrow();
    expect(Object.isFrozen(job.securityContext)).toBe(true);
    expect(()=>{job.securityContext.spaceId=other.id;}).toThrow();
    proof('AUTH-005',{forgedSpaceRejected:true,forgedAgentRejected:true,forgedToolRejected:true,workflowRejected:true,contextFrozen:true,browserCalls:f.browserCalls});
  }finally{f.close();}
});
test('AUTH-006 Explicit deny wins',()=>{
  const f=fixture();try{
    const {p,space,resource}=configured(f),grants=[{spaceId:space.id,resourceId:'*',action:'memory.read',mode:'auto',constraints:{}},{spaceId:space.id,resourceId:resource.id,action:'memory.read',mode:'deny',constraints:{}}];
    p.putAccess(f.agentId,{revision:p.revision,spaceIds:[space.id],confirmWildcard:true,grants});
    expect(p.simulate({agentId:f.agentId,spaceId:space.id,resourceId:resource.id,action:'memory.read'}).mode).toBe('deny');
    const second=p.createResource({spaceId:space.id,type:'memory',name:'Other recall'});
    expect(p.simulate({agentId:f.agentId,spaceId:space.id,resourceId:second.id,action:'memory.read'}).mode).toBe('auto');
  }finally{f.close();}
});
test('AUTH-007 Unknown capability',async()=>{
  const f=fixture();try{
    const {p,space,resource,job}=configured(f);
    for(const action of ['owner.admin','arbitrary.execute','https://*.invalid','constructor','__proto__'])expect(p.simulate({agentId:f.agentId,spaceId:space.id,resourceId:resource.id,action}).mode).toBe('deny');
    expect((await f.invoke(job,'dynamic_unreviewed',{url:'https://*.invalid'})).success).toBe(false);
    expect(f.browserCalls).toBe(0);
    expect(()=>p.putAccess(f.agentId,{revision:p.revision,spaceIds:[space.id],grants:[{spaceId:space.id,resourceId:resource.id,action:'memory.read',mode:'auto',constraints:{unimplemented:true}}]})).toThrow();
  }finally{f.close();}
});
test('AUTH-008 Live revocation',async()=>{
  const f=fixture();try{
    const {p,space,resource,job}=configured(f);
    const queued=createJob(f.store.state,{agentId:f.agentId,spaceId:space.id,prompt:'Queued recall'});
    f.store.save();
    const allowed=await f.invoke(job,'odwyn_search',{query:'fixture',resourceId:resource.id});
    expect(allowed.success).toBe(true);
    expect(JSON.parse(allowed.contentItems[0].text).matches.some(m=>m.text==='Fixture chat')).toBe(true);
    p.putAccess(f.agentId,{revision:p.revision,spaceIds:[space.id],grants:[]});
    for(const next of [job,queued])expect((await f.invoke(next,'odwyn_search',{query:'fixture',resourceId:resource.id})).success).toBe(false);
    expect(f.browserCalls).toBe(0);
  }finally{f.close();}
});
test('AUTH-009 Self-grant prohibited',async()=>{
  const f=fixture();let app;try{
    const {p,space,job}=configured(f),revision=p.revision;
    app=createApp({directory:join(f.directory,'http'),user:'fixture',password:'fixture-password-only',origin:'http://127.0.0.1:4317',codex:new FixtureProvider(),browser:{close:async()=>{}}});
    for(const authorization of [null,'Bearer synthetic-agent-token','Basic '+btoa('agent:synthetic-password')]){
      const res=await app.fetch(new Request('http://127.0.0.1:4317/api/agents/'+f.agentId+'/access',{method:'PUT',headers:{origin:'http://127.0.0.1:4317','content-type':'application/json',...(authorization?{authorization}:{})},body:JSON.stringify({revision,spaceIds:[space.id],grants:[]})}));
      expect(res.status).toBe(401);
    }
    for(const [tool,args] of [['odwyn_policy_edit',{grants:['*']}],['mcp_policy_edit',{}],['odwyn_terminal',{command:'true',reason:'Self grant'}],['odwyn_schedule',{prompt:'Grant me access',at:new Date(Date.now()+60000).toISOString(),intervalMinutes:0,interactionMode:'confirm'}]])expect((await f.invoke(job,tool,args)).success).toBe(false);
    await expect(f.runtime.executeRequest({id:randomUUID(),method:'item/tool/call',workflowAction:true,params:{threadId:job.threadId,tool:'odwyn_terminal',arguments:{command:'true',reason:'Workflow self-grant attempt'}}})).rejects.toThrow();
    expect(p.revision).toBe(revision);expect(f.store.state.schedules).toHaveLength(0);
    proof('AUTH-009',{httpUnauthorized:3,taskMutationDenied:4,revisionUnchanged:true,routinesCreated:0,browserCalls:f.browserCalls});
  }finally{if(app)await app.close();f.close();}
});
test('AUTH-010 Policy stale revision',async()=>{
  const f=fixture();try{
    const {p,space,resource,job}=configured(f),old=p.revision;
    p.putAccess(f.agentId,{revision:old,spaceIds:[space.id],grants:[]});
    expect(()=>p.putAccess(f.agentId,{revision:old,spaceIds:[space.id],grants:[]})).toThrow();
    expect((await f.invoke(job,'odwyn_search',{query:'fixture',resourceId:resource.id})).success).toBe(false);
    expect(job.securityContext.policyRevision).toBe(old);
  }finally{f.close();}
});
test('AUTH-011 Mode never grants access',async()=>{
  const f=fixture();try{
    for(const interactionMode of ['confirm','safe','allow']){
      const job=createJob(f.store.state,{agentId:f.agentId,prompt:'Fixture',interactionMode});
      expect((await f.invoke(job,'odwyn_browser',{action:'read',reason:'fixture'})).success).toBe(false);
      expect((await f.invoke(job,'odwyn_search',{query:'fixture'})).success).toBe(false);
    }
    expect(f.browserCalls).toBe(0);
    f.store.state.schedules.push({id:randomUUID(),agentId:f.agentId,prompt:'Fixture scheduled shell',enabled:true,nextAt:new Date(0).toISOString(),interactionMode:'allow'});
    enqueueSchedules(f.store.state);
    expect((await f.invoke(f.store.state.jobs[0],'odwyn_terminal',{command:'true',reason:'fixture'})).success).toBe(false);
  }finally{f.close();}
});
test('AUTH-012 Property-based monotonicity',()=>{
  const f=fixture();try{
    const {p,space,resource}=configured(f);let seed=773;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
    const targets=[{space,resource}];
    for(let i=0;i<2;i++){const s=p.createSpace({name:`Random ${random()}`});targets.push({space:s,resource:p.createResource({spaceId:s.id,type:'memory',name:String(random())})});}
    const spaceIds=targets.map(t=>t.space.id);
    for(let i=0;i<100;i++){
      const target=targets[random()%targets.length],space=target.space,resource=target.resource;
      const request={agentId:f.agentId,spaceId:space.id,resourceId:resource.id,action:'memory.read'};
      const mode=['auto','ask','deny'][random()%3],grant={spaceId:space.id,resourceId:random()%2?'*':resource.id,action:'memory.read',mode,constraints:{}};
      p.putAccess(f.agentId,{revision:p.revision,spaceIds,confirmWildcard:true,grants:[grant]});
      const before=p.simulate(request); f.store.state.agents[0].customization={name:String(random())}; expect(p.simulate(request)).toEqual(before);
      p.putAccess(f.agentId,{revision:p.revision,spaceIds,confirmWildcard:true,grants:[grant,{...grant,resourceId:resource.id,mode:'deny'}]});
      expect(p.simulate(request).mode).toBe('deny');
    }
  }finally{f.close();}
});

test('owner policy APIs require authentication and preserve atomic revisions',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-auth-api-'));
  const app=createApp({directory,user:'fixture',password:'fixture-password-only',origin:'http://127.0.0.1:4317',codex:new FixtureProvider(),browser:{close:async()=>{}}});
  const request=(path,method='GET',body,authenticated=true)=>app.fetch(new Request('http://127.0.0.1:4317'+path,{method,headers:{origin:'http://127.0.0.1:4317',...(body?{'content-type':'application/json'}:{}),...(authenticated?{authorization:'Basic '+btoa('fixture:fixture-password-only')}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  try{
    const agentId=app.runtime.state.agents[0].id;
    for(const [path,method,body] of [['/api/spaces','POST',{name:'Denied'}],['/api/resources','POST',{name:'Denied'}],['/api/capabilities','GET'],['/api/policy/simulate','POST',{action:'memory.read'}],['/api/agents/'+agentId+'/access','PUT',{grants:[]}]] )expect((await request(path,method,body,false)).status).toBe(401);
    const created=await request('/api/spaces','POST',{name:'Clouds / Clay'});expect(created.status).toBe(201);const space=await created.json();
    expect((await (await request('/api/spaces')).json()).some(s=>s.id===space.id)).toBe(true);
    expect((await (await request('/api/capabilities')).json()).schemaVersion).toBe(1);
    const made=await request('/api/resources','POST',{name:'Recall',type:'memory',spaceId:space.id});expect(made.status).toBe(201);const resource=await made.json();
    const access=await (await request('/api/agents/'+agentId+'/access')).json();
    const body={revision:access.revision,spaceIds:[space.id],grants:[{spaceId:space.id,resourceId:resource.id,action:'memory.read',mode:'auto',constraints:{}}]};
    expect((await request('/api/agents/'+agentId+'/access','PUT',body)).status).toBe(200);
    expect((await request('/api/agents/'+agentId+'/access','PUT',body)).status).toBe(400);
    const action={agentId,spaceId:space.id,resourceId:resource.id,action:'memory.read'};
    expect((await (await request('/api/policy/simulate','POST',action)).json()).mode).toBe('auto');
    expect((await (await request('/api/policy/simulate','POST',{...action,resourceId:randomUUID()})).json()).mode).toBe('deny');
    expect((await request('/api/resources','POST',{name:'No',type:'unknown',spaceId:space.id})).status).toBe(400);
  }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});

test('policy reload preserves grants and authoritative contexts; ask never executes',async()=>{
  const f=fixture();let reopened;try{
    const {p,space,resource,job}=configured(f);
    const request={agentId:f.agentId,spaceId:space.id,resourceId:resource.id,action:'memory.read'};
    const rev=p.revision;
    f.store.save();reopened=openStore(f.directory);
    expect(reopened.security.revision).toBe(rev);
    expect(reopened.security.simulate(request).mode).toBe('auto');
    expect(reopened.security.context(reopened.state.jobs[0])).toEqual(job.securityContext);
    p.putAccess(f.agentId,{revision:p.revision,spaceIds:[space.id],grants:[{spaceId:space.id,resourceId:resource.id,action:'memory.read',mode:'ask',constraints:{}}]});
    expect((await f.invoke(job,'odwyn_search',{query:'fixture',resourceId:resource.id})).success).toBe(false);
    expect(()=>p.context({...job,agentId:randomUUID()})).toThrow();
  }finally{reopened?.close();f.close();}
});

test('legacy migration backup includes committed WAL and restores chat without grants',()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-policy-migration-'));
  let store,restored,backup;
  const db=new Database(join(directory,'odwyn.db'));
  const original={agents:[{id:randomUUID(),customization:{name:'Handmade identity'}}],preferences:'Owner preference',conversations:[],jobs:[],schedules:[]};
  original.conversations.push({id:randomUUID(),agentId:original.agents[0].id,messages:[{id:randomUUID(),text:'Synthetic saved chat',role:'user',agentId:original.agents[0].id}]});
  try{
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE state(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
    db.query('INSERT INTO state VALUES(1,?)').run(JSON.stringify(original));
    store=openStore(directory);
    const backupDir=join(directory,readdirSync(directory).find(n=>n.startsWith('pre-security-'))),path=join(backupDir,'state.sqlite');
    expect(statSync(backupDir).mode & 0o777).toBe(0o700);expect(statSync(path).mode & 0o777).toBe(0o600);
    backup=new Database(path,{readonly:true});expect(JSON.parse(backup.query('SELECT value FROM state WHERE id=1').get().value)).toEqual(original);
    expect(backup.query("SELECT name FROM sqlite_master WHERE name='security_meta'").get()).toBeNull();
    expect(store.security.access(original.agents[0].id).grants).toHaveLength(0);
    const restoreDir=join(directory,'restored');mkdirSync(restoreDir,{mode:0o700});copyFileSync(path,join(restoreDir,'odwyn.db'));
    restored=openStore(restoreDir);
    expect(restored.state.conversations[0].messages[0].text).toBe('Synthetic saved chat');
    expect(restored.state.agents[0].id).toBe(original.agents[0].id);
    expect(restored.security.access(original.agents[0].id).grants).toHaveLength(0);
  }finally{backup?.close();restored?.close();store?.close();db.close();rmSync(directory,{recursive:true,force:true});}
});
