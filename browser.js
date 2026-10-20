import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startProxy } from './proxy.js';
import { validateAction, resolvePublic } from './security.js';

export class Browser {
  constructor({ directory, onFile = () => {}, findFile = () => null, executablePath, headless = true, proxyOptions, contextOptions, onContext }) {
    this.proxyOptions=proxyOptions;this.contextOptions=contextOptions;this.onContext=onContext;
    this.directory = directory; this.onFile = onFile; this.findFile = findFile;
    this.executablePath = executablePath; this.headless = headless;
    this.context = null; this.page = null; this.proxy = null; this.tail = Promise.resolve(); this.owner = null; this.dialog = null; this.generation = 0;
    this.openers = new WeakMap(); this.crashed = new WeakSet();
  }

  serial(fn, timeout = 45_000) {
    const next = this.tail.then(async () => {
      if (this.stopping) throw new Error('Browser is stopping.');
      let timer, interrupted = false;
      const cancelled = new Promise((_, reject) => {
        this.abort = error => { interrupted = true; this.generation++; reject(error); };
        timer = setTimeout(() => this.abort(new Error('Browser operation timed out. Retry with a fresh page.')), timeout);
      });
      try { return await Promise.race([fn(), cancelled]); }
      catch (error) {
        // Close before releasing the queue so interrupted work cannot change the next task's browser.
        if (interrupted) {
          const context = this.context || await this.launching?.catch(() => null);
          await context?.close().catch(() => {});
        }
        throw error;
      } finally { clearTimeout(timer); this.abort = null; }
    });
    this.tail = next.catch(() => {}); return next;
  }

  interrupt() { this.abort?.(new Error('Browser operation interrupted.')); return this.tail; }

