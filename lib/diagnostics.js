import os from 'node:os';
import { run, executable } from './process.js';
import { metadata } from './metadata.js';
import { labelFont } from './font.js';
import { findTailscale, validateIdentity, directAddresses } from './tailnet.js';

const timeout = 5000;
const line = text => text.trim().split(/\r?\n/)[0];
export function prerequisiteChecks({ execute = run, locate = executable, env = process.env, identity = false } = {}) {
  const checks = [];
  const add = (id, fn, warning = false) => {
    try { checks.push({ id, status: 'ok', ...fn() }); }
    catch (e) { checks.push({ id, status: warning ? 'warning' : 'error', detail: e.message }); }
  };
  const command = (cmd, args) => execute(cmd, args, { env, timeout, maxBuffer: 2 * 1024 * 1024 });
  add('node', () => {
    if (Number(process.versions.node.split('.')[0]) < 18) throw new Error('Node 18+ is required. Install a supported Node LTS yourself.');
    return { path: process.execPath, detail: process.version };
  });
  for (const [name, args] of [['npm', ['--version']], ['git', ['--version']], ['ffmpeg', ['-version']], ['ffprobe', ['-version']]]) {
    add(name, () => {
      const toolPath = locate(name, { env }), detail = line(command(name, args));
      if (name === 'git') {
        const version = /^git version (\d+)\.(\d+)(?:\.|\s|$)/.exec(detail);
        if (!version || Number(version[1]) < 2 || (Number(version[1]) === 2 && Number(version[2]) < 28)) throw new Error(`Git 2.28+ is required; found ${detail || 'an unrecognized version'}. Update Git yourself before retrying.`);
      }
      return { path: toolPath, detail };
    });
  }
  // Check all capabilities independently; do not stop at the first missing tool.
  let filters, encoders;
  if (checks.find(c => c.id === 'ffmpeg').status === 'ok') {
    try { filters = command('ffmpeg', ['-hide_banner', '-filters']); } catch (e) { filters = e; }
    try { encoders = command('ffmpeg', ['-hide_banner', '-encoders']); } catch (e) { encoders = e; }
  }
  for (const [id, output, name] of [['ffmpeg.drawtext', filters, 'drawtext'], ['ffmpeg.libx264', encoders, 'libx264'], ['ffmpeg.aac', encoders, 'aac']]) {
    add(id, () => {
      if (output instanceof Error) throw output;
      if (typeof output !== 'string' || !new RegExp(`^\\s*[.A-Z|]{2,6}\\s+${name}\\s`, 'm').test(output)) throw new Error(`FFmpeg with ${name} support is required. Select a build with this capability; no OS installation is automatic.`);
      return { detail: `${name} available (capability listing, not a render/font smoke test)` };
    });
  }
  if (identity) add('git.identity', () => {
    const name = command('git', ['config', '--get', 'user.name']).trim();
    const email = command('git', ['config', '--get', 'user.email']).trim();
    if (!name || !email) throw new Error('Git author identity is unset. Configure it yourself before committing; init remains available.');
    return { detail: 'Caller Git identity is configured (values not printed).' };
  }, true);
  return checks;
}
export function requireTools() {
  const failures = prerequisiteChecks().filter(c => c.status === 'error');
  if (failures.length) throw new Error(`Prerequisites failed:\n${failures.map(c => `${c.id}: ${c.detail}`).join('\n')}\nRun demo-workbench doctor for all checks.`);
}
export async function diagnose(options = {}) {
  const checks = prerequisiteChecks({ identity: true });
  const font = labelFont();
  checks.push({ id: 'ffmpeg.font', status: font ? 'ok' : 'warning', ...(font ? { path: font } : {}), detail: font ? 'Existing system font for comparison labels; no fonts bundled.' : 'No known system label font found. FFmpeg must resolve its default font; a reference render is needed to verify it.' });
  if (options.tailscale && !options.tailnet) throw new Error('--tailscale requires doctor --tailnet.');
  if (options.tailnet) {
    let client;
    try {
      client = await findTailscale(options.tailscale);
      checks.push({ id: 'tailscale', status: 'ok', path: client, detail: line(run(client, ['version'], { timeout })) });
    } catch (e) { checks.push({ id: 'tailscale', status: 'error', detail: e.message }); }
    for (const [id, args, inspect] of [
      ['tailscale.identity', ['status', '--json'], text => {
        const self = validateIdentity(JSON.parse(text));
        return directAddresses(self).length ? 'Online self identity/MagicDNS; native interface available.' : 'Online self identity/MagicDNS; Serve bridge may be needed (not configured or tested).';
      }],
      ['tailscale.serve', ['serve', '--help'], text => {
        if (!text.includes('--bg') || !text.includes('--http')) throw new Error('Tailscale Serve must support --bg and --http. Update it yourself if needed.');
        return 'Private HTTP Serve flags supported. No route or listener created.';
      }]
    ]) {
      try {
        if (!client) throw new Error('Tailscale client unavailable; not checked.');
        checks.push({ id, status: 'ok', detail: inspect(run(client, args, { timeout, maxBuffer: 2 * 1024 * 1024, includeStderr: id === 'tailscale.serve' })) });
      } catch (e) { checks.push({ id, status: 'error', detail: e.message }); }
    }
  } else checks.push({ id: 'tailscale', status: 'optional', detail: 'Not checked; local workflows do not require Tailscale. Use doctor --tailnet only when sharing is intended.' });
  return { tool: metadata, platform: process.platform, wsl: process.platform === 'linux' && /microsoft/i.test(os.release()), ok: !checks.some(c => c.status === 'error'), checks };
}
export async function doctor(options) {
  const report = await diagnose(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${metadata.name} ${metadata.version} — ${report.platform}${report.wsl ? ' (WSL)' : ''}`);
    for (const c of report.checks) console.log(`${c.status.toUpperCase()} ${c.id}${c.path ? ` [${c.path}]` : ''}: ${c.detail}`);
    console.log('Read-only checks only. Init runs a renderer smoke test; tailnet serving verifies its own route. Neither proves second-device access.');
  }
  if (!report.ok) process.exitCode = 1;
  return report;
}
