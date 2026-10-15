import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Sandbox} from '../execution/sandbox.js';

const image='sha256:'+'a'.repeat(64);
const job={id:'task-a',spaceId:'space-a'};
function fixture(options={}){
  const root=mkdtempSync(join(tmpdir(),'odwyn-checkpoints-'));
  const policy={authorize(task,action,resourceId){if(task.denied)throw Error('Denied');return {spaceId:task.spaceId,taskId:task.id};},context(task){return {spaceId:task.spaceId};},resource(id){return {id};},auditIsolation(){}};
  const sandbox=new Sandbox(policy,{image,snapshotResolver:()=>'/unused',checkpointRoot:root,...options});
  sandbox.create=async()=>{};
  sandbox.payload=[{path:'index.js',data:Buffer.from('console.log(1)\n').toString('base64'),executable:false}];
  sandbox.inside=async(worker,argv,options)=>({exitCode:0,stdout:Buffer.from(argv[0]==='bun'&&!options?.input?JSON.stringify(sandbox.payload):''),stderr:Buffer.alloc(0)});
  sandbox.docker=async()=>({exitCode:0,stdout:Buffer.alloc(0)});
  const worker={id:'fake-worker',resourceId:'repo-a',context:{spaceId:'space-a',taskId:job.id},base:'b'.repeat(40),checkpointId:null};worker.ready=Promise.resolve();sandbox.workers.set(job.id,worker);
  return {sandbox,root,clean:()=>rmSync(root,{recursive:true,force:true})};
}

test('checkpoints survive worker removal and restore exact scoped immutable files',async()=>{
  const {sandbox,root,clean}=fixture();
  try{
    const checkpoint=await sandbox.checkpoint(job,'repo-a');
    expect(checkpoint.id).toMatch(/^[a-f0-9]{64}$/);expect(checkpoint.parentId).toBe(null);
    await sandbox.stop(job.id);
    const restored=await sandbox.restore({...job,id:'task-b'},'repo-a',checkpoint.id);
    expect(restored.checkpointId).toBe(checkpoint.id);expect(restored.base).toBe('b'.repeat(40));
    expect((await sandbox.loadCheckpoint(job,'repo-a',checkpoint.id)).files).toEqual(sandbox.payload);
    expect(readFileSync(join(root,checkpoint.id+'.json'),'utf8')).toContain('index.js');
    await expect(sandbox.restore({...job,id:'task-c',spaceId:'other'},'repo-a',checkpoint.id)).rejects.toThrow();
    await expect(sandbox.loadCheckpoint(job,'other',checkpoint.id)).rejects.toThrow();
    await expect(sandbox.restore({...job,id:'task-b'},'repo-a',checkpoint.id)).rejects.toThrow();
  }finally{clean();}
});

test('checkpoint parent conflicts and authorization failures preserve previous checkpoint',async()=>{
  const {sandbox,clean}=fixture();
  try{
    const first=await sandbox.checkpoint(job,'repo-a');
    await sandbox.stop(job.id);await sandbox.restore({...job,id:'task-b'},'repo-a',first.id);
    await expect(sandbox.checkpoint({...job,id:'task-b'},'repo-a')).rejects.toThrow('parent');
    const next=await sandbox.checkpoint({...job,id:'task-b'},'repo-a',{expectedParent:first.id});
    expect(next.parentId).toBe(first.id);
    await expect(sandbox.loadCheckpoint({...job,denied:true},'repo-a',first.id)).rejects.toThrow('Denied');
    expect((await sandbox.loadCheckpoint(job,'repo-a',first.id)).parentId).toBe(null);
  }finally{clean();}
});

test('untrusted checkpoint data cannot persist secrets, traversal, duplicates or malformed bytes',async()=>{
  const {sandbox,clean}=fixture();
  try{
    for(const path of ['../escape','/etc/passwd','a/../../escape','.env','nested/.env.local','.git/hooks/post-checkout','.ssh/id_rsa','key.pem','a\\b','a\n']){
      sandbox.payload=[{path,data:'eA==',executable:false}];
      await expect(sandbox.checkpoint(job,'repo-a')).rejects.toThrow();
    }
    sandbox.payload=[{path:'a',data:'invalid base64',executable:false}];await expect(sandbox.checkpoint(job,'repo-a')).rejects.toThrow();
    sandbox.payload=[{path:'a',data:'eA==',executable:false},{path:'a',data:'eA==',executable:false}];await expect(sandbox.checkpoint(job,'repo-a')).rejects.toThrow();
    sandbox.payload=[{path:'a',data:'eA==',executable:false},{path:'a/b',data:'eA==',executable:false}];await expect(sandbox.checkpoint(job,'repo-a')).rejects.toThrow();
    sandbox.payload=[{path:'a',data:'eA==',executable:false,symlink:true}];await expect(sandbox.checkpoint(job,'repo-a')).rejects.toThrow();
  }finally{clean();}
});

