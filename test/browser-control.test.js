import {newPageWithoutTutorials} from '../tests/browser-page.js';
import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { defaults } from '../public/profile.js';

test('browser takeover explains queued work, Open browser preserves control, Hand back resumes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-browser-control-'));
  const codex = new EventEmitter();
  codex.stop = () => {};
  codex.request = async method => method === 'account/read' ? { account: { type: 'chatgpt' } }
    : method.startsWith('thread/') ? { thread: { id: 'thread-test' } } : { turn: { id: 'turn-test' } };
  let starts = 0, preview = null;
  const assistantBrowser = { context: null, frame: async () => preview, close: async () => {},
    serial: async fn => fn(), start: async () => { starts++; assistantBrowser.context = {}; } };
  let app;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => app.fetch(request) });
  app = createApp({ directory, user: 'owner', password: 'test-password-long-enough', origin: server.url.origin, codex, browser: assistantBrowser });
  const browser = await chromium.launch();
  try {
    app.runtime.state.customization = defaults;
    app.runtime.state.provider.configured = app.runtime.state.globalProvider.configured = true;
    await app.runtime.refreshAccount();
    await app.runtime.setTakeover(true);
    const job = app.runtime.submit({ prompt: 'Open Bitbucket', interactionMode: 'allow' });
    const page = await newPageWithoutTutorials(browser,{ httpCredentials: { username: 'owner', password: 'test-password-long-enough' } });
    page.setDefaultTimeout(5000);
    await page.goto(server.url.href);
    await page.locator('#browser-takeover-dialog[open]').waitFor();
    const opened=page.waitForResponse(response=>response.url().endsWith('/api/browser/takeover'));
    await page.locator('#open-browser').click();expect((await opened).ok()).toBe(true);
    expect(starts).toBe(1);
    await page.locator('#browser-takeover-minimize').click();
    await page.locator(`[data-conversation="${job.conversationId}"]`).first().click();
    await page.locator('.working-row small').filter({hasText:'Paused while you control the browser'}).waitFor();
    expect(job.status).toBe('queued');expect(app.runtime.takeover).toBe(true);
    await page.locator('#browser-toggle').click();await page.locator('#browser-takeover-dialog[open]').waitFor();
    expect(await page.locator('#browser-takeover-dialog #takeover-button').count()).toBe(1);
    const bounds=await page.locator('#browser-takeover-dialog').boundingBox(),size=page.viewportSize();
    expect(bounds.width).toBeGreaterThan(size.width*.8);expect(Math.abs(bounds.x+bounds.width/2-size.width/2)).toBeLessThan(2);
    await page.keyboard.press('Escape');await page.locator('#browser-takeover-dialog').waitFor({state:'hidden'});expect(app.runtime.takeover).toBe(true);
    await page.locator('#browser-toggle').click();await page.locator('#browser-takeover-dialog[open]').waitFor();
    await page.locator('#takeover-button').click();
    await page.locator('.working-row small').filter({ hasText: 'Opening your Codex conversation' }).waitFor();
    expect(app.runtime.takeover).toBe(false);
    expect(job.status).toBe('running');
    expect(job.turnId).toBe('turn-test');
    job.browserUsed = true;
    preview = {jobId:job.id,url:'about:blank',loading:true,image:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=',tabs:[]};
    app.runtime.changed();
    await page.locator('#conversation-browser-status').filter({hasText:'Waiting for the popup website to open'}).waitFor();
    expect(await page.locator('#conversation-browser-image').evaluate(image=>image.hidden)).toBe(true);
    preview = {...preview,loading:false,url:'https://login.example.test/'};
    await page.waitForFunction(() => !document.querySelector('#conversation-browser-image').hidden);
    expect(await page.locator('#conversation-browser-status').evaluate(status=>status.hidden)).toBe(true);
  } finally {
    await browser.close(); server.stop(true); await app.close(); rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);
