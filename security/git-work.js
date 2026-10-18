import {randomUUID} from 'node:crypto';

export const gitBranch=value=>typeof value==='string'&&value.length<=200&&value!=='HEAD'&&!value.includes('..')&&value.split('/').every(part=>/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(part)&&!part.endsWith('.')&&!part.endsWith('.lock'));
export function validateBranchPolicy(input,state){
  if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['baseBranch','featurePrefix','taskPrefix','integrationBranch','reviewerIds','qaAgentIds'].includes(key)))throw Error('Invalid reviewed branch policy.');
  for(const key of ['baseBranch','integrationBranch'])if(!gitBranch(input[key]))throw Error('Choose exact base and integration branches.');
  for(const key of ['featurePrefix','taskPrefix'])if(typeof input[key]!=='string'||!input[key].endsWith('/')||!gitBranch(input[key].slice(0,-1)))throw Error('Feature and task prefixes must end in /.');
  if(input.baseBranch===input.integrationBranch||input.featurePrefix.startsWith(input.taskPrefix)||input.taskPrefix.startsWith(input.featurePrefix)||[input.baseBranch,input.integrationBranch].some(branch=>branch.startsWith(input.featurePrefix)||branch.startsWith(input.taskPrefix))||/^(main|master|release)(\/|$)/i.test(input.integrationBranch))throw Error('Keep base, integration, feature and task branch namespaces separate.');
  for(const key of ['reviewerIds','qaAgentIds'])if(!Array.isArray(input[key])||!input[key].length||input[key].length>5||new Set(input[key]).size!==input[key].length||input[key].some(id=>!state.agents.some(agent=>agent.id===id)))throw Error('Choose existing required reviewers and QA agents.');
  return structuredClone(input);
}
export function branchDestination(rule,agentId,input){
  if(!['feature','task','integration'].includes(input.kind)||typeof input.feature!=='string'||!gitBranch(input.feature)||input.feature.includes('/'))throw Error('Choose a branch kind and a single feature identifier.');
  if(input.kind==='task'&&(!gitBranch(input.task)||input.task.includes('/')))throw Error('Choose a single task identifier.');
  const branch=input.kind==='feature'?rule.featurePrefix+input.feature:input.kind==='task'?rule.taskPrefix+input.feature+'/'+agentId+'/'+input.task:rule.integrationBranch;
  if(!gitBranch(branch))throw Error('Branch name exceeds supported bounds.');
  return {branch,baseBranch:input.kind==='task'?rule.featurePrefix+input.feature:rule.baseBranch};
}
export function mergeTransition(rule,source,target){
  if(!gitBranch(source)||!gitBranch(target))throw Error('Choose exact source and target branches.');
  if(source.startsWith(rule.taskPrefix)){const parts=source.slice(rule.taskPrefix.length).split('/');if(parts.length===3&&target===rule.featurePrefix+parts[0])return 'task-feature';}
  if(source.startsWith(rule.featurePrefix)&&!source.slice(rule.featurePrefix.length).includes('/')&&target===rule.integrationBranch)return 'feature-integration';
  throw Error('Merge direction is outside the configured branch workflow.');
}
export function openGitWork(db){
  db.exec(`CREATE TABLE IF NOT EXISTS git_work_branches(project_id TEXT NOT NULL,endpoint TEXT NOT NULL,branch TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project_id,endpoint,branch));
    CREATE TABLE IF NOT EXISTS git_merge_requests(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,resource_id TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS git_merge_reviews(request_id TEXT NOT NULL,agent_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(request_id,agent_id));`);
  db.query("UPDATE git_merge_requests SET status='indeterminate' WHERE status='executing'").run();
  const get=id=>{const row=db.query('SELECT * FROM git_merge_requests WHERE id=?').get(id);if(!row)throw Error('Merge request not found.');return {...JSON.parse(row.payload),id:row.id,status:row.status,reviews:db.query('SELECT payload FROM git_merge_reviews WHERE request_id=?').all(id).map(row=>JSON.parse(row.payload))};};
  return {
    branch(resource,branch){if(!resource.isolatedWorkspaceId)return null;const row=db.query('SELECT payload FROM git_work_branches WHERE project_id=? AND endpoint=? AND branch=?').get(resource.isolatedWorkspaceId,resource.metadata.endpoint,branch);return row?JSON.parse(row.payload):null;},
    recordBranch(resource,value){db.query('INSERT INTO git_work_branches VALUES(?,?,?,?)').run(resource.isolatedWorkspaceId,resource.metadata.endpoint,value.branch,JSON.stringify(value));},
    create(value){const id=randomUUID();db.query("INSERT INTO git_merge_requests VALUES(?,?,?,'pending',?)").run(id,value.spaceId,value.resourceId,JSON.stringify({...value,id}));return get(id);},
    get,
    review(id,value){const request=get(id);if(request.status!=='pending')throw Error('This merge request is no longer reviewable.');db.query('INSERT INTO git_merge_reviews VALUES(?,?,?) ON CONFLICT(request_id,agent_id) DO UPDATE SET payload=excluded.payload').run(id,value.agentId,JSON.stringify(value));return get(id);},
    claim(id){const changed=db.query("UPDATE git_merge_requests SET status='executing' WHERE id=? AND status='pending'").run(id);if(changed.changes!==1)throw Error('Merge request already consumed or unavailable.');},
    finish(id,status){db.query("UPDATE git_merge_requests SET status=? WHERE id=? AND status='executing'").run(status,id);},
    list(spaceId){return db.query('SELECT id FROM git_merge_requests WHERE space_id=? ORDER BY rowid DESC LIMIT 50').all(spaceId).map(row=>get(row.id));},
  };
}