  async start() {
    if (this.context) {
      if(!this.page||this.page.isClosed()||this.crashed.has(this.page))this.page=this.context.pages().find(page=>!page.isClosed()&&!this.crashed.has(page))||await this.context.newPage();
      return;
    }
    mkdirSync(join(this.directory, 'browser'), { recursive: true, mode: 0o700 });
    mkdirSync(join(this.directory, 'files'), { recursive: true, mode: 0o700 });
    const generation = this.generation, proxy = await startProxy(this.proxyOptions);
    if (generation !== this.generation) { proxy.close(); throw new Error('Browser operation interrupted.'); }
    this.proxy = proxy;
    try {
      const launching = chromium.launchPersistentContext(join(this.directory, 'browser'), {
        headless: this.headless, executablePath: this.executablePath, viewport: { width: 1280, height: 800 },
        acceptDownloads: true, serviceWorkers: 'block', proxy: { server: proxy.url },
        args: ['--proxy-bypass-list=<-loopback>', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
        ...this.contextOptions,
      });
      this.launching = launching;
      const context = await launching;
      if (generation !== this.generation) { await context.close(); throw new Error('Browser operation interrupted.'); }
      this.context = context;
      await this.onContext?.(context);
      this.context.setDefaultTimeout(12_000);
      this.context.setDefaultNavigationTimeout(30_000);
      this.context.on('page', page => { this.attach(page); this.page = page; });
      this.context.on('close', () => { if (this.context !== context) return; this.context = null; this.page = null; this.dialog = null; this.last = null; proxy.close(); this.proxy = null; });
      for (const page of this.context.pages()) this.attach(page);
      this.page = this.context.pages()[0] || await this.context.newPage();
    } catch (error) { proxy.close(); if (this.proxy === proxy) this.proxy = null; throw error; }
    finally { this.launching = null; }
  }

  attach(page) {
    page.on('popup', popup => this.openers.set(popup, page));
    page.on('dialog', dialog => { this.dialog = dialog; this.page = page; });
    page.on('download', async download => {
      const owner = this.owner;
      try {
        const id = randomUUID();
        const name = basename(download.suggestedFilename()).replace(/[\x00-\x1f]/g, '').slice(0, 180) || 'download';
        await download.saveAs(join(this.directory, 'files', id));
        this.onFile({ id, name, kind: 'download', jobId: owner, createdAt: new Date().toISOString() });
      } catch { /* Failed downloads are not reported as saved files. */ }
    });
    page.on('crash',()=>{
      this.crashed.add(page);
      if(this.page===page){this.page=this.context?.pages().find(other=>other!==page&&!other.isClosed()&&!this.crashed.has(other))||null;this.dialog=null;this.last=null;}
      void page.close().catch(()=>{});
    });
    page.on('close', () => {
      if (this.page !== page) return;
      const opener = this.openers.get(page);
      this.page = opener && !opener.isClosed() ? opener : this.context?.pages().find(other => other !== page && !other.isClosed()) || null;
      this.dialog = null; this.last = null;
    });
  }

  async readyPage() {
    const page = this.page, context = this.context;
    if (!page || this.dialog || !this.openers.has(page)) return page;
    try {
      if (page.url() === 'about:blank') {
        try { await page.waitForURL(url => url.href !== 'about:blank', {waitUntil:'domcontentloaded', timeout:2000}); }
        catch (error) { if (error.name !== 'TimeoutError' || page.isClosed() || page.url() !== 'about:blank') throw error; }
      }
      if (page.url() !== 'about:blank') await page.waitForLoadState('domcontentloaded', {timeout:12_000});
      return page;
    } catch (error) {
      if (page.isClosed() && this.context === context && this.page && this.page !== page) return this.readyPage();
      throw error;
    }
  }

  async snapshot(includeImage = false, retried = false) {
    const page = await this.readyPage();
    if (this.dialog) return { url: this.page.url(), text: `Browser dialog: ${this.dialog.message()}. Use dialog action to accept or dismiss.`, elements: [], tabs: [] };
    const context = this.context;
    try {
      const result = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]')]
          .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').slice(0, 240);
        document.querySelectorAll('[data-odwyn-ref]').forEach(el => el.removeAttribute('data-odwyn-ref'));
        const images = [...document.images].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
          .map(el => ({ url:el.currentSrc || el.src, alt:(el.alt || el.title || '').slice(0,180) }));
        for (const meta of document.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"]')) {
          try { images.push({url:new URL(meta.content,location.href).href,alt:document.title}); } catch { /* Invalid page metadata. */ }
        }
        return {
          text: (document.body?.innerText || '').slice(0, 16_000),
          images:images.filter((image,index) => /^https?:\/\//i.test(image.url) && images.findIndex(other=>other.url===image.url) === index).slice(0,24),
          elements: controls.map((el, i) => {
            el.setAttribute('data-odwyn-ref', String(i));
            const label = el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('placeholder') || el.innerText || el.getAttribute('title') || el.getAttribute('name') || el.tagName.toLowerCase();
            return { ref: String(i), tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || null, label: label.trim().slice(0, 180), href: el.tagName === 'A' ? el.href : undefined, options: el.tagName === 'SELECT' ? [...el.options].map(o => ({ value: o.value, label: o.text })) : undefined };
          }),
        };
      });
      result.url = page.url(); result.title = await page.title();
      result.loading = this.openers.has(page) && result.url === 'about:blank';
      if (result.loading) result.text = 'Popup is waiting for its website to open. Read again after navigation; if it stays blank, ask the owner to take browser control.';
      // Reading a background popup's title can block on its navigation or dialog.
      result.tabs = this.context.pages().map((p, index) => ({ index, url: p.url(), title: p === page ? result.title : this.last?.tabs?.find(tab => tab.url === p.url())?.title || '', active: p === page }));
      result.viewport = { width: 1280, height: 800 };
      this.last = result;
      const empty=!result.text.trim()&&!result.elements.length;
      if(empty&&!result.loading)result.text=result.url==='about:blank'?'Browser is on a blank page. Navigate to the requested website.':'This page has no readable text or controls yet. Inspect the screenshot, or wait and read again.';
      if(includeImage||(empty&&result.url!=='about:blank'&&!result.loading)){
        try{result.image=(await page.screenshot({type:'jpeg',quality:70,timeout:5000})).toString('base64');}
        catch(error){if(includeImage)throw error;result.previewError='Screenshot temporarily unavailable; wait and read again.';}
      }
      return result;
    } catch (error) {
      if(!retried&&this.context===context){
        if(page.isClosed()&&this.page&&this.page!==page)return this.snapshot(includeImage,true);
        if(!page.isClosed()&&/Execution context was destroyed|Cannot find context with specified id|most likely because of a navigation/i.test(error.message)){
          await page.waitForLoadState('domcontentloaded',{timeout:12000});return this.snapshot(includeImage,true);
        }
      }
      throw error;
    }
  }

  inspectAction(action) {
    return this.serial(async () => {
      if (!this.page || this.page.isClosed()) return {};
      const page = await this.readyPage();
      if (this.dialog) return {url:this.page.url(),dialog:{type:this.dialog.type(),message:this.dialog.message()}};
      return page.evaluate(({ref,keyboard,x,y}) => {
        const hit = Number.isFinite(x) && Number.isFinite(y) ? document.elementFromPoint(x,y) : null;
        const el = ref !== null ? document.querySelector(`[data-odwyn-ref="${ref}"]`) : keyboard ? document.activeElement : hit?.closest('button,a,input,select,textarea,label,[role="button"],[role="option"],[role="link"],[onclick]') || hit;
        return { url:location.href, hasPaymentFields:[...document.querySelectorAll('[autocomplete^="cc-"]')].some(field=>field.getClientRects().length && getComputedStyle(field).visibility !== 'hidden'), element:el && el !== document.body && el !== document.documentElement && el.tagName !== 'IFRAME' && !el.shadowRoot ? {
          tag:el.tagName.toLowerCase(), type:el.getAttribute('type'), href:el.tagName === 'A' ? el.href : undefined,
          label:(el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('placeholder') || el.innerText || el.getAttribute('title') || el.getAttribute('name') || '').trim().slice(0,180),
          autocomplete:el.getAttribute('autocomplete') || '', context:(el.closest('form')?.innerText || '').slice(0,4000),
        } : null };
      }, {ref:action.ref === undefined ? null : String(action.ref),keyboard:['press','type'].includes(action.action),...(action.action === 'click' ? {x:action.x,y:action.y} : {})});
    });
  }

  async untilDialog(page, fn) {
    const context = this.context, generation = this.generation;
    let listener;
    const dialog = new Promise(resolve => { listener = () => resolve(); page.once('dialog',listener); });
    try { await Promise.race([fn(),dialog]); }
    catch (error) {
      // A login popup can close itself after a successful click or keypress.
      if (!error.message.includes('Target page, context or browser has been closed') || !page.isClosed() || !this.openers.has(page) || this.context !== context || this.generation !== generation || this.page !== this.openers.get(page) || this.page.isClosed()) throw error;
    } finally { page.off('dialog',listener); }
  }

  action(input, allowed = () => true) {
    const command = validateAction(input);
    return this.serial(async () => {
      const generation = this.generation;
      if (!allowed()) throw new Error('Browser control changed.');
      await this.start();
      if (generation !== this.generation || !allowed()) throw new Error('Browser control changed.');
      if (!this.page || this.page.isClosed()) this.page = await this.context.newPage();
      if (this.dialog && command.action !== 'dialog') return this.snapshot();
      const page = this.page;
      const element = command.ref !== undefined ? page.locator(`[data-odwyn-ref="${command.ref}"]`) : null;
      if (['navigate','new_tab'].includes(command.action)) await resolvePublic(command.url);
      if (generation !== this.generation || !allowed()) throw new Error('Browser control changed.');
      const execute = async () => { switch (command.action) {
        case 'navigate': await page.goto(command.url, { waitUntil: 'domcontentloaded' }); break;
        case 'new_tab': this.page = await this.context.newPage(); await this.page.goto(command.url, { waitUntil: 'domcontentloaded' }); break;
        case 'tab': { const tab = this.context.pages()[command.index]; if (!tab) throw new Error('Tab not found.'); this.page = tab; break; }
        case 'close_tab': await page.close(); if (!this.page) this.page = await this.context.newPage(); break;
        case 'back': await page.goBack({ waitUntil: 'domcontentloaded' }); break;
        case 'click': if (element) await element.click(); else await page.mouse.click(command.x, command.y); break;
        case 'fill': await element.fill(command.text); break;
        case 'type': if (element) await element.focus(); await page.keyboard.insertText(command.text); break;
        case 'select': await element.selectOption(command.text); break;
        case 'press': if (element) await element.press(command.text); else await page.keyboard.press(command.text); break;
        case 'scroll': await page.mouse.wheel(0, command.delta); break;
        case 'wait': await page.waitForTimeout(command.ms); break;
        case 'upload': { const file = this.findFile(command.fileId); if (!file || file.kind !== 'upload') throw new Error('Uploaded file not found.'); await element.setInputFiles(join(this.directory, 'files', file.id)); break; }
        case 'dialog': { if (!this.dialog) throw new Error('No browser dialog is open.'); const dialog = this.dialog; this.dialog = null; if (command.choice === 'accept') await dialog.accept(command.text || ''); else await dialog.dismiss(); break; }
        case 'save_screenshot': {
          const id = randomUUID();
          await page.screenshot({ path: join(this.directory, 'files', id), type: 'png', fullPage: true });
          this.onFile({ id, name: 'browser-screenshot.png', kind: 'screenshot', jobId: this.owner, createdAt: new Date().toISOString() });
          break;
        }
      } };
      if (['click','press','fill','type','navigate','back','select'].includes(command.action)) await this.untilDialog(page,execute);
      else await execute();
      return this.snapshot(command.action === 'screenshot');
    });
  }

  frame() {
    if(this.framing)return this.framing;
    const page=this.page,context=this.context,owner=this.owner,generation=this.generation;
    if(!context||!page||page.isClosed()||this.crashed.has(page))return Promise.resolve(null);
    const url=page.url(),viewport=page.viewportSize?.()||{width:1280,height:800};
    const current=()=>this.context===context&&this.page===page&&this.owner===owner&&this.generation===generation&&!page.isClosed()&&page.url()===url;
    const metadata=()=>({jobId:owner,url,loading:this.openers.has(page)&&url==='about:blank',title:this.last?.url===url?this.last.title||'':'',...viewport,tabs:context.pages().map((tab,index)=>({index,url:tab.url(),active:tab===page}))});
    const dialog=()=>({...metadata(),dialog:this.dialog.message()});
    const capture=async()=>{
      if(this.dialog)return dialog();
      try{
        // Preview is observational: never queue it behind actions or reset a session on failure.
        const image=await page.screenshot({type:'jpeg',quality:65,timeout:2500});
        if(!current())return null;
        const frame={...metadata(),image:image.toString('base64')};this.preview={page,context,owner,frame};return frame;
      }catch{
        if(!current())return null;
        if(this.dialog)return dialog();
        const cached=this.preview;
        return {...(cached?.page===page&&cached.context===context&&cached.owner===owner&&cached.frame.url===url?cached.frame:{}),...metadata(),error:'Preview temporarily unavailable. Retrying…'};
      }
    };
    this.framing=capture().finally(()=>{this.framing=null;});return this.framing;
  }

  reset() {
    return this.serial(async () => {
      try { await this.context?.close(); }
      finally { this.proxy?.close(); this.proxy = null; this.context = null; this.page = null; this.dialog = null; this.last = null; }
    });
  }

  async close() { this.stopping = true; await this.interrupt(); await this.context?.close(); this.proxy?.close(); }
}
