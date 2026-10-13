import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { validateCommand } from '../terminal.js';

export const shellQuote=value=>"'"+String(value).replaceAll("'","'\\''")+"'";
export class Sandbox {
  constructor(policy,{image,snapshotRoot,snapshotResolver}={}){
    this.policy=policy;this.image=image;this.snapshotResolver=snapshotResolver||(snapshotRoot?((resource,context)=>join(snapshotRoot,context.spaceId,resource.id)):null);
    this.configured=/^sha256:[a-f0-9]{64}$/.test(image||'')&&!!this.snapshotResolver;
    this.workers=new Map();this.removals=new Set();
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
  async create(worker,{signal,memory=128,pids=64,temporary=16}={}){
    if(!/^sha256:[a-f0-9]{64}$/.test(this.image||''))throw new Error('Pinned isolated image required.');
    const info=JSON.parse((await this.required(['info','--format','{"os":{{json .OSType}},"system":{{json .OperatingSystem}},"security":{{json .SecurityOptions}},"cgroups":{{json .CgroupVersion}}}'],{signal})).toString());
    if(info.os!=='linux'||String(info.cgroups)!=='2'||!(info.security.some(s=>s.includes('rootless'))||process.platform==='darwin'&&info.system==='Docker Desktop'))throw new Error('Unsupported isolation backend.');
    await this.required(['create','--pull','never','--name',worker.id,'--label',`odwyn.task=${worker.context.taskId}`,'--label',`odwyn.space=${worker.context.spaceId}`,'--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit',String(pids),'--cpus','1','--memory',`${memory}m`,'--memory-swap',`${memory}m`,'--restart','no','--tmpfs','/workspace:rw,nosuid,nodev,size=32m,uid=1000,gid=1000,mode=0700','--tmpfs',`/tmp:rw,nosuid,nodev,size=${temporary}m,uid=1000,gid=1000,mode=0700`,this.image,'sh','-c','sleep 3600'],{signal});
    await this.required(['start',worker.id],{signal});
    const health=JSON.parse((await this.required(['exec',worker.id,'bun','-e',"const fs=require('node:fs');console.log(JSON.stringify({uid:process.getuid(),status:fs.readFileSync('/proc/self/status','utf8'),memory:fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),pids:fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),cpu:fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim()}))"],{signal})).toString());
    if(health.uid!==1000||!/^Seccomp:\s+2$/m.test(health.status)||!/^NoNewPrivs:\s+1$/m.test(health.status)||!/^CapEff:\s+0+$/m.test(health.status)||Number(health.memory)!==memory*1024*1024||Number(health.pids)!==pids||health.cpu!=='100000 100000')throw new Error('Kernel isolation controls unavailable.');
    return health;
  }
  async worker(job,resourceId,signal){
    const context=this.policy.authorize(job,'sandbox.exec',resourceId);
    if(!this.configured)throw new Error('Isolated executor unavailable.');
    let worker=this.workers.get(job.id);
    if(worker){if(worker.resourceId!==resourceId)throw new Error('Task workspace cannot change.');await worker.ready;return worker;}
    worker={id:`odwyn-${randomUUID()}`,resourceId,context,base:null};this.workers.set(job.id,worker);
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
  async stop(taskId){const worker=this.workers.get(taskId);if(!worker)return;this.workers.delete(taskId);const removal=this.docker(['rm','-f',worker.id]).catch(()=>{});this.removals.add(removal);try{await removal;}finally{this.removals.delete(removal);}}
  async close(){await Promise.all([...this.workers.keys()].map(id=>this.stop(id)));await Promise.all(this.removals);}
}
