import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, createJob, createRoom, updateRoom, enqueueSchedules, recoverJobs } from '../store.js';
import { authorize, allowedOrigin, validateAction, publicAddress, browserActionRisk } from '../security.js';
import { Database } from 'bun:sqlite';
import { defaults, validateProfile } from '../public/profile.js';

test('new customization preferences preserve legacy profiles and reject invalid values', () => {
  const legacy = {...defaults,name:'Pip'};
  for (const key of ['motion','language','detail','userContext']) delete legacy[key];
  expect(validateProfile(legacy)).toEqual({...defaults,name:'Pip'});
  expect(validateProfile({...defaults,shape:'fox',eyes:'wide',mouth:'cheerful',accessory:'headphones',tone:'patient',language:'id',detail:'detailed',motion:'reduced',userContext:'Learning to code\nPrefer examples'}).userContext).toContain('\n');
  for (const key of ['motion','language','detail','tone','shape','eyes','mouth','accessory']) expect(()=>validateProfile({...defaults,[key]:'__proto__'})).toThrow();
  expect(()=>validateProfile({...defaults,userContext:'x'.repeat(501)})).toThrow();
  expect(()=>validateProfile({...defaults,userContext:'bad\u0000context'})).toThrow();
});

test('rooms persist participants and keep ordinary chats separate', () => {
  const directory = mkdtempSync(join(tmpdir(),'odwyn-rooms-'));
  let store = openStore(directory);
  try {
    const primary = store.state.agents[0].id;
    store.state.agents.push({id:'scout',customization:{...defaults,name:'Scout'}},{id:'writer',customization:{...defaults,name:'Writer'}});
    for (const memberIds of [[primary],[primary,primary],[primary,'missing'],null]) expect(()=>createRoom(store.state,{title:'Trip room',memberIds})).toThrow();
    expect(store.state.conversations).toHaveLength(0);
    const room = createRoom(store.state,{title:'  Trip room  ',memberIds:[primary,'scout']});
    expect(room.title).toBe('Trip room'); expect(room.kind).toBe('room');
    expect(()=>createJob(store.state,{conversationId:room.id,agentId:'writer',prompt:'Outside room'})).toThrow();
    expect(room.messages).toHaveLength(0);
    const turn = createJob(store.state,{conversationId:room.id,agentId:'scout',prompt:'Plan a trip'});
    expect(()=>updateRoom(store.state,room.id,{title:'Weekend plans',memberIds:[primary,'writer']})).toThrow();
    turn.status = 'completed';
    updateRoom(store.state,room.id,{title:'Weekend plans',memberIds:[primary,'writer']});
    expect(room.lastAgentId).toBe(primary);
    expect(room.messages[0].agentId).toBe('scout');
    const chat = createJob(store.state,{prompt:'Private chat',agentId:'scout'});
    store.save(); store.close(); store = openStore(directory);
    expect(store.state.conversations.find(c=>c.id===room.id).memberIds).toEqual([primary,'writer']);
    expect(store.search('trip','writer')).toHaveLength(1);
    expect(store.search('Private','writer')).toHaveLength(0);
    expect(store.state.conversations.find(c=>c.id===chat.conversationId).kind).toBeUndefined();
  } finally {store.close();rmSync(directory,{recursive:true});}
});

test('authenticated requests and same-origin writes only', () => {
  expect(authorize('Basic ' + Buffer.from('owner:secret').toString('base64'), 'owner', 'secret')).toBe(true);
  expect(authorize('Basic invalid', 'owner', 'secret')).toBe(false);
  expect(allowedOrigin('https://evil.test', 'https://assistant.test')).toBe(false);
  expect(allowedOrigin('https://assistant.test', 'https://assistant.test')).toBe(true);
});

test('browser input cannot execute arbitrary code or reach private IPs', () => {
  expect(() => validateAction({ action: 'evaluate', code: 'process.env' })).toThrow();
  expect(() => validateAction({ action: 'navigate', url: 'file:///etc/passwd' })).toThrow();
  expect(() => validateAction({ action: 'click', x: -1, y: 5 })).toThrow();
  expect(() => validateAction({ action: 'click' })).toThrow();
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.2', '::1', 'fc00::1', '::ffff:127.0.0.1']) expect(publicAddress(address)).toBe(false);
  expect(publicAddress('93.184.216.34')).toBe(true);
  expect(publicAddress('2606:4700:4700::1111')).toBe(true);
});

