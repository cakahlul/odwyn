import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, createRoom, deleteAgent, recoverJobs } from '../store.js';
import { Runtime } from '../runtime.js';
import { defaults } from '../public/profile.js';

class FakeCodex extends EventEmitter {
  child = {}; calls = []; replies = [];
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'pro' } };
    if (method.startsWith('thread/')) return { thread: { id: params?.threadId || 'thread-test' } };
    if (method === 'turn/start') return { turn: { id: 'turn-test', status: 'inProgress' } };
    return {};
  }
  respond(id, result) { this.replies.push({ id, result }); }
  reject() {}
}

test('AI file attachments persist in ordinary chats and rooms with the producing agent', async () => {
  const dir = mkdtempSync(join(tmpdir(),'odwyn-file-runtime-')), store = openStore(dir), codex = new FakeCodex();
  const primary = store.state.agents[0].id; store.state.agents.push({id:'scout',customization:{...defaults,name:'Scout'}});
  const room = createRoom(store.state,{title:'Files room',memberIds:[primary,'scout']});
  const runtime = new Runtime({store,codex,browser:{},workspace:dir});
  try {
    await runtime.refreshAccount(); writeFileSync(join(dir,'report.csv'),'Name,Result\nTask,Done\n');
    for (const conversationId of [null,room.id]) {
      const job = runtime.submit({prompt:'Send report',conversationId,agentId:primary}); await runtime.drain();
      await runtime.handleRequest({id:job.id,method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool:'odwyn_send_file',arguments:{path:'report.csv'}}});
      expect(codex.replies.at(-1).result.success).toBe(true);
      const file = store.state.files.find(f=>f.id===job.files[0]); expect(file.jobId).toBe(job.id);
      expect(readFileSync(join(dir,'files',file.id),'utf8')).toContain('Task,Done');
      await runtime.cancel(job.id);
    }
    const saved = openStore(dir); expect(saved.state.files.filter(f=>f.kind==='generated')).toHaveLength(2); saved.close();
  } finally {runtime.close();store.close();rmSync(dir,{recursive:true,force:true});}
});

