#!/usr/bin/env node
// node bridge                 MCP server over stdio (what opencode starts); also owns the bridge port
// node bridge wait [--timeout N]   block until the user acts in the panel, print actions as JSON, exit
// node bridge cancel          release every pending wait (prints {cancelled:n})
// node bridge status | serve | step <label> | highlight <selector> [--label t] [--text t] [--style spotlight] [--keep]
//             clear [id] | hide | show
import fs from 'node:fs';
import { call, ensureOwnerLoop, startOwner, log, PORT } from './core.js';
import { start as startBrowser, browserVersion } from '../scripts/browser.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Start the demo browser if needed and wait until its extension has connected to the bridge.
// force: also (re)open the side panel when it is closed.
async function ensureBrowser({ force = false } = {}) {
  const running = !!(await browserVersion());
  const panelOpen = running && (await call('GET', '/status').catch(() => null))?.panelOpen;
  const started = !running || (force && !panelOpen) ? await startBrowser() : null;
  let s = null;
  for (let i = 0; i < 60; i++) {
    s = await call('GET', '/status').catch(() => null);
    if (s?.extensionConnected) break;
    await sleep(250);
  }
  return { ...(started && { browser: started }), bridge: s };
}

const [cmd, ...rest] = process.argv.slice(2);
const opt = name => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : undefined; };
const VALUED = new Set(['--label', '--text', '--style', '--color', '--id', '--timeout', '--start']);
const positional = rest.filter((a, i) => !a.startsWith('--') && !VALUED.has(rest[i - 1]));
const out = o => process.stdout.write(JSON.stringify(o, null, 2) + '\n');

if (!cmd || cmd === 'mcp') await runMcp();
// serve: own the port without an MCP client, taking it over from an owner running older code.
else if (cmd === 'serve') { await ensureOwnerLoop(); setInterval(() => {}, 1 << 30); }
else {
  try { out(await runCli()); process.exit(0); }
  catch (e) { console.error('[demonstrate]', e.message); process.exit(1); }
}

async function runCli() {
  switch (cmd) {
    case 'wait': {
      const timeout = Math.max(1, +(opt('timeout') || 600));
      const wait = () => call('GET', `/wait?timeout=${timeout}`);
      try { return await wait(); } catch (e) { if (!/not running/.test(e.message)) throw e; }
      // No MCP instance owns the port: serve it from here until this wait is answered.
      // The extension reconnects within a few seconds and replays anything it buffered.
      await startOwner();
      log('no bridge was running; serving from this process for this wait');
      return wait();
    }
    case 'status': return call('GET', '/status');
    case 'start': return ensureBrowser({ force: true });
    case 'cancel': return call('POST', '/cancel');
    case 'step': return call('POST', '/cmd', { cmd: 'setStep', label: positional.join(' ') });
    case 'highlight': return call('POST', '/cmd', { cmd: 'highlight', keep: rest.includes('--keep'),
      item: { selector: positional[0], label: opt('label'), text: opt('text'), style: opt('style'), color: opt('color'), id: opt('id') } });
    case 'clear': return call('POST', '/cmd', { cmd: 'clearHighlights', id: positional[0] });
    case 'hide': return call('POST', '/cmd', { cmd: 'hideOverlays', hidden: true });
    case 'show': return call('POST', '/cmd', { cmd: 'hideOverlays', hidden: false });
    case 'tour': return call('POST', '/cmd', { cmd: 'loadTour', tour: JSON.parse(fs.readFileSync(positional[0], 'utf8')), start: +(opt('start') || 0) });
    case 'goto': return call('POST', '/cmd', { cmd: 'gotoStep', index: +positional[0] });
    case 'end': return call('POST', '/cmd', { cmd: 'endTour' });
    case 'request': return call('POST', '/cmd', { cmd: 'requestDemo', prompt: positional.join(' ') });
    default: throw new Error('unknown command: ' + cmd);
  }
}

