import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Browser } from '../browser.js';

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
    const button = browser.last.elements.find(el=>el.label==='Apply');
    expect((await browser.action({action:'click',ref:button.ref})).text).toContain('Odwyn works');
    await browser.action({action:'save_screenshot'}); expect(files[0].name).toBe('browser-screenshot.png');
    browser.owner = 'preview-job';
    const frame = await browser.frame();
    expect(frame.image.length).toBeGreaterThan(100);
    expect(frame.jobId).toBe('preview-job');
    await browser.page.setContent('<button onclick="confirm(\'Confirm this step?\')">Confirm</button>');
    await browser.action({action:'read'});
    expect((await browser.action({action:'click',ref:'0'})).text).toContain('Confirm this step?');
    await browser.action({action:'dialog',choice:'dismiss'});
    await expect(browser.action({action:'click',ref:'0'},()=>false)).rejects.toThrow('control');
    await expect(browser.action({action:'navigate',url:'http://127.0.0.1/'})).rejects.toThrow();
    await expect(browser.action({action:'navigate',url:'http://169.254.169.254/latest/meta-data/'})).rejects.toThrow();
    await browser.page.setContent('<form><input autocomplete="cc-number"><button>Continue</button></form>');
    const checkout=await browser.action({action:'read'});
    const ref=checkout.elements.find(el=>el.tag==='button').ref;
    const inspection=await browser.inspectAction({action:'click',ref});
    expect(inspection.hasPaymentFields).toBe(true);
    expect(inspection.element.label).toBe('Continue');
    await browser.page.locator('button').evaluate(el=>el.textContent='Pay now');
    expect((await browser.inspectAction({action:'click',ref})).element.label).toBe('Pay now');

  } finally { await browser.close(); rmSync(directory,{recursive:true}); }
},60_000);
