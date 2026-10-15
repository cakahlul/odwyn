import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync,symlinkSync,readdirSync,mkdirSync,writeFileSync,realpathSync,linkSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {sourceFolder,workspaceSource,importWorkspaceSource} from '../execution/workspace-source.js';
import {createApp} from '../server.js';
import {createJob} from '../store.js';

test('workspace source paths stay inside the trusted root and reject symlink components',()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-source-')),root=join(directory,'sources');
  try{
    for(const path of ['', '/etc','../private','a/../b','a//b','a\\b','.ssh','a/.git','a\n'])expect(()=>sourceFolder(path)).toThrow();
    expect(workspaceSource(root,'product').exists).toBe(false);
    const value=workspaceSource(root,'product/backend',{create:true});expect(value.empty).toBe(true);expect(value.path).toBe(join(root,'product/backend'));
    symlinkSync(directory,join(root,'escape'));expect(()=>workspaceSource(root,'escape/private',{create:true})).toThrow('symbolic');
    symlinkSync(root,join(directory,'alias'));expect(()=>workspaceSource(join(directory,'alias'),'product')).toThrow('symbolic');
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('source folder imports are bounded, atomic, exclude credentials and preserve existing code',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-import-')),root=join(directory,'sources');
  const upload=(name,text)=>new File([text],name);
  try{
    workspaceSource(root,'product',{create:true});
    const result=await importWorkspaceSource(root,'product',[upload('src/main.js','export const value=1;'),upload('.env','secret'),upload('node_modules/a.js','dependency'),upload('.git/config','credential')]);
    expect(result.files).toBe(1);expect(result.skipped).toBe(3);expect(readFileSync(join(root,'product/src/main.js'),'utf8')).toContain('value=1');
    await expect(importWorkspaceSource(root,'product',[upload('other.js','overwrite')])).rejects.toThrow('not empty');expect(readdirSync(join(root,'product'))).toEqual(['src']);
    const recreated=await importWorkspaceSource(root,'missing/nested',[upload('main.js','restored')]);expect(recreated.files).toBe(1);expect(readFileSync(join(root,'missing/nested/main.js'),'utf8')).toBe('restored');
    workspaceSource(root,'fresh',{create:true});
    for(const path of ['../outside','/outside','a/../../outside','a\\b','a\n'])await expect(importWorkspaceSource(root,'fresh',[upload(path,'x')])).rejects.toThrow('unsafe');
    await expect(importWorkspaceSource(root,'fresh',[upload('file','a'),upload('file','b')])).rejects.toThrow('duplicate');
    await expect(importWorkspaceSource(root,'fresh',[upload('file','x'.repeat(16*1024*1024+1))])).rejects.toThrow('16 MiB');
    await expect(importWorkspaceSource(root,'fresh',[upload('safe','safe'),upload('private','secret')],{assertBytes:bytes=>{if(bytes.toString()==='secret')throw Error('Known credential');}})).rejects.toThrow('credential');expect(readdirSync(join(root,'fresh'))).toEqual([]);
    await expect(importWorkspaceSource(root,'fresh',[upload('a','x'),upload('a/b','x')])).rejects.toThrow();expect(readdirSync(join(root,'fresh'))).toEqual([]);
    await expect(importWorkspaceSource(root,'fresh',[upload('x','x')],{beforeWrite:()=>{throw Error('Task started');}})).rejects.toThrow('Task started');expect(readdirSync(join(root,'fresh'))).toEqual([]);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('owner API provisions sources and imports code, rejects task tokens and safely changes source configuration',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-source-api-')),codex=Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}});
  const app=createApp({directory,user:'owner',password:'source-test-password',origin:'http://localhost',codex,browser:{close:async()=>{}}});
  const store=app.runtime.store,p=store.security,headers={authorization:'Basic '+Buffer.from('owner:source-test-password').toString('base64'),origin:'http://localhost'};
  const request=(path,body,method='POST',auth=headers)=>app.fetch(new Request('http://localhost'+path,{method,headers:{...auth,...(body instanceof FormData?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})}));
  const form=(name='src/main.js')=>{const data=new FormData();data.append('files',new File(['export const hello=1;'],name),name);return data;};
  try{
    const info=await (await request('/api/execution',undefined,'GET')).json();expect(info.sourceRoot).toBe(join(directory,'sources'));expect(info.configured).toBe(false);
    const created=await request('/api/resources',{spaceId:p.legacySpaceId,type:'workspace',name:'Development',metadata:{sourceFolder:'project'}});expect(created.status).toBe(201);const resource=await created.json();expect(resource.workspaceSource.empty).toBe(true);expect(resource.metadata.sourceFolder).toBe('project');
    const oversized=new Request('http://localhost/api/resources/'+resource.id+'/source',{method:'POST',headers:{...headers,'content-type':'multipart/form-data; boundary=test'},body:new ReadableStream({start(controller){controller.enqueue(new Uint8Array(21*1024*1024+1));controller.close();}})});
    const rejected=await app.fetch(oversized);expect(rejected.status).toBe(400);expect((await rejected.json()).error).toContain('21 MiB');
    const check=await (await request('/api/execution/source',{sourceFolder:'project'})).json();expect(check.exists).toBe(true);expect(check.empty).toBe(true);
    const agentId=store.state.agents[0].id;p.putAccess(agentId,{revision:p.revision,spaceIds:[p.legacySpaceId],grants:[{spaceId:p.legacySpaceId,resourceId:resource.id,action:'workspace.read',mode:'auto'}]});
    const imported=await request(`/api/resources/${resource.id}/source`,form());expect(imported.status).toBe(201);expect(readFileSync(join(info.sourceRoot,'project/src/main.js'),'utf8')).toContain('hello=1');expect((await request(`/api/resources/${resource.id}/source`,form())).status).toBe(400);
    const job=createJob(store.state,{agentId,prompt:'Task token cannot configure sources'});job.status='running';const token=store.data.issueToken(job),bearer={authorization:'Bearer '+token,origin:'http://localhost'};
    for(const [path,body] of [['/api/execution/source',{sourceFolder:'project'}],[`/api/resources/${resource.id}/source`,form()]])expect((await request(path,body,'POST',bearer)).status).toBe(401);
    expect([401,403]).toContain((await request('/api/execution',undefined,'GET',bearer)).status);
    expect((await request(`/api/resources/${resource.id}`,{metadata:{sourceFolder:'next'}},'PUT')).status).toBe(400);job.status='completed';
    expect((await request(`/api/resources/${resource.id}`,{metadata:{sourceFolder:'../escape'}},'PUT')).status).toBe(400);expect(p.resource(resource.id).metadata.sourceFolder).toBe('project');expect(p.access(agentId).grants[0].mode).toBe('auto');
    expect((await request(`/api/resources/${resource.id}`,{metadata:{sourceFolder:'next'}},'PUT')).status).toBe(200);expect(p.access(agentId).grants[0].mode).toBe('deny');
    store.state.executionHeads={[resource.id]:'a'.repeat(64)};expect((await request(`/api/resources/${resource.id}`,{metadata:{sourceFolder:'third'}},'PUT')).status).toBe(400);expect((await request(`/api/resources/${resource.id}/source`,form())).status).toBe(400);expect(p.resource(resource.id).metadata.sourceFolder).toBe('next');
    expect((await request(`/api/resources/${resource.id}`,{metadata:null},'PUT')).status).toBe(400);expect(p.resource(resource.id).metadata.sourceFolder).toBe('next');
    const blank=await (await request('/api/resources',{spaceId:p.legacySpaceId,type:'workspace',name:'Automatic'})).json();expect(blank.metadata).toEqual({});expect(blank.workspaceSource.path).toBe(join(info.sourceRoot,p.legacySpaceId,blank.id));expect(blank.workspaceSource.empty).toBe(true);
  }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});

test('server project copy preserves originals and executable bits, excludes private data and fails atomically',async()=>{
  const directory=realpathSync(mkdtempSync(join(tmpdir(),'odwyn-server-source-'))),project=join(directory,'project'),data=join(directory,'private'),root=join(data,'sources');
  mkdirSync(join(project,'src'),{recursive:true});mkdirSync(data);writeFileSync(join(project,'src/main.js'),'console.log("existing project");',{mode:0o755});
  for(const name of ['.git','node_modules','dist']){mkdirSync(join(project,name));writeFileSync(join(project,name,'excluded'),'excluded');}writeFileSync(join(project,'.env'),'secret');
  const app=createApp({directory:data,sourceProtectedRoots:[join(directory,'provider-private')],user:'owner',password:'source-copy-password',origin:'http://localhost',codex:Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}}),browser:{close:async()=>{}}}),p=app.runtime.store.security;
  const headers={authorization:'Basic '+Buffer.from('owner:source-copy-password').toString('base64'),origin:'http://localhost','content-type':'application/json'};
  const request=(path,body,auth=headers)=>app.fetch(new Request('http://localhost'+path,{method:'POST',headers:auth,body:JSON.stringify(body)}));
  const resource=await(await request('/api/resources',{spaceId:p.legacySpaceId,type:'workspace',name:'Server project'})).json(),target=resource.workspaceSource.path,path='/api/resources/'+resource.id+'/source';
  try{
    const protectedProject=join(directory,'provider-private');mkdirSync(protectedProject);writeFileSync(join(protectedProject,'private.txt'),'synthetic provider data');
    const copied=await request(path,{serverFolder:project});expect(copied.status).toBe(201);const result=await copied.json();expect(result.files).toBe(1);expect(result.skipped).toBe(4);expect(readFileSync(join(target,'src/main.js'),'utf8')).toContain('existing project');expect(statSync(join(target,'src/main.js')).mode&0o111).toBe(0o111);expect(readFileSync(join(project,'.env'),'utf8')).toBe('secret');const repeat=await request(path,{serverFolder:project});expect(repeat.status).toBe(400);expect((await repeat.json()).error).toContain(target);
    const missing=await(await request('/api/resources',{spaceId:p.legacySpaceId,type:'workspace',name:'Recreate deleted folder'})).json();rmSync(missing.workspaceSource.path,{recursive:true});expect((await request('/api/resources/'+missing.id+'/source',{serverFolder:project})).status).toBe(201);expect(readFileSync(join(missing.workspaceSource.path,'src/main.js'),'utf8')).toContain('existing project');
    const fresh=await(await request('/api/resources',{spaceId:p.legacySpaceId,type:'workspace',name:'Fresh'})).json(),freshPath='/api/resources/'+fresh.id+'/source';
    for(const serverFolder of ['relative','/','/etc/../etc',data,root,join(directory,'missing')])expect((await request(freshPath,{serverFolder})).status).toBe(400);
    const workspace=await(await request('/api/workspaces',{name:'Studio'})).json();
    const state=await(await app.fetch(new Request('http://localhost/api/state?workspace='+workspace.id,{headers}))).json();
    const child=await(await request('/api/resources?workspace='+workspace.id,{spaceId:state.security.legacySpaceId,type:'workspace',name:'Child copy'})).json();
    expect((await request('/api/resources/'+child.id+'/source?workspace='+workspace.id,{serverFolder:protectedProject})).status).toBe(400);
    symlinkSync(project,join(directory,'alias'));expect((await request(freshPath,{serverFolder:join(directory,'alias')})).status).toBe(400);
    symlinkSync(join(project,'src/main.js'),join(project,'link'));expect((await request(freshPath,{serverFolder:project})).status).toBe(400);rmSync(join(project,'link'));
    linkSync(join(project,'src/main.js'),join(project,'hard'));expect((await request(freshPath,{serverFolder:project})).status).toBe(400);rmSync(join(project,'hard'));
    const job=createJob(app.runtime.state,{agentId:app.runtime.state.agents[0].id,prompt:'Block import'});job.status='running';expect((await request(freshPath,{serverFolder:project})).status).toBe(400);const bearer={...headers,authorization:'Bearer '+app.runtime.store.data.issueToken(job)};expect((await request(freshPath,{serverFolder:project},bearer)).status).toBe(401);job.status='completed';
    app.runtime.state.executionHeads={[fresh.id]:'a'.repeat(64)};expect((await request(freshPath,{serverFolder:project})).status).toBe(400);delete app.runtime.state.executionHeads[fresh.id];
    writeFileSync(join(project,'large'),'x'.repeat(16*1024*1024+1));expect((await request(freshPath,{serverFolder:project})).status).toBe(400);rmSync(join(project,'large'));expect(readdirSync(fresh.workspaceSource.path)).toEqual([]);
    symlinkSync(data,join(project,'private-link'));expect((await request(freshPath,{serverFolder:project})).status).toBe(400);expect(readdirSync(fresh.workspaceSource.path)).toEqual([]);
  }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});
