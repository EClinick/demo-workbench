import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const json = async p => JSON.parse(await fs.readFile(p, 'utf8'));
export const save = (p, data) => fs.writeFile(p, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
export async function atomicJSON(p, data) {
  const tmp = `${p}.${process.pid}.tmp`;
  await save(tmp, data);
  await fs.rename(tmp, p);
}
export async function exists(p) {
  try { await fs.lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
export async function hash(p) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(p)) digest.update(chunk);
  return digest.digest('hex');
}
export function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (r.error || r.status !== 0) throw new Error(`${cmd} failed: ${r.error?.message || r.stderr || `exit ${r.status}`}`);
  return r.stdout;
}
export function tools() {
  if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Node 18+ is required.');
  for (const [cmd, args] of [['git', ['--version']], ['npm', ['--version']], ['ffmpeg', ['-version']], ['ffprobe', ['-version']]]) {
    try { run(cmd, args); } catch (e) { throw new Error(`Missing/unusable dependency ${cmd}. Install it yourself, then retry. ${e.message}`); }
  }
  const filters = run('ffmpeg', ['-hide_banner', '-filters']);
  if (!filters.includes('drawtext')) throw new Error('FFmpeg with drawtext support is required for labelled comparisons.');
}
export function rate(s) {
  if (typeof s !== 'string' && typeof s !== 'number') return NaN;
  const parts = String(s).split('/');
  if (parts.length > 2 || parts.some(x => !/^\d+(\.\d+)?$/.test(x))) return NaN;
  return Number(parts[0]) / (parts.length === 2 ? Number(parts[1]) : 1);
}
export function probe(p) {
  const d = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', p]));
  const v = d.streams.find(s => s.codec_type === 'video');
  return { width: v?.width, height: v?.height, fps: v?.avg_frame_rate, duration: Number(v?.duration || d.format.duration), audio: d.streams.some(s => s.codec_type === 'audio'), codec: v?.codec_name, pixelFormat: v?.pix_fmt };
}
export function ffmpeg(args) {
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', ...args]);
}
// Refuse symlinks throughout owned trees. No source/path outside the project is followed.
export async function safePath(root, rel, { missing = false } = {}) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).some(x => x === '..' || x === '')) throw new Error(`Unsafe project path: ${rel}`);
  let p = root;
  for (const part of rel.split('/')) {
    p = path.join(p, part);
    try { if ((await fs.lstat(p)).isSymbolicLink()) throw new Error(`Symlink refused: ${p}`); }
    catch (e) { if (!(missing && e.code === 'ENOENT')) throw e; }
  }
  return p;
}
export async function treeHashes(root, rel) {
  const p = await safePath(root, rel);
  const st = await fs.lstat(p);
  if (st.isFile()) return { [rel]: await hash(p) };
  if (!st.isDirectory()) throw new Error(`Not a regular file/directory: ${p}`);
  let result = {};
  for (const name of (await fs.readdir(p)).sort()) Object.assign(result, await treeHashes(root, `${rel}/${name}`));
  return result;
}
export async function copyNew(src, dest) {
  const st = await fs.lstat(src);
  if (st.isSymbolicLink()) throw new Error(`Symlink refused: ${src}`);
  if (st.isDirectory()) {
    try { await fs.mkdir(dest); } catch (e) {
      if (e.code !== 'EEXIST' || !(await fs.lstat(dest)).isDirectory()) throw e;
    }
    for (const name of await fs.readdir(src)) await copyNew(path.join(src, name), path.join(dest, name));
  } else if (st.isFile()) await fs.copyFile(src, dest, fs.constants.COPYFILE_EXCL);
  else throw new Error(`Not a regular source: ${src}`);
}
export async function lock(root, fn) {
  const p = await safePath(root, '.workbench/operation.lock', { missing: true });
  let h;
  try { h = await fs.open(p, 'wx'); } catch (e) { throw new Error(`Project is locked (${p}). If no command is running, inspect and remove this lock manually. ${e.message}`); }
  await h.writeFile(`${process.pid}\n`);
  try { return await fn(); } finally { await h.close(); await fs.unlink(p); }
}
