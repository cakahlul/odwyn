import {test, expect} from 'bun:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore, createJob} from '../store.js';

test('workspace evidence readers never gain execution and explicit read decisions override compatibility fallback', () => {
  const directory=mkdtempSync(join(tmpdir(),'odwyn-workspace-read-')),store=openStore(directory);
  try {
    const policy=store.security,agentId=store.state.agents[0].id,space=policy.createSpace({name:'Execution'});
    const resource=policy.createResource({spaceId:space.id,type:'workspace',name:'Source checkpoint'});
    const other=policy.createResource({spaceId:space.id,type:'workspace',name:'Other checkpoint'});
    const set=(grants,spaceIds=[space.id])=>policy.putAccess(agentId,{revision:policy.revision,spaceIds,confirmWildcard:true,grants:grants.map(grant=>({spaceId:space.id,resourceId:resource.id,...grant}))});
    const decision=(action,resourceId=resource.id)=>policy.simulate({agentId,spaceId:space.id,resourceId,action}).mode;
    set([{action:'workspace.read',mode:'auto'},{action:'sandbox.exec',mode:'deny'}]);
    expect(policy.catalog().find(item=>item.action==='workspace.read')).toMatchObject({resourceType:'workspace',available:true});
    expect(decision('workspace.read')).toBe('auto');expect(decision('sandbox.exec')).toBe('deny');
    const job=createJob(store.state,{agentId,spaceId:space.id,prompt:'Review retained evidence'});
    expect(()=>policy.authorize(job,'workspace.read',resource.id)).not.toThrow();
    expect(()=>policy.authorize(job,'sandbox.exec',resource.id)).toThrow();
    job.status='completed';

    policy.configureExecution(true);
    set([{action:'sandbox.exec',mode:'auto'}]);
    expect(decision('workspace.read')).toBe('auto');
    set([{action:'sandbox.exec',mode:'ask'}]);expect(decision('workspace.read')).toBe('ask');
    set([{action:'sandbox.exec',mode:'auto'},{action:'workspace.read',mode:'deny'}]);expect(decision('workspace.read')).toBe('deny');
    set([{action:'sandbox.exec',mode:'auto'},{action:'workspace.read',mode:'ask'}]);expect(decision('workspace.read')).toBe('ask');
    set([{action:'sandbox.exec',mode:'auto'},{action:'workspace.read',mode:'deny',resourceId:'*'}]);expect(decision('workspace.read')).toBe('deny');
    set([{action:'sandbox.exec',mode:'auto'},{action:'workspace.read',mode:'deny',expiresAt:new Date(Date.now()-1000).toISOString()}]);expect(decision('workspace.read')).toBe('auto');
    set([{action:'workspace.read',mode:'auto',expiresAt:new Date(Date.now()-1000).toISOString()}]);expect(decision('workspace.read')).toBe('deny');
    set([{action:'workspace.read',mode:'auto'}]);expect(decision('workspace.read',other.id)).toBe('deny');
    policy.pause({scope:'agent',id:agentId,paused:true});expect(decision('workspace.read')).toBe('deny');
    policy.pause({scope:'agent',id:agentId,paused:false});expect(decision('workspace.read')).toBe('auto');
    set([]);expect(decision('workspace.read')).toBe('deny');
    set([{action:'sandbox.exec',mode:'auto'}]);policy.configureExecution(false);expect(decision('workspace.read')).toBe('deny');
    set([],[]);expect(decision('workspace.read')).toBe('deny');
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});

test('retained execution evidence stays readable under explicit read access while execution is separately revoked',()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-evidence-read-')),store=openStore(directory);
  try{
    const p=store.security,author=store.state.agents[0].id;store.state.agents.push({id:'reviewer'});p.configureExecution(true);
    const resource=p.createResource({spaceId:p.legacySpaceId,type:'workspace',name:'Work'});
    const grant=(agentId,execute,read)=>p.putAccess(agentId,{revision:p.revision,spaceIds:[p.legacySpaceId],grants:[{spaceId:p.legacySpaceId,resourceId:resource.id,action:'sandbox.exec',mode:execute},{spaceId:p.legacySpaceId,resourceId:resource.id,action:'workspace.read',mode:read}]});
    grant(author,'auto','auto');grant('reviewer','deny','auto');
    const source=createJob(store.state,{agentId:author,prompt:'Run checked command'});store.data.note(source,resource.id,'sandbox.exec');
    const room=store.state.conversations.find(item=>item.id===source.conversationId);Object.assign(room,{kind:'room',memberIds:[author,'reviewer'],artifacts:[{id:'artifact',title:'Evidence',agentId:author,versions:[{id:'version',taskId:source.id,text:'Verified command result',reviews:{}}]}]});
    const reader=createJob(store.state,{conversationId:room.id,agentId:'reviewer',prompt:'Review result'});
    grant(author,'deny','auto');expect(store.data.artifact(reader,room.id,'artifact','version').version.text).toContain('Verified');expect(()=>p.authorize(reader,'sandbox.exec',resource.id)).toThrow();
    grant(author,'deny','deny');expect(()=>store.data.artifact(reader,room.id,'artifact','version')).toThrow('provenance');
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
