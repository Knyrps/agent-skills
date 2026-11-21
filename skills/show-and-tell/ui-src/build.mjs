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
await build({
  entryPoints: entries, outdir: out,
  bundle: true, format: 'esm', minify: true, target: 'chrome116', legalComments: 'eof',
  // Decorators and class fields the way Lit needs them come from tsconfig.json.
  tsconfig: path.join(here, 'tsconfig.json'),
});
console.log('wrote', fs.readdirSync(out).map(f => `ui/${f} (${fs.statSync(path.join(out, f)).size} B)`).join(', '));