test('room goals continue automatically, require everyone to verify completion, and accept redirects', async () => {
  const dir = mkdtempSync(join(tmpdir(),'odwyn-room-goals-'));
  const store = openStore(dir), first = new FakeCodex(), second = new FakeCodex();
  store.state.customization = {...defaults,name:'Pip'};
  const primary = store.state.agents[0].id;
  store.state.agents.push({id:'scout',customization:{...defaults,name:'Scout'}});
  const room = createRoom(store.state,{title:'Goal room',memberIds:[primary,'scout']});
  const runtime = new Runtime({store,codex:first,browser:{},workspace:dir}); runtime.addProvider('scout',second);
  const complete = async (done = false) => {
    await runtime.drain(); const job = runtime.active, provider = runtime.providers.get(job.agentId);
    if (done) await runtime.handleRequest({id:job.id,method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool:'odwyn_room_done',arguments:{summary:'Verified the requested result.'}}});
    provider.emit('notification',{method:'item/completed',params:{threadId:job.threadId,turnId:job.turnId,item:{id:job.id,type:'agentMessage',text:`Progress from ${job.agentId}`}}});
    provider.emit('notification',{method:'turn/completed',params:{threadId:job.threadId,turn:{id:job.turnId,status:'completed'}}});
    return job;
  };
  try {
    await runtime.refreshAccount(); await runtime.refreshAccount('scout');
    runtime.submitRoom(room.id,{prompt:'Plan a trip',interactionMode:'safe'});
    await complete(true); await complete();
    expect(store.state.jobs.filter(j=>j.status==='queued')).toHaveLength(2);
    expect(room.messages.filter(m=>m.role==='user')).toHaveLength(1);
    await complete(true); await complete(true);
    expect(store.state.jobs.some(j=>['queued','running'].includes(j.status))).toBe(false);
    expect(room.discussion.status).toBe('completed');
    const old = runtime.submitRoom(room.id,{prompt:'Plan another trip'}); await runtime.drain();
    await expect(runtime.messageRoom(room.id,{prompt:'@Unknown change course'})).rejects.toThrow('Unknown');
    expect(old[0].status).toBe('running');
    const redirected = await runtime.messageRoom(room.id,{prompt:'@Scout Only compare trains',agentId:primary}); await runtime.drain();
    expect(old.every(j=>j.status==='cancelled')).toBe(true);
    expect(redirected.map(j=>j.agentId)).toEqual(['scout']);
    expect(first.calls.some(c=>c.method==='turn/interrupt')).toBe(true);
    first.emit('notification',{method:'item/completed',params:{threadId:old[0].threadId,turnId:old[0].turnId,item:{id:'stale',type:'agentMessage',text:'Old direction'}}});
    expect(room.messages.some(m=>m.id==='stale')).toBe(false);
    await complete(true);
    expect(room.discussion.status).toBe('completed');
    store.state.agents.find(a=>a.id==='scout').customization.name='Travel Scout';
    expect(runtime.submitRoom(room.id,{prompt:'@"Travel Scout" Check times'}).map(j=>j.agentId)).toEqual(['scout']);
    await runtime.cancelRoom(room.id);
    expect(room.discussion.status).toBe('stopped');
    expect(runtime.submitRoom(room.id,{prompt:'@Pip @"Travel Scout" Compare trains'})).toHaveLength(2);
    const recovered = structuredClone(store.state); recoverJobs(recovered);
    expect(recovered.conversations.find(c=>c.id===room.id).discussion.status).toBe('paused');
    expect(recovered.jobs.some(j=>['running','queued'].includes(j.status))).toBe(false);
    await runtime.cancelRoom(room.id);
    runtime.submitRoom(room.id,{prompt:'Keep researching'});
    for (let turn=0;turn<30;turn++) await complete();
    expect(room.discussion.status).toBe('paused');
    expect(store.state.jobs.filter(j=>j.roomRoundId===room.discussion.id)).toHaveLength(30);
    expect(store.state.jobs.some(j=>['running','queued'].includes(j.status))).toBe(false);
    const paused = store.state.jobs[0]; expect(paused.status).toBe('interrupted');
    const resumed = runtime.retry(paused.id); await runtime.drain();
    expect(resumed.recovering).toBe(true); expect(resumed.prompt).toBe('Keep researching');
    expect(room.discussion.status).toBe('active'); expect(room.discussion.round).toBe(1);
    await runtime.cancelRoom(room.id);
  } finally {runtime.close();store.close();rmSync(dir,{recursive:true});}
});

test('room redirects interrupt a turn that is still starting before beginning the new direction', async () => {
  const dir = mkdtempSync(join(tmpdir(),'odwyn-room-start-')), store = openStore(dir), provider = new FakeCodex();
  const primary = store.state.agents[0].id;
  store.state.agents.push({id:'scout',customization:{...defaults,name:'Scout'}});
  const room = createRoom(store.state,{title:'Starting room',memberIds:[primary,'scout']});
  const runtime = new Runtime({store,codex:provider,browser:{},workspace:dir});
  const original = provider.request.bind(provider); let release, started;
  const starting = new Promise(resolve=>started=resolve), gate = new Promise(resolve=>release=resolve);
  provider.request = async (method,params) => {
    const result = await original(method,params);
    if (method==='turn/start' && provider.calls.filter(c=>c.method==='turn/start').length===1) { started(); await gate; }
    return result;
  };
  try {
    await runtime.refreshAccount();
    const old = runtime.submitRoom(room.id,{prompt:'Old task',agentId:primary}); await starting;
    const redirect = runtime.messageRoom(room.id,{prompt:'New direction',agentId:primary});
    await Bun.sleep(5); expect(old[0].status).toBe('stopping'); expect(store.state.jobs).toHaveLength(1);
    release(); const next = await redirect; await runtime.drain();
    expect(old[0].status).toBe('cancelled'); expect(next[0].status).toBe('running');
    expect(provider.calls.find(c=>c.method==='turn/interrupt').params.turnId).toBe(old[0].turnId);
    await runtime.cancelRoom(room.id);
  } finally {release();runtime.close();store.close();rmSync(dir,{recursive:true});}
});

