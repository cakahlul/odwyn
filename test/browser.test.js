import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserActionRisk } from '../security.js';
import { Browser } from '../browser.js';

test('login popups wait for delayed navigation, return to their opener, and preserve background selection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-browser-popup-'));
  const browser = new Browser({directory});
  try {
    await browser.action({action:'read'});
    const unrelated = browser.page;
    await unrelated.setContent('<h1>Unrelated tab</h1>');
    const title = unrelated.title.bind(unrelated);
    let backgroundTitleReads = 0;
    unrelated.title = () => { backgroundTitleReads++; return new Promise(() => {}); };
    const opener = await browser.context.newPage();
    await browser.context.route('https://login.example.test/**', route => route.fulfill({contentType:'text/html',body:'<title>Sign in</title><h1>Login ready</h1><button onclick="window.close()">Finish login</button>'}));
    await opener.setContent(`<h1>Report</h1><button onclick="const login=window.open('about:blank','login');setTimeout(()=>login.location='https://login.example.test/',150)">Login</button>`);
    await browser.action({action:'read'});
    const opened = opener.waitForEvent('popup');
    const result = await browser.action({action:'click',ref:'0'});
    const popup = await opened;
    expect(result.url).toBe('https://login.example.test/');
    expect(result.text).toContain('Login ready');
    expect(backgroundTitleReads).toBe(0);
    unrelated.title = title;
    expect(browser.page).toBe(popup);
    const closed = await browser.action({action:'click',ref:result.elements.find(el=>el.tag==='button').ref});
    expect(browser.page).toBe(opener);
    expect(closed.text).toContain('Report');
    expect(unrelated.isClosed()).toBe(false);

    const backgroundOpened = opener.waitForEvent('popup');
    await opener.evaluate(() => window.open('about:blank', 'background'));
    const background = await backgroundOpened;
    await browser.action({action:'tab',index:0});
    await background.close();
    expect(browser.page).toBe(unrelated);
  } finally { await browser.close(); rmSync(directory,{recursive:true,force:true}); }
}, 15_000);

test('blank popups report pending navigation instead of returning empty results', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-browser-blank-popup-'));
  const browser = new Browser({directory});
  try {
    await browser.action({action:'read'});
    await browser.page.setContent(`<button onclick="window.open('about:blank','login')">Login</button>`);
    await browser.action({action:'read'});
    const snapshot = await browser.action({action:'click',ref:'0'});
    expect(snapshot.loading).toBe(true);
    expect(snapshot.text).toContain('Popup is waiting');
    expect((await browser.frame()).loading).toBe(true);
    const closed = await browser.action({action:'close_tab'});
    expect(closed.text).toContain('Login');
  } finally { await browser.close(); rmSync(directory,{recursive:true,force:true}); }
}, 15_000);

test('stalled page reads time out or stop, close the context, and release queued work', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-browser-stall-'));
  const browser = new Browser({directory});
  try {
    for (const stop of [false, true]) {
      await browser.action({action:'read'});
      const context = browser.context, page = browser.page;
      let started;
      const ready = new Promise(resolve => { started = resolve; });
      const evaluate = page.evaluate.bind(page);
      page.evaluate = () => { started(); return evaluate(() => new Promise(() => {})); };
      const read = browser.serial(() => browser.snapshot(), stop ? 5000 : 100);
      const outcome = read.catch(error => error);
      await ready;
      const next = browser.action({action:'read'});
      if (stop) await browser.interrupt();
      expect((await outcome).message).toContain(stop ? 'interrupted' : 'timed out');
      expect(page.isClosed()).toBe(true);
      expect((await next).url).toBe('about:blank');
      expect(browser.context).not.toBe(context);
    }
  } finally { await browser.close(); rmSync(directory, {recursive:true, force:true}); }
}, 15_000);

test('interrupted startup cannot execute a late browser action', async () => {
  const browser = new Browser({directory:tmpdir()});
  let release, entered, reads = 0;
  const ready = new Promise(resolve => { entered = resolve; });
  browser.start = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  browser.page = {isClosed:()=>false};
  browser.snapshot = async () => { reads++; return {}; };
  const action = browser.action({action:'read'});
  const outcome = action.catch(error => error);
  await ready;
  await browser.interrupt();
  expect((await outcome).message).toContain('interrupted');
  release();
  await Bun.sleep(0);
  expect(reads).toBe(0);
  await browser.close();
});

