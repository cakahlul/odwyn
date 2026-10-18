import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openStore,createJob,createRoom} from '../store.js';
import {Sandbox} from '../execution/sandbox.js';
import {GitGateway} from '../security/git-gateway.js';
import {createBranch,mergeWork,reviewMerge} from '../execution/branch-work.js';
import {saveTaskCheckpoint,runRecordedTest,defineRoomCase} from '../execution/work.js';
import {validateBranchPolicy} from '../security/git-work.js';

function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'odwyn-reviewed-git-')),store=openStore(join(directory,'data')),p=store.security,lead=store.state.agents[0].id,engineer=randomUUID(),qa=randomUUID();store.state.agents.push({id:engineer},{id:qa});
 const native=(cwd,args,input,fail=true)=>{const result=Bun.spawnSync(['/usr/bin/git',...args],{cwd,stdin:input,env:{PATH:process.env.PATH,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});if(fail&&result.exitCode)throw Error(result.stderr.toString());return result;};
 const remote=join(directory,'remote');mkdirSync(remote);const git=(args,input)=>native(remote,args,input).stdout.toString().trim();git(['init','-b','main']);git(['config','receive.denyCurrentBranch','ignore']);writeFileSync(join(remote,'app.js'),'console.log("base");\n');git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Base']);const base=git(['rev-parse','HEAD']);
 const rule={baseBranch:'main',featurePrefix:'feature/',taskPrefix:'task/',integrationBranch:'development',reviewerIds:[lead],qaAgentIds:[qa]},entry=p.isolatedWorkspaces.create({name:'Product',metadata:{repository:{endpoint:'https://git.example/product.git',branchPolicy:rule}}}),group=p.createResource({spaceId:p.legacySpaceId,type:'workspace',name:'Code',metadata:{isolatedWorkspaceIds:[entry.id]}}),workspaceId=group.id+':'+entry.id,resourceId=workspaceId+':git';p.configureExecution(true);
 const grants=agentId=>['workspace.read','sandbox.exec','repository.read',...(agentId===engineer?['repository.branch.create','repository.branch.push','repository.merge']:[]),...(agentId===lead?['repository.review']:[])].map(action=>({spaceId:p.legacySpaceId,resourceId:group.id,action,mode:'auto',constraints:action==='repository.branch.create'?{kinds:['feature','task','integration']}:action==='repository.merge'?{transitions:['task-feature','feature-integration']}:action==='repository.branch.push'?{branchPrefixes:['task/']}:{} }));
 for(const agentId of [lead,engineer,qa])p.putAccess(agentId,{revision:p.revision,spaceIds:[p.legacySpaceId],grants:grants(agentId)});
 const room=createRoom(store.state,{title:'Build',spaceId:p.legacySpaceId,memberIds:[lead,engineer,qa],governance:{reviewerIds:[lead],observerIds:[]}});room.discussion={id:randomUUID(),status:'active',memberIds:room.memberIds};
 const job=agentId=>{const value=createJob(store.state,{agentId,conversationId:room.id,spaceId:room.spaceId,prompt:'Branch workflow'},false);value.roomRoundId=room.discussion.id;value.status='running';return value;};
 const sandbox=new Sandbox(p,{image:'sha256:'+'a'.repeat(64),snapshotRoot:directory,checkpointRoot:join(directory,'checkpoints')});
 // Disposable native Git processes exercise actual wire protocol and immutable snapshots, not container isolation.
 sandbox.create=async worker=>mkdirSync(join(directory,worker.id),{recursive:true});
 sandbox.inside=(worker,args,options)=>sandbox.process((args[0]==='bun'?['bun','--no-env-file',...args.slice(1)]:args[0]==='git'?['/usr/bin/git',...args.slice(1)]:args).map(arg=>arg.replaceAll('/workspace',join(directory,worker.id)).replaceAll('/tmp/odwyn-git-',directory+'/stage-')),options);
 sandbox.stop=async taskId=>{const worker=sandbox.workers.get(taskId);if(worker){sandbox.workers.delete(taskId);rmSync(join(directory,worker.id),{recursive:true,force:true});}};
 const gateway=new GitGateway(p,sandbox,{resolver:async raw=>({url:new URL(raw)})});
 gateway.request=async(target,path,method,body)=>{if(method==='GET')return native(remote,['receive-pack','--stateless-rpc','--advertise-refs','.']).stdout;return native(remote,['receive-pack','--stateless-rpc','.'],body).stdout;};
 const runtime={state:store.state,store,sandbox,gitGateway:gateway,executions:new Set(),changed(){},conversation(){return room;}};
 const seed=async(task,branch='main')=>{const worker={id:randomUUID(),resourceId:workspaceId,context:p.context(task),base:git(['rev-parse','refs/heads/'+branch]),checkpointId:null,ready:Promise.resolve()};mkdirSync(join(directory,worker.id));native(directory,['clone','--no-hardlinks',remote,join(directory,worker.id)]);native(join(directory,worker.id),['checkout',branch]);sandbox.workers.set(task.id,worker);task.workspacePin={resourceId:workspaceId,headId:null};return worker;};
 const command=(task,args,input)=>native(join(directory,sandbox.existing(task).id),args,input).stdout.toString().trim();
 const activate=async(task,id)=>{await sandbox.stop(task.id);task.workspaceDirty=false;task.workspacePin={resourceId:workspaceId,headId:id};await sandbox.restore(task,workspaceId,id);};
 return {directory,store,p,lead,engineer,qa,rule,group,entry,workspaceId,resourceId,room,job,seed,command,git,native,remote,runtime,sandbox,gateway,base,activate,async close(){await sandbox.close();store.close();rmSync(directory,{recursive:true,force:true});}};
}
const signal=()=>new AbortController().signal;

