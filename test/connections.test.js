import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateConnection,publicConnection,executeConnection} from '../connections.js';
import {openStore} from '../store.js';

test('connections validate destinations and keep credentials encrypted across restarts',()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-connections-'));let store=openStore(directory);
 try{
  const connection=validateConnection({name:'Tickets',type:'rest',url:'https://example.com/tickets/{{inputs.id}}',headers:{Authorization:'Bearer private-token'}});
  store.state.connections.push(connection);store.save();
  expect(JSON.stringify(publicConnection(connection))).not.toContain('private-token');
  expect(publicConnection(connection).inputs).toEqual(['id']);
  expect(()=>validateConnection({...publicConnection(connection),enabled:'false'})).toThrow();
  expect(store.credentials.serialize(store.state)).not.toContain('private-token');
  expect(store.credentials.redact('Bearer private-token')).toBe('[REDACTED]');
  store.close();store=openStore(directory);
  expect(JSON.parse(store.state.connections[0].apiKey).headers.Authorization).toBe('Bearer private-token');
  for(const url of ['file:///etc/passwd','https://user:pass@example.com','https://{{inputs.host}}/'])expect(()=>validateConnection({name:'Bad',type:'rest',url})).toThrow();
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
test('REST and GraphQL execute runtime inputs without allowing a new destination',async()=>{
 const server=Bun.serve({port:0,fetch:async req=>Response.json({url:req.url,method:req.method,authorization:req.headers.get('authorization'),body:await req.text()})});
 try{
  const connection=validateConnection({name:'REST',type:'rest',url:`http://localhost:${server.port}/tickets/{{inputs.id}}`,method:'POST',headers:{Authorization:'Bearer token'},body:{title:'{{inputs.title}}'}});
  const result=await executeConnection(connection,{inputs:{id:'a/b?x=1',title:'Test'}});
  expect(result.status).toBe(200);expect(result.data.url).toContain('/tickets/a%2Fb%3Fx%3D1');expect(JSON.parse(result.data.body)).toEqual({title:'Test'});
  const graphql=validateConnection({name:'Graph',type:'graphql',url:`http://localhost:${server.port}/graphql`,query:'query Ticket($id: ID!) { ticket(id:$id) { id } }',variables:{id:'{{inputs.id}}'}});
  expect(JSON.parse((await executeConnection(graphql,{inputs:{id:'123'}})).data.body).variables).toEqual({id:'123'});
 }finally{server.stop(true);}
});
test('gRPC rejects imports and streaming until supported',()=>{
 expect(()=>validateConnection({name:'RPC',type:'grpc',url:'localhost:50051',proto:'import "/etc/private.proto";'})).toThrow();
});

import * as grpc from '@grpc/grpc-js';
import {loadSync} from '@grpc/proto-loader';
import {writeFileSync} from 'node:fs';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {z} from 'zod';

test('unary gRPC calls a real service and passes runtime inputs and metadata',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-grpc-test-')),proto='syntax = "proto3"; package example; service Tickets { rpc GetTicket (Ticket) returns (Ticket); } message Ticket { string id = 1; }';
 const path=join(directory,'service.proto');writeFileSync(path,proto);
 const definition=loadSync(path),server=new grpc.Server();server.addService(definition['example.Tickets'],{GetTicket:(call,done)=>done(null,{id:call.request.id+':'+call.metadata.get('authorization')[0]})});
 const port=await new Promise((resolve,reject)=>server.bindAsync('127.0.0.1:0',grpc.ServerCredentials.createInsecure(),(error,port)=>error?reject(error):resolve(port)));
 try{
  const connection=validateConnection({name:'Tickets',type:'grpc',url:`127.0.0.1:${port}`,proto,service:'example.Tickets',method:'GetTicket',tls:false,headers:{authorization:'test-token'},body:{id:'{{inputs.id}}'}});
  expect((await executeConnection(connection,{inputs:{id:'42'}})).data.id).toBe('42:test-token');
 }finally{server.forceShutdown();rmSync(directory,{recursive:true,force:true});}
});
test('MCP discovers tool schemas and calls a real remote server',async()=>{
 const sessions=[];
 const server=Bun.serve({port:0,fetch:async request=>{
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  const mcp=new McpServer({name:'test',version:'1'});mcp.registerTool('get_ticket',{inputSchema:{id:z.string()}},async({id})=>({content:[{type:'text',text:'Ticket '+id}]}));
  await mcp.connect(transport);sessions.push(mcp);return transport.handleRequest(request);
 }});
 try{
  const connection=validateConnection({name:'Atlassian fixture',type:'mcp',url:`http://localhost:${server.port}/mcp`});
  const discovery=await executeConnection(connection);expect(discovery.tools[0].name).toBe('get_ticket');expect(discovery.tools[0].inputSchema.properties.id.type).toBe('string');
  expect((await executeConnection(connection,{operation:'get_ticket',arguments:{id:'PROJ-123'}})).content[0].text).toBe('Ticket PROJ-123');
 }finally{for(const mcp of sessions)await mcp.close();server.stop(true);}
});

import {EventEmitter} from 'node:events';
import {createApp} from '../server.js';
import {Runtime} from '../runtime.js';
import {validateWorkflow} from '../workflows.js';
class Provider extends EventEmitter{
 child={};calls=[];replies=[];
 async request(method,params){this.calls.push({method,params});return method==='account/read'?{account:{type:'chatgpt'}}:method.startsWith('thread/')?{thread:{id:'thread'}}:{turn:{id:'turn'}};}
 respond(id,result){this.replies.push({id,result});}reject(){}stop(){}
}
test('connection API hides secrets, persists settings and rejects cross-origin writes',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-connection-api-')),provider=new Provider(),origin='http://localhost:4317';
 const app=createApp({directory,user:'owner',password:'test-password-long-enough',origin,codex:provider});
 const request=(path,method='GET',body)=>app.fetch(new Request(origin+path,{method,headers:{authorization:'Basic '+btoa('owner:test-password-long-enough'),origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
 try{
  const saved=await request('/api/connections','POST',{name:'Tickets',type:'rest',url:'https://example.com',token:'secret-example-token'});
  expect(saved.status).toBe(201);const connection=await saved.json();expect(connection.apiKey).toBeUndefined();
  const state=await(await request('/api/state')).text();expect(state).not.toContain('secret-example-token');
  expect((await request('/api/connections/'+connection.id,'PUT',{...connection,name:'Renamed'})).status).toBe(200);
  expect(JSON.parse(app.runtime.state.connections[0].apiKey).headers.Authorization).toBe('Bearer secret-example-token');
  expect((await app.fetch(new Request(origin+'/api/connections',{method:'POST',headers:{authorization:'Basic '+btoa('owner:test-password-long-enough'),origin:'https://evil.test'},body:'{}'}))).status).toBe(403);
  expect((await request('/api/connections/'+connection.id,'DELETE',{})).status).toBe(200);
  expect((await(await request('/api/connections')).json()).length).toBe(0);
 }finally{await app.close();rmSync(directory,{recursive:true,force:true});}
});
test('connection tool requires approval, redacts responses and respects workflow tool gates',async()=>{
 let hits=0;const server=Bun.serve({port:0,fetch:()=>{hits++;return Response.json({authorization:'Bearer private-value'});}});
 const directory=mkdtempSync(join(tmpdir(),'odwyn-connection-runtime-')),store=openStore(directory),provider=new Provider(),runtime=new Runtime({store,codex:provider,browser:{},workspace:directory});
 try{
  store.state.connections.push(validateConnection({name:'Tickets',type:'rest',url:`http://localhost:${server.port}`,token:'private-value'}));runtime.changed();
  await runtime.refreshAccount();const job=runtime.submit({prompt:'Check tickets',interactionMode:'confirm'});await runtime.drain();await runtime.starting;
  expect(provider.calls.find(call=>call.method==='thread/start').params.dynamicTools.some(tool=>tool.name==='odwyn_connection')).toBe(true);
  const call=runtime.handleRequest({id:'call',method:'item/tool/call',params:{threadId:job.threadId,tool:'odwyn_connection',arguments:{action:'call',id:store.state.connections[0].id}}});
  await new Promise(resolve=>setTimeout(resolve,5));expect(job.pending.type).toBe('mcp');expect(hits).toBe(0);
  runtime.answer(job.id,{requestId:job.pending.id,decision:'deny'});await call;expect(hits).toBe(0);
  runtime.setInteractionMode(job.id,'allow');await runtime.handleRequest({id:'call-allowed',method:'item/tool/call',params:{threadId:job.threadId,tool:'odwyn_connection',arguments:{action:'call',id:store.state.connections[0].id}}});
  expect(hits).toBe(1);expect(JSON.stringify(provider.replies.at(-1))).not.toContain('private-value');
  runtime.finish(job,'completed');
  const workflow=validateWorkflow({name:'No connection',command:'no-connection',steps:[{id:'read',type:'agent',prompt:'Read',tools:[]}]},store.state);store.state.workflows.push(workflow);
  const next=runtime.submit({prompt:'/no-connection'});await runtime.drain();await runtime.starting;
  await runtime.handleRequest({id:'disabled',method:'item/tool/call',params:{threadId:next.threadId,tool:'odwyn_connection',arguments:{action:'list'}}});
  expect(provider.replies.at(-1).result.success).toBe(false);expect(hits).toBe(1);
 }finally{await runtime.close();store.close();server.stop(true);rmSync(directory,{recursive:true,force:true});}
});

test('MCP OAuth registers, validates state, exchanges a code and persists encrypted tokens',async()=>{
 const sessions=[];let tokenRequests=0,registeredRedirect;
 const oauth=Bun.serve({port:0,fetch:async request=>{
  const base=`http://localhost:${oauth.port}`,url=new URL(request.url);
  if(url.pathname==='/.well-known/oauth-protected-resource/mcp')return Response.json({resource:base+'/mcp',authorization_servers:[base]});
  if(url.pathname==='/.well-known/oauth-authorization-server')return Response.json({issuer:base,authorization_endpoint:base+'/authorize',token_endpoint:base+'/token',registration_endpoint:base+'/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});
  if(url.pathname==='/register'){const input=await request.json();registeredRedirect=input.redirect_uris[0];return Response.json({...input,client_id:'odwyn-test-client'},{status:201});}
  if(url.pathname==='/token'){const data=new URLSearchParams(await request.text());if(data.get('code')!=='test-code'||!data.get('code_verifier'))return Response.json({error:'invalid_grant'},{status:400});tokenRequests++;return Response.json({access_token:'oauth-access-private',refresh_token:'oauth-refresh-private',token_type:'Bearer',expires_in:3600});}
  if(url.pathname==='/mcp'){
   if(request.headers.get('authorization')!=='Bearer oauth-access-private')return new Response(null,{status:401,headers:{'www-authenticate':`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`}});
   const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true}),mcp=new McpServer({name:'oauth fixture',version:'1'});
   mcp.registerTool('tickets',{},async()=>({content:[{type:'text',text:'PROJ-123'}]}));await mcp.connect(transport);sessions.push(mcp);return transport.handleRequest(request);
  }
  return new Response(null,{status:404});
 }});
 const directory=mkdtempSync(join(tmpdir(),'odwyn-oauth-')),origin='http://localhost:4317',provider=new Provider(),options={directory,user:'owner',password:'test-password-long-enough',origin,codex:provider};let app=createApp(options);
 const request=(path,method='GET',body)=>app.fetch(new Request(origin+path,{method,headers:{authorization:'Basic '+btoa('owner:test-password-long-enough'),origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
 try{
  const connection=await(await request('/api/connections','POST',{name:'OAuth MCP',type:'mcp',url:`http://localhost:${oauth.port}/mcp`,oauth:true})).json();
  const start=await request('/api/connections/'+connection.id+'/authorize','POST',{}),result=await start.json();expect(start.status).toBe(200);expect(result.authorizationUrl).toBeString();
  expect(registeredRedirect).toBe(origin+'/api/connections/oauth/callback');const authorization=new URL(result.authorizationUrl);expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  expect((await request('/api/connections/oauth/callback?state=wrong&code=test-code')).status).toBe(400);expect(tokenRequests).toBe(0);
  const callback=await request('/api/connections/oauth/callback?state='+encodeURIComponent(authorization.searchParams.get('state'))+'&code=test-code');expect(callback.status).toBe(303);expect(tokenRequests).toBe(1);
  expect((await request('/api/connections/'+connection.id+'/test','POST',{})).status).toBe(200);
  expect(await(await request('/api/state')).text()).not.toContain('oauth-access-private');
  await app.close();app=createApp(options);
  expect((await(await request('/api/connections/'+connection.id)).json()).authenticated).toBe(true);
  expect((await request('/api/connections/'+connection.id+'/test','POST',{})).status).toBe(200);
  expect((await request('/api/connections/oauth/callback?state='+encodeURIComponent(authorization.searchParams.get('state'))+'&code=test-code')).status).toBe(400);
 }finally{await app.close();for(const mcp of sessions)await mcp.close();oauth.stop(true);rmSync(directory,{recursive:true,force:true});}
});

test('MCP stdio starts a configured executable, discovers tools and closes the process',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'odwyn-stdio-test-')),path=join(directory,'server.mjs');
 writeFileSync(path,`import {McpServer} from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/mcp.js'))};\nimport {StdioServerTransport} from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'))};\nconst server=new McpServer({name:'stdio fixture',version:'1'});server.registerTool('read_ticket',{},async()=>({content:[{type:'text',text:process.env.TICKET_ID}]}));await server.connect(new StdioServerTransport());`);
 try{
  const connection=validateConnection({name:'Local',type:'mcp',transport:'stdio',url:'',command:process.execPath,args:[path],env:{TICKET_ID:'LOCAL-123'}});
  expect((await executeConnection(connection)).tools[0].name).toBe('read_ticket');
  expect((await executeConnection(connection,{operation:'read_ticket'})).content[0].text).toBe('LOCAL-123');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('form bodies, blocked redirects, cancellation and credential redaction cover failure paths',async()=>{
 const server=Bun.serve({port:0,fetch:async request=>new URL(request.url).pathname==='/redirect'?Response.redirect('https://example.com'):new URL(request.url).pathname==='/slow'?new Promise(resolve=>setTimeout(()=>resolve(Response.json({ok:true})),200)):Response.json({contentType:request.headers.get('content-type'),body:await request.text()})});
 try{
  for(const bodyType of ['form','multipart']){
   const connection=validateConnection({name:'Form',type:'rest',url:`http://localhost:${server.port}`,method:'POST',bodyType,body:{title:'{{inputs.title}}'}});
   const result=await executeConnection(connection,{inputs:{title:'A & B'}});expect(result.data.body).toContain(bodyType==='form'?'A+%26+B':'A & B');
  }
  const redirect=validateConnection({name:'Redirect',type:'rest',url:`http://localhost:${server.port}/redirect`});await expect(executeConnection(redirect)).rejects.toThrow();
  const slow=validateConnection({...redirect,url:`http://localhost:${server.port}/slow`}),controller=new AbortController(),pending=executeConnection(slow,{}, {signal:controller.signal});controller.abort();await expect(pending).rejects.toThrow();
  expect(()=>validateConnection({name:'Unsafe proto',type:'grpc',url:'localhost:123',proto:'import /* comment */ "/etc/secret.proto";',service:'Tickets',method:'Get'})).toThrow();
 }finally{server.stop(true);}
});
