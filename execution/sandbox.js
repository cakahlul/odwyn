import {workspaceSource} from './workspace-source.js';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, realpathSync, lstatSync, openSync, closeSync, fstatSync, readFileSync, writeFileSync, fsyncSync, constants } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { validateCommand } from '../terminal.js';

export const shellQuote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
export class Sandbox {
  constructor(policy,{image,snapshotRoot,snapshotResolver,checkpointRoot,executionProfile={},validateCheckpointBytes}={}){
    if(validateCheckpointBytes!==undefined&&typeof validateCheckpointBytes!=='function')throw new Error('Invalid checkpoint validator.');
    this.validateCheckpointBytes=validateCheckpointBytes;
    this.policy=policy;this.image=image;this.snapshotRoot=snapshotRoot;this.snapshotResolver=snapshotResolver||(snapshotRoot?((resource,context)=>workspaceSource(snapshotRoot,resource.metadata?.sourceFolder||`${context.spaceId}/${resource.id}`).path):null);
    this.configured=/^sha256:[a-f0-9]{64}$/.test(image||'')&&!!this.snapshotResolver;
    this.workers=new Map();this.removals=new Set();
    this.executionProfile=Object.freeze({memory:128,pids:64,cpus:1,workspace:32,temporary:16,timeoutMs:120000,...executionProfile});
    const bounds={memory:[64,4096],pids:[16,1024],cpus:[1,8],workspace:[16,1024],temporary:[8,1024],timeoutMs:[1,120000]};
    for(const [key,value] of Object.entries(this.executionProfile))if(!bounds[key]||!Number.isInteger(value)||value<bounds[key][0]||value>bounds[key][1])throw new Error('Execution profile exceeds server bounds.');
    if(checkpointRoot){mkdirSync(checkpointRoot,{recursive:true,mode:0o700});this.checkpointRoot=realpathSync(checkpointRoot);this.checkpointDirectory=lstatSync(this.checkpointRoot);this.checkpointDirectoryCheck();}

    this.env={PATH:process.env.PATH,DOCKER_HOST:process.env.DOCKER_HOST||(process.platform==='darwin'?`unix://${join(homedir(),'.docker/run/docker.sock')}`:'unix:///var/run/docker.sock')};
  }
  async process(argv,{input,signal,timeoutMs=15000,limit=32768,onStop}={}){
    signal?.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const child=spawn(argv[0],argv.slice(1),{env:this.env,stdio:['pipe','pipe','pipe'],detached:true});
      const stdout=[],stderr=[];let size=0,timedOut=false,cancelled=false,truncated=false;
      const kill=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}onStop?.();};
      const abort=()=>{cancelled=true;kill();};
      const timer=setTimeout(()=>{timedOut=true;kill();},timeoutMs);
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)abort();
      child.stdin.on('error',()=>{});child.stdin.end(input);
      for(const [stream,chunks] of [[child.stdout,stdout],[child.stderr,stderr]])stream.on('data',chunk=>{
        size+=chunk.length;if(size>limit){truncated=true;kill();}else chunks.push(chunk);
      });
      const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      child.once('error',()=>{clean();reject(new Error('Isolated executor unavailable.'));});
      child.once('close',(exitCode,signal)=>{clean();resolve({stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr),exitCode,signal,timedOut,cancelled,truncated});});
    });
  }
  async docker(args,options){return this.process(['docker',...args],options);}
  async required(args,options){const result=await this.docker(args,options);if(result.exitCode!==0||result.truncated)throw new Error('Isolated operation failed.');return result.stdout;}
  async create(worker,{signal,memory=this.executionProfile.memory,pids=this.executionProfile.pids,temporary=this.executionProfile.temporary}={}){
    const {cpus,workspace}=this.executionProfile;
    if(!/^sha256:[a-f0-9]{64}$/.test(this.image||''))throw new Error('Pinned isolated image required.');
    const info=JSON.parse((await this.required(['info','--format','{"os":{{json .OSType}},"system":{{json .OperatingSystem}},"security":{{json .SecurityOptions}},"cgroups":{{json .CgroupVersion}}}'],{signal})).toString());
    if(info.os!=='linux'||String(info.cgroups)!=='2'||!(info.security.some(s=>s.includes('rootless'))||process.platform==='darwin'&&info.system==='Docker Desktop'))throw new Error('Unsupported isolation backend.');
    await this.required(['create','--pull','never','--name',worker.id,'--label',`odwyn.task=${worker.context.taskId}`,'--label',`odwyn.space=${worker.context.spaceId}`,'--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit',String(pids),'--cpus',String(cpus),'--memory',`${memory}m`,'--memory-swap',`${memory}m`,'--restart','no','--tmpfs',`/workspace:rw,nosuid,nodev,size=${workspace}m,uid=1000,gid=1000,mode=0700`,'--tmpfs',`/tmp:rw,nosuid,nodev,size=${temporary}m,uid=1000,gid=1000,mode=0700`,this.image,'sh','-c','sleep 3600'],{signal});
    await this.required(['start',worker.id],{signal});
    const health=JSON.parse((await this.required(['exec',worker.id,'bun','-e',"const fs=require('node:fs');console.log(JSON.stringify({uid:process.getuid(),status:fs.readFileSync('/proc/self/status','utf8'),memory:fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),pids:fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),cpu:fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim()}))"],{signal})).toString());
    if(health.uid!==1000||!/^Seccomp:\s+2$/m.test(health.status)||!/^NoNewPrivs:\s+1$/m.test(health.status)||!/^CapEff:\s+0+$/m.test(health.status)||Number(health.memory)!==memory*1024*1024||Number(health.pids)!==pids||health.cpu!==`${cpus*100000} 100000`)throw new Error('Kernel isolation controls unavailable.');
    return health;
  }
  async worker(job,resourceId,signal){
    const context=this.policy.authorize(job,'sandbox.exec',resourceId);
    if(!this.configured)throw new Error('Isolated executor unavailable.');
    let worker=this.workers.get(job.id);
    if(worker){if(worker.resourceId!==resourceId)throw new Error('Task workspace cannot change.');await worker.ready;return worker;}
    worker={id:`odwyn-${randomUUID()}`,resourceId,context,base:null,checkpointId:null};this.workers.set(job.id,worker);
    worker.ready=(async()=>{
      await this.create(worker,{signal});
      this.policy.authorize(job,'sandbox.exec',resourceId);
      this.policy.auditIsolation(job,resourceId);
      const directory=mkdtempSync(join(tmpdir(),'odwyn-snapshot-'));
      try{
        const source=await this.snapshotResolver(this.policy.resource(resourceId),context);
        const copied=await this.process(['python3',join(import.meta.dir,'snapshot.py'),source,directory],{signal});
        if(copied.exitCode!==0)throw new Error('Safe workspace snapshot unavailable.');
        const tar=await this.process(['tar','-cf','-','-C',directory,'.'],{signal,limit:20*1024*1024});
        if(tar.exitCode!==0||tar.truncated)throw new Error('Workspace snapshot exceeds bounds.');
        await this.required(['exec','-i',worker.id,'tar','--no-same-owner','-xf','-','-C','/workspace'],{input:tar.stdout,signal});
        const base=await this.inside(worker,['git','-C','/workspace','rev-parse','HEAD'],{signal});
        if(base.exitCode===0&&/^[a-f0-9]{40}\n?$/.test(base.stdout.toString()))worker.base=base.stdout.toString().trim();
      }finally{rmSync(directory,{recursive:true,force:true});}
      this.policy.authorize(job,'sandbox.exec',resourceId);signal?.throwIfAborted();
    })();
    try{await worker.ready;return worker;}catch(error){await this.docker(['rm','-f',worker.id]).catch(()=>{});if(this.workers.get(job.id)===worker)this.workers.delete(job.id);throw error;}
  }
  async inside(worker,argv,options){
    return this.docker(['exec','-i',worker.id,'env','-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/tmp','GIT_CONFIG_NOSYSTEM=1','GIT_CONFIG_GLOBAL=/dev/null',...argv],options);
  }
  async run(job,args,signal){
    const {command,timeoutMs}=validateCommand(args);
    if(timeoutMs>this.executionProfile.timeoutMs)throw new Error('Command exceeds configured execution time.');
    const worker=await this.worker(job,args.resourceId,signal);
    const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    const watch=setInterval(()=>{try{this.policy.authorize(job,'sandbox.exec',args.resourceId);}catch{controller.abort();}},100);
    try{
      const started=Date.now();
      const result=await this.inside(worker,['sh','-c',`cd /workspace && ${command}`],{signal:controller.signal,timeoutMs,onStop:()=>void this.killExec(worker)});
      if(result.timedOut||result.cancelled||result.truncated)await this.killExec(worker);
      // Digests and usage retain an audit without persisting command literals or output secrets.
      this.policy.auditExecution(worker.context,args.resourceId,{commandSha256:createHash('sha256').update(command).digest('hex'),wallMs:Date.now()-started,stdoutBytes:result.stdout.length,stderrBytes:result.stderr.length,exitCode:result.exitCode,timedOut:result.timedOut,cancelled:result.cancelled,truncated:result.truncated});
      this.policy.authorize(job,'sandbox.exec',args.resourceId);
      return {...result,stdout:result.stdout.toString(),stderr:result.stderr.toString()};
    }finally{clearInterval(watch);signal?.removeEventListener('abort',abort);}
  }
  async killExec(worker){
    // Kill the complete cgroup on cancellation; timeout also cannot leave descendants.
    await this.docker(['kill',worker.id]).catch(()=>{});
  }
  existing(job){this.policy.context(job);const worker=this.workers.get(job.id);if(!worker?.base)throw new Error('Task Git workspace unavailable.');return worker;}
  async git(job,args,options){const worker=this.existing(job);return this.inside(worker,['git','-C','/workspace','-c','core.hooksPath=/dev/null','-c','diff.external=',...args],options);}
  async patch(job,resourceId){
    if(this.existing(job).resourceId!==resourceId)throw new Error('Patch workspace does not match resource.');
    const worker=this.existing(job),result=await this.git(job,['diff','--no-ext-diff','--no-textconv','--binary',worker.base,'--']);
    if(result.exitCode!==0||result.truncated)throw new Error('Bounded patch export unavailable.');return result.stdout.toString();
  }
  async file(job,resourceId,path){
    this.policy.authorize(job,'sandbox.exec',resourceId);
    const worker=this.workers.get(job.id);if(!worker||worker.resourceId!==resourceId||typeof path!=='string'||!/^[^/\\\x00-\x1f]+$/.test(path)||['.','..'].includes(path))throw new Error('Task file export denied.');await worker.ready;
    const code=`const fs=require('node:fs');const fd=fs.openSync('/workspace/'+${JSON.stringify(path)},fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const s=fs.fstatSync(fd);if(!s.isFile()||!s.size||s.size>20971520)throw Error('bounded file');const bytes=fs.readFileSync(fd);if(bytes.length>20971520)throw Error('bounded file');process.stdout.write(bytes)}finally{fs.closeSync(fd)}`;
    const result=await this.inside(worker,['bun','-e',code],{limit:20*1024*1024});this.policy.authorize(job,'sandbox.exec',resourceId);
    if(result.exitCode!==0||result.truncated)throw new Error('Isolated file export denied.');return result.stdout;
  }
  checkpointDirectoryCheck(){
    if(!this.checkpointRoot)throw new Error('Persistent execution unavailable.');
    const stat=lstatSync(this.checkpointRoot),original=this.checkpointDirectory;
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.ino!==original.ino||stat.dev!==original.dev||(stat.mode&0o022)||stat.uid!==process.getuid())throw new Error('Unsafe checkpoint directory.');
  }
  validateCheckpointFiles(files){
    if(!Array.isArray(files)||files.length>4096)throw new Error('Checkpoint files exceed bounds.');
    const excluded=new Set(['.env','.ssh','.codex','.aws','.docker','.npmrc','.gitconfig','.git-credentials','.netrc','auth.json','Cookies','state.sqlite','odwyn.db','odwyn.db-wal','odwyn.db-shm','sidekick.db','sidekick.db-wal','sidekick.db-shm','id_ed25519','id_rsa']);
    const paths=new Set();let bytes=0;
    for(const file of files){
      if(!file||Object.keys(file).sort().join(',')!=='data,executable,path'||typeof file.path!=='string'||file.path.length>4096||typeof file.data!=='string'||typeof file.executable!=='boolean')throw new Error('Invalid checkpoint file.');
      const parts=file.path.split('/');
      if(parts.length>33||parts.some(part=>!part||part==='.'||part==='..'||/[\\\x00-\x1f\x7f]/.test(part)||excluded.has(part)||part.startsWith('.env.')||part.endsWith('.pem')||part.endsWith('.key'))||/^\.git\/(config|hooks|logs)(\/|$)/.test(file.path)||paths.has(file.path))throw new Error('Unsafe checkpoint path.');
      const data=Buffer.from(file.data,'base64');bytes+=data.length;
      if(data.toString('base64')!==file.data||bytes>16*1024*1024)throw new Error('Checkpoint data exceeds bounds.');
      this.validateCheckpointBytes?.(data);paths.add(file.path);
    }
    for(const path of paths){let parent=path;while(parent.includes('/')){parent=parent.slice(0,parent.lastIndexOf('/'));if(paths.has(parent))throw new Error('Conflicting checkpoint paths.');}}
    return files;
  }
  checkpointRead(id){
    this.checkpointDirectoryCheck();
    if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid checkpoint ID.');
    const fd=openSync(join(this.checkpointRoot,id+'.json'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
      const stat=fstatSync(fd);
      if(!stat.isFile()||stat.nlink!==1||stat.size>24*1024*1024||stat.uid!==process.getuid()||(stat.mode&0o022))throw new Error('Unsafe checkpoint file.');
      const data=readFileSync(fd);
      if(data.length>24*1024*1024||createHash('sha256').update(data).digest('hex')!==id)throw new Error('Checkpoint integrity mismatch.');
      const checkpoint=JSON.parse(data.toString());
      if(checkpoint.version!==1||typeof checkpoint.spaceId!=='string'||typeof checkpoint.resourceId!=='string'||!(checkpoint.parentId===null||/^[a-f0-9]{64}$/.test(checkpoint.parentId))||!(checkpoint.base===null||/^[a-f0-9]{40}$/.test(checkpoint.base)))throw new Error('Invalid checkpoint metadata.');
      this.validateCheckpointFiles(checkpoint.files);return {id,...checkpoint};
    }finally{closeSync(fd);}
  }
  async loadCheckpoint(job,resourceId,id){
    const context=this.policy.authorize(job,'sandbox.exec',resourceId),checkpoint=this.checkpointRead(id);
    if(checkpoint.spaceId!==context.spaceId||checkpoint.resourceId!==resourceId)throw new Error('Checkpoint scope mismatch.');
    return checkpoint;
  }
  checkpointWrite(checkpoint){
    this.checkpointDirectoryCheck();this.validateCheckpointFiles(checkpoint.files);
    const data=Buffer.from(JSON.stringify(checkpoint));
    if(data.length>24*1024*1024)throw new Error('Checkpoint exceeds bounds.');
    const id=createHash('sha256').update(data).digest('hex'),path=join(this.checkpointRoot,id+'.json');
    // The ID is returned only after durable writes; an interrupted write cannot pass its content hash.
    let fd;
    try{fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o400);writeFileSync(fd,data);fsyncSync(fd);}
    catch(error){if(error.code!=='EEXIST'){if(fd!==undefined)rmSync(path,{force:true});throw error;}this.checkpointRead(id);}
    finally{if(fd!==undefined)closeSync(fd);}
    const directory=openSync(this.checkpointRoot,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(directory);}finally{closeSync(directory);}
    return {id,...checkpoint};
  }
  async checkpoint(job,resourceId,{expectedParent=null,signal}={}){
    const context=this.policy.authorize(job,'sandbox.exec',resourceId),worker=this.workers.get(job.id);
    this.checkpointDirectoryCheck();
    if(!worker||worker.resourceId!==resourceId||worker.context.spaceId!==context.spaceId)throw new Error('Checkpoint workspace mismatch.');
    await worker.ready;signal?.throwIfAborted();
    if((worker.checkpointId||null)!==expectedParent)throw new Error('Checkpoint parent conflict.');
    // Only the pinned worker executes this collector. Host parses bounded data, never an archive or script.
    const code=`const fs=require('node:fs'),path=require('node:path');const files=[];let entries=0,bytes=0;const excluded=new Set(['.env','.ssh','.codex','.aws','.docker','.npmrc','.gitconfig','.git-credentials','.netrc','auth.json','Cookies','state.sqlite','odwyn.db','odwyn.db-wal','odwyn.db-shm','sidekick.db','sidekick.db-wal','sidekick.db-shm','id_ed25519','id_rsa']);function walk(relative=''){if(relative.split('/').length>33)throw Error('depth');for(const name of fs.readdirSync('/workspace/'+relative).sort()){const item=relative?relative+'/'+name:name;if(excluded.has(name)||name.startsWith('.env.')||name.endsWith('.pem')||name.endsWith('.key')||/^\\.git\\/(config|hooks|logs)(\\/|$)/.test(item))continue;if(++entries>4096)throw Error('entries');const target='/workspace/'+item,s=fs.lstatSync(target);if(s.isSymbolicLink())throw Error('symlink');if(s.isDirectory()){walk(item);continue}if(!s.isFile())throw Error('special file');const fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>16777216-bytes)throw Error('bounded file');const data=fs.readFileSync(fd);bytes+=data.length;if(bytes>16777216)throw Error('bytes');files.push({path:item,data:data.toString('base64'),executable:!!(stat.mode&73)})}finally{fs.closeSync(fd)}}}walk();process.stdout.write(JSON.stringify(files));`;
    const result=await this.inside(worker,['bun','-e',code],{signal,limit:24*1024*1024});
    if(result.exitCode!==0||result.truncated||result.timedOut||result.cancelled)throw new Error('Bounded checkpoint export unavailable.');
    const files=this.validateCheckpointFiles(JSON.parse(result.stdout.toString()));
    this.policy.authorize(job,'sandbox.exec',resourceId);signal?.throwIfAborted();
    return this.checkpointWrite({version:1,spaceId:context.spaceId,resourceId,parentId:expectedParent,base:worker.base||null,createdAt:new Date().toISOString(),files});
  }
  async restore(job,resourceId,id,signal){
    const checkpoint=await this.loadCheckpoint(job,resourceId,id),context=this.policy.authorize(job,'sandbox.exec',resourceId);
    if(!this.configured)throw new Error('Isolated executor unavailable.');
    if(this.workers.has(job.id))throw new Error('Checkpoint restore requires a fresh task workspace.');
    const worker={id:`odwyn-${randomUUID()}`,resourceId,context,base:checkpoint.base,checkpointId:id};this.workers.set(job.id,worker);
    worker.ready=(async()=>{
      await this.create(worker,{signal});this.policy.authorize(job,'sandbox.exec',resourceId);this.policy.auditIsolation(job,resourceId);
      const code=`const fs=require('node:fs'),path=require('node:path');const files=JSON.parse(fs.readFileSync(0,'utf8'));for(const file of files){const target=path.join('/workspace',file.path);fs.mkdirSync(path.dirname(target),{recursive:true,mode:448});fs.writeFileSync(target,Buffer.from(file.data,'base64'),{flag:'wx',mode:file.executable?448:384})}`;
      const result=await this.inside(worker,['bun','-e',code],{input:JSON.stringify(checkpoint.files),signal});
      if(result.exitCode!==0||result.truncated||result.timedOut||result.cancelled)throw new Error('Checkpoint restore failed.');
      this.policy.authorize(job,'sandbox.exec',resourceId);signal?.throwIfAborted();
    })();
    try{await worker.ready;return worker;}catch(error){await this.stop(job.id);throw error;}
  }
  copyCheckpoint(id,{sourceSpaceId,sourceResourceId,destinationSpaceId,destinationResourceId}){
    const checkpoint=this.checkpointRead(id);
    if(checkpoint.spaceId!==sourceSpaceId||checkpoint.resourceId!==sourceResourceId||typeof destinationSpaceId!=='string'||!destinationSpaceId||typeof destinationResourceId!=='string'||!destinationResourceId)throw new Error('Checkpoint transfer scope mismatch.');
    return this.checkpointWrite({version:1,spaceId:destinationSpaceId,resourceId:destinationResourceId,parentId:null,base:checkpoint.base,createdAt:new Date().toISOString(),files:checkpoint.files});
  }
  async stop(taskId){const worker=this.workers.get(taskId);if(!worker)return;this.workers.delete(taskId);const removal=this.docker(['rm','-f',worker.id]).catch(()=>{});this.removals.add(removal);try{await removal;}finally{this.removals.delete(removal);}}
  async close(){await Promise.all([...this.workers.keys()].map(id=>this.stop(id)));await Promise.all(this.removals);}
}
