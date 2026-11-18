// Drives the shared browser through Playwright MCP, run as a child process attached over CDP. Its
// browser_* tools are offered under this server, so one MCP entry covers pointing and driving. Before a
// call the shared browser is started if needed and the app tab is selected (the side panel is a tab
// too); after a browser restart the stale connection is replaced once.
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Closing or resizing would act on the user's window and the side panel; the user owns those. Raw
// Playwright code could open any site and slip past the host check.
export const HIDDEN = new Set(['browser_close', 'browser_resize', 'browser_run_code_unsafe']);
// Pages the tools may act on without a host check.
const BLANK = /^(about:blank|chrome:\/\/newtab\/?|chrome-extension:\/\/[a-p]{32}\/tab\.html(\?.*)?)$/;
const STALE = /has been closed|Target closed|not connected|ECONNREFUSED|Browser closed|disconnected/i;

function playwrightCli() {
  const pkg = require.resolve('@playwright/mcp/package.json');
  return path.join(path.dirname(pkg), require(pkg).bin['playwright-mcp']);
}

const text = r => (r?.content || []).map(c => c.text || '').join('\n');

// Tabs as Playwright MCP lists them: "- 0: (current) [Title](https://…)".
export function parseTabs(listing) {
  return [...listing.matchAll(/^- (\d+): (\(current\) )?\[.*?\]\((.*)\)\s*$/gm)]
    .map(m => ({ index: +m[1], current: !!m[2], url: m[3] }));
}

const hostOf = url => { try { return new URL(url).hostname; } catch { return ''; } };
const quote = s => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > 40 ? `"${s.slice(0, 39)}…"` : s ? `"${s}"` : ''; };