test('room discussions share one owner message, take turns with context, and stop the whole round', async () => {
  const dir = mkdtempSync(join(tmpdir(),'odwyn-room-runtime-'));
  const store = openStore(dir), first = new FakeCodex(), second = new FakeCodex();
  store.state.customization = {...defaults,name:'Pip'};
  const primary = store.state.agents[0].id;
  store.state.agents.push({id:'scout',customization:{...defaults,name:'Scout'}});
  const room = createRoom(store.state,{title:'Travel room',memberIds:[primary,'scout']});
  let label='Search',browserCalls=0;
  const browser={last:{url:'https://example.com',elements:[]},inspectAction:async()=>({url:'https://example.com',element:{tag:'button',label}}),action:async()=>{browserCalls++;return {text:'Done'};}};
  const runtime = new Runtime({store,codex:first,browser,workspace:dir}); runtime.addProvider('scout',second);
  try {
    await runtime.refreshAccount();
    expect(()=>runtime.submitRoom(room.id,{prompt:'Compare itineraries'})).toThrow();
    expect(room.messages).toHaveLength(0); expect(store.state.jobs).toHaveLength(0);
    await runtime.refreshAccount('scout');
    const jobs = runtime.submitRoom(room.id,{prompt:'Compare itineraries',interactionMode:'allow'}); await runtime.drain();
    expect(jobs.map(j=>j.agentId)).toEqual([primary,'scout']);
    expect(room.messages.filter(m=>m.role==='user')).toHaveLength(1);
    expect(jobs[0].status).toBe('running'); expect(jobs[1].status).toBe('queued');
    expect(()=>runtime.submit({conversationId:room.id,agentId:primary,prompt:'Bypass active round'})).toThrow();
    expect(first.calls.find(c=>c.method==='thread/start').params.developerInstructions).toContain('Travel room');
    first.emit('notification',{method:'item/completed',params:{threadId:jobs[0].threadId,turnId:jobs[0].turnId,item:{id:'pip-room',type:'agentMessage',text:'Pip suggests Kyoto'}}});
    first.emit('notification',{method:'turn/completed',params:{threadId:jobs[0].threadId,turn:{id:jobs[0].turnId,status:'completed'}}});
    await runtime.drain();
    expect(second.calls.find(c=>c.method==='thread/start').params.developerInstructions).toContain('Pip suggests Kyoto');
    expect(second.calls.find(c=>c.method==='thread/start').params.developerInstructions).toContain('Reply from Pip');
    const invoke=(tool,args,id)=>runtime.handleRequest({id,method:'item/tool/call',params:{threadId:jobs[1].threadId,turnId:jobs[1].turnId,tool,arguments:args}});
    await invoke('odwyn_browser',{action:'click',ref:'0',reason:'Search the requested itinerary'},33);
    expect(second.replies.at(-1).result.success).toBe(true); expect(browserCalls).toBe(1);
    label='Pay for ticket'; const payment=invoke('odwyn_browser',{action:'click',ref:'0',reason:'Pay for the ticket'},34); await Bun.sleep(10);
    expect(jobs[1].pending.risk).toBe('payment'); expect(browserCalls).toBe(1);
    runtime.answer(jobs[1].id,{requestId:jobs[1].pending.id,decision:'deny'}); await payment;
    await invoke('odwyn_remember',{note:'Prefer morning trains'},35); expect(store.state.preferences).toContain('Prefer morning trains');
    await invoke('odwyn_schedule',{prompt:'Check train times',at:new Date(Date.now()+60_000).toISOString(),intervalMinutes:0,interactionMode:'confirm'},36);
    expect(second.replies.at(-1).result.success).toBe(true); expect(store.state.schedules[0].agentId).toBe('scout');
    await runtime.cancelRoom(room.id); expect(jobs[1].status).toBe('cancelled');
    const next = runtime.submitRoom(room.id,{prompt:'Discuss transport'}); await runtime.drain();
    await runtime.cancelRoom(room.id); expect(next.every(j=>j.status==='cancelled')).toBe(true);
    expect(()=>runtime.submitRoom(room.id,{prompt:'Invalid',agentId:'outsider'})).toThrow();
    const single = runtime.submitRoom(room.id,{prompt:'Scout, check details',agentId:'scout'});
    expect(single).toHaveLength(1); expect(single[0].discussionOnly).toBeUndefined();
    await runtime.cancelRoom(room.id);
  } finally {runtime.close();store.close();rmSync(dir,{recursive:true});}
});

