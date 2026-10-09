import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { prerequisiteChecks, diagnose } from '../lib/diagnostics.js';
import { init } from '../lib/init.js';
import { commandSpec, run, runAsync, spawnCommandSync } from '../lib/process.js';
import { labelFont, drawtextFont } from '../lib/font.js';
import { fakeNpm, fakeTailscale, withPath } from './helpers/process.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin/cli.js');
const pkg = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
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

test('shared preflight enforces Git 2.28 across native version formats', () => {
  for (const [version, expected] of [
    ['git version 2.25.1', 'error'], ['git version 2.27.9.windows.1', 'error'],
    ['git version 1.99.0', 'error'], ['unrecognized version', 'error'],
    ['git version 2.28.0', 'ok'], ['git version 2.47.1.windows.2', 'ok'],
    ['git version 2.39.5 (Apple Git-154)', 'ok'], ['git version 3.0.0', 'ok']
  ]) {
    const checks = prerequisiteChecks({ locate: name => name, execute: (name, args) => {
      if (name === 'git') return version;
      if (args.includes('-filters')) return ' T.C drawtext V->V';
      if (args.includes('-encoders')) return ' V..... libx264 H.264\n A..... aac AAC';
      return 'fixture version';
    } });
    const git = checks.find(c => c.id === 'git');
    assert.equal(git.status, expected, version);
    assert.equal(checks.some(c => c.status === 'error'), expected === 'error');
    if (expected === 'error') assert.match(git.detail, /Git 2\.28\+ is required/);
    else assert.equal(git.detail, version);
  }
});

test('unsupported Git fails doctor and init before staging', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'old git preflight '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const spawn = childProcess.spawnSync;
  t.mock.method(childProcess, 'spawnSync', (file, args, options) => {
    if (/^git(?:\.exe)?$/i.test(path.basename(file)) && args[0] === '--version') return { status: 0, stdout: 'git version 2.25.1\n', stderr: '' };
    return spawn(file, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const report = await diagnose();
  assert.equal(report.ok, false);
  assert.equal(report.checks.find(c => c.id === 'git').status, 'error');
  await assert.rejects(init(path.join(root, 'demo'), {}), /Git 2\.28\+ is required/);
  assert.deepEqual(await fs.readdir(root), []);
});

test('FFmpeg capability parsing accepts version 9 two-flag filters and earlier three-flag filters', () => {
  for (const flags of ['T.', 'T.C']) {
    const checks = prerequisiteChecks({ locate: name => name, execute: (name, args) => {
      if (name === 'git') return 'git version 2.28.0';
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

test('explicit Node scripts preserve arguments through synchronous and asynchronous execution', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'node script ü '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const script = path.join(root, 'renderer.cjs');
  await fs.writeFile(script, 'console.log(JSON.stringify(process.argv.slice(2)))');
  const args = [script, 'space ü 日本語', '& literal', 'quote"here'];
  assert.deepEqual(JSON.parse(run(process.execPath, args)), args.slice(1));
  assert.deepEqual(JSON.parse(await runAsync(process.execPath, args)), args.slice(1));
});

test('JS suffixes preserve POSIX executable shebang semantics', { skip: process.platform === 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native script ü '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const extension of ['js', 'mjs', 'cjs']) {
    const script = path.join(root, `client.${extension}`);
    await fs.writeFile(script, '#!/bin/sh\nprintf "%s" "$1"\n', { mode: 0o755 });
    const expected = 'native ü & %literal%';
    assert.equal(run(script, [expected]), expected);
    assert.equal(await runAsync(script, [expected]), expected);
  }
});

test('doctor is readonly, reports real version, optional/missing/offline Tailscale and machine-readable failures', { timeout: 60000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor readonly ü '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  // Isolate npm/Git user state too. All diagnostic subprocesses have bounded time.
  const config = path.join(root, 'npmrc'); await fs.writeFile(config, '');
  const gitconfig = path.join(root, 'gitconfig'); await fs.writeFile(gitconfig, '');
  const env = { ...process.env, HOME: root, USERPROFILE: root, npm_config_userconfig: config, npm_config_cache: path.join(root, 'cache'), GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1' };
  const invoke = (args, alternateEnv = env) => spawnCommandSync(process.execPath, [cli, ...args], { cwd: root, env: alternateEnv, timeout: 30000 });
  for (const flag of ['--version', '-v']) assert.equal(invoke([flag]).stdout.trim(), `${pkg.name} ${pkg.version}`);
  const before = await snapshot(root);
  let result = invoke(['doctor', '--json']);
  assert.equal(result.status, 0, result.stderr);
  let report = JSON.parse(result.stdout);
  assert.deepEqual(report.tool, { name: pkg.name, version: pkg.version, node: pkg.engines.node });
  assert.equal(report.ok, true); assert.equal(report.checks.find(c => c.id === 'tailscale').status, 'optional');
  assert.equal(report.checks.find(c => c.id === 'git.identity').status, 'warning');
  assert.deepEqual(await snapshot(root), before, 'doctor creates no files or media, including user caches');
  result = invoke(['doctor', '--json'], withPath(root, env));
  assert.equal(result.status, 1); report = JSON.parse(result.stdout);
  for (const tool of ['git', 'npm', 'ffmpeg', 'ffprobe']) assert.equal(report.checks.find(c => c.id === tool).status, 'error');
  assert.equal(invoke(['doctor', '--tailscale', 'anything']).status, 1);

  const script = path.join(root, 'tailscale fixture.cjs');
  const fixture = state => `const a = process.argv.slice(2);\nif (a[0] === 'version') console.log('fixture tailscale 1');\nelse if (JSON.stringify(a) === JSON.stringify(['status','--json'])) console.log(${JSON.stringify(JSON.stringify(state))});\nelse if (JSON.stringify(a) === JSON.stringify(['serve','--help'])) console.error('--bg --http');\nelse { require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'MUTATION'))}, JSON.stringify(a)); process.exit(31); }`;
  const client = await fakeTailscale(t, script, fixture(online));
  const clientEnv = { ...env, NODE_OPTIONS: process.env.NODE_OPTIONS };
  const ready = await snapshot(root);
  result = invoke(['doctor', '--tailnet', '--tailscale', client, '--json'], clientEnv);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).checks.find(c => c.id === 'tailscale.identity').status, 'ok');
  assert.deepEqual(await snapshot(root), ready, 'only version/status/help invoked; no network mutation command');
  await fs.writeFile(script, `#!/usr/bin/env node\n${fixture({ ...online, BackendState: 'NeedsLogin' })}`);
  result = invoke(['doctor', '--tailnet', '--tailscale', client, '--json'], clientEnv);
  assert.equal(result.status, 1); assert.match(result.stdout, /offline\/not authenticated/);
  result = invoke(['doctor', '--tailnet', '--tailscale', path.join(root, 'absent'), '--json']);
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).checks.find(c => c.id === 'tailscale').status, 'error');
  await assert.rejects(fs.stat(path.join(root, 'MUTATION')), { code: 'ENOENT' });
});
