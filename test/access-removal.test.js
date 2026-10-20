import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,mkdirSync,existsSync} from 'node:fs';
import {randomBytes,createCipheriv} from 'node:crypto';
import {join} from 'node:path';
import {openStore} from '../store.js';

test('existing access data is purged atomically while history, handoffs and encrypted provider keys survive',()=>{
 const directory=mkdtempSync('/tmp/odwyn-removal-'),file=join(directory,'odwyn.db'),key=randomBytes(32),secret='synthetic-provider-secret';
 mkdirSync(join(directory,'checkpoints'));writeFileSync(join(directory,'checkpoints','old'),'removed snapshot');
 writeFileSync(join(directory,'broker.key'),key,{mode:0o600});
 const db=new Database(file);
 db.exec(`CREATE TABLE state(id INTEGER PRIMARY KEY,value TEXT);CREATE TABLE security_meta(id INTEGER,owner_id TEXT);CREATE TABLE provider_credentials(id TEXT,slot TEXT,type TEXT,credential TEXT);
 CREATE TABLE spaces(id TEXT);CREATE TABLE grants(id TEXT);CREATE TABLE isolated_workspaces(id TEXT);CREATE TABLE data_exports(id TEXT,payload TEXT,revoked INTEGER);CREATE TABLE connectors(id TEXT,credential TEXT);`);
 const row={id:'credential',slot:'workspace',type:'openai'},iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(Buffer.from('credential:owner:workspace:openai'));
 const bytes=Buffer.concat([cipher.update(secret),cipher.final()]);
 db.query('INSERT INTO provider_credentials VALUES(?,?,?,?)').run(row.id,row.slot,row.type,Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64'));
 db.exec("INSERT INTO security_meta VALUES(1,'owner');INSERT INTO grants VALUES('removed-grant');INSERT INTO connectors VALUES('old','removed-connector-secret');");
 const state={agents:[{id:'agent'}],provider:{type:'openai',credentialRef:row.id},customization:null,conversations:[{id:'chat',agentId:'agent',spaceId:'old',messages:[{id:'message',role:'user',text:'Preserved chat'}],handoff:{sourceRoomId:'source',exportId:'export'}}],jobs:[{id:'job',agentId:'agent',spaceId:'old',securityContext:{ownerId:'owner'},workspacePin:{resourceId:'code'},checkpointConflict:{checkpointId:'head'}}],checkpoints:[{id:'old'}],executionHeads:{code:'old'},knowledge:[{id:'doc',content:'Preserved reference',resources:[{id:'old'}]}],workflows:[{inputs:[{name:'resources',default:{resourceId:'business-data'}}],steps:[{prompt:'Use odwyn_repository_branch in the authorized isolated workspace. Save checkpoints. Use odwyn_checkpoint and odwyn_run_test.',tools:['terminal','checkpoint'],workspaceResourceId:'code',room:{spaceId:'old'}}]}]};
 db.query('INSERT INTO state VALUES(1,?)').run(JSON.stringify(state));db.query('INSERT INTO data_exports VALUES(?,?,0)').run('export',JSON.stringify({roomHandoff:{result:'Preserved selected package',artifacts:[],upstreamExports:[{spaceId:'old'}]}}));db.close();
 let store;
 try{
  store=openStore(directory);
  expect(existsSync(join(directory,'checkpoints'))).toBe(false);expect(store.state.workflows[0].inputs[0].default.resourceId).toBe('business-data');
  expect(store.state.provider.apiKey).toBe(secret);expect(store.state.jobs[0].securityContext).toBeUndefined();expect(store.state.jobs[0].workspacePin).toBeUndefined();expect(store.state.checkpoints).toBeUndefined();
  expect(store.state.conversations[0].messages[0].text).toBe('Preserved chat');expect(store.state.conversations[0].handoff.package.result).toBe('Preserved selected package');expect(store.state.conversations[0].handoff.package.upstreamExports).toBeUndefined();
  expect(store.state.knowledge[0].content).toBe('Preserved reference');expect(store.state.knowledge[0].resources).toBeUndefined();expect(store.state.workflows[0].steps[0].tools).toEqual(['terminal']);expect(store.state.workflows[0].steps[0].prompt).toContain('Use odwyn_terminal with Git branch/checkout commands in the repository in the persistent host workspace. Save commits.');expect(store.state.workflows[0].steps[0].prompt).not.toMatch(/odwyn_(?:checkpoint|run_test|repository_)/);
  store.save();store.close();store=null;
  const saved=new Database(file,{readonly:true});
  expect(saved.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('grants','spaces','security_meta','connectors','data_exports','isolated_workspaces')").all()).toEqual([]);
  expect(saved.query('PRAGMA integrity_check').get().integrity_check).toBe('ok');expect(saved.query('SELECT value FROM state').get().value).not.toContain(secret);saved.close();
  expect(readFileSync(file).includes(Buffer.from('removed-connector-secret'))).toBe(false);
  store=openStore(directory);expect(store.state.provider.apiKey).toBe(secret);expect(store.search('Preserved')).toHaveLength(1);
 }finally{store?.close();rmSync(directory,{recursive:true,force:true});}
});

test('missing provider key aborts removal without dropping old data',()=>{
 const directory=mkdtempSync('/tmp/odwyn-removal-failed-'),file=join(directory,'odwyn.db'),db=new Database(file);
 db.exec("CREATE TABLE state(id INTEGER PRIMARY KEY,value TEXT);CREATE TABLE security_meta(id INTEGER,owner_id TEXT);INSERT INTO security_meta VALUES(1,'owner');CREATE TABLE grants(id TEXT);INSERT INTO grants VALUES('keep');CREATE TABLE provider_credentials(id TEXT,slot TEXT,type TEXT,credential TEXT);INSERT INTO provider_credentials VALUES('key','workspace','openai','invalid');");
 db.close();
 try{expect(()=>openStore(directory)).toThrow();const saved=new Database(file,{readonly:true});expect(saved.query('SELECT id FROM grants').get().id).toBe('keep');saved.close();}
 finally{rmSync(directory,{recursive:true,force:true});}
});

test('host terminal respects confirmation and cancellation after removing scoped execution',async()=>{
 const {Runtime}=await import('../runtime.js'),{FixtureProvider}=await import('../tests/provider.js');
 const directory=mkdtempSync('/tmp/odwyn-host-terminal-'),store=openStore(directory),provider=new FixtureProvider(),runtime=new Runtime({store,codex:provider,browser:{},workspace:directory});
 try{
  await runtime.refreshAccount();const job=runtime.submit({prompt:'Run a command'});await runtime.drain();
  const call=(id,args)=>runtime.handleRequest({id,method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool:'odwyn_terminal',arguments:args}});
  const denied=call('denied',{command:'touch denied',reason:'Test confirmation'});await Bun.sleep(5);
  expect(job.pending.type).toBe('terminal');runtime.answer(job.id,{requestId:job.pending.id,decision:'deny'});await denied;
  expect(existsSync(join(directory,'denied'))).toBe(false);expect(provider.replies.at(-1).result.success).toBe(false);
  runtime.setInteractionMode(job.id,'allow');await call('allowed',{command:'printf restored-host-terminal',reason:'Test host execution'});
  expect(provider.replies.at(-1).result.success).toBe(true);expect(provider.replies.at(-1).result.contentItems[0].text).toContain('restored-host-terminal');
  const pending=call('cancelled',{command:'sleep 30',reason:'Test cancellation'});
  for(let i=0;i<100&&!runtime.executions.size;i++)await Bun.sleep(1);
  expect(runtime.executions.size).toBe(1);await runtime.cancel(job.id);await pending;
  expect(job.status).toBe('cancelled');expect(runtime.executions.size).toBe(0);
 }finally{await runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}
});
