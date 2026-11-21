// Builds the extension's UI: every src/pages/<name>.ts becomes ../extension/ui/<name>.js (one ESM bundle
// each, committed, so the extension runs without a build step). `npm run check` type-checks; this only bundles.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pages = path.join(here, 'src', 'pages');
const out = path.join(here, '..', 'extension', 'ui');
const entries = fs.readdirSync(pages).filter(f => f.endsWith('.ts')).map(f => path.join(pages, f));
if (!entries.length) { console.log('no pages in src/pages yet; nothing to build'); process.exit(0); }

fs.rmSync(out, { recursive: true, force: true });
const common = { bundle: true, minify: true, target: 'chrome116', legalComments: 'eof', tsconfig: path.join(here, 'tsconfig.json') };
// Extension pages: ES modules, one per page. Decorators and class fields the way Lit needs them come from tsconfig.json.
await build({ ...common, entryPoints: entries, outdir: out, format: 'esm' });
// The in-page UI for the content scripts (content.js, stage.js): a classic script, they cannot load modules.
await build({ ...common, entryPoints: [path.join(here, 'src', 'overlay', 'index.ts')], outfile: path.join(out, 'overlay.js'), format: 'iife' });
console.log('wrote', fs.readdirSync(out).map(f => `ui/${f} (${fs.statSync(path.join(out, f)).size} B)`).join(', '));
