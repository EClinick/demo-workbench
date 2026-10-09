import http from 'node:http';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { safePath } from './common.js';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mp4': 'video/mp4', '.png': 'image/png' };
export async function serve(root, port = 4173) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be 0–65535');
  const publicRoot = await safePath(await fs.realpath(root), 'public');
  const server = http.createServer(async (req, res) => {
    const end = (status, headers = {}) => { res.writeHead(status, headers); res.end(); };
    if (!['GET', 'HEAD'].includes(req.method)) return end(405, { Allow: 'GET, HEAD' });
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) return end(403);
    let handle;
    try {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/') rel = '/index.html';
      if (!/^\/(index\.html|theme\.(css|js)|data\.json|media\/v\d{3,}\/(render\.mp4|web\.mp4|reference-web\.mp4|comparison\.mp4|packet\/pair-\d{3}\.png))$/.test(rel)) return end(404);
      const p = await safePath(publicRoot, rel.slice(1));
      // Re-resolve confinement and use O_NOFOLLOW for final file symlink races.
      const real = await fs.realpath(p);
      if (!real.startsWith(publicRoot + path.sep)) return end(404);
      handle = await fs.open(p, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      // On Linux verify the opened descriptor too, closing ancestor-symlink races.
      if (process.platform === 'linux' && !(await fs.realpath(`/proc/self/fd/${handle.fd}`)).startsWith(publicRoot + path.sep)) { await handle.close(); return end(404); }
      if (!stat.isFile()) { await handle.close(); return end(404); }
      const headers = { 'Content-Type': types[path.extname(p)], 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'" };
      let start = 0, endByte = stat.size - 1, status = 200;
      if (req.headers.range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!m || (!m[1] && !m[2])) { await handle.close(); return end(416, { 'Content-Range': `bytes */${stat.size}` }); }
        if (!m[1]) start = Math.max(0, stat.size - Number(m[2]));
        else { start = Number(m[1]); if (m[2]) endByte = Math.min(Number(m[2]), endByte); }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endByte) || start > endByte || start >= stat.size || start < 0) { await handle.close(); return end(416, { 'Content-Range': `bytes */${stat.size}` }); }
        status = 206; headers['Content-Range'] = `bytes ${start}-${endByte}/${stat.size}`;
      }
      headers['Content-Length'] = Math.max(0, endByte - start + 1);
      res.writeHead(status, headers);
      if (req.method === 'HEAD' || !stat.size) { await handle.close(); return res.end(); }
      const stream = handle.createReadStream({ start, end: endByte, autoClose: true });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch {
      await handle?.close().catch(() => {});
      if (!res.headersSent) end(404); else res.destroy();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  console.log(`Gallery: http://127.0.0.1:${server.address().port} (public output only; Ctrl-C to stop)`);
  return server;
}
