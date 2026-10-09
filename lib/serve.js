import http from 'node:http';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { safePath, exists } from './common.js';
import { prepareProject } from './project.js';
import { inspectTailnet, directAddresses, authority, serveConfig, assertFree, createMapping, stopMapping, instanceToken, verifyEndpoint } from './tailnet.js';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.mp4': 'video/mp4', '.png': 'image/png' };
function canonicalHost(value) {
  if (typeof value !== 'string' || /[\s\\/?#@,]/.test(value)) return null;
  try { const u = new URL(`http://${value}`); return u.host; } catch { return null; }
}
// Callers supply only concrete authorities derived from the actual listeners and
// verified Tailscale self identity. No configurable wildcard or forwarded trust.
export async function createOutputServer(root, policy) {
  const publicRoot = await safePath(await fs.realpath(root), 'public');
  return http.createServer(async (req, res) => {
    const end = (status, headers = {}) => { res.writeHead(status, headers); res.end(); };
    if (!['GET', 'HEAD'].includes(req.method)) return end(405, { Allow: 'GET, HEAD' });
    const host = canonicalHost(req.headers.host);
    if (!host || !policy.hosts.has(host)) return end(403);
    if (req.headers.origin !== undefined && !policy.origins.has(req.headers.origin)) return end(403);
    let handle;
    try {
      let raw = req.url.split('?')[0];
      if (policy.proxyPrefix && (raw === policy.proxyPrefix || raw.startsWith(policy.proxyPrefix + '/'))) raw = raw.slice(policy.proxyPrefix.length) || '/';
      let rel = decodeURIComponent(raw);
      if (rel === '/') rel = '/index.html';
      if (!/^\/(index\.html|theme\.(css|js)|data\.json|media\/v\d{3,}\/(render\.mp4|web\.mp4|reference-web\.mp4|comparison\.mp4|packet\/pair-\d{3}\.png))$/.test(rel)) return end(404);
      const p = await safePath(publicRoot, rel.slice(1));
      const real = await fs.realpath(p);
      if (!real.startsWith(publicRoot + path.sep)) return end(404);
      handle = await fs.open(p, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (process.platform === 'linux' && !(await fs.realpath(`/proc/self/fd/${handle.fd}`)).startsWith(publicRoot + path.sep)) { await handle.close(); return end(404); }
      if (!stat.isFile()) { await handle.close(); return end(404); }
      const headers = { 'Content-Type': types[path.extname(p)], 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'" };
      if (policy.token) headers['X-Demo-Workbench-Instance'] = policy.token;
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
}
async function listen(server, port, host) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
}
async function close(server) {
  if (!server.listening) return;
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
export async function serve(root, port = 4173, options = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be 0–65535');
  const tailPort = options.tailnetPort ?? port;
  const mode = options.tailnetMode || 'auto';
  if (!['auto', 'direct', 'serve'].includes(mode)) throw new Error('--tailnet-mode must be auto, direct or serve');
  if (!options.tailnet && (options.tailnetMode || options.tailnetPort !== undefined || options.tailscale)) throw new Error('Tailnet options require --tailnet.');
  if (options.tailnet && (!port || !Number.isInteger(tailPort) || tailPort < 1 || tailPort > 65535)) throw new Error('Tailnet mode requires explicit local/tailnet ports from 1 to 65535.');
  root = await fs.realpath(root);
  await prepareProject(root);
  const info = options.tailnet ? await inspectTailnet(options.tailscale) : null;
  const addresses = info ? directAddresses(info) : [];
  const mapping = info && (mode === 'serve' || (mode === 'auto' && !addresses.length));
  if (info) {
    if (mode === 'direct' && !addresses.length) throw new Error('No verified self Tailscale address is assigned to this OS. Use --tailnet-mode serve (WSL supports Windows Tailscale).');
    if (await exists(await safePath(root, '.workbench/tailnet.json', { missing: true }))) throw new Error('A tailnet ownership record exists. Stop its running server, or inspect it and use serve --stop-tailnet before retrying.');
    assertFree(await serveConfig(info), tailPort, port);
  }
  const policy = { hosts: new Set(), origins: new Set(), token: info ? instanceToken() : null };
  function allow(host, p) {
    const url = new URL(`http://${authority(host, p)}`);
    policy.hosts.add(url.host); policy.origins.add(url.origin);
  }
  const server = await createOutputServer(root, policy);
  const servers = [server];
  let owned, closing;
  server.closeWorkbench = () => closing ||= (async () => {
    try { if (owned) await stopMapping(root, info, owned.token); }
    finally { await Promise.all(servers.map(close)); }
  })();
  try {
    await listen(server, port, '127.0.0.1');
    const localPort = server.address().port;
    allow('127.0.0.1', localPort); allow('localhost', localPort);
    if (info) {
      allow(info.hostname, tailPort);
      for (const ip of mapping ? info.ips : addresses) allow(ip, tailPort);
      if (mapping) {
        policy.proxyPrefix = `/__demo_workbench_${policy.token}`;
        await verifyEndpoint(`http://127.0.0.1:${localPort}/`, policy.token, info);
        owned = await createMapping(root, info, tailPort, localPort, policy.token);
      } else {
        for (const ip of addresses) {
          const tailServer = await createOutputServer(root, policy); servers.push(tailServer);
          await listen(tailServer, tailPort, ip);
        }
      }
      server.tailnetUrl = `http://${authority(info.hostname, tailPort)}/`;
      await verifyEndpoint(server.tailnetUrl, policy.token, info);
      console.log(`Tailnet gallery: ${server.tailnetUrl} (${mapping ? 'private Tailscale Serve' : 'verified Tailscale interface'}; same-machine route verified, not second-device verification)`);
    }
    console.log(`Gallery: http://127.0.0.1:${localPort} (public output only; Ctrl-C to stop${info ? ' and clean up the owned tailnet route' : ''})`);
    return server;
  } catch (e) {
    try { await server.closeWorkbench(); } catch (cleanup) { throw new Error(`${e.message}\nCleanup refused/failed: ${cleanup.message}. Keep .workbench/tailnet.json for safe explicit cleanup.`); }
    throw e;
  }
}