test('real tool protocol pauses interactions until exact approval and resumes the same thread', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'odwyn-runtime-'));
  const store = openStore(dir); const codex = new FakeCodex(); codex.config={type:'codex',effort:'high'}; const browserCalls = [];
  store.state.currency='IDR';
  store.state.customization = {...defaults,name:'Pip',ownerName:'Alex',specialization:'Travel planning',tone:'crisp',language:'id',detail:'detailed',userContext:'Beginner traveler'};
  const browser = { last: { url: 'https://example.com', elements: [{ ref: '0', label: 'Submit' }] }, action: async args => { browserCalls.push(args); return { text: 'Done', elements: [] }; } };
  const runtime = new Runtime({ store, codex, browser, workspace: dir, model: 'gpt-6.1-sol' });
  await runtime.refreshAccount();
  store.state.conversations.push({id:'old-chat',agentId:store.state.agents[0].id,messages:[{id:'old-message',role:'user',text:'Existing chat context'}],sessions:{[store.state.agents[0].id]:{threadId:'old-thread',providerKey:'codex',toolBrand:'odwyn'}}});
  const job = runtime.submit({ prompt: 'Fill this form', conversationId:'old-chat' });
  await runtime.drain();
  expect(codex.calls.find(c => c.method === 'thread/start').params.model).toBe('gpt-6.1-sol');
  expect(codex.calls.some(c => c.method === 'thread/resume')).toBe(false);
  expect(codex.calls.find(c => c.method === 'thread/start').params.dynamicTools.every(t => t.name.startsWith('odwyn_'))).toBe(true);
  const identity = codex.calls.find(c => c.method === 'thread/start').params.developerInstructions;
  expect(identity).toContain('Existing chat context');
  expect(identity).toContain('"Pip"'); expect(identity).toContain('"Alex"'); expect(identity).toContain('Travel planning'); expect(identity).toContain('Concise and direct');
  expect(identity).toContain('Owner preferred currency: IDR'); expect(identity).toContain('exchange rate verified using the browser'); expect(identity).toContain('Receipts and confirmed charges keep their exact original amounts');
  expect(identity).toContain('Bahasa Indonesia'); expect(identity).toContain('useful examples'); expect(identity).toContain('Beginner traveler');
  const handle = runtime.handleRequest({ id: 77, method: 'item/tool/call', params: { threadId: 'thread-test', turnId: 'turn-test', tool: 'odwyn_browser', arguments: { action: 'click', ref: '0', reason: 'Submit the requested form' } } });
  await Bun.sleep(10);
  expect(job.status).toBe('waiting'); expect(browserCalls).toHaveLength(0);
  expect(() => runtime.answer(job.id, { requestId: 'stale', decision: 'allow' })).toThrow();
  runtime.answer(job.id, { requestId: job.pending.id, decision: 'allow' });
  await handle;
  expect(browserCalls).toHaveLength(1); expect(codex.replies[0].result.success).toBe(true);
  expect(job.browserUsed).toBe(true);
  codex.emit('notification', { method: 'item/completed', params: { threadId: 'thread-test', turnId: 'turn-test', item: { id: 'message-1', type: 'agentMessage', text: 'Form submitted.', phase: 'final_answer' } } });
  codex.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-test', turn: { id: 'turn-test', status: 'completed' } } });
  expect(job.status).toBe('completed');
  store.state.customization = {...store.state.customization,name:'Momo',tone:'playful'};
  store.state.currency='USD';
  codex.config.effort='low';
  const next = runtime.submit({ prompt: 'What happened?', conversationId: job.conversationId });
  await runtime.drain();
  expect(codex.calls.some(c => c.method === 'thread/resume' && c.params.threadId === 'thread-test')).toBe(true);
  expect(codex.calls.find(c => c.method === 'thread/resume').params.developerInstructions).toContain('"Momo"');
  expect(codex.calls.find(c => c.method === 'thread/resume').params.developerInstructions).toContain('Owner preferred currency: USD');
  expect(codex.calls.filter(c => c.method === 'turn/start').map(c => c.params.effort)).toEqual(['high','low']);
  await runtime.cancel(next.id); runtime.close(); store.close(); rmSync(dir, { recursive: true });
});