test('jobs persist, repeat schedules do not duplicate, interrupted work needs review', () => {
  const dir = mkdtempSync(join(tmpdir(), 'odwyn-test-'));
  let store = openStore(dir);
  const job = createJob(store.state, { prompt: 'Check the KPI', interactionMode: 'confirm' });
  job.status = 'running';
  const stopping = createJob(store.state, { prompt: 'Stopping task' }); stopping.status = 'stopping';
  store.state.schedules.push({ id: 'daily', prompt: 'Check again', interactionMode: 'confirm', enabled: true, nextAt: '2026-10-05T00:00:00.000Z', intervalMinutes: 1440 });
  expect(enqueueSchedules(store.state, new Date('2026-10-05T01:00:00Z'))).toBe(1);
  expect(enqueueSchedules(store.state, new Date('2026-10-05T01:00:00Z'))).toBe(0);
  store.save(); store.close();
  store = openStore(dir);
  recoverJobs(store.state);
  expect(store.state.jobs.find(j => j.id === job.id).status).toBe('interrupted');
  expect(store.state.jobs.find(j => j.id === stopping.id).status).toBe('interrupted');
  expect(store.state.jobs.filter(j => j.scheduleId === 'daily')).toHaveLength(1);
  expect(store.state.conversations[0].messages[0].text).toBe('Check again');
  store.close(); rmSync(dir, { recursive: true });
});

test('existing single-agent data migrates without losing identity, chats or routines', () => {
  const dir = mkdtempSync(join(tmpdir(),'odwyn-legacy-'));
  const legacy = openStore(dir); legacy.close();
  const database = new Database(join(dir,'odwyn.db'));
  const profile = {...defaults,name:'Pip'};
  database.query('INSERT INTO state VALUES (1, ?)').run(JSON.stringify({customization:profile,preferences:'Jakarta time',conversations:[{id:'chat',messages:[{id:'message',role:'user',text:'Legacy trip',at:'2026-10-05T00:00:00Z'}]}],jobs:[{id:'job',conversationId:'chat',status:'completed'}],schedules:[{id:'routine',prompt:'Check again',enabled:true,nextAt:'2026-10-05T00:00:00Z'}]}));
  database.close();
  const store = openStore(dir);
  try {
    expect(store.state.agents).toHaveLength(1); expect(store.state.agents[0].customization).toEqual(profile);
    expect(store.state.appearance).toEqual({palette:profile.palette,motion:profile.motion});
    for (const item of [...store.state.conversations,...store.state.jobs,...store.state.schedules]) expect(item.agentId).toBe(store.state.agents[0].id);
    expect(store.state.preferences).toBe('Jakarta time');
    expect(enqueueSchedules(store.state,new Date('2026-10-06T00:00:00Z'))).toBe(1);
    expect(store.state.jobs[0].agentId).toBe(store.state.agents[0].id);
    store.save(); expect(store.search('Legacy',store.state.agents[0].id)[0].text).toBe('Legacy trip');
  } finally {store.close();rmSync(dir,{recursive:true});}
});