test('checkpoint integrity and no-follow reads reject substitutions',async()=>{
  const {sandbox,root,clean}=fixture();
  try{
    const checkpoint=await sandbox.checkpoint(job,'repo-a'),path=join(root,checkpoint.id+'.json');
    rmSync(path);symlinkSync('/etc/passwd',path);await expect(sandbox.loadCheckpoint(job,'repo-a',checkpoint.id)).rejects.toThrow();
    rmSync(path);writeFileSync(path,'{}');await expect(sandbox.loadCheckpoint(job,'repo-a',checkpoint.id)).rejects.toThrow();
    await expect(sandbox.loadCheckpoint(job,'repo-a','../escape')).rejects.toThrow();
  }finally{clean();}
});

test('trusted execution profiles reject out-of-bounds and unknown settings',()=>{
  for(const executionProfile of [{memory:0},{cpus:9},{workspace:2048},{temporary:0},{pids:5000},{timeoutMs:120001},{image:'untrusted'},{memory:128.5}]){
    const root=mkdtempSync(join(tmpdir(),'odwyn-profile-'));
    try{expect(()=>new Sandbox({}, {executionProfile,checkpointRoot:root})).toThrow();}finally{rmSync(root,{recursive:true,force:true});}
  }
});

test('collector and hydration round trip real bounded files without following links or copying credentials',async()=>{
  const {sandbox,root,clean}=fixture(),source=join(root,'source'),destination=join(root,'destination');
  const fs=await import('node:fs');
  try{
    fs.mkdirSync(source);fs.mkdirSync(destination);fs.mkdirSync(join(source,'nested'));fs.mkdirSync(join(source,'.git'));fs.mkdirSync(join(source,'.git','hooks'));
    writeFileSync(join(source,'nested','file.bin'),Buffer.from([0,1,255]));writeFileSync(join(source,'run.sh'),'#!/bin/sh\n');fs.chmodSync(join(source,'run.sh'),0o755);
    writeFileSync(join(source,'.env'),'private');writeFileSync(join(source,'.git','config'),'private');writeFileSync(join(source,'.git','hooks','pre-commit'),'private');
    let workspace=source;
    // Fixture runs only our fixed collector/hydrator code, replacing the unavailable Docker filesystem.
    sandbox.inside=async(worker,argv,options)=>sandbox.process([process.execPath,'-e',argv[2].replaceAll('/workspace',workspace)],options);
    const checkpoint=await sandbox.checkpoint(job,'repo-a');
    expect(checkpoint.files.map(file=>file.path)).toEqual(['nested/file.bin','run.sh']);
    expect(checkpoint.files.find(file=>file.path==='run.sh').executable).toBe(true);
    await sandbox.stop(job.id);workspace=destination;
    await sandbox.restore({...job,id:'task-b'},'repo-a',checkpoint.id);
    expect(readFileSync(join(destination,'nested','file.bin'))).toEqual(Buffer.from([0,1,255]));
    expect(readFileSync(join(destination,'run.sh'),'utf8')).toBe('#!/bin/sh\n');
    fs.symlinkSync('/etc/passwd',join(destination,'link'));
    await expect(sandbox.checkpoint({...job,id:'task-b'},'repo-a',{expectedParent:checkpoint.id})).rejects.toThrow();
    expect((await sandbox.loadCheckpoint(job,'repo-a',checkpoint.id)).files).toEqual(checkpoint.files);
  }finally{clean();}
});

test('owner broker checkpoint copy pins source scope and creates destination-bound bytes',async()=>{
  const {sandbox,clean}=fixture();
  try{
    const first=await sandbox.checkpoint(job,'repo-a');
    expect(()=>sandbox.copyCheckpoint(first.id,{sourceSpaceId:'wrong',sourceResourceId:'repo-a',destinationSpaceId:'space-b',destinationResourceId:'repo-b'})).toThrow();
    const next=sandbox.copyCheckpoint(first.id,{sourceSpaceId:'space-a',sourceResourceId:'repo-a',destinationSpaceId:'space-b',destinationResourceId:'repo-b'});
    expect(next.id).not.toBe(first.id);expect(next.parentId).toBe(null);
    expect((await sandbox.loadCheckpoint({...job,spaceId:'space-b'},'repo-b',next.id)).files).toEqual(first.files);
    await expect(sandbox.loadCheckpoint(job,'repo-a',next.id)).rejects.toThrow('scope');
  }finally{clean();}
});

test('configured profiles retain network and kernel isolation flags and enforce command ceilings',async()=>{
  const sandbox=new Sandbox({}, {image,executionProfile:{memory:512,pids:128,cpus:2,workspace:128,temporary:64,timeoutMs:1000}}),calls=[];
  sandbox.docker=async(args)=>{calls.push(args);return {exitCode:0,stdout:Buffer.from(JSON.stringify(args[0]==='info'?{os:'linux',cgroups:2,security:['rootless']}:{uid:1000,status:'Seccomp:\t2\nNoNewPrivs:\t1\nCapEff:\t00000000\n',memory:512*1024*1024,pids:128,cpu:'200000 100000'}))};};
  await sandbox.create({id:'fixture',context:{taskId:'task',spaceId:'space'}});
  const args=calls.find(args=>args[0]==='create');
  for(const [key,value] of [['--network','none'],['--user','1000:1000'],['--memory','512m'],['--memory-swap','512m'],['--cpus','2'],['--cap-drop','ALL'],['--security-opt','no-new-privileges']])expect(args[args.indexOf(key)+1]).toBe(value);
  expect(args).toContain('/workspace:rw,nosuid,nodev,size=128m,uid=1000,gid=1000,mode=0700');expect(args).not.toContain('--mount');
  await expect(sandbox.run(job,{command:'true',reason:'fixture',timeoutMs:1001},new AbortController().signal)).rejects.toThrow('execution time');
});

