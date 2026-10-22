import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as grpc from '@grpc/grpc-js';
import {loadSync} from '@grpc/proto-loader';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {interpolate} from './workflows.js';
import {textInput} from './security.js';

const record=value=>value && typeof value==='object' && !Array.isArray(value);
const optional=(value,max=20000)=>value===undefined||value===''?'':textInput(value,max);
function stringMap(value={}){
 if(!record(value)||Object.keys(value).length>100||Object.entries(value).some(([key,value])=>!key||typeof value!=='string'||key.length>200||value.length>10000))throw Error('Use an object of up to 100 string values.');
 return {...value};
}
export function connectionSecrets(connection){return JSON.parse(connection.apiKey||'{}');}
function decodeUrlInputs(url){
 return url.replace(/%7B%7B(.*?)%7D%7D/gi,encoded=>{
  try{const decoded=decodeURIComponent(encoded);return /^\{\{\s*inputs\.[\w.-]+\s*\}\}$/.test(decoded)?decoded:encoded;}
  catch{return encoded;}
 });
}
export function publicConnection(connection){
 const {apiKey,...result}=connection,secret=connectionSecrets(connection);
 const inputs=[...new Set([...JSON.stringify([decodeUrlInputs(connection.url),connection.body,connection.variables,secret.headers]).matchAll(/\{\{\s*inputs\.([\w-]+)/g)].map(match=>match[1]))];
 return {...result,inputs,hasCredentials:!!(Object.keys(secret.headers||{}).length||Object.keys(secret.env||{}).length||secret.oauth?.tokens),authenticated:!!secret.oauth?.tokens};
}
export function validateConnection(input,previous){
 if(!record(input)||!['rest','graphql','grpc','mcp'].includes(input.type))throw Error('Choose REST, GraphQL, gRPC or MCP.');
 for(const field of ['enabled','tls','oauth'])if(input[field]!==undefined&&typeof input[field]!=='boolean')throw Error('Use a boolean for '+field+'.');
 const type=input.type,name=textInput(input.name,80),transport=type==='mcp'?(input.transport||'http'):undefined;
 const url=optional(input.url,4000),timeoutMs=input.timeoutMs??30000;
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)throw Error('Timeout must be 1000–120000 ms.');
 if(type==='grpc'){
  if(!/^(?:[a-zA-Z0-9.-]+|\[[\da-fA-F:]+\]):\d{1,5}$/.test(url)||Number(url.split(':').at(-1))>65535||Number(url.split(':').at(-1))<1)throw Error('Use a gRPC host:port.');
 }else if(transport!=='stdio'){
  const authority=decodeUrlInputs(url).match(/^https?:\/\/([^/?#]*)/i)?.[1];
  const parsed=new URL(url.replace(/\{\{\s*inputs\.[\w.-]+\s*\}\}/g,'placeholder'));
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.hash||!authority||authority.includes('{{')||url.includes('\\'))throw Error('Use an HTTP(S) URL without credentials, fragments or dynamic hosts.');
  if(type==='mcp'&&url.includes('{{'))throw Error('MCP server URLs cannot contain runtime inputs.');
 }
 const same=previous?.type===type&&previous?.url===url&&previous?.transport===transport&&(transport!=='stdio'||previous.command===input.command&&JSON.stringify(previous.args)===JSON.stringify(input.args||[]));
 const secret=same?connectionSecrets(previous):{};
 if(input.headers!==undefined)secret.headers=stringMap(input.headers);
 if(input.env!==undefined)secret.env=stringMap(input.env);
 if(input.token!==undefined){if(input.token)secret.headers={...secret.headers,Authorization:'Bearer '+textInput(input.token,10000)};else if(secret.headers)delete secret.headers.Authorization;}
 const result={id:previous?.id||randomUUID(),name,type,url,enabled:input.enabled!==false,timeoutMs,apiKey:JSON.stringify(secret)};
 if(type==='rest'){
  result.method=input.method||'GET';if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(result.method))throw Error('Choose a supported HTTP method.');
  result.bodyType=input.bodyType||'json';if(!['json','text','form','multipart'].includes(result.bodyType))throw Error('Choose JSON, text, form or multipart body.');
  if(input.body!==undefined)result.body=input.body;
 }else if(type==='graphql'){
  result.query=textInput(input.query,20000);result.variables=input.variables||{};result.operationName=optional(input.operationName,100);
  if(!record(result.variables))throw Error('GraphQL variables must be an object.');
 }else if(type==='grpc'){
  result.proto=textInput(input.proto,20000);result.service=textInput(input.service,200);result.method=textInput(input.method,200);result.tls=input.tls!==false;
  // shortcut: single-file protobuf only; add a sandboxed import bundle when multi-file services are needed.
  if(/\bimport\b/.test(result.proto))throw Error('Paste a self-contained protobuf definition without imports.');
  result.body=input.body||{};if(!record(result.body))throw Error('gRPC body must be an object.');
 }else{
  if(!['http','sse','stdio'].includes(transport))throw Error('Choose HTTP, SSE or stdio transport.');
  result.transport=transport;result.oauth=input.oauth===true;
  if(transport==='stdio'){
   result.command=textInput(input.command,1000);result.args=input.args||[];
   if(!Array.isArray(result.args)||result.args.length>100||result.args.some(arg=>typeof arg!=='string'||arg.length>4000))throw Error('Use an array of command arguments.');
   if(result.oauth)throw Error('OAuth is supported for remote MCP servers.');
  }
 }
 if(JSON.stringify(result).length>80000)throw Error('Connection exceeds 80 KB.');
 return result;
}
function requestUrl(connection,inputs){
 // Encode each value so runtime data cannot change the saved server or inject query parameters.
 const url=decodeUrlInputs(connection.url);
 if(/^https?:\/\/[^/?#]*\{\{/i.test(url))throw Error('Dynamic hosts are not allowed.');
 return url.replace(/\{\{\s*inputs\.[\w.-]+\s*\}\}/g,template=>{
  const value=interpolate(template,{inputs});
  if(!['string','number','boolean'].includes(typeof value))throw Error('URL inputs must be scalar values.');
  return encodeURIComponent(value);
 });
}
async function readResponse(response){
 const reader=response.body?.getReader(),chunks=[];let size=0;
 if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024)throw Error('Connection response exceeds 1 MB.');chunks.push(value);}}finally{await reader.cancel();}
 const text=Buffer.concat(chunks).toString();try{return JSON.parse(text);}catch{return text;}
}
function protoDefinition(connection){
 const directory=mkdtempSync(join(tmpdir(),'odwyn-proto-'));
 try{const path=join(directory,'service.proto');writeFileSync(path,connection.proto,{mode:0o600});return loadSync(path,{keepCase:true,longs:String,enums:String,defaults:true,oneofs:true});}finally{rmSync(directory,{recursive:true,force:true});}
}
export async function executeConnection(connection,{inputs={},operation,arguments:args={}}={},options={}){
 if(!connection.enabled)throw Error('Connection is disabled.');
 if(!record(inputs)||!record(args))throw Error('Inputs and tool arguments must be objects.');
 const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(connection.timeoutMs)]):AbortSignal.timeout(connection.timeoutMs);
 signal.throwIfAborted();
 const secret=connectionSecrets(connection);
 if(connection.type==='mcp')return withMcp(connection,options,async client=>{
  if(!operation){const tools=[];let cursor;do{const page=await client.listTools(cursor?{cursor}:undefined,{signal});tools.push(...page.tools);cursor=page.nextCursor;if(tools.length>1000||JSON.stringify(tools).length>1024*1024)throw Error('MCP tool discovery exceeds its size limit.');}while(cursor);return {tools};}
  const result=await client.callTool({name:operation,arguments:args},undefined,{signal,timeout:connection.timeoutMs});
  if(JSON.stringify(result).length>1024*1024)throw Error('MCP response exceeds 1 MB.');
  return result;
 });
 if(connection.type==='grpc'){
  const definition=protoDefinition(connection),service=Object.values(definition).find(value=>value&&typeof value==='object'&&Object.values(value).some(method=>method?.path===`/${connection.service}/${connection.method}`));
  const method=service&&Object.values(service).find(method=>method.path===`/${connection.service}/${connection.method}`);
  if(!method)throw Error('gRPC service or method not found in protobuf.');
  if(method.requestStream||method.responseStream)throw Error('Only unary gRPC methods are supported.');
  const metadata=new grpc.Metadata();for(const [key,value]of Object.entries(interpolate(secret.headers||{},{inputs})))metadata.set(key,value);
  const client=new grpc.Client(connection.url,connection.tls?grpc.credentials.createSsl():grpc.credentials.createInsecure(),{'grpc.max_receive_message_length':1024*1024});
  try{return await new Promise((resolve,reject)=>{
   const call=client.makeUnaryRequest(method.path,method.requestSerialize,method.responseDeserialize,interpolate(connection.body,{inputs}),metadata,{deadline:Date.now()+connection.timeoutMs},(error,data)=>{signal.removeEventListener('abort',abort);error?reject(error):resolve({data});});
   const abort=()=>call.cancel();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });}finally{client.close();}
 }
 const headers=new Headers(interpolate(secret.headers||{},{inputs}));let body,method=connection.method||'POST';
 if(connection.type==='graphql'){
  headers.set('content-type','application/json');body=JSON.stringify({query:connection.query,variables:interpolate(connection.variables,{inputs}),...(connection.operationName?{operationName:connection.operationName}:{})});
 }else if(!['GET','HEAD'].includes(method)&&connection.body!==undefined){
  const value=interpolate(connection.body,{inputs});
  if(connection.bodyType==='json'){headers.set('content-type','application/json');body=JSON.stringify(value);}
  else if(connection.bodyType==='text')body=typeof value==='string'?value:JSON.stringify(value);
  else{
   if(!record(value))throw Error('Form body must be an object.');
   body=connection.bodyType==='form'?new URLSearchParams():new FormData();for(const [key,item]of Object.entries(value))body.append(key,String(item));
  }
 }
 const response=await fetch(requestUrl(connection,inputs),{method,headers,body,signal,redirect:'error'});
 return {status:response.status,ok:response.ok,headers:Object.fromEntries(response.headers),data:await readResponse(response)};
}
export async function withMcp(connection,options,run){
 const secret=connectionSecrets(connection),client=new Client({name:'odwyn',version:'0.1.0'});
 const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(connection.timeoutMs)]):AbortSignal.timeout(connection.timeoutMs);
 const boundedFetch=(url,init={})=>{
  const headers=new Headers(init.headers);
  if(new URL(url).origin!==new URL(connection.url).origin)for(const [name,value] of Object.entries(secret.headers||{}))if(headers.get(name)===value)headers.delete(name);
  return fetch(url,{...init,headers,signal:init.signal?AbortSignal.any([signal,init.signal]):signal});
 };
 const transport=connection.transport==='stdio'?new StdioClientTransport({command:connection.command,args:connection.args,env:{PATH:process.env.PATH,...secret.env},stderr:'ignore'}):new (connection.transport==='sse'?SSEClientTransport:StreamableHTTPClientTransport)(new URL(connection.url),{fetch:boundedFetch,requestInit:{headers:secret.headers||{}},...(options.authProvider?{authProvider:options.authProvider}:{})});
 const abort=()=>{void client.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 try{if(signal.aborted)throw Error('Connection cancelled.');await client.connect(transport,{signal,timeout:connection.timeoutMs});return await run(client,transport);}finally{signal.removeEventListener('abort',abort);await client.close().catch(()=>{});await transport.close().catch(()=>{});}
}

