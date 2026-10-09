import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { safePath, save, json, exists } from './common.js';

const exec = promisify(execFile);
const windowsTailscale = '/mnt/c/Program Files/Tailscale/tailscale.exe';
const windowsCurl = '/mnt/c/Windows/System32/curl.exe';
export async function ts(command, args) {
  try { return (await exec(command, args, { timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true })).stdout; }
  catch (e) { throw new Error(`Tailscale command failed (${command} ${args.join(' ')}): ${e.stderr || e.message}. No login, installation or network repair is automatic.`); }
}
export async function findTailscale(explicit) {
  if (explicit) return explicit;
  // Prefer the current OS's client. WSL may have no Linux Tailscale installation.
  const name = process.platform === 'win32' ? 'tailscale.exe' : 'tailscale';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, name);
    try { await fs.access(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  if (process.platform === 'linux' && await exists(windowsTailscale)) return windowsTailscale;
  throw new Error('Tailscale CLI missing. Install/authenticate it yourself, or pass --tailscale /absolute/path/to/tailscale[.exe]. Local serve still works without it.');
}
export function validateIdentity(status) {
  const self = status.Self, tail = status.CurrentTailnet;
  if (status.BackendState !== 'Running' || self?.Online !== true) throw new Error('Tailscale is offline/not authenticated. Connect it yourself before --tailnet.');
  const hostname = self.DNSName?.replace(/\.$/, '').toLowerCase();
  const suffix = tail?.MagicDNSSuffix?.replace(/\.$/, '').toLowerCase();
  const dns = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  if (!hostname || !suffix || !dns.test(hostname) || !suffix.endsWith('.ts.net') || !hostname.endsWith('.' + suffix) || tail.MagicDNSEnabled !== true || typeof self.ID !== 'string' || !self.ID) throw new Error('A verified self MagicDNS hostname, node ID and enabled MagicDNS are required. No arbitrary host override is accepted.');
  const ips = (self.TailscaleIPs || []).filter(ip => {
    if (isIP(ip) === 4) { const n = ip.split('.').map(Number); return n[0] === 100 && n[1] >= 64 && n[1] <= 127; }
    return isIP(ip) === 6 && ip.toLowerCase().startsWith('fd7a:115c:a1e0:');
  });
  if (!ips.length) throw new Error('Tailscale reported no valid self tailnet addresses.');
  return { nodeID: self.ID, hostname, ips };
}
export async function inspectTailnet(explicit) {
  const command = await findTailscale(explicit);
  const identity = validateIdentity(JSON.parse(await ts(command, ['status', '--json'])));
  return { ...identity, command, windowsFromWSL: process.platform === 'linux' && /\.exe$/i.test(command) };
}
export function directAddresses(identity, interfaces = os.networkInterfaces()) {
  const local = Object.values(interfaces).flat().filter(Boolean).map(x => x.address.split('%')[0]);
  return identity.ips.filter(ip => local.includes(ip));
}
export const authority = (host, port) => `${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
export async function serveConfig(info) {
  const value = JSON.parse(await ts(info.command, ['serve', 'status', '--json']));
  if (value === null) return {}; // Tailscale may report null when no Serve config exists.
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Unexpected Tailscale Serve status; refusing configuration changes.');
  return value;
}
function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}
export function assertFree(config, port, localPort) {
  walk(config, obj => {
    if (obj.TCP && Object.hasOwn(obj.TCP, String(port))) throw new Error(`Tailnet port ${port} already has a Serve mapping; nothing overwritten.`);
    for (const key of ['Web', 'AllowFunnel']) if (obj[key] && Object.keys(obj[key]).some(k => k.endsWith(`:${port}`))) throw new Error(`Tailnet port ${port} is already configured; nothing overwritten.`);
    for (const key of ['Proxy', 'TCPForward']) if (typeof obj[key] === 'string') {
      try {
        const url = new URL(obj[key].includes('://') ? obj[key] : `http://${obj[key]}`);
        if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && Number(url.port || 80) === localPort) throw new Error(`Local port ${localPort} is already a Serve/Funnel backend; choose another --port.`);
      } catch (e) { if (e.message.startsWith('Local port')) throw e; }
    }
  });
}
function stable(v) { return JSON.stringify(v, (_, value) => value && !Array.isArray(value) && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value); }
export function exactMapping(config, record) {
  if (stable(config.TCP?.[record.port]) !== stable({ HTTP: true })) return false;
  if (stable(config.Web?.[record.hostPort]) !== stable({ Handlers: { '/': { Proxy: record.target } } })) return false;
  let conflicts = false;
  walk(config, obj => {
    if (obj !== config && (obj.TCP?.[record.port] || obj.Web?.[record.hostPort])) conflicts = true;
    if (obj.Web && Object.keys(obj.Web).some(k => k.endsWith(`:${record.port}`) && k !== record.hostPort)) conflicts = true;
    if (obj.AllowFunnel && Object.entries(obj.AllowFunnel).some(([k, v]) => k.endsWith(`:${record.port}`) && v)) conflicts = true;
  });
  return !conflicts;
}
async function statePath(root) { return safePath(root, '.workbench/tailnet.json', { missing: true }); }
function leasePath(record) {
  const node = createHash('sha256').update(record.nodeID).digest('hex').slice(0, 20);
  return path.join(os.tmpdir(), `demo-workbench-tailnet-${node}-${record.port}.lock`);
}
async function checkLease(record) {
  let h;
  try {
    h = await fs.open(leasePath(record), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    if (await h.readFile('utf8') !== record.token + '\n') throw new Error('Tailnet port lease belongs to another invocation; refusing cleanup.');
    return true;
  } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  finally { await h?.close(); }
}
async function releaseLease(record) { if (await checkLease(record)) await fs.unlink(leasePath(record)); }
async function removeRecord(file, token) {
  if (await exists(file) && (await json(file)).token === token) await fs.unlink(file);
}
export async function createMapping(root, info, port, localPort, token) {
  const file = await statePath(root);
  const record = { schema: 1, nodeID: info.nodeID, hostname: info.hostname, port, localPort, hostPort: authority(info.hostname, port), token,
    target: `http://127.0.0.1:${localPort}/__demo_workbench_${token}`, created: new Date().toISOString() };
  // Project record plus an exclusive per-node/port lease serializes cooperating
  // projects. External Tailscale administrators must not edit a route mid-command.
  // No reset/set-config, no takeover and no resume framework.
  await save(file, record);
  let leased = false, attempted = false;
  try {
    await fs.writeFile(leasePath(record), token + '\n', { flag: 'wx', mode: 0o600 });
    leased = true;
    assertFree(await serveConfig(info), port, localPort);
    attempted = true;
    await ts(info.command, ['serve', '--bg', `--http=${port}`, record.target]);
    if (!exactMapping(await serveConfig(info), record)) throw new Error('Tailscale did not install the exact private HTTP mapping.');
    return record;
  } catch (e) {
    // Preserve ambiguous state for explicit inspection/stop. Never revert the
    // whole shared configuration, and never remove a different service's mapping.
    if (!attempted) {
      if (leased) await releaseLease(record);
      await removeRecord(file, record.token);
    } else {
      const current = await serveConfig(info).catch(() => null);
      if (current && exactMapping(current, record)) await stopMapping(root, info, record.token).catch(() => {});
      else if (current) {
        try { assertFree(current, port, localPort); await releaseLease(record); await removeRecord(file, record.token); } catch { /* preserve record on ambiguity */ }
      }
    }
    throw new Error(`${e.message} Inspect .workbench/tailnet.json if retained; --stop-tailnet only removes an exact owned mapping.`);
  }
}
export async function stopMapping(root, info, expectedToken) {
  if (expectedToken !== null && typeof expectedToken !== 'string') throw new Error('Cleanup requires an invocation token or explicit stop.');
  const file = await statePath(root);
  if (!await exists(file)) return false;
  const r = await json(file);
  if (expectedToken !== null && r?.token !== expectedToken) return false;
  if (!r || r.schema !== 1 || r.nodeID !== info.nodeID || r.hostname !== info.hostname || !Number.isInteger(r.port) || r.port < 1 || r.port > 65535 || !Number.isInteger(r.localPort) || r.localPort < 1 || r.localPort > 65535 || !/^[0-9a-f-]{36}$/.test(r.token) || r.hostPort !== authority(info.hostname, r.port) || r.target !== `http://127.0.0.1:${r.localPort}/__demo_workbench_${r.token}`) throw new Error('Tailnet ownership record does not match this node; refusing cleanup.');
  await checkLease(r);
  const current = await serveConfig(info);
  if (!exactMapping(current, r)) {
    // A mapping removed elsewhere needs no network mutation; drop only our record.
    try { assertFree(current, r.port, r.localPort); } catch { throw new Error('Owned tailnet mapping was changed/replaced; refusing to remove it. Ownership record retained for inspection.'); }
    await releaseLease(r); await removeRecord(file, r.token); return false;
  }
  await ts(info.command, ['serve', `--http=${r.port}`, 'off']);
  assertFree(await serveConfig(info), r.port, r.localPort);
  await releaseLease(r); await removeRecord(file, r.token);
  return true;
}
export async function stopTailnet(root, explicit) {
  if (!await exists(await statePath(root))) { console.log('No owned tailnet mapping recorded. Direct listeners stop with their foreground process.'); return; }
  const info = await inspectTailnet(explicit);
  const removed = await stopMapping(root, info, null);
  console.log(removed ? 'Removed this project’s exact tailnet mapping. Any foreground local server remains until Ctrl-C.' : 'Mapping already absent; removed its stale ownership record.');
}
export const instanceToken = () => randomUUID();
export async function verifyEndpoint(url, token, info) {
  if (info.windowsFromWSL) {
    // This proves Windows localhost forwarding reaches OUR WSL process before
    // creating a persistent mapping. No netsh, firewall, IP or WSL changes.
    let stdout;
    try { ({ stdout } = await exec(windowsCurl, ['--noproxy', '*', '--silent', '--show-error', '--fail', '--max-time', '5', '-D', '-', '-o', 'NUL', url], { timeout: 7000, maxBuffer: 65536, windowsHide: true })); }
    catch (e) { throw new Error(`Windows cannot reach the demo endpoint (${url}). Requires curl.exe and working WSL localhost forwarding; nothing is reconfigured. ${e.stderr || e.message}`); }
    if (!stdout.split(/\r?\n/).some(line => line.toLowerCase() === `x-demo-workbench-instance: ${token}`)) throw new Error('Windows endpoint belongs to another service; refusing mapping.');
    return;
  }
  await new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 5000 }, res => {
      res.resume();
      if (res.statusCode === 200 && res.headers['x-demo-workbench-instance'] === token) resolve();
      else reject(new Error('Tailnet endpoint did not return this demo instance.'));
    });
    req.on('timeout', () => req.destroy(new Error('Tailnet route probe timed out.')));
    req.on('error', reject);
  });
}
