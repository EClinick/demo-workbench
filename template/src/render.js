import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { frame } from './scene.js';

const [output, configPath] = process.argv.slice(2);
if (!output || !configPath) throw new Error('Usage: node src/render.js OUTPUT.mp4 CONFIG.json');
const { video } = JSON.parse(await fs.readFile(configPath, 'utf8'));
const [n, d = 1] = String(video.fps).split('/').map(Number);
const fps = n / d;
const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n',
  '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${video.width}x${video.height}`,
  '-framerate', String(video.fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-threads', '1',
  '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output],
{ stdio: ['pipe', 'ignore', 'inherit'] });
const finished = new Promise((resolve, reject) => {
  ff.once('error', reject);
  ff.once('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}`)));
});
// Attach a rejection handler immediately while frames are produced.
finished.catch(() => {});
let pipeError;
ff.stdin.on('error', e => { pipeError = e; });
try {
  for (let index = 0; index < Math.ceil(video.duration * fps); index++) {
    if (pipeError) throw pipeError;
    const pixels = frame({ ...video, time: index / fps, index });
    if (!Buffer.isBuffer(pixels) || pixels.length !== video.width * video.height * 3) throw new Error('scene.frame must return width*height*3 RGB bytes');
    if (!ff.stdin.write(pixels)) await once(ff.stdin, 'drain');
  }
  ff.stdin.end();
  await finished;
} catch (e) { ff.kill(); throw e; }
