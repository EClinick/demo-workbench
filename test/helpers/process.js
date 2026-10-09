import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { spawnCommandSync } from '../../lib/process.js';

export function withPath(prefix, env = process.env) {
  const out = Object.fromEntries(Object.entries(env).filter(([k]) => k.toLowerCase() !== 'path'));
  out.PATH = prefix;
  return out;
}
export const invoke = (cmd, args, options = {}) => spawnCommandSync(cmd, args, { encoding: 'utf8', timeout: 90000, ...options });

// Exercise the actual installed npm bin shim through the user's native shell,
// not by bypassing it with `node <installed-package>/bin/cli.js`.
export function installedBin(bin, args, options = {}) {
  if (process.platform !== 'win32') return invoke(bin, args, options);
  const env = { ...(options.env || process.env), WB_TEST_BIN: bin + '.cmd', WB_TEST_ARGS: JSON.stringify(args) };
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$a = @(ConvertFrom-Json $env:WB_TEST_ARGS); & $env:WB_TEST_BIN @a; exit $LASTEXITCODE'], { encoding: 'utf8', timeout: 90000, ...options, env });
}

export async function fakeNpm(dir, code) {
  await fs.mkdir(dir, { recursive: true });
  if (process.platform === 'win32') {
    await fs.writeFile(path.join(dir, 'npm.cmd'), '@echo off\r\n');
    const target = path.join(dir, 'node_modules/npm/bin');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'npm-cli.js'), code);
  } else {
    await fs.writeFile(path.join(dir, 'npm'), `#!${process.execPath}\n${code}`, { mode: 0o755 });
  }
}
