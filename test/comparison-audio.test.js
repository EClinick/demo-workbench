import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ffmpeg, hash, json, probe, run } from '../lib/common.js';
import { fakeNpm, withPath } from './helpers/process.js';
import { serve } from '../lib/serve.js';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
function pcm(file, filter) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', ...(filter ? ['-af', filter] : []), '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 4 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr.toString());
  return Array.from({ length: r.stdout.length / 4 }, (_, i) => r.stdout.readFloatLE(i * 4));
}
function correlation(a, b) {
  const n = Math.min(a.length, b.length, 16000);
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { ab += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return ab / Math.sqrt(aa * bb);
}
const frames = file => run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'framemd5', '-']);

test('comparison embeds only aligned candidate audio; silent fallback, frames and republication stay intact', { timeout: 120000 }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'demo-comparison-audio-'));
  if (process.env.DEMO_KEEP_TEST_OUTPUT) console.log(`PROOF_DIR=${temp}`);
  else t.after(() => fs.rm(temp, { recursive: true, force: true }));
  // Init's generated package has no dependencies. Stub npm rather than installing anything.
  const tools = path.join(temp, 'tools');
  await fakeNpm(tools, "console.log('10.0.0');");
  const env = withPath(tools + path.delimiter + process.env.PATH);
  const reference = path.join(temp, 'reference.mp4'), audio = path.join(temp, 'chirp.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=24000/1001:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=2100:duration=2', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', reference]);
  ffmpeg(['-f', 'lavfi', '-i', 'aevalsrc=0.3*sin(2*PI*(300*t+240*t*t)):s=48000:d=1.5', audio]);
  const projects = [];
  for (const audible of [true, false]) {
    const root = path.join(temp, audible ? 'audible' : 'silent'); projects.push(root);
    run(process.execPath, [cli, 'init', root, '--reference', reference, ...(audible ? ['--audio', audio] : [])], { env });
    for (const start of [0, 0.25]) {
      const config = await json(path.join(root, 'demo.json'));
      config.comparison.candidateStart = start;
      config.comparison.referenceStart = start ? 0.125 : 0;
      config.comparison.samples = 2;
      await fs.writeFile(path.join(root, 'demo.json'), JSON.stringify(config));
      // Exercise the freshly generated, frozen runtime (not just source imports).
      run(process.execPath, [path.join(root, '.workbench/bin/cli.js'), 'render'], { cwd: root });
      const id = start ? 'v002' : 'v001', dir = path.join(root, 'runs', id);
      const comparison = path.join(dir, 'comparison.mp4');
      const m = await json(path.join(dir, 'manifest.json'));
      assert.equal(probe(comparison).audio, audible, 'Side-by-side must carry the candidate soundtrack');
      assert.equal(probe(comparison).duration, m.evidence.duration);
      assert.equal(probe(comparison).width, 192);
      const streams = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', comparison])).streams;
      assert.equal(streams.filter(s => s.codec_type === 'audio').length, audible ? 1 : 0);
      assert.equal(Number(streams.find(s => s.codec_type === 'video').nb_frames), m.evidence.frames);
      if (audible) {
        const actual = pcm(comparison);
        const expected = pcm(path.join(dir, 'render.mp4'), `atrim=start=${start},asetpts=PTS-STARTPTS`);
        assert.ok(correlation(actual, expected) > 0.98, 'decoded soundtrack matches candidate at candidateStart, not referenceStart');
        if (start) assert.ok(Math.abs(correlation(actual, pcm(path.join(dir, 'render.mp4')))) < 0.1, 'nonzero offset really shifts audio');
        const tail = actual.slice(Math.ceil((1.65 - start) * 16000), Math.floor(m.evidence.duration * 16000));
        assert.ok(tail.length > 1000 && Math.max(...tail.map(Math.abs)) < 0.001, 'short soundtrack remains padded, never loops or truncates video');
      }
      const digest = await hash(comparison);
      await fs.rm(path.join(root, 'public/media', id), { recursive: true });
      run(process.execPath, [path.join(root, '.workbench/bin/cli.js'), 'compare', id], { cwd: root });
      assert.equal(await hash(comparison), digest);
      assert.equal(await hash(path.join(root, 'public/media', id, 'comparison.mp4')), digest);
    }
  }
  for (const id of ['v001', 'v002']) assert.equal(frames(path.join(projects[0], 'runs', id, 'comparison.mp4')), frames(path.join(projects[1], 'runs', id, 'comparison.mp4')), 'audio must not alter video frames or timestamps');
  const server = await serve(projects[0], 0); t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const data = await (await fetch(origin + '/data.json')).json();
  const url = origin + '/' + data.versions[0].sidebyside;
  const downloaded = path.join(temp, 'served-comparison.mp4');
  await fs.writeFile(downloaded, Buffer.from(await (await fetch(url)).arrayBuffer()));
  assert.equal(await hash(downloaded), await hash(path.join(projects[0], 'runs/v002/comparison.mp4')));
  assert.equal(probe(downloaded).audio, true);
  assert.equal((await fetch(url, { headers: { Range: 'bytes=20-39' } })).status, 206);
});
