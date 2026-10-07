import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { defaults, palettes } from '../public/profile.js';

test('private and group bubbles identify senders, color safe mentions, and fit mobile rich content',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'odwyn-chat-bubbles-'));let app;
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:(req,srv)=>app.fetch(req,srv)});
  const codex=Object.assign(new EventEmitter(),{request:async()=>({account:null}),stop(){}});
  app=createApp({directory,user:'owner',password:'test-password-long-enough',origin:server.url.origin,codex,browser:{close:async()=>{}}});
  const first=app.runtime.state.agents[0],at=new Date().toISOString();
  app.runtime.state.customization={...defaults,name:'Oddy',bodyColor:'#73ad63'};
  app.runtime.state.globalProvider.configured=true;first.provider.configured=true;
  app.runtime.state.skills=[{id:'review',name:'Review code',command:'review-code',description:'',instructions:'Review the code.'}];
  app.runtime.state.workflows=[{id:'pr-review',name:'PR Review FE',command:'pr-review-fe',inputs:[],steps:[{id:'review',type:'output',prompt:'Review'}],start:'review'}];
  app.runtime.state.agents.push({id:'rei',customization:{...defaults,name:'Rei',bodyColor:'#668ad6'},provider:{...first.provider,configured:false}},{id:'kai',customization:{...defaults,name:'Kai Chen',bodyColor:'#a778c6'},provider:{...first.provider,configured:false}});
  const message=(id,role,text,agentId=first.id)=>({id,role,text,agentId,at});
  app.runtime.state.conversations=[
    {id:'private',agentId:first.id,title:'Weekend plans',createdAt:at,messages:[message('p1','user','Any ideas for Saturday? /pr-review-fe $pr-review-fe'),message('p2','assistant','Coffee, then the botanical garden. Want a quieter route?'),message('p3','user','Yes, somewhere away from the crowds.'),message('p4','assistant','Try the north entrance. It’s usually quieter before 10.')]},
    {id:'room',kind:'room',memberIds:[first.id,'rei','kai'],agentId:first.id,title:'Weekend group',createdAt:at,messages:[message('r1','user','@Oddy @Rei, thoughts on Saturday?'),message('r2','assistant','The garden sounds good. @Rei can check the route.'),message('r3','assistant','Found a quieter entrance. @"Kai Chen", coffee nearby?','rei'),message('r4','assistant','Yes — a café across the road opens at 8.','kai')]}
  ];app.runtime.changed();
  const browser=await chromium.launch(),context=await browser.newContext({httpCredentials:{username:'owner',password:'test-password-long-enough'},viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000);
  const artifacts=resolve(import.meta.dir,'../artifacts');mkdirSync(artifacts,{recursive:true});
  try {
    await page.goto(server.url.href+'#chat/private');await page.locator('#messages.private-messages').waitFor();
    const user=await page.locator('.message-user .message-bubble').first().boundingBox(),agent=await page.locator('.message-assistant .message-bubble').first().boundingBox();expect(user.x).toBeGreaterThan(agent.x);
    expect(await page.locator('.private-messages .message-meta').first().isVisible()).toBe(false);
    expect(await page.locator('.message-assistant').first().evaluate(node=>node.style.getPropertyValue('--agent-color'))).toBe('#73ad63');
    expect(await page.locator('#messages .skill-mention').allTextContents()).toEqual(['/pr-review-fe','$pr-review-fe']);
    await page.locator('#prompt').fill('/pr-re');
    await page.locator('[data-workflow-command="/pr-review-fe"]').click();
    expect(await page.locator('#prompt-highlights .skill-mention').textContent()).toBe('/pr-review-fe');
    const draft='/pr-review-fe /review-code @Rei @"Kai Chen" <script> /unknown /review-code-extra /review-code/file email@Rei';
    await page.locator('#prompt').fill(draft);
    expect(await page.locator('#prompt-highlights').textContent()).toBe(draft);
    expect(await page.locator('#prompt-highlights .skill-mention').allTextContents()).toEqual(['/pr-review-fe','/review-code']);
    expect(await page.locator('#prompt-highlights .agent-mention').evaluateAll(nodes=>nodes.map(node=>[node.textContent,node.style.getPropertyValue('--agent-color')]))).toEqual([['@Rei','#668ad6'],['@"Kai Chen"','#a778c6']]);
    expect(await page.locator('#prompt-highlights script').count()).toBe(0);
    const colors=[];
    for(const palette of ['fern','harbor','graphite']){
      app.runtime.state.appearance={palette,motion:'reduced'};app.runtime.changed();
      await page.waitForFunction(accent=>document.documentElement.style.getPropertyValue('--workspace-accent')===accent,palettes[palette].vars.orange);
      colors.push(await page.locator('#prompt-highlights .skill-mention').first().evaluate(node=>getComputedStyle(node).backgroundColor));
    }
    expect(new Set(colors).size).toBe(3);
    // Workspace skill colors stay global even when the active agent overrides its palette.
    app.runtime.state.customization={...first.customization,overrideWorkspace:true,palette:'rose'};app.runtime.changed();
    await page.waitForFunction(paper=>document.documentElement.style.getPropertyValue('--paper')===paper,palettes.rose.vars.paper);
    expect(await page.locator('#prompt-highlights .skill-mention').first().evaluate(node=>getComputedStyle(node).backgroundColor)).toBe(colors.at(-1));
    await page.screenshot({path:join(artifacts,'mention-highlights.png')});
    app.runtime.state.customization={...first.customization,overrideWorkspace:false};app.runtime.state.appearance={palette:'paper',motion:'reduced'};app.runtime.changed();
    await page.locator('#prompt').fill('');
    await page.screenshot({path:join(artifacts,'private-chat-bubbles.png')});
    await page.locator('#room-list [data-conversation="room"]').click();await page.locator('#messages.room-messages').waitFor();
    expect(await page.locator('.message-assistant .message-meta strong').allTextContents()).toEqual(['Oddy','Rei','Kai Chen']);expect(await page.locator('.room-messages .message-avatar').count()).toBe(3);
    expect(await page.locator('.message-assistant .message-avatar').first().isVisible()).toBe(true);
    expect(await page.locator('.agent-mention').evaluateAll(nodes=>nodes.map(node=>[node.textContent,node.style.getPropertyValue('--agent-color')]))).toEqual([['@Oddy','#73ad63'],['@Rei','#668ad6'],['@Rei','#668ad6'],['@Kai Chen','#a778c6']]);
    await page.locator('#prompt').fill('@Re');expect(await page.locator('#room-mentions button').evaluate(node=>node.style.getPropertyValue('--agent-color'))).toBe('#668ad6');
    await page.locator('#room-mentions button').click();expect(await page.locator('#prompt').inputValue()).toBe('@Rei ');await page.locator('#prompt').fill('');
    await page.screenshot({path:join(artifacts,'room-chat-bubbles.png')});
    expect(await page.locator('.conversation-line').count()).toBe(0);
    for(const width of [320,768,1024,1440]){
      await page.setViewportSize({width,height:900});
      if(width<=760)await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().right<=0);
      expect(await page.locator('.topbar').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      for(const selector of ['#room-details-open','#reply-agent','#minimize-agent','#close-conversation','#browser-toggle','#composer']){
        expect(await page.locator(selector).evaluate(node=>{const box=node.getBoundingClientRect();return box.left>=0 && box.right<=innerWidth;})).toBe(true);
      }
      await page.screenshot({path:join(artifacts,`glass-chat-${width}.png`),animations:'disabled'});
    }
    await page.locator('#room-details-open').focus();await page.keyboard.press('Enter');
    expect(await page.locator('#room-participant-count').textContent()).toBe('3 agents · Shared conversation');
    await page.screenshot({path:join(artifacts,'glass-room-menu.png')});
    await page.keyboard.press('Escape');
    expect(await page.locator('#room-details-open').evaluate(node=>node===document.activeElement)).toBe(true);
    await page.evaluate(async()=>{
      const {insertMessages}=await import('/views.js'),{defaults}=await import('/profile.js');
      document.querySelector('#messages').replaceChildren();
      insertMessages({agents:[{id:'rei',customization:{...defaults,name:'Rei',bodyColor:'#668ad6'}}],skills:[{command:'review-code'}],jobs:[],conversations:[{id:'safe',kind:'room',memberIds:['rei'],messages:[{id:'safe-message',role:'assistant',agentId:'rei',at:new Date().toISOString(),text:'@rei @Unknown email@Rei `@Rei` [@Rei](https://example.com) /review-code $review-code /unknown `/review-code`\n\n```txt\n@Rei /review-code\n```\n\n<script>alert(1)</script>\n\n| Column | Detail |\n| --- | --- |\n| Wide table | '+ 'A'.repeat(250)+' |'}]}]},'safe');
    });
    expect(await page.locator('#messages .agent-mention').allTextContents()).toEqual(['@rei']);expect(await page.locator('#messages script').count()).toBe(0);expect(await page.locator('#messages a').getAttribute('href')).toBe('https://example.com');
    expect(await page.locator('#messages .skill-mention').allTextContents()).toEqual(['/review-code','$review-code']);
    for(const width of [320,768,1024,1440]){
      await page.setViewportSize({width,height:900});
      expect(await page.locator('#view').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
      expect(await page.locator('.table-scroll').evaluate(node=>node.scrollWidth>node.clientWidth)).toBe(true);
      expect(await page.locator('.message-bubble').evaluate(node=>node.getBoundingClientRect().right<=innerWidth)).toBe(true);
    }
    const contrasts=await page.evaluate(()=>{
      const article=document.querySelector('.message-assistant'),bubble=article.querySelector('.message-bubble'),mention=article.querySelector('.agent-mention');
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=canvas.height=1;
      const luminance=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();ctx.fillRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(value=>{value/=255;return value<=.04045 ? value/12.92 : ((value+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);};
      return ['#ffffff','#000000','#668ad6'].flatMap(color=>{
        article.style.setProperty('--agent-color',color);mention.style.setProperty('--agent-color',color);
        const background=luminance(getComputedStyle(bubble).backgroundColor);
        return ['.message-meta strong','.message-text','.agent-mention','.message-footer time'].map(selector=>{
          const foreground=luminance(getComputedStyle(article.querySelector(selector)).color);
          return (Math.max(background,foreground)+.05)/(Math.min(background,foreground)+.05);
        });
      });
    });
    for(const contrast of contrasts)expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.locator('.copy-message').focus();expect(await page.locator('.copy-message').evaluate(node=>getComputedStyle(node).opacity)).toBe('1');
    await page.evaluate(()=>{
      document.querySelector('#messages').lastElementChild.querySelector('.message-text').textContent='A long conversation. '.repeat(300);
    });
    for(const width of [320,1440]){
      await page.setViewportSize({width,height:900});
      for(const draft of ['Short reply',Array(6).fill('A longer draft that expands the composer.').join('\n')]){
        await page.locator('#prompt').fill(draft);
        await page.waitForFunction(()=>document.querySelector('#view').getBoundingClientRect().bottom<=document.querySelector('#composer-area').getBoundingClientRect().top);
        await page.locator('#view').evaluate(node=>node.scrollTo({top:node.scrollHeight,behavior:'instant'}));
        const feed=await page.locator('#view').boundingBox(),composer=await page.locator('#composer').boundingBox(),last=await page.locator('.message-footer').last().boundingBox();
        expect(feed.y+feed.height).toBeLessThanOrEqual(composer.y);
        expect(last.y+last.height).toBeLessThan(composer.y-12);
        expect(composer.y+composer.height).toBeLessThanOrEqual(900);
      }
      await page.locator('#prompt').fill(Array(30).fill('/review-code @Rei a draft that wraps across several lines').join('\n')+'\n');
      await page.locator('#prompt').evaluate(node=>{node.scrollTop=node.scrollHeight;node.dispatchEvent(new Event('scroll'));});
      expect(await page.locator('#prompt').evaluate(node=>{
        const mirror=document.querySelector('#prompt-highlights'),a=getComputedStyle(node),b=getComputedStyle(mirror);
        return mirror.scrollTop===node.scrollTop && mirror.clientWidth===node.clientWidth && a.font===b.font;
      })).toBe(true);
      await page.screenshot({path:join(artifacts,`mention-composer-${width}.png`),animations:'disabled'});
      await page.locator('#prompt').fill('');
      await page.locator('#prompt').blur();
      await page.locator('#view').evaluate(node=>node.scrollTo({top:Math.max(0,node.scrollHeight-node.clientHeight-180),behavior:'instant'}));
      await page.screenshot({path:join(artifacts,`chat-composer-${width}.png`),animations:'disabled'});
    }
    expect(errors).toEqual([]);
  }finally{await browser.close();server.stop(true);await app.close();rmSync(directory,{recursive:true,force:true});}
},30_000);
