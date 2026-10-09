import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prerequisiteChecks } from '../lib/diagnostics.js';
import { commandSpec, run, spawnCommandSync } from '../lib/process.js';
import { metadata } from '../lib/metadata.js';
import { labelFont, drawtextFont } from '../lib/font.js';
import { fakeNpm, withPath } from './helpers/process.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin/cli.js');
const online = { BackendState: 'Running', Self: { Online: true, ID: 'fixture', DNSName: 'fixture.tailtest.ts.net.', TailscaleIPs: ['100.100.1.2'] }, CurrentTailnet: { MagicDNSEnabled: true, MagicDNSSuffix: 'tailtest.ts.net' } };

async function snapshot(dir) {
  const result = {};
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    result[item.name] = item.isDirectory() ? await snapshot(p) : (await fs.readFile(p)).toString('base64');
  }
  return result;
}

test('aggregate checks report each missing dependency and codec/filter without a shell or unbounded probes', () => {
  const calls = [];
  const execute = (name, args, options) => {
    calls.push([name, args]); assert.equal(options.timeout, 5000); assert.ok(options.maxBuffer);
    if (name === 'ffmpeg' && args.includes('-filters')) return ' ..C notdrawtext V->V';
    if (name === 'ffmpeg' && args.includes('-encoders')) return ' V..... libx264rgb only\n A..... not_aac only';
    if (name === 'git') throw new Error('git deliberately missing');
    return 'fixture version 1';
  };
  const checks = prerequisiteChecks({ execute, locate: x => `/fixture/${x}`, identity: true });
  for (const id of ['git', 'ffmpeg.drawtext', 'ffmpeg.libx264', 'ffmpeg.aac']) assert.equal(checks.find(c => c.id === id).status, 'error');
  assert.equal(checks.find(c => c.id === 'git.identity').status, 'warning');
  assert.ok(calls.some(([name]) => name === 'ffprobe'), 'keeps checking after a missing dependency');
  const allMissing = prerequisiteChecks({ locate: name => { throw new Error(`${name} missing`); } });
  assert.equal(allMissing.filter(c => c.status === 'error').length, 7);
});

test('FFmpeg capability parsing accepts version 9 two-flag filters and earlier three-flag filters', () => {
  for (const flags of ['T.', 'T.C']) {
    const checks = prerequisiteChecks({ locate: name => name, execute: (name, args) => {
      if (args.includes('-filters')) return `Filters:\n ${flags} drawtext          V->V       Draw text on top of video.\n`;
      if (args.includes('-encoders')) return ' V....D libx264 H.264\n A..... aac AAC';
      return 'fixture version';
    } });
    assert.equal(checks.some(c => c.status === 'error'), false, JSON.stringify(checks));
  }
});

test('real drawtext font paths survive both filter parsers, including Windows drive colons', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'font path '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const systemFont = labelFont();
  assert.ok(systemFont, 'This rendering test needs an existing system label font.');
  // POSIX reproduces the Windows drive-colon parser bug without mocking an OS.
  const file = process.platform === 'win32' ? systemFont : path.join(root, 'colon:space font.ttf');
  if (file !== systemFont) await fs.copyFile(systemFont, file);
  const output = run('ffmpeg', ['-hide_banner', '-loglevel', 'debug', '-f', 'lavfi', '-i', 'color=size=64x48:duration=0.05', '-vf', `drawtext=${drawtextFont(file)}text=Reference`, '-frames:v', '1', '-f', 'null', '-'], { timeout: 10000, includeStderr: true });
  // Older FFmpeg can silently treat the text after a broken colon as another
  // option and fall back to a default font. Exit zero alone misses that bug.
  assert.ok(output.includes(`Setting 'fontfile' to value '${file.replaceAll('\\', '/')}'`), output);
});