// What the user sees in the panel while a browser_* call runs, e.g. "clicking "Run query" on munin…".
export function describe(name, args = {}, page = '') {
  const el = quote(args.element) || 'an element';
  const what = {
    browser_navigate: () => `opening ${args.url}`,
    browser_navigate_back: () => 'going back',
    browser_snapshot: () => 'reading the page',
    browser_take_screenshot: () => 'taking a screenshot',
    browser_click: () => `${args.doubleClick ? 'double-clicking' : 'clicking'} ${el}`,
    browser_hover: () => `pointing at ${el}`,
    browser_type: () => `typing into ${el}`,
    browser_fill_form: () => 'filling in a form',
    browser_select_option: () => `choosing in ${el}`,
    browser_press_key: () => `pressing ${args.key}`,
    browser_drag: () => `dragging ${quote(args.startElement) || 'an element'}`,
    browser_drop: () => `dropping onto ${el}`,
    browser_file_upload: () => 'uploading a file',
    browser_handle_dialog: () => 'answering a dialog',
    browser_wait_for: () => 'waiting for the page',
    browser_find: () => 'searching the page',
    browser_console_messages: () => 'reading console messages',
    browser_network_requests: () => 'reading network requests',
    browser_network_request: () => 'reading a network request',
    browser_emulate_media: () => 'changing display settings',
    browser_tabs: () => (args.action === 'list' ? 'listing tabs' : `${args.action === 'new' ? 'opening' : args.action === 'close' ? 'closing' : 'switching'} a tab`),
    // Page code that calls fetch reads data with the user's session without anything visible changing.
    browser_evaluate: () => (/\bfetch\s*\(|XMLHttpRequest/.test(String(args.function || '')) ? 'requesting data through the page (fetch)' : 'running code in the page'),
  }[name]?.() || name.replace(/^browser_/, '').replace(/_/g, ' ');
  const host = name === 'browser_navigate' ? '' : hostOf(page);
  return host ? `${what} on ${host}` : what;
}

// guard(url, why) -> { ok, error }: whether the tools may work on that page (it may ask the user).
// onActivity(text): told before each call that goes ahead, for the panel's activity line.
// tab() -> { ok, tabId, url, error }: this session's own tab (the extension creates it on first use).
// Without it the calls go to the first app tab (single-session use, tests).
export function createDriver({ cdp, outputDir, before = async () => {}, guard = async () => ({ ok: true }),
  onActivity = () => {}, tab = null, command } = {}) {
  let client = null, connecting = null, tools = null, confirmed = null; // confirmed: Chrome tab id the child is on
  // With session tabs, switching tabs would act on (and bring up) another session's tab.
  const hidden = new Set([...HIDDEN, ...(tab ? ['browser_tabs'] : [])]);

  async function connect() {
    if (client) return client;
    connecting ||= (async () => {
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
      fs.mkdirSync(outputDir, { recursive: true });
      const [cmd, ...args] = command || [process.execPath, playwrightCli(), '--cdp-endpoint', cdp,
        '--ignore-https-errors', '--output-dir', outputDir];
      const c = new Client({ name: 'show-and-tell', version: '1.0.0' });
      // The full environment: the SDK's default passes only a few variables, which would drop proxy
      // settings and NODE_EXTRA_CA_CERTS.
      await c.connect(new StdioClientTransport({ command: cmd, args, cwd: outputDir, stderr: 'ignore', env: { ...process.env } }));
      c.onclose = () => { if (client === c) client = null; };
      client = c;
      return c;
    })().finally(() => { connecting = null; });
    return connecting;
  }

  async function reset() {
    const c = client;
    client = null;
    confirmed = null;
    await c?.close().catch(() => {});
  }

  // The tool list, fetched once; empty (with a log line) when Playwright MCP cannot start.
  async function list(log = () => {}) {
    if (tools) return tools;
    try { tools = (await (await connect()).listTools()).tools.filter(t => !hidden.has(t.name)); }
    catch (e) { log('browser_* tools unavailable: ' + (e.message || e)); return []; }
    return tools;
  }

  async function listTabs(c) {
    const r = await c.callTool({ name: 'browser_tabs', arguments: { action: 'list' } });
    if (r.isError && STALE.test(text(r))) throw new Error(text(r));
    return parseTabs(text(r));
  }
  const select = (c, index) => c.callTool({ name: 'browser_tabs', arguments: { action: 'select', index } });

  // Playwright's select brings a tab to the front, so it happens only when this child is not on the
  // session's tab yet (first call, after a reconnect, after the user closed the tab). Several tabs with
  // the same URL are told apart by the tab id the content script writes onto <html>.
  async function selectSessionTab(c) {
    let mine = await tab();
    for (let i = 0; i < 8; i++) {
      if (!mine?.ok) return { error: mine?.error || 'this session has no tab in the browser' };
      const tabs = await listTabs(c), same = tabs.filter(t => t.url === mine.url);
      const current = same.find(t => t.current);
      if (current && (same.length === 1 || confirmed === mine.tabId)) { confirmed = mine.tabId; return { url: mine.url }; }
      if (same.length === 1) { await select(c, same[0].index); confirmed = mine.tabId; return { url: mine.url }; }
      for (const t of same) {
        await select(c, t.index);
        const r = await c.callTool({ name: 'browser_evaluate', arguments: { function: '() => document.documentElement.getAttribute("data-show-and-tell-tab")' } });
        if (text(r).includes(`"${mine.tabId}"`)) { confirmed = mine.tabId; return { url: mine.url }; }
      }
      // The tab is still loading or Playwright has not seen it yet.
      await new Promise(r => setTimeout(r, 300));
      mine = await tab();
    }
    return { error: 'could not find this session\'s tab; call start_browser and try again' };
  }

  async function selectAppTab(c) {
    const tabs = await listTabs(c);
    const app = url => !url.startsWith('chrome-extension://') && !(url.startsWith('chrome://') && !BLANK.test(url));
    const current = tabs.find(t => t.current && app(t.url));
    if (current) return current.url;
    const target = tabs.find(t => app(t.url));
    if (target) await c.callTool({ name: 'browser_tabs', arguments: { action: 'select', index: target.index } });
    return target?.url || 'about:blank';
  }

  // The page a call acts on must be allowed; a navigation needs its target allowed instead (so the agent
  // can always leave a page), and going back or managing tabs is not checked.
  async function check(name, args, page) {
    let url = page, why = 'work on this page';
    if (name === 'browser_navigate') { url = String(args.url || ''); why = 'open this page'; }
    else if (name === 'browser_tabs') { if (args.action !== 'new' || !args.url) return null; url = String(args.url); why = 'open this page'; }
    else if (name === 'browser_navigate_back') return null;
    if (BLANK.test(url)) return null;
    const r = await guard(url, why);
    return r?.ok ? null : { isError: true, content: [{ type: 'text', text: `Not allowed: ${r?.error || url}. `
      + 'Ask the user to allow the host in the side panel; never edit the allowlist yourself.' }] };
  }

  async function attempt(name, args) {
    const c = await connect();
    let page = '';
    if (tab) {
      const r = await selectSessionTab(c);
      if (r.error) return { isError: true, content: [{ type: 'text', text: r.error }] };
      page = r.url;
    } else if (name !== 'browser_tabs') page = await selectAppTab(c);
    const denied = await check(name, args, page);
    if (denied) return denied;
    try { onActivity(describe(name, args, page)); } catch {}
    return c.callTool({ name, arguments: args });
  }

  async function call(name, args = {}) {
    if (hidden.has(name)) return { isError: true, content: [{ type: 'text', text: `${name} is not available on the shared browser` }] };
    await before();
    let r;
    try { r = await attempt(name, args); }
    catch (e) { if (!STALE.test(String(e.message || e)) && client) throw e; r = { isError: true, content: [{ type: 'text', text: String(e.message || e) }] }; }
    if (r.isError && STALE.test(text(r))) {
      await reset();
      r = await attempt(name, args);
    }
    return r;
  }

  return { list, call, reset };
}
