#!/usr/bin/env node
import { init } from '../lib/init.js';
import { runCLI } from '../lib/cli.js';

await runCLI(init);