test('parallel tools keep distinct owner prompts and active cancellation wins the interrupt notification', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'odwyn-runtime-'));
  const store = openStore(dir); const codex = new FakeCodex();
  const runtime = new Runtime({ store, codex, browser: {}, workspace: dir });
  try {
    await runtime.refreshAccount();
    const job = runtime.submit({ prompt: 'Ask two questions' }); await runtime.drain();
    const ask = (id, question) => runtime.handleRequest({ id, method: 'item/tool/call', params: { threadId: 'thread-test', turnId: 'turn-test', tool: 'odwyn_ask', arguments: { question } } });
    const first = ask(1, 'First question?'); const second = ask(2, 'Second question?');
    await Bun.sleep(10);
    expect(job.pending.detail).toBe('First question?'); expect(runtime.requests.size).toBe(1);
    runtime.answer(job.id, { requestId: job.pending.id, answer: 'First answer' }); await first; await Bun.sleep(10);
    expect(job.pending.detail).toBe('Second question?'); expect(runtime.requests.size).toBe(1);
    runtime.answer(job.id, { requestId: job.pending.id, answer: 'Second answer' }); await second;
    const request = codex.request.bind(codex);
    codex.request = async (method, params) => {
      if (method === 'turn/interrupt') codex.emit('notification', { method: 'turn/completed', params: { threadId: job.threadId, turn: { id: job.turnId, status: 'interrupted' } } });
      return request(method, params);
    };
    await runtime.cancel(job.id);
    expect(job.status).toBe('cancelled'); expect(runtime.active).toBe(null);
    const retry = runtime.retry(job.id); await runtime.drain();
    expect(retry.recovering).toBe(true); expect(job.status).toBe('resumed');
    expect(() => runtime.retry(job.id)).toThrow();
  } finally { runtime.close(); store.close(); rmSync(dir, { recursive: true }); }
});

test('agents keep separate identities, threads and recall while sharing the browser queue', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'odwyn-agents-'));
  const store = openStore(dir), first = new FakeCodex(), second = new FakeCodex();
  store.state.customization = {...defaults,name:'Pip'};
  store.state.agents.push({id:'scout',customization:{...defaults,name:'Scout',tone:'formal'}});
  const runtime = new Runtime({store,codex:first,browser:{},workspace:dir});
  runtime.addProvider('scout',second);
  try {
    await runtime.refreshAccount(); await runtime.refreshAccount('scout');
    const pip = runtime.submit({prompt:'Pip private context'});
    const scout = runtime.submit({prompt:'Scout private context',agentId:'scout'});
    await runtime.drain();
    expect(pip.status).toBe('running'); expect(scout.status).toBe('queued'); expect(second.calls.some(c => c.method === 'turn/start')).toBe(false);
    expect(store.search('private','scout').map(c => c.text)).toEqual(['Scout private context']);
    first.emit('notification',{method:'turn/completed',params:{threadId:pip.threadId,turn:{id:pip.turnId,status:'completed'}}});
    await runtime.drain();
    expect(scout.status).toBe('running');
    expect(second.calls.find(c => c.method === 'thread/start').params.developerInstructions).toContain('"Scout"');
    expect(second.calls.find(c => c.method === 'thread/start').params.developerInstructions).not.toContain('Pip private context');
    // The other provider cannot finish or write into Scout's active conversation.
    first.emit('notification',{method:'turn/completed',params:{threadId:scout.threadId,turn:{id:scout.turnId,status:'completed'}}});
    expect(scout.status).toBe('running');
    const schedule = runtime.schedule({prompt:'Scout routine',agentId:'scout',at:new Date(Date.now()+60_000).toISOString()});
    expect(schedule.agentId).toBe('scout');
    await runtime.cancel(scout.id); const retry = runtime.retry(scout.id); await runtime.drain();
    expect(retry.agentId).toBe('scout');
    expect(second.calls.some(c => c.method === 'thread/resume')).toBe(true);
  } finally {runtime.close();store.close();rmSync(dir,{recursive:true});}
});

