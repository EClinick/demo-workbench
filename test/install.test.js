import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { invoke, installedBin, withPath } from './helpers/process.js';
import { treeHashes, json, hash } from '../lib/common.js';
import { metadata } from '../lib/metadata.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function check(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error || ''}`);
  return result.stdout;
}

test('native npm bin: tarball and Git install, doctor, paths, upgrade, uninstall, frozen project', { timeout: 240000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'demo install ü '));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const prefix = path.join(root, 'prefix with spaces'), cwd = path.join(root, 'unrelated cwd');
  await fs.mkdir(cwd);
  const userconfig = path.join(root, 'npmrc'); await fs.writeFile(userconfig, '');
  const gitconfig = path.join(root, 'gitconfig'); await fs.writeFile(gitconfig, '');
  const binDir = process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
  const env = withPath(binDir + path.delimiter + (process.env.PATH || process.env.Path), {
    ...process.env, HOME: root, USERPROFILE: root, npm_config_cache: path.join(root, 'cache'),
    npm_config_userconfig: userconfig, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1'
  });
  const options = { cwd, env, timeout: 120000 };
  const npm = args => check(invoke('npm', args, options));
  const installed = args => check(installedBin('demo-workbench', args, options));
  const install = source => npm(['install', '--global', '--prefix', prefix, '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', source]);
  const packed = JSON.parse(check(invoke('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], { ...options, cwd: repo })))[0];
  assert.ok(packed.files.some(f => f.path === 'NOTICE.md'));
  assert.ok(packed.files.some(f => f.path === 'lib/diagnostics.js'));
  assert.ok(packed.files.every(f => !/^(test|node_modules|\.github)\//.test(f.path)));
  install(path.join(root, packed.filename));
  assert.match(installed(['--version']), new RegExp(`demo-workbench ${metadata.version.replaceAll('.', '\\.')}`));
  assert.match(installed(['-v']), /demo-workbench/);
  assert.match(installed(['--help']), /doctor/);
  const diagnosis = JSON.parse(installed(['doctor', '--json']));
  assert.equal(diagnosis.ok, true);
  assert.equal(diagnosis.platform, process.platform);
  assert.equal(diagnosis.checks.find(c => c.id === 'tailscale').status, 'optional');
  if (process.platform === 'win32') {
    // Native cmd.exe as well as the PowerShell invocation used above.
    assert.match(check(invoke('cmd.exe', ['/d', '/s', '/c', 'demo-workbench --version'], options)), /demo-workbench/);
  }
  const project = path.join(root, 'demo space 日本語');
  installed(['init', project, '--width', '96', '--height', '64', '--fps', '24', '--duration', '0.125']);
  const frozen = await treeHashes(project, '.workbench');
  assert.equal((await json(path.join(project, 'demo.json'))).starter.version, metadata.version);
  assert.equal((await json(path.join(project, '.workbench/package.json'))).version, metadata.version);

  // Install through npm's Git transport from a disposable source, not a folder
  // dependency/link. A distinct version proves the update path really ran.
  const source = path.join(root, 'git source ü'); await fs.mkdir(source);
  for (const name of ['bin', 'lib', 'template', 'README.md', 'NOTICE.md', 'package.json']) await fs.cp(path.join(repo, name), path.join(source, name), { recursive: true });
  const pkg = await json(path.join(source, 'package.json'));
  pkg.version = '0.2.1-install-fixture';
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify(pkg));
  for (const args of [['init', '-b', 'main'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Install fixture']]) check(invoke('git', args, { ...options, cwd: source }));
  const sha = check(invoke('git', ['rev-parse', 'HEAD'], { ...options, cwd: source })).trim();
  install(pathToFileURL(source).href.replace(/^file:/, 'git+file:') + '#' + sha);
  await fs.rm(source, { recursive: true, force: true, maxRetries: 3 });
  assert.match(installed(['--version']), /0\.2\.1-install-fixture/);
  const next = path.join(root, 'next demo');
  installed(['init', next, '--width', '64', '--height', '48', '--duration', '0.05']);
  assert.equal((await json(path.join(next, 'demo.json'))).starter.version, pkg.version);
  assert.deepEqual(await treeHashes(project, '.workbench'), frozen);

  // Hosted runs additionally prove the real private/public GitHub source at the
  // current commit. The runner's short-lived credential stays in subprocess env,
  // never in a URL, package, Git config file, or logged command.
  if (process.env.DEMO_GIT_SOURCE) {
    const remoteEnv = { ...env };
    if (process.env.DEMO_GITHUB_TOKEN) Object.assign(remoteEnv, {
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + process.env.DEMO_GITHUB_TOKEN).toString('base64')
    });
    check(invoke('npm', ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', process.env.DEMO_GIT_SOURCE], { ...options, env: remoteEnv }));
    assert.match(installed(['--version']), new RegExp(metadata.version.replaceAll('.', '\\.')));
  }
  npm(['uninstall', '--global', '--prefix', prefix, '--ignore-scripts', 'demo-workbench']);
  await assert.rejects(fs.lstat(path.join(binDir, process.platform === 'win32' ? 'demo-workbench.cmd' : 'demo-workbench')), { code: 'ENOENT' });
  assert.deepEqual(await treeHashes(project, '.workbench'), frozen);
  check(invoke('npm', ['run', 'demo:render', '--', '--note', 'After initializer removal'], { ...options, cwd: project }));
  const archived = await hash(path.join(project, 'runs/v001/render.mp4'));
  const cli = path.join(project, '.workbench/bin/cli.js');
  assert.match(check(invoke(process.execPath, [cli, '--version'], { ...options, cwd: project })), new RegExp(metadata.version.replaceAll('.', '\\.')));
  assert.equal(JSON.parse(check(invoke(process.execPath, [cli, 'doctor', '--json'], { ...options, cwd: project }))).ok, true);
  const child = spawn(process.execPath, [cli, 'serve', '--port', '0'], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit'); let output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  try {
    const deadline = Date.now() + 10000;
    while (!/http:\/\/127\.0\.0\.1:\d+/.test(output) && child.exitCode === null && Date.now() < deadline) await delay(25);
    const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url, output);
    assert.equal((await fetch(url)).status, 200);
    const media = await fetch(url + '/media/v001/web.mp4', { headers: { Range: 'bytes=0-15' } });
    assert.equal(media.status, 206); assert.equal((await media.arrayBuffer()).byteLength, 16);
    assert.equal((await fetch(url + '/demo.json')).status, 404);
  } finally { child.kill(); await exited; }
  assert.equal(await hash(path.join(project, 'runs/v001/render.mp4')), archived);
  console.log(`INSTALL_PROOF platform=${process.platform} wsl=${diagnosis.wsl} version=${metadata.version} tarball/git/shim/doctor/render/serve/upgrade/uninstall=passed github=${!!process.env.DEMO_GIT_SOURCE}`);
});
