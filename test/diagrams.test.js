import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {defaults} from '../public/profile.js';
import {newPageWithoutTutorials} from '../tests/browser-page.js';

test('agent diagrams render visually, retain source/downloads, fit mobile, and isolate untrusted syntax',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-diagrams-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>app.fetch(req)});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex:Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}}),browser:{close:async()=>{}}});
  const state=app.runtime.state,primary=state.agents[0].id,at=new Date().toISOString();state.customization={...defaults,name:'Pip'};state.provider.configured=state.globalProvider.configured=true;
  const sequence='sequenceDiagram\nactor Pengguna\nparticipant UI as UI React\nparticipant Platform as Platform API\nparticipant CDN\nPengguna->>UI: Klik Play\nUI->>Platform: Permintaan pemutaran\nPlatform->>CDN: Ambil data audio\nCDN-->>Platform: Data audio\nPlatform-->>UI: Status pemutaran';
  const flow='flowchart LR\nE["Event aplikasi"] --> P["Pub/Sub<br/>Pengiriman pesan"]\nP --> D["Pemrosesan data<br/>Scio / Beam / Dataflow / Flink"]\nD --> B["Dataset analitik<br/>BigQuery / penyimpanan"]\nB --> T["Pelatihan model"]\nT --> R["Layanan rekomendasi"]';
  const fence=(lang,text)=>'```'+lang+'\n'+text+'\n```';
  state.conversations=[{id:'diagrams',agentId:primary,title:'Diagrams',createdAt:at,messages:[
    {id:'user',agentId:primary,role:'user',text:fence('mermaid',flow),at},
    {id:'sequence',agentId:primary,role:'assistant',text:fence('mermaid',sequence),at},
    {id:'flow',agentId:primary,role:'assistant',text:fence('',flow),at},
    {id:'infographic',agentId:primary,role:'assistant',text:fence('mermaid','mindmap\n  root((Audio playback))\n    Buffer\n    Decode\n    Output'),at},
    {id:'invalid',agentId:primary,role:'assistant',text:fence('mermaid','flowchart LR\nA[broken'),at},
    {id:'unsafe',agentId:primary,role:'assistant',text:fence('mermaid','%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\nA-->B'),at},
    {id:'code',agentId:primary,role:'assistant',text:fence('js','console.log("Keep code as code")'),at},
    {id:'image',agentId:primary,role:'assistant',text:fence('mermaid','flowchart LR\nA["<img src=\'https://evil.invalid/track\' onerror=\'parent.window.diagramPwned=true\'>"] --> B'),at},
  ]}];app.runtime.changed();
  const browser=await chromium.launch({channel:process.env.ODWYN_TEST_BROWSER_CHANNEL}),page=await newPageWithoutTutorials(browser,{httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:960}});
  const consoleErrors=[];page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
  const external=[];page.on('request',request=>{if(request.url().startsWith('https://evil.invalid'))external.push(request.url());});page.setDefaultTimeout(15000);
  try{
    const response=await page.goto(server.url.href+'#chat/diagrams');expect(response.headers()['content-security-policy']).not.toContain("style-src 'self' 'unsafe-inline'");
    await page.locator('.message-assistant .diagram-image').first().waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('.diagram-image').length>=2);
    await page.locator('.message-assistant').filter({has:page.locator('[data-copy="infographic"]')}).locator('.diagram-image').waitFor();
    const images=page.locator('.diagram-image');expect(await images.count()).toBeGreaterThanOrEqual(2);
    for(let i=0;i<2;i++)expect(await images.nth(i).evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
    expect(await page.locator('.message-user .diagram-image').count()).toBe(0);
    expect(await page.locator('.language-js').textContent()).toContain('Keep code as code');
    const first=page.locator('.diagram-block').first();expect(await first.locator('details').evaluate(el=>el.open)).toBe(false);
    await first.getByText('Diagram source',{exact:true}).click();expect(await first.locator('pre').textContent()).toContain('sequenceDiagram');
    const downloadPromise=page.waitForEvent('download');await first.getByRole('link',{name:'Download SVG'}).click();expect((await downloadPromise).suggestedFilename()).toBe('diagram.svg');expect(decodeURIComponent(await first.getByRole('link',{name:'Download SVG'}).getAttribute('href'))).toContain('Klik Play');
    await page.locator('.diagram-status').filter({hasText:'Could not render'}).first().waitFor();
    expect(await page.locator('.diagram-status').filter({hasText:'Could not render'}).count()).toBeGreaterThanOrEqual(2);
    expect(await page.locator('iframe[title="Diagram renderer"]').getAttribute('sandbox')).toBe('allow-scripts');
    expect(await page.evaluate(()=>window.diagramPwned)).toBeUndefined();expect(external).toEqual([]);
    await first.getByText('Diagram source',{exact:true}).click();await first.scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/odwyn-diagrams-desktop.png'});
    await page.setViewportSize({width:390,height:844});
    expect(await first.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await first.scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/odwyn-diagrams-mobile.png'});
    await first.getByRole('button',{name:'Expand diagram'}).click();await page.locator('.diagram-preview[open]').waitFor();expect(await page.locator('.diagram-preview-image').evaluate(img=>img.getBoundingClientRect().width)).toBeGreaterThanOrEqual(1000);
    await page.getByRole('button',{name:'Close diagram'}).click();await page.locator('.diagram-preview').waitFor({state:'detached'});
    state.agents.push({id:'peer',customization:{...defaults,name:'Scout'},provider:{...state.provider}});state.conversations[0].kind='room';state.conversations[0].memberIds=[primary,'peer'];app.runtime.changed();
    await page.reload();await page.locator('.room-messages .diagram-image').first().waitFor();
    expect(await page.evaluate(()=>{try{document.querySelector('iframe[title="Diagram renderer"]').contentWindow.document;return false;}catch{return true;}})).toBe(true);
  }catch(error){console.log(consoleErrors);console.log(await page.locator('.diagram-block').evaluateAll(nodes=>nodes.map(node=>({source:node.querySelector('code').textContent,status:node.querySelector('.diagram-status')?.textContent,image:!!node.querySelector('img')}))));throw error;}finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},40000);
