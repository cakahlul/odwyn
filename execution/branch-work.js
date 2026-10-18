import {branchDestination,mergeTransition} from '../security/git-work.js';
import {canonical} from '../security/approvals.js';
import {ensureTaskWorkspace,saveTaskCheckpoint} from './work.js';
import {textInput} from '../security.js';

const oid=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const strict=(input,keys)=>{if(!input||Object.keys(input).some(key=>!keys.includes(key)))throw Error('Unsupported branch workflow fields.');};
function context(runtime,job,resourceId,action,signal){
  const policy=runtime.store.security,resource=policy.resource(resourceId),rule=resource.metadata.branchPolicy;
  if(!resource.grantResourceId||!rule)throw Error('Configure a reviewed branch workflow on this saved isolated workspace.');
  const workspaceId=resourceId.slice(0,-4),revision=policy.revision;
  const room=runtime.state.conversations.find(room=>room.id===job.conversationId&&room.kind==='room');
  const check=()=>{
    signal?.throwIfAborted();if(!['running','waiting'].includes(job.status)||revision!==policy.revision)throw Error('Task ended or access policy changed.');
    policy.authorize(job,action,resourceId);policy.authorize(job,'repository.read',resourceId);
    runtime.store.data.roomCheck(job,[{resourceId,action:'repository.read'}]);
    if(!room?.governance||room.spaceId!==job.spaceId||!room.memberIds.includes(job.agentId)||room.governance.observerIds?.includes(job.agentId)||room.discussion?.status!=='active'||room.discussion.id!==job.roomRoundId)throw Error('An active configured room is required for branch work.');
  };
  check();return {policy,resource,rule,workspaceId,room,check,revision};
}
const git=async(runtime,job,args,signal,options={})=>{const result=await runtime.sandbox.git(job,args,{signal,limit:65536,...options});if(result.exitCode!==0||result.truncated||result.timedOut||result.cancelled)throw Error('Git branch operation failed or exceeded bounds. Resolve conflicts in a task branch; no reset was attempted.');return result.stdout.toString().trim();};
async function clean(runtime,job,commit,signal){if(await git(runtime,job,['rev-parse','HEAD'],signal)!==commit||!await runtime.sandbox.gitClean(job,signal))throw Error('Workspace must contain the exact clean commit. Save and synchronize the requested branch first.');}
function permitted(policy,job,action,id,key,value){if(!policy.constraints(job,action,id)[key]?.includes(value))throw Error('Branch operation is outside owner-granted directions.');}
function safeChanges(paths){if(paths.split('\0').some(path=>path.startsWith('.github/')||/^(\.gitlab-ci\.yml|Jenkinsfile|CODEOWNERS)$/.test(path)))throw Error('CI and repository policy changes require a separate owner-reviewed path.');}
export async function createBranch(runtime,job,input,signal){
  strict(input,['resourceId','kind','feature','task','baseCommit']);if(!oid(input.baseCommit))throw Error('Supply the exact synchronized base commit.');
  const {policy,resource,rule,workspaceId,check}=context(runtime,job,input.resourceId,'repository.branch.create',signal),destination=branchDestination(rule,job.agentId,input);
  const guard=()=>{check();policy.authorize(job,'sandbox.exec',workspaceId);permitted(policy,job,'repository.branch.create',input.resourceId,'kinds',input.kind);};guard();
  await ensureTaskWorkspace(runtime,job,workspaceId,undefined,signal);await clean(runtime,job,input.baseCommit,signal);
  if(input.kind==='task'&&!policy.gitWork.branch(resource,destination.baseBranch))throw Error('Create and register the feature branch first.');
  if(policy.gitWork.branch(resource,destination.branch))throw Error('Branch is already registered. Synchronize it instead.');
  const receipt=await runtime.gitGateway.atomic(job,input.resourceId,'repository.branch.create',{source:destination.baseBranch,sourceCommit:input.baseCommit,target:destination.branch,oldCommit:'0'.repeat(40),commit:input.baseCommit},signal,guard);
  guard();policy.gitWork.recordBranch(resource,{...destination,baseCommit:input.baseCommit,kind:input.kind,agentId:job.agentId,taskId:job.id,createdAt:new Date().toISOString()});
  await git(runtime,job,['checkout','--no-track','-b',destination.branch,input.baseCommit],signal);job.workspaceDirty=true;
  const checkpoint=await saveTaskCheckpoint(runtime,job,{resourceId:workspaceId,label:'Created '+destination.branch});return {...destination,...receipt,checkpoint};
}
function requestContext(runtime,job,input,action,signal){
  const c=context(runtime,job,input.resourceId,action,signal),request=c.policy.gitWork.get(input.requestId);
  if(request.resourceId!==input.resourceId||request.roomId!==c.room.id||request.roundId!==job.roomRoundId||request.revision!==c.revision)throw Error('Merge request belongs to another project, room round, or access policy. Prepare again.');
  runtime.store.data.assertHandoff(job,[request.taskId]);
  for(const review of request.reviews)runtime.store.data.assertHandoff(job,[review.taskId]);
  return {...c,request};
}
function evidenceFor(runtime,job,c){
  const {request,room,rule}=c;
  if(room.targetCheckpointId!==request.checkpointId)throw Error('Room checkpoint changed. Prepare and test the merge candidate again.');
  const eligible=(room.evidence||[]).filter(item=>item.resourceId===c.workspaceId&&item.checkpointId===request.checkpointId);
  const cases=room.cases||[],qa=request.transition==='feature-integration';
  const passed=eligible.filter(item=>item.status==='passed'&&item.gitCommit===request.commit&&!item.stale&&(!qa||rule.qaAgentIds.includes(item.agentId)));
  if(!passed.length||qa&&!cases.length)throw Error('Run recorded tests on the exact merge candidate; integration promotion also requires defined QA cases.');
  for(const item of cases){const latest=eligible.filter(e=>e.caseId===item.id&&e.caseRevision===item.revision).at(-1);if(!latest||latest.status!=='passed'||latest.gitCommit!==request.commit||latest.stale||qa&&!rule.qaAgentIds.includes(latest.agentId))throw Error('Every current case needs a passing candidate retest by the required test role.');}
  if(!passed.some(item=>item.id===eligible.at(-1)?.id))throw Error('Latest candidate test has not passed.');
  runtime.store.data.assertHandoff(job,[...new Set([...eligible,...cases].flatMap(item=>item.sourceTaskIds||[item.taskId]))]);
  return canonical({cases:cases.map(item=>[item.id,item.revision]),evidence:eligible.map(item=>[item.id,item.status,item.caseRevision??null])});
}
export async function mergeWork(runtime,job,input,signal){
  strict(input,['resourceId','action','requestId','source','target']);
  if(input.action==='prepare'){
    const c=context(runtime,job,input.resourceId,'repository.read',signal),{policy,resource,rule,workspaceId,room,check}=c,transition=mergeTransition(rule,input.source,input.target);
    policy.authorize(job,'sandbox.exec',workspaceId);await ensureTaskWorkspace(runtime,job,workspaceId,undefined,signal);
    const sourceRecord=policy.gitWork.branch(resource,input.source);
    if(!sourceRecord||transition==='task-feature'&&(sourceRecord.kind!=='task'||sourceRecord.agentId!==job.agentId))throw Error('Only a registered task owner can prepare its merge.');
    const session=await runtime.gitGateway.refs(job,input.resourceId,'repository.read',signal,check),sourceCommit=session.refs['refs/heads/'+input.source],targetCommit=session.refs['refs/heads/'+input.target];
    if(!oid(sourceCommit)||!oid(targetCommit))throw Error('Both remote branches must exist. Create the integration branch from the base if needed.');
    await clean(runtime,job,sourceCommit,signal);
    await git(runtime,job,['cat-file','-e',targetCommit+'^{commit}'],signal);
    if((await git(runtime,job,['merge-base',targetCommit,sourceCommit],signal)).length!==40)throw Error('Branches must share history. Synchronize target, then source before preparing.');
    const tree=(await git(runtime,job,['merge-tree','--write-tree',targetCommit,sourceCommit],signal)).split('\n')[0];if(!oid(tree))throw Error('Merge tree unavailable.');
    const commit=await git(runtime,job,['-c','user.name=Odwyn','-c','user.email=odwyn@localhost','commit-tree',tree,'-p',targetCommit,'-p',sourceCommit],signal,{input:Buffer.from(`Reviewed ${input.source} into ${input.target}\n`)});if(!oid(commit))throw Error('Merge candidate unavailable.');
    const paths=await git(runtime,job,['diff','--no-ext-diff','--no-textconv','--name-only','-z',targetCommit,commit,'--'],signal);safeChanges(paths);
    const diff=await git(runtime,job,['diff','--no-ext-diff','--no-textconv','--binary',targetCommit,commit,'--'],signal);runtime.store.connectors.assertNoSecret(Buffer.from(diff));
    check();await git(runtime,job,['checkout','--detach',commit],signal);job.workspaceDirty=true;
    const checkpoint=await saveTaskCheckpoint(runtime,job,{resourceId:workspaceId,label:`Merge candidate ${input.source} → ${input.target}`});check();
    return policy.gitWork.create({spaceId:job.spaceId,resourceId:input.resourceId,roomId:room.id,roundId:job.roomRoundId,taskId:job.id,agentId:job.agentId,revision:c.revision,transition,source:input.source,target:input.target,sourceCommit,targetCommit,commit,checkpointId:checkpoint.id,diff,createdAt:new Date().toISOString()});
  }
  const c=requestContext(runtime,job,input,input.action==='execute'?'repository.merge':'repository.read',signal),{policy,request,rule,workspaceId,check}=c;
  if(input.action==='inspect')return {...request,requiredReviewerIds:rule.reviewerIds,qaAgentIds:rule.qaAgentIds};
  if(input.action!=='execute')throw Error('Choose prepare, inspect or execute.');
  const guard=()=>{check();policy.authorize(job,'sandbox.exec',workspaceId);permitted(policy,job,'repository.merge',input.resourceId,'transitions',request.transition);const evidence=evidenceFor(runtime,job,c);for(const agentId of rule.reviewerIds){const review=policy.gitWork.get(request.id).reviews.find(item=>item.agentId===agentId);if(!review||review.decision!=='approve'||review.evidence!==evidence)throw Error('Every designated reviewer must approve the exact candidate and current test evidence.');}};
  guard();await ensureTaskWorkspace(runtime,job,workspaceId,undefined,signal);await clean(runtime,job,request.commit,signal);guard();
  policy.gitWork.claim(request.id);
  try{const receipt=await runtime.gitGateway.atomic(job,input.resourceId,'repository.merge',{source:request.source,sourceCommit:request.sourceCommit,target:request.target,oldCommit:request.targetCommit,commit:request.commit},signal,guard);policy.gitWork.finish(request.id,'succeeded');runtime.changed();return {...receipt,requestId:request.id,status:'succeeded'};}
  catch(error){policy.gitWork.finish(request.id,'indeterminate');runtime.changed();throw error;}
}
export function reviewMerge(runtime,job,input){
  strict(input,['resourceId','requestId','decision','summary']);if(!['approve','changes_requested'].includes(input.decision))throw Error('Choose approve or changes_requested.');
  const c=requestContext(runtime,job,input,'repository.review'),{rule,request,policy}=c;
  if(!rule.reviewerIds.includes(job.agentId)||request.agentId===job.agentId)throw Error('Only designated reviewers can review another agent’s candidate.');
  if(request.reviews.some(item=>item.decision==='changes_requested'))throw Error('Changes requested. Prepare a new candidate before approving.');
  const evidence=input.decision==='approve'?evidenceFor(runtime,job,c):'';
  const summary=textInput(runtime.store.connectors.redact(input.summary),2000);
  return policy.gitWork.review(request.id,{agentId:job.agentId,taskId:job.id,decision:input.decision,summary,evidence,createdAt:new Date().toISOString()});
}