test('multiple agents continue one chat with separate sessions and attributed replies', async () => {
  const dir = mkdtempSync(join(tmpdir(),'odwyn-shared-chat-'));
  const store = openStore(dir), pip = new FakeCodex(), scout = new FakeCodex();
  store.state.customization = {...defaults,name:'Pip'};
  const primary = store.state.agents[0].id;
  store.state.agents.push({id:'scout',customization:{...defaults,name:'Scout'}});
  const runtime = new Runtime({store,codex:pip,browser:{},workspace:dir}); runtime.addProvider('scout',scout);
  const complete = (provider,job,text) => {
    provider.emit('notification',{method:'item/completed',params:{threadId:job.threadId,turnId:job.turnId,item:{id:job.id,type:'agentMessage',text}}});
    provider.emit('notification',{method:'turn/completed',params:{threadId:job.threadId,turn:{id:job.turnId,status:'completed'}}});
  };
  try {
    await runtime.refreshAccount(); await runtime.refreshAccount('scout');
    const first = runtime.submit({prompt:'Plan a trip'}); await runtime.drain(); complete(pip,first,'Pip itinerary');
    const second = runtime.submit({agentId:'scout',conversationId:first.conversationId,prompt:'Check the itinerary'}); await runtime.drain();
    expect(scout.calls.find(c=>c.method==='thread/start').params.developerInstructions).toContain('Pip itinerary');
    complete(scout,second,'Scout corrections');
    const third = runtime.submit({agentId:primary,conversationId:first.conversationId,prompt:'Apply corrections'}); await runtime.drain();
    expect(pip.calls.find(c=>c.method==='thread/resume').params.developerInstructions).toContain('Scout corrections');
    complete(pip,third,'Pip revised itinerary');
    const chat = runtime.conversation(third);
    expect(chat.messages.filter(m=>m.role==='assistant').map(m=>m.agentId)).toEqual([primary,'scout',primary]);
    expect(chat.sessions[primary].threadId).toBe(first.threadId); expect(chat.sessions.scout.threadId).toBe(second.threadId);
    expect(chat.lastAgentId).toBe(primary); expect(store.state.conversations).toHaveLength(1);
    deleteAgent(store.state,'scout'); runtime.providers.delete('scout'); runtime.accounts.delete('scout');
    delete chat.sessions[primary]; delete chat.threadId;
    const continued=runtime.submit({agentId:primary,conversationId:chat.id,prompt:'Continue after Scout leaves'}); await runtime.drain();
    expect(continued.status).toBe('running');
    expect(pip.calls.filter(c=>c.method==='thread/start').at(-1).params.developerInstructions).toContain('Reply from Scout');
    complete(pip,continued,'Continuing with saved corrections');
  } finally {runtime.close();store.close();rmSync(dir,{recursive:true});}
});

