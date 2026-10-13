import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../../../store.js';
import { Runtime } from '../../../runtime.js';
import { FixtureProvider } from '../fixtures.js';
import { grantFiles } from '../access-fixtures.js';

test('scoped file export permits only the exact owner-granted file and never legacy approval',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'odwyn-export-grants-')),store=openStore(dir),provider=new FixtureProvider();
  const runtime=new Runtime({store,codex:provider,browser:{},workspace:dir});
  try{
    writeFileSync(join(dir,'allowed.txt'),'Synthetic deliverable');writeFileSync(join(dir,'foreign.txt'),'Synthetic private fixture');
    const ids=grantFiles(store,store.state.agents[0].id,['allowed.txt']);
    const job=runtime.submit({prompt:'Deliver explicit file',interactionMode:'allow'});runtime.active=job;job.status='running';job.threadId='fixture';
    const invoke=async args=>{await runtime.executeRequest({id:provider.replies.length,method:'item/tool/call',params:{threadId:job.threadId,tool:'odwyn_send_file',arguments:args}});return provider.replies.at(-1).result;};
    expect((await invoke({resourceId:ids['allowed.txt'],path:'foreign.txt'})).success).toBe(false);
    expect(job.files).toHaveLength(0);
    expect((await invoke({resourceId:ids['allowed.txt'],path:'allowed.txt'})).success).toBe(true);
    expect(job.files).toHaveLength(1);expect(existsSync(join(dir,'files',job.files[0]))).toBe(true);
    expect((await invoke({path:'foreign.txt'})).success).toBe(false);expect(job.files).toHaveLength(1);
    unlinkSync(join(dir,'allowed.txt'));symlinkSync(join(dir,'foreign.txt'),join(dir,'allowed.txt'));
    expect((await invoke({resourceId:ids['allowed.txt'],path:'allowed.txt'})).success).toBe(false);expect(job.files).toHaveLength(1);
  }finally{runtime.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('AUTH-008 repository revocation interrupts real HTTP and MCP reads before disclosure',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'odwyn-stream-revoke-')),store=openStore(dir),provider=new FixtureProvider();
  let started,reads=0;
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){reads++;return new Response(new ReadableStream({start(c){started();setTimeout(()=>{try{c.enqueue(new TextEncoder().encode('Synthetic confidential suffix'));c.close();}catch{}},30);}}),{headers:{'content-type':'text/plain'}});}});
  const runtime=new Runtime({store,codex:provider,browser:{},workspace:dir,repositoryResolver:async raw=>({url:new URL(raw.replace('https://fixture.invalid',`http://fixture.invalid:${upstream.port}`)),address:'127.0.0.1',family:4})});
  try{
    const p=store.security,agentId=store.state.agents[0].id,spaceId=p.legacySpaceId;
    const resource=p.createResource({spaceId,type:'repository',name:'Fixture',metadata:{endpoint:'https://fixture.invalid/repo'}});
    for(const tool of ['odwyn_repository_read','odwyn_mcp_repository_read']){
      p.putAccess(agentId,{revision:p.revision,spaceIds:[spaceId],grants:[{spaceId,resourceId:resource.id,action:'repository.read',mode:'auto',constraints:{}}]});
      const job=runtime.submit({prompt:'Read fixture'});runtime.active=job;job.status='running';job.threadId=tool;
      const ready=new Promise(resolve=>{started=resolve;});
      const read=runtime.executeRequest({id:tool,method:'item/tool/call',params:{threadId:job.threadId,tool,arguments:{resourceId:resource.id}}});
      await ready;p.putAccess(agentId,{revision:p.revision,spaceIds:[spaceId],grants:[]});await read;
      const result=provider.replies.at(-1).result;expect(result.success).toBe(false);
      expect(JSON.stringify(result)).not.toContain('Synthetic confidential suffix');
    }
    expect(reads).toBe(2);
  }finally{runtime.close();upstream.stop(true);store.close();rmSync(dir,{recursive:true,force:true});}
});
