// A normal JavaScript scene, not a scene DSL. Return an RGB24 Buffer per frame.
// Edit this file and assets/, or replace src/render.js using the documented MP4 contract.
export function frame({ width, height, time, duration }) {
  const paper = Buffer.from([238, 238, 235]);
  const accent = [226, 38, 29];
  const pixels = Buffer.alloc(width * height * 3, paper);
  const phase = time / duration;
  const cx = width * (0.2 + 0.6 * phase), cy = height / 2;
  const radius = Math.min(width, height) * (0.12 + 0.025 * Math.sin(phase * Math.PI * 4));
  // Fill paper natively, then visit only the shape bounds: one frame in memory,
  // no per-pixel allocations and no worker fan-out, even for 4K source dimensions.
  for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(height, cy + radius); y++) {
    const half = radius - Math.abs(y - cy);
    for (let x = Math.max(0, Math.ceil(cx - half)); x < Math.min(width, cx + half); x++) {
      const i = (y * width + x) * 3;
      pixels[i] = accent[0]; pixels[i + 1] = accent[1]; pixels[i + 2] = accent[2];
    }
  }
  for (let y = Math.ceil(height * 0.8); y < height * 0.81; y++) for (let x = 0; x < width * phase; x++) {
    const i = (y * width + x) * 3;
    pixels[i] = 21; pixels[i + 1] = 20; pixels[i + 2] = 19;
  }
  return pixels;
}
