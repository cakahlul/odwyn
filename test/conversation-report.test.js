import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {createConversationReports,reportHtml,renderReportPdf} from '../conversation-reports.js';

const fixture=()=>({agents:[{id:'one',customization:{name:'Researcher'},provider:{configured:true}},{id:'two',customization:{name:'Reviewer'},provider:{configured:true}}],files:[{id:'file',name:'research.csv'}],conversations:[{id:'chat',agentId:'one',title:'Launch plan',messages:[{role:'user',text:'Launch in June. Budget: $500.',attachments:['file']},{role:'assistant',agentId:'one',text:'Proposed: June 3. [Source](https://example.com/launch)'}]},{id:'room',kind:'room',agentId:'one',memberIds:['one','two'],title:'Launch review',messages:[{role:'assistant',agentId:'one',text:'Propose June 3.'},{role:'assistant',agentId:'two',text:'June 3 approved; venue still open.'}],discussion:{status:'completed',outcome:{result:'June 3 agreed',nextPlan:'Choose venue'}},artifacts:[{title:'Plan',versions:[{text:'Current plan: June 3'}]}]}]});
function provider(output='# June launch report\n\n## Overview\nLaunch planned for June.\n\n## Open questions\nVenue undecided.',mode='success'){
  const instance=Object.assign(new EventEmitter(),{calls:[],stopped:false,request:async function(method,params){
    this.calls.push({method,params});
    if(method==='thread/start')return {thread:{id:'report-thread'}};
    if(mode==='wait')return {turn:{id:'turn'}};
    queueMicrotask(()=>{
      if(mode==='tool'){this.emit('request',{id:1,method:'item/tool/call',params:{tool:'odwyn_terminal'}});return;}
      this.emit('notification',{method:'item/agentMessage/delta',params:{threadId:'report-thread',itemId:'answer',delta:'Partial draft'}});
      this.emit('notification',{method:'item/completed',params:{threadId:'report-thread',item:{id:'answer',type:'agentMessage',text:output}}});
      this.emit('notification',{method:'turn/completed',params:{threadId:'report-thread',turn:{status:mode==='failure'?'failed':'completed'}}});
    });
    return {turn:{id:'turn'}};
  },reject(){},stop(){this.stopped=true;}});
  return instance;
}
const wait=async(reports,id)=>{for(let n=0;n<100&&reports.get(id)?.status==='generating';n++)await Bun.sleep(5);return reports.get(id);};

test('reports snapshot private and room discussions without changing messages or active sessions',async()=>{
  const state=fixture(),providers=[];
  state.conversations[0].sessions={one:{threadId:'live-session'}};
  state.jobs=[{id:'live-job',conversationId:'chat',agentId:'one',status:'running',files:['file']}];
  const original=JSON.stringify(state);
  const reports=createConversationReports({state,redact:value=>value.replaceAll('$500','[redacted]'),createProvider:()=>{const p=provider();providers.push(p);return p;}});
  try{
    for(const conversationId of ['chat','room']){
      const started=reports.start(conversationId),report=await wait(reports,started.id);
      expect(report.status).toBe('ready');expect(report.markdown).toContain('## Overview');expect(report.markdown).not.toContain('Partial draft');
      expect(report.title).toBe('June launch report');expect(report.markdown).not.toContain('# June launch report');
      const p=providers.at(-1),params=p.calls[0].params;
      expect(params.dynamicTools).toEqual([]);expect(params.mcpEnabled).toBe(false);expect(params.approvalPolicy).toBe('never');
      expect(params.developerInstructions).toContain('untrusted');
      const input=p.calls[1].params.input[0].text;
      expect(input).not.toContain('live-session');
      if(conversationId==='chat'){expect(input).toContain('research.csv');expect(input).toContain('[redacted]');expect(input).not.toContain('$500');expect(input).not.toContain('Reviewer');}
      else{expect(input).toContain('Researcher');expect(input).toContain('Reviewer');expect(input).toContain('June 3 agreed');expect(input).toContain('Current plan');}
      expect(p.stopped).toBe(true);
    }
    expect(JSON.stringify(state)).toBe(original);
    expect(JSON.stringify(reports.get('missing'))).toBe('null');
  }finally{reports.close();}
});

test('reports reject missing, empty and oversized conversations before starting providers',()=>{
  const state=fixture();state.conversations.push({id:'empty',agentId:'one',messages:[]},{id:'large',agentId:'one',messages:[{role:'user',text:'x'.repeat(250_000)}]});
  const reports=createConversationReports({state,redact:s=>s,createProvider:()=>{throw Error('Must not start');}});
  try{
    expect(()=>reports.start('missing')).toThrow('Conversation not found');
    expect(()=>reports.start('empty')).toThrow('Add messages');
    expect(()=>reports.start('large')).toThrow('too large');
    state.agents[0].provider.configured=false;
    expect(()=>reports.start('chat')).toThrow('Configure');
  }finally{reports.close();}
});

for(const mode of ['failure','tool','success'])test(`reports clean up ${mode==='success'?'empty output':mode==='failure'?'provider failures':'tool requests'}`,async()=>{
  const p=provider('',mode),reports=createConversationReports({state:fixture(),redact:s=>s,createProvider:()=>p});
  try{
    const report=await wait(reports,reports.start('chat').id);
    expect(report.status).toBe('failed');expect(report.error.length).toBeGreaterThan(0);expect(p.stopped).toBe(true);
  }finally{reports.close();}
});

test('closing and deleting report requests cancel separate provider sessions',async()=>{
  const p=provider('','wait'),reports=createConversationReports({state:fixture(),redact:s=>s,createProvider:()=>p});
  const report=reports.start('chat');await Bun.sleep(5);
  expect(()=>reports.start('chat')).toThrow('already');
  reports.remove(report.id);await Bun.sleep(5);
  expect(p.stopped).toBe(true);expect(reports.get(report.id)).toBeNull();reports.close();
});

test('report documents escape raw HTML, remove external images and reject unsafe links',()=>{
  const html=reportHtml({title:'<script>Title</script>',createdAt:'2026-11-11T10:00:00Z',markdown:'## Findings\n<script>alert(1)</script>\n\n[Bad](javascript:alert) ![Photo](https://private.example/image) [Source](https://example.com/source)'});
  expect(html).not.toContain('<script>');expect(html).not.toContain('href="javascript:');expect(html).not.toContain('<img');
  expect(html).toContain('https://example.com/source');expect(html).toContain('<h2>Findings</h2>');
});

test('report PDF renders long text, tables and multiple pages',async()=>{
  const bytes=await renderReportPdf({title:'Launch plan',createdAt:'2026-11-11T10:00:00Z',markdown:'## Overview\nA standalone report.\n\n| Decision | Status |\n| --- | --- |\n| June 3 launch | Agreed |\n\n'+('## Findings\n'+('Evidence and practical findings. '.repeat(50))+'\n\n').repeat(8)});
  expect(bytes.subarray(0,5).toString()).toBe('%PDF-');expect(bytes.length).toBeGreaterThan(5000);
},20_000);
