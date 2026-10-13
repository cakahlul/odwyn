import http from 'node:http';
import https from 'node:https';
import {randomUUID} from 'node:crypto';
import {Sandbox} from '../execution/sandbox.js';
import {resolvePublic} from '../security.js';

export class ScopedBrowsers {
  constructor(store,{resolver=resolvePublic,image}={}){
    this.store=store;this.resolve=resolver;this.executor=new Sandbox(store.security,{image});
    this.configured=/^sha256:[a-f0-9]{64}$/.test(image||'');this.profiles=new Map();this.removals=new Set();
  }
  get(job,resourceId){this.store.security.authorize(job,'browser.read',resourceId);const worker=this.profiles.get(job.id+':'+resourceId);if(!worker)throw new Error('Task browser not started.');return worker;}
  async page(raw,check,signal){
    const {url,address,family}=await this.resolve(raw);check();
    return new Promise((done,fail)=>{
      // The renderer cannot select requests, headers, redirects or credentials.
      const request=(url.protocol==='https:'?https:http).get({hostname:address,family,servername:url.hostname.replace(/^\[|\]$/g,''),port:Number(url.port||(url.protocol==='https:'?443:80)),path:url.pathname+url.search,headers:{host:url.host,accept:'text/html'},signal},response=>{
        const type=String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();
        if(response.statusCode!==200||type!=='text/html'){response.destroy();fail(new Error('Reviewed HTML page unavailable.'));return;}
        let size=0;const chunks=[];
        response.on('data',chunk=>{size+=chunk.length;if(size>262144){response.destroy();fail(new Error('Browser page exceeds bounds.'));}else chunks.push(chunk);});
        response.on('error',fail);response.on('aborted',()=>fail(new Error('Browser download interrupted.')));
        response.on('end',()=>{try{check();done(this.store.connectors.redact(Buffer.concat(chunks).toString('utf8')));}catch(error){fail(error);}});
      });request.on('error',fail);
    });
  }
  async action(job,args,canRun=()=>true){
    if(Object.keys(args).some(k=>!['resourceId','action','url','reason'].includes(k))||!['read','navigate'].includes(args.action))throw new Error('Browser interaction or visual export unavailable.');
    const context=this.store.security.context(job),bound=Object.freeze({id:context.taskId,agentId:context.agentId,spaceId:context.spaceId}),action=args.action==='navigate'?'browser.navigate':'browser.read';
    const check=()=>{if(!canRun())throw new Error('Browser task ended.');this.store.security.authorize(bound,action,args.resourceId);this.store.security.authorize(bound,'browser.read',args.resourceId);};check();
    if(!this.configured)throw new Error('Isolated browser unavailable.');
    const resource=this.store.security.resource(args.resourceId);
    if(args.url!==undefined&&!resource.metadata.readUrls.includes(args.url)||args.action==='navigate'&&!args.url)throw new Error('Browser URL outside reviewed read scope.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000),watch=setInterval(()=>{try{check();}catch{controller.abort();}},100);
    const key=context.taskId+':'+resource.id;let worker=this.profiles.get(key);
    if(!worker){worker={id:'odwyn-browser-'+randomUUID(),context,resourceId:resource.id,tail:Promise.resolve()};this.profiles.set(key,worker);worker.ready=this.executor.create(worker,{signal:controller.signal,memory:512,pids:128,temporary:128}).then(()=>this.store.security.auditIsolation(bound,resource.id));}
    const run=async()=>{
      try{
        await worker.ready;check();controller.signal.throwIfAborted();
        const input=args.action==='navigate'?{url:args.url,html:await this.page(args.url,check,controller.signal)}:{};check();
        const result=await this.executor.inside(worker,['bun','/app/execution/browser-worker.js'],{input:JSON.stringify(input),signal:controller.signal,timeoutMs:20000,limit:131072});
        check();if(result.exitCode!==0||result.truncated||result.cancelled||result.timedOut)throw new Error('Browser worker failed.');
        const snapshot=JSON.parse(result.stdout.toString());
        if(!resource.metadata.readUrls.includes(snapshot.url))throw new Error('Browser left reviewed read scope.');
        return this.store.connectors.sanitize(snapshot);
      }catch{await this.stop(context.taskId);throw new Error('Scoped browser denied or unavailable.');}
      finally{clearTimeout(timer);clearInterval(watch);}
    };
    const pending=worker.tail.then(run,run);worker.tail=pending.catch(()=>{});return pending;
  }
  async stop(taskId){for(const [key,worker] of this.profiles)if(key.startsWith(taskId+':')){
    this.profiles.delete(key);
    // Wait for creation before removal, so cancellation cannot orphan a cgroup.
    const removal=worker.ready.catch(()=>{}).then(()=>this.executor.docker(['rm','-f',worker.id])).catch(()=>{});
    this.removals.add(removal);try{await removal;}finally{this.removals.delete(removal);}
  }}
  async close(){await Promise.all([...this.profiles.keys()].map(id=>this.stop(id.split(':')[0])));await Promise.all(this.removals);}
}
