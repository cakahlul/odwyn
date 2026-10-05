import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { Codex } from '../codex.js';
import { palettes, defaults } from '../public/profile.js';

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
  await page.goto(server.url.href); await page.getByRole('heading',{name:/^Message /,level:1}).waitFor();
  await page.locator('#customize-dialog[open]').waitFor();
  await page.screenshot({path:join(artifacts,'customize-look.png'),fullPage:true});
  for (const [key,palette] of Object.entries(palettes)) {
    await page.locator(`input[name=palette][value=${key}]`).check();
    assert.equal(await page.locator('#profile-preview').evaluate(node=>node.style.getPropertyValue('--paper')),palette.vars.paper,'Palette updates the preview');
    assert.equal(await page.locator('.preview-brand .mark-body').evaluate(node=>getComputedStyle(node).fill),await page.locator('.preview-brand .brand-dot').evaluate(node=>getComputedStyle(node).color),'Sidekick preview logo follows its palette accent');
    assert.equal(await page.locator('.preview-brand .mark-face').evaluate(node=>getComputedStyle(node).fill),await page.locator('.preview-app').evaluate(node=>getComputedStyle(node).backgroundColor),'Sidekick preview face follows its palette surface');
    assert.equal(await page.locator(':root').evaluate(node=>node.style.getPropertyValue('--paper')),palettes.paper.vars.paper,'Unsaved palette does not change the app');
    await audit(`${key} preview`);
  }
  await page.locator('#customize-next').click();
  await page.locator('input[name=shape][value=cat]').check();
  for (const [name,value] of Object.entries({bodyColor:'#a6bd8e',eyeColor:'#26333f',mouthColor:'#8c3545'})) await page.locator(`input[name=${name}]`).fill(value);
  await page.locator('select[name=eyes]').selectOption('wink');
  await page.locator('select[name=mouth]').selectOption('grin');
  await page.locator('select[name=accessory]').selectOption('spark');
  await page.locator('#agent-name-input').fill('Pip');
  await page.locator('#agent-specialization').fill('Travel planning & research');
  assert.equal(await page.locator('#preview-brand-name').textContent(),'Pip');
  assert.equal(await page.locator('#preview-mascot svg g').first().getAttribute('fill'),'#a6bd8e');
  await page.screenshot({path:join(artifacts,'customize-agent.png'),fullPage:true});
  await audit('Avatar editor');
  await page.locator('#agent-name-input').press('Enter');
  assert.equal(await page.locator('[data-profile-step="2"]').isVisible(),true,'Enter advances the wizard before saving');
  await page.locator('#owner-name-input').fill('Alex');
  await page.locator('input[name=tone][value=crisp]').check();
  assert.match(await page.locator('#preview-reply').textContent(),/Alex.*top three/s);
  await audit('Communication editor');
  await page.locator('#customize-save').click();
  await page.locator('#customize-dialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('#agent-name').textContent(),'Pip');
  assert.equal(await page.locator('.brand-word').textContent(),'sidekick.','Product branding remains after naming the agent');
  assert.equal(await page.locator('.brand .product-mark').count(),1,'Product logo stays distinct from the agent avatar');
  assert.equal(await page.title(),'Sidekick · Pip','Browser title includes product and agent');
  assert.equal(await page.locator('#owner-name').textContent(),'Alex');
  assert.equal(app.runtime.state.customization.name,'Pip');
  assert.equal(app.runtime.state.customization.specialization,'Travel planning & research');
  assert.equal(app.runtime.state.customization.tone,'crisp');
  assert.match(await page.locator('link[rel=icon]').getAttribute('href'),/^data:image\/svg\+xml/);
  await page.reload(); await page.locator('#agent-name').filter({hasText:'Pip'}).waitFor();
  assert.equal(await page.locator('#customize-dialog').evaluate(node=>node.open),false,'Saved profile skips onboarding');
  await page.locator('#settings-open').click(); await page.locator('#customize-open').click();
  await page.locator('[data-custom-step="1"]').click();
  assert.equal(await page.locator('#agent-name-input').inputValue(),'Pip','Settings restores saved choices');
  assert.equal(await page.locator('input[name=shape][value=cat]').isChecked(),true);
  await page.locator('#agent-name-input').fill(''); await page.locator('[data-custom-step="2"]').click(); await page.locator('#customize-save').click();
  assert.equal(await page.locator('[data-profile-step="1"]').isVisible(),true,'Invalid name returns to the right step');
  await page.locator('#agent-name-input').fill('Momo'); await page.locator('[data-custom-step="0"]').click();
  await page.locator('input[name=palette][value=fern]').check();
  await page.locator('#customize-close').click();
  assert.equal(await page.locator('#agent-name').textContent(),'Pip','Cancel keeps saved identity');
  await page.locator('#settings-open').click(); await page.locator('#customize-open').click();
  await page.setViewportSize({width:320,height:700});
  await page.screenshot({path:join(artifacts,'customize-mobile.png'),fullPage:true});
  await page.locator('#customize-preview').click();
  await page.waitForFunction(()=>document.querySelector('#profile-preview').getBoundingClientRect().top<=document.querySelector('.profile-layout').getBoundingClientRect().top+2);
  assert.ok(await page.locator('.preview-brand').evaluate(node=>node.getBoundingClientRect().top<400),'Mobile preview is reachable');
  await page.screenshot({path:join(artifacts,'customize-mobile-preview.png'),fullPage:true});
  await page.locator('#customize-preview').click();
  await page.waitForFunction(()=>document.querySelector('.profile-layout').scrollTop<2);
  for (const step of [0,1,2]) {
    await page.locator(`[data-custom-step="${step}"]`).click();
    assert.equal(await page.locator('#customize-dialog').evaluate(node=>node.scrollWidth>node.clientWidth),false,'Mobile wizard fits its dialog');
    const action = await page.locator(step === 2 ? '#customize-save' : '#customize-next').boundingBox();
    assert.ok(action.y+action.height<=700,'Mobile wizard keeps its action visible');
    await audit(`Mobile wizard step ${step}`);
  }
  await page.locator('#customize-close').click(); await page.setViewportSize({width:1440,height:960});
  for (const key of Object.keys(palettes)) {
    await page.locator('#settings-open').click(); await page.locator('#customize-open').click();
    await page.locator(`input[name=palette][value=${key}]`).check();
    await page.locator('[data-custom-step="2"]').click(); await page.locator('#customize-save').click();
    await page.locator('#customize-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator(':root').evaluate(node=>node.style.getPropertyValue('--paper')),palettes[key].vars.paper);
    assert.equal(await page.locator('.brand .mark-body').evaluate(node=>getComputedStyle(node).fill),await page.locator('.brand-dot').first().evaluate(node=>getComputedStyle(node).color),'Saved palette colors the Sidekick logo');
    await audit(`${key} workspace`);
  }
  assert.equal(await page.locator('#browser-toggle').getAttribute('aria-expanded'),'false');
  const composer = await page.locator('#composer').boundingBox();
  const suggestions = await page.locator('.suggestions').boundingBox();
  assert.ok(composer.width > 900 && composer.y < 480 && composer.y + composer.height < suggestions.y,'Chat is wide and above suggestions');
  assert.equal(await page.locator('.welcome em,.scribble,.little-note').count(),0,'Welcome has no decorative type or slogans');
  assert.equal(await page.locator('.routine-summary').isVisible(),false,'No schedule teaser without an actual routine');
  assert.equal(await page.locator('.owner-avatar').evaluate(node=>getComputedStyle(node).backgroundColor),await page.locator('.nav-item.active').evaluate(node=>getComputedStyle(node).backgroundColor),'Owner avatar follows the selected palette');
  const mascotStage = page.getByRole('button',{name:'Animate agent avatar'});
  assert.ok((await mascotStage.boundingBox()).width>=170,'Desktop gives the mascot more room');
  const transform = await page.locator('.mascot').evaluate(node=>getComputedStyle(node).transform);
  await page.waitForFunction(before=>getComputedStyle(document.querySelector('.mascot')).transform!==before,transform);
  await mascotStage.hover();
  assert.equal(await page.locator('.mascot').evaluate(node=>getComputedStyle(node).animationName),'mascot-greeting','Hover changes the mascot reaction');
  await mascotStage.focus(); await page.keyboard.press('Space');
  assert.equal(await mascotStage.getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('.mascot').evaluate(node=>getComputedStyle(node).animationPlayState),'paused','Keyboard can pause the animation');
  await page.keyboard.press('Space');
  assert.equal(await mascotStage.getAttribute('aria-pressed'),'true');
  await page.mouse.move(400,800);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.mascot').evaluate(node=>getComputedStyle(node).animationName),'none','Reduced motion keeps the mascot still');
  assert.equal(await page.locator('.mascot-spark').first().evaluate(node=>getComputedStyle(node).animationName),'none','Reduced motion disables sparkles');
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.equal(await page.locator('#prompt').evaluate(node=>getComputedStyle(node).fontSize),'16px');
  await page.screenshot({path:join(artifacts,'desktop.png'),fullPage:true});
  await audit('Welcome');
  await page.getByRole('button',{name:'Research a topic'}).click();
  assert.match(await page.locator('#prompt').inputValue(),/Research/);
  await page.locator('#prompt').fill('Read https://example.com and tell me what it says.'); await page.locator('#prompt').press('Enter');
  await page.getByText('Connect Codex in Settings to begin.').waitFor();
  await page.screenshot({path:join(artifacts,'conversation.png'),fullPage:true});
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  const conversation = app.runtime.state.conversations[0];
  conversation.messages.push({id:'scroll-check',role:'assistant',text:Array.from({length:80},(_,i)=>`History line ${i+1}`).join('\n'),at:new Date().toISOString()});
  app.runtime.changed();
  await page.locator('#messages').getByText(/History line 80/).waitFor();
  for (const width of [1440,320]) {
    await page.setViewportSize({width,height:900});
    assert.equal((await page.locator('.topbar').boundingBox()).y,0,'Long chat keeps the header visible');
    assert.ok(await page.locator('#view').evaluate(node=>node.clientHeight>innerHeight*.72),'Conversation gets most of the screen');
    assert.ok(await page.locator('#view').evaluate(node=>node.scrollHeight>node.clientHeight),'Long chat has its own scrollbar');
    const composerBox = await page.locator('#composer').boundingBox();
    assert.ok(composerBox.y+composerBox.height <= 900,'Composer stays visible');
    await page.locator('#view').evaluate(node=>node.scrollTo({top:node.scrollHeight,behavior:'instant'}));
    const bottom = await page.locator('#view').evaluate(node=>node.scrollTop);
    await page.locator('#view').hover(); await page.mouse.wheel(0,-500);
    await page.waitForFunction(bottom=>document.querySelector('#view').scrollTop < bottom-100,bottom);
  }
  const readingPosition = await page.locator('#view').evaluate(node=>node.scrollTop);
  conversation.messages.push({id:'scroll-update',role:'assistant',text:'New reply while reading earlier messages.',at:new Date().toISOString()});
  app.runtime.changed();
  await page.getByText('New reply while reading earlier messages.',{exact:true}).waitFor();
  assert.ok(Math.abs(await page.locator('#view').evaluate(node=>node.scrollTop)-readingPosition)<2,'New replies preserve the reading position');
  await page.setViewportSize({width:1440,height:960});
  const answer = `## Your weekend shortlist

Three places near **Summarecon Mall Serpong**, each with a different reason to go.

| Hotel | Best for | Why choose it |
| --- | --- | --- |
| [Atria Hotel Gading Serpong](https://www.parador-hotels.com/atria-hotel-gading-serpong) | Mall visits & an easy weekend | Pool, gym and a relaxed base near the mall. |
| [Episode Gading Serpong](https://episodegadingserpong.jhlcollections.com/) | A family staycation | Distinctive rooms and a [staycation package](https://episodegadingserpong.jhlcollections.com/offers/). |
| [JHL Solitaire](https://jhlsolitairegadingserpong.jhlcollections.com/) | A little splurge | Larger rooms, spa experiences and time by the pool. |

### Before you book

- Confirm the final weekend rate.
- Check breakfast and cancellation terms.

> My pick: Atria for convenience; Episode for family time.

Use \`confirm\` mode for booking.

\`\`\`js
const budget = 2000000;
\`\`\``;
  conversation.messages = [{id:'formatted-answer',role:'assistant',text:answer,at:new Date().toISOString()}];
  app.runtime.changed();
  await page.getByRole('heading',{name:'Your weekend shortlist'}).waitFor();
  const rendered = page.locator('.message-text');
  assert.equal(await rendered.locator('tbody tr').count(),3);
  assert.equal(await rendered.getByRole('link',{name:'Atria Hotel Gading Serpong'}).getAttribute('href'),'https://www.parador-hotels.com/atria-hotel-gading-serpong');
  assert.equal(await rendered.locator('ul li').count(),2);
  assert.match(await rendered.locator('pre code').textContent(),/const budget = 2000000/);
  assert.ok(await page.evaluate(async()=>{
    const {richText} = await import('/ui.js');
    const node = richText('<img src=x onerror="alert(1)">\n\n[Unsafe](javascript:alert(1))\n\n![Remote image](https://example.com/tracking.png)\n\n[Encoded](&#106;avascript:alert(1))\n\n<svg onload="alert(1)"></svg>');
    return !node.querySelector('img,script,iframe,svg,[onerror],[onload],a[href^="javascript:"]');
  }),'Markdown cannot inject HTML, unsafe links or remote images');
  await page.locator('#view').evaluate(node=>node.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:join(artifacts,'answer.png'),fullPage:true});
  await audit('Formatted answer');
  await page.setViewportSize({width:320,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Table stays inside the mobile conversation');
  await page.locator('.table-scroll').focus(); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>document.querySelector('.table-scroll').scrollLeft>0);
  await page.screenshot({path:join(artifacts,'answer-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:960});
  conversation.messages.unshift({id:'original-prompt',role:'user',text:'Read https://example.com and tell me what it says.',at:new Date().toISOString()});
  app.runtime.changed();
  await page.getByRole('button',{name:'Task runs'}).click(); await page.getByText('Stopped',{exact:true}).first().waitFor();
  await page.getByRole('button',{name:'Routines',exact:true}).click(); await page.getByRole('button',{name:'New routine'}).click();
  await page.locator('#schedule-prompt').fill('Check my KPI dashboard each morning.'); await page.getByRole('button',{name:'Set routine'}).click();
  await page.getByRole('heading',{name:'Check my KPI dashboard each morning.'}).waitFor();
  assert.equal(await page.locator('#routine-note').textContent(),'Check my KPI dashboard each morning.');
  assert.equal(await page.locator('.routine-summary').isVisible(),true,'Actual upcoming routine appears in sidebar');
  await page.getByRole('button',{name:'Pause routine'}).click(); await page.getByText('Paused',{exact:true}).waitFor();
  assert.equal(await page.locator('.routine-summary').isVisible(),false,'Paused routine removes upcoming summary');
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
    await page.setViewportSize({width,height:900}); await page.reload(); await page.getByRole('heading',{name:/^Message /,level:1}).waitFor();
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No horizontal overflow at ${width}`);
    if (width === 320) {
      assert.equal(await page.locator('.sidebar').evaluate(node=>node.inert),true);
      assert.equal(await page.locator('#prompt').evaluate(node=>getComputedStyle(node).fontSize),'16px');
      await page.screenshot({path:join(artifacts,'mobile.png'),fullPage:true});
      await audit('Mobile welcome');
      await page.getByRole('button',{name:'Open navigation'}).click(); await page.getByRole('button',{name:'Routines',exact:true}).click();
      await page.getByRole('heading',{name:'Routines',exact:true}).waitFor();
      await audit('Mobile routines');
      await page.getByRole('button',{name:'Open navigation'}).click(); await page.locator('#new-chat').click();
    }
  }
  await page.keyboard.press('Control+k'); await page.locator('#search-input').fill('example.com'); await page.locator('#search-results').getByRole('button',{name:/Read https:\/\/example.com/}).click();
  await page.locator('#messages').getByText('Read https://example.com and tell me what it says.',{exact:true}).waitFor();
  const now = Date.now(), at = seconds => new Date(now+seconds*1000).toISOString();
  const recentFixture = [
    {id:'hotel',title:'Hotel shortlist',createdAt:at(-5000),messages:[{id:'hotel-message',role:'user',text:'Revisit the hotel shortlist.',at:at(-8)}]},
    {id:'flights',title:'Morning flights',createdAt:at(-120),messages:[{id:'flights-message',role:'user',text:'Compare morning flights.',at:at(-120)}]},
    {id:'desk',title:'Desk comparison',createdAt:at(-3000),messages:[{id:'desk-message',role:'user',text:'Compare standing desks.',at:at(-300)}]},
    {id:'kpi',title:'KPI dashboard',createdAt:at(-2000),messages:[{id:'kpi-message',role:'user',text:'Check the KPI dashboard.',at:at(-60)}]},
  ];
  app.runtime.state.conversations = recentFixture; app.runtime.state.jobs = []; app.runtime.changed();
  await page.locator('#new-chat').click();
  const recentRows = page.locator('.recent-conversation');
  await page.waitForFunction(()=>document.querySelector('.recent-conversation')?.dataset.conversation === 'hotel');
  assert.deepEqual(await recentRows.evaluateAll(nodes=>nodes.map(node=>node.dataset.conversation)),['hotel','kpi','flights'],'Top three use last activity, not creation order');
  assert.equal(await page.locator('[data-prompt]').count(),0,'History replaces example tasks');
  await recentRows.nth(1).focus(); await page.keyboard.press('Enter');
  await page.locator('#messages').getByText('Check the KPI dashboard.',{exact:true}).waitFor();
  await page.getByRole('link',{name:'Sidekick home'}).click();
  await page.locator('.welcome h1').waitFor();
  await mascotStage.click();
  recentFixture[2].messages.push({id:'desk-update',role:'assistant',text:'The desk comparison is updated.',at:at(1)}); app.runtime.changed();
  await page.waitForFunction(()=>document.querySelector('.recent-conversation')?.dataset.conversation === 'desk');
  assert.deepEqual(await recentRows.evaluateAll(nodes=>nodes.map(node=>node.dataset.conversation)),['desk','hotel','kpi'],'Recent list refreshes when an older conversation gets a reply');
  assert.equal(await mascotStage.getAttribute('aria-pressed'),'false','Pause survives background updates');
  assert.equal(await page.locator('.mascot').evaluate(node=>getComputedStyle(node).animationPlayState),'paused');
  await mascotStage.click();
  app.runtime.state.jobs.push({id:'activity-check',conversationId:'flights',status:'completed',createdAt:at(-120),events:[{id:'event-check',label:'Read page',at:at(2)}],files:[]}); app.runtime.changed();
  await page.waitForFunction(()=>document.querySelector('.recent-conversation')?.dataset.conversation === 'flights');
  assert.deepEqual(await recentRows.evaluateAll(nodes=>nodes.map(node=>node.dataset.conversation)),['flights','desk','hotel'],'Browser activity also updates recency');
  assert.equal(await page.locator('.history-item').first().getAttribute('data-conversation'),'flights','Sidebar uses the same activity order');
  await page.screenshot({path:join(artifacts,'recent-conversations.png'),fullPage:true}); await audit('Recent conversations');
  await page.setViewportSize({width:320,height:900});
  await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Recent conversations fit mobile');
  await page.screenshot({path:join(artifacts,'recent-conversations-mobile.png'),fullPage:true}); await audit('Mobile recent conversations');
  app.runtime.state.customization = null; app.runtime.changed();
  await page.reload(); await page.locator('#customize-dialog[open]').waitFor();
  await page.locator('#customize-defaults').click(); await page.locator('#customize-dialog').waitFor({state:'hidden'});
  assert.deepEqual(app.runtime.state.customization,defaults,'Keep defaults completes onboarding');
  assert.deepEqual(errors,[]);
  console.log('PASS: recent conversation ordering and updates, upcoming routine summary, onboarding, palettes, avatar editor, profile persistence and settings, chat, task stop, search, memory, schedules, uploads, real browser takeover, 320/768/1024/1440 layouts, no console errors' + (process.env.SIDEKICK_AXE_PATH ? ', WCAG accessibility checks.' : '.'));
  console.log(`Screenshots: ${artifacts}`);
} finally { await browser.close(); server.stop(true); await app.close(); rmSync(directory,{recursive:true,force:true}); }
