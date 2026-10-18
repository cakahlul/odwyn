import {openGitWork} from './git-work.js';
import {openIsolatedWorkspaces} from './isolated-workspaces.js';
import {securityBackup} from './migration.js';
import { randomUUID } from 'node:crypto';
import { taskSecurityContext } from './task-context.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {sourceFolder} from '../execution/workspace-source.js';
import {canonical} from './approvals.js';
import {blockedDomain} from './browser-scope.js';
export const approvalActions=['payment.execute','message.send','repository.merge','deployment.production'];

export const statePolicy = Symbol('server policy');
// Unavailable capabilities remain denied even with a grant or legacy allow mode.
export const capabilities = Object.freeze(Object.fromEntries([
  ['knowledge.read','knowledge',true], ['memory.read','memory',true], ['memory.write','memory',true],
  ['repository.branch.create','repository',false], ['repository.review','repository',true], ['repository.read','repository',true], ['repository.branch.push','repository',false], ['repository.merge','repository',false],
  ['workspace.read','workspace',true], ['sandbox.exec','workspace',false], ['filesystem.read','file',false], ['filesystem.write','file',false],
  ['file.download','file',true], ['browser.read','browser',false], ['browser.navigate','browser',false], ['browser.interact','browser',false],
  ['mcp.invoke','connector',true], ['routine.create','routine',false], ['room.share','room',false],
  ['payment.execute','payment',false], ['message.send','destination',false], ['deployment.production','environment',false],
].map(([action,resourceType,available])=>[action,Object.freeze({action,resourceType,available})])));

const id = value => { if(typeof value!=='string'||!value||value.length>200||/[\x00-\x1f\x7f]/.test(value))throw new Error('Invalid security identifier.');return value; };
const name = value => {id(value); if(!value.trim())throw new Error('Name required.');return value.trim();};
const strict = (input,keys) => {if(!input || Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!keys.includes(k)))throw new Error('Unsupported policy fields.');};

