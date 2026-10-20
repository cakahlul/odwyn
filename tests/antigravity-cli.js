#!/usr/bin/env bun
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const args=process.argv.slice(2),emit=value=>console.log(JSON.stringify(value));
if(args.includes('/usage')){emit({status:'SUCCESS',command:{name:'usage',data:{groups:[]}}});process.exit();}
const name=args[args.indexOf('--agent')+1],directory=process.env.ODWYN_AGY_TEST_DIRECTORY;
const path=join(directory,'config/agents',name+'.md'),system=readFileSync(path,'utf8'),settings=JSON.parse(system.split('\n')[1]),model=args.includes('--model')?args[args.indexOf('--model')+1]:'default';
const capture={args,settings,system,cwd:process.cwd(),pid:process.pid,settingsMode:statSync(path).mode&0o777};
const save=()=>writeFileSync(join(directory,'capture.json'),JSON.stringify(capture));
const config=settings.mcpServers[0];
const client=new Client({name:'antigravity-fixture',version:'1'});
await client.connect(new StreamableHTTPClientTransport(new URL(config.serverUrl),{requestInit:{headers:config.headers}}));
const tools=(await client.listTools()).tools.map(tool=>tool.name);
emit({event:'init',init:{agent:name,tools:model==='unsafe'?['run_command']:tools.map(tool=>'mcp_odwyn_'+tool)}});
if(model==='unsafe'){await Bun.sleep(10000);process.exit();}
capture.input=await Bun.stdin.text();save();
if(model==='hanging'){await Bun.sleep(60000);process.exit();}
if(model==='malformed'){console.log('malformed output');process.exit();}
if(model==='failure'){console.error('private-secret-token');emit({event:'result',result:{status:'ERROR',usage:{input_tokens:12,output_tokens:2,total_tokens:14}}});process.exit(1);}
try{
 if(model==='tools'){
  capture.unauthorized=(await fetch(config.serverUrl)).status;
  capture.browserOrigin=(await fetch(config.serverUrl,{headers:{...config.headers,Origin:'https://malicious.example'}})).status;
  capture.tools=tools;
  if(tools.includes('odwyn_task_images'))capture.images=await client.callTool({name:'odwyn_task_images',arguments:{}});
  try{await client.callTool({name:'run_shell_command',arguments:{command:'forbidden'}});}catch{capture.blockedUnknown=true;}
  capture.answer=await client.callTool({name:'odwyn_ask',arguments:{question:'Budget?'}},undefined,{timeout:10000});
  capture.browser=await client.callTool({name:'odwyn_browser',arguments:{action:'read',reason:'Inspect page'}},undefined,{timeout:10000});
  capture.terminal=await client.callTool({name:'odwyn_terminal',arguments:{command:'printf antigravity-terminal',reason:'Check terminal'}},undefined,{timeout:10000});
 }
 if(model!=='empty')emit({event:'step_update',step_update:{step_type:'agent_response',text_delta:'Antigravity done.'}});
 emit({event:'result',result:{status:'SUCCESS',response:'',usage:{input_tokens:20,output_tokens:4,total_tokens:24,cache_read_tokens:5,thinking_tokens:2}}});
}finally{save();await client.close();}
