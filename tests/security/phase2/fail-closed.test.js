import { test, expect } from 'bun:test';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../../../store.js';
import { Runtime } from '../../../runtime.js';
import { FixtureProvider } from '../fixtures.js';

// Dispatch denial is useful evidence, but cannot satisfy any mandatory EXEC OS probe.
test('unavailable executor denies a granted terminal in all interaction modes without host effects',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-no-executor-')),store=openStore(directory),provider=new FixtureProvider();
  const runtime=new Runtime({store,codex:provider,browser:{},workspace:directory});
  try{
    const p=store.security,agentId=store.state.agents[0].id,spaceId=p.legacySpaceId;
    const resource=p.createResource({spaceId,type:'workspace',name:'Unavailable isolated fixture'});
    p.putAccess(agentId,{revision:p.revision,spaceIds:[spaceId],grants:[{spaceId,resourceId:resource.id,action:'sandbox.exec',mode:'auto',constraints:{}}]});
    for(const interactionMode of ['confirm','safe','allow']){
      const job=runtime.submit({prompt:'Check disabled executor',interactionMode});runtime.active=job;job.status='running';job.threadId=randomUUID();
      const id=randomUUID();
      await runtime.executeRequest({id,method:'item/tool/call',params:{threadId:job.threadId,tool:'odwyn_terminal',arguments:{resourceId:resource.id,command:'touch forbidden-host-effect',reason:'Synthetic fixture'}}});
      expect(provider.replies.find(r=>r.id===id).result.success).toBe(false);
      expect(existsSync(join(directory,'forbidden-host-effect'))).toBe(false);
    }
  }finally{runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}
});