test('real Git: registered branches, candidate tests, exact Lead review, atomic task and QA integration promotion, UAT',async()=>{
 const f=fixture();try{
  const task=f.job(f.engineer);await f.seed(task);
  const feature=await createBranch(f.runtime,task,{resourceId:f.resourceId,kind:'feature',feature:'checkout',baseCommit:f.base},signal());expect(feature.branch).toBe('feature/checkout');
  const branch=await createBranch(f.runtime,task,{resourceId:f.resourceId,kind:'task',feature:'checkout',task:'api',baseCommit:f.base},signal());expect(branch.branch).toBe('task/checkout/'+f.engineer+'/api');
  const worker=f.sandbox.existing(task);writeFileSync(join(f.directory,worker.id,'app.js'),'console.log("feature");\n');f.command(task,['add','.']);f.command(task,['-c','user.name=Engineer','-c','user.email=engineer@example.invalid','commit','-m','Implementation']);
  const source=f.command(task,['rev-parse','HEAD']);await f.gateway.push(task,{resourceId:f.resourceId,ref:'refs/heads/'+branch.branch},signal());expect(f.git(['rev-parse',branch.branch])).toBe(source);
  await expect(f.gateway.push(task,{resourceId:f.resourceId,ref:'refs/heads/'+feature.branch},signal())).rejects.toThrow('registered');
  task.workspaceDirty=true;await saveTaskCheckpoint(f.runtime,task,{resourceId:f.workspaceId});
  const request=await mergeWork(f.runtime,task,{resourceId:f.resourceId,action:'prepare',source:branch.branch,target:feature.branch},signal());expect(request.sourceCommit).toBe(source);expect(request.diff).toContain('feature');
  await expect(mergeWork(f.runtime,task,{resourceId:f.resourceId,action:'execute',requestId:request.id},signal())).rejects.toThrow('recorded tests');
  const testInput={resourceId:f.workspaceId,checkpointId:request.checkpointId,command:'bun app.js',reason:'Test actual candidate'};
  const evidence=await runRecordedTest(f.runtime,task,testInput);expect(evidence.gitCommit).toBe(request.commit);expect(evidence.status).toBe('passed');
  const reviewer=f.job(f.lead);reviewMerge(f.runtime,reviewer,{resourceId:f.resourceId,requestId:request.id,decision:'approve',summary:'Inspected candidate diff and passing test.'});
  const failed=await runRecordedTest(f.runtime,task,{...testInput,command:'echo changed > app.js; false'});expect(failed.status).toBe('failed');expect(failed.gitCommit).toBeUndefined();await f.activate(task,request.checkpointId);
  await expect(mergeWork(f.runtime,task,{resourceId:f.resourceId,action:'execute',requestId:request.id},signal())).rejects.toThrow('Latest candidate');
  // A new test invalidates the earlier approval, even at the same commit.
  await runRecordedTest(f.runtime,task,testInput);await f.activate(task,request.checkpointId);
  await expect(mergeWork(f.runtime,task,{resourceId:f.resourceId,action:'execute',requestId:request.id},signal())).rejects.toThrow('Every designated');
  reviewMerge(f.runtime,reviewer,{resourceId:f.resourceId,requestId:request.id,decision:'approve',summary:'Reviewed updated evidence.'});
  const merged=await mergeWork(f.runtime,task,{resourceId:f.resourceId,action:'execute',requestId:request.id},signal());expect(merged.receiptVerified).toBe(true);expect(f.git(['rev-parse',feature.branch])).toBe(request.commit);expect(f.git(['rev-parse',branch.branch])).toBe(source);
  await expect(mergeWork(f.runtime,task,{resourceId:f.resourceId,action:'execute',requestId:request.id},signal())).rejects.toThrow('consumed');
  // Initialize development from main using a separate clean task.
  const init=f.job(f.engineer);await f.seed(init);delete init.workspacePin;
  await f.sandbox.stop(init.id);init.workspacePin={resourceId:f.workspaceId,headId:request.checkpointId};await f.sandbox.restore(init,f.workspaceId,request.checkpointId);f.command(init,['checkout','main']);
  const integration=await createBranch(f.runtime,init,{resourceId:f.resourceId,kind:'integration',feature:'checkout',baseCommit:f.base},signal());expect(integration.branch).toBe('development');
  f.command(init,['checkout','--detach',request.commit]);init.workspaceDirty=true;await saveTaskCheckpoint(f.runtime,init,{resourceId:f.workspaceId});
  const promotion=await mergeWork(f.runtime,init,{resourceId:f.resourceId,action:'prepare',source:feature.branch,target:'development'},signal());
  const check=defineRoomCase(f.runtime,init,{title:'Feature acceptance'});
  await runRecordedTest(f.runtime,init,{resourceId:f.workspaceId,checkpointId:promotion.checkpointId,command:'bun app.js',reason:'Engineer check',caseId:check.id});
  expect(()=>reviewMerge(f.runtime,reviewer,{resourceId:f.resourceId,requestId:promotion.id,decision:'approve',summary:'Attempt without QA'})).toThrow('QA');
  const qaTask=f.job(f.qa);await f.activate(qaTask,promotion.checkpointId);
  const acceptance=await runRecordedTest(f.runtime,qaTask,{resourceId:f.workspaceId,checkpointId:promotion.checkpointId,command:'bun app.js',reason:'QA candidate acceptance',caseId:check.id});expect(acceptance.gitCommit).toBe(promotion.commit);
  reviewMerge(f.runtime,reviewer,{resourceId:f.resourceId,requestId:promotion.id,decision:'approve',summary:'Reviewed QA and integration diff.'});await f.activate(init,promotion.checkpointId);
  await mergeWork(f.runtime,init,{resourceId:f.resourceId,action:'execute',requestId:promotion.id},signal());expect(f.git(['rev-parse','development'])).toBe(promotion.commit);
  // Release uses development, with QA identity and commit attestation.
  f.command(init,['checkout','-B','development',promotion.commit]);init.workspaceDirty=true;const release=await saveTaskCheckpoint(f.runtime,init,{resourceId:f.workspaceId});
  await f.activate(qaTask,release.id);const uat=await runRecordedTest(f.runtime,qaTask,{resourceId:f.workspaceId,checkpointId:release.id,command:'bun app.js',reason:'UAT on development',purpose:'uat',caseId:check.id});expect(uat.status).toBe('passed');expect(uat.gitCommit).toBe(promotion.commit);expect(uat.gitBranch).toBe('development');
  const run=f.sandbox.run.bind(f.sandbox);f.sandbox.run=async(...args)=>{const result=await run(...args);f.git(['update-ref','refs/heads/development',f.base]);return result;};
  const staleUat=await runRecordedTest(f.runtime,qaTask,{resourceId:f.workspaceId,checkpointId:release.id,command:'bun app.js',reason:'UAT race',purpose:'uat'});expect(staleUat.status).toBe('failed');expect(staleUat.stderr).toContain('Integration branch changed');

 }finally{await f.close();}
},30000);

