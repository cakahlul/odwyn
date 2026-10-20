import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {defaults} from '../public/profile.js';
import {newPageWithoutTutorials} from '../tests/browser-page.js';

test('skill and knowledge pickers search, paginate, retain hidden selections and reset cancelled changes',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-assignments-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex:Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}}),browser:{close:async()=>{}}});
  const state=app.runtime.state;state.customization={...defaults};state.globalProvider.configured=true;
  state.skills=Array.from({length:125},(_,i)=>({id:randomUUID(),name:`Skill ${i}`,command:`skill-${i}`,description:`Review area ${i}`,instructions:`Check area ${i}.`}));
  state.knowledge=Array.from({length:35},(_,i)=>({id:randomUUID(),name:`Document ${i}`,summary:`Architecture area ${i}`,content:`Use rule ${i}.`,version:1}));app.runtime.changed();
  const browser=await chromium.launch(),page=await newPageWithoutTutorials(browser,{httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:960}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000);
  const open=()=>page.evaluate(async()=>{const {openCustomization}=await import('/customize.js');openCustomization();});
  const artifacts=join(import.meta.dir,'../artifacts/ui/assignments');mkdirSync(artifacts,{recursive:true});
  const selected={};
  try{
    await page.goto(server.url.href+'#chat');await page.locator('#prompt').waitFor();await open();
    for(const [kind,items] of [['skill',state.skills],['knowledge',state.knowledge]]){
      const options=page.locator(`#agent-${kind}-options`),search=page.locator(`#agent-${kind}-search`);
      expect(await options.locator('input').count()).toBe(10);
      expect(await page.locator(`#agent-${kind}-previous`).isDisabled()).toBe(true);
      await options.locator('input').first().focus();await page.keyboard.press('Space');
      expect(await options.locator('input').first().evaluate(node=>node===document.activeElement)).toBe(true);
      await page.locator(`#agent-${kind}-next`).click();
      await options.locator('input').first().check();
      await search.fill(kind==='skill'?'Review area 124':'Architecture area 34');
      expect(await options.locator('input').count()).toBe(1);await options.locator('input').check();
      expect(await page.locator(`#agent-${kind}-summary`).textContent()).toContain('3 selected');
      await search.fill('no-such-item');expect(await options.textContent()).toContain('No matches');
      expect(await page.locator(`#agent-${kind}-next`).isDisabled()).toBe(true);
      await search.fill('');expect(await options.locator('input').first().isChecked()).toBe(true);
      selected[`${kind}Ids`]=[items[0].id,items[10].id,items.at(-1).id];
    }
    await page.locator('#customize-save').click();await page.locator('#customize-dialog').waitFor({state:'hidden'});
    expect(state.customization.skillIds).toEqual(selected.skillIds);expect(state.customization.knowledgeIds).toEqual(selected.knowledgeIds);
    await page.reload();await open();
    for(const kind of ['skill','knowledge']){
      expect(await page.locator(`#agent-${kind}-summary`).textContent()).toContain('3 selected');
      await page.locator(`#agent-${kind}-search`).fill(kind==='skill'?'skill-124':'Document 34');
      const checkbox=page.locator(`#agent-${kind}-options input`);expect(await checkbox.isChecked()).toBe(true);await checkbox.uncheck();
    }
    await page.locator('#customize-cancel').click();await open();
    for(const kind of ['skill','knowledge']){
      expect(await page.locator(`#agent-${kind}-search`).inputValue()).toBe('');
      expect(await page.locator(`#agent-${kind}-summary`).textContent()).toContain('3 selected');
    }
    for(const width of [320,768,1440]){
      await page.setViewportSize({width,height:900});
      expect(await page.locator('#customize-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      await page.locator('#agent-skill-search').scrollIntoViewIfNeeded();
      await page.screenshot({path:join(artifacts,`pickers-${width}.png`)});
    }
    expect(errors).toEqual([]);
  }finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30_000);