test('approval modes auto-approve only allowed risks and never bypass payment confirmation', async () => {
  const dir=mkdtempSync(join(tmpdir(),'odwyn-approvals-')), store=openStore(dir), codex=new FakeCodex();
  let label='Search', calls=0;
  const browser={last:{url:'https://example.com',elements:[{ref:'0',label:'Search'}]},inspectAction:async action=>({url:'https://example.com',element:action.ref === undefined && !(action.x === 469 && action.y === 421) ? null : {tag:'button',label,type:label === 'Password' ? 'password' : undefined},dialog:action.action === 'dialog' ? {type:'confirm',message:label} : undefined}),action:async()=>{calls++;return {text:'Done'};}};
  const runtime=new Runtime({store,codex,browser,workspace:dir});
  try {
    await runtime.refreshAccount();
    expect(()=>runtime.submit({prompt:'Invalid mode',interactionMode:'yes'})).toThrow();
    for (const mode of ['confirm','safe','allow']) {
      const job=runtime.submit({prompt:'Search and save',interactionMode:mode}); await runtime.drain();
      const invoke=action=>runtime.handleRequest({id:calls+100,method:'item/tool/call',params:{threadId:job.threadId,turnId:job.turnId,tool:'odwyn_browser',arguments:{reason:'Perform the requested action',...action}}});
      for (const [target,auto,action={action:'click'}] of [['Search',mode!=='confirm'],['Save profile',mode==='allow'],['Add Children',mode==='allow'],['Next month',mode==='allow'],['Continue',mode==='allow'],['Enter a destination or property',mode!=='confirm',{action:'press',text:'Enter'}],['Name',mode==='allow',{action:'type',text:'Odwyn'}],['Continue',mode==='allow',{action:'press',text:'Enter'}],['Summarecon Mal Serpong',mode==='allow',{action:'click',x:469,y:421,ref:undefined}],['Destination',mode!=='confirm',{action:'fill',text:'Serpong'}],['Guests',mode!=='confirm',{action:'select',text:'2'}],['Upload file',mode==='allow',{action:'upload',fileId:'00000000-0000-0000-0000-000000000000'}],['Continue',mode==='allow',{action:'dialog',choice:'accept'}],['Cancel',mode!=='confirm',{action:'dialog',choice:'dismiss'}]]) {
        label=target; const before=calls, pending=invoke({ref:'0',...action}); await Bun.sleep(10);
        if (auto) expect(job.pending).toBeFalsy();
        else { expect(job.pending.type).toBe('interaction'); expect(calls).toBe(before); runtime.answer(job.id,{requestId:job.pending.id,decision:'allow'}); }
        await pending; expect(calls).toBe(before+1);
      }
      label='Pay Rp 100,000'; const before=calls;
      for (const action of [{action:'click'},{action:'fill',text:'100'},{action:'select',text:'100'},{action:'type',text:'100'},{action:'press',text:'Enter'},{action:'upload',fileId:'00000000-0000-0000-0000-000000000000'},{action:'dialog',choice:'accept'}]) {
        const payment=invoke({ref:'0',...action}); await Bun.sleep(10);
        expect(job.pending.risk).toBe('payment'); expect(calls).toBe(before);
        expect(()=>runtime.answer(job.id,{requestId:job.pending.id,decision:'allow-run'})).toThrow('payment');
        runtime.answer(job.id,{requestId:job.pending.id,decision:'deny'}); await payment; expect(calls).toBe(before);
      }
      label='Catalogue navigation';
      for (const x of [12,1245]) {
        const beforeUnknown=calls, unknown=invoke({action:'click',x,y:400}); await Bun.sleep(10);
        if (mode === 'allow') { expect(job.pending).toBeFalsy(); await unknown; expect(calls).toBe(beforeUnknown+1); }
        else { expect(job.pending.risk).toBe('unknown'); expect(calls).toBe(beforeUnknown); runtime.answer(job.id,{requestId:job.pending.id,decision:'deny'}); await unknown; }
      }
      label='Password'; const beforeCredential=calls, credential=invoke({action:'press',ref:'0',text:'Enter'}); await Bun.sleep(10);
      expect(job.pending.risk).toBe('credential'); expect(calls).toBe(beforeCredential);
      expect(()=>runtime.answer(job.id,{requestId:job.pending.id,decision:'allow-run'})).toThrow('credential');
      runtime.setInteractionMode(job.id,mode); expect(job.pending.risk).toBe('credential');
      runtime.answer(job.id,{requestId:job.pending.id,decision:'deny'}); await credential;
      if (mode === 'confirm') {
        label='Catalogue navigation'; const pending=invoke({action:'click',x:1245,y:400}); await Bun.sleep(10);
        runtime.setInteractionMode(job.id,'allow'); await pending;
        expect(job.pending).toBe(null); expect(job.interactionMode).toBe('allow'); expect(calls).toBe(before+1);
        label='Pay now'; const payment=invoke({action:'click',ref:'0'}); await Bun.sleep(10);
        runtime.setInteractionMode(job.id,'allow'); expect(job.pending.risk).toBe('payment');
        runtime.answer(job.id,{requestId:job.pending.id,decision:'deny'}); await payment;
        expect(()=>runtime.setInteractionMode(job.id,'invalid')).toThrow();
      }
      await runtime.cancel(job.id);
    }
  } finally {runtime.close();store.close();rmSync(dir,{recursive:true});}
});

