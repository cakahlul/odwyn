import https from 'node:https';
import http from 'node:http';
import { resolvePublic } from '../security.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';

// Read-only endpoint adapter; only the server broker supplies scoped credentials.
export class RepositoryGateway {
  constructor(policy,resolve=resolvePublic,credentialResolver=()=>null) {this.policy=policy;this.resolve=resolve;this.credentialResolver=credentialResolver;}
  async read(job,args,canRun=()=>true) {
    if(!args||Object.keys(args).some(k=>k!=='resourceId'))throw new Error('Unsupported repository arguments.');
    const check=()=>{if(!canRun())throw new Error('Task control changed.');this.policy.authorize(job,'repository.read',args.resourceId);};
    check();
    const resource=this.policy.resource(args.resourceId),endpoint=resource.metadata.endpoint;
    if(!endpoint)throw new Error('Repository endpoint unavailable.');
    const target=await this.resolve(endpoint);check();
    const token=await this.credentialResolver(args.resourceId,this.policy.context(job));check();
    const signal=AbortSignal.timeout(15_000);
    // A trusted fixture resolver may pin a disposable HTTP sink. Production resolves HTTPS/public IPs only.
    const body=await new Promise((done,fail)=>{
      const {url,address,family}=target;
      const request=(url.protocol==='https:'?https:http).get({hostname:address,family,servername:url.hostname,port:Number(url.port||(url.protocol==='https:'?443:80)),path:url.pathname+url.search,headers:{host:url.host,accept:'application/json, text/plain',...(token?{authorization:'Bearer '+token}:{})},signal},response=>{
        if(response.statusCode!==200){response.destroy();fail(new Error('Repository read failed.'));return;}
        const type=String(response.headers['content-type']||'').split(';')[0];
        if(!['application/json','text/plain'].includes(type)){response.destroy();fail(new Error('Unsupported repository response.'));return;}
        let size=0;const chunks=[];
        response.on('data',chunk=>{
          try{check();size+=chunk.length;if(size>1024*1024)throw new Error('Repository response exceeds 1 MiB.');chunks.push(chunk);}
          catch{response.destroy();fail(new Error('Repository read interrupted or denied.'));}
        });
        response.on('end',()=>done(Buffer.concat(chunks).toString('utf8')));
        response.on('error',()=>fail(new Error('Repository read interrupted.')));
        response.on('aborted',()=>fail(new Error('Repository read interrupted.')));
      });
      request.on('error',()=>fail(new Error('Repository read unavailable.')));
    });
    check();return {resourceId:args.resourceId,content:body};
  }
  async mcpRead(job,args,canRun) {
    // Immutable subject captured server-side; MCP arguments contain only resource IDs.
    const context=this.policy.context(job);
    const bound=Object.freeze({id:context.taskId,agentId:context.agentId,spaceId:context.spaceId});
    const server=new McpServer({name:'odwyn-scoped-repository',version:'1.0.0'});
    const client=new Client({name:'odwyn-runtime',version:'1.0.0'});
    server.registerTool('repository_read',{inputSchema:z.object({resourceId:z.string()}).strict(),annotations:{readOnlyHint:true}},async input=>({content:[{type:'text',text:JSON.stringify(await this.read(bound,input,canRun))}]}));
    const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
    try{
      await server.connect(serverTransport);await client.connect(clientTransport);
      const result=await client.callTool({name:'repository_read',arguments:args},undefined,{timeout:20_000});
      if(result.isError)throw new Error('Scoped MCP repository read denied or unavailable.');
      return JSON.parse(result.content[0].text);
    }finally{await client.close();await server.close();}
  }
}