test('native npm invocation resolves shims without shell interpolation, preserving spaces and Unicode', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'npm shim ü '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fakeNpm(root, 'console.log(JSON.stringify(process.argv.slice(2)))');
  const env = withPath(root);
  const args = ['ci', 'space ü 日本語', '& never execute', '%not-a-variable%', 'quote"here'];
  assert.deepEqual(JSON.parse(run('npm', args, { env, timeout: 5000 })), args);
  const spec = commandSpec('npm', args, { env });
  if (process.platform === 'win32') {
    assert.equal(spec.file, process.execPath);
    assert.match(spec.args[0], /npm-cli\.js$/);
    await fs.writeFile(path.join(root, 'unsafe.cmd'), '@echo must-not-run\r\n');
    assert.throws(() => commandSpec('unsafe.cmd', [], { env }), /Cannot safely execute batch shim/);
  }
  const timeout = spawnCommandSync(process.execPath, ['-e', 'setTimeout(()=>{}, 10000)'], { timeout: 100 });
  assert.equal(timeout.error.code, 'ETIMEDOUT');
});

test('doctor is readonly, reports real version, optional/missing/offline Tailscale and machine-readable failures', { timeout: 60000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor readonly ü '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  // Isolate npm/Git user state too. All diagnostic subprocesses have bounded time.
  const config = path.join(root, 'npmrc'); await fs.writeFile(config, '');
  const gitconfig = path.join(root, 'gitconfig'); await fs.writeFile(gitconfig, '');
  const env = { ...process.env, HOME: root, USERPROFILE: root, npm_config_userconfig: config, npm_config_cache: path.join(root, 'cache'), GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' };
  const invoke = (args, alternateEnv = env) => spawnCommandSync(process.execPath, [cli, ...args], { cwd: root, env: alternateEnv, timeout: 30000 });
  assert.equal(invoke(['--version']).stdout.trim(), `${metadata.name} ${metadata.version}`);
  const before = await snapshot(root);
  let result = invoke(['doctor', '--json']);
  assert.equal(result.status, 0, result.stderr);
  let report = JSON.parse(result.stdout);
  assert.equal(report.ok, true); assert.equal(report.checks.find(c => c.id === 'tailscale').status, 'optional');
  assert.equal(report.checks.find(c => c.id === 'git.identity').status, 'warning');
  assert.deepEqual(await snapshot(root), before, 'doctor creates no files or media, including user caches');
  result = invoke(['doctor', '--json'], withPath(root, env));
  assert.equal(result.status, 1); report = JSON.parse(result.stdout);
  for (const tool of ['git', 'npm', 'ffmpeg', 'ffprobe']) assert.equal(report.checks.find(c => c.id === tool).status, 'error');
  assert.equal(invoke(['doctor', '--tailscale', 'anything']).status, 1);

  const client = path.join(root, 'tailscale fixture.cjs');
  const fixture = state => `const a = process.argv.slice(2);\nif (a[0] === 'version') console.log('fixture tailscale 1');\nelse if (JSON.stringify(a) === JSON.stringify(['status','--json'])) console.log(${JSON.stringify(JSON.stringify(state))});\nelse if (JSON.stringify(a) === JSON.stringify(['serve','--help'])) console.error('--bg --http');\nelse { require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'MUTATION'))}, JSON.stringify(a)); process.exit(31); }`;
  await fs.writeFile(client, fixture(online), { mode: 0o755 });
  const ready = await snapshot(root);
  result = invoke(['doctor', '--tailnet', '--tailscale', client, '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).checks.find(c => c.id === 'tailscale.identity').status, 'ok');
  assert.deepEqual(await snapshot(root), ready, 'only version/status/help invoked; no network mutation command');
  await fs.writeFile(client, fixture({ ...online, BackendState: 'NeedsLogin' }));
  result = invoke(['doctor', '--tailnet', '--tailscale', client, '--json']);
  assert.equal(result.status, 1); assert.match(result.stdout, /offline\/not authenticated/);
  result = invoke(['doctor', '--tailnet', '--tailscale', path.join(root, 'absent'), '--json']);
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).checks.find(c => c.id === 'tailscale').status, 'error');
  await assert.rejects(fs.stat(path.join(root, 'MUTATION')), { code: 'ENOENT' });
});
