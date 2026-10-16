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
    const metadata={...input.metadata};if(!input.metadata||typeof input.metadata!=='object'||Array.isArray(input.metadata)||Object.keys(metadata).some(key=>!['sourceFolder','repositoryId'].includes(key)))throw Error('Invalid isolated workspace configuration.');
    if(metadata.sourceFolder!==undefined)metadata.sourceFolder=sourceFolder(metadata.sourceFolder);
    if(metadata.repositoryId!==undefined){const repository=policy.resource(metadata.repositoryId);if(repository.type!=='repository'||repository.grantResourceId||!repository.metadata.endpoint||repository.metadata.upstreamId)throw Error('Choose a configured Git repository.');}
    return {name:input.name.trim(),metadata};
  };
  const idle=id=>{for(const resource of linked(id))policy.assertConfigurationIdle(resource.spaceId);};
  const target=(resource,entry)=>{
    const id=entry.id,targetId=resource.id+':'+id,repository=entry.metadata.repositoryId?policy.resource(entry.metadata.repositoryId):null;
    const common={spaceId:resource.spaceId,grantResourceId:resource.id,isolatedWorkspaceId:id};
    return [{...common,id:targetId,type:'workspace',name:resource.name+' / '+entry.name,metadata:{sourceFolder:entry.metadata.sourceFolder||'isolated/'+id,...(repository?{repositoryId:targetId+':git'}:{})}},...(repository?[{...common,id:targetId+':git',type:'repository',name:resource.name+' / '+entry.name+' Git',connectionSpaceId:repository.spaceId,metadata:{...repository.metadata}}]:[])];
  };
  const targets=resource=>resource.metadata.isolatedWorkspaceIds?.flatMap(id=>target(resource,get(id)))||[resource];
  return {
    list,get,validate,linked,targets,idle,
    create(input,id=randomUUID()){const value={id,...validate(input)};db.transaction(()=>{db.query('INSERT INTO isolated_workspaces VALUES(?,?,?)').run(value.id,value.name,JSON.stringify(value.metadata));policy.touch();})();return value;},
    update(id,input){const previous=get(id),value={id,...validate(input)},changed=canonical(previous.metadata)!==canonical(value.metadata);if(changed){idle(id);if(linked(id).some(resource=>state.executionHeads?.[resource.id+':'+id]))throw Error('This isolated workspace has checkpoints. Create a new catalog entry to change its source or repository.');}db.transaction(()=>{if(changed)for(const resource of linked(id))policy.revokeResourceAccess(resource.id);db.query('UPDATE isolated_workspaces SET name=?,metadata=? WHERE id=?').run(value.name,JSON.stringify(value.metadata),id);policy.touch();})();return value;},
    delete(id){get(id);if(linked(id).length)throw Error('Unlink this isolated workspace from resources before deleting it.');db.query('DELETE FROM isolated_workspaces WHERE id=?').run(id);policy.touch();},
    resolve(id){const match=typeof id==='string'&&id.match(/^([a-f0-9-]{36}):([a-f0-9-]{36})(:git)?$/);if(!match)throw Error('Resource not found.');const group=policy.resource(match[1]);if(!group.metadata.isolatedWorkspaceIds?.includes(match[2]))throw Error('Workspace is not linked to this resource.');const result=target(group,get(match[2])).find(row=>row.id===id);if(!result)throw Error('Resource not found.');return result;},
    dependents(repositoryId){return list().filter(row=>row.metadata.repositoryId===repositoryId).flatMap(row=>linked(row.id));},
  };
}