async function runMcp() {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');

  await ensureOwnerLoop();

  const TOOLS = [
    { name: 'start_browser', description: 'Start the demo browser (Chrome for Testing with the demonstrate extension, CDP 127.0.0.1:9334) '
      + 'if it is not running, open the side panel, and wait until the extension is connected. Idempotent. Call it first in every tour, '
      + 'before any playwright-demo tool.',
    inputSchema: { type: 'object', properties: {} } },
    { name: 'load_tour', description: 'Hand the whole tour to the browser. Next/Back then run there without the agent '
      + '(navigation, actions, highlights, explanation in the side panel). Only questions, picks, agent steps, step errors '
      + 'and the end reach wait_for_action. Starts at step `start` (default 0).',
    inputSchema: { type: 'object', required: ['tour'], properties: {
      start: { type: 'number' },
      tour: { type: 'object', required: ['steps'], properties: { steps: { type: 'array', items: { type: 'object', required: ['title'], properties: {
        title: { type: 'string' },
        explanation: { type: 'string', description: '2-5 sentences shown in the side panel' },
        url: { type: 'string', description: 'Navigate here first; omit to continue on the current page' },
        actions: { type: 'array', description: '{click|fill|waitFor: css, text?, value?, after?: ms} or {wait: ms}', items: { type: 'object' } },
        highlights: { type: 'array', description: 'Same fields as highlight(); the first replaces, the rest are kept', items: { type: 'object' } },
        agent: { type: 'boolean', description: 'The agent performs this step itself (it receives an agentStep action)' },
      } } } } },
    } } },
    { name: 'request_demo', description: 'Ask the user to show something in the page ("Show me where you would expect the filter"). '
      + 'The panel shows the prompt and starts recording; the user acts, stops and sends. Then wait: you get a recording action '
      + 'with requestId and prompt (clicks, right clicks, double clicks, long presses, typing, keys, shortcuts, swipes, scrolls, '
      + 'navigations), or demoDeclined if the user discarded it.',
    inputSchema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' } } } },
    { name: 'goto_step', description: 'Jump the loaded tour to a step (0-based), replaying from the last navigation.',
      inputSchema: { type: 'object', required: ['index'], properties: { index: { type: 'number' } } } },
    { name: 'end_tour', description: 'Unload the tour: clears step, explanation and highlights.',
      inputSchema: { type: 'object', properties: {} } },
    { name: 'status', description: 'Bridge state: is the browser extension connected, is the side panel open, current step, queued actions.',
      inputSchema: { type: 'object', properties: {} } },
    { name: 'set_step', description: 'Show the current step in the side panel, e.g. "3/7 - Rechnung anlegen". Empty string clears it.',
      inputSchema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] } },
    { name: 'highlight', description: 'Draw a highlight around an element in the active tab (allowlisted hosts only) and scroll it into view. '
      + 'Replaces existing highlights unless keep=true. Returns whether the element was found. Highlights follow the element while it moves '
      + 'and disappear when the page path changes.',
    inputSchema: { type: 'object', required: ['selector'], properties: {
      selector: { type: 'string', description: 'CSS selector' },
      text: { type: 'string', description: 'Only match elements whose visible text contains this (case-insensitive); innermost match wins' },
      label: { type: 'string', description: 'Short callout shown next to the element' },
      style: { type: 'string', enum: ['outline', 'spotlight'], description: 'spotlight also dims the rest of the page (default outline)' },
      color: { type: 'string', description: 'CSS color (default Chrome blue #0b57d0)' },
      id: { type: 'string', description: 'Name for this highlight, to update or clear it later' },
      keep: { type: 'boolean', description: 'Keep existing highlights and add this one (default false)' },
      scroll: { type: 'boolean', description: 'Scroll the element into view if needed (default true)' },
    } } },
    { name: 'clear_highlights', description: 'Remove one highlight by id, or all highlights when id is omitted.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
    { name: 'hide_overlays', description: 'Temporarily hide (true) or show again (false) all highlights, e.g. around evidence screenshots. '
      + 'The side panel is browser UI and never appears in page screenshots.',
    inputSchema: { type: 'object', properties: { hidden: { type: 'boolean' } }, required: ['hidden'] } },
    { name: 'get_queue', description: 'Return and clear pending user actions without waiting.',
      inputSchema: { type: 'object', properties: {} } },
    { name: 'wait_for_action', description: 'Block until the user acts in the side panel (next/back/question/annotation/recording) and return the actions. '
      + 'A recording action carries the clicks, changes, keys, scrolls, swipes and navigations the user demonstrated. '
      + 'An annotation action includes the labelled screenshot inline. Prefer running `node bridge wait` as a background shell job.',
    inputSchema: { type: 'object', properties: { timeoutSec: { type: 'number', description: 'Default 600' } } } },
  ];

  const AUTOSTART = new Set(['set_step', 'highlight', 'clear_highlights', 'hide_overlays', 'load_tour', 'request_demo']);
  const server = new Server({ name: 'demonstrate', version: '1.2.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const a = req.params.arguments || {};
    try {
      if (AUTOSTART.has(req.params.name) && !(await browserVersion())) await ensureBrowser();
      switch (req.params.name) {
        case 'start_browser': return reply(await ensureBrowser({ force: true }));
        case 'status': return reply(await call('GET', '/status'));
        case 'load_tour': return reply(await call('POST', '/cmd', { cmd: 'loadTour', tour: a.tour, start: +(a.start || 0) }));
        case 'request_demo': return reply(await call('POST', '/cmd', { cmd: 'requestDemo', prompt: String(a.prompt || '') }));
        case 'goto_step': return reply(await call('POST', '/cmd', { cmd: 'gotoStep', index: +a.index }));
        case 'end_tour': return reply(await call('POST', '/cmd', { cmd: 'endTour' }));
        case 'set_step': return reply(await call('POST', '/cmd', { cmd: 'setStep', label: String(a.label ?? '') }));
        case 'highlight': return reply(await call('POST', '/cmd', { cmd: 'highlight', keep: !!a.keep, item: {
          selector: a.selector, text: a.text, label: a.label, style: a.style, color: a.color, id: a.id, scroll: a.scroll } }));
        case 'clear_highlights': return reply(await call('POST', '/cmd', { cmd: 'clearHighlights', id: a.id }));
        case 'hide_overlays': return reply(await call('POST', '/cmd', { cmd: 'hideOverlays', hidden: a.hidden !== false }));
        case 'get_queue': return withShots(await call('GET', '/queue'));
        case 'wait_for_action': {
          const t = Math.max(1, Math.min(86400, +(a.timeoutSec || 600)));
          return withShots(await call('GET', `/wait?timeout=${t}`, null, { signal: extra?.signal }));
        }
        default: return reply({ ok: false, error: 'unknown tool ' + req.params.name });
      }
    } catch (e) { return reply({ ok: false, error: String(e.message || e) }); }
  });
  await server.connect(new StdioServerTransport());
}

function reply(body) {
  return { isError: body?.ok === false, content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
}

// The labelled annotation image goes inline, so the model sees it without a file read. The user's own
// annotated image stays a path: the labelled copy already contains it.
function withShots(body) {
  const content = [{ type: 'text', text: JSON.stringify(body, null, 2) }];
  for (const act of body.actions || []) {
    for (const file of [act.labelledImagePath].filter(Boolean)) {
      try { content.push({ type: 'image', data: fs.readFileSync(file).toString('base64'), mimeType: file.endsWith('.jpg') ? 'image/jpeg' : 'image/png' }); } catch {}
    }
  }
  return { content };
}