test('real Git atomic source guard rejects stale source without moving target; unsupported atomic fails closed',async()=>{
 const f=fixture();try{const task=f.job(f.engineer);await f.seed(task);f.git(['branch','feature/a']);f.git(['branch','development']);f.git(['-c','user.name=Fixture','-c','user.email=f@example.invalid','commit','--allow-empty','-m','Advanced']);const newer=f.git(['rev-parse','HEAD']);f.git(['update-ref','refs/heads/feature/a',newer]);
  const original=f.gateway.refs.bind(f.gateway);f.gateway.refs=async(...args)=>{const value=await original(...args);value.refs['refs/heads/feature/a']=f.base;return value;};
  await expect(f.gateway.atomic(task,f.resourceId,'repository.branch.create',{source:'feature/a',sourceCommit:f.base,target:'development',oldCommit:f.base,commit:f.base},signal(),()=>{})).rejects.toThrow('receipt');expect(f.git(['rev-parse','development'])).toBe(f.base);
  f.gateway.refs=async(...args)=>({...await original(...args),capabilities:['report-status']});await expect(f.gateway.atomic(task,f.resourceId,'repository.branch.create',{source:'feature/a',sourceCommit:newer,target:'development',oldCommit:f.base,commit:f.base},signal(),()=>{})).rejects.toThrow('atomic');
 }finally{await f.close();}
});

