import { resolve, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { authorize, allowedOrigin, textInput } from './security.js';
import { openStore } from './store.js';
import { Codex } from './codex.js';
import { Browser } from './browser.js';
import { Runtime } from './runtime.js';
import { validateProfile } from './public/profile.js';

const root = import.meta.dir;
const headers = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

export function createApp(options = {}) {
  const directory = resolve(options.directory || process.env.SIDEKICK_DATA_DIR || join(root, 'data'));
  const user = options.user || process.env.SIDEKICK_USER;
  const password = options.password || process.env.SIDEKICK_PASSWORD;
  if (!user || !password || password.length < 16) throw new Error('Set SIDEKICK_USER and a SIDEKICK_PASSWORD of at least 16 characters. Run bun run setup.');
  const origin = options.origin || process.env.SIDEKICK_ORIGIN || `http://127.0.0.1:${process.env.PORT || 4317}`;
  const store = openStore(directory);
  const workspace = join(directory, 'workspace');
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  const codex = options.codex || new Codex({ home: resolve(process.env.SIDEKICK_CODEX_HOME || join(directory, 'codex')), workspace });
  let runtime;
  const browser = options.browser || new Browser({ directory, executablePath: process.env.SIDEKICK_BROWSER_EXECUTABLE || undefined, headless: process.env.SIDEKICK_HEADLESS !== 'false',
    findFile: id => store.state.files.find(file => file.id === id),
    onFile: file => { store.state.files.push(file); const job = store.state.jobs.find(job => job.id === file.jobId); if (job) job.files.push(file.id); runtime.changed(); },
  });
  runtime = new Runtime({ store, codex, browser, workspace, model: process.env.SIDEKICK_MODEL || 'gpt-6.1-sol' });
  let login = null;
  const limits = new Map();
  const response = (body, status = 200, extra = {}) => Response.json(body, { status, headers: { ...headers, ...extra } });

  function rateLimited(key, max) {
    const now = Date.now(); let entry = limits.get(key);
    if (!entry || entry.until < now) { entry = { count: 0, until: now + 60_000 }; limits.set(key, entry); }
    // One owner behind a tunnel; cap accounting keys to avoid unbounded unauthenticated state.
    if (limits.size > 1000) for (const [key, value] of limits) if (value.until < now) limits.delete(key);
    if (limits.size > 1000) limits.clear();
    return ++entry.count > max;
  }

  async function json(req) {
    if (!req.headers.get('content-type')?.startsWith('application/json')) throw new Error('Use JSON for this request.');
    const body = await req.text();
    if (body.length > 30_000) throw new Error('Request is too large.');
    try { const value = JSON.parse(body); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
    catch { throw new Error('Invalid JSON request.'); }
  }

  const app = {
    runtime, browser, codex,
    async fetch(req, server) {
      const url = new URL(req.url); const pathname = url.pathname;
      if (!authorize(req.headers.get('authorization'), user, password)) {
        if (rateLimited(`auth:${server?.requestIP(req)?.address || 'local'}`, 20)) return response({ error: 'Too many sign-in attempts. Try again in one minute.' }, 429);
        return response({ error: 'Authentication required.' }, 401, { 'www-authenticate': 'Basic realm="Sidekick", charset="UTF-8"' });
      }
      if (!['GET','HEAD'].includes(req.method)) {
        if (!allowedOrigin(req.headers.get('origin'), origin) || req.headers.get('sec-fetch-site') === 'cross-site') return response({ error: 'Request origin rejected. Set SIDEKICK_ORIGIN to your tunnel HTTPS URL.' }, 403);
        if (rateLimited('writes', 120)) return response({ error: 'Too many requests. Try again shortly.' }, 429);
      }
      try {
        if (pathname === '/api/state' && req.method === 'GET') {
          if (url.searchParams.get('revision') === String(runtime.revision)) return new Response(null, { status: 204, headers });
          // ponytail: a JSON state row suits one owner; use indexed tables when history gets large.
          return response({ revision: runtime.revision, ...store.state, runtime: { account: runtime.account, connectionError: runtime.connectionError, model: runtime.model, activeJobId: runtime.active?.id || null, takeover: runtime.takeover, browserOpen: !!browser.context, rateLimits: runtime.rateLimits || null, login } });
        }
        if (pathname === '/api/jobs' && req.method === 'POST') return response(runtime.submit(await json(req)), 201);
        const jobAction = pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})\/(answer|cancel|retry)$/);
        if (jobAction && req.method === 'POST') {
          const [, id, action] = jobAction;
          if (action === 'answer') { runtime.answer(id, await json(req)); return response({ ok: true }); }
          if (action === 'cancel') { await runtime.cancel(id); return response({ ok: true }); }
          return response(runtime.retry(id), 201);
        }
        if (pathname === '/api/schedules' && req.method === 'POST') return response(runtime.schedule(await json(req)), 201);
        const scheduleMatch = pathname.match(/^\/api\/schedules\/([a-f0-9-]{36})$/);
        if (scheduleMatch && ['PATCH','DELETE'].includes(req.method)) {
          const index = store.state.schedules.findIndex(s => s.id === scheduleMatch[1]);
          if (index < 0) return response({ error: 'Schedule not found.' }, 404);
          if (req.method === 'DELETE') store.state.schedules.splice(index, 1);
          else { const input = await json(req); if (typeof input.enabled !== 'boolean') throw new Error('Choose enabled or paused.'); store.state.schedules[index].enabled = input.enabled; }
          runtime.changed(); return response({ ok: true });
        }
        if (pathname === '/api/customization' && req.method === 'PUT') {
          store.state.customization = validateProfile(await json(req));
          runtime.changed(); return response(store.state.customization);
        }
        if (pathname === '/api/preferences' && req.method === 'PUT') {
          const input = await json(req); if (typeof input.text !== 'string' || input.text.length > 8000) throw new Error('Memory must be at most 8,000 characters.');
          store.state.preferences = input.text.trim(); runtime.changed(); return response({ ok: true });
        }
        if (pathname === '/api/account/refresh' && req.method === 'POST') { await runtime.refreshAccount(); return response({ ok: true }); }
        if (pathname === '/api/account/login' && req.method === 'POST') {
          if (runtime.active) throw new Error('Stop the active task before changing your Codex sign-in.');
          if (login?.loginId) await codex.request('account/login/cancel', { loginId: login.loginId }).catch(() => {});
          login = await codex.request('account/login/start', { type: 'chatgptDeviceCode' }); runtime.changed();
          return response(login);
        }
        if (pathname === '/api/browser/frame' && req.method === 'GET') return response(await browser.frame());
        if (pathname === '/api/browser/takeover' && req.method === 'POST') {
          const { enabled } = await json(req); if (typeof enabled !== 'boolean') throw new Error('Choose browser control mode.');
          await runtime.setTakeover(enabled);
          if (enabled) { try { await browser.serial(() => browser.start()); runtime.changed(); } catch (error) { await runtime.setTakeover(false); throw error; } }
          return response({ ok: true });
        }
        if (pathname === '/api/browser/action' && req.method === 'POST') {
          if (!runtime.takeover) return response({ error: 'Take browser control first.' }, 409);
          const input = await json(req);
          const result = await browser.action(input, () => runtime.takeover);
          runtime.changed(); return response({ ok: true, url: result.url });
        }
        if (pathname === '/api/files' && req.method === 'POST') {
          const form = await req.formData(); const file = form.get('file');
          if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024) throw new Error('Choose a file up to 20 MB.');
          const id = randomUUID(); const name = file.name.replace(/[\x00-\x1f\/\\]/g, '_').slice(0, 180) || 'upload';
          mkdirSync(join(directory, 'files'), { recursive: true, mode: 0o700 });
          writeFileSync(join(directory, 'files', id), Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
          const saved = { id, name, kind: 'upload', createdAt: new Date().toISOString() }; store.state.files.push(saved); runtime.changed(); return response(saved, 201);
        }
        const fileMatch = pathname.match(/^\/api\/files\/([a-f0-9-]{36})$/);
        if (fileMatch && req.method === 'GET') {
          const file = store.state.files.find(file => file.id === fileMatch[1]);
          if (!file) return response({ error: 'File not found.' }, 404);
          const local = Bun.file(join(directory, 'files', file.id));
          if (!await local.exists()) return response({ error: 'File no longer exists.' }, 404);
          return new Response(local, { headers: { ...headers, 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}` } });
        }
        if (pathname.startsWith('/api/')) return response({ error: 'Endpoint not found.' }, 404);
        if (!['GET','HEAD'].includes(req.method)) return response({ error: 'Method not allowed.' }, 405);
        const files = { '/': 'index.html', '/app.js': 'app.js', '/ui.js': 'ui.js', '/profile.js': 'profile.js', '/customize.js': 'customize.js', '/views.js': 'views.js', '/browser-ui.js': 'browser-ui.js', '/style.css': 'style.css', '/mark.svg': 'mark.svg', '/vendor/marked.js': '../node_modules/marked/lib/marked.esm.js' };
        if (!files[pathname]) return response({ error: 'Not found.' }, 404);
        return new Response(Bun.file(join(root, 'public', files[pathname])), { headers });
      } catch (error) { return response({ error: error.message || 'Something went wrong. Try again.' }, 400); }
    },
    async close() { clearInterval(accountTimer); runtime.close(); codex.stop(); await browser.close(); store.close(); },
  };
  codex.on('notification', ({ method, params }) => {
    if (method === 'account/login/completed') { login = params.success ? null : { error: params.error || 'Sign-in failed. Try again.' }; runtime.changed(); }
  });
  const accountTimer = setInterval(() => { void runtime.refreshAccount(); }, 30_000); accountTimer.unref();
  void runtime.refreshAccount();
  return app;
}

if (import.meta.main) {
  const app = createApp();
  const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT || 4317), maxRequestBodySize: 21 * 1024 * 1024, idleTimeout: 120, fetch: app.fetch });
  console.log(`Sidekick: http://127.0.0.1:${server.port}`);
  let stopping = false;
  const shutdown = async () => { if (stopping) return; stopping = true; server.stop(true); await app.close(); process.exit(0); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
