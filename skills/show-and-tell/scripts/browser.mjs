#!/usr/bin/env node
// node scripts/browser.mjs start|stop|panel|status
// Chrome for Testing runs as its own process on a dedicated profile with the show-and-tell extension
// loaded and a CDP port open; the Playwright MCP (--cdp-endpoint) and the bridge attach to it. It
// outlives every command. `start` is idempotent and also opens the show-and-tell side panel.
// Chrome for Testing, not branded Chrome: branded Chrome ignores --load-extension since v137.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cdpSession } from '../bridge/ws.js';
import { getJson, EXT_ID, DATA } from '../bridge/core.js';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(SKILL, 'extension');
const PORT = +(process.env.DEMO_CDP_PORT || 9334);
const PROFILE = process.env.DEMO_PROFILE || path.join(DATA, 'profile');
const INSTALL_HINT = 'Chrome for Testing not found; run `npx playwright install chromium` or set DEMO_BROWSER_PATH';

// Playwright's browser cache per OS, and the executable inside a chromium-<rev> folder.
const PW_CACHE = {
  win32: path.join(process.env.LOCALAPPDATA || os.homedir(), 'ms-playwright'),
  darwin: path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
}[process.platform] || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'ms-playwright');
const EXECUTABLES = {
  win32: ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'],
  darwin: ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium'],
}[process.platform] || ['chrome-linux64/chrome', 'chrome-linux/chrome'];

// Newest Playwright-managed Chromium build.
function findChromeForTesting() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || PW_CACHE;
  let dirs = [];
  try { dirs = fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d)); } catch { return null; }
  dirs.sort((a, b) => +b.split('-')[1] - +a.split('-')[1]);
  for (const d of dirs) {
    for (const rel of EXECUTABLES) {
      const exe = path.join(root, d, ...rel.split('/'));
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}
const BROWSER = process.env.DEMO_BROWSER_PATH || findChromeForTesting();
const BASE = `http://127.0.0.1:${PORT}`;

const log = (...m) => console.error('[show-and-tell]', ...m);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const version = () => getJson(`${BASE}/json/version`, 1500).catch(() => null);

async function start() {
  let reused = true;
  if (!(await version())) {
    if (!BROWSER) throw new Error(INSTALL_HINT);
    reused = false;
    fs.mkdirSync(PROFILE, { recursive: true });
    stampExtensionVersion();
    // The version stamp alone is not always honoured: Chrome can still serve the extension's old
    // background script from this cache. Nothing in the demo profile needs a cached service worker.
    fs.rmSync(path.join(PROFILE, 'Default', 'Service Worker'), { recursive: true, force: true });
    spawn(BROWSER, [`--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`,
      `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`,
      // Local dev hosts use self-signed certificates. Playwright's --ignore-https-errors does not reach
      // a browser it only attaches to over CDP, so the demo profile ignores certificate errors itself.
      '--ignore-certificate-errors',
      // "Annotate" captures the page through chrome.debugger; this hides the "is being debugged" bar.
      '--silent-debugger-extension-api',
      // Video recording captures the tour tab without a click on the extension icon first.
      `--allowlisted-extension-id=${EXT_ID}`,
      '--no-first-run', '--no-default-browser-check', '--start-maximized', 'about:blank'],
    { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 40 && !(await version()); i++) await sleep(250);
    if (!(await version())) throw new Error('browser did not open CDP on port ' + PORT);
  }
  let panel = false, panelError;
  try { await openPanel(); panel = true; } catch (e) { panelError = e.message; }
  return { ok: true, cdpEndpoint: BASE, reused, browser: BROWSER, profile: PROFILE, panel,
    ...(panelError && { panelError, hint: 'click the show-and-tell icon in the toolbar (puzzle menu) to open the side panel' }) };
}

// Chrome keeps an unpacked extension's service-worker script cached in the profile while the manifest
// version stays the same, so an edit on disk would not take effect on the next launch. The version is
// therefore derived from the newest file: 1.2.<day>.<minute of day>.
function stampExtensionVersion() {
  const files = [];
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (e.name !== 'manifest.json') files.push(p);
  } };
  walk(EXT);
  const newest = Math.max(...files.map(p => fs.statSync(p).mtimeMs));
  const day = Math.floor(newest / 86400000) % 65535, minute = Math.floor((newest % 86400000) / 60000);
  const file = path.join(EXT, 'manifest.json');
  const manifest = fs.readFileSync(file, 'utf8');
  const next = manifest.replace(/"version":\s*"[^"]*"/, `"version": "1.2.${day}.${minute}"`);
  if (next !== manifest) fs.writeFileSync(file, next);
}

// sidePanel.open() needs a real user gesture (CDP's userGesture flag is not enough, and attaching
// to the extension's service worker while it installs can kill it). So: open a helper extension
// tab and give it a trusted click through CDP Input; the page opens the panel and closes itself.
async function openPanel() {
  const v = await version();
  if (!v) throw new Error('browser not running');
  const browser = await cdpSession(v.webSocketDebuggerUrl);
  let targetId;
  try {
    ({ targetId } = await browser.send('Target.createTarget', { url: `chrome-extension://${EXT_ID}/open-panel.html` }));
    let page;
    for (let i = 0; i < 40 && page?.title !== 'show-and-tell:ready'; i++) {
      await sleep(250);
      page = (await getJson(`${BASE}/json/list`)).find(t => t.id === targetId);
    }
    if (page?.title !== 'show-and-tell:ready') {
      throw new Error('helper page did not load - is the show-and-tell extension loaded (--load-extension)?');
    }
    const s = await cdpSession(page.webSocketDebuggerUrl);
    try {
      for (const type of ['mousePressed', 'mouseReleased']) {
        await s.send('Input.dispatchMouseEvent', { type, x: 20, y: 20, button: 'left', clickCount: 1 });
      }
      for (let i = 0; i < 20; i++) {
        const { result } = await s.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }).catch(() => ({ result: { value: 'show-and-tell:opened' } }));
        if (result.value === 'show-and-tell:opened') return true;
        if (result.value.startsWith('show-and-tell:error')) throw new Error(result.value.slice('show-and-tell:error '.length));
        await sleep(150);
      }
      throw new Error('side panel did not confirm opening');
    } finally { s.close(); }
  } finally {
    if (targetId) await browser.send('Target.closeTarget', { targetId }).catch(() => {});
    browser.close();
  }
}

async function stop() {
  const v = await version();
  if (!v) return { ok: true, running: false };
  const cdp = await cdpSession(v.webSocketDebuggerUrl);
  await cdp.send('Browser.close').catch(() => {});
  cdp.close();
  return { ok: true, stopped: true };
}

async function status() {
  const v = await version();
  if (!v) return { running: false, cdpEndpoint: BASE };
  const pages = (await getJson(`${BASE}/json/list`)).filter(t => t.type === 'page').map(t => t.url);
  return { running: true, cdpEndpoint: BASE, browser: v.Browser, pages };
}

export { start, stop, status, openPanel, version as browserVersion };

// CLI only when run directly; the bridge imports start/status.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  const run = { start, stop, status, panel: async () => ({ ok: await openPanel() }) }[cmd];
  if (!run) { console.error('usage: node scripts/browser.mjs start|stop|panel|status'); process.exit(2); }
  run().then(r => { console.log(JSON.stringify(r, null, 2)); }, e => { log(e.message); process.exit(1); });
}