test('browser reset closes all tabs and proxy, clears snapshots, and reopens with saved sign-ins', async () => {
  const directory = mkdtempSync(join(tmpdir(),'odwyn-browser-reset-'));
  const browser = new Browser({directory});
  try {
    await browser.action({action:'read'});
    const context = browser.context, proxy = browser.proxy;
    await context.addCookies([{name:'session',value:'saved',domain:'example.com',path:'/',expires:Math.floor(Date.now()/1000)+3600}]);
    const extra = await context.newPage(), pages = context.pages();
    await extra.setContent('<button onclick="alert(\'Pending\')">Open</button>');
    await browser.action({action:'read'});
    await browser.action({action:'click',ref:'0'});
    const reset = browser.reset(), read = browser.action({action:'read'});
    await reset;
    expect(pages.every(page=>page.isClosed())).toBe(true);
    expect(browser.last).toBeNull();
    expect(browser.dialog).toBeNull();
    const snapshot = await read;
    expect(browser.context).not.toBe(context);
    expect(browser.proxy).not.toBe(proxy);
    expect(snapshot.tabs).toHaveLength(1);
    expect(snapshot.url).toBe('about:blank');
    expect((await browser.context.cookies('https://example.com')).find(cookie=>cookie.name==='session')?.value).toBe('saved');
    await browser.reset();
    await browser.reset();
    expect(await browser.frame()).toBeNull();
    expect(browser.context).toBeNull();
    expect(browser.proxy).toBeNull();
  } finally { await browser.close(); rmSync(directory,{recursive:true,force:true}); }
},30_000);

