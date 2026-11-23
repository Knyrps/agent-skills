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

// Takes the content of embedded frames out of a snapshot: an "- iframe" line keeps its place, what is nested
// under it goes. seen collects the ref prefixes of the frames removed ("f3" of "f3e12"), so a call that names
// such a ref can be refused.
export function stripFrames(yaml, seen = new Set()) {
  const out = [];
  let inside = -1;
  for (const line of String(yaml).split('\n')) {
    const indent = line.search(/\S/);
    if (inside >= 0 && (indent > inside || indent < 0)) { for (const m of line.matchAll(/\[ref=(f\d+)e\d+\]/g)) seen.add(m[1]); continue; }
    inside = -1;
    const frame = /^(\s*)- iframe\b[^:]*(:?)\s*$/.exec(line);
    if (frame) { inside = indent; out.push(line.replace(/:\s*$/, '') + ': (content withheld: a site that is not allowed)'); continue; }
    out.push(line);
  }
  return out.join('\n');
}

// guard(url, why) -> { ok, error }: whether the tools may work on that page (it may ask the user).
// pageCheck() -> { ok, url, allowed, foreign: [hosts] }: where the session's tab is after a call, and which
// sites it embeds that are not allowed. The page a call ends on must be allowed too, or its result is withheld.
// onActivity(text): told before each call that goes ahead, for the panel's activity line.
// tab() -> { ok, tabId, url, error }: this session's own tab (the extension creates it on first use).
// Without it the calls go to the first app tab (single-session use, tests).
// pauseWait(signal, now) -> the pause the session's page is in (see the pause tool), or null: resolves
// when the page pauses, or at once with `now`.
export function createDriver({ cdp, outputDir, before = async () => {}, guard = async () => ({ ok: true }),
  onActivity = () => {}, tab = null, busy = async () => {}, pauseWait = null, pageCheck = null, command } = {}) {
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

  // Finding the session's tab is bookkeeping and answers at once; one that does not (a tab stuck on an error or a
  // dialog) fails with a clear message instead of keeping the agent's call waiting until its client gives up.
  const quick = (c, name, args) => c.callTool({ name, arguments: args }, undefined, { timeout: 15000 }).catch(e => {
    if (/timed out|timeout/i.test(String(e.message || e))) throw new Error(`the browser did not answer while looking for your tab (${name}); a tab may be stuck on an error page or a dialog. Call start_browser, or close the stuck tab, and try again`);
    throw e;
  });
  async function listTabs(c) {
    const r = await quick(c, 'browser_tabs', { action: 'list' });
    if (r.isError && STALE.test(text(r))) throw new Error(text(r));
    return parseTabs(text(r));
  }
  const select = (c, index) => quick(c, 'browser_tabs', { action: 'select', index });

  // Playwright's select brings a tab to the front, so it happens only when this child is not on the
  // session's tab yet (first call, after a reconnect, after the user closed the tab). Several tabs with
  // the same URL are told apart by the tab id the content script writes onto <html>.
  async function selectSessionTab(c) {
    let mine = await tab();
    for (let i = 0; i < 8; i++) {
      if (!mine?.ok) return { error: mine?.error || 'this session has no tab in the browser' };
      if (mine.paused) return { paused: mine.paused }; // before anything asks the page
      const armed = !!mine.armed;
      const tabs = await listTabs(c), same = tabs.filter(t => t.url === mine.url);
      const current = same.find(t => t.current);
      if (current && (same.length === 1 || confirmed === mine.tabId)) { confirmed = mine.tabId; return { url: mine.url, armed }; }
      if (same.length === 1) {
        await select(c, same[0].index);
        // Playwright had moved to another tab (it follows tabs the page opens); selecting back drops the
        // refs of the agent's last snapshot, so a ref error then gets an explanation.
        const drifted = confirmed === mine.tabId;
        confirmed = mine.tabId;
        return { url: mine.url, drifted, armed };
      }
      for (const t of same) {
        await select(c, t.index);
        const r = await quick(c, 'browser_evaluate', { function: '() => document.documentElement.getAttribute("data-show-and-tell-tab")' });
        if (text(r).includes(`"${mine.tabId}"`)) { confirmed = mine.tabId; return { url: mine.url, armed }; }
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
    if (target) await quick(c, 'browser_tabs', { action: 'select', index: target.index });
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
      + 'Only the user can allow a host, with a click in the side panel.' }] };
  }

  // A page stopped at a breakpoint (the pause tool) answers nothing, so Playwright would wait until it runs
  // again. A call on a paused page fails at once; a call that hits a breakpoint returns where it stopped.
  const NEXT = ' Look at it with inspect_paused and continue with resume. To use the browser tools on a waiting state, hold the request instead: pause({ on: "request", url, hold: true }).';
  const stoppedAt = p => `${p.reason}${p.reason.includes(p.where) ? '' : `, ${p.frames?.length ? 'at ' : ''}${p.where}`}${p.fn ? ` in ${p.fn}()` : ''}`;
  const stack = p => (p.frames?.length > 1 ? `\nCall stack: ${p.frames.map(f => `${f.fn} (${f.at})`).join(' < ')}` : '');
  let hung = null; // a call waiting for a paused page to run again

  // What a call gave back refers to files Playwright wrote next to it (snapshots, logs): "(./page-….yml)".
  const filesOf = r => [...text(r).matchAll(/\]\(\.\/([\w.:-]+)\)/g)].map(m => path.join(outputDir, path.basename(m[1])));
  const frameRefs = new Set(); // ref prefixes of frames whose content was withheld
  const strings = v => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);

  // After a call: the page it ended on must be allowed, and what it embeds from other sites is not the agent's.
  // A redirect, a link or a script can move an allowed page elsewhere; the check before the call cannot know.
  async function screen(name, r) {
    const pc = pageCheck ? await pageCheck().catch(() => null) : null;
    if (!pc?.ok) return r;
    if (pc.allowed === false && !BLANK.test(pc.url || '')) {
      for (const f of filesOf(r)) fs.rmSync(f, { force: true });
      return { isError: true, content: [{ type: 'text', text: `Not allowed: the page is now on ${hostOf(pc.url) || pc.url}, which the user has not allowed, so what ${name} returned is withheld. `
        + 'Go back (browser_navigate_back) or open an allowed page; only the user can allow a host, with a click in the side panel.' }] };
    }
    if (!pc.foreign?.length) return r;
    for (const f of filesOf(r)) { try { if (/\.ya?ml$/.test(f)) fs.writeFileSync(f, stripFrames(fs.readFileSync(f, 'utf8'), frameRefs)); } catch {} }
    const note = `The page embeds ${pc.foreign.join(', ')}, which the user has not allowed: the content of embedded frames is withheld and their elements cannot be used.`;
    return { ...r, content: [...(r.content || []).map(c => (c.type === 'text' && /- iframe\b/.test(c.text || '') ? { ...c, text: stripFrames(c.text, frameRefs) } : c)), { type: 'text', text: note }] };
  }

  async function attempt(name, args) {
    const used = strings(args).map(s => /^(f\d+)e\d+$/.exec(s)?.[1]).find(p => p && frameRefs.has(p));
    if (used) return { isError: true, content: [{ type: 'text', text: 'Not allowed: that element is inside an embedded frame of a site the user has not allowed.' }] };
    const c = await connect();
    let page = '', drifted = false, armed = false;
    if (tab) {
      const r = await selectSessionTab(c);
      if (r.paused) return { isError: true, content: [{ type: 'text', text: `The page is paused: ${stoppedAt(r.paused)}. ${name} cannot act on a paused page.${NEXT}` }] };
      if (r.error) return { isError: true, content: [{ type: 'text', text: r.error }] };
      page = r.url;
      drifted = !!r.drifted;
      armed = !!r.armed && !!pauseWait;
    } else if (name !== 'browser_tabs') page = await selectAppTab(c);
    const denied = await check(name, args, page);
    if (denied) return denied;
    try { onActivity(describe(name, args, page)); } catch {}
    // The call a pause cut short finishes first, so the two do not run into each other.
    if (hung) await Promise.race([hung, new Promise(r => setTimeout(r, 5000))]);
    // Input in the tab during this window is the agent's own, not the user's.
    await busy(true);
    let r;
    if (!armed) {
      try { r = await c.callTool({ name, arguments: args }); } finally { await busy(false); }
      r = await screen(name, r);
    } else {
      const running = c.callTool({ name, arguments: args });
      const ac = new AbortController();
      const stop = pauseWait(ac.signal);
      const first = await Promise.race([running.then(r => ({ r }), e => ({ e })), stop.then(p => (p ? { p } : new Promise(() => {})))]);
      if (first.p) {
        // The call stays open until the page runs again; what it does then still counts as the agent's.
        const h = hung = running.catch(() => {}).finally(() => { if (hung === h) hung = null; return busy(false); });
        return { content: [{ type: 'text', text: `The page paused during ${name}: ${stoppedAt(first.p)}.${stack(first.p)}\n${name} finishes once the page runs again; its result is not returned.${NEXT}` }] };
      }
      ac.abort();
      // It may have paused just as the call ended.
      const late = (await stop) || (await pauseWait(undefined, true));
      await busy(false);
      if (first.e) throw first.e;
      r = late ? first.r : await screen(name, first.r);
      if (late) r.content = [...(r.content || []), { type: 'text', text: `The page paused right after this call: ${stoppedAt(late)}.${stack(late)}${NEXT}` }];
    }
    if (drifted && r?.isError && /Ref .* not found/i.test(text(r))) r.content = [{ type: 'text', text: 'A tab opened from your page meanwhile, so the refs of your last snapshot are no longer valid (your calls still act on your working tab). Take a new browser_snapshot and use its refs.' }, ...(r.content || [])];
    return r;
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
