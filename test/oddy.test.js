import { test, expect } from 'bun:test';
import { oddyAction, oddyScreen, oddyTool, oddyHistory } from '../oddy.js';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

class FakeCodex extends EventEmitter {
  child={};calls=[];replies=[];
  async request(method,params){
    this.calls.push({method,params});
    if(method==='account/read')return {account:{type:'chatgpt'}};
    if(method.startsWith('thread/'))return {thread:{id:params.threadId||`thread-${this.calls.length}`}};
    if(method==='turn/start')return {turn:{id:`turn-${this.calls.length}`}};
    return {};
  }
  respond(id,result){this.replies.push({id,result});}
  reject(){}stop(){}
}
async function until(check){for(let i=0;i<200;i++){const result=await check();if(result)return result;await Bun.sleep(5);}throw Error('Timed out waiting for fake provider.');}

test('Oddy accepts fixed management operations, never arbitrary owner routes or credentials', () => {
  expect(()=>oddyAction({action:'create_agent',parameters:{name:'Engineer',role:'Senior Engineer'}})).toThrow('unsupported fields: role');
  expect(oddyTool.inputSchema.properties.parameters.properties.specialization.type).toBe('string');
  expect(oddyTool.inputSchema.properties.parameters.additionalProperties).toBe(false);
  expect(()=>oddyScreen({view:'chat',password:'secret'})).toThrow();
  expect(oddyAction({action:'create_workspace',parameters:{name:'Research'}})).toMatchObject({path:'/api/workspaces',method:'POST',destructive:false});
  expect(oddyAction({action:'delete_workspace',workspaceId:'default'}).destructive).toBe(true);
  for(const input of [
    {action:'fetch',parameters:{path:'/api/security/reauth'}},
    {action:'create_agent',parameters:{name:'Scout',provider:{apiKey:'secret'}}},
    {action:'run_job',workspaceId:'../oddy',parameters:{prompt:'Hello'}},
    {action:'delete_agent',targetId:'../provider'},
    {action:'run_job',parameters:{prompt:'Hello',interactionMode:'allow'}},
    {action:'create_workspace',parameters:{name:'Research'},confirm:true},
  ]) expect(()=>oddyAction(input)).toThrow();
});

test('Oddy history is paginated, redacted before chunking and rejects arbitrary collections',()=>{
  const records=[{id:'old',text:'A'.repeat(13000)+'secret-value'},{id:'new',text:'Recent'}];
  const sanitize=value=>JSON.parse(JSON.stringify(value).replaceAll('secret-value','[REDACTED]'));
  const page=oddyHistory(records,oddyAction({action:'search_history',parameters:{collection:'messages',limit:1}}),sanitize);
  expect(page.total).toBe(2);expect(page.nextOffset).toBe(1);
  let offset=0,text='',next;
  do{next=oddyHistory(records,oddyAction({action:'read_history',targetId:'old',parameters:{collection:'messages',offset}}),sanitize);text+=next.text;offset=next.nextOffset;}while(offset!==null);
  expect(JSON.parse(text).text).toBe('A'.repeat(13000)+'[REDACTED]');
  expect(()=>oddyAction({action:'read_history',targetId:'old',parameters:{collection:'provider_credentials'}})).toThrow();
  expect(()=>oddyAction({action:'search_history',parameters:{collection:'messages',limit:51}})).toThrow();
});

