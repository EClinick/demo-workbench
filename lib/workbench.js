import fs from 'node:fs/promises';
import path from 'node:path';
import { json, save, atomicJSON, exists, hash, run, probe, rate, ffmpeg, safePath, treeHashes, copyNew, lock } from './common.js';
import { validateVideo } from './init.js';

async function project(root) {
  root = await fs.realpath(root);
  const config = await json(await safePath(root, 'demo.json'));
  if (config.schema !== 1) throw new Error('Unsupported demo.json schema');
  validateVideo(config.video);
  for (const dir of ['runs', 'public', 'site', '.workbench']) await safePath(root, dir);
  return config;
}
function versionID(id) {
  if (!/^v\d{3,}$/.test(id || '')) throw new Error('Version must be v001, v002, …');
  return id;
}
async function version(root, id) {
  versionID(id);
  const dir = await safePath(root, `runs/${id}`);
  const manifest = await json(await safePath(dir, 'manifest.json'));
  for (const [file, expected] of Object.entries(manifest.sourceHashes)) {
    if (await hash(await safePath(dir, `source/${file}`)) !== expected) throw new Error(`Archived source changed: ${id}/${file}`);
  }
  for (const input of Object.values(manifest.inputs)) {
    if (await hash(await safePath(dir, `inputs/${path.basename(input.path)}`)) !== input.sha256) throw new Error(`Archived input changed: ${id}/${input.path}`);
  }
  if (await hash(await safePath(dir, 'config.json')) !== manifest.configSha256) throw new Error(`Archived render configuration changed: ${id}`);
  for (const [file, expected] of Object.entries(manifest.artifacts)) {
    if (await hash(await safePath(dir, file)) !== expected) throw new Error(`Archived artifact changed: ${id}/${file}. Refusing stale evidence.`);
  }
  return { dir, manifest };
}
async function inputsNow(root, config) {
  const inputs = {};
  for (const [name, input] of Object.entries(config.inputs)) {
    if (!['reference', 'audio'].includes(name)) throw new Error(`Unknown input: ${name}`);
    const p = await safePath(root, input.path);
    const facts = probe(p);
    if (name === 'reference' ? !facts.width : !facts.audio) throw new Error(`Invalid ${name} input`);
    inputs[name] = { path: input.path, sha256: await hash(p), facts };
  }
  return inputs;
}
function validateOutput(p, v, audio) {
  const facts = probe(p);
  if (!Number.isFinite(facts.duration) || facts.duration <= 0 || !Number.isFinite(rate(facts.fps)) || facts.codec !== 'h264' || facts.pixelFormat !== 'yuv420p' || facts.width !== v.width || facts.height !== v.height || Math.abs(rate(facts.fps) - rate(v.fps)) > 0.01 || Math.abs(facts.duration - v.duration) > 2 / rate(v.fps) + 0.03 || facts.audio !== audio) {
    throw new Error(`Renderer output does not satisfy the H.264 MP4 contract: ${JSON.stringify(facts)}; expected ${JSON.stringify(v)}, audio=${audio}`);
  }
  return facts;
}
const encode = ['-c:v', 'libx264', '-threads', '1', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
function fit(width, height, cap) {
  const w = Math.max(2, Math.floor(Math.min(width, cap) / 2) * 2);
  return { width: w, height: Math.max(2, Math.round(w * height / width / 2) * 2) };
}
async function packet(scratch, config, inputs, candidateHash) {
  if (!inputs.reference) return null;
  const c = config.comparison, v = config.video;
  if (![c.referenceStart, c.candidateStart].every(x => Number.isFinite(x) && x >= 0) || !Number.isInteger(c.samples) || c.samples < 1 || c.samples > 60 || !Number.isInteger(c.width) || c.width < 64 || c.width > 1920) throw new Error('Invalid comparison offsets, samples (1–60), or width (64–1920)');
  const fps = rate(v.fps);
  const available = Math.min(inputs.reference.facts.duration - c.referenceStart, v.duration - c.candidateStart);
  const frames = Math.floor(available * fps + 1e-6);
  if (frames < 1) throw new Error('Reference/candidate comparison has no overlapping frames.');
  const size = fit(v.width, v.height, c.width);
  const duration = frames / fps;
  const pairDir = path.join(scratch, 'packet'); await fs.mkdir(pairDir);
  const left = path.join(pairDir, 'reference-aligned.mp4'), right = path.join(pairDir, 'candidate-aligned.mp4');
  // Reset original timestamps, trim to each requested offset, then subtract that
  // exact offset (not the first retained frame's timestamp). Resample onto the SAME
  // zero-based rational grid before selecting common indices. No input -ss fast seek.
  for (const [src, start, dest, label] of [
    [path.join(scratch, 'inputs', path.basename(inputs.reference.path)), c.referenceStart, left, 'Reference'],
    [path.join(scratch, 'render.mp4'), c.candidateStart, right, 'Candidate']
  ]) {
    const filter = `setpts=PTS-STARTPTS,trim=start=${start},setpts=PTS-${start}/TB,fps=fps=${v.fps}:start_time=0:round=near,scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,drawtext=text='${label}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.8`;
    ffmpeg(['-i', src, '-vf', filter, '-frames:v', String(frames), '-an', ...encode, dest]);
  }
  const comparison = path.join(scratch, 'comparison.mp4');
  ffmpeg(['-i', left, '-i', right, '-filter_complex', '[0:v][1:v]hstack=inputs=2:shortest=1[v]', '-map', '[v]', '-an', ...encode, comparison]);
  const facts = probe(comparison);
  if (Math.abs(facts.duration - duration) > 2 / fps || facts.width !== size.width * 2) throw new Error('Comparison normalization failed');
  const indices = [...new Set(Array.from({ length: c.samples }, (_, i) => Math.floor(i * (frames - 1) / Math.max(1, c.samples - 1))))];
  const samples = [];
  for (const [i, index] of indices.entries()) {
    const file = `pair-${String(i + 1).padStart(3, '0')}.png`;
    ffmpeg(['-i', comparison, '-vf', `select=eq(n\\,${index})`, '-frames:v', '1', '-threads', '1', path.join(pairDir, file)]);
    samples.push({ file: `packet/${file}`, index, time: index / fps, referenceTime: c.referenceStart + index / fps, candidateTime: c.candidateStart + index / fps, sha256: await hash(path.join(pairDir, file)) });
  }
  // The aligned intermediate streams are scratch only, not part of the durable packet.
  await fs.unlink(left); await fs.unlink(right);
  const info = { schema: 1, referenceSha256: inputs.reference.sha256, candidateSha256: candidateHash, fps: v.fps, frames, duration, referenceStart: c.referenceStart, candidateStart: c.candidateStart, alignment: 'Original timestamps reset, decoded trim, requested offset subtracted, FFmpeg fps(start_time=0, round=near) to common rational grid; identical output indices. Source times are nominal sample requests, quantized to decoded frames (up to one source-frame interval). No optical/content auto-alignment.', comparisonSha256: await hash(comparison), width: size.width * 2, height: size.height, samples };
  await save(path.join(pairDir, 'packet.json'), info);
  return { ...info, sha256: await hash(path.join(pairDir, 'packet.json')) };
}
export async function render(root, options = {}) {
  const config = await project(root);
  return lock(root, async () => {
    const ids = (await fs.readdir(path.join(root, 'runs'))).filter(x => /^v\d{3,}$/.test(x));
    const next = Math.max(0, ...ids.map(x => Number(x.slice(1)))) + 1;
    const id = `v${String(next).padStart(3, '0')}`;
    if (options.version && options.version !== id) throw new Error(`Next immutable version is ${id}; existing versions cannot be replaced.`);
    const scratchBase = await safePath(root, '.workbench/scratch', { missing: true });
    await fs.mkdir(scratchBase, { recursive: true });
    const scratch = await fs.mkdtemp(path.join(scratchBase, `${id}-`));
    try {
      const inputs = await inputsNow(root, config);
      const sourceHashes = { ...await treeHashes(root, 'src'), ...await treeHashes(root, 'assets'), 'demo.json': await hash(path.join(root, 'demo.json')) };
      await fs.mkdir(path.join(scratch, 'source'));
      for (const name of ['src', 'assets', 'demo.json']) await copyNew(path.join(root, name), path.join(scratch, 'source', name));
      if (JSON.stringify(await json(path.join(scratch, 'source', 'demo.json'))) !== JSON.stringify(config)) throw new Error('Configuration changed before snapshot; retry with stable source.');
      await fs.mkdir(path.join(scratch, 'inputs'));
      for (const input of Object.values(inputs)) {
        const dest = path.join(scratch, 'inputs', path.basename(input.path));
        await fs.copyFile(path.join(root, input.path), dest, fs.constants.COPYFILE_EXCL);
        if (await hash(dest) !== input.sha256) throw new Error('Input changed during snapshot');
      }
      await save(path.join(scratch, 'config.json'), config);
      const raw = path.join(scratch, 'renderer.mp4');
      const renderer = config.renderer;
      if (!renderer || typeof renderer.command !== 'string' || !Array.isArray(renderer.args) || !renderer.args.every(x => typeof x === 'string') || !renderer.args.includes('{output}') || !renderer.args.includes('{config}')) throw new Error('renderer requires command and args containing {output} and {config}');
      run(renderer.command === 'node' ? process.execPath : renderer.command, renderer.args.map(x => x === '{output}' ? raw : x === '{config}' ? path.join(scratch, 'config.json') : x), { cwd: root, env: { ...process.env, DEMO_RENDER_WORKERS: '1' } });
      await safePath(scratch, 'renderer.mp4');
      validateOutput(raw, config.video, false);
      const final = path.join(scratch, 'render.mp4');
      if (inputs.audio) {
        ffmpeg(['-i', raw, '-i', path.join(scratch, 'inputs', path.basename(inputs.audio.path)), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', 'apad', '-t', String(config.video.duration), '-c:a', 'aac', '-movflags', '+faststart', final]);
      } else await fs.rename(raw, final);
      const facts = validateOutput(final, config.video, Boolean(inputs.audio));
      if (await exists(raw)) await fs.unlink(raw);
      const candidateHash = await hash(final);
      const size = fit(facts.width, facts.height, 960);
      ffmpeg(['-i', final, '-vf', `scale=${size.width}:${size.height},setsar=1`, ...encode, '-c:a', 'aac', path.join(scratch, 'web.mp4')]);
      validateOutput(path.join(scratch, 'web.mp4'), { ...config.video, ...size }, Boolean(inputs.audio));
      const evidence = await packet(scratch, config, inputs, candidateHash);
      if (inputs.reference) {
        ffmpeg(['-i', path.join(scratch, 'inputs', path.basename(inputs.reference.path)), '-vf', `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`, '-an', ...encode, path.join(scratch, 'reference-web.mp4')]);
      }
      // The renderer works in the project. Refuse provenance if source changed meanwhile.
      const after = { ...await treeHashes(root, 'src'), ...await treeHashes(root, 'assets'), 'demo.json': await hash(path.join(root, 'demo.json')) };
      if (JSON.stringify(after) !== JSON.stringify(sourceHashes)) throw new Error('Source changed during render; not publishing.');
      for (const [file, expected] of Object.entries(sourceHashes)) if (await hash(path.join(scratch, 'source', file)) !== expected) throw new Error('Source changed during snapshot; not publishing.');
      let git = { revision: null, dirty: true };
      try { git = { revision: run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim(), dirty: !!run('git', ['status', '--porcelain'], { cwd: root }).trim() }; } catch { /* A newly initialized repo has no HEAD. */ }
      const artifacts = {};
      for (const file of ['render.mp4', 'web.mp4', ...(evidence ? ['comparison.mp4', 'reference-web.mp4', 'packet/packet.json', ...evidence.samples.map(s => s.file)] : [])]) artifacts[file] = await hash(path.join(scratch, file));
      const manifest = { schema: 1, id, rendered: new Date().toISOString(), note: options.note || '', title: config.title, git, sourceHashes, inputs, video: facts, renderer, tools: { node: process.version, ffmpeg: run('ffmpeg', ['-version']).split('\n')[0] }, artifacts, outputSha256: candidateHash, configSha256: await hash(path.join(scratch, 'config.json')), packetSha256: evidence?.sha256 || null, evidence, review: 'pending' };
      await save(path.join(scratch, 'manifest.json'), manifest);
      const dest = path.join(root, 'runs', id);
      if (await exists(dest)) throw new Error(`Version already exists: ${id}`);
      await fs.rename(scratch, dest);
      await publish(root, config);
      console.log(`${id}: archived ${candidateHash}\nReview pending. ${evidence ? `Packet: runs/${id}/packet/packet.json` : 'No reference: comparison absent.'}`);
      return manifest;
    } catch (e) {
      await fs.writeFile(path.join(scratch, 'ERROR.txt'), e.stack + '\n').catch(() => {});
      throw new Error(`Render not published: ${e.message}\nInspect scratch ${scratch}. If an archive was completed before publication failed, run compare ${id} to retry publication; never reuse its number.`);
    }
  });
}
async function publish(root, config) {
  const ids = (await fs.readdir(path.join(root, 'runs'))).filter(x => /^v\d{3,}$/.test(x)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  const versions = [];
  const mediaRoot = await safePath(root, 'public/media', { missing: true });
  await fs.mkdir(mediaRoot, { recursive: true });
  for (const id of ids) {
    const { dir, manifest: m } = await version(root, id);
    const mediaDir = await safePath(root, `public/media/${id}`, { missing: true });
    await fs.mkdir(mediaDir, { recursive: true });
    for (const [file, expected] of Object.entries(m.artifacts)) {
      if (file.endsWith('.json')) continue;
      const dest = await safePath(root, `public/media/${id}/${file}`, { missing: true });
      await fs.mkdir(path.dirname(dest), { recursive: true });
      if (!await exists(dest)) await fs.copyFile(path.join(dir, file), dest, fs.constants.COPYFILE_EXCL);
      if (await hash(dest) !== expected) throw new Error(`Public artifact differs: ${id}/${file}; refusing replacement.`);
    }
    const reviewFile = path.join(dir, 'review.json');
    const review = await exists(reviewFile) ? await json(await safePath(dir, 'review.json')) : null;
    if (review && (review.outputSha256 !== m.outputSha256 || review.packetSha256 !== m.packetSha256)) throw new Error(`Review does not match ${id}`);
    const url = f => `media/${id}/${f}`;
    versions.push({ label: id, v: m.outputSha256, hash: m.git.revision, dirty: m.git.dirty, subject: m.note, render_date: m.rendered, resolution: `${m.video.width}×${m.video.height}`, width: m.video.width, height: m.video.height, fps: m.video.fps, duration: m.video.duration, size: (await fs.stat(path.join(dir, 'render.mp4'))).size, video: url('web.mp4'), download: url('render.mp4'), sidebyside: m.evidence ? url('comparison.mp4') : null, reference: m.evidence ? url('reference-web.mp4') : null, comparisonAspect: m.evidence ? `${m.evidence.width}/${m.evidence.height}` : null, sheets: m.evidence?.samples.map(s => url(s.file)) || [], outputSha256: m.outputSha256, packetSha256: m.packetSha256, scores: review?.critics.map(c => c.score) || null, review, changelog: review?.critics.map(c => `${c.name} (${c.model}): ${c.findings}`) || [] });
  }
  await atomicJSON(path.join(root, 'public', 'data.json'), { title: config.title, description: config.description, generated: new Date().toISOString(), versions });
}
export async function compare(root, id) {
  const config = await project(root);
  return lock(root, async () => {
    const { manifest: m } = await version(root, id);
    await publish(root, config);
    console.log(m.evidence ? `Immutable aligned evidence: runs/${id}/packet/packet.json\nPacket SHA-256: ${m.packetSha256}` : `${id} has no reference. No comparison fabricated; add a reference to demo.json and render a NEW version.`);
  });
}
export async function review(root, id, file) {
  const config = await project(root);
  if (!file) throw new Error('Usage: review VERSION --file REVIEW.json');
  return lock(root, async () => {
    const { dir, manifest: m } = await version(root, id);
    const r = await json(file);
    if (r.version !== id || r.outputSha256 !== m.outputSha256 || r.packetSha256 !== m.packetSha256) throw new Error('Review version/outputSha256/packetSha256 must match this exact archive (packetSha256 null when absent).');
    if (typeof r.rubric !== 'string' || !r.rubric.trim() || !Array.isArray(r.critics) || r.critics.length < 1 || r.critics.length > 20 || r.critics.some(c => !c || !['name', 'model', 'findings'].every(k => typeof c[k] === 'string' && c[k].trim()) || !Number.isFinite(c.score) || c.score < 0 || c.score > 10)) throw new Error('Review requires rubric and 1–20 critics with name, model, findings and numeric score 0–10.');
    const clean = { schema: 1, version: id, outputSha256: m.outputSha256, packetSha256: m.packetSha256, rubric: r.rubric, imported: new Date().toISOString(), critics: r.critics.map(({ name, model, score, findings }) => ({ name, model, score, findings })), mean: r.critics.reduce((s, c) => s + c.score, 0) / r.critics.length };
    await save(path.join(dir, 'review.json'), clean); // one explicit immutable review per output
    await publish(root, config);
    console.log(`${id}: review imported, mean ${clean.mean.toFixed(2)}. Media unchanged.`);
  });
}
export async function archive(root, id, target) {
  await project(root);
  if (!target) throw new Error('Usage: archive VERSION NEW-DESTINATION');
  return lock(root, async () => {
    const { dir } = await version(root, id);
    target = path.resolve(target);
    if (target === root || target.startsWith(root + path.sep)) throw new Error('Archive destination must be outside the project.');
    await fs.mkdir(target); // exclusive, preserve any partial output on failure
    await copyNew(dir, target);
    console.log(`Archived ${id} to ${target}. Includes source, private inputs, and review; do not publish this directory.`);
  });
}
