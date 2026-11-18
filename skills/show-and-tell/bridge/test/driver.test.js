// browser_* tools reach Playwright MCP on the shared browser: the app tab is selected first, the
// window-level tools stay hidden, and a closed browser connection is replaced once.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDriver, parseTabs, describe } from '../driver.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sat-driver-'));
const flag = path.join(dir, 'crash');
process.env.FAKE_CRASH_FLAG = flag;
const fake = fileURLToPath(new URL('./fixtures/fake-playwright.js', import.meta.url));
let befores = 0;
const driver = createDriver({ outputDir: dir, command: [process.execPath, fake], before: async () => { befores++; } });
const out = r => r.content.map(c => c.text).join('\n');
after(async () => { await driver.reset(); fs.rmSync(dir, { recursive: true, force: true }); });

test('window-level tools are not offered', async () => {
  const names = (await driver.list()).map(t => t.name);
  assert.deepEqual(names.sort(), ['browser_click', 'browser_evaluate', 'browser_navigate', 'browser_snapshot', 'browser_tabs']);
  assert.equal((await driver.call('browser_close')).isError, true);
  assert.equal((await driver.call('browser_run_code_unsafe')).isError, true);
});

test('the guard sees the page a call acts on, or a navigation target; a refusal stops the call', async () => {
  const seen = [];
  const guarded = createDriver({ outputDir: dir, command: [process.execPath, fake],
    guard: async (url, why) => { seen.push([url, why]); return url.includes('remote') ? { ok: false, error: 'the user did not allow remote.zz' } : { ok: true }; } });
  try {
    assert.match(out(await guarded.call('browser_click', {})), /^clicked on http:\/\/localhost\/app/);
    const no = await guarded.call('browser_navigate', { url: 'https://remote.zz/' });
    assert.equal(no.isError, true);
    assert.match(out(no), /^Not allowed: the user did not allow remote\.zz/);
    assert.equal(out(await guarded.call('browser_navigate', { url: 'about:blank' })), 'ran browser_navigate');
    assert.deepEqual(seen, [['http://localhost/app', 'work on this page'], ['https://remote.zz/', 'open this page']]);
  } finally { await guarded.reset(); }
});

let firstPid;
test('a call runs in the app tab, not the side panel, after the before hook', async () => {
  const r = await driver.call('browser_click', { ref: 'e1' });
  assert.match(out(r), /^clicked on http:\/\/localhost\/app pid \d+$/);
  firstPid = out(r).split('pid ')[1];
  assert.ok(befores >= 1);
});

test('a closed browser connection is replaced and the call retried once', async () => {
  fs.writeFileSync(flag, '1');
  const r = await driver.call('browser_click', {});
  assert.equal(r.isError, undefined);
  assert.match(out(r), /^clicked on http:\/\/localhost\/app pid \d+$/);
  assert.notEqual(out(r).split('pid ')[1], firstPid, 'a new Playwright MCP process');
});

test('with session tabs, calls go to the session\'s own tab, found once, even among tabs with the same URL', async () => {
  const shop = 'http://localhost/shop';
  process.env.FAKE_TABS = JSON.stringify([{ title: 'panel', url: 'chrome-extension://abc/panel.html' },
    { title: 'A', url: shop, mark: '11' }, { title: 'B', url: shop, mark: '22' }]);
  const mine = createDriver({ outputDir: dir, command: [process.execPath, fake], tab: async () => ({ ok: true, tabId: 22, url: shop }) });
  try {
    assert.equal((await mine.list()).some(t => t.name === 'browser_tabs'), false, 'switching tabs would reach other sessions');
    assert.match(out(await mine.call('browser_snapshot')), /^tab 2 /);
    // Already on its tab: no further select, which would bring the tab to the front.
    const again = out(await mine.call('browser_snapshot'));
    const before = +again.split('selects ')[1];
    assert.equal(+out(await mine.call('browser_snapshot')).split('selects ')[1], before);
    const none = createDriver({ outputDir: dir, command: [process.execPath, fake], tab: async () => ({ ok: false, error: 'a video is being recorded by app 2' }) });
    try { assert.match(out(await none.call('browser_snapshot')), /video is being recorded by app 2/); } finally { await none.reset(); }
  } finally { await mine.reset(); delete process.env.FAKE_TABS; }
});

test('each call that goes ahead is described for the panel', () => {
  assert.equal(describe('browser_click', { element: 'Run query button' }, 'https://munin.zz:3000/explore'), 'clicking "Run query button" on munin.zz');
  assert.equal(describe('browser_evaluate', { function: 'async () => (await fetch("/api/x")).json()' }, 'https://munin.zz/'),
    'requesting data through the page (fetch) on munin.zz');
  assert.equal(describe('browser_evaluate', { function: '() => document.title' }, 'http://localhost/'), 'running code in the page on localhost');
  assert.equal(describe('browser_navigate', { url: 'https://munin.zz/' }, 'http://localhost/'), 'opening https://munin.zz/');
  assert.equal(describe('browser_something_new', {}, ''), 'something new');
});

test('tab listing is parsed', () => {
  assert.deepEqual(parseTabs('### Result\n- 0: (current) [x](chrome-extension://a/panel.html)\n- 1: [A [b]](https://h/p?q=(1))\n'),
    [{ index: 0, current: true, url: 'chrome-extension://a/panel.html' }, { index: 1, current: false, url: 'https://h/p?q=(1)' }]);
});
