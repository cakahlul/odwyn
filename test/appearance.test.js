import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { defaults, palettes, appearanceVars, validateAppearance } from '../public/profile.js';

test('workspace themes preview, customize, validate, persist and reset without changing agent overrides',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-appearance-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  const makeApp=()=>createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex:Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}}),browser:{close:async()=>{}}});
  app=makeApp();app.runtime.state.customization={...defaults,name:'Oddy'};app.runtime.state.provider.configured=true;app.runtime.state.globalProvider.configured=true;app.runtime.state.preferences='Keep my preferences';
  const agent=app.runtime.state.agents[0],at=new Date().toISOString();
  app.runtime.state.conversations=[{id:'theme-chat',agentId:agent.id,title:'Weekend plans',createdAt:at,messages:[{id:'one',role:'user',text:'Can you check the itinerary?',at},{id:'two',role:'assistant',text:'Three options ready to compare.',at}]}];app.runtime.changed();
  const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000);
  const artifacts=resolve(import.meta.dir,'../artifacts');mkdirSync(artifacts,{recursive:true});
  const request=async(path,appearance)=>{const response=await app.fetch(new Request(new URL(path,server.url),{method:'PUT',headers:{authorization:'Basic '+Buffer.from('owner:test-password-long-enough').toString('base64'),origin:server.url.origin,'content-type':'application/json'},body:JSON.stringify(path==='/api/preferences' ? {text:'Keep my preferences',appearance} : appearance)}));return response;};
  const setRange=async(key,value)=>page.locator(`#appearance-${key}`).evaluate((node,value)=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));},value);
  const openSettings=async()=>{if((await page.viewportSize()).width<=760)await page.locator('#menu-button').click();await page.locator('#settings-open').click();};
  try{
    const base={palette:'graphite',motion:'reduced'};
    for(const path of ['/api/appearance','/api/preferences'])for(const bad of [{...base,opacity:59},{...base,blur:33},{...base,depth:'90'},{...base,radius:3},{...base,customColors:{paper:'url(x)'}},{...base,customColors:{ink:'#ffffff'}},{...base,customColors:{paper:'#ffffff',surface:'#000000'}}])expect((await request(path,bad)).status).toBe(400);
    expect(validateAppearance({palette:'paper',motion:'system'})).toEqual({palette:'paper',motion:'system'});
    await page.goto(server.url.href+'#chat/theme-chat');await page.locator('#messages').waitFor();await openSettings();
    for(const palette of Object.keys(palettes)){
      await page.locator(`input[name=workspacePalette][value=${palette}]`).check();
      expect(await page.locator('#appearance-preview').evaluate(node=>node.style.getPropertyValue('--paper'))).toBe(palettes[palette].vars.paper);
      expect(await page.locator(':root').evaluate(node=>node.style.getPropertyValue('--paper'))).toBe(palettes.paper.vars.paper);
    }
    await page.locator('input[name=workspacePalette][value=graphite]').check();
    expect(await page.locator('.appearance-preview-message:not(.appearance-preview-own)').evaluate(node=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=canvas.height=1;ctx.fillStyle=getComputedStyle(node).backgroundColor;ctx.fillRect(0,0,1,1);return Math.max(...ctx.getImageData(0,0,1,1).data.slice(0,3));})).toBeLessThan(100);
    await page.screenshot({path:join(artifacts,'workspace-palettes.png'),animations:'disabled'});
    await page.locator('.appearance-custom summary').click();await page.locator('#appearance-custom-colors').check();
    for(const [key,value] of Object.entries({paper:'#17202b',surface:'#29394b',orange:'#f3a46c'}))await page.locator(`#appearance-color-${key}`).fill(value);
    await setRange('opacity',70);await setRange('blur',28);await setRange('depth',90);await setRange('radius',22);
    expect(await page.locator('#appearance-depth-value').textContent()).toBe('90%');
    expect(await page.locator('#appearance-preview-status').textContent()).toBe('');
    await page.locator('#preferences-form button.primary-button').click();await page.locator('#settings-dialog').waitFor({state:'hidden'});
    const saved={palette:'graphite',motion:'system',opacity:70,blur:28,depth:90,radius:22,customColors:{paper:'#17202b',surface:'#29394b',orange:'#f3a46c'}};
    expect(app.runtime.state.appearance).toEqual(saved);
    await page.screenshot({path:join(artifacts,'workspace-custom-dark.png'),animations:'disabled'});
    await app.close();app=makeApp();await page.reload();await page.locator('#messages').waitFor();
    expect(app.runtime.state.appearance).toEqual(saved);expect(app.runtime.state.preferences).toBe('Keep my preferences');
    expect(await page.locator(':root').evaluate(node=>node.style.getPropertyValue('--ui-depth'))).toBe('90');
    for(const width of [320,768,1440]){
      await page.setViewportSize({width,height:1000});await openSettings();
      await page.locator('.appearance-custom').evaluate(node=>node.open=true);
      expect(await page.locator('#settings-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      await page.locator('#appearance-opacity').focus();expect(await page.locator('#appearance-opacity').evaluate(node=>node===document.activeElement)).toBe(true);
      await page.keyboard.press('ArrowRight');expect(await page.locator('#appearance-opacity').inputValue()).toBe('71');
      await page.locator('#appearance-opacity').scrollIntoViewIfNeeded();await page.screenshot({path:join(artifacts,`workspace-materials-${width}.png`),animations:'disabled'});
      await page.getByRole('button',{name:'Close settings',exact:true}).click();
    }
    await openSettings();await page.locator('#appearance-reset').click();
    expect(await page.locator('#appearance-custom-colors').isChecked()).toBe(false);expect(await page.locator('#appearance-depth').inputValue()).toBe('65');
    expect(app.runtime.state.appearance).toEqual(saved);await page.getByRole('button',{name:'Close settings',exact:true}).click();
    // An agent's palette override keeps its palette; workspace material settings still apply.
    app.runtime.state.customization={...defaults,name:'Oddy',overrideWorkspace:true,palette:'harbor'};app.runtime.changed();
    await page.waitForFunction(paper=>document.documentElement.style.getPropertyValue('--paper')===paper,palettes.harbor.vars.paper);
    expect(await page.locator(':root').evaluate(node=>node.style.getPropertyValue('--ui-depth'))).toBe('90');
    // Text and muted text remain readable on every built-in surface.
    const ratios=await page.evaluate(async()=>{
      const {palettes,appearanceVars}=await import('/profile.js');
      const luminance=color=>[1,3,5].map(start=>parseInt(color.slice(start,start+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      return Object.keys(palettes).flatMap(palette=>{const vars=appearanceVars({palette});return ['ink','muted'].flatMap(key=>['paper','surface','selected'].map(background=>{const a=luminance(vars[key]),b=luminance(vars[background]);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}));});
    });
    for(const ratio of ratios)expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect((await request('/api/appearance',saved)).status).toBe(200);
    expect(app.runtime.state.appearance).toEqual(saved);
    expect(appearanceVars(saved).scheme).toBe('dark');expect(errors).toEqual([]);
  }finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30_000);