test('terminal always needs exact approval, reaches all providers, and stops with the task', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'odwyn-terminal-runtime-'));
  const store = openStore(dir), codex = new FakeCodex();
  const runtime = new Runtime({ store, codex, browser: {}, workspace: dir });
  const invoke = (job, command, id) => runtime.handleRequest({ id, method: 'item/tool/call', params: { threadId: job.threadId, turnId: job.turnId, tool: 'odwyn_terminal', arguments: { command, reason: 'Run the requested check' } } });
  try {
    await runtime.refreshAccount();
    for (const type of ['codex', 'claude', 'openai']) {
      codex.config = { type };
      for (const interactionMode of ['confirm', 'safe', 'allow']) {
        const job = runtime.submit({ prompt: 'Check terminal', interactionMode }); await runtime.drain();
        const params = codex.calls.filter(c => c.method === 'thread/start').at(-1).params;
        expect(params.dynamicTools.some(t => t.name === 'odwyn_terminal')).toBe(true);
        const denied = invoke(job, 'touch declined', `${type}-${interactionMode}-deny`); await Bun.sleep(10);
        expect(job.pending.type).toBe('terminal'); expect(job.pending.preview).toBe('touch declined');
        expect(() => runtime.answer(job.id, { requestId: job.pending.id, decision: 'allow-run' })).toThrow('terminal');
        runtime.answer(job.id, { requestId: job.pending.id, decision: 'deny' }); await denied;
        expect(codex.replies.at(-1).result.success).toBe(false);
        const command = invoke(job, 'test ! -e declined && printf approved', `${type}-${interactionMode}-allow`); await Bun.sleep(10);
        runtime.answer(job.id, { requestId: job.pending.id, decision: 'allow' }); await command;
        const reply = codex.replies.at(-1).result;
        expect(reply.success).toBe(true); expect(JSON.parse(reply.contentItems[0].text).stdout).toBe('approved');
        await runtime.cancel(job.id);
      }
    }
    const job = runtime.submit({ prompt: 'Long command' }); await runtime.drain();
    const running = invoke(job, 'sleep 10', 'cancel-command'); await Bun.sleep(10);
    runtime.answer(job.id, { requestId: job.pending.id, decision: 'allow' }); await Bun.sleep(10);
    expect(runtime.terminalRun?.job).toBe(job);
    await runtime.cancel(job.id); await running;
    expect(job.status).toBe('cancelled'); expect(runtime.terminalRun).toBe(null);
    expect(JSON.parse(codex.replies.at(-1).result.contentItems[0].text).cancelled).toBe(true);
  } finally { runtime.close(); store.close(); rmSync(dir, { recursive: true, force: true }); }
});
