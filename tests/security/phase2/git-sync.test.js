import {test,expect} from 'bun:test';
import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixture.js';
import {createJob} from '../../../store.js';
import {workspaceSource} from '../../../execution/workspace-source.js';
import {validateGitSync} from '../../../execution/git-sync.js';

const rawGit=(cwd,args)=>{const result=Bun.spawnSync(['git',...args],{cwd,env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}});if(result.exitCode!==0)throw Error(result.stderr.toString());return result.stdout.toString().trim();};

test('real linked Git checkout and pull use scoped HTTP, preserve files, checkpoint metadata and reject dirty/diverged work',async()=>{
 const f=await fixture();
 try{
  const p=f.store.security,root=join(f.directory,'git-sources');
  const resource=p.createResource({spaceId:f.job.spaceId,type:'workspace',name:'Git coding',metadata:{sourceFolder:'project',repositoryId:f.repository.id}});
  workspaceSource(root,'project',{create:true});
  f.runtime.sandbox.snapshotRoot=root;f.runtime.sandbox.snapshotResolver=()=>join(root,'project');
  const access=()=>p.putAccess(f.job.agentId,{revision:p.revision,spaceIds:[f.job.spaceId],grants:[{spaceId:f.job.spaceId,resourceId:resource.id,action:'sandbox.exec',mode:'auto'},{spaceId:f.job.spaceId,resourceId:f.repository.id,action:'repository.read',mode:'auto'}]});access();
  const args={resourceId:f.repository.id,workspaceId:resource.id,branch:'main',operation:'checkout'};
  const initial=await f.invoke('odwyn_repository_sync',args);expect(initial.success).toBe(true);const first=JSON.parse(initial.contentItems[0].text);expect(first.branch).toBe('main');expect(first.commit).toMatch(/^[a-f0-9]{40}$/);expect(first.checkpoint.id).toMatch(/^[a-f0-9]{64}$/);
  const git=async argv=>{const result=await f.runtime.sandbox.git(f.job,argv,{});expect(result.exitCode).toBe(0);return result.stdout.toString().trim();};
  expect(await git(['branch','--show-current'])).toBe('main');expect(await git(['rev-parse','HEAD'])).toBe(first.commit);
  const worker=f.runtime.sandbox.workers.get(f.job.id),read=await f.runtime.sandbox.inside(worker,['cat','/workspace/public.txt'],{});expect(read.stdout.toString()).toContain('Synthetic permitted workspace');
  expect(f.worker().HostConfig.NetworkMode).toBe('none');expect(f.worker().Mounts.some(row=>row.Type==='bind')).toBe(false);expect(f.requests.every(row=>row.method==='GET'||row.path.endsWith('/git-upload-pack'))).toBe(true);
  const checkpoint=await f.runtime.sandbox.loadCheckpoint(f.job,resource.id,first.checkpoint.id);expect(checkpoint.files.some(file=>file.path==='.git/HEAD')).toBe(true);expect(checkpoint.files.some(file=>file.path==='.git/config')).toBe(false);expect(JSON.stringify(checkpoint)).not.toContain(f.canary);
  writeFileSync(join(f.workspace,'new.txt'),'Latest remote update');rawGit(f.workspace,['add','new.txt']);rawGit(f.workspace,['commit','-m','Remote update']);rawGit(f.workspace,['push',join(f.directory,'sample-alpha.git'),'main']);
  const pulled=await f.invoke('odwyn_repository_sync',{...args,operation:'pull'});expect(pulled.success).toBe(true);const second=JSON.parse(pulled.contentItems[0].text);expect(second.commit).not.toBe(first.commit);expect(await git(['rev-parse','HEAD'])).toBe(second.commit);
  await f.runtime.sandbox.inside(worker,['bun','-e','require("node:fs").writeFileSync("/workspace/new.txt","LOCAL CHANGE")'],{});
  const dirty=await f.invoke('odwyn_repository_sync',{...args,operation:'pull'});expect(dirty.success).toBe(false);expect(JSON.stringify(dirty)).toContain('uncommitted');expect((await f.runtime.sandbox.inside(worker,['cat','/workspace/new.txt'],{})).stdout.toString()).toBe('LOCAL CHANGE');
  await git(['add','new.txt']);await git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Local commit']);
  const diverged=await f.invoke('odwyn_repository_sync',{...args,operation:'pull'});expect(diverged.success).toBe(false);expect(JSON.stringify(diverged)).toContain('diverged');
  const unknown=await f.invoke('odwyn_repository_sync',{...args,branch:'absent'});expect(unknown.success).toBe(false);expect(JSON.stringify(unknown)).toContain('not advertised');
  const before=f.requests.length;p.putAccess(f.job.agentId,{revision:p.revision,spaceIds:[f.job.spaceId],grants:[{spaceId:f.job.spaceId,resourceId:resource.id,action:'sandbox.exec',mode:'auto'}]});
  expect((await f.invoke('odwyn_repository_sync',args)).success).toBe(false);expect(f.requests.length).toBe(before);
  expect(readFileSync(join(f.workspace,'public.txt'),'utf8')).toContain('Synthetic permitted workspace');
  for(const branch of ['../main','main.lock','HEAD','main..x','--upload-pack=x','main;touch x','main\n'])expect(()=>validateGitSync({...args,branch})).toThrow();
 }finally{await f.close();}
},120000);

