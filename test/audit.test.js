import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,createJob} from '../store.js';
import {usage,sumUsage} from '../usage.js';
import {Runtime} from '../runtime.js';

test('usage preserves unknown charges, aggregates API calls and excludes Claude estimates',()=>{
  expect(usage({input_tokens:10,cache_read_input_tokens:5,cache_creation_input_tokens:2,output_tokens:3,total_cost_usd:1},'claude')).toMatchObject({inputTokens:17,totalTokens:20,costUSD:null});
  const report=usage({prompt_tokens:30,completion_tokens:5,total_tokens:35,prompt_tokens_details:{cached_tokens:10},cost:.002},'openrouter');
  expect(sumUsage([report,report])).toMatchObject({totalTokens:70,cachedInputTokens:20,costUSD:.004,partial:false,costPartial:false});
  expect(sumUsage([report,null])).toMatchObject({totalTokens:35,partial:true,costPartial:true});
  expect(usage({total_tokens:-1,prompt_tokens:'10',cost:NaN},'openrouter').totalTokens).toBeNull();
  expect(usage({total_tokens:12,input_tokens:10,output_tokens:2,cache_read_tokens:3,thinking_tokens:1},'antigravity')).toMatchObject({totalTokens:12,cachedInputTokens:3,costUSD:null});
});

test('audit paginates, filters, retains uncapped redacted events and survives chat deletion and restart',()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-audit-'));let store=openStore(directory);
  try{
    store.state.provider={type:'openai',apiKey:'audit-private-secret'};
    for(let i=0;i<25;i++){
      const job=createJob(store.state,{prompt:'Task '+i});job.createdAt=new Date(Date.UTC(2026,0,i+1)).toISOString();job.status='completed';
      job.startedAt=job.createdAt;job.endedAt=new Date(Date.parse(job.startedAt)+1234).toISOString();
      store.save();
    }
    const job=store.state.jobs[0];job.prompt='audit-private-secret';job.providerSnapshot={type:'claude',model:'sonnet'};store.save();
    expect(JSON.stringify(store.audit.detail(job.id,new URLSearchParams()))).not.toContain('audit-private-secret');
    expect(store.audit.detail(job.id,new URLSearchParams()).provider).toEqual({type:'claude',model:'sonnet'});
    for(let i=0;i<245;i++){job.events.push({id:crypto.randomUUID(),at:new Date().toISOString(),label:'Tool',detail:String(i)});if(job.events.length>240)job.events.shift();store.save();}
    expect(store.audit.list(new URLSearchParams()).rows).toHaveLength(20);
    expect(store.audit.list(new URLSearchParams('page=2')).rows).toHaveLength(5);
    expect(store.audit.list(new URLSearchParams({from:'2026-01-20T00:00:00.000Z',to:'2026-01-21T00:00:00.000Z'})).total).toBe(2);
    expect(store.audit.list(new URLSearchParams('agent=unknown')).total).toBe(0);
    expect(()=>store.audit.list(new URLSearchParams('from=invalid'))).toThrow('Invalid audit time');
    expect(store.audit.detail(job.id,new URLSearchParams()).total).toBe(245);
    store.deleteConversation(job.conversationId);expect(store.audit.list(new URLSearchParams()).total).toBe(25);
    store.close();store=openStore(directory);
    expect(store.audit.detail(job.id,new URLSearchParams('page=5')).events).toHaveLength(45);
    expect(store.audit.detail(job.id,new URLSearchParams()).endedAt).toBe(job.endedAt);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
},15000);

test('Codex cumulative usage counts each task increment once, including cached tokens',()=>{
  const session={auditTokenTotal:{totalTokens:100,inputTokens:80,outputTokens:20,cachedInputTokens:10}};
  const job={threadId:'thread',turnId:'turn',agentId:'agent',status:'running'};
  const runtime={active:job,store:{credentials:{sanitize:value=>value}},conversation:()=>({sessions:{agent:session}}),changed(){}};
  const notify=total=>Runtime.prototype.notification.call(runtime,{method:'thread/tokenUsage/updated',params:{threadId:'thread',turnId:'turn',tokenUsage:{total,last:total}}});
  const total={totalTokens:150,inputTokens:120,outputTokens:30,cachedInputTokens:15};
  notify(total);notify(total);
  expect(job.usage).toMatchObject({totalTokens:50,inputTokens:40,outputTokens:10,cachedInputTokens:5,costUSD:null,partial:false});
  runtime.active={threadId:'thread',turnId:'next',agentId:'agent',status:'running'};
  Runtime.prototype.notification.call(runtime,{method:'thread/tokenUsage/updated',params:{threadId:'thread',turnId:'turn',tokenUsage:{total}}});
  expect(runtime.active.usage).toBeUndefined();
});

test('API task usage includes tool requests and retains usage before a failed response',async()=>{
  const {AIProvider}=await import('../providers.js');
  let calls=0,reported;
  const run={config:{baseUrl:'https://openrouter.ai/api/v1',model:'test'},thread:{developerInstructions:'test',dynamicTools:[]},controller:new AbortController()};
  const provider={fetch:async()=>Response.json({usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12,cost:.001},choices:[calls++?{message:{role:'assistant',content:'partial'},finish_reason:'length'}:{message:{role:'assistant',tool_calls:[{id:'tool',type:'function',function:{name:'test',arguments:'{}'}}]}}]}),
    invoke:async()=>({contentItems:[]}),message(){},taskUsage:AIProvider.prototype.taskUsage,notify(_run,_method,params){reported=params.usage;}};
  await expect(AIProvider.prototype.runAPI.call(provider,run,{input:[{type:'text',text:'test'}]})).rejects.toThrow('stopped before completing');
  expect(reported).toMatchObject({totalTokens:24,costUSD:.002,partial:false,costPartial:false});
});
