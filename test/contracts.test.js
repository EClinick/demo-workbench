import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rate, hash } from '../lib/common.js';
import { validateVideo } from '../lib/init.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin/cli.js');

test('rational settings accept source classes and reject invalid contracts', () => {
  for (const v of [{ width: 2880, height: 2160, fps: '24000/1001', duration: 20.459 }, { width: 3840, height: 2160, fps: '60', duration: 14.745 }]) assert.doesNotThrow(() => validateVideo(v));
  for (const fps of ['0', '1/0', 'NaN', '24/1/2', '999', '-1', '24;rm']) assert.throws(() => validateVideo({ width: 320, height: 240, fps, duration: 1 }));
  assert.ok(Math.abs(rate('24000/1001') - 23.976023976) < 1e-8);
  assert.throws(() => validateVideo({ width: 319, height: 240, fps: 30, duration: 1 }));
});

test('extracted template script syntax and privacy contract (not browser QA)', async () => {
  const html = await fs.readFile(path.join(repo, 'template/site/index.html'), 'utf8');
  for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  new vm.Script(await fs.readFile(path.join(repo, 'template/site/theme.js'), 'utf8'));
  assert.equal(await hash(path.join(repo, 'template/site/theme.css')), '709efeac30955f98ef6ec543943bbe87a714aa3c969e161874efd3e97cc32913');
  assert.equal(await hash(path.join(repo, 'template/site/theme.js')), '1d9c41a607547d285cdd979bde104deff2627ee8cfaf07cf0c4fdccc47a07a96');
  assert.doesNotMatch(html, /https?:\/\/|Love Motion|love-motion|session\.html|how-we-made|4\/3|8\/3|24000|2160/);
  for (const feature of ['playerTabs', 'setupCompare', 'openLB', 'scoreChips', 'not judged yet', 'data.json', 'comparisonAspect', 'timeupdate']) assert.ok(html.includes(feature), feature);
});

test('partial init and raced-in target preserve user material with useful diagnostics', { timeout: 30000 }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-workbench-init-safety-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const tools = path.join(temp, 'tools'); await fs.mkdir(tools);
  const npm = path.join(tools, 'npm');
  // Fail after preflight, during the project-local install.
  await fs.writeFile(npm, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 10; exit 0; fi\necho "intentional local install failure" >&2\nexit 23\n', { mode: 0o755 });
  const env = { ...process.env, PATH: tools + path.delimiter + process.env.PATH };
  const target = path.join(temp, 'partial');
  let result = spawnSync(process.execPath, [cli, 'init', target], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /staging retained/);
  await assert.rejects(fs.lstat(target), { code: 'ENOENT' });
  const stage = (await fs.readdir(temp)).find(f => f.startsWith('.partial.init-'));
  assert.match(await fs.readFile(path.join(temp, stage, 'INIT-ERROR.txt'), 'utf8'), /intentional local install failure/);
  // A user creates a target after preflight. Finalization must never replace it,
  // even when an empty target might otherwise be overwritten by directory rename.
  const raced = path.join(temp, 'raced');
  await fs.writeFile(npm, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 10; exit 0; fi\nmkdir '${raced}'\nprintf 'keep me' > '${raced}/user.txt'\nexit 0\n`, { mode: 0o755 });
  result = spawnSync(process.execPath, [cli, 'init', raced], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /staging retained/);
  assert.equal(await fs.readFile(path.join(raced, 'user.txt'), 'utf8'), 'keep me');
  assert.deepEqual(await fs.readdir(raced), ['user.txt']);
});