test('linked Git adopts exact copied source safely, refuses mismatches and restores a real checkpoint without credentials',async()=>{
 const f=await fixture();
 try{
  const p=f.store.security,root=join(f.directory,'adopt'),resource=p.createResource({spaceId:f.job.spaceId,type:'workspace',name:'Copied project',metadata:{sourceFolder:'copied',repositoryId:f.repository.id}});
  workspaceSource(root,'copied',{create:true});writeFileSync(join(root,'copied/public.txt'),'Synthetic permitted workspace');
  f.runtime.sandbox.snapshotResolver=()=>join(root,'copied');p.putAccess(f.job.agentId,{revision:p.revision,spaceIds:[f.job.spaceId],grants:[{spaceId:f.job.spaceId,resourceId:resource.id,action:'sandbox.exec',mode:'auto'},{spaceId:f.job.spaceId,resourceId:f.repository.id,action:'repository.read',mode:'auto'}]});
  const args={resourceId:f.repository.id,workspaceId:resource.id,branch:'main',operation:'checkout'},result=await f.invoke('odwyn_repository_sync',args);expect(result.success).toBe(true);const saved=JSON.parse(result.contentItems[0].text).checkpoint;
  await f.runtime.sandbox.stop(f.job.id);const next=createJob(f.store.state,{agentId:f.job.agentId,spaceId:f.job.spaceId,prompt:'Restore Git metadata'});
  await f.runtime.sandbox.restore(next,resource.id,saved.id);expect((await f.runtime.sandbox.git(next,['branch','--show-current'],{})).stdout.toString().trim()).toBe('main');await f.runtime.sandbox.stop(next.id);
  delete f.store.state.executionHeads[resource.id];f.job.workspacePin=null;f.job.workspaceDirty=false;writeFileSync(join(root,'copied/public.txt'),'Uncommitted original');
  const mismatch=await f.invoke('odwyn_repository_sync',args);expect(mismatch.success).toBe(false);expect(JSON.stringify(mismatch)).toContain('differs');
  expect(readFileSync(join(root,'copied/public.txt'),'utf8')).toBe('Uncommitted original');const worker=f.runtime.sandbox.workers.get(f.job.id);expect((await f.runtime.sandbox.inside(worker,['cat','/workspace/public.txt'],{})).stdout.toString()).toBe('Uncommitted original');expect((await f.runtime.sandbox.inside(worker,['test','-e','/workspace/.git'],{})).exitCode).toBe(1);
 }finally{await f.close();}
},120000);

test('Git fetch rechecks revocation, rejects corrupt packs and classifies failed reads; unsafe trees never materialize',async()=>{
 const f=await fixture();
 try{
  const p=f.store.security,root=join(f.directory,'revoke'),resource=p.createResource({spaceId:f.job.spaceId,type:'workspace',name:'Revocation probe',metadata:{sourceFolder:'project',repositoryId:f.repository.id}});
  workspaceSource(root,'project',{create:true});f.runtime.sandbox.snapshotResolver=()=>join(root,'project');
  const access=read=>p.putAccess(f.job.agentId,{revision:p.revision,spaceIds:[f.job.spaceId],grants:[{spaceId:f.job.spaceId,resourceId:resource.id,action:'sandbox.exec',mode:'auto'},...(read?[{spaceId:f.job.spaceId,resourceId:f.repository.id,action:'repository.read',mode:'auto'}]:[])]});access(true);
  const args={resourceId:f.repository.id,workspaceId:resource.id,branch:'main',operation:'checkout'},gateway=f.runtime.gitGateway,request=gateway.request.bind(gateway);
  gateway.request=async(...values)=>{const result=await request(...values);access(false);return result;};
  const revoked=await f.invoke('odwyn_repository_sync',args);expect(revoked.success).toBe(false);expect(f.requests.length).toBe(1);
  const worker=f.runtime.sandbox.workers.get(f.job.id);expect((await f.runtime.sandbox.inside(worker,['test','-e','/workspace/.git'],{})).exitCode).toBe(1);expect(f.job.workspaceDirty).toBe(true);
  const {Database}=await import('bun:sqlite'),db=new Database(join(f.directory,'app/odwyn.db'),{readonly:true});try{expect(db.query('SELECT action FROM data_sources WHERE task_id=? AND resource_id=?').get(f.job.id,f.repository.id)?.action).toBe('repository.read');}finally{db.close();}
  access(true);gateway.request=async(...values)=>{const result=await request(...values);return values[2]==='POST'?Buffer.concat([Buffer.from('0008NAK\nPACK'),Buffer.alloc(20)]):result;};
  const corrupt=await f.invoke('odwyn_repository_sync',args);expect(corrupt.success).toBe(false);expect(JSON.stringify(corrupt)).toContain('Cannot index fetched history');expect((await f.runtime.sandbox.inside(worker,['test','-e','/workspace/.git'],{})).exitCode).toBe(1);
  gateway.request=request;writeFileSync(join(f.workspace,'.env'),'SYNTHETIC_UNSAFE_FILE');rawGit(f.workspace,['add','.env']);rawGit(f.workspace,['commit','-m','Unsafe fixture tree']);rawGit(f.workspace,['push',join(f.directory,'sample-alpha.git'),'main']);
  const unsafe=await f.invoke('odwyn_repository_sync',args);expect(unsafe.success).toBe(false);expect((await f.runtime.sandbox.inside(worker,['test','-e','/workspace/.env'],{})).exitCode).toBe(1);expect((await f.runtime.sandbox.inside(worker,['test','-e','/workspace/.git'],{})).exitCode).toBe(1);
 }finally{await f.close();}
},120000);

