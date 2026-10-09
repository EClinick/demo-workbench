import fs from 'node:fs/promises';
import { json, save, safePath, exists, rate } from './common.js';

export function validateVideo(v) {
  if (![v.width, v.height].every(x => Number.isInteger(x) && x >= 2 && x <= 8192 && x % 2 === 0)) throw new Error('Video width/height must be even integers from 2 to 8192.');
  if (!(rate(v.fps) > 0 && rate(v.fps) <= 120) || !(Number.isFinite(v.duration) && v.duration > 0 && v.duration <= 600)) throw new Error('FPS must be >0 and <=120; duration must be >0 and <=600 seconds.');
}

export async function prepareProject(root) {
  root = await fs.realpath(root);
  const config = await json(await safePath(root, 'demo.json'));
  if (config.schema !== 1) throw new Error('Unsupported demo.json schema');
  validateVideo(config.video);
  for (const dir of ['site', '.workbench']) await safePath(root, dir);
  for (const dir of ['assets', 'runs', 'public']) {
    await fs.mkdir(await safePath(root, dir, { missing: true }), { recursive: true });
  }
  for (const name of ['index.html', 'theme.css', 'theme.js']) {
    const dest = await safePath(root, `public/${name}`, { missing: true });
    if (!await exists(dest)) await fs.copyFile(await safePath(root, `site/${name}`), dest, fs.constants.COPYFILE_EXCL);
  }
  const data = await safePath(root, 'public/data.json', { missing: true });
  if (!await exists(data)) await save(data, { title: config.title, description: config.description, generated: new Date().toISOString(), versions: [] });
  return config;
}
