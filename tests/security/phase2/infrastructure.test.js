import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../../../store.js';
import { fixture } from './fixture.js';

test('snapshot rejects symlinks and excludes credential/config files with bounded copying',()=>{
  const dir=mkdtempSync(join(tmpdir(),'odwyn-copy-')),source=join(dir,'source'),out=join(dir,'out');mkdirSync(source);mkdirSync(out);
  try{
    writeFileSync(join(source,'public.txt'),'Synthetic permitted content');
    for(const name of ['.env','.env.local','.npmrc','auth.json','odwyn.db','odwyn.db-wal'])writeFileSync(join(source,name),'synthetic_secret');
    mkdirSync(join(source,'.git'));writeFileSync(join(source,'.git','config'),'synthetic_remote_credential');
    const copy=()=>Bun.spawnSync(['python3',join(import.meta.dir,'../../../execution/snapshot.py'),source,out]);
    expect(copy().exitCode).toBe(0);expect(readdirSync(out).sort()).toEqual(['.git','public.txt']);expect(readdirSync(join(out,'.git'))).toHaveLength(0);expect(readFileSync(join(out,'public.txt'),'utf8')).toBe('Synthetic permitted content');
    rmSync(out,{recursive:true});mkdirSync(out);writeFileSync(join(dir,'host-secret'),'synthetic_host_secret');symlinkSync(join(dir,'host-secret'),join(source,'host-link'));
    expect(copy().exitCode).not.toBe(0);expect(readdirSync(out)).not.toContain('host-link');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('phase 1 grants migrate with private restorable backup and no privilege changes',()=>{
  const dir=mkdtempSync(join(tmpdir(),'odwyn-constraint-migration-'));let store,db,backup;
  try{
    store=openStore(dir);const p=store.security,agentId=store.state.agents[0].id,spaceId=p.legacySpaceId,resource=p.createResource({spaceId,type:'workspace',name:'Synthetic workspace'});
    p.putAccess(agentId,{revision:p.revision,spaceIds:[spaceId],grants:[{spaceId,resourceId:resource.id,action:'sandbox.exec',mode:'auto',constraints:{}}]});store.save();const revision=p.revision;store.close();store=null;
    db=new Database(join(dir,'odwyn.db'));db.exec('ALTER TABLE grants DROP COLUMN constraints');const before=db.query('SELECT * FROM grants').all();db.close();db=null;
    const previous=new Set(readdirSync(dir));store=openStore(dir);
    expect(store.security.revision).toBe(revision);expect(store.security.access(agentId).grants[0].constraints).toEqual({});expect(store.security.simulate({agentId,spaceId,resourceId:resource.id,action:'sandbox.exec'}).mode).toBe('deny');
    const name=readdirSync(dir).find(n=>n.startsWith('pre-security-')&&!previous.has(n)),path=join(dir,name,'state.sqlite');expect(statSync(path).mode&0o777).toBe(0o600);expect(statSync(join(dir,name)).mode&0o777).toBe(0o700);
    backup=new Database(path,{readonly:true});expect(backup.query('SELECT * FROM grants').all()).toEqual(before);expect(backup.query('PRAGMA table_info(grants)').all().some(c=>c.name==='constraints')).toBe(false);
    db=new Database(join(dir,'odwyn.db'),{readonly:true});expect(backup.query('SELECT value FROM state').get()).toEqual(db.query('SELECT value FROM state').get());
  }finally{backup?.close();db?.close();store?.close();rmSync(dir,{recursive:true,force:true});}
});

test('Git constraints intersect matching grants and ignore expired alternate-format dates',()=>{
  const dir=mkdtempSync(join(tmpdir(),'odwyn-grant-intersection-')),store=openStore(dir);
  try{
    const p=store.security,agentId=store.state.agents[0].id,spaceId=p.legacySpaceId,r=p.createResource({spaceId,type:'repository',name:'Synthetic repo',metadata:{endpoint:'https://fixture.invalid/repo.git'}});
    const grant=constraints=>({spaceId,resourceId:r.id,action:'repository.branch.push',mode:'auto',constraints});
    p.putAccess(agentId,{revision:p.revision,spaceIds:[spaceId],grants:[grant({branchPrefixes:['agent/']}),grant({branchPrefixes:['agent/narrow/'],forbiddenRefs:['agent/narrow/blocked']}),{...grant({branchPrefixes:['expired/']}),expiresAt:'Tue, 01 Jan 2019 00:00:00 GMT'}]});
    const job={id:crypto.randomUUID(),agentId,spaceId};p.bind(job.id,agentId,spaceId);expect(p.constraints(job,'repository.branch.push',r.id)).toEqual({branchPrefixes:['agent/narrow/'],forbiddenRefs:['agent/narrow/blocked'],denyWorkflowChanges:true});
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('task completion and awaited shutdown remove the real worker',async()=>{
  const f=await fixture();try{
    expect((await f.exec('true')).exitCode).toBe(0);const worker=f.worker();
    expect(worker.Config.Cmd).toEqual(['sh','-c','sleep 3600']);
    f.runtime.finish(f.job,'completed');await f.runtime.close();
    expect((await f.runtime.sandbox.docker(['inspect',worker.Id])).exitCode).not.toBe(0);
    expect((await f.invoke('odwyn_terminal',{resourceId:f.resource.id,command:'true',reason:'Ended task'})).success).toBe(false);
  }finally{await f.close();}
},30000);
