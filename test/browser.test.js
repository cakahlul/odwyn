import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Browser } from '../browser.js';

test('real browser references, form interactions, evidence, dialogs and network isolation', async () => {
  const directory = mkdtempSync(join(tmpdir(),'sidekick-browser-')); const files=[];
  const browser = new Browser({directory,onFile:file=>files.push(file)});
  try {
    await browser.serial(()=>browser.start());
    // Fixture injected by the test, never by an exposed browser tool.
    await browser.page.setContent('<label>Name<input id="name"></label><label>Secret<input type="password" value="do-not-leak"></label><button onclick="document.querySelector(\'h1\').textContent=document.querySelector(\'#name\').value">Apply</button><h1>Waiting</h1>');
    const page = await browser.action({action:'read'});
    expect(JSON.stringify(page)).not.toContain('do-not-leak');
    const input = page.elements.find(el=>el.label==='Name');
    await browser.action({action:'fill',ref:input.ref,text:'Sidekick works'});
    const button = browser.last.elements.find(el=>el.label==='Apply');
    expect((await browser.action({action:'click',ref:button.ref})).text).toContain('Sidekick works');
    await browser.action({action:'save_screenshot'}); expect(files[0].name).toBe('browser-screenshot.png');
    expect((await browser.frame()).image.length).toBeGreaterThan(100);
    await browser.page.setContent('<button onclick="confirm(\'Confirm this step?\')">Confirm</button>');
    await browser.action({action:'read'});
    expect((await browser.action({action:'click',ref:'0'})).text).toContain('Confirm this step?');
    await browser.action({action:'dialog',choice:'dismiss'});
    await expect(browser.action({action:'click',ref:'0'},()=>false)).rejects.toThrow('control');
    await expect(browser.action({action:'navigate',url:'http://127.0.0.1/'})).rejects.toThrow();
    await expect(browser.action({action:'navigate',url:'http://169.254.169.254/latest/meta-data/'})).rejects.toThrow();
  } finally { await browser.close(); rmSync(directory,{recursive:true}); }
},60_000);
