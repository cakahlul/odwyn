import http from 'node:http';
import net from 'node:net';
import { resolvePublic } from './security.js';

// Resolve once, connect to that IP. Browser DNS cannot rebind into the VPS network.
export async function startProxy() {
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    try {
      const { url, address, family } = await resolvePublic(req.url);
      if (url.protocol !== 'http:') throw new Error('HTTPS requires CONNECT.');
      const headers = { ...req.headers, host: url.host };
      delete headers['proxy-authorization']; delete headers['proxy-connection'];
      const upstream = http.request({ host: address, family, port: Number(url.port || 80), path: url.pathname + url.search, method: req.method, headers, timeout: 30_000 }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Website unavailable.'); });
      upstream.on('timeout', () => upstream.destroy());
      res.on('close', () => upstream.destroy());
      req.pipe(upstream);
    } catch { res.writeHead(403); res.end('Destination blocked.'); }
  });
  server.on('connect', async (req, socket, head) => {
    try {
      const { url, address, family } = await resolvePublic(`https://${req.url}`);
      const upstream = net.connect({ host: address, family, port: Number(url.port || 443) });
      sockets.add(upstream);
      upstream.setTimeout(120_000, () => upstream.destroy());
      upstream.once('connect', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(socket); socket.pipe(upstream);
      });
      upstream.on('error', () => socket.destroy());
      upstream.on('close', () => { sockets.delete(upstream); socket.destroy(); });
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => upstream.destroy());
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => { for (const socket of sockets) socket.destroy(); server.close(); } };
}
