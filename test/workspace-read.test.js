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
