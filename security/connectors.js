import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {existsSync,writeFileSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {resolvePublic} from '../security.js';

// Reviewed mapping. Remote tool catalogs/annotations never define authority.
export const connectorManifest=Object.freeze({'action-gateway-v1':Object.freeze({operation:'approved.action',actions:['payment.execute','message.send','repository.merge','deployment.production']}),'mcp-document-v1':Object.freeze({operation:'document.read',tool:'read_document',action:'mcp.invoke'}),'git-https-v1':Object.freeze({operation:'repository.branch.push',actions:['repository.read','repository.branch.push']})});
export function openConnectors(db,policy,directory){
  db.exec('CREATE TABLE IF NOT EXISTS connectors(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,type TEXT NOT NULL,name TEXT NOT NULL,endpoint TEXT NOT NULL,credential TEXT NOT NULL,enabled INTEGER NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS provider_credentials(id TEXT PRIMARY KEY,slot TEXT NOT NULL,type TEXT NOT NULL,credential TEXT NOT NULL)');
  const keyPath=join(directory,'broker.key');
  function key(){if(!existsSync(keyPath)){if(db.query('SELECT 1 FROM connectors LIMIT 1').get()||db.query('SELECT 1 FROM provider_credentials LIMIT 1').get())throw new Error('Credential key unavailable; restore the owner backup.');writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});}const stat=statSync(keyPath);if(!stat.isFile()||(stat.mode&0o077))throw new Error('Credential key permissions invalid.');const bytes=readFileSync(keyPath);if(bytes.length!==32)throw new Error('Credential key unavailable.');return bytes;}
  function binding(row){return row.space_id?row.id+':'+row.space_id:row.id+':'+policy.ownerId+':'+row.slot+':'+row.type;}
  function encrypt(secret,row){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(binding(row)));const encrypted=Buffer.concat([cipher.update(secret),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');}
  function decrypt(row){const bytes=Buffer.from(row.credential,'base64'),cipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));cipher.setAAD(Buffer.from(binding(row)));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString();}
  const providers=state=>[['workspace',state.provider],['global',state.globalProvider],...state.agents.map(a=>['agent/'+a.id,a.provider])].filter(([,config])=>config);
  return {
    list(){return db.query('SELECT id,space_id AS spaceId,type,name,enabled FROM connectors').all().map(r=>({...r,enabled:!!r.enabled,operation:connectorManifest[r.type].operation}));},
    create(input){
      if(!input||Object.keys(input).some(k=>!['spaceId','type','name','endpoint','credential'].includes(k))||!Object.hasOwn(connectorManifest,input.type)||!policy.listSpaces().some(s=>s.id===input.spaceId)||typeof input.name!=='string'||!input.name.trim()||input.name.length>200||typeof input.credential!=='string'||!input.credential||input.credential.length>4096||/[\r\n]/.test(input.credential))throw new Error('Invalid reviewed connector configuration.');
      const url=new URL(input.endpoint);if(url.protocol!=='https:'||url.username||url.password||url.hash||input.endpoint.length>2000)throw new Error('Connector requires an exact credential-free HTTPS endpoint.');
      const id=randomUUID();db.query('INSERT INTO connectors VALUES(?,?,?,?,?,?,1)').run(id,input.spaceId,input.type,input.name,url.href,encrypt(input.credential,{id,space_id:input.spaceId}));policy.touch();return this.list().find(r=>r.id===id);
    },
    disable(id){const row=db.query('SELECT space_id FROM connectors WHERE id=?').get(id);if(!row)throw new Error('Connection not found.');db.transaction(()=>{db.query('UPDATE connectors SET enabled=0 WHERE id=?').run(id);policy.touch();policy.auditOwner('connector.disable',row.space_id,'Owner disabled connection '+id+'; in-flight results and subsequent calls are denied.');})();},
    withCredential(id,context,fn){const row=db.query('SELECT * FROM connectors WHERE id=?').get(id);if(!row||!row.enabled||row.space_id!==context.spaceId)throw new Error('Connection disabled or outside task Space.');return fn({id:row.id,endpoint:row.endpoint,manifest:connectorManifest[row.type],secret:decrypt(row)});},
    credential(resourceId,context,action){const r=policy.resource(resourceId);policy.authorize({id:context.taskId,agentId:context.agentId,spaceId:context.spaceId},action,resourceId);if(!r.metadata.connectionId&&action==='repository.read')return null;return this.withCredential(r.metadata.connectionId,context,c=>{if(!c.manifest.actions?.includes(action)||c.endpoint!==r.metadata.endpoint)throw new Error('Git credential scope mismatch.');return c.secret;});},
    hydrateProviders(state){for(const [slot,config] of providers(state)){if(!config.credentialRef)continue;const row=db.query('SELECT * FROM provider_credentials WHERE id=? AND slot=? AND type=?').get(config.credentialRef,slot,config.type);if(!row)throw new Error('Provider credential reference unavailable.');config.apiKey=decrypt(row);delete config.credentialRef;}},
    serialize(state){const saved=JSON.parse(JSON.stringify(state));for(const [slot,config] of providers(saved)){if(!config.apiKey)continue;let row=db.query('SELECT * FROM provider_credentials WHERE slot=? AND type=?').all(slot,config.type).find(r=>decrypt(r)===config.apiKey);if(!row){row={id:randomUUID(),slot,type:config.type};row.credential=encrypt(config.apiKey,row);db.query('INSERT INTO provider_credentials VALUES(?,?,?,?)').run(row.id,slot,row.type,row.credential);}config.credentialRef=row.id;delete config.apiKey;}return JSON.stringify(saved);},
    redact(text){let result=String(text);for(const row of [...db.query('SELECT * FROM connectors').all(),...db.query('SELECT * FROM provider_credentials').all()]){const secret=decrypt(row);for(const variant of new Set([secret,JSON.stringify(secret).slice(1,-1),encodeURIComponent(secret),Buffer.from(secret).toString('base64')]))result=result.replaceAll(variant,'[REDACTED]');}return result;},
    sanitize(value){if(typeof value==='string')return this.redact(value);if(Array.isArray(value))return value.map(v=>this.sanitize(v));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[this.redact(k),this.sanitize(v)]));return value;},
    assertNoSecret(bytes){const text=bytes.toString('utf8');if(this.redact(text)!==text)throw new Error('Protected credential material cannot be exported.');},
  };
}

