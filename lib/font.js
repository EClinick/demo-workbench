import fs from 'node:fs';
import path from 'node:path';
import { envValue } from './process.js';

// Use an existing system font, never bundle/download fonts or rely on a Windows
// FFmpeg zip having a fontconfig installation. Fall back to FFmpeg's font lookup
// on less common systems; doctor explicitly reports that uncertainty.
export function labelFont() {
  const candidates = process.platform === 'win32'
    ? [path.join(envValue(process.env, 'WINDIR') || 'C:\\Windows', 'Fonts/arial.ttf')]
    : process.platform === 'darwin'
      ? ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc']
      : ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf'];
  return candidates.find(file => { try { fs.accessSync(file, fs.constants.R_OK); return true; } catch { return false; } });
}
export function drawtextFont(file = labelFont()) {
  // Two filter-parser layers: normalize Windows separators, protect drive colon.
  return file ? `fontfile='${file.replaceAll('\\', '/').replaceAll(':', '\\\\:')}':` : '';
}
