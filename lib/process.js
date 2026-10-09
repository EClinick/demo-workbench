import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export function envValue(env, name) {
  return env[name] ?? Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}
export function executable(command, { env = process.env, cwd = process.cwd() } = {}) {
  const hasPath = /[/\\]/.test(command);
  const dirs = hasPath ? [''] : (envValue(env, 'PATH') || '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32' && !path.extname(command) ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of dirs) for (const ext of extensions) {
    const candidate = path.resolve(cwd, dir.replace(/^"|"$/g, ''), command + ext);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* Continue searching only the caller's PATH. */ }
  }
  throw new Error(`Missing/unusable dependency ${command}: executable not found on PATH. Install it yourself, then retry.`);
}

// Never pass user paths/renderer arguments through a shell. Node cannot execute
// npm.cmd directly (EINVAL); use npm's JS entry point next to the standard shim.
export function commandSpec(command, args, options = {}) {
  const file = executable(command, options);
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    if (/^npm(?:\.(cmd|bat))?$/i.test(path.basename(command))) {
      const cli = path.join(path.dirname(file), 'node_modules/npm/bin/npm-cli.js');
      if (fs.existsSync(cli)) return { file: process.execPath, args: [cli, ...args], resolved: file };
    }
    throw new Error(`Cannot safely execute batch shim ${file}. For npm, use a Node/npm installation with node_modules/npm/bin/npm-cli.js beside npm.cmd; for a renderer use an executable or node with a script argument.`);
  }
  // Also supports explicit trusted JS client fixtures on every OS (no shebang
  // support needed on Windows). The CLI never downloads or creates clients.
  if (/\.(?:cjs|mjs|js)$/i.test(file)) return { file: process.execPath, args: [file, ...args], resolved: file };
  return { file, args, resolved: file };
}
export function spawnCommandSync(command, args, options = {}) {
  try {
    const spec = commandSpec(command, args, options);
    return spawnSync(spec.file, spec.args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...options, shell: false });
  } catch (error) { return { status: null, stdout: '', stderr: '', error }; }
}
export function run(command, args, options = {}) {
  const { includeStderr = false, ...spawnOptions } = options;
  const r = spawnCommandSync(command, args, spawnOptions);
  if (r.error || r.status !== 0) throw new Error(`${command} failed: ${r.error?.message || r.stderr || `exit ${r.status}`}`);
  return r.stdout + (includeStderr ? r.stderr : '');
}
export async function runAsync(command, args, options = {}) {
  const spec = commandSpec(command, args, options);
  return (await exec(spec.file, spec.args, { encoding: 'utf8', windowsHide: true, ...options, shell: false })).stdout;
}
