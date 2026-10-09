import path from 'node:path';
import { render, compare, review, archive } from './workbench.js';
import { serve } from './serve.js';
import { stopTailnet } from './tailnet.js';
import { doctor } from './diagnostics.js';
import { metadata } from './metadata.js';

export async function runCLI(initializer) {
  const initHelp = initializer ? `  init NEW-PATH [--reference FILE] [--audio FILE] [--title TEXT]
       [--width EVEN] [--height EVEN] [--fps RATIONAL] [--duration SECONDS]
` : '';
  const help = `demo-workbench (local-first; optional private tailnet)
  --version, -v                      installed / vendored runtime version
  doctor [--json]                     read-only aggregate prerequisite checks
         [--tailnet] [--tailscale PATH]  also check existing Tailscale; no login/routes
${initHelp}  render [--version v001] [--note TEXT]
  compare VERSION                    verify aligned packet and refresh gallery
  review VERSION --file REVIEW.json  import one exact-output structured review
  archive VERSION NEW-DESTINATION    copy private full-quality evidence bundle
  serve [--port 4173]                 loopback-only by default
        [--tailnet] [--tailnet-mode auto|direct|serve] [--tailnet-port PORT]
        [--tailscale PATH]            native or Windows Tailscale CLI
  serve --stop-tailnet [--tailscale PATH]  remove only this project's owned mapping

Run project commands inside the generated project. Rendering starts no agent,
remote, commit or server. See README.md for the MP4 and review contracts.`;
  try {
    const [command, ...args] = process.argv.slice(2);
    if (!command || ['--help', '-h', 'help'].includes(command)) console.log(help);
    else if (['--version', '-v'].includes(command)) {
      if (args.length) throw new Error('--version takes no arguments.');
      console.log(`${metadata.name} ${metadata.version}`);
    } else {
      const commands = {
        doctor: { options: ['json', 'tailnet', 'tailscale'], count: 0, run: (root, args, options) => doctor(options) },
        render: { options: ['version', 'note'], count: 0, run: (root, args, options) => render(root, options) },
        compare: { options: [], count: 1, run: (root, args) => compare(root, args[0]) },
        review: { options: ['file'], count: 1, run: (root, args, options) => review(root, args[0], options.file) },
        archive: { options: [], count: 2, run: (root, args) => archive(root, args[0], args[1]) },
        serve: { options: ['port', 'tailnet', 'tailnet-mode', 'tailnet-port', 'tailscale', 'stop-tailnet'], count: 0, run: async (root, args, options) => {
          if (options['stop-tailnet']) {
            if (Object.keys(options).some(k => !['stop-tailnet', 'tailscale'].includes(k))) throw new Error('--stop-tailnet cannot be combined with serving options.');
            await stopTailnet(root, options.tailscale);
          } else {
            const server = await serve(root, options.port === undefined ? 4173 : Number(options.port), { tailnet: options.tailnet, tailnetMode: options['tailnet-mode'], tailnetPort: options['tailnet-port'] === undefined ? undefined : Number(options['tailnet-port']), tailscale: options.tailscale });
            const shutdown = () => server.closeWorkbench().catch(e => { console.error(`Tailnet cleanup: ${e.message}`); process.exitCode = 1; });
            process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
          }
        } }
      };
      if (initializer) commands.init = { options: ['reference', 'audio', 'title', 'width', 'height', 'fps', 'duration'], count: 1, run: (root, args, options) => initializer(args[0], options) };
      if (!Object.hasOwn(commands, command)) throw new Error(`Unknown command: ${command}\n${help}`);
      const selected = commands[command];
      const options = {}, positional = [];
      for (let i = 0; i < args.length; i++) {
        if (!args[i].startsWith('--')) { positional.push(args[i]); continue; }
        const k = args[i].slice(2);
        if (!selected.options.includes(k) || k in options) throw new Error(`Invalid/duplicate option: ${args[i]}`);
        if (['tailnet', 'stop-tailnet', 'json'].includes(k)) { options[k] = true; continue; }
        if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value: ${args[i]}`);
        options[k] = args[++i];
      }
      if (positional.length !== selected.count) throw new Error(`Wrong arguments for ${command}\n${help}`);
      await selected.run(path.resolve(process.cwd()), positional, options);
    }
  } catch (e) { console.error(`demo-workbench: ${e.message}`); process.exitCode = 1; }
}
