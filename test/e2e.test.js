import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hash, json } from '../lib/common.js';
import { serve } from '../lib/serve.js';
import { JSDOM } from 'jsdom';
import { assertGalleryPrivacy } from './helpers/gallery.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'bin/cli.js');
function exec(cmd, args, cwd, ok = true, env = process.env) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: 90000 });
  if (ok) assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stdout}\n${r.stderr}\n${r.error || ''}`);
  else assert.notEqual(r.status, 0, 'command should refuse');
  return r;
}
const call = (args, cwd, ok = true, env) => exec(process.execPath, [cli, ...args], cwd, ok, env);
const ff = (args, cwd) => exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-threads', '1', '-filter_threads', '1', ...args], cwd);
async function change(p, fn) { const x = await json(p); fn(x); await fs.writeFile(p, JSON.stringify(x, null, 2)); }

// One clean outside-repository fixture tree. Retained only on demand for browser QA.
test('actual local install and complete isolated CLI workflow', { timeout: 180000 }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-workbench-e2e-'));
  if (process.env.DEMO_KEEP_TEST_OUTPUT) console.log(`PROOF_DIR=${temp}`);
  else t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const installer = path.join(temp, 'installer'); await fs.mkdir(installer);
  const tar = JSON.parse(exec('npm', ['pack', '--json', '--pack-destination', temp], repo).stdout)[0].filename;
  exec('npm', ['install', '--prefix', installer, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, tar)], temp);
  const installed = path.join(installer, 'node_modules', '.bin', 'demo-workbench');
  assert.match(exec(installed, ['--help'], installer).stdout, /local-first/);
  // Two aspect/rate classes from the source evidence, small synthetic fixtures.
  const refA = path.join(temp, 'four-three.mp4'), refB = path.join(temp, 'wide.mp4'), audio = path.join(temp, 'tone.wav');
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=24000/1001:duration=0.5', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', refA], temp);
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=192x108:rate=60:duration=0.5', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', refB], temp);
  ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', audio], temp);
  const refHash = await hash(refA);
  const a = path.join(temp, 'project-a'), b = path.join(temp, 'project-b');
  exec('git', ['init', '-b', 'main'], installer);
  exec('git', ['config', '--local', 'user.name', 'Synthetic Author'], installer);
  exec('git', ['config', '--local', 'user.email', 'synthetic@example.invalid'], installer);
  exec(installed, ['init', a, '--reference', refA, '--audio', audio, '--title', 'Four by three'], installer);
  assert.equal(exec('git', ['config', '--local', 'user.name'], a).stdout.trim(), 'Synthetic Author');
  assert.equal(exec('git', ['config', '--local', 'user.email'], a).stdout.trim(), 'synthetic@example.invalid');
  call(['init', b, '--reference', refB], temp);
  assert.equal(await hash(refA), refHash, 'intake never moves/modifies inputs');
  for (const p of [a, b]) {
    assert.equal(exec('git', ['branch', '--show-current'], p).stdout.trim(), 'main');
    exec('git', ['rev-parse', 'HEAD'], p, false);
    assert.equal(exec('git', ['remote'], p).stdout.trim(), '');
    exec('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], p);
    assert.deepEqual((await json(path.join(p, 'public/data.json'))).versions, []);
    const page = new JSDOM(await fs.readFile(path.join(p, 'public/index.html'), 'utf8'), { url: 'http://gallery.test/index.html' });
    assertGalleryPrivacy(page.window.document);
    page.window.close();
  }
  // Remove the local installation entirely: generated runtime cannot depend on it.
  await fs.rm(installer, { recursive: true });
  const projectCLI = p => path.join(p, '.workbench/bin/cli.js');
  exec(process.execPath, [projectCLI(a), 'render', '--note', 'First'], a);
  let m1 = await json(path.join(a, 'runs/v001/manifest.json'));
  assert.equal(m1.video.fps, '24000/1001'); assert.equal(m1.video.width / m1.video.height, 4 / 3); assert.equal(m1.video.audio, true);
  assert.equal(m1.video.pixelFormat, 'yuv420p');
  assert.equal(m1.inputs.reference.sha256, refHash);
  assert.equal(m1.evidence.samples.length, 6);
  for (const s of m1.evidence.samples) assert.ok(Math.abs(s.time - s.index / (24000 / 1001)) < 1e-9);
  assert.equal(m1.evidence.candidateSha256, m1.outputSha256);
  assert.equal(m1.evidence.referenceSha256, refHash);
  assert.equal((await json(path.join(a, 'public/data.json'))).versions[0].scores, null);
  call(['compare', 'v001'], a);
  // Private source/input snapshots are part of integrity checks too.
  const snapshot = path.join(a, 'runs/v001/source/src/scene.js');
  const originalSnapshot = await fs.readFile(snapshot);
  await fs.appendFile(snapshot, '\n// tamper test\n');
  assert.match(call(['compare', 'v001'], a, false).stderr, /Archived source changed/);
  await fs.writeFile(snapshot, originalSnapshot);
  const before = Object.fromEntries(await Promise.all(Object.keys(m1.artifacts).map(async f => [f, await hash(path.join(a, 'runs/v001', f))])));
  const review = { version: 'v001', outputSha256: m1.outputSha256, packetSha256: m1.packetSha256, rubric: 'Synthetic smoke rubric', critics: [{ name: 'Timing', model: 'manual-test', score: 7, findings: 'Synthetic fixture; not an artistic review.' }, { name: 'Motion', model: 'manual-test', score: 9, findings: '<script>not markup</script>' }] };
  const reviewFile = path.join(temp, 'review.json');
  await fs.writeFile(reviewFile, JSON.stringify({ ...review, outputSha256: '0'.repeat(64) }));
  assert.match(call(['review', 'v001', '--file', reviewFile], a, false).stderr, /must match/);
  await fs.writeFile(reviewFile, JSON.stringify(review));
  call(['review', 'v001', '--file', reviewFile], a);
  call(['review', 'v001', '--file', reviewFile], a, false);
  const reviewHash = await hash(path.join(a, 'runs/v001/review.json'));
  assert.equal((await json(path.join(a, 'public/data.json'))).versions[0].review.mean, 8);
  // Distinct next source; same FPS, changed alignment settings, correctly new packet.
  const scene = path.join(a, 'src/scene.js');
  await fs.writeFile(scene, (await fs.readFile(scene, 'utf8')).replace('[226, 38, 29]', '[29, 80, 226]'));
  await change(path.join(a, 'demo.json'), c => { c.comparison.referenceStart = 0.08; c.comparison.candidateStart = 0.04; });
  exec('npm', ['run', 'demo:render', '--', '--note', 'Second'], a);
  const m2 = await json(path.join(a, 'runs/v002/manifest.json'));
  assert.notEqual(m2.outputSha256, m1.outputSha256); assert.notEqual(m2.packetSha256, m1.packetSha256);
  assert.equal(m2.evidence.samples[0].referenceTime, 0.08);
  assert.equal(m2.evidence.samples[0].candidateTime, 0.04);
  const data = await json(path.join(a, 'public/data.json'));
  assert.equal(data.versions.length, 2); assert.equal(data.versions[0].scores, null); assert.equal(data.versions[1].review.mean, 8);
  for (const [f, h] of Object.entries(before)) assert.equal(await hash(path.join(a, 'runs/v001', f)), h);
  assert.equal(await hash(path.join(a, 'runs/v001/review.json')), reviewHash);
  call(['render', '--version', 'v001'], a, false);
  const publicHash = await hash(path.join(a, 'public/data.json'));
  const configA = await fs.readFile(path.join(a, 'demo.json'), 'utf8');
  await change(path.join(a, 'demo.json'), c => { c.renderer = { command: 'node', args: ['-e', 'process.exit(12)', '{output}', '{config}'] }; });
  assert.match(call(['render'], a, false).stderr, /Render not published/);
  assert.equal(await hash(path.join(a, 'public/data.json')), publicHash);
  assert.deepEqual((await fs.readdir(path.join(a, 'runs'))).sort(), ['v001', 'v002']);
  // A zero-exit renderer writing nothing cannot adopt old media.
  await change(path.join(a, 'demo.json'), c => { c.renderer = { command: 'node', args: ['-e', '', '{output}', '{config}'] }; });
  call(['render'], a, false);
  assert.equal(await hash(path.join(a, 'public/data.json')), publicHash);
  await fs.writeFile(path.join(a, 'demo.json'), configA);
  call(['render'], b);
  const mb = await json(path.join(b, 'runs/v001/manifest.json'));
  assert.equal(mb.video.fps, '60/1'); assert.equal(mb.video.width / mb.video.height, 16 / 9); assert.equal(mb.video.audio, false);
  assert.equal(await hash(path.join(a, 'site/index.html')), await hash(path.join(b, 'site/index.html')));
  // Different source/output FPS is normalized by time, not original frame number.
  await change(path.join(b, 'demo.json'), c => { c.video.fps = '24000/1001'; });
  call(['render'], b);
  const mb2 = await json(path.join(b, 'runs/v002/manifest.json'));
  assert.equal(mb2.evidence.fps, '24000/1001'); assert.equal(mb2.inputs.reference.facts.fps, '60/1');
  // Archive is a new private bundle; originals remain unchanged.
  const bundle = path.join(temp, 'bundle'); call(['archive', 'v001', bundle], a);
  assert.equal(await hash(path.join(bundle, 'render.mp4')), m1.outputSha256);
  assert.equal(await hash(path.join(bundle, 'review.json')), reviewHash);
  call(['archive', 'v001', bundle], a, false);
  // Intake preflight refusals must not create or touch targets.
  const missing = path.join(temp, 'missing-target');
  call(['init', missing, '--reference', path.join(temp, 'absent.mp4')], temp, false);
  await assert.rejects(fs.lstat(missing), { code: 'ENOENT' });
  call(['init', a], temp, false);
  const link = path.join(temp, 'target-link'); await fs.symlink(a, link);
  call(['init', link], temp, false); assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
  const broken = path.join(temp, 'dangling'); await fs.symlink('/nonexistent/demo-workbench', broken);
  call(['init', broken], temp, false);
  const noTools = path.join(temp, 'no-tools'); await fs.mkdir(noTools);
  assert.match(call(['init', missing], temp, false, { ...process.env, PATH: noTools }).stderr, /dependency git/);
  await assert.rejects(fs.lstat(missing), { code: 'ENOENT' });
  // Symlink input within a generated project must never be followed by render.
  const configB = await fs.readFile(path.join(b, 'demo.json'), 'utf8');
  await fs.symlink(refA, path.join(b, 'reference/escape.mp4'));
  await change(path.join(b, 'demo.json'), c => { c.inputs.reference.path = 'reference/escape.mp4'; });
  assert.match(call(['render'], b, false).stderr, /Symlink refused/);
  await fs.writeFile(path.join(b, 'demo.json'), configB);
  // No-reference project/empty state and silent rendering.
  const neutral = path.join(temp, 'neutral'); call(['init', neutral, '--width', '96', '--height', '128', '--duration', '0.1'], temp);
  call(['render'], neutral);
  assert.match(call(['compare', 'v001'], neutral).stdout, /no reference/);
  assert.equal((await json(path.join(neutral, 'public/data.json'))).versions[0].sidebyside, null);
  // Exercise the actual source dimensions too, but only a few synthetic frames.
  for (const video of [{ width: 2880, height: 2160, fps: '24000/1001', duration: 0.1 }, { width: 3840, height: 2160, fps: '60', duration: 0.05 }]) {
    await change(path.join(neutral, 'demo.json'), c => { c.video = video; });
    call(['render'], neutral);
    const latest = (await json(path.join(neutral, 'public/data.json'))).versions[0];
    assert.equal(latest.width, video.width); assert.equal(latest.height, video.height);
  }
  // Output-only serving, seeking, media types and privacy.
  const server = await serve(a, 0); t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal(server.address().address, '127.0.0.1');
  const web = '/media/v001/web.mp4';
  let r = await fetch(origin + web, { headers: { Range: 'bytes=0-31' } });
  assert.equal(r.status, 206); assert.equal(r.headers.get('content-type'), 'video/mp4'); assert.equal((await r.arrayBuffer()).byteLength, 32);
  const size = (await fs.stat(path.join(a, 'public' + web))).size;
  assert.equal(r.headers.get('content-range'), `bytes 0-31/${size}`);
  r = await fetch(origin + web, { headers: { Range: 'bytes=-12' } }); assert.equal((await r.arrayBuffer()).byteLength, 12);
  r = await fetch(origin + web, { headers: { Range: 'bytes=32-' } }); assert.equal((await r.arrayBuffer()).byteLength, size - 32);
  for (const range of ['bytes=99999999-', 'bytes=2-1', 'bytes=0-1,4-5', 'bytes=-0']) assert.equal((await fetch(origin + web, { headers: { Range: range } })).status, 416);
  r = await fetch(origin + web, { method: 'HEAD' }); assert.equal(r.status, 200); assert.equal(r.headers.get('content-length'), String(size)); assert.equal((await r.arrayBuffer()).byteLength, 0);
  for (const p of ['/.git/config', '/demo.json', '/src/scene.js', '/runs/v001/manifest.json', '/reference/reference.mp4', '/node_modules', '/media/v001/packet/packet.json', '/%2e%2e%2fdemo.json', '/%00', '/site/index.html']) assert.equal((await fetch(origin + p)).status, 404, p);
  assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
  // fetch/Undici normalizes Host; use the raw HTTP client to test this boundary.
  assert.equal(await new Promise((resolve, reject) => {
    http.get(origin, { headers: { Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  }), 403);
  // Allowed media route must still refuse file and ancestor-directory symlinks.
  const media = path.join(a, 'public/media');
  await fs.mkdir(path.join(media, 'v999'));
  await fs.symlink(path.join(a, 'demo.json'), path.join(media, 'v999/web.mp4'));
  assert.equal((await fetch(origin + '/media/v999/web.mp4')).status, 404);
  await fs.symlink(path.join(a, 'runs/v001'), path.join(media, 'v998'));
  assert.equal((await fetch(origin + '/media/v998/render.mp4')).status, 404);
  assert.match((await fetch(origin + '/theme.css')).headers.get('content-type'), /text\/css/);
  assert.equal((await fetch(origin + '/media/v001/packet/pair-001.png')).headers.get('content-type'), 'image/png');
  await new Promise(resolve => server.close(resolve));
  console.log('Verified: installed CLI, self-contained projects, 4:3 fractional FPS + 16:9 60 FPS, cross-FPS alignment, immutable outputs/review, failure isolation, reference-absent state, archive, Range and privacy.');
});