test('Oddy operates across workspaces independently and binds deletion to an explicit owner decision', async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-oddy-')),codex=new FakeCodex();
  const options={directory,user:'owner',password:'test-password-long-enough',origin:'https://assistant.test',providerOptions:{codex}};
  let app=createApp(options),callId=0;
  const headers={authorization:'Basic '+Buffer.from('owner:'+options.password).toString('base64'),origin:options.origin,'content-type':'application/json'};
  const request=(path,method='GET',body)=>app.fetch(new Request(options.origin+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})}));
  const read=async()=>await (await request('/api/oddy')).json();
  let thread,turn;
  const tool=(arguments_,name='odwyn_manage',approve=true)=>{
    const id=++callId;codex.emit('request',{id,method:'item/tool/call',params:{threadId:thread,turnId:turn,tool:name,arguments:arguments_}});
    return until(async()=>{
      if(approve&&!arguments_.action?.startsWith('delete_')){
        const pending=await read();
        if(pending.job?.pending?.type==='oddy-confirmation')await request('/api/oddy/answer','POST',{jobId:pending.job.id,requestId:pending.job.pending.id,decision:'allow'});
      }
      return codex.replies.find(reply=>reply.id===id)?.result;
    });
  };
  try{
    expect((await app.fetch(new Request(options.origin+'/api/oddy'))).status).toBe(401);
    expect((await app.fetch(new Request(options.origin+'/api/oddy',{headers:{authorization:'Bearer invalid'}}))).status).toBe(403);
    expect((await app.fetch(new Request(options.origin+'/api/oddy',{method:'POST',headers:{...headers,origin:'https://evil.test'},body:'{}'}))).status).toBe(403);
    const workspace=await (await request('/api/workspaces','POST',{name:'Research'})).json();
    const form=new FormData();form.append('file',new File(['Owner supplied reference'], 'brief.txt'));
    const uploaded=await app.fetch(new Request(options.origin+'/api/oddy/files',{method:'POST',headers:{authorization:headers.authorization,origin:headers.origin},body:form}));
    expect(uploaded.status).toBe(201);const file=await uploaded.json();
    expect((await request('/api/oddy/files/'+file.id)).status).toBe(200);
    expect((await request('/api/files/'+file.id)).status).toBe(404);
    expect((await request('/api/oddy','POST',{prompt:'Wrong file',attachments:['not-an-upload']})).status).toBe(400);
    await until(()=>app.runtime.account);
    const busy=app.runtime.submit({prompt:'Existing work'});await app.runtime.drain();
    await app.runtime.handleRequest({id:-1,method:'item/tool/call',params:{threadId:busy.threadId,turnId:busy.turnId,tool:'odwyn_manage',arguments:{action:'list_workspaces'}}});
    expect(codex.replies.find(reply=>reply.id===-1).result.success).toBe(false);
    expect((await request('/api/oddy','POST',{prompt:'Help me run this platform',workspaceId:workspace.id,attachments:[file.id],screen:{view:'chat',dialog:'settings-dialog',section:'resources'}})).status).toBe(200);
    await until(()=>codex.calls.filter(call=>call.method==='turn/start').length===2);
    const threadCall=codex.calls.filter(call=>call.method==='thread/start').at(-1);
    expect(threadCall.params.developerInstructions).toContain('You are Oddy');
    expect(threadCall.params.developerInstructions).toContain(workspace.id);
    expect(threadCall.params.developerInstructions).toContain('resources');
    expect(threadCall.params.dynamicTools.map(tool=>tool.name)).toEqual(['odwyn_manage','odwyn_ask']);
    const start=codex.calls.filter(call=>call.method==='turn/start').at(-1);thread=start.params.threadId;
    expect(JSON.stringify(start.params.input)).toContain('Owner supplied reference');
    // turn IDs are returned by the fake, not passed to turn/start.
    turn=`turn-${codex.calls.indexOf(start)+1}`;
    expect((await tool({action:'inspect_workspace'})).success).toBe(true);
    const inspection=await tool({action:'inspect_workspace'});
    expect(JSON.parse(inspection.contentItems[0].text).workspace.id).toBe(workspace.id);
    expect((await (await request('/api/oddy?workspace='+workspace.id)).json()).messages[0].text).toBe('Help me run this platform');
    app.runtime.conversation(busy).messages.push({id:'private',role:'assistant',text:'PRIVATE_CONVERSATION_CONTENT',at:new Date().toISOString()});
    expect(JSON.stringify(await tool({action:'inspect_workspace',workspaceId:'default'}))).not.toContain('PRIVATE_CONVERSATION_CONTENT');
    app.runtime.state.globalProvider.apiKey='protected-history-canary';app.runtime.state.preferences='Prefer short replies. protected-history-canary';app.runtime.changed();
    const found=await tool({action:'search_history',workspaceId:'default',parameters:{collection:'messages',query:'PRIVATE_CONVERSATION_CONTENT'}});
    expect(found.success).toBe(true);expect(JSON.parse(found.contentItems[0].text).records[0].id).toBe('private');
    const history=await tool({action:'read_history',workspaceId:'default',targetId:'private',parameters:{collection:'messages'}});
    expect(JSON.parse(JSON.parse(history.contentItems[0].text).text).text).toBe('PRIVATE_CONVERSATION_CONTENT');
    expect((await tool({action:'read_history',workspaceId:workspace.id,targetId:'private',parameters:{collection:'messages'}})).success).toBe(false);
    const preferences=await tool({action:'read_history',workspaceId:'default',targetId:'preferences',parameters:{collection:'configuration'}});
    expect(JSON.parse(preferences.contentItems[0].text).text).toContain('Prefer short replies');
    expect(JSON.stringify(preferences)).not.toContain('protected-history-canary');
    for(const collection of ['audit','memory','approvals','exports'])expect((await tool({action:'search_history',workspaceId:'default',parameters:{collection}})).success).toBe(true);
    expect((await tool({action:'cancel_job',workspaceId:'default',targetId:busy.id})).success).toBe(true);
    expect(busy.status).toBe('cancelled');
    const deniedWrite=tool({action:'create_agent',parameters:{name:'Denied'}},'odwyn_manage',false);
    const approval=await until(async()=>{const value=await read();return value.job?.pending?value:null;});
    expect(approval.job.pending.proposal.parameters.name).toBe('Denied');
    expect((await (await request('/api/state?workspace='+workspace.id)).json()).agents).toHaveLength(1);
    await request('/api/oddy/answer','POST',{jobId:approval.job.id,requestId:approval.job.pending.id,decision:'deny'});
    expect(JSON.parse((await deniedWrite).contentItems[0].text)).toEqual({cancelled:true});
    expect((await request('/api/oddy/provider','PUT',{inherit:false,provider:{type:'codex',model:'other'}})).status).toBe(400);
    expect(await tool({action:'create_agent',parameters:{name:'Scout'}})).toMatchObject({success:true});
    const createdAgents=(await (await request('/api/state?workspace='+workspace.id)).json()).agents;
    expect(createdAgents).toHaveLength(2);
    expect((await tool({action:'update_agent',targetId:createdAgents[1].id,parameters:{specialization:'Research'}})).success).toBe(true);
    expect((await (await request('/api/state?workspace='+workspace.id)).json()).agents[1].customization.name).toBe('Scout');
    const staleWrite=tool({action:'update_agent',targetId:createdAgents[1].id,parameters:{specialization:'Stale proposal'}},'odwyn_manage',false);
    const stale=await until(async()=>{const value=await read();return value.job?.pending?value:null;});
    const currentAgent=(await (await request('/api/state?workspace='+workspace.id)).json()).agents[1];
    expect((await request('/api/customization?workspace='+workspace.id+'&agentId='+currentAgent.id,'PUT',{...currentAgent.customization,name:'Changed elsewhere'})).status).toBe(200);
    await request('/api/oddy/answer','POST',{jobId:stale.job.id,requestId:stale.job.pending.id,decision:'allow'});
    expect((await staleWrite).success).toBe(false);
    expect((await (await request('/api/state?workspace='+workspace.id)).json()).agents[1].customization.specialization).toBe('Research');
    const workflowResult=await tool({action:'create_workflow',parameters:{name:'Progress check',command:'progress_check',autoAdvance:true,steps:[{id:'check',type:'agent',prompt:'Report progress',tools:['ask']}]}});
    expect(workflowResult.success).toBe(true);
    const workflow=JSON.parse(workflowResult.contentItems[0].text);
    const updated=await tool({action:'update_workflow',targetId:workflow.id,parameters:{description:'Daily progress'}});
    expect(JSON.parse(updated.contentItems[0].text)).toMatchObject({description:'Daily progress',autoAdvance:true,steps:workflow.steps});
    const launched=await tool({action:'run_workflow',targetId:workflow.id});
    expect(launched.success).toBe(true);
    const launchedJob=JSON.parse(launched.contentItems[0].text);
    expect((await tool({action:'cancel_job',targetId:launchedJob.id})).success).toBe(true);
    expect((await request('/api/oddy','POST',{prompt:'Bypass',workspaceId:'../oddy'})).status).toBe(400);
    expect(app.runtime.state.agents).toHaveLength(1);
    expect((await tool({action:'read'},'odwyn_terminal')).success).toBe(false);
    const deletion=tool({action:'delete_workspace',workspaceId:workspace.id});
    const pending=await until(async()=>{const value=await read();return value.job?.pending?value:null;});
    expect(pending.job.pending.type).toBe('oddy-confirmation');
    expect((await request('/api/oddy/answer','POST',{jobId:pending.job.id,requestId:pending.job.pending.id,decision:'allow-run'})).status).toBe(400);
    expect((await request('/api/oddy/answer','POST',{jobId:pending.job.id,requestId:pending.job.pending.id,decision:'deny'})).status).toBe(200);
    expect(JSON.parse((await deletion).contentItems[0].text)).toEqual({cancelled:true});
    expect((await request('/api/state?workspace='+workspace.id)).status).toBe(200);
    const confirmed=tool({action:'delete_workspace',workspaceId:workspace.id});
    const next=await until(async()=>{const value=await read();return value.job?.pending?value:null;});
    await request('/api/oddy/answer','POST',{jobId:next.job.id,requestId:next.job.pending.id,decision:'allow'});
    expect(await confirmed).toMatchObject({success:true});
    expect((await request('/api/state?workspace='+workspace.id)).status).toBe(404);
    expect((await request('/api/oddy/answer','POST',{jobId:next.job.id,requestId:next.job.pending.id,decision:'allow'})).status).toBe(400);
    await request('/api/oddy/cancel','POST',{jobId:next.job.id});
    expect((await (await request('/api/oddy/provider')).json()).inherit).toBe(true);
    const configured=await request('/api/oddy/provider','PUT',{inherit:false,provider:{type:'openai',model:'local-test',baseUrl:'http://127.0.0.1:1/v1',apiKey:'oddy-test-key'}});
    expect(configured.status).toBe(200);expect(JSON.stringify(await configured.json())).not.toContain('oddy-test-key');
    const custom=await (await request('/api/oddy/provider')).json();expect(custom.inherit).toBe(false);expect(custom.provider.model).toBe('local-test');
    expect(app.runtime.state.globalProvider.model).not.toBe('local-test');
    expect((await request('/api/oddy/provider','PUT',{inherit:true})).status).toBe(200);
    const original=(await read()).conversationId;
    expect((await request('/api/oddy/new','POST',{})).status).toBe(200);expect((await read()).messages).toEqual([]);
    const second=await (await request('/api/oddy','POST',{prompt:'Second Oddy chat'})).json();
    expect(second.conversationId).not.toBe(original);expect(second.conversations).toHaveLength(2);
    expect((await request('/api/oddy/clear','POST',{confirm:true})).status).toBe(400);
    await request('/api/oddy/cancel','POST',{jobId:second.job.id});
    await request('/api/oddy/select','POST',{conversationId:original});
    expect((await read()).messages[0].text).toBe('Help me run this platform');
    expect((await request('/api/oddy/clear','POST',{})).status).toBe(400);
    expect((await request('/api/oddy/clear','POST',{confirm:true,conversationId:second.conversationId})).status).toBe(400);
    expect((await request('/api/oddy/clear','POST',{confirm:true,conversationId:original})).status).toBe(200);
    expect((await read()).messages).toEqual([]);expect((await read()).conversations).toHaveLength(1);
    expect(app.runtime.state.conversations.some(row=>row.id===busy.conversationId)).toBe(true);
    await request('/api/oddy/select','POST',{conversationId:second.conversationId});
    await request('/api/oddy/provider','PUT',{inherit:false,provider:{type:'codex',model:'custom-oddy'}});
    await app.close();app=createApp(options);
    expect((await (await request('/api/oddy/provider')).json())).toMatchObject({inherit:false,provider:{model:'custom-oddy'}});
    await request('/api/oddy/provider','PUT',{inherit:true});
    expect((await read()).messages[0].text).toBe('Second Oddy chat');
    expect((await (await request('/api/workspaces')).json()).workspaces).toHaveLength(1);
  }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});
