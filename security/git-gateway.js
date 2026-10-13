import http from 'node:http';
import https from 'node:https';
import { resolvePublic } from '../security.js';

const pkt=text=>{const bytes=Buffer.from(text);return Buffer.concat([Buffer.from((bytes.length+4).toString(16).padStart(4,'0')),bytes]);};
function lines(body){
  const result=[];let at=0;
  while(at<body.length){
    const head=body.subarray(at,at+4).toString();if(!/^[a-f0-9]{4}$/i.test(head))throw new Error('Invalid Git response.');
    const size=parseInt(head,16);at+=4;if(size===0)continue;
    if(size<4||at+size-4>body.length)throw new Error('Invalid Git response.');
    result.push(body.subarray(at,at+size-4).toString());at+=size-4;
  }return result;
}
export class GitGateway {
  constructor(policy,sandbox,{resolver=resolvePublic,credentialResolver=()=>null}={}){this.policy=policy;this.sandbox=sandbox;this.resolver=resolver;this.credentialResolver=credentialResolver;}
  async request(target,path,method,body,token,signal){
    const {url,address,family}=target;
    return new Promise((resolve,reject)=>{
      const headers={host:url.host,'content-type':'application/x-git-receive-pack-request',accept:'application/x-git-receive-pack-result'};
      if(token)headers.authorization='Bearer '+token;
      const request=(url.protocol==='https:'?https:http).request({hostname:address,family,servername:url.hostname,port:Number(url.port||(url.protocol==='https:'?443:80)),path,method,headers,signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])},response=>{
        if(response.statusCode!==200){response.destroy();reject(new Error('Scoped Git upstream unavailable.'));return;}
        const chunks=[];let size=0;
        response.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){response.destroy();reject(new Error('Git response exceeds bounds.'));}else chunks.push(chunk);});
        response.on('end',()=>resolve(Buffer.concat(chunks)));response.on('error',()=>reject(new Error('Scoped Git response interrupted.')));response.on('aborted',()=>reject(new Error('Scoped Git response interrupted.')));
      });request.on('error',()=>reject(new Error('Scoped Git transport unavailable.')));request.end(body);
    });
  }
  async push(job,args,signal){
    if(!args||Object.keys(args).some(k=>!['resourceId','ref'].includes(k))||typeof args.ref!=='string'||args.ref.length>256||!/^refs\/heads\/[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(args.ref)||args.ref.includes('..')||args.ref.endsWith('/')||args.ref.includes('//'))throw new Error('Unsupported Git push target.');
    const check=()=>{signal.throwIfAborted();return this.policy.authorize(job,'repository.branch.push',args.resourceId);};
    check();
    const branch=args.ref.slice(11);
    if(/^(main|master|release)(\/|$)/i.test(branch))throw new Error('Protected refs require owner step-up approval.');
    const constraints=this.policy.constraints(job,'repository.branch.push',args.resourceId);
    if(!constraints.branchPrefixes?.length||!constraints.branchPrefixes.some(p=>branch.startsWith(p))||constraints.forbiddenRefs?.some(ref=>ref.endsWith('*')?branch.startsWith(ref.slice(0,-1)):branch===ref))throw new Error('Git ref outside owner constraints.');
    const worker=this.sandbox.existing(job);
    const revision=await this.sandbox.git(job,['rev-parse','--verify',args.ref],{signal});
    const next=revision.stdout.toString().trim();if(revision.exitCode!==0||!/^[a-f0-9]{40}$/.test(next))throw new Error('Git branch unavailable.');
    const ancestry=await this.sandbox.git(job,['merge-base','--is-ancestor',worker.base,next],{signal});if(ancestry.exitCode!==0)throw new Error('Unrelated repository history denied.');
    const changed=await this.sandbox.git(job,['diff','--no-ext-diff','--no-textconv','--name-only','-z',worker.base,next,'--'],{signal});
    if(changed.exitCode!==0||changed.truncated)throw new Error('Git change validation unavailable.');
    const paths=changed.stdout.toString().split('\0').filter(Boolean);
    if(paths.some(p=>p.startsWith('.github/')||/^(\.gitlab-ci\.yml|Jenkinsfile|CODEOWNERS)$/.test(p)))throw new Error('CI and repository policy changes require owner approval.');
    check();
    const resource=this.policy.resource(args.resourceId),target=await this.resolver(resource.metadata.endpoint);check();
    const token=await this.credentialResolver(args.resourceId,this.policy.context(job));
    if(token!==null&&(typeof token!=='string'||token.length>4096||/[\r\n]/.test(token)))throw new Error('Invalid scoped credential.');
    const path=target.url.pathname.replace(/\/$/,'');
    const advertisement=lines(await this.request(target,path+'/info/refs?service=git-receive-pack','GET',undefined,token,signal));
    const refs=advertisement.filter(line=>/^[a-f0-9]{40} /.test(line));
    if(!refs.some(line=>line.split('\0')[1]?.split(/\s/).includes('report-status')))throw new Error('Git receipt verification unavailable.');
    const old=refs.find(line=>line.split(' ')[1]?.split(/[\0\n]/)[0]===args.ref)?.slice(0,40)||'0'.repeat(40);
    if(old!=='0'.repeat(40)){
      const fastForward=await this.sandbox.git(job,['merge-base','--is-ancestor',old,next],{signal});if(fastForward.exitCode!==0)throw new Error('Non-fast-forward push denied.');
    }
    const packed=await this.sandbox.git(job,['pack-objects','--stdout','--revs'],{input:Buffer.from(next+'\n'),signal,limit:8*1024*1024});
    if(packed.exitCode!==0||packed.truncated||packed.stdout.subarray(0,4).toString()!=='PACK')throw new Error('Bounded Git pack unavailable.');
    check();
    const response=lines(await this.request(target,path+'/git-receive-pack','POST',Buffer.concat([pkt(`${old} ${next} ${args.ref}\0report-status\n`),Buffer.from('0000'),packed.stdout]),token,signal));
    if(!response.includes('unpack ok\n')||!response.includes(`ok ${args.ref}\n`))throw new Error('Git push receipt did not confirm success.');
    check();return {resourceId:args.resourceId,ref:args.ref,commit:next,receiptVerified:true};
  }
}