export class ConnectorGateway {
  constructor(store,resolver=resolvePublic){this.store=store;this.resolve=resolver;}
  async invoke(job,args,canRun=()=>true){
    if(!args||Object.keys(args).some(k=>!['resourceId','operation'].includes(k)))throw new Error('Unsupported connector arguments.');
    const context=this.store.security.context(job),bound=Object.freeze({id:context.taskId,agentId:context.agentId,spaceId:context.spaceId});
    const check=()=>{if(!canRun())throw new Error('Connector task ended.');this.store.security.authorize(bound,'mcp.invoke',args.resourceId);};check();
    const resource=this.store.security.resource(args.resourceId);
    try{return await this.store.connectors.withCredential(resource.metadata.connectionId,context,async connection=>{
      if(args.operation!==connection.manifest.operation)throw new Error('Unknown or privileged connector operation.');
      const client=new Client({name:'odwyn-scoped-broker',version:'1.0.0'});
      const pinnedFetch=async(raw,options={})=>{
        check();if(String(raw)!==connection.endpoint||options.method!=='POST')throw new Error('MCP alternate transport denied.');
        const rpc=JSON.parse(options.body);if(!['initialize','notifications/initialized','tools/call'].includes(rpc.method)||rpc.method==='tools/call'&&(rpc.params.name!==connection.manifest.tool||rpc.params.arguments?.id!==resource.metadata.upstreamId||Object.keys(rpc.params.arguments).some(k=>k!=='id')))throw new Error('MCP request outside reviewed manifest.');
        const target=await this.resolve(connection.endpoint);check();
        return new Promise((done,fail)=>{
          const {url,address,family}=target,request=(url.protocol==='https:'?https:http).request({hostname:address,family,servername:url.hostname,port:Number(url.port||(url.protocol==='https:'?443:80)),path:url.pathname+url.search,method:'POST',headers:{host:url.host,authorization:'Bearer '+connection.secret,'content-type':'application/json',accept:'application/json, text/event-stream'},signal:AbortSignal.timeout(15000)},response=>{
            if(response.statusCode!==200&&response.statusCode!==202){response.destroy();fail(new Error('Connector response rejected.'));return;}
            if(response.statusCode===200&&!String(response.headers['content-type']).startsWith('application/json')){response.destroy();fail(new Error('Streaming MCP is incompatible with bounded brokerage.'));return;}
            const chunks=[];let size=0;response.on('data',chunk=>{try{check();size+=chunk.length;if(size>1024*1024)throw new Error('Connector response too large.');chunks.push(chunk);}catch{response.destroy();fail(new Error('Connector interrupted or denied.'));}});
            response.on('end',()=>done(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:{'content-type':'application/json'}})));response.on('error',()=>fail(new Error('Connector unavailable.')));response.on('aborted',()=>fail(new Error('Connector unavailable.')));
          });request.on('error',()=>fail(new Error('Connector unavailable.')));request.end(options.body);
        });
      };
      const transport=new StreamableHTTPClientTransport(new URL(connection.endpoint),{fetch:pinnedFetch});
      try{await client.connect(transport);check();const result=await client.callTool({name:connection.manifest.tool,arguments:{id:resource.metadata.upstreamId}},undefined,{timeout:20000});check();if(result.isError)throw new Error('Connector failed.');
        const text=(result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');if(text.length>16000)throw new Error('Connector result too large.');return {resourceId:resource.id,operation:args.operation,content:this.store.connectors.redact(text)};
      }finally{await client.close();}
    });}catch{throw new Error('Scoped connector denied or unavailable.');}
  }
}
