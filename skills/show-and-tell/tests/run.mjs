// node tests/run.mjs [test[,test]] [sections] [--keep] [--clean]
// Copies the skill to a throwaway folder (see lib.mjs), stops that copy's test browser so the next check starts
// it with the new code, and runs tests/<name>.test.mjs (all when no name is given). `sections` limits a test
// to some of its run('…') blocks. --keep leaves the test browser running; --clean removes the copy and stops.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.dirname(here);
const { ROOT, SKILL, SHOTS, ENV } = await import('./lib-paths.mjs');
const args = process.argv.slice(2), flags = new Set(args.filter(a => a.startsWith('--')));
const [names, sections] = args.filter(a => !a.startsWith('--'));
const browser = cmd => spawnSync(process.execPath, [path.join(SKILL, 'scripts', 'browser.mjs'), cmd], { env: ENV, stdio: 'ignore' });

if (fs.existsSync(path.join(SKILL, 'scripts', 'browser.mjs'))) {
  if (!flags.has('--keep')) browser('stop');
}
if (flags.has('--clean')) {
  // The copy links to the repo's node_modules: remove the link first, never what it points to.
  fs.rmSync(path.join(SKILL, 'bridge', 'node_modules'), { force: true, recursive: false });
  fs.rmSync(ROOT, { recursive: true, force: true });
  console.log('removed ' + ROOT);
  process.exit(0);
}

// Sync: everything the skill runs, without dependencies, sources of vendored bundles, tests or local config.
const SKIP = new Set(['node_modules', 'vendor-src', 'ui-src', 'tests', 'config.local.json']);
const link = path.join(SKILL, 'bridge', 'node_modules');
if (fs.existsSync(link)) fs.rmSync(link, { force: true, recursive: false });
fs.rmSync(SKILL, { recursive: true, force: true });
fs.cpSync(src, SKILL, { recursive: true, filter: p => !SKIP.has(path.basename(p)) });
fs.symlinkSync(path.join(src, 'bridge', 'node_modules'), link, 'junction');
fs.writeFileSync(path.join(SKILL, 'extension', 'config.local.json'), JSON.stringify({ bridgeUrl: `ws://127.0.0.1:${ENV.DEMO_BRIDGE_PORT}/ext` }));
fs.mkdirSync(SHOTS, { recursive: true });

const all = fs.readdirSync(here).filter(f => f.endsWith('.test.mjs')).map(f => f.replace('.test.mjs', ''));
let failed = 0;
for (const name of names ? names.split(',') : all) {
  console.log(`\n### ${name}`);
  const r = spawnSync(process.execPath, [path.join(here, `${name}.test.mjs`), ...(sections ? [sections] : [])], { encoding: 'utf8', maxBuffer: 64 << 20 });
  // A tool result carries the watcher's boilerplate; it is noise here.
  let skip = false;
  for (const line of (r.stdout + r.stderr).split(/\r?\n/)) {
    if (/^\s*"watcher": \{/.test(line)) { skip = true; continue; }
    if (skip) { if (/^\s*\}/.test(line)) skip = false; continue; }
    console.log(line);
  }
  if (r.status !== 0 || /\bFAIL\b/.test(r.stdout)) failed++;
}
console.log(`\nscreenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);