test('cancelled, failed, oversized and revoked exports never replace valid checkpoint bytes',async()=>{
  const {sandbox,clean}=fixture();
  try{
    const first=await sandbox.checkpoint(job,'repo-a'),inside=sandbox.inside;
    for(const failure of [{exitCode:1},{truncated:true},{cancelled:true},{timedOut:true}]){
      sandbox.inside=async()=>({exitCode:0,stdout:Buffer.from('[]'),...failure});
      await expect(sandbox.checkpoint(job,'repo-a')).rejects.toThrow('export');
    }
    sandbox.inside=inside;
    sandbox.payload=Array.from({length:4097},(_,i)=>({path:String(i),data:'',executable:false}));await expect(sandbox.checkpoint(job,'repo-a')).rejects.toThrow('bounds');
    sandbox.payload=[{path:'large',data:Buffer.alloc(16*1024*1024+1).toString('base64'),executable:false}];await expect(sandbox.checkpoint(job,'repo-a')).rejects.toThrow('bounds');
    const controller=new AbortController();controller.abort();await expect(sandbox.checkpoint(job,'repo-a',{signal:controller.signal})).rejects.toThrow();
    sandbox.inside=async()=>{job.denied=true;return {exitCode:0,stdout:Buffer.from('[]')};};
    await expect(sandbox.checkpoint(job,'repo-a')).rejects.toThrow('Denied');delete job.denied;
    expect((await sandbox.loadCheckpoint(job,'repo-a',first.id)).files[0].path).toBe('index.js');
  }finally{delete job.denied;clean();}
});

test('restore failure removes its worker and keeps source checkpoint',async()=>{
  const {sandbox,clean}=fixture();
  try{
    const first=await sandbox.checkpoint(job,'repo-a');await sandbox.stop(job.id);
    sandbox.inside=async()=>({exitCode:1,stdout:Buffer.alloc(0)});
    await expect(sandbox.restore({...job,id:'failed'},'repo-a',first.id)).rejects.toThrow('restore');
    expect(sandbox.workers.has('failed')).toBe(false);expect((await sandbox.loadCheckpoint(job,'repo-a',first.id)).id).toBe(first.id);
  }finally{clean();}
});

test('checkpoint bytes are checked against service-secret policy before durable publication',async()=>{
  const {sandbox,clean}=fixture({validateCheckpointBytes(bytes){if(bytes.includes(Buffer.from('known-service-secret')))throw Error('Service credential export denied.');}});
  try{
    sandbox.payload=[{path:'ordinary.txt',data:Buffer.from('known-service-secret').toString('base64'),executable:false}];
    await expect(sandbox.checkpoint(job,'repo-a')).rejects.toThrow('credential');
  }finally{clean();}
});

test('snapshot failures report safe actionable causes and remove the failed worker before any command runs',async()=>{
  const {sandbox,clean}=fixture();sandbox.workers.clear();let executed=0,removed=0;
  sandbox.create=async()=>{};sandbox.inside=async()=>{executed++;throw Error('Command must not run');};sandbox.docker=async()=>{removed++;return {exitCode:0};};
  try{
    for(const [stderr,flags,expected] of [
      ['FileNotFoundError: private-path',{},'missing'],['PermissionError: private-path',{},'cannot read'],['OSError: [Errno 40] private-path',{},'symbolic link'],
      ['ValueError: Snapshot exceeds 16 MiB',{},'16 MiB'],['ValueError: Snapshot entry count exceeds bounds',{},'4,096'],['ValueError: Snapshot nesting exceeds bounds',{},'32 nested'],
      ['ValueError: Unsupported snapshot file type',{},'special file'],['ValueError: Unsupported snapshot name',{},'control characters'],
      ['',{timedOut:true},'timed out'],['',{cancelled:true},'cancelled'],['',{truncated:true},'output exceeded'],['private-path',{},'copier failed'],
    ]){
      sandbox.process=async()=>({exitCode:1,stdout:Buffer.alloc(0),stderr:Buffer.from(stderr),...flags});
      let error;try{await sandbox.worker(job,'repo-a');}catch(value){error=value;}
      expect(error.message).toContain(expected);expect(error.message).toContain('resource repo-a');expect(error.message).not.toContain('private-path');expect(sandbox.workers.size).toBe(0);
    }
    expect(executed).toBe(0);expect(removed).toBe(12);
  }finally{clean();}
});