export function mcpOAuthProvider(connection,redirectUrl,save,pending){
 const secret=connectionSecrets(connection);secret.oauth||={};const oauth=secret.oauth;
 const persist=()=>{connection.apiKey=JSON.stringify(secret);save();};
 if(oauth.client?.redirect_uris&&!oauth.client.redirect_uris.includes(redirectUrl)){
  for(const field of ['client','tokens','verifier'])delete oauth[field];
  persist();
 }
 return {
  redirectUrl,clientMetadata:{client_name:'Odwyn',redirect_uris:[redirectUrl],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'},
  state:()=>pending.state,
  clientInformation:()=>oauth.client,saveClientInformation:value=>{oauth.client=value;persist();},
  tokens:()=>oauth.tokens,saveTokens:value=>{oauth.tokens=value;persist();},
  redirectToAuthorization:url=>{pending.url=String(url);},
  saveCodeVerifier:value=>{oauth.verifier=value;persist();},codeVerifier:()=>oauth.verifier,
  saveDiscoveryState:value=>{oauth.discovery=value;persist();},discoveryState:()=>oauth.discovery,
  invalidateCredentials:scope=>{for(const field of scope==='all'?['client','tokens','verifier','discovery']:[scope==='tokens'?'tokens':scope==='client'?'client':scope==='discovery'?'discovery':'verifier'])delete oauth[field];persist();},
 };
}
