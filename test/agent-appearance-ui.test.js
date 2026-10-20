import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.js';
import {defaults,avatarPresets,validateProfile,avatarSvg} from '../public/profile.js';
import {newPageWithoutTutorials} from '../tests/browser-page.js';

test('agent looks preview, save, survive reload and cancel without changing identity',async()=>{
  for(const {label,...look} of Object.values(avatarPresets)) {
    expect(validateProfile({...defaults,...look})).toMatchObject(look);
    expect(avatarSvg(look)).toContain('radialGradient');
  }
  const directory=mkdtempSync(join(tmpdir(),'odwyn-agent-look-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex:Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}}),browser:{close:async()=>{}}});
  app.runtime.state.customization={...defaults,name:'Studio',specialization:'Compare sources'};app.runtime.state.globalProvider.configured=true;app.runtime.state.agents[0].provider.configured=true;app.runtime.changed();
  const browser=await chromium.launch(),page=await newPageWithoutTutorials(browser,{httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const artifacts=join(import.meta.dir,'../artifacts');mkdirSync(artifacts,{recursive:true});
  const open=async()=>{
    await page.locator('#agents-open').click();
    await page.locator('[data-manage-agent] summary').first().click();
    await page.locator('[data-agent-action=customize]').first().click();
    await page.locator('[data-custom-step="0"]').click();
  };
  try {
    await page.goto(server.url.href);await open();
    await page.locator('input[name=shape][value=orb]').check();
    const orbit=page.locator('#preview-mascot svg');
    expect(await orbit.locator('.avatar-orbit-back').count()).toBe(1);
    expect(await orbit.locator('.avatar-orbit-front').count()).toBe(1);
    expect(await orbit.evaluate(svg=>{
      const back=svg.querySelector('.avatar-orbit-back'),front=svg.querySelector('.avatar-orbit-front');
      const body=back.nextElementSibling;
      return body.querySelector('circle[r="42"]')!==null && !!(body.compareDocumentPosition(front)&Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    await page.locator('.profile-layout').evaluate(node=>node.scrollTop=0);
    await page.screenshot({path:join(artifacts,'agent-orbit-desktop.png'),animations:'disabled'});

    await page.locator('[data-avatar-preset=moss]').click();
    expect(await page.locator('#agent-name-input').inputValue()).toBe('Studio');
    expect(await page.locator('#agent-specialization').inputValue()).toBe('Compare sources');
    expect(await page.locator('[data-avatar-preset=moss]').getAttribute('aria-pressed')).toBe('true');
    expect(await page.locator('#preview-mascot svg').innerHTML()).toContain('#8ca77b');
    expect(await page.locator('[aria-label="Body hex color"]').inputValue()).toBe('#8ca77b');
    await page.locator('input[name=accessory][value=glasses]').check();
    expect(await page.locator('[data-avatar-preset=moss]').getAttribute('aria-pressed')).toBe('false');
    await page.locator('input[name=eyes][value=dots]').focus();await page.keyboard.press('ArrowRight');
    expect(await page.locator('input[name=eyes][value=happy]').isChecked()).toBe(true);
    await page.locator('#customize-save').click();await page.locator('#customize-dialog').waitFor({state:'hidden'});
    expect(app.runtime.state.customization).toMatchObject({name:'Studio',specialization:'Compare sources',shape:'bear',eyes:'happy',accessory:'glasses',bodyColor:'#8ca77b'});
    await page.reload();await open();
    expect(await page.locator('input[name=shape][value=bear]').isChecked()).toBe(true);
    expect(await page.locator('input[name=accessory][value=glasses]').isChecked()).toBe(true);
    await page.locator('.profile-layout').evaluate(node=>node.scrollTop=0);
    await page.screenshot({path:join(artifacts,'agent-appearance-desktop.png'),animations:'disabled'});
    for(const width of [320,390,768]) {
      await page.setViewportSize({width,height:844});
      expect(await page.locator('#customize-dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      await page.locator('[data-avatar-preset=tide]').click();
      expect(await page.locator('input[name=shape][value=pebble]').isChecked()).toBe(true);
      if(width===390) await page.screenshot({path:join(artifacts,'agent-appearance-mobile.png'),animations:'disabled'});
    }
    await page.locator('#customize-cancel').click();
    expect(app.runtime.state.customization.shape).toBe('bear');
    expect(errors).toEqual([]);
  } finally {await browser.close();await app.close();server.stop(true);rmSync(directory,{recursive:true,force:true});}
},30000);
