import { test, expect } from 'bun:test';
import { fetchImage } from '../proxy.js';

test('source images pin resolved hosts, validate redirects and content, and bound downloads', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64');
  let host, cookie, authorization;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/redirect') return new Response(null, { status: 302, headers: { location: '/image' } });
    if (path === '/private') return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    if (path === '/loop') return new Response(null, { status: 302, headers: { location: '/loop' } });
    if (path === '/svg') return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
    if (path === '/html') return new Response('<script>alert(1)</script>', { headers: { 'content-type': 'text/html' } });
    if (path === '/big') return new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } });
    if (path === '/missing') return new Response('Not found', { status: 404 });
    host = req.headers.get('host'); cookie = req.headers.get('cookie'); authorization = req.headers.get('authorization');
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  } });
  const origin = `http://images.test:${server.port}`;
  const resolve = async raw => {
    const url = new URL(raw);
    if (url.hostname !== 'images.test') throw new Error('Private destination blocked');
    return { url, address: '127.0.0.1', family: 4 };
  };
  try {
    const image = await fetchImage(origin + '/redirect', resolve);
    expect(image.type).toBe('image/png'); expect(image.body.equals(png)).toBe(true);
    expect(host).toBe(`images.test:${server.port}`); expect(cookie).toBeNull(); expect(authorization).toBeNull();
    for (const path of ['/private', '/loop', '/svg', '/html', '/big', '/missing']) await expect(fetchImage(origin + path, resolve)).rejects.toThrow();
    for (const url of ['http://127.0.0.1/image', 'http://169.254.169.254/image', 'http://[::1]/image', 'file:///etc/passwd', 'https://user:secret@example.com/image']) await expect(fetchImage(url)).rejects.toThrow();
  } finally { await server.stop(); }
}, 20_000);
