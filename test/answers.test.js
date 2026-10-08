import { test, expect } from 'bun:test';
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { createApp } from '../server.js';
import { defaults } from '../public/profile.js';

test('assistant cards cover shopping outcomes, preserve fallback content, and fit every viewport', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'odwyn-answers-'));
  const codex = new EventEmitter(); codex.request = async () => ({ account: null }); codex.stop = () => {};
  const app = createApp({ directory, user: 'owner', password: 'test-password-long-enough', codex, browser: { close: async () => {} } });
  app.runtime.state.customization = defaults; app.runtime.state.provider.configured = true; app.runtime.state.globalProvider.configured = true;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
  const browser = await chromium.launch();
  const context = await browser.newContext({ httpCredentials: { username: 'owner', password: 'test-password-long-enough' } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const block = data => '```odwyn\n' + JSON.stringify(data) + '\n```';
  const render = text => page.evaluate(async text => {
    const { richText } = await import('/ui.js');
    document.querySelector('#agent-workspace').classList.remove('chat-start');
    const view = document.querySelector('#view');
    view.innerHTML = '<div class="conversation"><article class="message message-assistant"></article></div>';
    view.querySelector('article').append(richText(text));
    view.scrollTop = 0;
  }, text);
  const products = { type: 'products', title: 'Your desk shortlist', items: [
    { name: 'Oak standing desk', price: 'Rp 2.499.000', seller: 'Desk Studio', label: 'Best fit', availability: 'In stock', detail: '120 × 60 cm · adjustable height', url: 'https://example.com/oak' },
    { name: 'Compact desk', price: '$129.00–$149.00', seller: 'Workspace', availability: 'Out of stock', detail: 'Shipping calculated at checkout' },
    { name: 'Custom walnut desk', detail: 'Made to order. Price not listed.' },
  ] };
  try {
    await page.goto(server.url.href+'#chat'); await page.locator('.welcome').waitFor();
    const review={type:'pr_review',prUrl:'https://example.com/pull/12',commit:'abc123',summary:'Two findings need review.',feedback:[{id:'F1',severity:'major',location:'PR description',comment:'Include QA evidence.',sourceUrl:'https://example.com/evidence'},{id:'F2',severity:'minor',comment:'Clarify the title.'}]};
    for(const reply of [JSON.stringify(review,null,2),'```json\n'+JSON.stringify(review)+'\n```',block(review)]){
      await render(reply);
      expect(await page.locator('.review-item').count()).toBe(2);
      expect(await page.locator('.answer-review').textContent()).toContain('Two findings need review.');
      expect(await page.locator('.review-item').first().textContent()).toContain('Include QA evidence.');
      expect(await page.locator('.answer-review a').first().getAttribute('href')).toBe(review.prUrl);
      expect(await page.locator('.answer-review input,.answer-review button').count()).toBe(0);
    }
    await render(JSON.stringify({...review,feedback:[{id:'<script>',comment:'<img src=x onerror=alert(1)>',sourceUrl:'javascript:alert(1)',extra:{nested:'preserved'}}]}));
    expect(await page.locator('.review-item').textContent()).toContain('preserved');
    expect(await page.locator('.answer-review script,.answer-review img,.answer-review a[href^="javascript:"]').count()).toBe(0);
    await render(JSON.stringify({type:'pr_review',feedback:'invalid'}));
    expect(await page.locator('.answer-review').count()).toBe(0);
    await render('Three options within your budget.\n\n' + block(products) + '\n\n> Check shipping before checkout.');
    expect(await page.locator('.product-card').count()).toBe(3);
    await render(block(products).replace('```odwyn','```sidekick'));
    expect(await page.locator('.product-card').count()).toBe(3);
    await render('Three options within your budget.\n\n' + block(products) + '\n\n> Check shipping before checkout.');
    expect(await page.locator('.product-price').allTextContents()).toEqual(['Rp 2.499.000', '$129.00–$149.00', 'Price unavailable']);
    expect(await page.getByRole('link', { name: /View product/ }).getAttribute('href')).toBe('https://example.com/oak');
    expect(await page.locator('.product-card').nth(1).textContent()).toContain('Out of stock');
    expect(await page.locator('blockquote').textContent()).toContain('Check shipping');
    await page.getByRole('link', { name: /View product/ }).focus();
    expect(await page.evaluate(() => document.activeElement.tagName)).toBe('A');
    await page.evaluate(() => document.activeElement.blur());
    const artifacts = resolve(import.meta.dir, '../artifacts'); mkdirSync(artifacts, { recursive: true });
    const bannerPage = await page.context().newPage();
    await bannerPage.setViewportSize({ width: 800, height: 400 });
    await bannerPage.setContent('<div style="position:fixed;inset:0;background:#152c36;color:#fff;font:60px system-ui;display:grid;place-content:center;text-align:center"><small style="font-size:18px;letter-spacing:6px;color:#f1c79c">DEMO CONCERT</small>Live at the Gardens<span style="font-size:22px;margin-top:24px">Friday · 7 PM</span></div>');
    const banner = await bannerPage.screenshot(); await bannerPage.close();
    await page.route('**/api/images?*', route => {
      const source = new URL(route.request().url()).searchParams.get('url');
      return route.fulfill(source.includes('missing') ? { status:404 } : { contentType:'image/png', body:banner });
    });
    const concert = { type:'products', category:'concert', items:[{ name:'Live at the Gardens', price:'Rp 650.000', detail:'Friday · 7 PM · General admission', image:'https://source.example/concert.jpg', imageAlt:'Official concert banner', url:'https://source.example/concert' }] };
    await render(block(concert));
    expect(await page.locator('.card-category').textContent()).toContain('Concert');
    expect(await page.locator('.card-category svg').count()).toBe(1);
    expect(await page.locator('.card-media img').getAttribute('alt')).toBe('Official concert banner');
    expect(await page.locator('.card-media img').getAttribute('src')).toBe('/api/images?url=' + encodeURIComponent('https://source.example/concert.jpg'));
    await page.waitForFunction(() => document.querySelector('.card-media img')?.naturalWidth > 0);
    const receipt = { type:'receipt', category:'concert', tone:'success', title:'Concert tickets confirmed', image:'https://source.example/concert.jpg', imageAlt:'Official concert banner', url:'https://source.example/concert', receiptUrl:'https://source.example/orders/123/receipt', facts:[{label:'Quantity',value:'2 tickets'},{label:'Total paid',value:'Rp 1.300.000'}] };
    await render(block(receipt));
    expect(await page.locator('.answer-summary .card-category').textContent()).toContain('Concert');
    expect(await page.locator('.answer-summary .card-media img').count()).toBe(1);
    expect(await page.getByRole('link',{name:/Original receipt/}).getAttribute('href')).toBe(receipt.receiptUrl);
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button',{name:'Download receipt'}).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('Concert-tickets-confirmed.html');
    const saved = await Bun.file(await download.path()).text();
    expect(saved).toContain('data:image/png;base64,'); expect(saved).toContain('Rp 1.300.000');
    expect(saved).toContain(receipt.receiptUrl); expect(saved).not.toContain('data-save-receipt');
    const savedPath = join(directory,'receipt.html'); await download.saveAs(savedPath);
    const offline = await context.newPage();
    await offline.goto(new URL('file://' + savedPath).href);
    await offline.waitForFunction(() => document.querySelector('.card-media img')?.naturalWidth > 0);
    expect(await offline.getByRole('link',{name:/Original receipt/}).getAttribute('href')).toBe(receipt.receiptUrl);
    expect(await offline.locator('[data-save-receipt]').count()).toBe(0);
    await offline.screenshot({path:join(artifacts,'receipt-saved.png'),fullPage:true}); await offline.close();
    await page.waitForFunction(() => document.querySelector('.card-media img')?.naturalWidth > 0);
    await page.screenshot({path:join(artifacts,'concert-receipt.png'),fullPage:true});
    await page.setViewportSize({width:320,height:900});
    await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 0);
    expect(await page.locator('#view').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    await page.screenshot({path:join(artifacts,'concert-receipt-mobile.png'),fullPage:true});
    await render(block(concert));
    await page.waitForFunction(() => document.querySelector('.card-media img')?.naturalWidth > 0);
    await page.screenshot({path:join(artifacts,'concert-card-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:900});
    await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().left >= 0);
    for (const [category,label] of [['flight','Flight'],['shopping','Shopping'],['hotel','Hotel'],['__proto__','Shopping']]) {
      await render(block({...concert,category})); expect(await page.locator('.card-category').textContent()).toContain(label);
    }
    await render(block({type:'products',items:[{name:'Sold-out concert',category:'concert',image:'https://source.example/missing.jpg'}]}));
    await page.waitForFunction(() => !document.querySelector('.card-media img'));
    expect(await page.locator('.card-image-fallback').textContent()).toContain('Image unavailable');
    await render(block({type:'summary',category:'flight',tone:'success',title:'Flight booked',image:'https://source.example/flight.jpg',facts:[{label:'Route',value:'CGK → DPS'}]}));
    expect(await page.locator('.card-category').textContent()).toContain('Flight');
    await render(block({...receipt,receiptUrl:null}));
    expect(await page.getByRole('link',{name:/Original receipt/}).count()).toBe(0);
    expect(await page.getByRole('link',{name:/View source/}).getAttribute('href')).toBe(receipt.url);
    await render(block(products));
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(() => {
        const box = document.querySelector('.sidebar').getBoundingClientRect();
        return innerWidth <= 760 ? box.right <= 0 : box.left >= 0;
      });
      expect(await page.locator('#view').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      for (const card of await page.locator('.product-card').all()) {
        const box = await card.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      if (width === 320 || width === 1440) await page.screenshot({ path: join(artifacts, `shopping-${width}.png`), fullPage: true });
    }
    for (const [tone, title] of [['success', 'Order confirmed'], ['info', 'Added to cart'], ['warning', 'Checkout needs you'], ['error', 'Purchase could not complete']]) {
      await render(block({ type: 'summary', tone, title, detail: 'Verified website status.', facts: [{ label: 'Total', value: 'Rp 2.549.000' }, { label: 'Order', value: 'SK-123' }] }));
      expect(await page.locator(`.answer-summary-${tone} strong`).first().textContent()).toBe(title);
      expect(await page.locator('dd').allTextContents()).toEqual(['Rp 2.549.000', 'SK-123']);
    }
    await render(block({ type: 'summary', tone: 'success', title: 'Order confirmed', detail: 'Your desk order is confirmed by Desk Studio.', facts: [{ label: 'Order reference', value: 'SK-123' }, { label: 'Subtotal', value: 'Rp 2.499.000' }, { label: 'Shipping', value: 'Rp 50.000' }, { label: 'Total paid', value: 'Rp 2.549.000' }, { label: 'Delivery estimate', value: '9–11 October' }] }));
    await page.screenshot({ path: join(artifacts, 'shopping-receipt.png'), fullPage: true });
    await render(block({ type: 'products', items: [], title: 'No matching products', detail: 'Nothing available within Rp 500.000.' }));
    expect(await page.locator('.answer-empty').textContent()).toContain('Nothing available within Rp 500.000.');
    await render(block({ type: 'products', title: null, items: [{ name: 'Desk with unknown price', price: null, seller: null, url: null }] }));
    expect(await page.locator('.product-card').count()).toBe(1);
    expect(await page.locator('.product-price').textContent()).toBe('Price unavailable');
    await render('| Product | Price | Seller | Shipping |\n| --- | --- | --- | --- |\n| [Desk](https://example.com/desk) | €199 | Oak shop | €10 |');
    expect(await page.locator('.product-card').count()).toBe(1);
    expect(await page.locator('.product-card').textContent()).toContain('Shipping');
    expect(await page.locator('.product-price').textContent()).toBe('€199');
    await render('| Topic | Price |\n| --- | --- |\n| Budget | $10 |');
    expect(await page.locator('table').count()).toBe(1);
    for (const text of ['Plain reply.', '## Research\n\n- First\n- Second\n\n```js\nconst x = 1;\n```', '```odwyn\n{"type":"products","items":[', block({ type: 'unknown', title: 'Keep this' }), block({ type: 'products', items: [{ name: 123, price: '$5' }] }), block({ type: 'summary', title: 'Invalid', facts: [null] })]) {
      await render(text); expect(await page.locator('#view').textContent()).not.toBe(''); expect(await page.locator('.product-card,.answer-summary').count()).toBe(0);
    }
    await render(block({ type: 'products', items: [{ name: '<img src=x onerror=alert(1)>', price: '<script>alert(1)</script>', url: 'javascript:alert(1)', detail: '<svg onload=alert(1)>' }] }) + '\n\n' + block({ type: 'summary', title: '<img src=x>', tone: 'evil', facts: [{ label: '<iframe>', value: '<script>' }] }));
    expect(await page.locator('#view img,#view script,#view iframe,#view [onerror],#view [onload],#view a').count()).toBe(0);
    for (const image of ['javascript:alert(1)','data:image/svg+xml,<svg onload=alert(1)>','file:///etc/passwd','https://user:secret@example.com/photo.png']) {
      await render(block({type:'products',items:[{name:'Unsafe image',image}]})); expect(await page.locator('#view img').count()).toBe(0);
    }
    await render(block({ type: 'products', items: [{ name: '<img src=x onerror=alert(1)>', price: '<script>alert(1)</script>', url: 'javascript:alert(1)', detail: '<svg onload=alert(1)>' }] }));
    expect(await page.locator('.product-card').textContent()).toContain('<img src=x onerror=alert(1)>');
    expect(await page.evaluate(async text => {
      const { insertMessages } = await import('/views.js');
      const { defaults } = await import('/profile.js');
      document.querySelector('#view').innerHTML = '<div id="messages"></div>';
      insertMessages({ customization: defaults, agents: [], jobs: [], conversations: [{ id: 'test', messages: [{ id: 'user', role: 'user', text, at: new Date().toISOString() }, { id: 'assistant', role: 'assistant', text, at: new Date().toISOString() }] }] }, 'test');
      return [document.querySelectorAll('.message-user .product-card').length, document.querySelectorAll('.message-assistant .product-card').length];
    }, block(products))).toEqual([0, 3]);
    const command = "printf '<script>unsafe</script>'\n# preserve line breaks";
    expect(await page.evaluate(async command => {
      const { renderChat } = await import('/views.js');
      const { defaults } = await import('/profile.js');
      const job = { id:'terminal', conversationId:'terminal-chat', status:'waiting', events:[], files:[], pending:{id:'approval',type:'terminal',title:'Run terminal command?',detail:'Check terminal',target:'/workspace',preview:command} };
      document.querySelector('#view').innerHTML = renderChat({customization:defaults,agents:[],jobs:[job],runtime:{activeJobId:job.id},conversations:[{id:'terminal-chat',createdAt:new Date().toISOString(),messages:[]}]},'terminal-chat');
      const code = document.querySelector('.approval-preview code');
      return [code.textContent, getComputedStyle(code).whiteSpace, document.querySelectorAll('.approval-card script').length, [...document.querySelectorAll('.approval-card [data-decision]')].map(button=>button.dataset.decision)];
    }, command)).toEqual([command, 'pre-wrap', 0, ['allow','deny','allow-run']]);
    expect(await page.evaluate(async () => {
      const { insertMessages } = await import('/views.js');
      const { defaults } = await import('/profile.js');
      const at = new Date().toISOString();
      document.querySelector('#view').innerHTML = '<div id="messages"></div>';
      insertMessages({customization:defaults,agents:[{id:'lead',customization:{...defaults,name:'Coordinator'}},{id:'reviewer',customization:{...defaults,name:'Reviewer'}}],files:[{id:'report-file',name:'review.csv',mimeType:'text/csv'}],jobs:[{id:'review-job',files:['report-file']}],conversations:[{id:'agreed-room',messages:[{id:'review',role:'assistant',agentId:'reviewer',jobId:'review-job',at,text:'Checked results.'},{id:'agreed',role:'assistant',agentId:'lead',jobId:'review-job',roomReport:true,at,text:'Agreed result: fix totals.'}]}]},'agreed-room');
      const replies = [...document.querySelectorAll('.message-assistant')];
      return replies.map(node=>[node.querySelector('.message-meta strong').textContent,node.querySelectorAll('.answer-file').length]);
    })).toEqual([['Reviewer',1],['Coordinator',0]]);
    expect(await page.evaluate(async () => {
      const { insertMessages } = await import('/views.js');
      const { defaults } = await import('/profile.js');
      const at = new Date().toISOString();
      for (const kind of ['room','chat']) {
        document.querySelector('#view').innerHTML = '<div id="messages"></div>';
        insertMessages({customization:defaults,agents:[],files:[{id:'file',name:'result.csv'}],jobs:[{id:'file-job',files:['file']}],conversations:[{id:'test',kind,messages:[{id:'empty',role:'assistant',text:'',at},{id:'space',role:'assistant',text:' \n\t',at},{id:'missing',role:'assistant',at},{id:'useful',role:'assistant',text:'Real finding.',at},{id:'attachment',role:'assistant',text:'',jobId:'file-job',at}]}]},'test');
        if (document.querySelectorAll('.message').length !== 2 || document.querySelectorAll('.answer-file').length !== 1 || !document.querySelector('.message').textContent.includes('Real finding.')) return false;
      }
      return true;
    })).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser.close(); server.stop(true); await app.close(); rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
