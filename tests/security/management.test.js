import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,createJob} from '../../store.js';
import {createApp} from '../../server.js';
import {FixtureProvider} from './fixtures.js';

function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'odwyn-management-')),store=openStore(directory),p=store.security,a=store.state.agents[0].id;
 const space=p.createSpace({name:'Research'});
 return {store,p,a,space,close(){store.close();rmSync(directory,{recursive:true,force:true});}};
}
test('resource edits validate atomically and revoke wildcard access only for changed targets',()=>{
 const f=fixture();try{
  const {p,a,space}=f,r=p.createResource({spaceId:space.id,type:'repository',name:'Repo',metadata:{endpoint:'https://example.invalid/old'}});
  p.putAccess(a,{revision:p.revision,spaceIds:[space.id],defaultSpaceId:space.id,confirmWildcard:true,grants:[{spaceId:space.id,resourceId:'*',action:'repository.read',mode:'auto'}]});
  const request={agentId:a,spaceId:space.id,resourceId:r.id,action:'repository.read'},revision=p.revision;
  expect(()=>p.updateResource(r.id,{name:'Repo',metadata:{endpoint:'http://invalid'}})).toThrow();
  expect(p.revision).toBe(revision);expect(p.resource(r.id)).toEqual(r);
  p.updateResource(r.id,{name:'Renamed',metadata:r.metadata});expect(p.simulate(request).mode).toBe('auto');
  p.updateResource(r.id,{name:'Renamed',metadata:{endpoint:'https://example.invalid/new'}});expect(p.simulate(request).mode).toBe('deny');
  expect(()=>p.updateResource(r.id,{name:'Move',spaceId:p.legacySpaceId})).toThrow();
  p.deleteResource(r.id);expect(()=>p.resource(r.id)).toThrow();expect(p.access(a).grants.some(g=>g.resourceId===r.id)).toBe(false);
 }finally{f.close();}
});
test('space deletion cleans memberships/defaults and protects dependencies and history',()=>{
 const f=fixture();try{
  const {p,a,space}=f;p.putAccess(a,{revision:p.revision,spaceIds:[space.id],defaultSpaceId:space.id,grants:[]});
  expect(p.updateSpace(space.id,{name:' New name '}).name).toBe('New name');
  const r=p.createResource({spaceId:space.id,type:'workspace',name:'Files'}),file=p.createResource({spaceId:space.id,type:'file',name:'Report',metadata:{workspaceId:r.id,path:'report.txt'}});
  expect(()=>p.deleteSpace(space.id)).toThrow();expect(()=>p.deleteResource(r.id)).toThrow();
  p.deleteResource(file.id);p.deleteResource(r.id);p.deleteSpace(space.id);
  expect(p.access(a).spaceIds).toEqual([]);expect(p.defaultSpace(a)).toBe(p.legacySpaceId);
  expect(()=>p.deleteSpace(p.legacySpaceId)).toThrow();
  const historical=p.createSpace({name:'History'});p.putAccess(a,{revision:p.revision,spaceIds:[historical.id],grants:[]});createJob(f.store.state,{agentId:a,spaceId:historical.id,prompt:'Keep history'});
  expect(()=>p.deleteSpace(historical.id)).toThrow();expect(f.store.state.conversations.length).toBe(1);
 }finally{f.close();}
});
test('connection edits preserve secret, revoke linked permissions and require unlinking before removal',()=>{
 const f=fixture();try{
  const {p,a,space,store}=f,c=store.connectors.create({spaceId:space.id,type:'git-https-v1',name:'Git',endpoint:'https://example.invalid/repo',credential:'synthetic-secret'});
  const r=p.createResource({spaceId:space.id,type:'repository',name:'Repo',metadata:{endpoint:c.endpoint||'https://example.invalid/repo',connectionId:c.id}});
  p.putAccess(a,{revision:p.revision,spaceIds:[space.id],grants:[{spaceId:space.id,resourceId:r.id,action:'repository.read',mode:'auto'}]});
  store.connectors.update(c.id,{name:'Renamed',endpoint:'https://example.invalid/repo'});expect(p.access(a).grants[0].mode).toBe('auto');
  store.connectors.update(c.id,{name:'Renamed',endpoint:'https://example.invalid/new'});expect(p.access(a).grants[0].mode).toBe('deny');expect(p.resource(r.id).metadata.endpoint).toBe('https://example.invalid/new');
  store.connectors.withCredential(c.id,{spaceId:space.id},value=>expect(value.secret).toBe('synthetic-secret'));
  expect(JSON.stringify(store.connectors.list())).not.toContain('synthetic-secret');
  expect(()=>store.connectors.remove(c.id)).toThrow();p.deleteResource(r.id);store.connectors.remove(c.id);expect(store.connectors.list()).toEqual([]);
 }finally{f.close();}
});
test('management routes require owner authentication and fresh password for connection changes',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-management-api-')),app=createApp({directory,user:'owner',password:'fixture-password',origin:'http://127.0.0.1:4317',codex:new FixtureProvider(),browser:{close:async()=>{}}});
 const request=(path,method,body,auth=true)=>app.fetch(new Request('http://127.0.0.1:4317'+path,{method,headers:{origin:'http://127.0.0.1:4317','content-type':'application/json',...(auth?{authorization:'Basic '+btoa('owner:fixture-password')}:{})},...(body?{body:JSON.stringify(body)}:{})}));
 try{
  const s=app.runtime.store.security.createSpace({name:'Space'}),path='/api/spaces/'+s.id;
  expect((await request(path,'PUT',{name:'Renamed'},false)).status).toBe(401);expect((await request(path,'PUT',{name:'Renamed'})).status).toBe(200);
  const c=app.runtime.store.connectors.create({spaceId:s.id,type:'git-https-v1',name:'Git',endpoint:'https://example.invalid/repo',credential:'synthetic-key'});
  const r=app.runtime.store.security.createResource({spaceId:s.id,type:'memory',name:'Notes'});
  for(const [target,method,body] of [[path,'DELETE'],['/api/resources/'+r.id,'PUT',{name:'Denied'}],['/api/resources/'+r.id,'DELETE'],['/api/connectors/'+c.id,'PUT',{name:'Denied',endpoint:'https://example.invalid/new',ownerPassword:'fixture-password'}],['/api/connectors/'+c.id+'/permanent','DELETE'],['/api/security/presets/Builder','DELETE']])expect((await request(target,method,body,false)).status).toBe(401);
  expect((await request('/api/resources/'+r.id,'PUT',{name:'Renamed notes'})).status).toBe(200);expect((await request('/api/resources/'+r.id,'DELETE')).status).toBe(200);

  expect((await request('/api/connectors/'+c.id,'PUT',{name:'Git',endpoint:'https://example.invalid/new'})).status).toBe(400);
  expect((await request('/api/connectors/'+c.id,'PUT',{name:'Git',endpoint:'https://example.invalid/new',ownerPassword:'fixture-password'})).status).toBe(200);
  expect((await request('/api/connectors/'+c.id+'/permanent','DELETE')).status).toBe(200);expect((await request(path,'DELETE')).status).toBe(200);
 }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});