test('delta-compressed Git history stays packed, checkpoints, restores and pulls within existing worker limits',async()=>{
 const f=await fixture();
 try{
  const history=randomBytes(6*1024*1024);for(let version=0;version<4;version++){history[version]^=1;writeFileSync(join(f.workspace,'historical.bin'),history);rawGit(f.workspace,['add','historical.bin']);rawGit(f.workspace,['commit','-m','Synthetic history '+version]);}rawGit(f.workspace,['rm','historical.bin']);rawGit(f.workspace,['commit','-m','Small current tree']);rawGit(f.workspace,['push',join(f.directory,'sample-alpha.git'),'main']);
  const p=f.store.security,root=join(f.directory,'history-limit'),resource=p.createResource({spaceId:f.job.spaceId,type:'workspace',name:'History limit',metadata:{sourceFolder:'project',repositoryId:f.repository.id}});
  workspaceSource(root,'project',{create:true});f.runtime.sandbox.snapshotResolver=()=>join(root,'project');p.putAccess(f.job.agentId,{revision:p.revision,spaceIds:[f.job.spaceId],grants:[{spaceId:f.job.spaceId,resourceId:resource.id,action:'sandbox.exec',mode:'auto'},{spaceId:f.job.spaceId,resourceId:f.repository.id,action:'repository.read',mode:'auto'}]});
  const args={resourceId:f.repository.id,workspaceId:resource.id,branch:'main',operation:'checkout'},result=await f.invoke('odwyn_repository_sync',args);
  expect(result.success).toBe(true);const first=JSON.parse(result.contentItems[0].text),worker=f.runtime.sandbox.workers.get(f.job.id);
  expect(f.worker().HostConfig.Tmpfs['/tmp']).toContain('size=16m');expect(f.worker().HostConfig.NetworkMode).toBe('none');
  const packed=await f.runtime.sandbox.loadCheckpoint(f.job,resource.id,first.checkpoint.id);expect(packed.files.some(file=>/^\.git\/objects\/pack\/pack-.*\.pack$/.test(file.path))).toBe(true);expect(packed.files.reduce((bytes,file)=>bytes+Buffer.from(file.data,'base64').length,0)).toBeLessThan(16*1024*1024);expect(JSON.stringify(packed)).not.toContain(f.canary);
  expect((await f.runtime.sandbox.inside(worker,['ls','-A','/tmp'],{})).stdout.toString().trim()).toBe('');
  writeFileSync(join(f.workspace,'later.txt'),'Later remote update');rawGit(f.workspace,['add','later.txt']);rawGit(f.workspace,['commit','-m','Later update']);rawGit(f.workspace,['push',join(f.directory,'sample-alpha.git'),'main']);
  const pulled=await f.invoke('odwyn_repository_sync',{...args,operation:'pull'});expect(pulled.success).toBe(true);const saved=JSON.parse(pulled.contentItems[0].text);expect(saved.commit).not.toBe(first.commit);
  await f.runtime.sandbox.stop(f.job.id);const next=createJob(f.store.state,{agentId:f.job.agentId,spaceId:f.job.spaceId,prompt:'Restore packed history'});
  try{await f.runtime.sandbox.restore(next,resource.id,saved.checkpoint.id);expect((await f.runtime.sandbox.git(next,['rev-parse','HEAD'],{})).stdout.toString().trim()).toBe(saved.commit);const log=await f.runtime.sandbox.git(next,['log','--oneline','--all'],{});expect(log.exitCode).toBe(0);expect(log.stdout.toString()).toContain('Synthetic history 0');}finally{await f.runtime.sandbox.stop(next.id);}
 }finally{await f.close();}
},120000);
