import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {openStore,createJob} from '../store.js';
import {createApp} from '../server.js';
import {Sandbox} from '../execution/sandbox.js';

test('reusable projects inherit exact Space grants, scope Git credentials, persist and leave legacy resources intact',()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-catalog-'));let store=openStore(directory);
 try{
  const p=store.security,space=p.createSpace({name:'Grooming'}),planning=p.createSpace({name:'Planning'}),agentId=store.state.agents[0].id;
  const connection=store.connectors.create({spaceId:p.legacySpaceId,type:'git-https-v1',name:'Git',endpoint:'https://github.com/example/tere.git',credential:'synthetic-catalog-secret'});
  const repository=p.createResource({spaceId:p.legacySpaceId,type:'repository',name:'Git source',metadata:{endpoint:connection.endpoint,connectionId:connection.id}});
  const legacy=p.createResource({spaceId:p.legacySpaceId,type:'workspace',name:'Legacy',metadata:{sourceFolder:'legacy',repositoryId:repository.id}});
  const catalog=p.isolatedWorkspaces,project=catalog.create({name:'Tere',metadata:{repositoryId:repository.id}}),second=catalog.create({name:'Website',metadata:{sourceFolder:'website'}});
  const group=p.createResource({spaceId:space.id,type:'workspace',name:'Personal-Code',metadata:{isolatedWorkspaceIds:[project.id,second.id]}}),other=p.createResource({spaceId:planning.id,type:'workspace',name:'Code',metadata:{isolatedWorkspaceIds:[project.id]}});
  const target=group.id+':'+project.id,git=target+':git';
  const grant=(mode='auto')=>p.putAccess(agentId,{revision:p.revision,spaceIds:[space.id,planning.id],grants:['workspace.read','sandbox.exec'].map(action=>({spaceId:space.id,resourceId:group.id,action,mode}))});
  p.configureExecution(true);grant();
  const job=createJob(store.state,{agentId,spaceId:space.id,prompt:'Inspect code'}),context=p.context(job);
  expect(p.visible(agentId,space.id).resources.map(row=>row.id)).toEqual([target,git,group.id+':'+second.id]);
  expect(p.visible(agentId,planning.id).resources).toEqual([]);
  expect(p.resource(target).metadata).toEqual({sourceFolder:'isolated/'+project.id,repositoryId:git});expect(p.resource(target).spaceId).toBe(space.id);
  expect(()=>p.authorize(job,'sandbox.exec',other.id+':'+project.id)).toThrow();expect(()=>p.authorize(job,'repository.read',repository.id)).toThrow();
  expect(store.connectors.credential(git,context,'repository.read')).toBe('synthetic-catalog-secret');
  expect(()=>store.connectors.credential(git,context,'repository.branch.push')).toThrow();
  expect(()=>store.connectors.withCredential(connection.id,context,()=>{})).toThrow('outside');
  for(const action of ['repository.branch.push','repository.merge'])expect(p.simulate({agentId,spaceId:space.id,resourceId:git,action}).mode).toBe('deny');
  expect(()=>p.resource(group.id+':missing')).toThrow();expect(()=>catalog.delete(project.id)).toThrow('Unlink');expect(()=>p.deleteResource(repository.id)).toThrow('catalog');
  job.status='completed';const file=p.createResource({spaceId:space.id,type:'file',name:'Report',metadata:{path:'report.md',workspaceId:target}});expect(file.metadata.workspaceId).toBe(target);expect(()=>p.deleteResource(group.id)).toThrow('unlink');p.deleteResource(file.id);p.updateResource(group.id,{metadata:{isolatedWorkspaceIds:[second.id,project.id]}});expect(p.simulate({agentId,spaceId:space.id,resourceId:target,action:'workspace.read'}).mode).toBe('deny');grant();
  for(const ids of [[],[project.id,project.id],['missing'],Array(21).fill(project.id)])expect(()=>p.createResource({spaceId:space.id,type:'workspace',name:'Bad',metadata:{isolatedWorkspaceIds:ids}})).toThrow();
  expect(()=>p.createResource({spaceId:space.id,type:'workspace',name:'Bad',metadata:{sourceFolder:'x',isolatedWorkspaceIds:[project.id]}})).toThrow();
  catalog.update(project.id,{name:'Renamed',metadata:project.metadata});expect(p.simulate({agentId,spaceId:space.id,resourceId:target,action:'sandbox.exec'}).mode).toBe('auto');
  grant('ask');expect(p.simulate({agentId,spaceId:space.id,resourceId:git,action:'repository.read'}).mode).toBe('ask');expect(()=>store.connectors.credential(git,context,'repository.read')).toThrow();grant();
  job.status='running';expect(()=>catalog.update(project.id,{name:'Tere',metadata:{sourceFolder:'changed',repositoryId:repository.id}})).toThrow('Stop tasks');
  expect(()=>store.connectors.update(connection.id,{name:'Git',endpoint:connection.endpoint,credential:'replacement-secret'})).toThrow('Stop tasks');job.status='completed';
  store.state.executionHeads={[target]:'a'.repeat(64)};expect(()=>catalog.update(project.id,{name:'Tere',metadata:{sourceFolder:'changed',repositoryId:repository.id}})).toThrow('checkpoints');
  store.connectors.update(connection.id,{name:'Git',endpoint:connection.endpoint,credential:'replacement-secret'});expect(p.simulate({agentId,spaceId:space.id,resourceId:git,action:'repository.read'}).mode).toBe('deny');grant();
  store.connectors.disable(connection.id);expect(()=>store.connectors.credential(git,context,'repository.read')).toThrow();
  for(const metadata of [42,'source',null,[]])expect(()=>catalog.create({name:'Invalid',metadata})).toThrow();
  expect(p.resource(legacy.id).metadata).toEqual(legacy.metadata);
  store.save();store.close();store=openStore(directory);expect(store.security.isolatedWorkspaces.get(project.id).name).toBe('Renamed');expect(store.security.resource(legacy.id)).toEqual(legacy);expect(store.state.executionHeads[target]).toBe('a'.repeat(64));
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('owner catalog API creates sources, imports safely, and denies task-token management',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-catalog-api-')),sourceRoot=join(directory,'sources'),codex=Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}}),origin='https://odwyn.test',password='test-password-long-enough';
 const app=createApp({directory,user:'owner',password,origin,providerOptions:{codex},browser:{close:async()=>{}},execution:{snapshotRoot:sourceRoot}}),headers={authorization:'Basic '+Buffer.from('owner:'+password).toString('base64'),origin,'content-type':'application/json'};
 const request=(path,method='GET',body)=>app.fetch(new Request(origin+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})}));
 try{
  expect((await request('/api/isolated-workspaces','POST',{name:'Bad',metadata:{sourceFolder:'../escape'}})).status).toBe(400);
  const response=await request('/api/isolated-workspaces','POST',{name:'Project',metadata:{}});expect(response.status).toBe(201);const project=await response.json();expect(project.workspaceSource.path).toBe(join(sourceRoot,'isolated',project.id));expect(existsSync(project.workspaceSource.path)).toBe(true);
  const form=new FormData();form.append('files',new File(['console.log("source")'],'app.js'));const imported=await app.fetch(new Request(origin+'/api/isolated-workspaces/'+project.id+'/source',{method:'POST',headers:{authorization:headers.authorization,origin},body:form}));expect(imported.status).toBe(201);expect(readFileSync(join(project.workspaceSource.path,'app.js'),'utf8')).toContain('source');
  const p=app.runtime.store.security,group=p.createResource({spaceId:p.legacySpaceId,name:'Code',type:'workspace',metadata:{isolatedWorkspaceIds:[project.id]}});
  const targets=await (await request('/api/resources?targets=true')).json();expect(targets.find(row=>row.id===group.id+':'+project.id)?.type).toBe('workspace');
  expect((await request('/api/isolated-workspaces/'+project.id,'DELETE')).status).toBe(400);expect((await request('/api/resources/'+group.id+'/source','POST',{serverFolder:'/missing'})).status).toBe(400);
  const job=createJob(app.runtime.state,{prompt:'Inspect'}),token=app.runtime.store.data.issueToken(job);
  expect((await app.fetch(new Request(origin+'/api/isolated-workspaces',{headers:{authorization:'Bearer '+token}}))).status).toBe(403);
  const sandbox=new Sandbox(p,{snapshotRoot:sourceRoot});expect(await sandbox.snapshotResolver(p.resource(group.id+':'+project.id),p.context(job))).toBe(project.workspaceSource.path);
  job.status='completed';p.deleteResource(group.id);expect((await request('/api/isolated-workspaces/'+project.id,'DELETE')).status).toBe(200);expect(existsSync(project.workspaceSource.path)).toBe(true);
 }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});

