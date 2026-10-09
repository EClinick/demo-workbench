import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run, json, hash } from '../lib/common.js';
import { prepareProject } from '../lib/project.js';
import { serve } from '../lib/serve.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(repo, '.regression-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const project = path.join(temp, 'demo');
  run(process.execPath, [path.join(repo, 'bin/cli.js'), 'init', project, '--width', '96', '--height', '128', '--fps', '24', '--duration', '0.25']);
  return { temp, project };
}
function cli(project, args, ok = true) {
  const result = spawnSync(process.execPath, [path.join(project, '.workbench/bin/cli.js'), ...args], { cwd: project, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status === 0, ok, result.stderr);
  return result;
}

test('fresh generated checkout restores render and serve outputs without exposing init or replacing archives', async t => {
  const { project, temp } = await fixture(t);
  assert.match(run(process.execPath, [path.join(repo, 'bin/cli.js'), '--help']), /init NEW-PATH/);
  assert.doesNotMatch(cli(project, ['--help']).stdout, /\binit\b/);
  const before = await fs.readdir(temp);
  assert.match(cli(project, ['init', path.join(temp, 'unsupported')], false).stderr, /Unknown command: init/);
  assert.deepEqual(await fs.readdir(temp), before);
  run('git', ['add', '.'], { cwd: project });
  run('git', ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'Fixture'], { cwd: project });
  const checkout = path.join(temp, 'checkout');
  run('git', ['clone', '--no-local', project, checkout]);
  for (const dir of ['assets', 'runs', 'public']) await assert.rejects(fs.stat(path.join(checkout, dir)), { code: 'ENOENT' });
  cli(checkout, ['render']);
  const manifest = await json(path.join(checkout, 'runs/v001/manifest.json'));
  assert.equal(manifest.video.audio, false);
  assert.equal((await json(path.join(checkout, 'public/data.json'))).versions[0].label, 'v001');
  const archiveHash = await hash(path.join(checkout, 'runs/v001/render.mp4'));
  await fs.rm(path.join(checkout, 'public'), { recursive: true });
  cli(checkout, ['compare', 'v001']);
  assert.equal(await hash(path.join(checkout, 'public/media/v001/render.mp4')), archiveHash);
  await fs.access(path.join(checkout, 'public/index.html'));
  const review = path.join(temp, 'review.json');
  await fs.writeFile(review, JSON.stringify({ version: 'v001', outputSha256: manifest.outputSha256, packetSha256: null, rubric: 'Synthetic', critics: [{ name: 'Timing', model: 'manual', findings: 'Synthetic', score: 8 }] }));
  cli(checkout, ['review', 'v001', '--file', review]);
  cli(checkout, ['archive', 'v001', path.join(temp, 'bundle')]);
  const dataHash = await hash(path.join(checkout, 'public/data.json'));
  await fs.writeFile(path.join(checkout, 'public/index.html'), '<h1>Preserve existing gallery</h1>');
  await prepareProject(checkout);
  assert.equal(await hash(path.join(checkout, 'public/data.json')), dataHash);
  assert.equal(await hash(path.join(checkout, 'runs/v001/render.mp4')), archiveHash);
  assert.equal(await fs.readFile(path.join(checkout, 'public/index.html'), 'utf8'), '<h1>Preserve existing gallery</h1>');
  const serving = path.join(temp, 'serving');
  run('git', ['clone', '--no-local', project, serving]);
  const server = await serve(serving, 0);
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(origin)).status, 200);
    assert.deepEqual((await (await fetch(origin + '/data.json')).json()).versions, []);
    assert.equal((await fetch(origin + '/demo.json')).status, 404);
  } finally { await server.closeWorkbench(); }
  for (const rel of ['assets', 'runs', 'public', 'public/index.html', 'public/theme.css', 'public/theme.js', 'public/data.json']) {
    const original = path.join(serving, rel), moved = path.join(temp, 'preserved');
    await fs.rename(original, moved);
    await fs.symlink(moved, original);
    await assert.rejects(prepareProject(serving), /Symlink refused/);
    await fs.unlink(original);
    await fs.rename(moved, original);
  }
});

test('renderer Matroska disguised as MP4 is rejected before publication while MP4 succeeds', async t => {
  const { project } = await fixture(t);
  const configFile = path.join(project, 'demo.json');
  const config = await json(configFile);
  await fs.writeFile(path.join(project, 'src/container.js'), `import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const [output, file, format] = process.argv.slice(2);
const { video: v } = JSON.parse(fs.readFileSync(file));
const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=size=' + v.width + 'x' + v.height + ':rate=' + v.fps + ':duration=' + v.duration, '-an', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-f', format, output]);
process.exit(r.status ?? 1);
`);
  config.renderer = { command: 'node', args: ['src/container.js', '{output}', '{config}', 'matroska'] };
  await fs.writeFile(configFile, JSON.stringify(config));
  const before = await hash(path.join(project, 'public/data.json'));
  const failure = cli(project, ['render'], false);
  assert.match(failure.stderr, /H\.264 MP4 contract/);
  assert.match(failure.stderr, /matroska/);
  assert.deepEqual(await fs.readdir(path.join(project, 'runs')), []);
  assert.equal(await hash(path.join(project, 'public/data.json')), before);
  config.renderer.args[3] = 'mp4';
  await fs.writeFile(configFile, JSON.stringify(config));
  cli(project, ['render']);
  assert.equal((await json(path.join(project, 'public/data.json'))).versions[0].label, 'v001');
});
