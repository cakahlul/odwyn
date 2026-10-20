import assert from 'node:assert/strict';
import {AntigravityHeadless} from '../antigravity.js';
const bridge=new AntigravityHeadless();
await bridge.account();
const run={config:{model:'default'},thread:{developerInstructions:'You are testing Odwyn. Call odwyn_echo with text checked using the Odwyn MCP server. Then reply OK.',history:[],dynamicTools:[{name:'odwyn_echo',description:'Echo test text',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}]},controller:new AbortController()};
let called=false,usageSeen=false,response;
const timer=setTimeout(()=>run.controller.abort(),90000);
try{await bridge.run({notify(){},invoke:async(_run,name,args)=>{assert.equal(name,'odwyn_echo');assert.equal(args.text,'checked');called=true;return {success:true,contentItems:[{type:'inputText',text:args.text}]};},taskUsage(_run,report){usageSeen=report?.totalTokens!=null;},message(_run,_id,text){response=text.trim();}},run,{input:[{type:'text',text:'Call the echo tool once with checked.'}]});assert.ok(called,'CLI must invoke Odwyn MCP');assert.ok(usageSeen,'CLI must report tokens');assert.ok(response);console.log('Antigravity subscription: authenticated MCP, response and reported tokens verified.');}
finally{clearTimeout(timer);}