test('reserved namespaces block alias push bypass; metadata and actual tracked bytes cannot spoof Git attestation',async()=>{
 const f=fixture();try{const task=f.job(f.engineer);const worker=await f.seed(task);const alias=f.p.createResource({spaceId:f.room.spaceId,type:'repository',name:'Alias',metadata:{endpoint:'https://alternate.example/another-path'}});const current=f.p.access(f.engineer);f.p.putAccess(f.engineer,{revision:f.p.revision,spaceIds:current.spaceIds,grants:[...current.grants.map(({spaceId,resourceId,action,mode,constraints})=>({spaceId,resourceId,action,mode,constraints})),{spaceId:f.room.spaceId,resourceId:alias.id,action:'repository.branch.push',mode:'auto',constraints:{branchPrefixes:['feature/','development/']}}]});
  for(const ref of ['refs/heads/feature/a','refs/heads/development'])await expect(f.gateway.push(task,{resourceId:alias.id,ref},signal())).rejects.toThrow('reviewed merge');
  expect(await f.sandbox.gitClean(task)).toBe(true);writeFileSync(join(f.directory,worker.id,'hidden-runner.js'),'console.log("extra")');expect(await f.sandbox.gitClean(task)).toBe(false);rmSync(join(f.directory,worker.id,'hidden-runner.js'));
  expect(await f.sandbox.gitClean(task)).toBe(true);f.command(task,['update-index','--assume-unchanged','app.js']);writeFileSync(join(f.directory,worker.id,'app.js'),'spoofed\n');expect(await f.sandbox.gitClean(task)).toBe(false);
  mkdirSync(join(f.directory,worker.id,'.git/info'),{recursive:true});writeFileSync(join(f.directory,worker.id,'.git/info/grafts'),f.base+'\n');await expect(f.sandbox.git(task,['rev-parse','HEAD'],{})).rejects.toThrow('graph metadata');rmSync(join(f.directory,worker.id,'.git/info/grafts'));renameSync(join(f.directory,worker.id,'.git'),join(f.directory,worker.id,'.other-git'));writeFileSync(join(f.directory,worker.id,'.git'),'gitdir: .other-git\n');await expect(f.sandbox.git(task,['rev-parse','HEAD'],{})).rejects.toThrow('graph metadata');
 }finally{await f.close();}
});

test('branch policy validation rejects unsafe or overlapping branches and missing identities',()=>{
 const state={agents:[{id:'lead'},{id:'qa'}]},rule={baseBranch:'main',featurePrefix:'feature/',taskPrefix:'task/',integrationBranch:'development',reviewerIds:['lead'],qaAgentIds:['qa']};expect(validateBranchPolicy(rule,state)).toEqual(rule);
 for(const change of [{integrationBranch:'main'},{integrationBranch:'release/x'},{taskPrefix:'feature/task/'},{baseBranch:'../main'},{reviewerIds:[]},{qaAgentIds:['missing']},{other:true}])expect(()=>validateBranchPolicy({...rule,...change},state)).toThrow();
});

