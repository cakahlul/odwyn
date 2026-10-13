import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore, createJob } from '../../../store.js';
import { Runtime } from '../../../runtime.js';
import { Database } from 'bun:sqlite';
import { FixtureProvider } from '../fixtures.js';

export class SecurityEnvironmentBlocked extends Error {
  name='SecurityEnvironmentBlocked';
  constructor(reason){super(`BLOCKED: ${reason}`);}
}
export const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
export const script = code => `bun -e ${quote(code)}`;
const dockerEnv = {PATH:process.env.PATH,DOCKER_HOST:process.env.DOCKER_HOST||(process.platform==='darwin'?`unix://${join(homedir(),'.docker/run/docker.sock')}`:'unix:///var/run/docker.sock')};
const cleanEnv = {PATH:process.env.PATH, GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'/dev/null', GIT_TERMINAL_PROMPT:'0'};
function git(args,cwd){
  const result=Bun.spawnSync(['git',...args],{cwd,env:cleanEnv});
  if(result.exitCode!==0)throw new Error('Disposable Git fixture command failed.');
  return result.stdout.toString().trim();
}
let environment;
export async function runnerEnvironment(){
  if(environment)return environment;
  if(!process.env.ODWYN_SECURITY_SANDBOX_IMAGE)throw new SecurityEnvironmentBlocked('Pinned disposable sandbox image required.');
  if(process.env.ODWYN_SECURITY_ISOLATION_RUNNER!=='1')throw new SecurityEnvironmentBlocked('Disposable runner declaration missing; no isolation probes authorized.');
  const result=Bun.spawnSync(['docker','info','--format','{"os":{{json .OSType}},"security":{{json .SecurityOptions}},"cgroups":{{json .CgroupVersion}},"driver":{{json .CgroupDriver}},"system":{{json .OperatingSystem}}}'],{env:dockerEnv,timeout:15000});
  if(result.exitCode!==0)throw new SecurityEnvironmentBlocked('Docker daemon unavailable.');
  const info=JSON.parse(result.stdout.toString());
  if(info.os!=='linux'||!(info.security.some(s=>s.includes('rootless'))||process.platform==='darwin'&&info.system==='Docker Desktop')||String(info.cgroups)!=='2')throw new SecurityEnvironmentBlocked('Rootless Linux or Docker Desktop Linux VM with cgroup v2 required.');

  environment=info;return info;
}
export function record(caseId,status,observations,reason){
  const dir=process.env.ODWYN_SECURITY_REPORT_DIR;
  if(!dir)throw new SecurityEnvironmentBlocked('ODWYN_SECURITY_REPORT_DIR required.');
  mkdirSync(join(dir,'proof'),{recursive:true});mkdirSync(join(dir,'execution'),{recursive:true});
  writeFileSync(join(dir,'proof',caseId+'.json'),JSON.stringify({caseId,verified:status==='PASS',environment:`${process.platform}/${process.arch}; disposable Odwyn runtime + Linux Docker workers/cgroup v2 required`,observations,status,reason,noLiveSystemsTouched:true},null,2));
  writeFileSync(join(dir,'execution',caseId+'.json'),JSON.stringify({caseId,status,reason,probeExecuted:status!=='BLOCKED',noLiveSystemsTouched:true}));
}
export async function fixture(){
  await runnerEnvironment();
  const directory=mkdtempSync(join(tmpdir(),'odwyn-exec-'));
  const workspace=join(directory,'space-a');mkdirSync(workspace);mkdirSync(join(directory,'space-b'));
  const canary='synthetic_'+randomUUID().replaceAll('-','');
  const hostPaths=['.env','codex/auth.json','browser/Cookies','state.sqlite','ssh/id_ed25519','space-b/private.txt'];
  for(const path of hostPaths){const full=join(directory,path);mkdirSync(join(full,'..'),{recursive:true});writeFileSync(full,canary,{mode:0o600});}
  writeFileSync(join(workspace,'public.txt'),'Synthetic permitted workspace');
  git(['init','-b','main'],workspace);git(['config','user.name','Fixture'],workspace);git(['config','user.email','fixture@example.invalid'],workspace);
  git(['add','public.txt'],workspace);git(['commit','-m','Synthetic base'],workspace);
  const remote=join(directory,'sample-alpha.git');git(['clone','--bare',workspace,remote],directory);git(['config','http.receivepack','true'],remote);
  const requests=[];
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
    const url=new URL(req.url);if(req.headers.get('authorization')!=='Bearer '+canary)return new Response('Synthetic authentication required',{status:401});requests.push({method:req.method,path:url.pathname});
    const body=Buffer.from(await req.arrayBuffer());
    if(body.length>1024*1024)return new Response('bounded fixture',{status:413});
    const child=Bun.spawn(['git','http-backend'],{env:{...cleanEnv,GIT_PROJECT_ROOT:directory,GIT_HTTP_EXPORT_ALL:'1',REMOTE_USER:'fixture',REQUEST_METHOD:req.method,PATH_INFO:url.pathname,QUERY_STRING:url.search.slice(1),CONTENT_TYPE:req.headers.get('content-type')||'',CONTENT_LENGTH:String(body.length)},stdin:body,stdout:'pipe',stderr:'ignore'});
    const bytes=Buffer.from(await new Response(child.stdout).arrayBuffer());if(await child.exited!==0)return new Response('fixture failed',{status:500});
    const split=bytes.indexOf('\r\n\r\n');if(split<0)return new Response('invalid fixture response',{status:500});
    const headers=new Headers();let status=200;
    for(const line of bytes.subarray(0,split).toString().split('\r\n')){const i=line.indexOf(':');if(i<0)continue;if(line.slice(0,i).toLowerCase()==='status')status=Number(line.slice(i+1).trim().split(' ')[0]);else headers.set(line.slice(0,i),line.slice(i+1).trim());}
    return new Response(bytes.subarray(split+4),{status,headers});
  }});
  let sinkCalls=0;
  const sink=Bun.serve({hostname:'0.0.0.0',port:0,fetch(){sinkCalls++;return new Response('synthetic sink');}});
  let store,runtime;
  try {
  if((await fetch(`http://127.0.0.1:${sink.port}/positive-control`)).status!==200||sinkCalls!==1)throw new Error('Network sink positive control failed.');sinkCalls=0;
  store=openStore(join(directory,'app'));const provider=new FixtureProvider();
  const snapshots=new Map();
  let repository;
  runtime=new Runtime({execution:{image:process.env.ODWYN_SECURITY_SANDBOX_IMAGE,snapshotResolver:resource=>{if(!snapshots.has(resource.id))throw new Error('Unknown snapshot');return snapshots.get(resource.id);}},gitCredentialResolver:(resourceId,context)=>{if(resourceId!==repository.id||context.taskId!==runtime.active?.id)throw new Error('Unscoped credential request');return canary;},store,codex:provider,browser:{close:async()=>{},interrupt:async()=>{}},workspace,
    repositoryResolver:async raw=>({url:new URL(raw.replace('https://fixture.invalid',`http://fixture.invalid:${upstream.port}`)),address:'127.0.0.1',family:4})});
  const p=store.security,agentId=store.state.agents[0].id,space=p.createSpace({name:'Lichen '+randomUUID()});
  const resource=p.createResource({spaceId:space.id,type:'workspace',name:'Disposable coding workspace'});
  snapshots.set(resource.id,workspace);
  repository=p.createResource({spaceId:space.id,type:'repository',name:'Synthetic alpha',metadata:{endpoint:'https://fixture.invalid/sample-alpha.git'}});
  p.putAccess(agentId,{revision:p.revision,spaceIds:[space.id],grants:[{spaceId:space.id,resourceId:resource.id,action:'sandbox.exec',mode:'auto',constraints:{}}]});
  const job=createJob(store.state,{agentId,spaceId:space.id,prompt:'Disposable sandbox probes',interactionMode:'allow'});
  runtime.active=job;job.status='running';job.threadId=randomUUID();
  const invoke=async(tool,args)=>{
    const id=randomUUID();await runtime.executeRequest({id,method:'item/tool/call',params:{threadId:job.threadId,tool,arguments:args}});
    const reply=provider.replies.find(r=>r.id===id)?.result;
    if(!reply)throw new Error('Actual runtime reply missing.');return reply;
  };
  const exec=async(command,timeoutMs=5000)=>{
    const reply=await invoke('odwyn_terminal',{resourceId:resource.id,command,reason:'Disposable OS security probe',timeoutMs});
    if(!reply.success)throw new Error('Authorized isolated execution did not occur.');
    return JSON.parse(reply.contentItems[0].text);
  };
  const worker=()=>{
    const ids=Bun.spawnSync(['docker','ps','-aq','--filter',`label=odwyn.task=${job.id}`],{env:dockerEnv});
    const matches=ids.stdout.toString().trim().split('\n').filter(Boolean);
    if(ids.exitCode!==0||matches.length!==1)throw new Error('One task-bound OS worker must exist.');
    const inspected=Bun.spawnSync(['docker','inspect',matches[0]],{env:dockerEnv});if(inspected.exitCode!==0)throw new Error('Cannot inspect actual task worker.');
    return JSON.parse(inspected.stdout.toString())[0];
  };
  return {directory,workspace,canary,hostPaths:hostPaths.map(path=>join(directory,path)),store,runtime,job,resource,repository,exec,invoke,worker,requests,
    sinkUrl:`http://host.docker.internal:${sink.port}/sink`,sinkPositiveControl:true,get sinkCalls(){return sinkCalls;},
    audit:()=>{const db=new Database(join(directory,'app','odwyn.db'),{readonly:true});try{return db.query('SELECT action,mode,reason FROM security_events WHERE task_id=?').all(job.id);}finally{db.close();}},
    refs:()=>git(['show-ref'],remote),git:args=>git(args,remote),
    async close(){await runtime.close();upstream.stop(true);sink.stop(true);store.close();rmSync(directory,{recursive:true,force:true});}};
  } catch(error) {await runtime?.close();upstream.stop(true);sink.stop(true);store?.close();rmSync(directory,{recursive:true,force:true});throw error;}
}
