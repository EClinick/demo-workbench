import { readFileSync } from 'node:fs';

// In an installation this is the package metadata; init copies its identity to
// .workbench/package.json so a generated runtime never reads the initializer.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const metadata = Object.freeze({ name: pkg.name, version: pkg.version, node: pkg.engines.node });