async function prepared(f){const task=f.job(f.engineer);await f.seed(task);await createBranch(f.runtime,task,{resourceId:f.resourceId,kind:'feature',feature:'race',baseCommit:f.base},signal());const branch=await createBranch(f.runtime,task,{resourceId:f.resourceId,kind:'task',feature:'race',task:'fix',baseCommit:f.base},signal());const request=await mergeWork(f.runtime,task,{resourceId:f.resourceId,action:'prepare',source:branch.branch,target:'feature/race'},signal());await runRecordedTest(f.runtime,task,{resourceId:f.workspaceId,checkpointId:request.checkpointId,command:'bun app.js',reason:'Candidate test'});const reviewer=f.job(f.lead);reviewMerge(f.runtime,reviewer,{resourceId:f.resourceId,requestId:request.id,decision:'approve',summary:'Inspected exact candidate and tests.'});await f.activate(task,request.checkpointId);return {task,request,reviewer};}

test('review revocation during asynchronous validation prevents merge; wrong room and policy revisions fail closed',async()=>{
 const f=fixture();try{const {task,request,reviewer}=await prepared(f),clean=f.sandbox.gitClean.bind(f.sandbox);let revoke=true;f.sandbox.gitClean=async(...args)=>{const result=await clean(...args);if(revoke){revoke=false;reviewMerge(f.runtime,reviewer,{resourceId:f.resourceId,requestId:request.id,decision:'changes_requested',summary:'Found correction during validation.'});}return result;};
  await expect(mergeWork(f.runtime,task,{resourceId:f.resourceId,action:'execute',requestId:request.id},signal())).rejects.toThrow('Every designated');expect(f.git(['rev-parse','feature/race'])).toBe(f.base);expect(f.p.gitWork.get(request.id).status).toBe('pending');
  expect(()=>reviewMerge(f.runtime,reviewer,{resourceId:f.resourceId,requestId:request.id,decision:'approve',summary:'Cannot reverse change request'})).toThrow('new candidate');
  await expect(mergeWork(f.runtime,{...task,roomRoundId:randomUUID()},{resourceId:f.resourceId,action:'inspect',requestId:request.id},signal())).rejects.toThrow();f.p.touch();await expect(mergeWork(f.runtime,task,{resourceId:f.resourceId,action:'inspect',requestId:request.id},signal())).rejects.toThrow('access policy');
 }finally{await f.close();}
});

test('ambiguous Git receipts consume the merge request without reporting verified success',async()=>{
 const f=fixture();try{const {task,request}=await prepared(f),transport=f.gateway.request;f.gateway.request=async(...args)=>{const result=await transport(...args);if(args[2]!=='POST')return result;const line='ng refs/heads/'+request.target+' contradictory\n';return Buffer.concat([result,Buffer.from((Buffer.byteLength(line)+4).toString(16).padStart(4,'0')+line)]);};
  await expect(mergeWork(f.runtime,task,{resourceId:f.resourceId,action:'execute',requestId:request.id},signal())).rejects.toThrow('receipt');expect(f.p.gitWork.get(request.id).status).toBe('indeterminate');await expect(mergeWork(f.runtime,task,{resourceId:f.resourceId,action:'execute',requestId:request.id},signal())).rejects.toThrow('consumed');
 }finally{await f.close();}
});

test('merge claims survive restart as indeterminate and preserve requests and branch registration',()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-merge-restart-'));let store=openStore(directory);try{
  const resource={isolatedWorkspaceId:'project',metadata:{endpoint:'https://example.test/repo.git'}},record={branch:'feature/test',agentId:store.state.agents[0].id,kind:'feature'};store.security.gitWork.recordBranch(resource,record);
  const request=store.security.gitWork.create({spaceId:store.security.legacySpaceId,resourceId:'resource',taskId:'task',commit:'a'.repeat(40),diff:'reviewed diff'});store.security.gitWork.claim(request.id);store.save();store.close();store=openStore(directory);
  expect(store.security.gitWork.get(request.id).status).toBe('indeterminate');expect(store.security.gitWork.branch(resource,'feature/test')).toEqual(record);expect(()=>store.security.gitWork.claim(request.id)).toThrow('consumed');
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
