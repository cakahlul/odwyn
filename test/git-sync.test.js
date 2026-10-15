import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../store.js';
import {GitGateway} from '../security/git-gateway.js';
import {validateGitSync} from '../execution/git-sync.js';

test('Git links are same-Space owner targets; linked deletion and invalid usernames are rejected',()=>{
 const root=mkdtempSync(join(tmpdir(),'odwyn-git-link-')),store=openStore(root),p=store.security;
 try{
  const first=p.legacySpaceId,second=p.createSpace({name:'Other'}).id,repo=p.createResource({spaceId:first,type:'repository',name:'Project',metadata:{endpoint:'https://github.com/example/repo.git',gitUsername:'example-user'}});
  const workspace=p.createResource({spaceId:first,type:'workspace',name:'Git code',metadata:{repositoryId:repo.id}});expect(workspace.metadata.repositoryId).toBe(repo.id);
  expect(()=>p.createResource({spaceId:second,type:'workspace',name:'Wrong Space',metadata:{repositoryId:repo.id}})).toThrow('same Space');
  expect(()=>p.createResource({spaceId:first,type:'workspace',name:'Wrong type',metadata:{repositoryId:workspace.id}})).toThrow('same Space');expect(()=>p.deleteResource(repo.id)).toThrow('unlink');
  for(const gitUsername of ['x:y','bad\nname','with space',''])expect(()=>p.updateResource(repo.id,{metadata:{endpoint:repo.metadata.endpoint,gitUsername}})).toThrow();
  expect(p.resource(repo.id).metadata.gitUsername).toBe('example-user');
  const args={resourceId:repo.id,workspaceId:workspace.id,branch:'feature/task-1',operation:'checkout'};expect(validateGitSync(args)).toBe(args);
  for(const branch of ['../main','main.lock','HEAD','main..x','x/.hidden','main;rm x','--help',''])expect(()=>validateGitSync({...args,branch})).toThrow();
  expect(()=>validateGitSync({...args,operation:'reset'})).toThrow();p.deleteResource(workspace.id);p.deleteResource(repo.id);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('scoped Git fetch transport supports encrypted-token Basic/Bearer auth without following redirects or unbounded bodies',async()=>{
 const observed=[],secret='synthetic-private-token';let mode='ok';
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){observed.push({authorization:req.headers.get('authorization'),type:req.headers.get('content-type')});if(mode==='redirect')return new Response(null,{status:302,headers:{location:'http://127.0.0.1/blocked'}});if(mode==='large')return new Response('x'.repeat(100));return new Response('bounded response');}});
 const target={url:new URL(server.url.href+'repo.git'),address:'127.0.0.1',family:4},gateway=new GitGateway({},{}),signal=new AbortController().signal;
 try{
  await gateway.request(target,'/repo.git/git-upload-pack','POST',Buffer.from('test'),secret,signal,{service:'git-upload-pack',username:'fixture-user'});expect(observed[0].authorization).toBe('Basic '+Buffer.from('fixture-user:'+secret).toString('base64'));expect(observed[0].type).toBe('application/x-git-upload-pack-request');
  await gateway.request(target,'/repo.git/info/refs','GET',undefined,secret,signal,{service:'git-upload-pack'});expect(observed[1].authorization).toBe('Bearer '+secret);
  mode='redirect';await expect(gateway.request(target,'/repo.git/info/refs','GET',undefined,secret,signal,{service:'git-upload-pack'})).rejects.toThrow('upstream');expect(observed.length).toBe(3);
  mode='large';await expect(gateway.request(target,'/repo.git/info/refs','GET',undefined,secret,signal,{service:'git-upload-pack',limit:16})).rejects.toThrow('bounds');
 }finally{server.stop(true);}
});
