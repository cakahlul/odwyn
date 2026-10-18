import {randomUUID} from 'node:crypto';

export function validateGitSync(args){
  if(!args||Object.keys(args).some(key=>!['resourceId','workspaceId','branch','operation'].includes(key))||typeof args.resourceId!=='string'||typeof args.workspaceId!=='string'||!['checkout','pull'].includes(args.operation)||typeof args.branch!=='string'||args.branch.length>200||!args.branch.split('/').every(part=>/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(part)&&!part.endsWith('.')&&!part.endsWith('.lock'))||args.branch.includes('..')||args.branch==='HEAD')throw Error('Choose checkout or pull and an exact Git branch name.');
  return args;
}
export async function syncGitWorkspace(gateway,job,args,signal,canRun=()=>{}){
  validateGitSync(args);const {policy,sandbox}=gateway;
  const check=()=>{signal.throwIfAborted();canRun();policy.authorize(job,'repository.read',args.resourceId);policy.authorize(job,'sandbox.exec',args.workspaceId);const workspace=policy.resource(args.workspaceId),repository=policy.resource(args.resourceId);if(workspace.metadata.repositoryId!==args.resourceId||workspace.spaceId!==repository.spaceId||repository.metadata.upstreamId)throw Error('Link this Git repository to the isolated workspace in Settings first.');};
  check();const worker=sandbox.workers.get(job.id);if(!worker||worker.resourceId!==args.workspaceId)throw Error('Prepare the linked isolated workspace first.');await worker.ready;
  const git=async(argv,options={})=>{check();const result=await sandbox.inside(worker,['git','--no-replace-objects','-C','/workspace','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','diff.external=','-c','gc.auto=0',...argv],{signal,...options});check();return result;};
  const requireGit=async(argv,options)=>{const result=await git(argv,options);if(result.exitCode!==0||result.truncated||result.timedOut||result.cancelled)throw Error('Isolated Git operation failed. No forced reset or cleanup was attempted.');return result.stdout;};
  const metadata=await sandbox.inside(worker,['bun','-e','const fs=require("node:fs");console.log(JSON.stringify({git:fs.existsSync("/workspace/.git"),empty:fs.readdirSync("/workspace").length===0}))'],{signal});
  if(metadata.exitCode!==0||metadata.truncated)throw Error('Workspace inspection failed.');const initial=JSON.parse(metadata.stdout.toString());
  if(initial.git){await sandbox.gitMetadata(worker,{signal});const directory=(await requireGit(['rev-parse','--git-dir'])).toString().trim();if(directory!=='.git')throw Error('Only a standalone isolated Git repository is supported.');if((await requireGit(['status','--porcelain','--untracked-files=all','--ignored=matching'])).length)throw Error('Workspace has uncommitted or untracked files. Commit or checkpoint and resolve them before checkout or pull.');}
  else if(args.operation==='pull')throw Error('This workspace has no Git metadata yet. Use checkout first to connect its linked repository.');
  check();const resource=policy.resource(args.resourceId),target=await gateway.resolver(resource.metadata.endpoint);check();
  if(target.url.search||target.url.hash)throw Error('Use an exact Git HTTPS clone URL without query parameters.');
  const token=await gateway.readCredentialResolver(args.resourceId,policy.context(job));check();if(token!==null&&(typeof token!=='string'||token.length>4096||/[\r\n]/.test(token)))throw Error('Invalid scoped credential.');
  const service='git-upload-pack',username=resource.metadata.gitUsername,path=target.url.pathname.replace(/\/$/,''),advertisement=await gateway.request(target,path+'/info/refs?service='+service,'GET',undefined,token,signal,{service,username});check();
  const refs=gitPacketLines(advertisement);const ref='refs/heads/'+args.branch;
  const advertised=refs.find(line=>line.split(' ')[1]?.split(/[\0\n]/)[0]===ref),commit=advertised?.slice(0,40);
  if(!commit||!/^[a-f0-9]{40}$/.test(commit))throw Error('The requested branch was not advertised by the linked repository.');
  const packet=text=>{const data=Buffer.from(text);return Buffer.concat([Buffer.from((data.length+4).toString(16).padStart(4,'0')),data]);};
  const response=await gateway.request(target,path+'/'+service,'POST',Buffer.concat([packet(`want ${commit}\n`),Buffer.from('0000'),packet('done\n')]),token,signal,{service,username,limit:8*1024*1024});check();
  if(response.subarray(0,8).toString()!=='0008NAK\n'||response.subarray(8,12).toString()!=='PACK')throw Error('Unsupported Git fetch response. A bounded Git smart-HTTP repository is required.');
  const staging='/tmp/odwyn-git-'+randomUUID();let initialized=false;
  try{
    await requireGit(['init','--bare','--template=',staging]);
    const staged=async(argv,options={})=>{check();const result=await sandbox.inside(worker,['git','--git-dir='+staging,'-c','core.hooksPath=/dev/null',...argv],{signal,...options});check();if(result.exitCode!==0||result.truncated||result.timedOut||result.cancelled){
      const stage=argv[0]==='index-pack'?'index fetched history':'inspect fetched tree',stderr=result.stderr.toString();
      // Only fixed diagnostic labels leave the worker; stderr can contain repository data.
      const reason=result.cancelled?'cancelled':result.timedOut?'15-second execution timeout':result.truncated?'diagnostic or tree output limit':/No space left on device/i.test(stderr)?`worker storage exhausted (temporary history staging limit: ${sandbox.executionProfile.temporary} MiB)`:/out of memory|cannot allocate memory|bad_alloc/i.test(stderr)?'worker memory exhausted':result.exitCode===137?'worker process killed (exit 137; memory exhaustion is possible)':/inflate|corrupt|bad object|invalid object|pack signature|pack checksum|early EOF|unresolved delta|SHA1 mismatch/i.test(stderr)?'invalid or incomplete Git objects':'Git command failed';
      throw Error(`Cannot ${stage}: ${reason}; exit ${Number.isInteger(result.exitCode)?result.exitCode:'unavailable'}. Checkout and pull remain unconfirmed.`);
    }return result.stdout;};
    // Keep delta-compressed history packed; loose objects can exhaust staging for small transfers.
    const indexPack=['index-pack','--stdin','--threads=1','--no-rev-index','--max-input-size=8388608','--strict'];
    await staged(indexPack,{input:response.subarray(8),timeoutMs:15000,limit:4096});
    const tree=(await staged(['ls-tree','-rlz','--full-tree',commit],{limit:2*1024*1024})).toString();let bytes=0;const files=[];
    for(const line of tree.split('\0').filter(Boolean)){const match=line.match(/^(100644|100755) blob [a-f0-9]{40} +([0-9]+)\t([\s\S]+)$/);if(!match)throw Error('Git trees with symlinks or submodules are unsupported.');bytes+=Number(match[2]);files.push({path:match[3],data:'',executable:match[1]==='100755'});}
    if(!files.length||bytes>16*1024*1024||files.length>4096)throw Error('Repository working tree exceeds 16 MiB or 4,096 source files.');sandbox.validateCheckpointFiles(files);
    if(!initial.git){await requireGit(['init','--template=','--initial-branch='+args.branch]);initialized=true;}
    await requireGit(indexPack,{input:response.subarray(8),timeoutMs:15000,limit:4096});
    await requireGit(['cat-file','-e',commit+'^{commit}']);
    if(!initial.git&&!initial.empty){
      // Adopt copied files only when their index exactly matches the selected upstream commit.
      await requireGit(['read-tree',commit]);
      if((await git(['diff','--no-ext-diff','--no-textconv','--exit-code'])).exitCode!==0||(await requireGit(['ls-files','--others','-z'])).length)throw Error('Copied source differs from the remote branch. Existing files were preserved; use a new empty linked workspace or retain your local changes separately.');
      await requireGit(['update-ref','refs/heads/'+args.branch,commit]);
    }else if(!initial.git){await requireGit(['checkout','--no-track','-b',args.branch,commit]);}
    else{
      if((await requireGit(['status','--porcelain','--untracked-files=all','--ignored=matching'])).length)throw Error('Workspace changed during fetch; update cancelled.');
      const current=(await requireGit(['symbolic-ref','--short','HEAD'])).toString().trim();
      if(args.operation==='pull'&&current!==args.branch)throw Error('Pull branch must match the checked out branch. Use checkout first.');
      const exists=await git(['show-ref','--verify','--quiet','refs/heads/'+args.branch]);
      if(exists.exitCode===0){const ancestor=await git(['merge-base','--is-ancestor','refs/heads/'+args.branch,commit]);if(ancestor.exitCode!==0)throw Error('Branch has diverged or contains local commits. Fast-forward update refused; no reset was performed.');await requireGit(['checkout',args.branch]);await requireGit(['merge','--ff-only','--no-edit',commit]);}
      else await requireGit(['checkout','--no-track','-b',args.branch,commit]);
    }
    await requireGit(['update-ref','refs/remotes/origin/'+args.branch,commit]);worker.base=commit;check();
    return {resourceId:args.resourceId,workspaceId:args.workspaceId,operation:args.operation,branch:args.branch,commit,fastForwardOnly:true};
  }catch(error){if(initialized){await sandbox.inside(worker,['rm','-rf','--','/workspace/.git'],{signal:undefined});worker.base=null;}throw error;}
  finally{await sandbox.inside(worker,['rm','-rf','--',staging],{});}
}
function gitPacketLines(body){const lines=[];let offset=0;while(offset<body.length){const prefix=body.subarray(offset,offset+4).toString();if(!/^[0-9a-f]{4}$/i.test(prefix))throw Error('Invalid Git advertisement.');const size=parseInt(prefix,16);offset+=4;if(!size)continue;if(size<4||offset+size-4>body.length)throw Error('Invalid Git advertisement.');lines.push(body.subarray(offset,offset+size-4).toString());offset+=size-4;}return lines;}
