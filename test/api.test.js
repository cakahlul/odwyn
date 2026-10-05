import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { createApp } from '../server.js';
import { defaults } from '../public/profile.js';
import { openStore } from '../store.js';

test('API protects files and browser control, persists uploads and validates schedules', async () => {
  const directory = mkdtempSync(join(tmpdir(),'sidekick-api-'));
  const codex = new EventEmitter(); codex.request = async () => ({ account:null }); codex.stop = () => {};
  const browser = { frame:async () => null, close:async () => {}, serial:async fn => fn(), start:async () => {} };
  const app = createApp({ directory, user:'owner', password:'test-password-long-enough', origin:'https://assistant.test', codex, browser });
  await app.runtime.refreshAccount();
  const headers = { authorization:'Basic ' + Buffer.from('owner:test-password-long-enough').toString('base64'), origin:'https://assistant.test', 'content-type':'application/json' };
  const request = (path, method='GET', body, extra={}) => app.fetch(new Request(`https://assistant.test${path}`, { method, headers:{...headers,...extra}, ...(body ? { body:JSON.stringify(body) } : {}) }));
  try {
    expect((await app.fetch(new Request('https://assistant.test/api/state'))).status).toBe(401);
    expect((await request('/api/jobs','POST',{prompt:'Read a website'},{origin:'https://evil.test'})).status).toBe(403);
    const profile = {...defaults,name:'Pip',ownerName:'Alex',specialization:'Travel planning',palette:'harbor',shape:'cat',tone:'crisp'};
    expect((await request('/api/customization','PUT',profile,{origin:'https://evil.test'})).status).toBe(403);
    expect((await request('/api/customization','PUT',profile)).status).toBe(200);
    expect((await request('/api/customization','PUT',{...profile,bodyColor:'red" onload="alert(1)'})).status).toBe(400);
    expect((await request('/api/customization','PUT',{...profile,name:'',palette:'__proto__'})).status).toBe(400);
    expect((await request('/api/customization','PUT',{...profile,specialization:'x'.repeat(501)})).status).toBe(400);
    expect((await (await request('/api/state')).json()).customization).toEqual(profile);
    const persisted = openStore(directory); expect(persisted.state.customization).toEqual(profile); persisted.close();
    expect((await request('/api/browser/action','POST',{action:'navigate',url:'https://example.com'})).status).toBe(409);
    const job = await (await request('/api/jobs','POST',{prompt:'Read a website'})).json();
    expect(job.status).toBe('queued');
    expect((await request('/api/schedules','POST',{prompt:'Daily check',at:'2020-01-01',intervalMinutes:1440})).status).toBe(400);
    const schedule = await (await request('/api/schedules','POST',{prompt:'Daily check',at:new Date(Date.now()+60_000).toISOString(),intervalMinutes:1440})).json();
    expect(schedule.enabled).toBe(true);
    const form = new FormData(); form.append('file',new File(['safe content'],'<script>.txt'));
    const uploaded = await (await app.fetch(new Request('https://assistant.test/api/files',{method:'POST',headers:{authorization:headers.authorization,origin:headers.origin},body:form}))).json();
    const download = await request(`/api/files/${uploaded.id}`);
    expect(download.headers.get('content-type')).toBe('application/octet-stream');
    expect(await download.text()).toBe('safe content');
    expect((await app.fetch(new Request(`https://assistant.test/api/files/${uploaded.id}`))).status).toBe(401);
    expect((await request('/api/files/../../.env')).status).toBe(404);
    await request('/api/preferences','PUT',{text:'Based in Jakarta'});
    expect((await (await request('/api/state')).json()).preferences).toBe('Based in Jakarta');
    await request(`/api/jobs/${job.id}/cancel`,'POST',{});
    expect(app.runtime.state.jobs[0].status).toBe('cancelled');
  } finally { await app.close(); rmSync(directory,{recursive:true}); }
});
