import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { Codex } from '../codex.js';

const directory = mkdtempSync(join(tmpdir(),'sidekick-ui-'));
const root = resolve(import.meta.dir,'..'); const artifacts = join(root,'artifacts'); mkdirSync(artifacts,{recursive:true});
const password = randomBytes(20).toString('hex');
let app;
const server = Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
app = createApp({directory,user:'check',password,origin:server.url.origin,codex:new Codex({home:join(directory,'codex'),workspace:join(directory,'workspace')})});
const browser = await chromium.launch();
const context = await browser.newContext({httpCredentials:{username:'check',password},viewport:{width:1440,height:960}});
const page = await context.newPage(); const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const audit = async label => {
  if (!process.env.SIDEKICK_AXE_PATH) return;
  const {default:AxeBuilder} = await import(process.env.SIDEKICK_AXE_PATH);
  const result = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  assert.deepEqual(result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[],`${label} accessibility`);
};
try {
  await page.goto(server.url.href); await page.getByRole('heading',{name:'What can I take off your plate?'}).waitFor();
  assert.equal(await page.locator('#browser-toggle').getAttribute('aria-expanded'),'false');
  const composer = await page.locator('#composer').boundingBox();
  const suggestions = await page.locator('.suggestions').boundingBox();
  assert.ok(composer.width > 900 && composer.y < 480 && composer.y + composer.height < suggestions.y,'Chat is wide and above suggestions');
  assert.equal(await page.locator('#prompt').evaluate(node=>getComputedStyle(node).fontSize),'16px');
  await page.screenshot({path:join(artifacts,'desktop.png'),fullPage:true});
  await audit('Welcome');
  await page.getByRole('button',{name:'Go down a rabbit hole'}).click();
  assert.match(await page.locator('#prompt').inputValue(),/Research/);
  await page.locator('#prompt').fill('Read https://example.com and tell me what it says.'); await page.locator('#prompt').press('Enter');
  await page.getByText('Connect Codex in Settings to begin.').waitFor();
  await page.screenshot({path:join(artifacts,'conversation.png'),fullPage:true});
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.getByRole('button',{name:'Task runs'}).click(); await page.getByText('Stopped',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Routines',exact:true}).click(); await page.getByRole('button',{name:'New routine'}).click();
  await page.locator('#schedule-prompt').fill('Check my KPI dashboard each morning.'); await page.getByRole('button',{name:'Set routine'}).click();
  await page.getByRole('heading',{name:'Check my KPI dashboard each morning.'}).waitFor();
  await page.getByRole('button',{name:'Pause routine'}).click(); await page.getByText('Paused',{exact:true}).waitFor();
  await page.locator('#file-input').setInputFiles({name:'brief.txt',mimeType:'text/plain',buffer:Buffer.from('Browser assistant brief')});
  await page.getByRole('button',{name:'Files & results'}).click(); await page.getByRole('link',{name:/brief\.txt/}).waitFor();
  await page.locator('#settings-open').click(); await page.locator('#preferences').fill('Based in Jakarta. Prefer morning flights.'); await page.getByRole('button',{name:'Save memory'}).click();
  await page.getByText('Remembered. Applies to your next run.').waitFor(); await audit('Settings');
  await page.getByRole('button',{name:'Close settings'}).click(); await page.locator('#new-chat').click();
  await page.getByRole('button',{name:'Toggle browser panel'}).click();
  await page.getByRole('button',{name:'Open browser',exact:true}).click();
  await page.locator('#browser-image').waitFor(); await page.locator('#navigate-url').fill('https://example.com'); await page.locator('#browser-navigate').evaluate(form=>form.requestSubmit());
  await page.locator('#browser-url').filter({hasText:'https://example.com'}).waitFor({timeout:45_000});
  await page.getByRole('button',{name:'Hand back'}).click();
  await page.screenshot({path:join(artifacts,'browser.png'),fullPage:true});
  for (const width of [320,768,1024,1440]) {
    await page.setViewportSize({width,height:900}); await page.reload(); await page.getByRole('heading',{name:'What can I take off your plate?'}).waitFor();
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No horizontal overflow at ${width}`);
    if (width === 320) {
      assert.equal(await page.locator('.sidebar').evaluate(node=>node.inert),true);
      assert.equal(await page.locator('#prompt').evaluate(node=>getComputedStyle(node).fontSize),'16px');
      await page.screenshot({path:join(artifacts,'mobile.png'),fullPage:true});
      await audit('Mobile welcome');
      await page.getByRole('button',{name:'Open navigation'}).click(); await page.getByRole('button',{name:'Routines',exact:true}).click();
      await page.getByRole('heading',{name:'Ahead of the day.'}).waitFor();
      await audit('Mobile routines');
      await page.getByRole('button',{name:'Open navigation'}).click(); await page.locator('#new-chat').click();
    }
  }
  await page.keyboard.press('Control+k'); await page.locator('#search-input').fill('example.com'); await page.locator('#search-results').getByRole('button',{name:/Read https:\/\/example.com/}).click();
  await page.locator('#messages').getByText('Read https://example.com and tell me what it says.',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: chat, task stop, search, memory, schedules, uploads, real browser takeover, 320/768/1024/1440 layouts, no console errors' + (process.env.SIDEKICK_AXE_PATH ? ', WCAG accessibility checks.' : '.'));
  console.log(`Screenshots: ${artifacts}`);
} finally { await browser.close(); server.stop(true); await app.close(); rmSync(directory,{recursive:true,force:true}); }
