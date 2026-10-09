#!/usr/bin/env node
import path from 'node:path';
import { init } from '../lib/init.js';
import { render, compare, review, archive } from '../lib/workbench.js';
import { serve } from '../lib/serve.js';

const help = `demo-workbench (local only)
  init NEW-PATH [--reference FILE] [--audio FILE] [--title TEXT]
       [--width EVEN] [--height EVEN] [--fps RATIONAL] [--duration SECONDS]
  render [--version v001] [--note TEXT]
  compare VERSION                    verify aligned packet and refresh gallery
  review VERSION --file REVIEW.json  import one exact-output structured review
  archive VERSION NEW-DESTINATION    copy private full-quality evidence bundle
  serve [--port 4173]                 serve public/ on 127.0.0.1 only

Run project commands inside the generated project. No agent, remote, commit or
server is started by init/render. See README.md for the MP4 and review contracts.`;
try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || ['--help', '-h', 'help'].includes(command)) console.log(help);
  else {
    const allowed = { init: ['reference', 'audio', 'title', 'width', 'height', 'fps', 'duration'], render: ['version', 'note'], compare: [], review: ['file'], archive: [], serve: ['port'] };
    if (!(command in allowed)) throw new Error(`Unknown command: ${command}\n${help}`);
    const options = {}, positional = [];
    for (let i = 0; i < args.length; i++) {
      if (!args[i].startsWith('--')) { positional.push(args[i]); continue; }
      const k = args[i].slice(2);
      if (!allowed[command].includes(k) || k in options || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid/duplicate option: ${args[i]}`);
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
    if (command === 'serve') await serve(root, options.port === undefined ? 4173 : Number(options.port));
  }
} catch (e) { console.error(`demo-workbench: ${e.message}`); process.exitCode = 1; }
