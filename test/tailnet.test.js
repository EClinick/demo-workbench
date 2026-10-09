import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { exists } from '../lib/common.js';
import { fakeTailscale } from './helpers/process.js';
import { createOutputServer, serve } from '../lib/serve.js';
import { validateIdentity, directAddresses, assertFree, createMapping, stopMapping, verifyEndpoint, inspectTailnet, serveConfig, stopTailnet } from '../lib/tailnet.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const status = { BackendState: 'Running', Self: { ID: 'synthetic-node', Online: true, DNSName: 'demo.tailtest.ts.net.', TailscaleIPs: ['100.100.100.100', 'fd7a:115c:a1e0::1'] }, CurrentTailnet: { MagicDNSSuffix: 'tailtest.ts.net', MagicDNSEnabled: true } };
const existing = { TCP: { '4387': { HTTP: true } }, Web: { 'other.tailtest.ts.net:4387': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4387' } } } } };
const parse = async p => JSON.parse(await fs.readFile(p, 'utf8'));
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-workbench-tailnet-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.workbench')); await fs.mkdir(path.join(root, 'public'));
  await fs.writeFile(path.join(root, 'public/index.html'), 'Synthetic gallery');
  await fs.mkdir(path.join(root, 'public/media/v001'), { recursive: true });
  await fs.writeFile(path.join(root, 'public/media/v001/web.mp4'), Buffer.from('0123456789abcdef'));
  await fs.writeFile(path.join(root, 'private.txt'), 'not public');
  const stateFile = path.join(root, 'ts-state.json');
  await fs.writeFile(stateFile, JSON.stringify({ status, config: existing, calls: [] }));
  const command = await fakeTailscale(t, path.join(root, 'tailscale.cjs'), `const fs = require('node:fs');
const file = ${JSON.stringify(stateFile)};
const s = JSON.parse(fs.readFileSync(file));
const a = process.argv.slice(2);
if (s.pause && JSON.stringify(a) === JSON.stringify(s.pause.args)) {
 let claimed = false;
 try { fs.writeFileSync(s.pause.reached, 'ready', { flag: 'wx' }); claimed = true; }
 catch (e) { if (e.code !== 'EEXIST') throw e; }
 if (claimed) {
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(s.pause.release)) {
   if (Date.now() > deadline) throw new Error('Synthetic CLI barrier timed out');
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
 }
}
if (a[0] === 'status') console.log(JSON.stringify(s.status));
else if (a[0] === 'serve' && a[1] === 'status') console.log(JSON.stringify(s.config));
else {
 s.calls.push(a);
 const port = a.find(x => x.startsWith('--http=')).slice(7);
 const host = s.status.Self.DNSName.replace(/\\.$/, '') + ':' + port;
 if (a.at(-1) === 'off') { delete s.config.TCP[port]; delete s.config.Web[host]; }
 else { s.config.TCP ||= {}; s.config.Web ||= {}; s.config.TCP[port] = { HTTP: true }; s.config.Web[host] = { Handlers: { '/': { Proxy: a.at(-1) } } }; }
 fs.writeFileSync(file, JSON.stringify(s));
 if (s.failAfterApply && a.at(-1) !== 'off') process.exitCode = 1;
}
`);
  return { root, command, stateFile, info: { ...validateIdentity(status), command } };
}
async function mutate(file, fn) { const s = await parse(file); fn(s); await fs.writeFile(file, JSON.stringify(s)); }
async function pauseCommand(root, stateFile, args) {
  const reached = path.join(root, 'command-reached'), release = path.join(root, 'command-release');
  await mutate(stateFile, s => { s.pause = { args, reached, release }; });
  return {
    reached: async () => {
      const deadline = Date.now() + 5000;
      while (!await exists(reached)) {
        if (Date.now() > deadline) throw new Error('Synthetic CLI never reached the barrier');
        await delay(10);
      }
    },
    release: () => fs.writeFile(release, 'continue')
  };
}
async function request(port, resource, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: resource, headers }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('tailnet self identity must be online and verified; direct addresses must belong to this OS', () => {
  const info = validateIdentity(status);
  assert.equal(info.hostname, 'demo.tailtest.ts.net');
  assert.deepEqual(directAddresses(info, { tailscale0: [{ address: '100.100.100.100' }], eth0: [{ address: '192.168.1.9' }] }), ['100.100.100.100']);
  assert.deepEqual(directAddresses(info, { eth0: [{ address: '192.168.1.9' }] }), []);
  for (const change of [s => { s.BackendState = 'NeedsLogin'; }, s => { s.Self.Online = false; }, s => { s.Self.DNSName = '*.tailtest.ts.net'; }, s => { s.Self.DNSName = 'evil.example'; }, s => { s.Self.TailscaleIPs = ['0.0.0.0', '192.168.1.9']; }, s => { s.CurrentTailnet.MagicDNSEnabled = false; }]) {
    const s = structuredClone(status); change(s); assert.throws(() => validateIdentity(s));
  }
});

test('mapping ownership, collisions, exact cleanup and partial failure use actual CLI-shaped subprocesses', async t => {
  const { root, info, stateFile } = await fixture(t);
  const token = randomUUID();
  const record = await createMapping(root, info, 19417, 19418, token);
  assert.equal(record.target, `http://127.0.0.1:19418/__demo_workbench_${token}`);
  let s = await parse(stateFile);
  assert.deepEqual(s.config.Web['other.tailtest.ts.net:4387'], existing.Web['other.tailtest.ts.net:4387']);
  assert.deepEqual(s.calls[0], ['serve', '--bg', '--http=19417', record.target]);
  const before = structuredClone(s.config);
  await assert.rejects(createMapping(root, info, 19417, 19418, randomUUID()), /EEXIST/);
  assert.deepEqual((await parse(stateFile)).config, before);
  const otherProject = path.join(root, 'other-project');
  await fs.mkdir(path.join(otherProject, '.workbench'), { recursive: true });
  await assert.rejects(createMapping(otherProject, info, 19417, 19419, randomUUID()), /EEXIST/);
  await assert.rejects(fs.stat(path.join(otherProject, '.workbench/tailnet.json')), { code: 'ENOENT' });
  assert.deepEqual((await parse(stateFile)).config, before, 'another project cannot acquire the same mapped port');
  // A new handler/funnel or changed target is not ours to remove.
  await mutate(stateFile, x => { x.config.Web[record.hostPort].Handlers['/other'] = { Proxy: 'http://127.0.0.1:1234' }; });
  await assert.rejects(stopMapping(root, info, token), /changed\/replaced/);
  assert.equal((await parse(stateFile)).calls.length, 1);
  await mutate(stateFile, x => { x.config = before; x.config.AllowFunnel = { [record.hostPort]: true }; });
  await assert.rejects(stopMapping(root, info, token), /changed\/replaced/);
  await mutate(stateFile, x => { x.config = before; delete x.config.AllowFunnel; });
  await assert.rejects(stopMapping(root, { ...info, nodeID: 'another-node' }, token), /does not match/);
  assert.equal(await stopMapping(root, info, token), true);
  s = await parse(stateFile);
  assert.deepEqual(s.config, existing);
  assert.deepEqual(s.calls.at(-1), ['serve', '--http=19417', 'off']);
  await assert.rejects(fs.stat(path.join(root, '.workbench/tailnet.json')), { code: 'ENOENT' });
  // Conflict in foreground/service config and existing Funnel/backend collision.
  for (const config of [existing, { Foreground: { session: existing } }, { AllowFunnel: { 'demo.tailtest.ts.net:4387': true } }]) assert.throws(() => assertFree(config, 4387, 19418));
  assert.throws(() => assertFree(existing, 19417, 4387), /already a Serve\/Funnel backend/);
  await mutate(stateFile, x => { x.failAfterApply = true; });
  await assert.rejects(createMapping(root, info, 19417, 19418, randomUUID()), /command failed/);
  assert.deepEqual((await parse(stateFile)).config, existing, 'failure cleans only exact newly applied mapping');
  await assert.rejects(fs.stat(path.join(root, '.workbench/tailnet.json')), { code: 'ENOENT' });
  await mutate(stateFile, x => { x.config = null; });
  assert.deepEqual(await serveConfig(info), {}, 'fresh Tailscale nodes may report null config');
});

test('automatic cleanup cannot remove a replacement invocation mapping', async t => {
  const { root, info, stateFile } = await fixture(t);
  const first = await createMapping(root, info, 19427, 19428, randomUUID());
  await stopTailnet(root, info.command);
  assert.equal(await stopMapping(root, info, first.token), false);
  const second = await createMapping(root, info, 19427, 19429, randomUUID());
  try {
    const state = await parse(stateFile);
    const record = await parse(path.join(root, '.workbench/tailnet.json'));
    assert.equal(await stopMapping(root, info, first.token), false);
    assert.deepEqual(await parse(stateFile), state);
    assert.deepEqual(await parse(path.join(root, '.workbench/tailnet.json')), record);
    assert.equal(await stopMapping(root, info, second.token), true);
    assert.deepEqual((await parse(stateFile)).config, existing);
  } finally { await stopMapping(root, info, second.token); }
});

test('overlapping automatic and explicit stops exclude lifecycle mutations until cleanup completes', async t => {
  for (const winner of ['automatic', 'explicit']) {
    await t.test(winner, async t => {
      const { root, info, stateFile, command } = await fixture(t);
      const first = await createMapping(root, info, 19437, 19438, randomUUID());
      const barrier = await pauseCommand(root, stateFile, ['serve', 'status', '--json']);
      const pending = winner === 'automatic' ? stopMapping(root, info, first.token) : stopTailnet(root, command);
      pending.catch(() => {});
      try {
        await barrier.reached();
        const state = await parse(stateFile);
        const explicit = spawnSync(process.execPath, [path.join(repo, 'bin/cli.js'), 'serve', '--stop-tailnet', '--tailscale', command], { cwd: root, encoding: 'utf8', timeout: 12000 });
        assert.notEqual(explicit.status, 0);
        assert.match(explicit.stderr, /Project is locked/);
        await assert.rejects(stopMapping(root, info, first.token), /Project is locked/);
        await assert.rejects(createMapping(root, info, 19437, 19439, randomUUID()), /Project is locked/);
        assert.deepEqual(await parse(stateFile), state);
        assert.equal((await parse(path.join(root, '.workbench/tailnet.json'))).token, first.token);
      } finally {
        await barrier.release();
        await pending;
      }
      assert.deepEqual((await parse(stateFile)).config, existing);
      const second = await createMapping(root, info, 19437, 19439, randomUUID());
      try {
        const state = await parse(stateFile);
        assert.equal(await stopMapping(root, info, first.token), false);
        assert.deepEqual(await parse(stateFile), state);
        assert.equal(state.config.Web[second.hostPort].Handlers['/'].Proxy, second.target);
        assert.equal((await parse(path.join(root, '.workbench/tailnet.json'))).token, second.token);
      } finally { await stopTailnet(root, command); }
      assert.deepEqual((await parse(stateFile)).config, existing);
      assert.equal(await exists(path.join(root, '.workbench/operation.lock')), false);
    });
  }
});

test('pending creation excludes stops and competing creation through installation and rollback', async t => {
  for (const failAfterApply of [false, true]) {
    await t.test(failAfterApply ? 'failed installation rollback' : 'successful installation', async t => {
      const { root, info, stateFile, command } = await fixture(t);
      const token = randomUUID(), target = `http://127.0.0.1:19448/__demo_workbench_${token}`;
      await mutate(stateFile, s => { s.failAfterApply = failAfterApply; });
      const barrier = await pauseCommand(root, stateFile, ['serve', '--bg', '--http=19447', target]);
      const pending = createMapping(root, info, 19447, 19448, token).then(record => ({ record }), error => ({ error }));
      let outcome;
      try {
        await barrier.reached();
        const state = await parse(stateFile);
        assert.deepEqual(state.config, existing);
        assert.equal((await parse(path.join(root, '.workbench/tailnet.json'))).token, token);
        const explicit = spawnSync(process.execPath, [path.join(repo, 'bin/cli.js'), 'serve', '--stop-tailnet', '--tailscale', command], { cwd: root, encoding: 'utf8', timeout: 12000 });
        assert.notEqual(explicit.status, 0);
        assert.match(explicit.stderr, /Project is locked/);
        await assert.rejects(stopMapping(root, info, token), /Project is locked/);
        await assert.rejects(createMapping(root, info, 19447, 19449, randomUUID()), /Project is locked/);
        assert.deepEqual(await parse(stateFile), state);
        assert.equal((await parse(path.join(root, '.workbench/tailnet.json'))).token, token);
      } finally {
        await barrier.release();
        outcome = await pending;
      }
      if (failAfterApply) {
        assert.match(outcome.error?.message || '', /command failed/);
        assert.equal(await exists(path.join(root, '.workbench/tailnet.json')), false);
      } else {
        assert.equal(outcome.error, undefined);
        assert.equal(outcome.record.token, token);
        assert.equal((await parse(stateFile)).config.Web[outcome.record.hostPort].Handlers['/'].Proxy, target);
        await stopTailnet(root, command);
      }
      assert.deepEqual((await parse(stateFile)).config, existing);
      assert.equal(await exists(path.join(root, '.workbench/operation.lock')), false);
      await mutate(stateFile, s => { s.failAfterApply = false; });
      const next = await createMapping(root, info, 19447, 19449, randomUUID());
      assert.equal(await stopMapping(root, info, next.token), true);
      assert.deepEqual((await parse(stateFile)).config, existing);
    });
  }
});

test('closing an older server preserves the replacement tailnet route', async t => {
  const { root, command, stateFile } = await fixture(t);
  const project = path.join(root, 'generated');
  const initialized = spawnSync(process.execPath, [path.join(repo, 'bin/cli.js'), 'init', project], { encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  const proxy = http.createServer(async (req, res) => {
    const config = (await parse(stateFile)).config;
    const target = config.Web?.[req.headers.host]?.Handlers['/'].Proxy;
    if (!target) { res.writeHead(404); res.end(); return; }
    const upstream = http.request(target + req.url, { headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    upstream.end();
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  const tailPort = proxy.address().port;
  const get = http.get;
  t.mock.method(http, 'get', (url, options, callback) => get(url, {
    ...options, family: 4, lookup: (hostname, opts, done) => done(null, '127.0.0.1', 4)
  }, callback));
  async function freePort() {
    const server = http.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
  }
  const options = { tailnet: true, tailnetMode: 'serve', tailnetPort: tailPort, tailscale: command };
  const first = await serve(project, await freePort(), options);
  t.after(() => first.closeWorkbench());
  await stopTailnet(project, command);
  const second = await serve(project, await freePort(), options);
  t.after(() => second.closeWorkbench());
  const state = await parse(stateFile);
  const ownership = await parse(path.join(project, '.workbench/tailnet.json'));
  await first.closeWorkbench();
  assert.deepEqual(await parse(stateFile), state);
  assert.deepEqual(await parse(path.join(project, '.workbench/tailnet.json')), ownership);
  await verifyEndpoint(second.tailnetUrl, ownership.token, { windowsFromWSL: false });
  await second.closeWorkbench();
});

test('output server accepts concrete tailnet Host/Origin only and preserves privacy/Range through owned proxy prefix', async t => {
  const { root } = await fixture(t);
  const token = randomUUID();
  const tailHost = 'demo.tailtest.ts.net:19417';
  const policy = { hosts: new Set([tailHost, '100.100.100.100:19417']), origins: new Set([`http://${tailHost}`]), proxyPrefix: `/__demo_workbench_${token}`, token };
  const server = await createOutputServer(root, policy);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  let r = await request(port, policy.proxyPrefix + '/media/v001/web.mp4', { Host: tailHost, Origin: `http://${tailHost}`, Range: 'bytes=2-5' });
  assert.equal(r.status, 206); assert.equal(r.body.toString(), '2345'); assert.equal(r.headers['content-type'], 'video/mp4');
  assert.equal((await request(port, '/', { Host: '100.100.100.100:19417' })).status, 200);
  for (const headers of [{ Host: 'evil.example', 'X-Forwarded-Host': tailHost }, { Host: 'other.tailtest.ts.net:19417' }, { Host: 'demo.tailtest.ts.net:19418' }, { Host: tailHost, Origin: 'http://evil.example' }, { Host: tailHost, Origin: 'null' }, { Host: tailHost, Origin: `http://${tailHost}/path` }]) assert.equal((await request(port, '/', headers)).status, 403);
  for (const resource of ['/private.txt', '/.workbench/tailnet.json', '/%2e%2e%2fprivate.txt', '/.git/config', '/demo.json', '/runs/v001/manifest.json']) assert.equal((await request(port, policy.proxyPrefix + resource, { Host: tailHost })).status, 404);
  await fs.symlink(path.join(root, 'private.txt'), path.join(root, 'public/media/v001/render.mp4'));
  assert.equal((await request(port, policy.proxyPrefix + '/media/v001/render.mp4', { Host: tailHost })).status, 404);
  assert.equal((await request(port, '/__demo_workbench_wrong/', { Host: tailHost })).status, 404);
  policy.hosts.add(`127.0.0.1:${port}`);
  await verifyEndpoint(`http://127.0.0.1:${port}/`, token, { windowsFromWSL: false });
  await assert.rejects(verifyEndpoint(`http://127.0.0.1:${port}/`, randomUUID(), { windowsFromWSL: false }), /did not return this demo/);
});

test('real WSL Windows curl bridge verifies only this loopback instance, without a Serve mutation', { skip: process.platform !== 'linux' || !/microsoft/i.test(os.release()) }, async t => {
  const { root } = await fixture(t);
  const token = randomUUID();
  const policy = { hosts: new Set(), origins: new Set(), token };
  const server = await createOutputServer(root, policy);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/`;
  policy.hosts.add(`127.0.0.1:${server.address().port}`);
  await verifyEndpoint(url, token, { windowsFromWSL: true });
  await assert.rejects(verifyEndpoint(url, randomUUID(), { windowsFromWSL: true }), /belongs to another service/);
});

test('generated CLI inherits explicit tailnet options; failures never mutate network config', { timeout: 30000 }, async t => {
  const { root, command, stateFile } = await fixture(t);
  const project = path.join(root, 'generated');
  let r = spawnSync(process.execPath, [path.join(repo, 'bin/cli.js'), 'init', project], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const cli = path.join(project, '.workbench/bin/cli.js');
  const invoke = args => spawnSync(process.execPath, [cli, 'serve', ...args], { cwd: project, encoding: 'utf8', timeout: 10000 });
  r = invoke(['--tailnet', '--tailscale', path.join(root, 'missing')]); assert.notEqual(r.status, 0); assert.match(r.stderr, /command failed/);
  await mutate(stateFile, x => { x.status.BackendState = 'Stopped'; });
  r = invoke(['--tailnet', '--tailscale', command]); assert.notEqual(r.status, 0); assert.match(r.stderr, /offline/);
  await mutate(stateFile, x => { x.status = status; });
  r = invoke(['--tailnet', '--tailnet-port', '4387', '--tailscale', command]); assert.notEqual(r.status, 0); assert.match(r.stderr, /already has a Serve mapping/);
  r = invoke(['--tailnet', '--tailnet-mode', 'direct', '--tailscale', command]); assert.notEqual(r.status, 0); assert.match(r.stderr, /No verified self Tailscale address/);
  r = invoke(['--tailnet-mode', 'serve']); assert.notEqual(r.status, 0); assert.match(r.stderr, /require --tailnet/);
  r = invoke(['--stop-tailnet']); assert.equal(r.status, 0); assert.match(r.stdout, /No owned/);
  assert.deepEqual((await parse(stateFile)).config, existing);
  assert.deepEqual((await parse(stateFile)).calls, []);
  const local = await serve(project, 0);
  t.after(() => local.closeWorkbench());
  assert.equal(local.address().address, '127.0.0.1');
  const occupied = local.address().port;
  await assert.rejects(serve(project, occupied, { tailnet: true, tailnetMode: 'serve', tailscale: command }), /EADDRINUSE/);
  assert.deepEqual((await parse(stateFile)).calls, []);
  assert.equal((await request(occupied, '/', { Origin: 'http://untrusted.example' })).status, 403);
  await assert.rejects(inspectTailnet(path.join(root, 'absent')), /command failed/);
});
