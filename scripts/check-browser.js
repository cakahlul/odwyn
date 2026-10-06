import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { Codex } from '../codex.js';
import { palettes, defaults } from '../public/profile.js';
import { createJob } from '../store.js';

const directory = mkdtempSync(join(tmpdir(),'odwyn-ui-'));
const root = resolve(import.meta.dir,'..'); const artifacts = join(root,'artifacts'); mkdirSync(artifacts,{recursive:true});
const password = randomBytes(20).toString('hex');
let app;
const server = Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
app = createApp({directory,user:'check',password,origin:server.url.origin,codex:new Codex({home:join(directory,'codex'),workspace:join(directory,'workspace')}),providerOptions:{claudeAuth:async()=>({loggedIn:false})}});
const browser = await chromium.launch();
const context = await browser.newContext({httpCredentials:{username:'check',password},viewport:{width:1440,height:960}});
const page = await context.newPage(); const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const audit = async label => {
  if (!(process.env.ODWYN_AXE_PATH ?? process.env.SIDEKICK_AXE_PATH)) return;
  const {default:AxeBuilder} = await import((process.env.ODWYN_AXE_PATH ?? process.env.SIDEKICK_AXE_PATH));
  const result = await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  assert.deepEqual(result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),[],`${label} accessibility`);
};
try {
  await page.goto(server.url.href); await page.getByRole('heading',{name:/^Message /,level:1}).waitFor();
  await page.evaluate(() => {
    for (const [storage, key, value] of [[localStorage,'closed-agents','[]'],[localStorage,'bubble-positions','{"prior":{"x":12,"y":34}}'],[sessionStorage,'drafts','[]']]) {
      storage.removeItem(`odwyn-${key}`); storage.setItem(`sidekick-${key}`,value);
    }
  });
  await page.reload(); await page.getByRole('heading',{name:/^Message /,level:1}).waitFor();
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('sidekick-bubble-positions'),JSON.parse(localStorage.getItem('odwyn-bubble-positions')).prior,sessionStorage.getItem('sidekick-drafts'),sessionStorage.getItem('odwyn-drafts')]),[null,{x:12,y:34},null,'[]'],'Previous browser preferences survive rebranding');
  assert.match(await page.locator('#add-agent').textContent(),/Add agent/,'Agent creation has a visible label');
  assert.match(await page.locator('.sidebar-agents').textContent(),/Your agents/,'Sidebar identifies the agent controls');
  assert.equal(await page.locator('.sidebar #add-agent').count(),1,'Agent creation belongs in the sidebar');
  await page.locator('#customize-dialog[open]').waitFor();
  assert.equal(await page.locator('#customize-title').textContent(),'Customize your workspace','Workspace setup comes first');
  assert.equal(await page.locator('[data-profile-step="0"]').isVisible(),true);
  assert.equal(await page.locator('#settings-dialog').evaluate(node=>node.open),false,'Provider setup waits for the agent');
  assert.match(await page.locator('.profile-top').textContent(),/update your workspace and agents later in Settings/);
  await page.locator('input[name=palette][value=fern]').check();
  await page.locator('#customize-save').click();
  await page.getByRole('heading',{name:'Create your first agent'}).waitFor();
  assert.equal(app.runtime.state.appearance.palette,'fern','Workspace choices save before agent creation');
  assert.equal(app.runtime.state.customization,null,'Workspace setup does not create an agent profile');
  assert.equal(await page.locator('[data-profile-icon] svg').count(),3,'Every customization tab has a 3D icon');
  assert.equal(await page.locator('[data-profile-step="1"]').isVisible(),true,'Agent setup starts with identity');
  assert.equal(await page.locator('[data-custom-step="0"]').isVisible(),false,'Agent setup has no workspace tab');
  assert.equal(await page.locator('#palette-choices').isVisible(),false,'Agent setup has no palette controls');
  assert.equal(await page.locator('#avatar-choices label').count(),6);
  await page.locator('[data-specialty=shopping]').click();
  assert.match(await page.locator('#agent-specialization').inputValue(),/products, prices/);
  assert.equal(await page.locator('[data-specialty=shopping]').getAttribute('aria-pressed'),'true');
  await page.locator('input[name=shape][value=fox]').check();
  await page.locator('select[name=eyes]').selectOption('wide');
  await page.locator('select[name=mouth]').selectOption('cheerful');
  await page.locator('select[name=accessory]').selectOption('headphones');
  assert.equal(await page.locator('#preview-mascot radialGradient').count(),1,'Avatar keeps its 3D lighting');
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
  assert.equal(await page.locator('#tone-choices label').count(),6);
  await page.locator('select[name=language]').selectOption('id');
  await page.locator('select[name=detail]').selectOption('detailed');
  await page.locator('#user-context-input').fill('Beginner traveler. Prefer examples.');
  assert.match(await page.locator('#preview-reply').textContent(),/Siap, Alex.*kelebihan/s);
  await page.screenshot({path:join(artifacts,'customize-about.png'),fullPage:true});
  await audit('Communication editor');
  await page.locator('#customize-save').click();
  await page.locator('#customize-dialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('#agent-name').textContent(),'Pip');
  assert.equal(await page.locator('.brand-word').textContent(),'odwyn.','Product branding remains after naming the agent');
  assert.equal(await page.locator('.brand .product-mark').count(),1,'Product logo stays distinct from the agent avatar');
  assert.equal(await page.title(),'Odwyn · Pip','Browser title includes product and agent');
  assert.equal(await page.locator('#owner-name').textContent(),'Alex');
  assert.equal(app.runtime.state.customization.name,'Pip');
  assert.equal(app.runtime.state.customization.specialization,'Travel planning & research');
  assert.equal(app.runtime.state.customization.tone,'crisp');
  assert.equal(app.runtime.state.customization.language,'id');
  assert.equal(app.runtime.state.customization.detail,'detailed');
  assert.equal(app.runtime.state.customization.userContext,'Beginner traveler. Prefer examples.');
  await page.locator('#settings-dialog[open]').waitFor();
  assert.equal(await page.locator('#settings-title').textContent(),'Choose your AI provider');
  await page.locator('#provider-type').selectOption('openai');
  assert.equal(await page.locator('#provider-api-fields').isVisible(),true);
  assert.equal(await page.locator('#provider-model').inputValue(),'');
  await page.locator('#provider-type').selectOption('claude');
  assert.equal(await page.locator('#provider-api-fields').isVisible(),false);
  assert.equal(await page.locator('#provider-model').inputValue(),'sonnet');
  await page.locator('#provider-type').selectOption('codex'); await page.locator('#provider-save').click();
  await page.locator('#settings-dialog').waitFor({state:'hidden'});

  await page.locator('#settings-open').click(); await page.locator('#appearance-open').click();
  assert.equal(await page.locator('[data-profile-step="0"]').isVisible(),true,'Appearance has its own editor');
  assert.equal(await page.locator('#agent-name-input').isVisible(),false,'Appearance editor has no agent identity controls');
  await page.locator('select[name=motion]').selectOption('reduced');
  assert.equal(await page.locator('#preview-mascot .avatar-eyes').evaluate(node=>getComputedStyle(node).animationName),'none','Motion preference updates preview');
  await page.screenshot({path:join(artifacts,'customize-look.png'),fullPage:true});
  for (const [key,palette] of Object.entries(palettes)) {
    await page.locator(`input[name=palette][value=${key}]`).check();
    assert.equal(await page.locator('#profile-preview').evaluate(node=>node.style.getPropertyValue('--paper')),palette.vars.paper,'Palette updates the preview');
    assert.equal(await page.locator('.preview-brand .mark-body').evaluate(node=>getComputedStyle(node).fill),await page.locator('.preview-brand .brand-dot').evaluate(node=>getComputedStyle(node).color),'Odwyn preview logo follows its palette accent');
    assert.equal(await page.locator('.preview-brand .mark-face').evaluate(node=>getComputedStyle(node).fill),await page.locator('.preview-app').evaluate(node=>getComputedStyle(node).backgroundColor),'Odwyn preview face follows its palette surface');
    assert.equal(await page.locator(':root').evaluate(node=>node.style.getPropertyValue('--paper')),palettes.fern.vars.paper,'Unsaved palette does not change the app');
    await audit(`${key} preview`);
  }
  await page.locator('#customize-save').click(); await page.locator('#customize-dialog').waitFor({state:'hidden'});
  assert.equal(app.runtime.state.customization.palette,'fern','Workspace appearance does not change agent profile');
  assert.equal(app.runtime.state.appearance.motion,'reduced');
  assert.equal(await page.locator('.mascot').evaluate(node=>getComputedStyle(node).animationName),'none','Saved motion preference keeps the assistant still');
  assert.match(await page.locator('link[rel=icon]').getAttribute('href'),/^data:image\/svg\+xml/);
  await page.reload(); await page.locator('#agent-name').filter({hasText:'Pip'}).waitFor();
  assert.equal(await page.locator('#customize-dialog').evaluate(node=>node.open),false,'Saved profile skips onboarding');
  await page.locator('#settings-open').click(); await page.locator('#customize-open').click();
  await page.locator('[data-custom-step="1"]').click();
  assert.equal(await page.locator('select[name=language]').inputValue(),'id','Reply preferences survive reload');
  assert.equal(await page.locator('#agent-name-input').inputValue(),'Pip','Settings restores saved choices');
  assert.equal(await page.locator('input[name=shape][value=cat]').isChecked(),true);
  await page.locator('#agent-name-input').fill(''); await page.locator('[data-custom-step="2"]').click(); await page.locator('#customize-save').click();
  assert.equal(await page.locator('[data-profile-step="1"]').isVisible(),true,'Invalid name returns to the right step');
  await page.locator('#agent-name-input').fill('Momo');
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
  for (const step of [1,2]) {
    await page.locator(`[data-custom-step="${step}"]`).click();
    assert.equal(await page.locator('#customize-dialog').evaluate(node=>node.scrollWidth>node.clientWidth),false,'Mobile wizard fits its dialog');
    const action = await page.locator(step === 2 ? '#customize-save' : '#customize-next').boundingBox();
    assert.ok(action.y+action.height<=700,'Mobile wizard keeps its action visible');
    await audit(`Mobile wizard step ${step}`);
  }
  await page.locator('#customize-close').click(); await page.setViewportSize({width:1440,height:960});
  for (const key of Object.keys(palettes)) {
    await page.locator('#settings-open').click(); await page.locator('#appearance-open').click();
    await page.locator('select[name=motion]').selectOption('system');
    assert.equal(await page.locator('#preview-mascot .avatar-eyes').evaluate(node=>getComputedStyle(node).animationName),'blink','Unsaved motion choice updates preview independently');
    await page.locator(`input[name=palette][value=${key}]`).check();
    await page.locator('#customize-save').click();
    await page.locator('#customize-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator(':root').evaluate(node=>node.style.getPropertyValue('--paper')),palettes[key].vars.paper);
    assert.equal(await page.locator('.brand .mark-body').evaluate(node=>getComputedStyle(node).fill),await page.locator('.brand-dot').first().evaluate(node=>getComputedStyle(node).color),'Saved palette colors the Odwyn logo');
    await audit(`${key} workspace`);
  }
  await page.locator('#settings-open').click();
  await page.locator('#provider-type').selectOption('openai');
  await page.locator('#provider-model').fill('test-model');
  await page.locator('#provider-base-url').fill('http://localhost:1234/v1');
  await page.locator('#provider-api-key').fill('test-secret');
  await page.locator('#provider-save').click();
  await page.locator('#provider-status').filter({hasText:'Saved.'}).waitFor();
  assert.equal(app.runtime.state.provider.type,'openai');
  assert.equal(await page.locator('#provider-api-key').inputValue(),'');
  await page.getByRole('button',{name:'Close settings'}).click(); await page.reload();
  await page.locator('#connection-label').filter({hasText:'OpenAI-compatible API ready'}).waitFor();
  assert.equal(await page.locator('#customize-dialog').evaluate(node=>node.open),false,'Switching preserves setup');
  await page.locator('#settings-open').click();
  assert.equal(await page.locator('#provider-model').inputValue(),'test-model');
  assert.match(await page.locator('#provider-api-key').getAttribute('placeholder'),/Saved key/);
  await page.setViewportSize({width:320,height:740});
  assert.equal(await page.locator('#settings-dialog').evaluate(node=>node.scrollWidth>node.clientWidth),false,'Provider settings fit mobile');
  await page.screenshot({path:join(artifacts,'provider-settings-mobile.png'),fullPage:true});
  await page.locator('#provider-type').selectOption('claude'); await page.locator('#provider-save').click();
  await page.locator('#account-title').filter({hasText:'Claude Code'}).waitFor();
  assert.match(await page.locator('#account-description').textContent(),/claude auth login/);
  await page.locator('#provider-type').selectOption('codex'); await page.locator('#provider-save').click();
  await page.locator('#account-title').filter({hasText:'Codex'}).waitFor();
  await page.getByRole('button',{name:'Close settings'}).click(); await page.setViewportSize({width:1440,height:960});
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
  await page.getByText('Configure your AI provider in Settings to begin.').waitFor();
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
    return !node.querySelector('script,iframe,svg:not(.icon),[onerror],[onload],a[href^="javascript:"]') && [...node.querySelectorAll('img')].every(img=>img.getAttribute('src').startsWith('/api/images?url='));
  }),'Markdown escapes HTML and unsafe links; source images use the protected image endpoint');
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
  await page.locator('#settings-open').click();
  assert.equal(await page.locator('#preferred-currency').inputValue(),'source','Default keeps original prices');
  await page.locator('#preferred-currency').selectOption('IDR');
  await page.locator('#preferences').fill('Based in Jakarta. Prefer morning flights.'); await page.getByRole('button',{name:'Save preferences'}).click();
  await page.getByText('Preferences saved. Applies to your next task.').waitFor(); await audit('Settings');
  assert.equal(app.runtime.state.currency,'IDR','Currency preference is saved');
  await page.getByRole('button',{name:'Close settings'}).click(); await page.reload();
  await page.locator('#settings-open').click();
  assert.equal(await page.locator('#preferred-currency').inputValue(),'IDR','Preferred currency survives reload');
  assert.equal(await page.locator('#preferences').inputValue(),'Based in Jakarta. Prefer morning flights.','Currency keeps existing memory');
  await page.getByRole('button',{name:'Close settings'}).click(); await page.locator('#new-chat').click();
  await page.getByRole('button',{name:'Toggle browser panel'}).click();
  await page.getByRole('button',{name:'Open browser',exact:true}).click();
  await page.locator('#browser-image').waitFor(); await page.locator('#navigate-url').fill('https://example.com'); await page.locator('#browser-navigate').evaluate(form=>form.requestSubmit());
  await page.locator('#browser-url').filter({hasText:'https://example.com'}).waitFor({timeout:45_000});
  await page.getByRole('button',{name:'Hand back'}).click();
  await page.getByRole('button',{name:'Take control',exact:true}).waitFor();
  await page.screenshot({path:join(artifacts,'browser.png'),fullPage:true});
  const previewJob=createJob(app.runtime.state,{agentId:app.runtime.state.agents[0].id,conversationId:conversation.id,prompt:'Inspect the current browser page'});
  previewJob.status='running'; previewJob.browserUsed=true;
  app.runtime.active=previewJob; app.browser.owner=previewJob.id; app.runtime.changed();
  await page.locator(`#history [data-conversation="${conversation.id}"]`).click();
  assert.deepEqual(await page.locator('#interaction-mode option').evaluateAll(nodes=>nodes.map(node=>node.value)),['confirm','safe','allow'],'All three approval modes are available');
  assert.equal(await page.locator('#interaction-mode').inputValue(),previewJob.interactionMode,'Dropdown reflects current work, not a stale draft');
  previewJob.interactionMode='allow'; app.runtime.changed();
  await page.waitForFunction(()=>document.querySelector('#interaction-mode').value==='allow');
  previewJob.interactionMode='confirm'; app.runtime.changed();
  await page.waitForFunction(()=>document.querySelector('#interaction-mode').value==='confirm');
  const inlinePreview=page.locator('#conversation-browser'), previewImage=page.locator('#conversation-browser-image');
  await previewImage.waitFor({state:'visible'});
  await page.waitForFunction(()=>{ const image=document.querySelector('#conversation-browser-image').getBoundingClientRect(),view=document.querySelector('#view').getBoundingClientRect(); return image.y<view.bottom && image.bottom>view.y; });
  const previewBox=await previewImage.boundingBox(), viewBox=await page.locator('#view').boundingBox();
  assert.ok(previewBox.y<viewBox.y+viewBox.height && previewBox.y+previewBox.height>viewBox.y,'Live browser opens within the conversation viewport');
  assert.equal(await page.locator('#browser-toggle').getAttribute('aria-expanded'),'false','Inline browser works with side panel closed');
  assert.equal(await previewImage.getAttribute('src'),await page.locator('#browser-image').getAttribute('src'),'Conversation uses the actual browser screenshot feed');
  assert.match(await page.locator('#conversation-browser-url').textContent(),/example.com/);
  const pendingApproval=app.runtime.waitForOwner(previewJob,{type:'interaction',risk:'interaction',title:'Allow click?',detail:'Include one child in hotel occupancy',target:'Add Children'});
  await page.locator('.approval-card').waitFor();
  const permissionUpdate=page.waitForResponse(response=>response.url().endsWith(`/api/jobs/${previewJob.id}/permissions`));
  await page.locator('#interaction-mode').selectOption('allow');
  assert.equal((await permissionUpdate).status(),200,'Permission selector updates the current task');
  assert.equal(previewJob.interactionMode,'allow');
  assert.equal((await pendingApproval).decision,'allow','Always approve releases the ordinary pending click');
  await page.locator('.approval-card').waitFor({state:'hidden'});
  await inlinePreview.locator('summary').click();
  await page.waitForFunction(()=>!document.querySelector('#conversation-browser').open);
  previewJob.events.push({id:'preview-update',label:'Reading page',detail:'Checking the visible page',at:new Date().toISOString()}); app.runtime.changed();
  await page.getByText('Checking the visible page',{exact:true}).first().waitFor();
  assert.equal(await inlinePreview.evaluate(node=>node.open),false,'Minimize survives task updates');
  assert.equal(await inlinePreview.isVisible(),false,'Minimized browser leaves the chat');
  assert.equal(await page.getByRole('button',{name:'Show live browser',exact:true}).isVisible(),true,'Floating button restores the browser');
  await page.getByRole('button',{name:'Show live browser',exact:true}).focus(); await page.keyboard.press('Enter');
  await previewImage.waitFor({state:'visible'});
  for (const width of [320,1440]) {
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Inline browser fits at ${width}`);
    await previewImage.scrollIntoViewIfNeeded();
    await page.screenshot({path:join(artifacts,`conversation-browser-${width}.png`)});
  }
  await page.locator('[data-browser-controls]').click();
  assert.equal(await page.locator('#browser-toggle').getAttribute('aria-expanded'),'true','Inline preview opens takeover controls');
  await page.locator('#browser-close').click();
  await page.locator('#new-chat').click();
  assert.equal(await inlinePreview.count(),0,'Other conversations do not display the active browser');
  await page.locator(`#history [data-conversation="${conversation.id}"]`).click();
  await previewImage.waitFor({state:'visible'});
  delete previewJob.browserUsed;
  previewJob.events.push({id:'legacy-browse',label:'Reading page',at:new Date().toISOString()}); app.runtime.changed();
  const frameMethod=app.browser.frame.bind(app.browser);
  app.browser.frame=async()=>{const frame=await frameMethod();delete frame.jobId;return frame;};
  await page.waitForTimeout(1800);
  assert.equal(await previewImage.isVisible(),true,'Existing runs and older frame metadata still show in chat');
  app.browser.frame=async()=>({...await frameMethod(),jobId:'another-job'});
  await page.waitForFunction(()=>document.querySelector('#conversation-browser-image').hidden);
  assert.equal(await previewImage.getAttribute('src'),null,'A frame belonging to another run is never shown inline');
  app.browser.frame=frameMethod;
  await previewImage.waitFor({state:'visible'});
  previewJob.status='completed'; previewJob.endedAt=new Date().toISOString(); app.runtime.active=null; app.browser.owner=null; app.runtime.changed();
  await inlinePreview.waitFor({state:'detached'});
  await page.locator('#new-chat').click();

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
  await page.getByRole('link',{name:'Odwyn home'}).click();
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
  await page.locator('#customize-defaults').click();
  await page.getByRole('heading',{name:'Create your first agent'}).waitFor();
  assert.deepEqual(app.runtime.state.appearance,{palette:defaults.palette,motion:defaults.motion},'Workspace defaults still prompt agent creation');
  await page.locator('#customize-defaults').click(); await page.locator('#customize-dialog').waitFor({state:'hidden'});
  assert.deepEqual(app.runtime.state.customization,defaults,'Keep defaults completes onboarding');
  const firstAgentId = app.runtime.state.agents[0].id;
  await page.setViewportSize({width:1440,height:960});
  await page.locator('#prompt').fill('Draft for Odwyn');
  await page.locator('#file-input').setInputFiles({name:'agent-draft.txt',mimeType:'text/plain',buffer:Buffer.from('Agent attachment')});
  await page.locator('#attachments').getByText('agent-draft.txt').waitFor();
  await page.locator('#interaction-mode').selectOption('allow');
  const workspacePalette=await page.locator(':root').evaluate(node=>node.style.getPropertyValue('--paper'));
  await page.locator('#add-agent').click();
  assert.equal(await page.locator('[data-profile-step="1"]').isVisible(),true,'Add agent starts with identity');
  assert.equal(await page.locator('#palette-choices').isVisible(),false,'Add agent cannot change workspace palette');
  await page.locator('[data-custom-step="1"]').click(); await page.locator('#agent-name-input').fill('Scout');
  await page.locator('input[name=shape][value=orb]').check();
  await page.locator('[data-custom-step="2"]').click(); await page.locator('#customize-save').click();
  await page.locator('#settings-dialog[open]').waitFor();
  await page.locator('#provider-type').selectOption('claude'); await page.locator('#provider-model').fill('scout-model'); await page.locator('#provider-effort').selectOption('high'); await page.locator('#provider-save').click();
  await page.locator('#settings-dialog').waitFor({state:'hidden'});
  const scoutId = app.runtime.state.agents[1].id;
  assert.equal(await page.locator(':root').evaluate(node=>node.style.getPropertyValue('--paper')),workspacePalette,'Creating and switching agents preserves workspace appearance');
  assert.equal(app.runtime.state.agents[1].provider.type,'claude');
  assert.equal(app.runtime.state.agents[1].provider.effort,'high','Each agent saves its own model effort');
  assert.equal(app.runtime.state.provider.effort,'default','Other agents keep their own effort');
  assert.equal(app.runtime.state.provider.type,'codex','Scout provider does not change Odwyn');
  assert.equal(await page.locator('#prompt').inputValue(),'','New agent starts with its own composer');
  assert.equal(await page.locator('#attachments .attachment-chip').count(),0,'New agent has no other agent attachments');
  const rootBubble = page.locator(`[data-bubble="${firstAgentId}"]`);
  const rootBox = await rootBubble.boundingBox();
  await page.mouse.move(rootBox.x+55,rootBox.y+28); await page.mouse.down();
  await page.mouse.move(rootBox.x+155,rootBox.y-150,{steps:10}); await page.mouse.up();
  assert.equal(await page.locator('#reply-agent').inputValue(),scoutId,'Dragging never restores the agent');
  assert.ok((await rootBubble.boundingBox()).y<rootBox.y-100,'Bubbles can move away from the bottom');
  await rootBubble.locator('.bubble-restore').focus(); const movedBox=await rootBubble.boundingBox();
  await page.keyboard.press('Alt+ArrowUp');
  assert.ok((await rootBubble.boundingBox()).y<=movedBox.y-23,'Keyboard can move bubbles');
  const savedPosition=await page.evaluate(id=>JSON.parse(localStorage.getItem('odwyn-bubble-positions'))[id],firstAgentId);
  assert.ok(savedPosition.y<.9,'Moved positions persist');
  await page.locator('#prompt').fill('Draft for Scout');
  await page.locator(`[data-agent="${firstAgentId}"]`).click();
  await page.waitForFunction(()=>document.querySelector('#prompt').value==='Draft for Odwyn');
  await page.locator('#minimize-agent').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('#minimize-agent').disabled);
  assert.equal(await page.locator('#interaction-mode').inputValue(),'allow','Permissions stay with the draft');
  assert.equal(await page.locator('#attachments .attachment-chip').count(),1,'Switching restores the attachment');
  await page.locator(`[data-agent="${scoutId}"]`).focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#prompt').value==='Draft for Scout' && !document.querySelector('#minimize-agent').disabled);
  assert.equal(await page.locator('#interaction-mode').inputValue(),'confirm');
  assert.equal(await page.locator('#attachments .attachment-chip').count(),0);
  await page.locator('#prompt').fill('Scout-only conversation'); await page.locator('#prompt').press('Enter');
  await page.locator('#messages').getByText('Scout-only conversation',{exact:true}).waitFor();
  const scoutChat = app.runtime.state.conversations.find(c => c.agentId===scoutId);
  assert.equal(scoutChat.messages[0].text,'Scout-only conversation');
  assert.equal(app.runtime.state.jobs[0].agentId,scoutId);
  await page.locator('#minimize-agent').click();
  await page.getByRole('heading',{name:'Your agents are minimized'}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('#add-agent').disabled);
  assert.equal(await page.locator('#composer-area').isVisible(),false);
  await page.reload(); await page.getByRole('heading',{name:'Your agents are minimized'}).waitFor();
  await page.locator(`#agent-dock [data-agent="${scoutId}"]`).click();
  await page.locator('#messages').getByText('Scout-only conversation',{exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('#minimize-agent').disabled);
  assert.equal(app.runtime.state.jobs[0].status,'queued','Minimizing leaves the task queued');
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.locator('#prompt').fill('Continue this shared chat');
  await page.locator('#reply-agent').selectOption(firstAgentId);
  await page.waitForFunction(()=>!document.querySelector('#minimize-agent').disabled);
  assert.equal(await page.locator('#prompt').inputValue(),'Continue this shared chat','Reply agent keeps the conversation draft');
  assert.equal(await page.locator('#messages').getByText('Scout-only conversation',{exact:true}).count(),1,'Reply selector keeps the same conversation');
  await page.locator('#prompt').press('Enter');
  await page.locator('#messages').getByText('Continue this shared chat',{exact:true}).waitFor();
  assert.equal(app.runtime.state.jobs[0].conversationId,scoutChat.id);
  assert.equal(app.runtime.state.jobs[0].agentId,firstAgentId);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  scoutChat.messages.push(...[firstAgentId,scoutId].map((id,i)=>({id:`shared-author-${i}`,agentId:id,role:'assistant',text:`Shared reply ${i}`,at:new Date().toISOString()}))); app.runtime.changed();
  await page.getByText('Shared reply 1',{exact:true}).waitFor();
  assert.deepEqual(await page.locator('.message-assistant .message-meta strong').allTextContents(),['Odwyn','Scout'],'Shared replies show their actual agent');
  await page.screenshot({path:join(artifacts,'shared-conversation.png'),fullPage:true});
  await page.locator(`#agent-dock [data-close-agent="${scoutId}"]`).click();
  assert.equal(await page.locator(`[data-bubble="${scoutId}"]`).count(),0,'Close removes the floating bubble');
  assert.ok(app.runtime.state.conversations.includes(scoutChat),'Close preserves saved conversation');
  await page.locator(`[data-select-agent="${scoutId}"]`).click();
  await page.waitForFunction(()=>!document.querySelector('#minimize-agent').disabled);
  await page.locator('#messages').getByText('Scout-only conversation',{exact:true}).waitFor();
  await page.locator('#close-conversation').click();
  await page.getByRole('heading',{name:'Your agents are minimized'}).waitFor();
  assert.equal(await page.locator(`[data-bubble="${scoutId}"]`).count(),0,'Closed active workspace has no bubble');
  await page.locator(`[data-conversation="${scoutChat.id}"]`).first().click();
  await page.waitForFunction(()=>!document.querySelector('#minimize-agent').disabled);
  await page.locator('#messages').getByText('Scout-only conversation',{exact:true}).waitFor();
  await page.locator(`[data-select-agent="${scoutId}"]`).click();
  await page.waitForFunction(()=>document.querySelector('#agent-name').textContent==='Scout' && !document.querySelector('#minimize-agent').disabled);
  await page.locator(`[data-agent="${firstAgentId}"]`).click();
  await page.waitForFunction(()=>document.querySelector('#agent-name').textContent==='Odwyn' && !document.querySelector('#minimize-agent').disabled);
  assert.equal(await page.locator('#history').getByText('Scout-only conversation').count(),1,'Shared chats remain available to every agent');
  for (let i=3;i<=5;i++) {
    await page.locator('#add-agent').click(); await page.locator('[data-custom-step="2"]').click(); await page.locator('#customize-save').click();
    await page.locator('#settings-dialog[open]').waitFor();
    await page.locator('#provider-type').selectOption('claude'); await page.locator('#provider-save').click();
    await page.locator('#settings-dialog').waitFor({state:'hidden'});
  }
  assert.equal(await page.locator('#add-agent').isDisabled(),true,'Five-agent cap disables Add');
  assert.equal(await page.locator('#agent-dock .agent-slot').count(),4,'Only minimized agents float');
  assert.equal(await page.locator('#sidebar-agent-list .sidebar-agent').count(),5,'All agents are selectable in the sidebar');
  await page.locator('#settings-open').click(); assert.equal(await page.locator('#provider-type').inputValue(),'claude');
  await page.getByRole('button',{name:'Close settings'}).click();
  const scoutJob = app.runtime.state.jobs.find(j => j.agentId===scoutId);
  scoutJob.status = 'waiting'; scoutJob.pending = {id:'input-check',type:'question',title:'Your input, please',detail:'Which website?'};
  app.runtime.active = scoutJob;
  createJob(app.runtime.state,{agentId:scoutId,prompt:'Queued Scout follow-up'});
  await page.locator(`[data-agent="${scoutId}"]`).focus(); app.runtime.changed();
  await page.locator(`[data-bubble="${scoutId}"]`).filter({hasText:'!'}).waitFor();
  assert.equal(await page.locator(`[data-agent="${scoutId}"]`).getAttribute('aria-label'),'Restore Scout, Needs your input','Owner input takes priority over newer queued work');
  assert.equal(await page.locator(`[data-agent="${scoutId}"]`).evaluate(node=>node===document.activeElement),true,'Status updates preserve icon keyboard focus');
  for (const width of [320,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    if (width<=760) await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Five agents fit at ${width}`);
    if (width<=760) { await page.getByRole('button',{name:'Open navigation'}).click(); await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().left>=0); }
    const addBox=await page.locator('#add-agent').boundingBox(); assert.ok(addBox.x>=0 && addBox.x+addBox.width<=width,'Sidebar Add agent is reachable');
    assert.equal(await page.locator('#agent-count').textContent(),'5 of 5');
    if (width>=1024) assert.ok(await page.locator('#sidebar-agent-list').evaluate(node=>node.scrollHeight<=node.clientHeight),'Desktop shows all five agents without clipping');
    if (width<=760) { await page.keyboard.press('Escape'); await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0); }
    for (const id of ['reply-agent','minimize-agent','close-conversation']) {
      const control=page.locator(`#${id}`), box=await control.boundingBox();
      assert.ok(box.x>=0 && box.x+box.width<=width,`Labeled ${id} fits at ${width}`);
      assert.ok(await control.isVisible(),`Labeled ${id} remains visible at ${width}`);
    }
    for (const slot of await page.locator('#agent-dock .agent-slot').all()) { const box=await slot.boundingBox(); assert.ok(box.x>=0 && box.x+box.width<=width,`Avatar is reachable at ${width}`); }
    if (width===320) {
      const touch=await context.newCDPSession(page), bubble=page.locator(`[data-bubble="${firstAgentId}"]`), box=await bubble.boundingBox(), selected=await page.locator('#reply-agent').inputValue();
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+50,y:box.y+28}]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+50,y:box.y-72}]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      assert.ok((await bubble.boundingBox()).y<box.y-90,'Touch can drag minimized agents');
      assert.equal(await page.locator('#reply-agent').inputValue(),selected,'Touch dragging keeps the selected agent');
      await touch.detach();
    }
    await page.screenshot({path:join(artifacts,`agents-${width}.png`),fullPage:true}); await audit(`Five agents at ${width}`);
  }
  for (const width of [390,1440]) {
    await page.setViewportSize({width,height:360});
    if (width<=760) {
      await page.getByRole('button',{name:'Open navigation'}).click();
      await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().left>=0);
    }
    const sidebar=page.locator('.sidebar');
    assert.ok(await sidebar.evaluate(node=>node.clientHeight<=innerHeight && node.scrollHeight>node.clientHeight),'Short sidebar stays within viewport and overflows');
    await sidebar.evaluate(node=>node.scrollTop=0);
    await sidebar.hover(); await page.mouse.wheel(0,2000);
    await page.waitForFunction(()=>document.querySelector('.sidebar').scrollTop>0);
    await page.locator('#settings-open').focus();
    const owner=await page.locator('#settings-open').boundingBox();
    assert.ok(owner.y>=0 && owner.y+owner.height<=360,'Sidebar settings remain reachable by scrolling and keyboard');
    await page.screenshot({path:join(artifacts,`sidebar-short-${width}.png`)});
    if (width<=760) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0);
    }
  }
  await page.setViewportSize({width:1440,height:960});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator(`[data-agent="${scoutId}"]`).click();
  await page.waitForFunction(()=>document.querySelector('#agent-name').textContent==='Scout' && !document.querySelector('#minimize-agent').disabled);
  assert.equal(await page.locator('#agent-workspace').evaluate(node=>node.getAnimations().length),0,'Reduced motion skips switching animation');
  await page.reload(); await page.waitForFunction(()=>document.querySelector('#agent-name').textContent==='Scout');
  if ((await page.viewportSize()).width<=760) await page.getByRole('button',{name:'Open navigation'}).click();
  await page.locator('#settings-open').click();
  assert.equal(await page.locator('#provider-type').inputValue(),'claude','Selected agent persists after reload');
  assert.equal(await page.locator('#provider-model').inputValue(),'scout-model','Per-agent model persists after reload');
  assert.equal(await page.locator('#provider-effort').inputValue(),'high','Per-agent effort persists after reload');
  await page.getByRole('button',{name:'Close settings'}).click();
  await page.locator('.sidebar').evaluate(node=>node.scrollTop=0);
  const scoutMenu=page.locator(`[data-manage-agent="${scoutId}"]`);
  await scoutMenu.locator('summary').focus(); await page.keyboard.press('Enter');
  assert.equal(await scoutMenu.evaluate(node=>node.open),true,'Agent management opens by keyboard');
  await page.keyboard.press('Escape');
  assert.equal(await scoutMenu.evaluate(node=>node.open),false,'Escape closes agent management');
  assert.equal(await scoutMenu.locator('summary').evaluate(node=>node===document.activeElement),true,'Escape returns focus to menu trigger');
  await scoutMenu.locator('summary').click();
  await page.screenshot({path:join(artifacts,'agent-management.png')});
  await scoutMenu.getByRole('button',{name:'Customize agent',exact:true}).click();
  await page.locator('#customize-dialog[open]').waitFor();
  assert.equal(await page.locator('#agent-name-input').inputValue(),'Scout','Menu customizes the existing agent');
  assert.equal(await page.locator('#palette-choices').isVisible(),false,'Agent management keeps workspace appearance separate');
  await page.locator('#agent-specialization').fill('Research travel options');
  await page.locator('#customize-next').click(); await page.locator('#customize-save').click();
  await page.locator('#customize-dialog').waitFor({state:'hidden'});
  assert.equal(app.runtime.state.agents.find(a=>a.id===scoutId).customization.specialization,'Research travel options');
  const primaryMenu=page.locator(`[data-manage-agent="${firstAgentId}"]`);
  await primaryMenu.locator('summary').click(); await primaryMenu.getByRole('button',{name:'Agent settings',exact:true}).click();
  await page.locator('#settings-dialog[open]').waitFor();
  assert.equal(await page.locator('#settings-agent-name').textContent(),'Odwyn','Management switches to the chosen agent before opening settings');
  assert.equal(await page.locator('#provider-type').inputValue(),'codex');
  await page.getByRole('button',{name:'Close settings'}).click();
  for (const job of app.runtime.state.jobs) if (['queued','running','waiting','takeover','stopping'].includes(job.status)) {job.status='cancelled';delete job.pending;}
  app.runtime.active=null;app.runtime.changed();
  await page.locator(`[data-select-agent="${scoutId}"]`).click();
  await page.waitForFunction(()=>document.querySelector('#agent-name').textContent==='Scout' && !document.querySelector('#minimize-agent').disabled);
  await scoutMenu.locator('summary').click();
  page.once('dialog',dialog=>dialog.dismiss());
  await scoutMenu.getByRole('button',{name:'Delete agent',exact:true}).click();
  assert.equal(app.runtime.state.agents.length,5,'Canceling deletion keeps the agent');
  await scoutMenu.locator('summary').click();
  page.once('dialog',dialog=>dialog.accept());
  await scoutMenu.getByRole('button',{name:'Delete agent',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#agent-count').textContent==='4 of 5');
  assert.equal(await page.locator(`[data-manage-agent="${scoutId}"]`).count(),0,'Deleted agent leaves the sidebar');
  assert.equal(await page.locator(`[data-bubble="${scoutId}"]`).count(),0,'Deleted agent leaves the floating dock');
  assert.equal(await page.locator('#reply-agent').inputValue(),firstAgentId,'Deleting the current agent selects a remaining agent');
  assert.equal(await page.locator('#add-agent').isDisabled(),false,'Deletion frees an agent slot');
  await page.locator(`#history [data-conversation="${scoutChat.id}"]`).click();
  await page.locator('#messages').getByText('Shared reply 1',{exact:true}).waitFor();
  assert.ok((await page.locator('.message-assistant .message-meta strong').allTextContents()).includes('Scout'),'Deleted agent history retains its author');
  await page.reload(); await page.locator('#agent-count').filter({hasText:'4 of 5'}).waitFor();
  assert.equal(await page.locator('#reply-agent').inputValue(),firstAgentId,'Deletion selection survives reload');
  for (const agent of [...app.runtime.state.agents].filter(a=>a.id!==firstAgentId)) {
    const menu=page.locator(`[data-manage-agent="${agent.id}"]`);
    await menu.locator('summary').click();page.once('dialog',dialog=>dialog.accept());
    await menu.getByRole('button',{name:'Delete agent',exact:true}).click();await menu.waitFor({state:'detached'});
  }
  await primaryMenu.locator('summary').click();
  assert.equal(await primaryMenu.getByRole('button',{name:'Delete agent',exact:true}).isDisabled(),true,'Last agent requires a replacement');
  assert.deepEqual(errors,[]);
  console.log('PASS: agent management, deletion and retained history; five-agent cap, per-agent provider/model, shared chats and reply authors, switching drafts and permissions, mouse/touch/keyboard bubble movement, minimize/restore, close/reopen, reduced motion, selection persistence, provider onboarding, recent chats, palettes, customization, chat, task stop, search, memory, routines, uploads, browser takeover, 320/768/1024/1440 layouts, no console errors' + ((process.env.ODWYN_AXE_PATH ?? process.env.SIDEKICK_AXE_PATH) ? ', WCAG accessibility checks.' : '.'));
  console.log(`Screenshots: ${artifacts}`);
} finally { await browser.close(); server.stop(true); await app.close(); rmSync(directory,{recursive:true,force:true}); }