test('real browser references, form interactions, evidence, dialogs and network isolation', async () => {
  const directory = mkdtempSync(join(tmpdir(),'odwyn-browser-')); const files=[];
  const browser = new Browser({directory,onFile:file=>files.push(file)});
  try {
    await browser.serial(()=>browser.start());
    // Fixture injected by the test, never by an exposed browser tool.
    await browser.page.route('https://images.test/**', route => route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')}));
    await browser.page.setContent('<label>Name<input id="name"></label><label>Secret<input type="password" value="do-not-leak"></label><button onclick="document.querySelector(\'h1\').textContent=document.querySelector(\'#name\').value">Apply</button><h1>Waiting</h1>');
    const page = await browser.action({action:'read'});
    expect(JSON.stringify(page)).not.toContain('do-not-leak');
    await browser.page.evaluate(() => {
      const image = document.createElement('img'); image.src='https://images.test/product.png'; image.alt='Desk photo'; document.body.append(image);
      const meta = document.createElement('meta'); meta.setAttribute('property','og:image'); meta.content='https://images.test/banner.png'; document.head.append(meta);
    });
    const sources = (await browser.action({action:'read'})).images;
    expect(sources.some(image=>image.url==='https://images.test/product.png' && image.alt==='Desk photo')).toBe(true);
    expect(sources.some(image=>image.url==='https://images.test/banner.png')).toBe(true);
    const input = page.elements.find(el=>el.label==='Name');
    await browser.action({action:'fill',ref:input.ref,text:'Odwyn works'});
    await browser.page.locator('#name').focus();
    for (const action of ['press','type']) {
      const inspection=await browser.inspectAction({action,text:'Enter'});
      expect(inspection.element?.label).toBe('Name');
      expect(browserActionRisk({action,text:'Enter'},inspection)).toBe('interaction');
    }
    expect((await browser.inspectAction({action:'press',ref:'999',text:'Enter'})).element).toBe(null);
    expect((await browser.inspectAction({action:'click',x:1279,y:799})).element).toBe(null);
    await browser.page.locator('input[type=password]').focus();
    expect(browserActionRisk({action:'press',text:'Enter'},await browser.inspectAction({action:'press',text:'Enter'}))).toBe('credential');
    await browser.action({action:'type',ref:input.ref,text:'!'});
    expect(await browser.page.locator('#name').inputValue()).toBe('Odwyn works!');
    expect(await browser.page.locator('input[type=password]').inputValue()).toBe('do-not-leak');
    const button = browser.last.elements.find(el=>el.label==='Apply');
    const box=await browser.page.locator('button').boundingBox();
    const coordinateClick={action:'click',x:box.x+box.width/2,y:box.y+box.height/2};
    const coordinateTarget=await browser.inspectAction(coordinateClick);
    expect(coordinateTarget.element?.label).toBe('Apply');
    expect(browserActionRisk(coordinateClick,coordinateTarget)).toBe('interaction');
    expect((await browser.action({action:'click',ref:button.ref})).text).toContain('Odwyn works');
    await browser.action({action:'save_screenshot'}); expect(files[0].name).toBe('browser-screenshot.png');
    browser.owner = 'preview-job';
    const frame = await browser.frame();
    expect(frame.image.length).toBeGreaterThan(100);
    expect(frame.jobId).toBe('preview-job');
    await browser.page.setContent('<button onclick="confirm(\'Confirm this step?\')">Confirm</button>');
    await browser.action({action:'read'});
    expect((await browser.action({action:'click',ref:'0'})).text).toContain('Confirm this step?');
    const dialogInspection=await browser.inspectAction({action:'dialog',choice:'accept'});
    expect(dialogInspection.dialog).toEqual({type:'confirm',message:'Confirm this step?'});
    expect(browserActionRisk({action:'dialog',choice:'accept'},dialogInspection)).toBe('interaction');
    await browser.action({action:'dialog',choice:'accept'});
    await expect(browser.action({action:'click',ref:'0'},()=>false)).rejects.toThrow('control');
    await expect(browser.action({action:'navigate',url:'http://127.0.0.1/'})).rejects.toThrow();
    await expect(browser.action({action:'navigate',url:'http://169.254.169.254/latest/meta-data/'})).rejects.toThrow();
    await browser.page.setContent('<iframe srcdoc="<button>Pay now</button>" style="width:200px;height:100px"></iframe>');
    expect((await browser.inspectAction({action:'click',x:20,y:20})).element).toBe(null);
    await browser.page.setContent('<div id="shadow-host" style="width:200px;height:100px"></div>');
    await browser.page.locator('#shadow-host').evaluate(el=>{el.attachShadow({mode:'open'}).innerHTML='<button>Pay now</button>';});
    expect((await browser.inspectAction({action:'click',x:20,y:20})).element).toBe(null);
    await browser.page.setContent('<input autocomplete="cc-number" style="display:none"><button>Search</button>');
    await browser.action({action:'read'});
    expect((await browser.inspectAction({action:'click',ref:'0'})).hasPaymentFields).toBe(false);
    await browser.page.locator('button').evaluate(el=>{el.textContent='';el.title='Pay now';});
    const titledButton=await browser.inspectAction({action:'click',ref:'0'});
    expect(titledButton.element.label).toBe('Pay now');
    expect(browserActionRisk({action:'click',ref:'0'},titledButton)).toBe('payment');
    await browser.page.setContent('<form><input autocomplete="cc-number"><button>Continue</button></form>');
    const checkout=await browser.action({action:'read'});
    const ref=checkout.elements.find(el=>el.tag==='button').ref;
    const inspection=await browser.inspectAction({action:'click',ref});
    expect(inspection.hasPaymentFields).toBe(true);
    await browser.page.locator('input').focus();
    expect(browserActionRisk({action:'press',text:'Enter'},await browser.inspectAction({action:'press',text:'Enter'}))).toBe('payment');
    expect(inspection.element.label).toBe('Continue');
    await browser.page.locator('button').evaluate(el=>el.textContent='Pay now');
    expect((await browser.inspectAction({action:'click',ref})).element.label).toBe('Pay now');
    const paymentBox=await browser.page.locator('button').boundingBox();
    const paymentClick={action:'click',x:paymentBox.x+paymentBox.width/2,y:paymentBox.y+paymentBox.height/2};
    expect((await browser.inspectAction(paymentClick)).element?.label).toBe('Pay now');
    expect(browserActionRisk(paymentClick,await browser.inspectAction(paymentClick))).toBe('payment');

  } finally { await browser.close(); rmSync(directory,{recursive:true}); }
},60_000);
