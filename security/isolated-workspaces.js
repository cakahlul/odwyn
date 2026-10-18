import {validateBranchPolicy} from './git-work.js';
import {randomUUID} from 'node:crypto';
import {sourceFolder} from '../execution/workspace-source.js';
import {canonical} from './approvals.js';

// Catalog entries are configuration only; every usable target inherits its Space resource's grants.
export function openIsolatedWorkspaces(db,state,policy){
  db.exec('CREATE TABLE IF NOT EXISTS isolated_workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,metadata TEXT NOT NULL)');
  const list=()=>db.query('SELECT * FROM isolated_workspaces').all().map(row=>({...row,metadata:JSON.parse(row.metadata)}));
  const get=id=>{const row=db.query('SELECT * FROM isolated_workspaces WHERE id=?').get(id);if(!row)throw Error('Isolated workspace not found.');return {...row,metadata:JSON.parse(row.metadata)};};
  const linked=id=>policy.listResources().filter(row=>row.metadata.isolatedWorkspaceIds?.includes(id));
  const validate=input=>{
    if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['name','metadata'].includes(key))||typeof input.name!=='string'||!input.name.trim()||input.name.length>200||/[\x00-\x1f\x7f]/.test(input.name))throw Error('Give the isolated workspace a name.');
    const metadata={...input.metadata};if(!input.metadata||typeof input.metadata!=='object'||Array.isArray(input.metadata)||Object.keys(metadata).some(key=>!['sourceFolder','repositoryId','repository'].includes(key)))throw Error('Invalid isolated workspace configuration.');
    if(metadata.sourceFolder!==undefined)metadata.sourceFolder=sourceFolder(metadata.sourceFolder);
    if(metadata.repository!==undefined){
      const git=metadata.repository;if(metadata.repositoryId!==undefined||!git||Array.isArray(git)||typeof git!=='object'||Object.keys(git).some(key=>!['endpoint','connectionId','gitUsername','branchPolicy'].includes(key))||typeof git.endpoint!=='string'||git.endpoint.length>2000)throw Error('Invalid Git repository configuration.');
      if(git.branchPolicy!==undefined)git.branchPolicy=validateBranchPolicy(git.branchPolicy,state);
      const url=new URL(git.endpoint);if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||url.hostname.includes('*'))throw Error('Use an exact credential-free Git HTTPS URL.');
      if(git.gitUsername!==undefined&&(typeof git.gitUsername!=='string'||!git.gitUsername||git.gitUsername.length>100||/[:\x00-\x20\x7f]/.test(git.gitUsername)))throw Error('Use a Git HTTPS username without spaces or colons.');
      if(git.connectionId!==undefined&&!db.query("SELECT id FROM connectors WHERE id=? AND type='git-https-v1' AND endpoint=? AND enabled=1").get(git.connectionId,git.endpoint))throw Error('Choose an enabled Git connection matching this exact repository URL.');
    }
    if(metadata.repositoryId!==undefined){const repository=policy.resource(metadata.repositoryId);if(repository.type!=='repository'||repository.grantResourceId||!repository.metadata.endpoint||repository.metadata.upstreamId)throw Error('Choose a configured Git repository.');}
    return {name:input.name.trim(),metadata};
  };
  const repositoryConfig=metadata=>{const config=metadata.repository||(metadata.repositoryId?policy.resource(metadata.repositoryId).metadata:null);if(!config)return null;const {branchPolicy,...identity}=config;return identity;};
  const idle=id=>{for(const resource of linked(id))policy.assertConfigurationIdle(resource.spaceId);};
  const target=(resource,entry)=>{
    const id=entry.id,targetId=resource.id+':'+id,repository=entry.metadata.repository?{metadata:entry.metadata.repository,spaceId:entry.metadata.repository.connectionId?db.query('SELECT space_id FROM connectors WHERE id=?').get(entry.metadata.repository.connectionId)?.space_id:null}:entry.metadata.repositoryId?policy.resource(entry.metadata.repositoryId):null;
    const common={spaceId:resource.spaceId,grantResourceId:resource.id,isolatedWorkspaceId:id};
    return [{...common,id:targetId,type:'workspace',name:resource.name+' / '+entry.name,metadata:{sourceFolder:entry.metadata.sourceFolder||'isolated/'+id,...(repository?{repositoryId:targetId+':git'}:{})}},...(repository?[{...common,id:targetId+':git',type:'repository',name:resource.name+' / '+entry.name+' Git',connectionSpaceId:repository.spaceId,legacyRepository:!!entry.metadata.repositoryId,metadata:{...repository.metadata}}]:[])];
  };
  const targets=resource=>resource.metadata.isolatedWorkspaceIds?.flatMap(id=>target(resource,get(id)))||[resource];
  return {
    list,get,validate,linked,targets,idle,
    create(input,id=randomUUID()){const value={id,...validate(input)};db.transaction(()=>{db.query('INSERT INTO isolated_workspaces VALUES(?,?,?)').run(value.id,value.name,JSON.stringify(value.metadata));policy.touch();})();return value;},
    update(id,input){const previous=get(id),value={id,...validate(input)},changed=canonical(previous.metadata)!==canonical(value.metadata);if(changed){idle(id);if(((previous.metadata.sourceFolder||'isolated/'+id)!==(value.metadata.sourceFolder||'isolated/'+id)||repositoryConfig(previous.metadata)&&canonical(repositoryConfig(previous.metadata))!==canonical(repositoryConfig(value.metadata)))&&linked(id).some(resource=>state.executionHeads?.[resource.id+':'+id]))throw Error('This isolated workspace has checkpoints. Create a new catalog entry to change its source or repository.');}db.transaction(()=>{db.query('UPDATE isolated_workspaces SET name=?,metadata=? WHERE id=?').run(value.name,JSON.stringify(value.metadata),id);if(changed)for(const resource of linked(id))policy.revokeResourceAccess(resource.id);policy.touch();})();return value;},
    delete(id){get(id);if(linked(id).length)throw Error('Unlink this isolated workspace from resources before deleting it.');db.query('DELETE FROM isolated_workspaces WHERE id=?').run(id);policy.touch();},
    resolve(id){const match=typeof id==='string'&&id.match(/^([a-f0-9-]{36}):([a-f0-9-]{36})(:git)?$/);if(!match)throw Error('Resource not found.');const group=policy.resource(match[1]);if(!group.metadata.isolatedWorkspaceIds?.includes(match[2]))throw Error('Workspace is not linked to this resource.');const result=target(group,get(match[2])).find(row=>row.id===id);if(!result)throw Error('Resource not found.');return result;},
    connectionDependents(connectionId){return list().filter(row=>row.metadata.repository?.connectionId===connectionId).flatMap(row=>linked(row.id));},
    connectionEntries(connectionId){return list().filter(row=>row.metadata.repository?.connectionId===connectionId);},
    updateConnectionEndpoint(connectionId,endpoint){for(const entry of list().filter(row=>row.metadata.repository?.connectionId===connectionId))db.query('UPDATE isolated_workspaces SET metadata=? WHERE id=?').run(JSON.stringify({...entry.metadata,repository:{...entry.metadata.repository,endpoint}}),entry.id);},
    dependents(repositoryId){return list().filter(row=>row.metadata.repositoryId===repositoryId).flatMap(row=>linked(row.id));},
  };
}