test('catalog Git targets checkout real Git objects with scoped credentials and persist separate checkpoints',async()=>{
 const {mkdirSync,writeFileSync}=await import('node:fs'),{GitGateway}=await import('../security/git-gateway.js');
 const directory=mkdtempSync(join(tmpdir(),'odwyn-catalog-git-')),store=openStore(join(directory,'data')),p=store.security;
 const git=(cwd,args,input)=>{const result=Bun.spawnSync(['git',...args],{cwd,stdin:input,env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});if(result.exitCode)throw Error(result.stderr.toString());return result.stdout;};
 const pkt=text=>Buffer.from((Buffer.byteLength(text)+4).toString(16).padStart(4,'0')+text);
 try{
  const remote=join(directory,'remote'),work=join(directory,'worker');mkdirSync(remote);mkdirSync(work);git(remote,['init','-b','main']);writeFileSync(join(remote,'app.js'),'export const value=42;');git(remote,['add','.']);git(remote,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Base']);const commit=git(remote,['rev-parse','HEAD']).toString().trim();
  const connection=store.connectors.create({spaceId:p.legacySpaceId,type:'git-https-v1',name:'Git',endpoint:'https://github.com/example/test.git',credential:'synthetic-git-credential'}),entry=p.isolatedWorkspaces.create({name:'Project',metadata:{repository:{endpoint:connection.endpoint,connectionId:connection.id}}}),space=p.createSpace({name:'Grooming'}),group=p.createResource({spaceId:space.id,type:'workspace',name:'Code',metadata:{isolatedWorkspaceIds:[entry.id]}}),agentId=store.state.agents[0].id;
  p.configureExecution(true);const grant=(mode='auto')=>p.putAccess(agentId,{revision:p.revision,spaceIds:[space.id],grants:['workspace.read','sandbox.exec','repository.read','repository.branch.push'].map(action=>({spaceId:space.id,resourceId:group.id,action,mode:action==='repository.branch.push'?mode:'auto',...(action==='repository.branch.push'?{constraints:{branchPrefixes:['feature/'],forbiddenRefs:['feature/blocked']}}:{})}))});grant();const job=createJob(store.state,{agentId,spaceId:space.id,prompt:'Checkout'});job.status='running';
  const workspaceId=group.id+':'+entry.id,resourceId=workspaceId+':git',sandbox=new Sandbox(p,{checkpointRoot:join(directory,'checkpoints')}),worker={id:'fixture',resourceId:workspaceId,context:p.context(job),base:null,checkpointId:null,ready:Promise.resolve()};sandbox.workers.set(job.id,worker);
  // Run fixed Git/collector commands against disposable directories; this does not claim Docker isolation proof.
  sandbox.inside=async(worker,args,options)=>sandbox.process(args.map(value=>value.replaceAll('/workspace',work).replaceAll('/tmp/odwyn-git-',directory+'/stage-')),options);
  const gateway=new GitGateway(p,sandbox,{resolver:async raw=>({url:new URL(raw)}),readCredentialResolver:(id,context)=>store.connectors.credential(id,context,'repository.read'),credentialResolver:(id,context)=>store.connectors.credential(id,context,'repository.branch.push')});let calls=0;
  gateway.request=async(target,path,method,body,token)=>{expect(token).toBe('synthetic-git-credential');calls++;if(path.includes('git-receive-pack')){if(method==='GET')return Buffer.concat([...git(remote,['for-each-ref','--format=%(objectname) %(refname)','refs/heads']).toString().trim().split('\n').map((line,index)=>pkt(line+(index===0?'\0report-status':'')+'\n')),Buffer.from('0000')]);const size=parseInt(body.subarray(0,4).toString(),16),[,next,rawRef]=body.subarray(4,size).toString().split(' '),ref=rawRef.split('\0')[0];git(remote,['index-pack','--stdin','--strict'],body.subarray(size+4));git(remote,['update-ref',ref,next]);return Buffer.concat([pkt('unpack ok\n'),pkt('ok '+ref+'\n'),Buffer.from('0000')]);}return method==='GET'?Buffer.concat([pkt(commit+' refs/heads/main\n'),Buffer.from('0000')]):Buffer.concat([Buffer.from('0008NAK\n'),git(remote,['pack-objects','--stdout','--revs'],Buffer.from(commit+'\n'))]);};
  const result=await gateway.sync(job,{resourceId,workspaceId,branch:'main',operation:'checkout'},new AbortController().signal);expect(result.commit).toBe(commit);expect(readFileSync(join(work,'app.js'),'utf8')).toContain('42');expect(calls).toBe(2);
  const saved=await sandbox.checkpoint(job,workspaceId);expect(saved.resourceId).toBe(workspaceId);expect(saved.files.some(file=>file.path==='.git/HEAD')).toBe(true);expect(JSON.stringify(saved)).not.toContain('synthetic-git-credential');
  git(work,['checkout','-b','feature/fix']);writeFileSync(join(work,'app.js'),'export const value=43;');git(work,['add','.']);git(work,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Fix']);
  const push={resourceId,ref:'refs/heads/feature/fix'};for(const ref of ['refs/heads/main','refs/heads/unlisted/fix','refs/heads/feature/blocked'])await expect(gateway.push(job,{resourceId,ref},new AbortController().signal)).rejects.toThrow();expect(calls).toBe(2);
  const pushed=await gateway.push(job,push,new AbortController().signal);expect(pushed.receiptVerified).toBe(true);expect(git(remote,['rev-parse',push.ref]).toString().trim()).toBe(pushed.commit);expect(calls).toBe(4);
  const request=gateway.request;gateway.request=async(...args)=>{const result=await request(...args);if(args[2]==='GET')p.putAccess(agentId,{revision:p.revision,spaceIds:[space.id],grants:p.access(agentId).grants.map(({spaceId,resourceId,action,mode,constraints})=>({spaceId,resourceId,action,mode,constraints:action==='repository.branch.push'?{branchPrefixes:['feature/other/']}:constraints}))});return result;};await expect(gateway.push(job,push,new AbortController().signal)).rejects.toThrow('owner constraints');expect(calls).toBe(5);gateway.request=request;
  grant('ask');await expect(gateway.push(job,push,new AbortController().signal)).rejects.toThrow('approval');expect(calls).toBe(5);const parameters={tool:'odwyn_repository_push',arguments:push},approval=store.approvals.prepare(job,'repository.branch.push',resourceId,parameters);store.approvals.decision(approval.id,'approve',store.approvals.reauth(approval.id));
  await expect(store.approvals.execute(job,'repository.branch.push',resourceId,{...parameters,arguments:{...push,ref:'refs/heads/feature/other'}},approval.id,()=>gateway.push(job,push,new AbortController().signal))).rejects.toThrow('digest');
  const approved=await store.approvals.execute(job,'repository.branch.push',resourceId,parameters,approval.id,()=>gateway.push(job,push,new AbortController().signal));expect(approved.receiptVerified).toBe(true);expect(calls).toBe(7);await expect(store.approvals.execute(job,'repository.branch.push',resourceId,parameters,approval.id,()=>gateway.push(job,push,new AbortController().signal))).rejects.toThrow();expect(calls).toBe(7);
  const other=p.createResource({spaceId:space.id,type:'workspace',name:'Office-Code',metadata:{isolatedWorkspaceIds:[entry.id]}});await expect(sandbox.loadCheckpoint(job,other.id+':'+entry.id,saved.id)).rejects.toThrow();
  job.status='completed';store.connectors.disable(connection.id);await expect(gateway.sync(job,{resourceId,workspaceId,branch:'main',operation:'pull'},new AbortController().signal)).rejects.toThrow();expect(calls).toBe(7);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('inline Git permissions are independent, revocable across Spaces, and reject invalid configuration',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-inline-git-')),store=openStore(directory),p=store.security,catalog=p.isolatedWorkspaces,agentId=store.state.agents[0].id;
 try{
  const space=p.createSpace({name:'Testing'}),otherSpace=p.createSpace({name:'Planning'}),connection=store.connectors.create({spaceId:p.legacySpaceId,type:'git-https-v1',name:'Git',endpoint:'https://github.com/example/tere.git',credential:'synthetic-inline-secret'}),repository={endpoint:connection.endpoint,connectionId:connection.id,gitUsername:'fixture-user'},entry=catalog.create({name:'Tere',metadata:{repository}}),source=catalog.create({name:'Files',metadata:{}});
  const group=p.createResource({spaceId:space.id,type:'workspace',name:'Code',metadata:{isolatedWorkspaceIds:[entry.id]}}),other=p.createResource({spaceId:otherSpace.id,type:'workspace',name:'Code',metadata:{isolatedWorkspaceIds:[entry.id]}}),git=group.id+':'+entry.id+':git';
  p.configureExecution(true);const set=(read,execute='deny',push='deny',extra=[])=>p.putAccess(agentId,{revision:p.revision,spaceIds:[space.id,otherSpace.id],grants:[{spaceId:space.id,resourceId:group.id,action:'workspace.read',mode:'auto'},...Object.entries({'repository.read':read,'sandbox.exec':execute,'repository.branch.push':push}).map(([action,mode])=>({spaceId:space.id,resourceId:group.id,action,mode})),...extra]});
  set('deny','auto');const decide=(action,resourceId=git)=>p.simulate({agentId,spaceId:space.id,resourceId,action}).mode;expect(decide('repository.read')).toBe('deny');expect(decide('repository.branch.push')).toBe('deny');expect(decide('workspace.read',group.id+':'+entry.id)).toBe('auto');
  set('auto');expect(decide('repository.read')).toBe('auto');expect(decide('sandbox.exec',group.id+':'+entry.id)).toBe('deny');expect(decide('repository.read',other.id+':'+entry.id+':git')).toBe('deny');
  set('auto','auto','auto');expect(decide('repository.branch.push')).toBe('auto');expect(p.preview(agentId,{revision:p.revision,spaceIds:[space.id,otherSpace.id],grants:[{spaceId:space.id,resourceId:group.id,action:'repository.branch.push',mode:'auto',constraints:{branchPrefixes:['feature/']}}]}).decisions.some(row=>row.resourceId===group.id&&row.action==='repository.branch.push'&&row.mode==='auto')).toBe(true);
  const job=createJob(store.state,{agentId,spaceId:space.id,prompt:'Inspect'});job.status='running';expect(()=>store.connectors.update(connection.id,{name:'Git',endpoint:connection.endpoint,credential:'changed-inline-secret'})).toThrow('Stop tasks');expect(()=>store.connectors.remove(connection.id)).toThrow('unlink');
  const {GitGateway}=await import('../security/git-gateway.js'),gateway=new GitGateway(p,{existing:()=>({resourceId:'another-project'})});await expect(gateway.push(job,{resourceId:git,ref:'refs/heads/feature/fix'},new AbortController().signal)).rejects.toThrow('active project');
  expect(store.connectors.credential(git,p.context(job),'repository.branch.push')).toBe('synthetic-inline-secret');expect(p.constraints(job,'repository.branch.push',git).branchPrefixes).toEqual([]);expect(decide('repository.merge')).toBe('deny');
  job.status='completed';store.connectors.update(connection.id,{name:'Git',endpoint:'https://github.com/example/renamed.git',credential:'changed-inline-secret'});expect(catalog.get(entry.id).metadata.repository.endpoint).toContain('renamed.git');expect(decide('repository.read')).toBe('deny');expect(decide('repository.branch.push')).toBe('deny');
  for(const gitConfig of [{endpoint:'http://github.com/example/a.git'},{endpoint:'https://user:secret@github.com/a.git'},{endpoint:'https://github.com/a.git?token=x'},{endpoint:'https://github.com/a.git',credential:'not-accepted'},{...repository,endpoint:'https://github.com/mismatch.git'},{endpoint:'https://github.com/a.git',gitUsername:'bad:name'}])expect(()=>catalog.create({name:'Invalid',metadata:{repository:gitConfig}})).toThrow();
  expect(()=>catalog.create({name:'Invalid',metadata:{repository:catalog.get(entry.id).metadata.repository,repositoryId:'missing'}})).toThrow();
  set('auto','auto','auto');p.updateResource(group.id,{metadata:{isolatedWorkspaceIds:[source.id]}});const access=p.access(agentId);expect(()=>p.putAccess(agentId,{revision:p.revision,spaceIds:access.spaceIds,grants:access.grants.map(({spaceId,resourceId,action,mode,constraints})=>({spaceId,resourceId,action,mode,constraints}))})).not.toThrow();
  expect(decide('repository.read')).toBe('deny');expect(()=>p.putAccess(agentId,{revision:p.revision,spaceIds:[space.id],grants:[{spaceId:space.id,resourceId:group.id,action:'repository.branch.push',mode:'auto'}]})).toThrow('mismatch');
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('connecting Git preserves source-only checkpoints and equivalent legacy links; explicit read denies override compatibility',()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-inline-compat-')),store=openStore(directory),p=store.security,catalog=p.isolatedWorkspaces,spaceId=p.legacySpaceId,agentId=store.state.agents[0].id;
 try{
  const repository={endpoint:'https://github.com/example/tere.git'},source=catalog.create({name:'Source',metadata:{}}),group=p.createResource({spaceId,type:'workspace',name:'Code',metadata:{isolatedWorkspaceIds:[source.id]}}),target=group.id+':'+source.id;
  store.state.executionHeads={[target]:'a'.repeat(64)};p.putAccess(agentId,{revision:p.revision,spaceIds:[spaceId],confirmWildcard:true,grants:['workspace.read','repository.read','repository.branch.push'].map(action=>({spaceId,resourceId:'*',action,mode:'auto'}))});
  catalog.update(source.id,{name:'Source',metadata:{repository}});expect(store.state.executionHeads[target]).toBe('a'.repeat(64));for(const action of ['workspace.read','repository.read','repository.branch.push'])expect(p.access(agentId).grants.find(grant=>grant.resourceId===group.id&&grant.action===action)?.mode).toBe('deny');expect(()=>catalog.update(source.id,{name:'Source',metadata:{repository:{endpoint:'https://github.com/example/other.git'}}})).toThrow('checkpoints');
  const direct=p.createResource({spaceId,type:'workspace',name:'Direct source'});p.updateResource(direct.id,{metadata:{isolatedWorkspaceIds:[source.id]}});expect(p.access(agentId).grants.find(grant=>grant.resourceId===direct.id&&grant.action==='repository.read')?.mode).toBe('deny');
  const repo=p.createResource({spaceId,type:'repository',name:'Legacy repo',metadata:repository}),entry=catalog.create({name:'Legacy',metadata:{repositoryId:repo.id}}),legacy=p.createResource({spaceId,type:'workspace',name:'Legacy Code',metadata:{isolatedWorkspaceIds:[entry.id]}}),git=legacy.id+':'+entry.id+':git';
  const set=expiresAt=>p.putAccess(agentId,{revision:p.revision,spaceIds:[spaceId],grants:[{spaceId,resourceId:legacy.id,action:'workspace.read',mode:'auto'},...(expiresAt?[{spaceId,resourceId:legacy.id,action:'repository.read',mode:'deny',expiresAt}]:[])]});const read=()=>p.simulate({agentId,spaceId,resourceId:git,action:'repository.read'}).mode;
  set();expect(read()).toBe('auto');set(new Date(Date.now()-11*3600000).toISOString().replace('Z','-12:00'));expect(read()).toBe('deny');set(new Date(Date.now()+13*3600000).toISOString().replace('Z','+14:00'));expect(read()).toBe('auto');
  store.state.executionHeads[legacy.id+':'+entry.id]='b'.repeat(64);catalog.update(entry.id,{name:'Legacy',metadata:{repository}});expect(store.state.executionHeads[legacy.id+':'+entry.id]).toBe('b'.repeat(64));expect(read()).toBe('deny');
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