test('template deletion and renamed configuration persist across reload',()=>{
 const f=fixture();let reopened;try{
  f.p.deletePreset('Research only');f.p.putPreset({name:'My template',actions:['memory.read']});f.p.putPreset({name:'Renamed template',previousName:'My template',actions:['memory.write']});
  expect(()=>f.p.putPreset({name:'Builder',previousName:'Renamed template',actions:[]})).toThrow();
  const c=f.store.connectors.create({spaceId:f.space.id,type:'git-https-v1',name:'Git',endpoint:'https://example.invalid/repo',credential:'synthetic-reload-secret'}),r=f.p.createResource({spaceId:f.space.id,type:'repository',name:'Repo',metadata:{endpoint:'https://example.invalid/repo',connectionId:c.id}});
  f.p.putAccess(f.a,{revision:f.p.revision,spaceIds:[f.space.id],grants:[{spaceId:f.space.id,resourceId:r.id,action:'repository.read',mode:'auto'}]});
  f.store.connectors.disable(c.id);f.p.updateResource(r.id,{name:'Rename disabled target',metadata:{connectionId:c.id,endpoint:'https://example.invalid/repo'}});expect(f.p.access(f.a).grants[0].mode).toBe('auto');
  f.store.save();reopened=openStore(f.store.directory);
  expect(reopened.security.presets().some(p=>p.name==='Research only')).toBe(false);expect(reopened.security.presets().find(p=>p.name==='Renamed template').actions).toEqual(['memory.write']);expect(reopened.security.resource(r.id).name).toBe('Rename disabled target');
 }finally{reopened?.close();f.close();}
});
test('active tasks block target changes and deletion without changing policy',()=>{
 const f=fixture();try{
  const r=f.p.createResource({spaceId:f.space.id,type:'repository',name:'Repo',metadata:{endpoint:'https://example.invalid/repo'}});f.p.putAccess(f.a,{revision:f.p.revision,spaceIds:[f.space.id],grants:[]});const job=createJob(f.store.state,{agentId:f.a,spaceId:f.space.id,prompt:'Active task'}),revision=f.p.revision;
  expect(()=>f.p.updateResource(r.id,{metadata:{endpoint:'https://example.invalid/changed'}})).toThrow('Stop tasks');expect(()=>f.p.deleteResource(r.id)).toThrow('Stop tasks');expect(f.p.revision).toBe(revision);job.status='cancelled';f.p.updateResource(r.id,{metadata:{endpoint:'https://example.invalid/changed'}});
 }finally{f.close();}
});
