import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {AIProvider,validateProvider} from '../providers.js';
import {AntigravityHeadless} from '../antigravity.js';
import {openStore} from '../store.js';
import {Runtime} from '../runtime.js';
import {defaults} from '../public/profile.js';
const command=resolve(import.meta.dir,'../tests/antigravity-cli.js');
const wait=async condition=>{for(let i=0;i<500&&!condition();i++)await Bun.sleep(10);expect(condition()).toBe(true);};
function fixture(model){
 const directory=mkdtempSync(join(tmpdir(),'odwyn-antigravity-')),store=openStore(directory),config=join(directory,'config');mkdirSync(config);
 const provider=new AIProvider({config:validateProvider({type:'antigravity',model}),workspace:directory,antigravityCommand:command,antigravityConfigDirectory:config,codex:Object.assign(new EventEmitter(),{stop(){}})});
 provider.antigravity.env.ODWYN_AGY_TEST_DIRECTORY=config;
 const runtime=new Runtime({store,codex:provider,browser:{action:async()=>({image:'aGVsbG8=',text:'Screenshot'})},workspace:directory});
 return {directory,config,store,provider,runtime,capture:()=>JSON.parse(readFileSync(join(config,'capture.json'),'utf8')),close:async()=>{await runtime.close();store.close();rmSync(directory,{recursive:true,force:true});}};
}
test('Antigravity routes tools and owner approvals, records usage and cleans private agent files',async()=>{
 const f=fixture('tools');try{
  await f.runtime.refreshAccount();expect(f.runtime.account.type).toBe('antigravity');
  const job=f.runtime.submit({prompt:'Research hotels',interactionMode:'allow'});await wait(()=>job.status==='waiting');
  f.runtime.answer(job.id,{requestId:job.pending.id,answer:'Two million'});await wait(()=>['completed','failed'].includes(job.status));
  expect(job.error).toBeFalsy();expect(job.usage).toMatchObject({totalTokens:24,cachedInputTokens:5,reasoningTokens:2,costUSD:null});
  const capture=f.capture();expect(capture.unauthorized).toBe(403);expect(capture.browserOrigin).toBe(403);expect(capture.blockedUnknown).toBe(true);
  expect(capture.answer.content[0].text).toContain('Two million');expect(capture.browser.content.some(part=>part.type==='image')).toBe(true);
  expect(capture.settings).toMatchObject({tools:[],inheritCustomizations:false,excludeDefaultComponents:true,subagent:false});expect(capture.settingsMode).toBe(0o600);
  expect(f.runtime.conversation(job).messages.at(-1).text).toBe('Antigravity done.');await wait(()=>!existsSync(capture.cwd));
 }finally{await f.close();}
},15000);
test('Antigravity carries automatic skills, knowledge and saved chat context',async()=>{
 const f=fixture('default');try{
  const skill={id:'auto-check',name:'Automatic checks',command:'auto-check',instructions:'AUTO_SKILL'};f.store.state.skills=[skill];
  const doc=f.store.knowledge.create({name:'Reference',content:'AUTO_KNOWLEDGE'});f.store.state.customization={...defaults,name:'Researcher',skillIds:[skill.id],knowledgeIds:[doc.id]};await f.runtime.refreshAccount();
  const first=f.runtime.submit({prompt:'Discuss @/etc/passwd'});await wait(()=>first.status==='completed');
  expect(f.capture().system).toContain('AUTO_SKILL');expect(f.capture().system).toContain('AUTO_KNOWLEDGE');expect(f.capture().args).not.toContain('--model');
  const next=f.runtime.submit({conversationId:first.conversationId,prompt:'Continue'});await wait(()=>next.status==='completed');expect(f.capture().input).toContain('Antigravity done.');
 }finally{await f.close();}
},10000);
for(const model of ['failure','malformed','empty'])test(`Antigravity ${model} fails without leaking stderr`,async()=>{
 const f=fixture(model);try{await f.runtime.refreshAccount();const job=f.runtime.submit({prompt:'Check failure'});await wait(()=>job.status==='failed');expect(job.error).not.toContain('private-secret-token');if(model==='failure')expect(job.usage.totalTokens).toBe(14);await wait(()=>!existsSync(f.capture().cwd));}finally{await f.close();}
});
test('Antigravity cancellation kills its process and releases the bridge',async()=>{
 const f=fixture('hanging');try{await f.runtime.refreshAccount();const job=f.runtime.submit({prompt:'Wait'});await wait(()=>existsSync(join(f.config,'capture.json')));const capture=f.capture();await f.runtime.cancel(job.id);await wait(()=>!existsSync(capture.cwd));expect(job.status).toBe('cancelled');expect(()=>process.kill(capture.pid,0)).toThrow();}finally{await f.close();}
});
test('Antigravity rejects credit overages, API mode and missing CLI',async()=>{
 const f=fixture('default');try{
  expect(validateProvider({type:'gemini'})).toMatchObject({type:'antigravity',model:'default'});
  const bridge=f.provider.antigravity;expect(bridge.env.GEMINI_API_KEY).toBeUndefined();expect(bridge.env.AGY_ADC_AUTH).toBeUndefined();
  mkdirSync(join(f.config,'antigravity-cli'));const path=join(f.config,'antigravity-cli/settings.json');
  writeFileSync(path,JSON.stringify({useG1Credits:true}));await expect(bridge.account()).rejects.toThrow('Never');
  writeFileSync(path,JSON.stringify({modelProvider:'gemini'}));await expect(bridge.account()).rejects.toThrow('personal-account');
  writeFileSync(path,'invalid');await expect(bridge.account()).rejects.toThrow('unreadable');
  const missing=new AntigravityHeadless({command:join(f.directory,'missing')});await expect(missing.account()).rejects.toThrow('Install');
 }finally{await f.close();}
});

test('Antigravity uploaded images stay behind the authenticated MCP bridge',async()=>{
 const f=fixture('tools');try{
  const run={config:{model:'tools'},thread:{developerInstructions:'Inspect uploaded images.',history:[],dynamicTools:[]},controller:new AbortController()};
  const reports=[];
  const provider={notify(){},taskUsage(_run,value){reports.push(value);},message(){},invoke:async()=>({success:true,contentItems:[{type:'inputText',text:'fixture'}]})};
  run.thread.dynamicTools=['odwyn_ask','odwyn_browser','odwyn_terminal'].map(name=>({name,description:name,inputSchema:{type:'object',properties:{}}}));
  await f.provider.antigravity.run(provider,run,{input:[{type:'image',url:'data:image/png;base64,aGVsbG8='}]});
  expect(f.capture().images.content[0]).toEqual({type:'image',mimeType:'image/png',data:'aGVsbG8='});
  expect(f.capture().input).not.toContain('aGVsbG8=');expect(reports[0].costUSD).toBeNull();
 }finally{await f.close();}
});