export function openPolicy(db,state,directory) {
  const migrating=!db.query("SELECT name FROM sqlite_master WHERE name='security_meta'").get();
  if (migrating) {
    // VACUUM includes committed WAL content; backup precedes the atomic schema migration.
    securityBackup(db,directory,'pre-security-');
    db.transaction(()=>{
      db.exec(`
        CREATE TABLE security_meta(id INTEGER PRIMARY KEY CHECK(id=1),owner_id TEXT NOT NULL,legacy_space TEXT NOT NULL,revision INTEGER NOT NULL);
        CREATE TABLE spaces(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,name TEXT NOT NULL);
        CREATE TABLE resources(id TEXT PRIMARY KEY,space_id TEXT NOT NULL REFERENCES spaces(id),type TEXT NOT NULL,name TEXT NOT NULL,metadata TEXT NOT NULL);
        CREATE TABLE memberships(agent_id TEXT NOT NULL,space_id TEXT NOT NULL REFERENCES spaces(id),PRIMARY KEY(agent_id,space_id));
        CREATE TABLE grants(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL,space_id TEXT NOT NULL REFERENCES spaces(id),resource_id TEXT NOT NULL,action TEXT NOT NULL,mode TEXT NOT NULL,expires_at TEXT,constraints TEXT NOT NULL DEFAULT '{}');
        CREATE INDEX grants_subject ON grants(agent_id,space_id,action,resource_id);
        CREATE TABLE task_security_contexts(task_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,agent_id TEXT NOT NULL,space_id TEXT NOT NULL REFERENCES spaces(id),policy_revision INTEGER NOT NULL);
        CREATE TABLE security_events(id TEXT PRIMARY KEY,at TEXT NOT NULL,task_id TEXT,agent_id TEXT,space_id TEXT,resource_id TEXT,action TEXT NOT NULL,mode TEXT NOT NULL,reason TEXT NOT NULL);
      `);
      const owner=randomUUID(),legacy=randomUUID();
      db.query('INSERT INTO spaces VALUES(?,?,?)').run(legacy,owner,'Legacy Workspace');
      db.query('INSERT INTO security_meta VALUES(1,?,?,0)').run(owner,legacy);
    })();
  }
  db.exec('PRAGMA foreign_keys=ON');
  if(!db.query('PRAGMA table_info(grants)').all().some(c=>c.name==='constraints')) {
    securityBackup(db,directory,'pre-security-');
    db.transaction(()=>db.exec("ALTER TABLE grants ADD COLUMN constraints TEXT NOT NULL DEFAULT '{}'"))();
  }
  let execution=false,browserExecution=false;
  const approved=new AsyncLocalStorage();let redact=text=>text;
  const meta=()=>db.query('SELECT * FROM security_meta WHERE id=1').get();
  const agent=agentId=>{id(agentId);if(!state.agents.some(a=>a.id===agentId))throw new Error('Agent not found.');};
  const space=spaceId=>{id(spaceId);const value=db.query('SELECT * FROM spaces WHERE id=? AND owner_id=?').get(spaceId,meta().owner_id);if(!value)throw new Error('Space not found.');return value;};
  const member=(agentId,spaceId)=>{agent(agentId);space(spaceId);return spaceId===meta().legacy_space || !!db.query('SELECT 1 FROM memberships WHERE agent_id=? AND space_id=?').get(agentId,spaceId);};
  const bump=()=>db.query('UPDATE security_meta SET revision=revision+1 WHERE id=1').run();
  const events=(request,result)=>db.query('INSERT INTO security_events VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),new Date().toISOString(),request.taskId || null,request.agentId || null,request.spaceId || null,request.resourceId || null,redact(request.action || 'unknown'),result.mode,redact(result.reason));
  const resourceValue=input=>{
      strict(input,['spaceId','type','name','metadata']);space(input.spaceId);
      if(!Object.values(capabilities).some(c=>c.resourceType===input.type))throw new Error('Unknown resource type.');
      const metadata=input.metadata || {};strict(metadata,input.type==='repository'?['endpoint','connectionId','upstreamId','gitUsername']:input.type==='workspace'?['sourceFolder','repositoryId','isolatedWorkspaceIds']:input.type==='knowledge'?['version']:input.type==='file'?['path','workspaceId']:input.type==='browser'?['readUrls','blockedDomains']:['connector','payment','destination','environment'].includes(input.type)?['connectionId','upstreamId']:[]);
      if(['payment','destination','environment'].includes(input.type)||input.type==='repository'&&metadata.upstreamId!==undefined){id(metadata.connectionId);id(metadata.upstreamId);if(!db.query("SELECT id FROM connectors WHERE id=? AND space_id=? AND type='action-gateway-v1' AND enabled=1").get(metadata.connectionId,input.spaceId))throw new Error('Reviewed action connection scope mismatch.');}
      else if(input.type==='repository'&&metadata.connectionId!==undefined){id(metadata.connectionId);if(!db.query("SELECT id FROM connectors WHERE id=? AND space_id=? AND type='git-https-v1' AND endpoint=? AND enabled=1").get(metadata.connectionId,input.spaceId,metadata.endpoint))throw new Error('Git connection scope mismatch.');}
      if(input.type==='knowledge'&&(!Number.isSafeInteger(metadata.version)||metadata.version<1))throw new Error('Knowledge needs a valid version.');
      if(metadata.gitUsername!==undefined&&(typeof metadata.gitUsername!=='string'||!metadata.gitUsername.length||metadata.gitUsername.length>100||/[:\x00-\x20\x7f]/.test(metadata.gitUsername)))throw new Error('Use a Git HTTPS username without spaces or colons.');
      if(metadata.isolatedWorkspaceIds!==undefined){if(input.type!=='workspace'||Object.keys(metadata).length!==1||!Array.isArray(metadata.isolatedWorkspaceIds)||!metadata.isolatedWorkspaceIds.length||metadata.isolatedWorkspaceIds.length>20||new Set(metadata.isolatedWorkspaceIds).size!==metadata.isolatedWorkspaceIds.length)throw Error('Select 1 to 20 distinct isolated workspaces.');for(const value of metadata.isolatedWorkspaceIds)policy.isolatedWorkspaces.get(value);}
      if(metadata.repositoryId!==undefined){id(metadata.repositoryId);const repository=policy.resource(metadata.repositoryId);if(input.type!=='workspace'||repository.type!=='repository'||repository.grantResourceId||repository.spaceId!==input.spaceId||!repository.metadata.endpoint||repository.metadata.upstreamId)throw new Error('Choose a Git repository in the same Space.');}
      if(metadata.sourceFolder!==undefined)metadata.sourceFolder=sourceFolder(metadata.sourceFolder);
      if(metadata.workspaceId!==undefined){id(metadata.workspaceId);const workspace=policy.resource(metadata.workspaceId);if(workspace.type!=='workspace'||workspace.spaceId!==input.spaceId||workspace.metadata.isolatedWorkspaceIds)throw new Error('File workspace outside Space or project target not selected.');}
      if(input.type==='browser'&&metadata.blockedDomains!==undefined){if(metadata.readUrls!==undefined||!Array.isArray(metadata.blockedDomains)||metadata.blockedDomains.length>100)throw new Error('Choose blocked domains or an existing URL allowlist, not both. Maximum 100 blocked domains.');metadata.blockedDomains=[...new Set(metadata.blockedDomains.map(blockedDomain))];}
      if(input.type==='browser'&&metadata.readUrls!==undefined){if(!Array.isArray(metadata.readUrls)||!metadata.readUrls.length||metadata.readUrls.length>20)throw new Error('Use bounded reviewed read-only URLs.');for(const raw of metadata.readUrls){id(raw);const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.href!==raw)throw new Error('Use exact credential-free HTTPS read URLs.');}}
      if(input.type==='connector'&&Object.keys(metadata).length){id(metadata.connectionId);id(metadata.upstreamId);if(!db.query("SELECT id FROM connectors WHERE id=? AND space_id=? AND type='mcp-document-v1' AND enabled=1").get(metadata.connectionId,input.spaceId))throw new Error('Connection outside resource Space or MCP manifest.');}
      if(metadata.endpoint!==undefined){
        id(metadata.endpoint);const url=new URL(metadata.endpoint);
        if(url.protocol!=='https:'||url.username||url.password||url.hash||url.hostname.includes('*'))throw new Error('Use an exact credential-free HTTPS repository endpoint.');
      }
      if(metadata.path!==undefined){id(metadata.path);if(metadata.path.includes('/')||metadata.path.includes('\\')||metadata.path.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Use an exact relative workspace file path.');}
    return {spaceId:input.spaceId,type:input.type,name:name(input.name),metadata};
  };
  const idle=spaceId=>{if(state.jobs.some(j=>j.spaceId===spaceId&&['queued','running','waiting','takeover','stopping'].includes(j.status)))throw new Error('Stop tasks in this Space before changing resource or connection configuration.');};
  const policy={
    configureRedactor(fn){redact=fn;},
    get revision(){return meta().revision;}, get ownerId(){return meta().owner_id;},get legacySpaceId(){return meta().legacy_space;},
    defaultSpace(agentId){return db.query('SELECT default_space FROM agent_security_settings WHERE agent_id=?').get(agentId)?.default_space||policy.legacySpaceId;},
    isPaused(agentId,spaceId){return !!db.query("SELECT 1 FROM security_pauses WHERE scope='all' OR scope='agent' AND id=? OR scope='space' AND id=?").get(agentId,spaceId);},
    pause(input){strict(input,['scope','id','paused']);if(!['all','agent','space'].includes(input.scope)||typeof input.paused!=='boolean')throw new Error('Invalid pause scope.');if(input.scope==='agent')agent(input.id);if(input.scope==='space')space(input.id);const value=input.scope==='all'?'all':input.id;db.transaction(()=>{if(input.paused)db.query('INSERT OR IGNORE INTO security_pauses VALUES(?,?)').run(input.scope,value);else db.query('DELETE FROM security_pauses WHERE scope=? AND id=?').run(input.scope,value);bump();events({action:'automation.pause',agentId:input.scope==='agent'?value:null,spaceId:input.scope==='space'?value:null},{mode:'deny',reason:input.paused?'Owner paused automation.':'Owner resumed automation.'});})();return {scope:input.scope,id:value,paused:input.paused};},
    presets(){return db.query('SELECT name,actions FROM security_presets').all().map(r=>({...r,actions:JSON.parse(r.actions)}));},
    putPreset(input){strict(input,['name','actions','previousName']);const value=name(input.name);if(!Array.isArray(input.actions)||input.actions.length>30||input.actions.some(a=>!Object.hasOwn(capabilities,a)))throw new Error('Unknown preset actions.');if(input.previousName!==undefined){name(input.previousName);if(!policy.presets().some(p=>p.name===input.previousName))throw new Error('Template not found.');if(value!==input.previousName&&policy.presets().some(p=>p.name===value))throw new Error('Template name already exists.');}db.transaction(()=>{if(input.previousName!==undefined&&input.previousName!==value)db.query('DELETE FROM security_presets WHERE name=?').run(input.previousName);db.query('INSERT INTO security_presets VALUES(?,?) ON CONFLICT(name) DO UPDATE SET actions=excluded.actions').run(value,JSON.stringify([...new Set(input.actions)]));})();return policy.presets();},
    deletePreset(value){name(value);if(!policy.presets().some(p=>p.name===value))throw new Error('Template not found.');db.query('DELETE FROM security_presets WHERE name=?').run(value);},
    listResources(){return db.query('SELECT id FROM resources').all().map(r=>policy.resource(r.id));},
    audit(){return db.query('SELECT id,at,task_id AS taskId,agent_id AS agentId,space_id AS spaceId,resource_id AS resourceId,action,mode,reason FROM security_events ORDER BY rowid DESC LIMIT 100').all();},
    taskLive(id){return state.jobs.some(j=>j.id===id&&['running','waiting','takeover'].includes(j.status));},
    approvalScope(){return approved.getStore();},
    withApproval(scope,run){return approved.run(Object.freeze(scope),run);},
    approved(job,action,resourceId){const a=approved.getStore();return !!a&&a.taskId===job.id&&a.action===action&&a.resourceId===resourceId&&a.revision===policy.revision&&a.expiresAt>Date.now();},
    auditApproval(job,action,resourceId,mode,reason){const c=policy.identity(job);events({...c,action,resourceId},{mode,reason});},
    // Native profile isolation does not contain the browser host process.
    configureBrowser(available){browserExecution=available===true;},
    configureExecution(available){execution=available===true;},
    touch(){bump();},
    auditOwner(action,spaceId,reason){space(spaceId);events({action,spaceId},{mode:'deny',reason});},
    branchPolicies(endpoint){return policy.isolatedWorkspaces.list().filter(entry=>(!endpoint||entry.metadata.repository?.endpoint===endpoint)&&entry.metadata.repository?.branchPolicy).map(entry=>({projectId:entry.id,...entry.metadata.repository.branchPolicy}));},
    reviewed(resource){return resource.metadata.branchPolicy||resource.metadata.isolatedWorkspaceIds?.some(id=>policy.isolatedWorkspaces.get(id).metadata.repository?.branchPolicy);},
    actions(resource){return Object.values(capabilities).filter(c=>c.resourceType===resource.type||resource.type==='workspace'&&c.resourceType==='repository'&&resource.metadata.isolatedWorkspaceIds?.some(id=>{const entry=policy.isolatedWorkspaces.get(id);return entry.metadata.repository||entry.metadata.repositoryId;}));},
    catalog(){return Object.values(capabilities).map(c=>({...c,requiresApproval:approvalActions.includes(c.action),available:c.available||browserExecution&&['browser.read','browser.navigate','browser.interact'].includes(c.action)||execution&&['sandbox.exec','repository.branch.push','repository.branch.create','repository.merge'].includes(c.action)||approvalActions.includes(c.action)&&!!db.query("SELECT id FROM connectors WHERE type='action-gateway-v1' AND enabled=1 LIMIT 1").get()}));},
    listSpaces(){return db.query('SELECT id,name FROM spaces WHERE owner_id=?').all(meta().owner_id);},
    createSpace(input){strict(input,['name']);const value={id:randomUUID(),name:name(input.name)};db.transaction(()=>{db.query('INSERT INTO spaces VALUES(?,?,?)').run(value.id,meta().owner_id,value.name);bump();})();return value;},
    validateResource(input){return resourceValue(input);},
    createResource(input,resourceId=randomUUID()){
      id(resourceId);const value={id:resourceId,...resourceValue(input)};
      db.transaction(()=>{db.query('INSERT INTO resources VALUES(?,?,?,?,?)').run(value.id,value.spaceId,value.type,value.name,JSON.stringify(value.metadata));bump();})();return value;
    },
    updateSpace(spaceId,input){strict(input,['name']);space(spaceId);const value={id:spaceId,name:name(input.name)};db.transaction(()=>{db.query('UPDATE spaces SET name=? WHERE id=?').run(value.name,spaceId);bump();events({action:'space.update',spaceId},{mode:'deny',reason:'Owner renamed Space.'});})();return value;},
    deleteSpace(spaceId){
      space(spaceId);if(spaceId===policy.legacySpaceId)throw new Error('The default Workspace Space cannot be deleted.');
      if(db.query('SELECT 1 FROM resources WHERE space_id=?').get(spaceId)||db.query('SELECT 1 FROM connectors WHERE space_id=?').get(spaceId))throw new Error('Delete resources and connections in this Space first.');
      if(db.query('SELECT 1 FROM task_security_contexts WHERE space_id=?').get(spaceId)||state.conversations.some(c=>c.spaceId===spaceId)||state.jobs.some(j=>j.spaceId===spaceId)||state.schedules.some(r=>r.spaceId===spaceId)||db.query('SELECT 1 FROM classified_files WHERE space_id=?').get(spaceId)||db.query('SELECT 1 FROM data_exports WHERE destination_space=?').get(spaceId))throw new Error('This Space is referenced by history, files, exports or routines and cannot be deleted.');
      db.transaction(()=>{events({action:'space.delete',spaceId},{mode:'deny',reason:'Owner deleted empty Space; memberships and grants revoked.'});db.query('DELETE FROM grants WHERE space_id=?').run(spaceId);db.query('DELETE FROM memberships WHERE space_id=?').run(spaceId);db.query('DELETE FROM agent_security_settings WHERE default_space=?').run(spaceId);db.query("DELETE FROM security_pauses WHERE scope='space' AND id=?").run(spaceId);db.query('DELETE FROM spaces WHERE id=?').run(spaceId);bump();})();
    },
    assertConfigurationIdle:idle,
    revokeResourceAccess(resourceId){
      for(const linked of policy.isolatedWorkspaces.dependents(resourceId))policy.revokeResourceAccess(linked.id);
      const r=policy.resource(resourceId);
      db.query("UPDATE grants SET mode='deny',expires_at=NULL,constraints='{}' WHERE resource_id=?").run(resourceId);
      const wildcards=db.query("SELECT DISTINCT agent_id,action FROM grants WHERE space_id=? AND resource_id='*' AND mode!='deny'").all(r.spaceId);
      for(const g of wildcards)if(policy.actions(r).some(c=>c.action===g.action)&&!db.query('SELECT 1 FROM grants WHERE agent_id=? AND resource_id=? AND action=?').get(g.agent_id,resourceId,g.action))db.query("INSERT INTO grants VALUES(?,?,?,?,?,'deny',NULL,'{}')").run(randomUUID(),g.agent_id,r.spaceId,resourceId,g.action);
    },
    updateResource(resourceId,input){
      strict(input,['name','metadata']);const previous=policy.resource(resourceId),metadata=Object.hasOwn(input,'metadata')?input.metadata:previous.metadata;
      const changed=canonical(metadata)!==canonical(previous.metadata);
      const value={id:resourceId,...(changed?resourceValue({spaceId:previous.spaceId,type:previous.type,name:Object.hasOwn(input,'name')?input.name:previous.name,metadata}):{...previous,name:name(Object.hasOwn(input,'name')?input.name:previous.name)})};if(changed){idle(previous.spaceId);for(const linked of policy.isolatedWorkspaces.dependents(resourceId))idle(linked.spaceId);}
      db.transaction(()=>{db.query('UPDATE resources SET name=?,metadata=? WHERE id=?').run(value.name,JSON.stringify(value.metadata),resourceId);if(changed)policy.revokeResourceAccess(resourceId);bump();events({action:'resource.update',spaceId:value.spaceId,resourceId},{mode:'deny',reason:changed?'Owner changed configuration; resource access revoked for review.':'Owner renamed resource.'});})();return value;
    },
    deleteResource(resourceId){
      const r=policy.resource(resourceId);idle(r.spaceId);
      if(policy.isolatedWorkspaces.list().some(row=>row.metadata.repositoryId===resourceId))throw Error('Unlink catalog workspaces using this repository first.');
      if(policy.listResources().some(other=>(other.metadata.workspaceId===resourceId||other.metadata.workspaceId?.startsWith(resourceId+':'))||other.metadata.repositoryId===resourceId))throw new Error('Delete or unlink resources using this target first.');
      db.transaction(()=>{db.query('DELETE FROM grants WHERE resource_id=?').run(resourceId);db.query('DELETE FROM resources WHERE id=?').run(resourceId);bump();events({action:'resource.delete',spaceId:r.spaceId,resourceId},{mode:'deny',reason:'Owner deleted resource and revoked its access; history preserved.'});})();
    },
    resource(resourceId){id(resourceId);const row=db.query('SELECT * FROM resources WHERE id=?').get(resourceId);if(!row)return policy.isolatedWorkspaces.resolve(resourceId);return {id:row.id,spaceId:row.space_id,type:row.type,name:row.name,metadata:JSON.parse(row.metadata)};},
    access(agentId){agent(agentId);return {schemaVersion:1,revision:policy.revision,defaultSpaceId:policy.defaultSpace(agentId),spaceIds:db.query('SELECT space_id AS spaceId FROM memberships WHERE agent_id=?').all(agentId).map(r=>r.spaceId),grants:db.query('SELECT id,space_id AS spaceId,resource_id AS resourceId,action,mode,expires_at AS expiresAt,constraints FROM grants WHERE agent_id=?').all(agentId).map(g=>({...g,constraints:JSON.parse(g.constraints)}))};},
    preview(agentId,input){db.exec('SAVEPOINT policy_preview');try{policy.putAccess(agentId,input);return {decisions:policy.listResources().filter(r=>input.spaceIds.includes(r.spaceId)).flatMap(r=>policy.actions(r).map(c=>({resourceId:r.id,action:c.action,...policy.simulate({agentId,spaceId:r.spaceId,resourceId:r.id,action:c.action})})))};}finally{db.exec('ROLLBACK TO policy_preview; RELEASE policy_preview');}},
    putAccess(agentId,input){
      agent(agentId);strict(input,['schemaVersion','revision','spaceIds','grants','confirmWildcard','defaultSpaceId']);
      if(input.schemaVersion!==undefined&&input.schemaVersion!==1)throw new Error('Unsupported policy version.');
      if(!Number.isSafeInteger(input.revision)||input.revision!==policy.revision)throw new Error('Stale policy revision.');
      if(!Array.isArray(input.spaceIds)||new Set(input.spaceIds).size!==input.spaceIds.length||input.spaceIds.length>1000||!Array.isArray(input.grants)||input.grants.length>1000)throw new Error('Invalid access policy.');
      input.spaceIds.forEach(space);
      if(input.defaultSpaceId!==undefined&&!input.spaceIds.includes(input.defaultSpaceId)&&input.defaultSpaceId!==policy.legacySpaceId)throw new Error('Default Space must be assigned.');
      const grants=input.grants.map(g=>{
        strict(g,['spaceId','resourceId','action','mode','constraints','expiresAt']);
        if(!input.spaceIds.includes(g.spaceId)||!Object.hasOwn(capabilities,g.action)||!['deny','auto','ask'].includes(g.mode))throw new Error('Invalid grant.');
        strict(g.constraints || {},g.action==='repository.branch.push'?['branchPrefixes','forbiddenRefs','denyWorkflowChanges']:g.action==='repository.branch.create'?['kinds']:g.action==='repository.merge'?['transitions']:[]);
        if(g.action==='repository.branch.push') {
          for(const key of ['branchPrefixes','forbiddenRefs'])if(g.constraints?.[key]!==undefined&&(!Array.isArray(g.constraints[key])||g.constraints[key].length>20||g.constraints[key].some(v=>typeof v!=='string'||!v||v.length>100||!/^[A-Za-z0-9_./*-]+$/.test(v))))throw new Error('Invalid Git ref constraint.');
          if(g.constraints?.branchPrefixes?.some(v=>!v.endsWith('/')||v.includes('*')||v.includes('..')))throw new Error('Use exact branch prefixes.');
          if(g.constraints?.denyWorkflowChanges!==undefined&&g.constraints.denyWorkflowChanges!==true)throw new Error('CI changes require owner approval.');
        }
        if(g.action==='repository.branch.create'&&g.constraints?.kinds!==undefined&&(!Array.isArray(g.constraints.kinds)||!g.constraints.kinds.length||g.constraints.kinds.some(kind=>!['feature','task','integration'].includes(kind))))throw Error('Choose permitted branch creation kinds.');
        if(g.action==='repository.merge'&&g.constraints?.transitions!==undefined&&(!Array.isArray(g.constraints.transitions)||!g.constraints.transitions.length||g.constraints.transitions.some(kind=>!['task-feature','feature-integration'].includes(kind))))throw Error('Choose permitted merge directions.');
        if(g.resourceId==='*'){if(g.mode!=='deny'&&input.confirmWildcard!==true)throw new Error('Confirm wildcard access explicitly.');}
        else {id(g.resourceId);const r=db.query('SELECT * FROM resources WHERE id=? AND space_id=?').get(g.resourceId,g.spaceId);if(!r||!(policy.actions({type:r.type,metadata:JSON.parse(r.metadata)}).some(c=>c.action===g.action)||g.mode==='deny'&&r.type==='workspace'&&JSON.parse(r.metadata).isolatedWorkspaceIds&&capabilities[g.action].resourceType==='repository'))throw new Error('Resource/action mismatch.');}
        if(g.expiresAt!==undefined&&(!Number.isFinite(Date.parse(g.expiresAt))||typeof g.expiresAt!=='string'))throw new Error('Invalid grant expiry.');
        return g;
      });
      db.transaction(()=>{
        if(input.revision!==policy.revision)throw new Error('Stale policy revision.');
        db.query('DELETE FROM grants WHERE agent_id=?').run(agentId);db.query('DELETE FROM memberships WHERE agent_id=?').run(agentId);
        if(input.defaultSpaceId!==undefined)db.query('INSERT INTO agent_security_settings VALUES(?,?) ON CONFLICT(agent_id) DO UPDATE SET default_space=excluded.default_space').run(agentId,input.defaultSpaceId);
        else if(!input.spaceIds.includes(policy.defaultSpace(agentId)))db.query('DELETE FROM agent_security_settings WHERE agent_id=?').run(agentId);
        for(const s of input.spaceIds)db.query('INSERT INTO memberships VALUES(?,?)').run(agentId,s);
        for(const g of grants)db.query('INSERT INTO grants VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),agentId,g.spaceId,g.resourceId,g.action,g.mode,g.expiresAt || null,JSON.stringify(g.constraints||{}));
        bump();
      })();return policy.access(agentId);
    },
    visible(agentId,spaceId){if(!member(agentId,spaceId))throw new Error('Space membership denied.');if(policy.isPaused(agentId,spaceId))throw new Error('Automation paused by owner.');return {space:{id:spaceId,name:space(spaceId).name},resources:policy.listResources().filter(r=>r.spaceId===spaceId).flatMap(r=>policy.isolatedWorkspaces.targets(r)).filter(r=>Object.values(capabilities).filter(c=>c.resourceType===r.type).some(c=>policy.simulate({agentId,spaceId,resourceId:r.id,action:c.action}).mode!=='deny')).map(r=>({id:r.id,spaceId:r.spaceId,type:r.type,name:r.name,...(r.grantResourceId?{grantResourceId:r.grantResourceId,isolatedWorkspaceId:r.isolatedWorkspaceId,...(r.metadata.repositoryId?{repositoryId:r.metadata.repositoryId}:{}),...(r.type==='repository'&&r.metadata.branchPolicy?{branchWorkflow:structuredClone(r.metadata.branchPolicy)}:{})}:{})}))};},
    simulate(request){
      const deny=reason=>({mode:'deny',reason,revision:policy.revision});
      try{
        strict(request,['agentId','spaceId','resourceId','action','taskId']);
        if(!Object.hasOwn(capabilities,request.action))return deny('Unknown capability.');
        if(!member(request.agentId,request.spaceId))return deny('Space membership denied.');
        if(policy.isPaused(request.agentId,request.spaceId))return deny('Automation paused by owner.');
        id(request.resourceId);
        let target;try{target=policy.resource(request.resourceId);}catch{return deny('Resource/action mismatch.');}
        if(target.spaceId!==request.spaceId)return deny('Resource/action mismatch.');
        if(target.grantResourceId){
          if(request.action==='repository.review'&&!target.metadata.branchPolicy?.reviewerIds.includes(request.agentId))return deny('Only designated project reviewers may review merges.');
          if(['repository.branch.create','repository.review','repository.merge'].includes(request.action)&&!target.metadata.branchPolicy)return deny('Configure this project’s reviewed branch workflow first.');
          if(target.type==='repository'&&!['repository.read','repository.branch.push','repository.branch.create','repository.review','repository.merge'].includes(request.action))return deny('Catalog Git merge requires a reviewed action gateway.');
          if(target.type!==capabilities[request.action].resourceType)return deny('Resource/action mismatch.');
          if(target.metadata.connectionId&&!db.query("SELECT id FROM connectors WHERE id=? AND space_id=? AND type='git-https-v1' AND endpoint=? AND enabled=1").get(target.metadata.connectionId,target.connectionSpaceId,target.metadata.endpoint))return deny('Git connection disabled or outside scope.');
          const legacyRead=target.legacyRepository&&request.action==='repository.read'&&!db.query("SELECT expires_at FROM grants WHERE agent_id=? AND space_id=? AND action='repository.read' AND (resource_id=? OR resource_id='*')").all(request.agentId,request.spaceId,target.grantResourceId).some(g=>!g.expires_at||Date.parse(g.expires_at)>Date.now());
          return policy.simulate({...request,resourceId:target.grantResourceId,action:legacyRead?'workspace.read':request.action});
        }
        const r=db.query('SELECT * FROM resources WHERE id=? AND space_id=?').get(request.resourceId,request.spaceId);
        if(!r||!policy.actions(target).some(c=>c.action===request.action))return deny('Resource/action mismatch.');
        const groupedGit=target.type==='workspace'&&request.action.startsWith('repository.');
        const reviewed=groupedGit&&policy.reviewed(target);
        if(['repository.branch.create','repository.review'].includes(request.action)&&!reviewed)return deny('Configure a reviewed branch workflow first.');
        if(groupedGit&&request.action==='repository.merge'&&!reviewed)return deny('Configure a reviewed branch workflow first.');
        const gs=db.query("SELECT * FROM grants WHERE agent_id=? AND space_id=? AND action=? AND (resource_id=? OR resource_id='*')").all(request.agentId,request.spaceId,request.action,request.resourceId).filter(g=>!g.expires_at||Date.parse(g.expires_at)>Date.now());
        if(gs.some(g=>g.mode==='deny'))return deny('Explicit owner deny.');
        if(!gs.length&&request.action==='workspace.read')return policy.simulate({...request,action:'sandbox.exec'});
        if(!gs.length&&groupedGit&&request.action==='repository.read'&&policy.isolatedWorkspaces.targets(target).filter(r=>r.type==='repository').every(r=>r.legacyRepository))return policy.simulate({...request,action:'workspace.read'});
        if(!gs.length)return deny('No grant.');
        if(request.action==='repository.read'&&!groupedGit&&!JSON.parse(r.metadata).endpoint)return deny('Repository endpoint unavailable.');
        if(!groupedGit&&!approvalActions.includes(request.action)&&request.action.startsWith('repository.')&&JSON.parse(r.metadata).connectionId&&!db.query("SELECT id FROM connectors WHERE id=? AND space_id=? AND type='git-https-v1' AND enabled=1").get(JSON.parse(r.metadata).connectionId,request.spaceId))return deny('Git connection disabled or outside scope.');
        if(request.action==='file.download'&&!JSON.parse(r.metadata).path)return deny('Exact file path unavailable.');
        if(request.action.startsWith('browser.')&&!(JSON.parse(r.metadata).readUrls?.length||Array.isArray(JSON.parse(r.metadata).blockedDomains)))return deny('Browsing scope unavailable.');
        if(request.action==='mcp.invoke'&&!db.query("SELECT id FROM connectors WHERE id=? AND space_id=? AND type='mcp-document-v1' AND enabled=1").get(JSON.parse(r.metadata).connectionId||'',request.spaceId))return deny('Reviewed connector unavailable.');
        const high=approvalActions.includes(request.action)&&!(reviewed&&request.action==='repository.merge');
        if(high&&!db.query("SELECT id FROM connectors WHERE id=? AND space_id=? AND type='action-gateway-v1' AND enabled=1").get(JSON.parse(r.metadata).connectionId||'',request.spaceId))return deny('Reviewed action gateway unavailable.');
        if(!high&&!capabilities[request.action].available&&!(execution&&(['sandbox.exec','repository.branch.push','repository.branch.create'].includes(request.action)||reviewed&&request.action==='repository.merge'))&&!(browserExecution&&['browser.read','browser.navigate','browser.interact'].includes(request.action)))return deny('Scoped executor unavailable.');
        let readApproval=false;
        if(request.action.startsWith('browser.')&&request.action!=='browser.read'){const read=policy.simulate({...request,action:'browser.read'});if(read.mode==='deny')return deny('Read page content access required.');readApproval=read.mode==='ask';}
        return {mode:high||readApproval||gs.some(g=>g.mode==='ask')?'ask':'auto',reason:readApproval?'Read page content requires approval.':'Matching resource grant.',revision:policy.revision};
      }catch{return deny('Invalid security context.');}
    },
    constraints(job,action,resourceId){const c=policy.context(job);resourceId=policy.resource(resourceId).grantResourceId||resourceId;const grants=db.query("SELECT constraints,expires_at FROM grants WHERE agent_id=? AND space_id=? AND action=? AND (resource_id=? OR resource_id='*') AND mode!='deny'").all(c.agentId,c.spaceId,action,resourceId).filter(g=>!g.expires_at||Date.parse(g.expires_at)>Date.now()).map(g=>JSON.parse(g.constraints));
      if(action==='repository.branch.create'||action==='repository.merge'){const key=action==='repository.branch.create'?'kinds':'transitions',values=grants.map(g=>g[key]||[]);return {[key]:values.flat().filter(value=>values.every(list=>list.includes(value)))};}
      if(action!=='repository.branch.push')return {};
      const prefixes=grants.map(g=>g.branchPrefixes||[]);
      return {branchPrefixes:prefixes.flat().filter(p=>prefixes.every(ps=>ps.some(v=>p.startsWith(v)))),forbiddenRefs:grants.flatMap(g=>g.forbiddenRefs||[]),denyWorkflowChanges:true};},
    bind(taskId,agentId,spaceId=policy.legacySpaceId){
      if(!member(agentId,spaceId))throw new Error('Space membership denied.');if(policy.isPaused(agentId,spaceId))throw new Error('Automation paused by owner.');
      const context=taskSecurityContext({ownerId:policy.ownerId,agentId,taskId,spaceId,policyRevision:policy.revision});
      db.query('INSERT INTO task_security_contexts VALUES(?,?,?,?,?)').run(taskId,context.ownerId,agentId,spaceId,context.policyRevision);return context;
    },
    identity(job){
      const r=db.query('SELECT * FROM task_security_contexts WHERE task_id=?').get(job.id);
      if(!r||r.owner_id!==policy.ownerId||r.agent_id!==job.agentId||r.space_id!==job.spaceId)throw new Error('Task identity or membership invalid.');
      return taskSecurityContext({ownerId:r.owner_id,agentId:r.agent_id,taskId:r.task_id,spaceId:r.space_id,policyRevision:r.policy_revision});
    },
    context(job){const c=policy.identity(job);if(!member(c.agentId,c.spaceId)||policy.isPaused(c.agentId,c.spaceId))throw new Error('Task identity, membership or pause invalid.');return c;},
    authorize(job,action,resourceId){
      const c=policy.context(job),request={agentId:c.agentId,spaceId:c.spaceId,taskId:c.taskId,action,resourceId};
      const decision=policy.simulate(request);events(request,decision);
      if(decision.mode!=='auto'&&!(decision.mode==='ask'&&policy.approved(job,action,resourceId)))throw new Error(decision.mode==='ask'?'Action-bound approval service unavailable.':decision.reason);
      return c;
    },
    auditIsolation(job,resourceId){const c=policy.context(job);events({...c,action:'network.fetch',resourceId},{mode:'deny',reason:'Worker egress disabled by OS network namespace.'});},
    auditExecution(context,resourceId,usage){events({...context,action:'sandbox.exec',resourceId},{mode:'auto',reason:JSON.stringify(usage)});},
    auditData(job,action,resourceId,reason='Classified data or task-scoped operation denied.'){try{const c=policy.identity(job);events({...c,action,resourceId:/^[a-f0-9-]{36}(?::[a-f0-9-]{36}(?::git)?)?$/.test(resourceId||'')?resourceId:null},{mode:'deny',reason});}catch{}},
  };
  if(!db.query("SELECT name FROM sqlite_master WHERE name='isolated_workspaces'").get())securityBackup(db,directory,'pre-isolated-workspaces-');
  policy.isolatedWorkspaces=openIsolatedWorkspaces(db,state,policy);
  if(!db.query("SELECT name FROM sqlite_master WHERE name='git_merge_requests'").get())securityBackup(db,directory,'pre-git-work-');
  policy.gitWork=openGitWork(db);
  Object.defineProperty(state,statePolicy,{value:policy});
  for(const conversation of state.conversations)conversation.spaceId ||= policy.legacySpaceId;
  for(const job of state.jobs){
    job.spaceId ||= policy.legacySpaceId;
    if(migrating)db.query('INSERT INTO task_security_contexts VALUES(?,?,?,?,?)').run(job.id,policy.ownerId,job.agentId,policy.legacySpaceId,0);
    const record=db.query('SELECT * FROM task_security_contexts WHERE task_id=?').get(job.id);
    if(record)Object.defineProperty(job,'securityContext',{enumerable:true,value:taskSecurityContext({ownerId:record.owner_id,agentId:record.agent_id,taskId:record.task_id,spaceId:record.space_id,policyRevision:record.policy_revision})});
    // Saved JSON is never authority to mint missing post-migration contexts.
  }
  return policy;
}
