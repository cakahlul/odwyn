import {usage} from './usage.js';
import {execFile,spawn} from 'node:child_process';
import {readFileSync,existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {promisify} from 'node:util';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';

export class AntigravityHeadless {
  constructor({command=process.env.ODWYN_ANTIGRAVITY_COMMAND || 'agy',configDirectory=join(homedir(),'.gemini')}={}) {
    this.command=command;this.configDirectory=configDirectory;
    this.env={...process.env};
    for(const key of Object.keys(this.env))if(/^(?:GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_GENAI_USE_VERTEXAI|GOOGLE_GEMINI_BASE_URL|AGY_ADC_AUTH|AGY_LLM_GATEWAY_|ANTIGRAVITY_LS_|ANTIGRAVITY_CSRF_TOKEN)/.test(key))delete this.env[key];
  }
  subscriptionSettings(){
    if(!Bun.which(this.command))throw Error('Antigravity CLI is unavailable. Install agy on this server and restart Odwyn.');
    for(const path of ['antigravity-cli/settings.json','config/config.json']){
      const file=join(this.configDirectory,path);if(!existsSync(file))continue;
      let config;try{config=JSON.parse(readFileSync(file,'utf8'));}catch{throw Error('Antigravity settings are unreadable. Repair them in agy before retrying.');}
      for(const settings of [config,config.userSettings||{}]){
        if(settings.modelProvider || settings.enableAdc)throw Error('Odwyn requires Antigravity personal-account sign-in. Disable API-key/ADC mode in agy.');
        if(settings.useG1Credits)throw Error('Set Antigravity AI Credit Overages to Never before using Odwyn.');
      }
    }
  }
  async account(){
    this.subscriptionSettings();
    let data;try{const {stdout}=await promisify(execFile)(this.command,['-p','/usage','--output-format','json','--print-timeout','10s'],{env:this.env,timeout:20000,maxBuffer:100000});data=JSON.parse(stdout);}catch{throw Error('Sign in with your personal Google subscription using agy on this server, then Refresh.');}
    if(data.status!=='SUCCESS'||data.command?.name!=='usage')throw Error('Antigravity account lookup failed. Run agy to sign in, then Refresh.');
    return {account:{type:'antigravity',planType:'Antigravity subscription'}};
  }
  async run(provider,run,params) {
    this.subscriptionSettings();
    const agentName='odwyn-'+randomUUID(),agentPath=join(this.configDirectory,'config','agents',agentName+'.md');
    const images=params.input.filter(part=>part.type==='image').map(part=>{const match=part.url?.match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/);if(!match)throw Error('Antigravity needs an uploaded PNG, JPEG, WebP or GIF image.');return {type:'image',mimeType:'image/'+match[1],data:match[2]};});
    const taskTools=[...run.thread.dynamicTools,...(images.length?[{name:'odwyn_task_images',description:'Read images uploaded with the current task.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]:[])];
    const directory=mkdtempSync(join(tmpdir(),'odwyn-antigravity-')),token=randomUUID();
    const mcp=new Server({name:'odwyn',version:'0.1.0'},{capabilities:{tools:{}}});
    const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:randomUUID,enableJsonResponse:true,maxRequestBodySize:100_000});
    let server,child,killTimer,exited;
    const terminate=()=>{
      if(!child || killTimer || child.exitCode!==null || child.signalCode!==null)return;
      const kill=signal=>{try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}catch{}};
      kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),5000);killTimer.unref();
    };
    try {
      mcp.setRequestHandler(ListToolsRequestSchema,()=>({tools:taskTools.map(tool=>({name:tool.name,description:tool.description,inputSchema:tool.inputSchema,_meta:{'antigravity/alwaysLoad':true}}))}));
      mcp.setRequestHandler(CallToolRequestSchema,async request=>{
        if(images.length&&request.params.name==='odwyn_task_images')return {content:images};
        if(!run.thread.dynamicTools.some(tool=>tool.name===request.params.name))throw Error('Tool not enabled for this task.');
        const result=await provider.invoke(run,request.params.name,request.params.arguments || {});
        return {isError:!result.success,content:result.contentItems.map(part=>part.type==='inputImage' ? {type:'image',data:part.imageUrl.split(',')[1],mimeType:part.imageUrl.slice(5,part.imageUrl.indexOf(';'))} : {type:'text',text:part.text})};
      });
      await mcp.connect(transport);
      server=Bun.serve({hostname:'127.0.0.1',port:0,idleTimeout:0,fetch:async request=>{
        if(request.headers.get('origin') || request.headers.get('authorization')!==`Bearer ${token}`)return new Response(null,{status:403});
        if(new URL(request.url).origin!==server.url.origin || new URL(request.url).pathname!=='/mcp')return new Response(null,{status:404});
        const response=await transport.handleRequest(request);
        // Flush SSE headers immediately; agy waits for them before discovering tools.
        if(request.method==='GET'&&response.ok&&response.body){
          const reader=response.body.getReader();
          return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(': connected\n\n'));},async pull(controller){const next=await reader.read();if(next.done)controller.close();else controller.enqueue(next.value);},cancel(){return reader.cancel();}}),{status:response.status,headers:response.headers});
        }
        return response;
      }});
      mkdirSync(join(this.configDirectory,'config','agents'),{recursive:true,mode:0o700});
      const agent={name:agentName,description:'Odwyn managed task',mainAgent:true,subagent:false,
        tools:[],inheritCustomizations:false,excludeDefaultComponents:true,
        mcpServers:[{serverName:'odwyn',forceAllToolsEager:true,serverUrl:server.url.origin+'/mcp',headers:{Authorization:`Bearer ${token}`}}]};
      writeFileSync(agentPath,'---\n'+JSON.stringify(agent)+'\n---\n'+run.thread.developerInstructions+'\nUse only the supplied Odwyn tools.\n',{mode:0o600,flag:'wx'});
      const input=params.input.map(part=>part.type==='text'?part:{type:'text',text:'Inspect the uploaded image using odwyn_task_images.'});
      const prompt=JSON.stringify({history:run.thread.history||[],input}).replaceAll('@','\\u0040');
      const args=['--agent',agentName,'--input-format','stream-json','--output-format','stream-json','--disable-slash-commands','--dangerously-skip-permissions'];
      if(run.config.model!=='default')args.push('--model',run.config.model);
      if(run.controller.signal.aborted)throw Error('Task stopped.');
      child=spawn(this.command,args,{cwd:directory,env:this.env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
      exited=new Promise(resolve=>{child.once('error',()=>resolve(null));child.once('close',code=>resolve(code));});
      child.stderr.resume();child.stdin.on('error',()=>{});
      run.controller.signal.addEventListener('abort',terminate,{once:true});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Error('Antigravity CLI could not start. Check installation and retry.')));});
      if(run.controller.signal.aborted)throw Error('Task stopped.');
      // Verify the selected agent before sending user content; init.tools is a generic CLI catalog.
      let initialized=false;
      let completed=false,text='',itemId=randomUUID();
      for await(const line of createInterface({input:child.stdout,crlfDelay:Infinity})){
        if(!line.trim())continue;
        let event;try{event=JSON.parse(line);}catch{throw Error('Antigravity CLI returned unreadable output. Update Antigravity CLI and retry.');}
        if(event.event==='init'){
          if(initialized)throw Error('Antigravity returned duplicate initialization.');
          const exposed=event.init?.tools;
          if(event.init?.agent!==agentName||!Array.isArray(exposed))throw Error('Antigravity tool restrictions could not be verified. Update agy and retry.');
          initialized=true;
          child.stdin.end(JSON.stringify({event:'user',message:{content:prompt}})+'\n');
        }
        if(event.event==='step_update'&&event.step_update?.step_type==='agent_response'&&typeof event.step_update.text_delta==='string'){
          text+=event.step_update.text_delta;provider.notify(run,'item/agentMessage/delta',{itemId,delta:event.step_update.text_delta});
        }
        if(event.event==='step_update'&&event.step_update?.step_type==='tool'&&event.step_update.tool_name)provider.notify(run,'odwyn/activity',{label:event.step_update.state==='DONE'?'Antigravity tool finished':'Antigravity tool',detail:event.step_update.tool_name});
        if(event.event==='result'){
          provider.taskUsage(run,event.result?.usage?usage(event.result.usage,'antigravity'):null);
          if(event.result?.status!=='SUCCESS')throw Error('Antigravity failed. Check subscription quota, sign-in and model access; then retry.');
          if(!text&&typeof event.result.response==='string')text=event.result.response;
          completed=true;
        }
      }
      const code=await exited;
      if(run.controller.signal.aborted)throw Error('Task stopped.');
      if(code!==0 || !completed)throw Error('Antigravity CLI disconnected before finishing. Check installation, sign-in, model access, and quota; then retry.');
      if(!text.trim())throw Error('Antigravity CLI returned no response. Retry the task.');
      provider.message(run,itemId,text);
    } finally {
      run.controller.signal.removeEventListener('abort',terminate);
      terminate();server?.stop(true);await mcp.close();
      // The CLI may still be exiting after malformed output or cancellation.
      if(exited)await exited;
      clearTimeout(killTimer);rmSync(agentPath,{force:true});rmSync(directory,{recursive:true,force:true});
    }
  }
}