test('Odwyn opens the previous database and renames only the default agent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'odwyn-rebrand-'));
  const database = new Database(join(dir, 'sidekick.db'));
  const original = { preferences:'Keep my chats', customization:{...defaults,name:'Sidekick'}, agents:[{id:'primary',customization:{...defaults,name:'Sidekick'}},{id:'pip',customization:{...defaults,name:'Pip'}}], conversations:[{id:'saved',agentId:'primary',messages:[{id:'message',agentId:'primary',role:'assistant',text:'Saved answer',at:'2026-10-05T00:00:00Z'}]}] };
  database.exec('CREATE TABLE state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  database.query('INSERT INTO state VALUES (1, ?)').run(JSON.stringify(original)); database.close();
  let store = openStore(dir);
  try {
    expect(store.state.customization.name).toBe('Odwyn');
    expect(store.state.agents.map(a=>a.customization.name)).toEqual(['Odwyn','Pip']);
    expect(store.state.preferences).toBe(original.preferences);
    expect(store.state.conversations).toEqual(original.conversations);
    expect(existsSync(join(dir,'odwyn.db'))).toBe(false);
    store.save(); store.close(); store = openStore(dir);
    expect(store.state.agents[0].id).toBe('primary');
    expect(store.search('Saved')[0].text).toBe('Saved answer');
  } finally {store.close();rmSync(dir,{recursive:true});}
});


test('browser risk checks fail closed for checkout, credentials, dialogs and unknown controls', () => {
  const target={tag:'button',label:'Search'};
  const click={action:'click',ref:'0'};
  expect(browserActionRisk(click,{element:target})).toBe('safe');
  expect(browserActionRisk({action:'fill',ref:'0',text:'Name'},{element:{tag:'input',label:'Update profile'}})).toBe('interaction');
  for (const context of [{url:'https://shop.test/checkout',element:target},{hasPaymentFields:true,element:target},{element:{...target,context:'Credit card payment'}},{element:{...target,label:'Confirm booking'}},{element:{...target,label:'Continue'}}]) expect(['payment','unknown']).toContain(browserActionRisk(click,context));
  expect(browserActionRisk({action:'fill',ref:'0',text:'secret'},{element:{tag:'input',type:'password',label:'Password'}})).toBe('unknown');
  expect(browserActionRisk({action:'fill',ref:'0',text:'123'},{element:{tag:'input',autocomplete:'cc-number',label:'Number'}})).toBe('payment');
  expect(browserActionRisk({action:'dialog',choice:'accept'})).toBe('unknown');
  expect(browserActionRisk({action:'dialog',choice:'dismiss'})).toBe('safe');
  expect(browserActionRisk({action:'press',text:'Enter'})).toBe('unknown');
  expect(browserActionRisk({action:'click',ref:'0'},{element:{tag:'a',href:'https://shop.test/?action=delete',label:'Link'}})).toBe('unknown');
});

test('conversation deletion removes messages, runs and indexed recall, preserving agents and files', () => {
  const dir=mkdtempSync(join(tmpdir(),'odwyn-delete-chat-')); let store=openStore(dir);
  try {
    const job=createJob(store.state,{prompt:'Uniquedeletedphrase'}), chat=store.state.conversations[0];
    const retained=createJob(store.state,{prompt:'Keep this conversation'}); retained.status='completed';
    store.state.files.push({id:'keep-file',jobId:job.id,name:'Saved result'}); store.save();
    for (const status of ['queued','running','waiting','takeover','stopping']) {
      job.status=status; expect(()=>store.deleteConversation(chat.id)).toThrow('Stop');
      expect(store.state.conversations.some(c=>c.id===chat.id)).toBe(true);
    }
    job.status='completed'; expect(store.search('Uniquedeletedphrase')).toHaveLength(1);
    store.deleteConversation(chat.id);
    expect(store.state.conversations.map(c=>c.id)).toEqual([retained.conversationId]);
    expect(store.state.jobs.map(j=>j.id)).toEqual([retained.id]);
    expect(store.search('Uniquedeletedphrase')).toEqual([]);
    const db=new Database(join(dir,'odwyn.db'),{readonly:true});
    expect(db.query('SELECT count(*) AS count FROM chat_chunks WHERE conversationId = ?').get(chat.id).count).toBe(0); db.close();
    expect(store.state.agents).toHaveLength(1); expect(store.state.files[0].id).toBe('keep-file');
    store.close(); store=openStore(dir);
    expect(store.state.conversations).toHaveLength(1); expect(store.state.jobs).toHaveLength(1); expect(store.search('Uniquedeletedphrase')).toEqual([]);
    expect(()=>store.deleteConversation(chat.id)).toThrow('not found');
  } finally {store.close();rmSync(dir,{recursive:true});}
});
