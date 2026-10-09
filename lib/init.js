import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, probe, rate, hash, run, save, copyNew } from './common.js';
import { requireTools } from './diagnostics.js';
import { metadata } from './metadata.js';
import { prepareProject, validateVideo } from './project.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function init(target, options) {
  if (!target) throw new Error('Usage: demo-workbench init NEW-PATH [--reference FILE] [--audio FILE]');
  target = path.resolve(target);
  if (await exists(target)) throw new Error(`Target already exists (including symlinks): ${target}`);
  requireTools();
  // Use the caller's effective identity (including repository-local config), never
  // an agent/bot identity and never a global write. Missing identity is harmless
  // for an uncommitted repo and is reported rather than invented.
  let identity = null;
  try {
    const name = run('git', ['config', '--get', 'user.name']).trim();
    const email = run('git', ['config', '--get', 'user.email']).trim();
    if (name && email) identity = { name, email };
  } catch { /* No configured caller identity. */ }
  const inputs = {};
  for (const name of ['reference', 'audio']) {
    if (!options[name]) continue;
    const p = path.resolve(options[name]);
    const st = await fs.stat(p).catch(() => { throw new Error(`Missing ${name} input: ${p}`); });
    if (!st.isFile()) throw new Error(`${name} must be a regular media file: ${p}`);
    const facts = probe(p);
    if (name === 'reference' ? !facts.width || !Number.isFinite(rate(facts.fps)) || !(facts.duration > 0) : !facts.audio) throw new Error(`Invalid ${name} media: ${p}`);
    inputs[name] = { source: p, path: `reference/${name}${path.extname(p).toLowerCase() || '.media'}`, sha256: await hash(p), facts };
  }
  const ref = inputs.reference?.facts;
  const video = { width: Number(options.width || ref?.width || 640), height: Number(options.height || ref?.height || 360), fps: String(options.fps || ref?.fps || '30'), duration: Number(options.duration || ref?.duration || 3) };
  validateVideo(video);
  const parent = path.dirname(target);
  await fs.access(parent); // Do not create unrelated parent trees.
  const staging = await fs.mkdtemp(path.join(parent, `.${path.basename(target)}.init-`));
  try {
    for (const d of ['.workbench', 'reference']) await fs.mkdir(path.join(staging, d));
    await copyNew(path.join(packageRoot, 'template', 'src'), path.join(staging, 'src'));
    await copyNew(path.join(packageRoot, 'template', 'site'), path.join(staging, 'site'));
    await fs.mkdir(path.join(staging, '.workbench', 'lib'));
    for (const name of (await fs.readdir(path.join(packageRoot, 'lib'))).filter(name => name !== 'init.js')) {
      await copyNew(path.join(packageRoot, 'lib', name), path.join(staging, '.workbench', 'lib', name));
    }
    await fs.mkdir(path.join(staging, '.workbench', 'bin'));
    await fs.copyFile(path.join(packageRoot, 'bin/project.js'), path.join(staging, '.workbench/bin/cli.js'));
    await save(path.join(staging, '.workbench/package.json'), { name: metadata.name, version: metadata.version, private: true, type: 'module', engines: { node: metadata.node } });
    await fs.copyFile(path.join(packageRoot, 'NOTICE.md'), path.join(staging, 'NOTICE.md'));
    for (const input of Object.values(inputs)) {
      await fs.copyFile(input.source, path.join(staging, input.path), fs.constants.COPYFILE_EXCL);
      if (await hash(path.join(staging, input.path)) !== input.sha256) throw new Error('Input changed while copying; retry with stable inputs.');
      delete input.source;
    }
    const config = { schema: 1, title: options.title || path.basename(target), description: 'A local motion study. Each render preserves its own evidence and review.', video, inputs,
      renderer: { command: 'node', args: ['src/render.js', '{output}', '{config}'] },
      comparison: { referenceStart: 0, candidateStart: 0, samples: 6, width: 480 },
      review: { target: 8, roundBudget: 3, rubric: 'Visual fidelity, timing, typography and motion. Scores are subjective, not a guarantee.' },
      starter: { name: metadata.name, version: metadata.version, galleryCommit: 'f4b701baa1030b08c677f4e6294ff8ecf777e985' } };
    await save(path.join(staging, 'demo.json'), config);
    const pkg = { name: 'local-demo', version: '0.0.0', private: true, type: 'module', engines: { node: metadata.node }, scripts: Object.fromEntries(['render', 'compare', 'review', 'archive', 'serve'].map(c => [`demo:${c}`, `node .workbench/bin/cli.js ${c}`])) };
    await save(path.join(staging, 'package.json'), pkg);
    await save(path.join(staging, 'package-lock.json'), { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { '': { name: pkg.name, version: pkg.version, engines: pkg.engines } } });
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--offline'], { cwd: staging });
    // Smoke-test the actual renderer with a tiny, one-frame config.
    const smoke = path.join(staging, '.workbench', 'smoke.json');
    await save(smoke, { ...config, video: { width: 64, height: 48, duration: 1 / 24, fps: '24' } });
    const smokeMP4 = path.join(staging, '.workbench', 'smoke.mp4');
    run(process.execPath, ['src/render.js', smokeMP4, smoke], { cwd: staging });
    if (probe(smokeMP4).width !== 64) throw new Error('Renderer smoke check failed');
    await fs.unlink(smoke); await fs.unlink(smokeMP4);
    await fs.writeFile(path.join(staging, '.gitignore'), 'node_modules/\nreference/\nruns/\npublic/\n.workbench/scratch/\n.workbench/operation.lock\n.workbench/tailnet.json\n*.tgz\n');
    for (const name of ['README.md', 'CLAUDE.md']) await fs.copyFile(path.join(packageRoot, 'template', name), path.join(staging, name));
    await prepareProject(staging);
    run('git', ['init', '-b', 'main'], { cwd: staging });
    if (identity) {
      run('git', ['config', '--local', 'user.name', identity.name], { cwd: staging });
      run('git', ['config', '--local', 'user.email', identity.email], { cwd: staging });
    }
    // Reserve with mkdir (exclusive), rather than rename over a raced-in empty target.
    await fs.mkdir(target);
    await copyNew(staging, target);
    await fs.rm(staging, { recursive: true });
    console.log(`Created ${target}\nTools and one-frame renderer verified. No commit or remote created.\n${identity ? 'Caller Git identity copied into project-local config.' : 'No caller Git identity found; configure this repo locally before committing. No identity invented.'}\ncd ${JSON.stringify(target)}\nnpm run demo:render\nnpm run demo:serve`);
  } catch (e) {
    await fs.writeFile(path.join(staging, 'INIT-ERROR.txt'), `${e.stack}\n`).catch(() => {});
    throw new Error(`Initialization failed: ${e.message}\nOwned staging retained at ${staging}. Any partial target is preserved; inspect it and choose a NEW target to retry.`);
  }
}
