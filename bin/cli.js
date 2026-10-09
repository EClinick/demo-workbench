#!/usr/bin/env node
import path from 'node:path';
import { init } from '../lib/init.js';
import { render, compare, review, archive } from '../lib/workbench.js';
import { serve } from '../lib/serve.js';
import { stopTailnet } from '../lib/tailnet.js';

const help = `demo-workbench (local-first; optional private tailnet)
  init NEW-PATH [--reference FILE] [--audio FILE] [--title TEXT]
       [--width EVEN] [--height EVEN] [--fps RATIONAL] [--duration SECONDS]
  render [--version v001] [--note TEXT]
  compare VERSION                    verify aligned packet and refresh gallery
  review VERSION --file REVIEW.json  import one exact-output structured review
  archive VERSION NEW-DESTINATION    copy private full-quality evidence bundle
  serve [--port 4173]                 loopback-only by default
        [--tailnet] [--tailnet-mode auto|direct|serve] [--tailnet-port PORT]
        [--tailscale PATH]            native or Windows Tailscale CLI
  serve --stop-tailnet [--tailscale PATH]  remove only this project's owned mapping

Run project commands inside the generated project. No agent, remote, commit or
server is started by init/render. See README.md for the MP4 and review contracts.`;
try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ['--help', '-h', 'help'].includes(command)) console.log(help);
  else {
    const allowed = { init: ['reference', 'audio', 'title', 'width', 'height', 'fps', 'duration'], render: ['version', 'note'], compare: [], review: ['file'], archive: [], serve: ['port', 'tailnet', 'tailnet-mode', 'tailnet-port', 'tailscale', 'stop-tailnet'] };
    if (!(command in allowed)) throw new Error(`Unknown command: ${command}\n${help}`);
    const options = {}, positional = [];
    for (let i = 0; i < args.length; i++) {
      if (!args[i].startsWith('--')) { positional.push(args[i]); continue; }
      const k = args[i].slice(2);
      if (!allowed[command].includes(k) || k in options) throw new Error(`Invalid/duplicate option: ${args[i]}`);
      if (['tailnet', 'stop-tailnet'].includes(k)) { options[k] = true; continue; }
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value: ${args[i]}`);
      options[k] = args[++i];
    }
    const counts = { init: 1, render: 0, compare: 1, review: 1, archive: 2, serve: 0 };
    if (positional.length !== counts[command]) throw new Error(`Wrong arguments for ${command}\n${help}`);
    const root = path.resolve(process.cwd());
    if (command === 'init') await init(positional[0], options);
    if (command === 'render') await render(root, options);
    if (command === 'compare') await compare(root, positional[0]);
    if (command === 'review') await review(root, positional[0], options.file);
    if (command === 'archive') await archive(root, positional[0], positional[1]);
    if (command === 'serve') {
      if (options['stop-tailnet']) {
        if (Object.keys(options).some(k => !['stop-tailnet', 'tailscale'].includes(k))) throw new Error('--stop-tailnet cannot be combined with serving options.');
        await stopTailnet(root, options.tailscale);
      } else {
        const server = await serve(root, options.port === undefined ? 4173 : Number(options.port), { tailnet: options.tailnet, tailnetMode: options['tailnet-mode'], tailnetPort: options['tailnet-port'] === undefined ? undefined : Number(options['tailnet-port']), tailscale: options.tailscale });
        const shutdown = () => server.closeWorkbench().catch(e => { console.error(`Tailnet cleanup: ${e.message}`); process.exitCode = 1; });
        process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
      }
    }
  }
} catch (e) { console.error(`demo-workbench: ${e.message}`); process.exitCode = 1; }
