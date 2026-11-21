#!/usr/bin/env node
// node bridge                 MCP server over stdio (what opencode starts); also owns the bridge port
// node bridge wait [--timeout N]   block until the user acts in the panel, print actions as JSON, exit
// node bridge cancel          release every pending wait (prints {cancelled:n})
// node bridge status | serve | step <label> | highlight <selector> [--label t] [--text t] [--style spotlight] [--keep]
//             clear [id] | hide | show
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { call, ensureOwnerLoop, startOwner, log, PORT, CDP_PORT, DATA } from './core.js';
import { createDriver } from './driver.js';
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
const VALUED = new Set(['--label', '--text', '--style', '--color', '--id', '--timeout', '--start', '--name', '--size', '--pace', '--out', '--zoom', '--gesture', '--direction', '--to', '--url',
  '--session', '--label', '--width', '--height', '--scale', '--download', '--upload', '--latency', '--cpu', '--change', '--line', '--column', '--condition', '--step', '--what', '--frame', '--reload']);
const NETWORK_PRESETS = ['fast-4g', 'slow-4g', '3g', 'offline'];
const GESTURES = ['tap', 'double-tap', 'long-press', 'swipe', 'pinch', 'click', 'double-click', 'right-click', 'hover', 'drag', 'scroll'];
const positional = rest.filter((a, i) => !a.startsWith('--') && !VALUED.has(rest[i - 1]));
const out = o => process.stdout.write(JSON.stringify(o, null, 2) + '\n');

if (!cmd || cmd === 'mcp') await runMcp();
// serve: own the port without an MCP client, taking it over from an owner running older code.
else if (cmd === 'serve') { await ensureOwnerLoop(); setInterval(() => {}, 1 << 30); }
else {
  try { out(await runCli()); process.exit(0); }
  catch (e) { console.error('[show-and-tell]', e.message); process.exit(1); }
}

async function runCli() {
  switch (cmd) {
    case 'wait': {
      const timeout = Math.max(1, +(opt('timeout') || 600));
      const q = new URLSearchParams({ timeout, ...(opt('session') && { session: opt('session') }), ...(opt('label') && { label: opt('label') }) });
      const wait = () => call('GET', `/wait?${q}`);
      try { return await wait(); } catch (e) { if (!/not running/.test(e.message)) throw e; }
      // No MCP instance owns the port: serve it from here until this wait is answered.
      // The extension reconnects within a few seconds and replays anything it buffered.
      await startOwner();
      log('no bridge was running; serving from this process for this wait');
      return wait();
    }
    case 'status': return call('GET', '/status');
    case 'start': return ensureBrowser({ force: true });
    case 'cancel': return call('POST', '/cancel', opt('session') ? { session: opt('session') } : {});
    case 'queue': return call('GET', '/queue' + (rest.includes('--recent') ? '?recent=1' : ''));
    case 'step': return call('POST', '/cmd', { cmd: 'setStep', label: positional.join(' ') });
    case 'highlight': return call('POST', '/cmd', { cmd: 'highlight', keep: rest.includes('--keep'),
      item: { selector: positional[0], label: opt('label'), text: opt('text'), style: opt('style'), color: opt('color'), id: opt('id'),
        gesture: opt('gesture'), direction: opt('direction'), to: opt('to'), url: opt('url') } });
    case 'clear': return call('POST', '/cmd', { cmd: 'clearHighlights', id: positional[0] });
    case 'hide': return call('POST', '/cmd', { cmd: 'hideOverlays', hidden: true });
    case 'throttle': return call('POST', '/cmd', { cmd: 'throttle', network: opt('download')
      ? { downloadKbps: +opt('download'), uploadKbps: opt('upload') && +opt('upload'), latencyMs: +(opt('latency') || 0) }
      : positional[0] || (opt('cpu') ? undefined : 'off'), cpu: opt('cpu') && +opt('cpu') });
    // device <phone|small-phone|tablet|off> | device --width n [--height n] [--scale n] [--touch] [--mobile]   (add --session s)
    case 'device': return call('POST', '/cmd', { cmd: 'device', session: opt('session'), preset: positional[0], width: opt('width') && +opt('width'), height: opt('height') && +opt('height'),
      scale: opt('scale') && +opt('scale'), touch: rest.includes('--touch') || undefined, mobile: rest.includes('--mobile') || undefined });
    // pause [--session s] request <url> [--hold [--after-input]] | dom <selector> [--change c] | line <text> | line --url u --line n | event <name> | now
    //       | list | remove <id|all>   (add --keep to pause more than once)
    case 'pause': {
      const [on, arg] = positional, base = { cmd: 'pause', session: opt('session'), once: !rest.includes('--keep') };
      if (!on || on === 'list') return call('POST', '/cmd', { ...base, list: true });
      if (on === 'remove') return call('POST', '/cmd', { ...base, remove: arg || 'all' });
      return call('POST', '/cmd', { ...base, on, url: opt('url') ?? (on === 'request' ? arg || '' : undefined), hold: rest.includes('--hold'), afterInput: rest.includes('--after-input') || undefined,
        selector: on === 'dom' ? arg : undefined, change: opt('change'), text: on === 'line' ? arg : undefined, line: opt('line') && +opt('line'),
        column: opt('column') && +opt('column'), condition: opt('condition'), event: on === 'event' ? arg : undefined });
    }
    // resume [--session s] [--step over|into|out] [--what page|requests] [--remove] [--reload again|skip|remove]
    case 'resume': return call('POST', '/cmd', { cmd: 'resume', session: opt('session'), step: opt('step'), what: opt('what'),
      remove: rest.includes('--remove') || undefined, reload: opt('reload') });
    // inspect [--session s] [expression] [--frame n]
    case 'inspect': return call('POST', '/cmd', { cmd: 'inspectPaused', session: opt('session'), expression: positional.join(' ') || undefined, frame: opt('frame') && +opt('frame') });
    case 'show': return call('POST', '/cmd', { cmd: 'hideOverlays', hidden: false });
    case 'tour': return call('POST', '/cmd', { cmd: 'loadTour', tour: JSON.parse(fs.readFileSync(positional[0], 'utf8')), start: +(opt('start') || 0) });
    case 'goto': return call('POST', '/cmd', { cmd: 'gotoStep', index: +positional[0] });
    case 'end': return call('POST', '/cmd', { cmd: 'endTour' });
    case 'request': return call('POST', '/cmd', { cmd: 'requestDemo', prompt: positional.join(' ') });
    // tabs --session s [select <id> | wait [--timeout ms] [--select]]
    case 'tabs': return call('POST', '/cmd', { cmd: 'tabs', session: opt('session'), action: positional[0] === 'select' ? 'select' : positional[0] === 'wait' ? 'waitForNew' : 'list',
      id: positional[1] && +positional[1], timeoutMs: opt('timeout') && +opt('timeout') * 1000, select: rest.includes('--select') });
    // say --session s <text>; the text may also come on stdin (`say --session s -`).
    case 'say': {
      const text = positional[0] === '-' ? fs.readFileSync(0, 'utf8') : positional.join(' ');
      return call('POST', '/say', { session: opt('session'), label: opt('label'), text });
    }
    case 'record': {
      if (!(await browserVersion())) await ensureBrowser();
      return call('POST', '/cmd', { cmd: 'recordTour', tour: JSON.parse(fs.readFileSync(positional[0], 'utf8')),
        name: opt('name'), size: opt('size'), pace: opt('pace') && +opt('pace'), out: opt('out'), zoom: opt('zoom') && +opt('zoom'), hidpi: !rest.includes('--no-hidpi'), captions: !rest.includes('--no-captions'), cards: !rest.includes('--no-cards') });
    }
    case 'record-stop': return call('POST', '/cmd', { cmd: 'recordStop' });
    case 'record-cancel': return call('POST', '/cmd', { cmd: 'recordStop', discard: true });
    default: throw new Error('unknown command: ' + cmd);
  }
}

async function runMcp() {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');

  await ensureOwnerLoop();

  // This agent session: what the user sends from the panel reaches it through a watcher, a `wait` job
  // the agent runs in the background. Tools that drive the browser claim the panel for this session.
  const SESSION = crypto.randomUUID().slice(0, 8);
  const LABEL = path.basename(process.cwd()).replace(/[^\w.-]+/g, '-').slice(0, 40) || 'agent';
  const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const WATCH = `node "${path.join(SKILL_DIR, 'bridge')}" wait --session ${SESSION} --label ${LABEL} --timeout 86400`;
  const cmd = body => call('POST', '/cmd', { ...body, session: SESSION, sessionLabel: LABEL });
  const hello = () => call('POST', '/hello', { session: SESSION, label: LABEL, pid: process.pid }).catch(() => {});
  hello();
  setInterval(hello, 30000).unref();
  const watcher = async () => {
    const s = await call('GET', '/status').catch(() => null);
    const running = !!s?.watching?.includes(SESSION);
    return running ? { running } : { running, command: WATCH,
      todo: 'Start this command now as a background shell job (no waiting on it); it wakes you when the user sends something from the browser.' };
  };
  // What the user did in this session's tab since the last call, so the agent does not act on a page
  // state that no longer holds. Read once; empty most of the time.
  const userActivity = async () => {
    const r = await call('GET', `/user-events?session=${SESSION}`).catch(() => null);
    return r?.events?.length ? r.events.map(e => e.text) : null;
  };
  const userNote = lines => 'The user worked in your browser tab since your last show-and-tell call:\n'
    + lines.map(l => '- ' + l).join('\n')
    + '\nThe page may have changed: re-read it (browser_snapshot) before relying on earlier refs or state.';
  const done = async body => {
    const user = await userActivity();
    return reply({ ...(user && { userActivity: user }), ...body, watcher: await watcher() });
  };
  // browser_* tools: Playwright MCP on the shared browser. Using them starts the browser and claims the
  // panel for this session, like the tools above.
  const driver = createDriver({ cdp: `http://127.0.0.1:${CDP_PORT}`, outputDir: path.join(DATA, 'playwright'),
    before: async () => {
      // Also right after a browser (re)start: wait until the extension is connected again.
      await ensureBrowser();
      await call('POST', '/claim', { session: SESSION, label: LABEL }).catch(() => {});
    },
    // Hosts that are not allowed are put to the user in the side panel; the call waits for the answer.
    guard: (url, why) => call('POST', '/host/check', { url, why, ask: true, session: SESSION }).catch(e => ({ ok: false, error: e.message })),
    // Each session works in its own tab, so parallel sessions don't navigate under each other.
    tab: () => call('POST', '/tab', { session: SESSION, label: LABEL }).catch(e => ({ ok: false, error: e.message })),
    busy: on => call('POST', '/busy', { session: SESSION, on }).catch(() => {}),
    // A call on a page with pause points returns when the page stops at one, instead of hanging.
    pauseWait: (signal, now) => call('GET', `/pause/wait?session=${SESSION}${now ? '&now=1' : ''}`, null, { signal }).then(r => r?.paused || null, () => null),
    // The panel shows what the agent does in the browser, also when nothing visible changes.
    onActivity: text => { call('POST', '/activity', { text, session: SESSION, label: LABEL }).catch(() => {}); } });

  const STEPS = { type: 'array', items: { type: 'object', required: ['title'], properties: {
    title: { type: 'string' },
    explanation: { type: 'string', description: '2-5 sentences shown in the side panel' },
    url: { type: 'string', description: 'Navigate here first; omit to continue on the current page' },
    actions: { type: 'array', items: { type: 'object' }, description: '{click|fill|waitFor|hover|doubleClick|rightClick|longPress|swipe|drag|scroll: css, '
      + 'text?, value? (fill), to? (drag/swipe end css), by? (drag offset [dx, dy] in px or "40%" of in), direction? (swipe), ms? (longPress/hover), touch? (finger instead of cursor), after?: ms}, {scrollBy: px|{x,y}, in?: css}, '
      + '{press: key, on?: css} or {wait: ms}. In a video a drawn cursor or finger performs them visibly. Tours only: {waitForTab: ms} after an action '
      + 'that opens a tab or popup moves the tour there; {backToTab: "previous"|"home", close?: true} returns (close: closes the tab it leaves). '
      + 'A video stops with videoError when a step opens a tab.' },
    section: { type: 'string', description: 'Video only: a section name; a section slide appears when it changes' },
    network: { type: 'string', enum: [...NETWORK_PRESETS, 'off'], description: 'Throttle the network from this step on, like DevTools; "off" ends it (so does the end of the tour or video)' },
    cpu: { type: 'number', description: 'CPU slowdown factor from this step on, like DevTools (4, 6, …); 1 ends it' },
    highlights: { type: 'array', description: 'Same fields as highlight() incl. gesture/direction/to; the first replaces, the rest are kept', items: { type: 'object' } },
    agent: { type: 'boolean', description: 'The agent performs this step itself (it receives an agentStep action)' },
    caption: { type: ['string', 'boolean'], description: 'Video only: subtitle text instead of explanation; false = none' },
    dwell: { type: 'number', description: 'Video only: ms the step stays on screen (default: reading time of the caption)' },
    video: { type: 'boolean', description: 'Video only: false runs the step off camera, e.g. a login' },
  } } };
  const TOOLS = [
    { name: 'start_browser', description: 'Start the shared browser (Chrome for Testing with the show-and-tell extension, CDP 127.0.0.1:9334) '
      + 'if it is not running, open the side panel, and wait until the extension is connected. Idempotent. Call it first in every tour; '
      + 'the browser_* tools also start it on their own.',
    inputSchema: { type: 'object', properties: {} } },
    { name: 'load_tour', description: 'Hand the whole tour to the browser. Next/Back then run there without the agent '
      + '(navigation, actions, highlights, explanation in the side panel). Only questions, picks, agent steps, step errors '
      + 'and the end reach wait_for_action. Starts at step `start` (default 0).',
    inputSchema: { type: 'object', required: ['tour'], properties: {
      start: { type: 'number' },
      tour: { type: 'object', required: ['steps'], properties: { steps: STEPS } },
    } } },
    { name: 'record_tour', description: 'Record a scripted tour as a video (MP4) for reviews: the browser plays every step by itself at '
      + 'reading pace while the tab is recorded, then the bridge writes the video, a .vtt subtitle file and a chapter list. '
      + 'Returns right away with the output size and an estimated duration; wait_for_action then delivers videoReady '
      + '{ path, vtt, chapters, durationMs, … } or videoError { step, error }. No agent steps allowed.',
    inputSchema: { type: 'object', required: ['tour'], properties: {
      tour: { type: 'object', required: ['steps'], properties: { title: { type: 'string' }, steps: STEPS } },
      name: { type: 'string', description: 'File name without extension' },
      size: { type: 'string', description: 'auto (default), 1080p, 900p, 720p or WIDTHxHEIGHT' },
      pace: { type: 'number', description: 'Scales reading time (default 1)' },
      captions: { type: 'boolean', description: 'Captions in the picture and a .vtt from each step\'s caption/explanation (default true)' },
      cards: { type: 'boolean', description: 'Intro card, section slides and outro card with the chapter list (default true)' },
      zoom: { type: 'number', description: 'Page zoom while recording, e.g. 0.8 to show the 1:1 desktop layout on a 125 % screen; restored afterwards' },
      hidpi: { type: 'boolean', description: 'Render the tab at a higher pixel density for up to 1080 lines of real detail (default true)' },
      out: { type: 'string', description: 'Also copy the video and sidecars to this file or folder' },
    } } },
    { name: 'stop_recording', description: 'Stop the video being recorded. discard=true deletes it; otherwise the part recorded so far is '
      + 'kept and delivered as videoReady with partial: true.',
    inputSchema: { type: 'object', properties: { discard: { type: 'boolean' } } } },
    { name: 'tabs', description: 'Your tabs in the shared browser: the one you started in plus every tab or popup window opened from them (by '
      + 'your clicks, the user or the page). Your browser_* calls, highlights and tours act on the working tab only; a new tab never '
      + 'takes over by itself, you are only told. action list (default) shows them; select { id } makes one the working tab; '
      + 'waitForNew { timeoutMs, select? } waits for a tab opened since your previous browser call began (e.g. by the click that '
      + 'opened a popup) and returns it, selecting it with select: true. Go back with select and the earlier id.',
    inputSchema: { type: 'object', properties: {
      action: { type: 'string', enum: ['list', 'select', 'waitForNew'] },
      id: { type: 'number', description: 'select: the tab id from list or from the new-tab note' },
      timeoutMs: { type: 'number', description: 'waitForNew: how long to wait (default 10000, max 60000)' },
      select: { type: 'boolean', description: 'waitForNew: also make the new tab the working tab' },
    } } },
    { name: 'say', description: 'Reply to the user in the show-and-tell side panel\'s conversation (Markdown). Use it to answer '
      + 'what the user sent from the panel (messages, marks, recordings): they are looking at the panel, not at your chat.',
    inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string', description: 'Markdown: paragraphs, lists, **bold**, `code`, code blocks, links' } } } },
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
    { name: 'set_step', description: 'Show the current step in the side panel, e.g. "3/7 - Create invoice". Empty string clears it.',
      inputSchema: { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] } },
    { name: 'highlight', description: 'Show the user something: draw a highlight around an element in the app tab (allowlisted hosts only), '
      + 'optionally with a label and a looping gesture illustration (tap, swipe, drag…), and scroll it into view. Works without a tour; '
      + 'with `url` it opens that page first, so no Playwright call is needed. '
      + 'Replaces existing highlights unless keep=true. Returns whether the element was found. Highlights follow the element while it moves '
      + 'and disappear when the page path changes.',
    inputSchema: { type: 'object', required: ['selector'], properties: {
      selector: { type: 'string', description: 'CSS selector' },
      text: { type: 'string', description: 'Only match elements whose visible text contains this (case-insensitive); innermost match wins' },
      label: { type: 'string', description: 'Short callout shown next to the element' },
      style: { type: 'string', enum: ['outline', 'spotlight', 'none'], description: 'spotlight also dims the rest of the page; none draws no box, only label and gesture (default outline)' },
      gesture: { type: 'string', enum: GESTURES, description: 'Loop an illustration of this gesture on the element (shown only, never performed)' },
      direction: { type: 'string', enum: ['left', 'right', 'up', 'down', 'in', 'out'], description: 'swipe/drag/scroll direction; in/out for pinch' },
      to: { type: 'string', description: 'CSS selector where a swipe or drag ends' },
      url: { type: 'string', description: 'Open this page in the app tab first (allowlisted hosts only)' },
      color: { type: 'string', description: 'CSS color (default Chrome blue #0b57d0)' },
      id: { type: 'string', description: 'Name for this highlight, to update or clear it later' },
      keep: { type: 'boolean', description: 'Keep existing highlights and add this one (default false)' },
      scroll: { type: 'boolean', description: 'Scroll the element into view if needed (default true)' },
    } } },
    { name: 'clear_highlights', description: 'Remove one highlight by id, or all highlights when id is omitted.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
    { name: 'throttle', description: 'Throttle your tab like Chrome DevTools: the network (a preset fast-4g, slow-4g, 3g, offline, or custom kbit/s '
      + 'and latency) and/or the CPU (slowdown factor, e.g. 4 or 6). Each is set on its own; preset "off" without cpu resets both. It stays until off, '
      + 'the tab closes or the browser restarts; the panel shows it and lets the user turn it off. Useful to show or check loading states, spinners, '
      + 'offline handling and how the page behaves on slow devices.',
    inputSchema: { type: 'object', properties: {
      preset: { type: 'string', enum: [...NETWORK_PRESETS, 'off'], description: 'Network preset; "off" ends network throttling' },
      cpu: { type: 'number', description: 'CPU slowdown factor 1-20 like DevTools (4 = "4× slowdown"); 1 ends it' },
      downloadKbps: { type: 'number', description: 'Custom download speed in kbit/s (instead of preset)' },
      uploadKbps: { type: 'number', description: 'Custom upload speed in kbit/s (default: same as download)' },
      latencyMs: { type: 'number', description: 'Custom added latency in ms' },
    } } },
    { name: 'emulate_device', description: 'Show your tab as on a phone, a tablet or at any width, like the device toolbar in Chrome DevTools: the page is laid out '
      + 'at that size (media queries, viewport meta tag), with touch support and a mobile user agent for the presets. Only your tab changes, not the user\'s window '
      + 'or the side panel, and it stays on across navigations until preset "off", so call it again with another width instead of opening tabs. The result '
      + 'says what the page now measures. Use it to check or show responsive layouts; the panel shows it and lets the user turn it off.',
    inputSchema: { type: 'object', properties: {
      preset: { type: 'string', enum: ['phone', 'small-phone', 'tablet', 'off'], description: 'phone 390×844, small-phone 360×640, tablet 820×1180 (all with touch and a mobile user agent); "off" ends it' },
      width: { type: 'number', description: 'Viewport width in CSS pixels (200-4000), alone or overriding the preset\'s; alone it is a plain narrower or wider desktop tab' },
      height: { type: 'number', description: 'Viewport height in CSS pixels; omit or 0 to keep the tab\'s own height' },
      scale: { type: 'number', description: 'Device pixel ratio, e.g. 2 or 3; omit to keep the screen\'s own' },
      touch: { type: 'boolean', description: 'The page sees a touch screen (default: only with a preset)' },
      mobile: { type: 'boolean', description: 'Mobile browser behaviour: viewport meta tag, mobile user agent (default: only with a preset)' },
    } } },
    { name: 'pause', description: 'Stop your tab at a chosen moment, like breakpoints in Chrome DevTools, so you or the user can look at a state '
      + 'that normally passes too quickly (loading, empty, half-rendered, an open menu). `on` says when: "request" before a fetch/XHR whose URL contains '
      + '`url` is sent (with hold: true the page runs on and only that request waits, so browser_* tools still work and the loading state stays on screen; '
      + 'a hold catches the first matching request, also the page\'s own while it loads: set it once the page has loaded, or pass afterInput: true, when you mean the request an action sends); '
      + '"dom" when the element `selector` changes; "line" at a line of page code (`text`: code to search the loaded scripts for, or `url` + `line`); '
      + '"event" at the first listener of an event such as click or submit; "now" immediately. A point is removed after it paused once unless once: false. '
      + 'When the page pauses you are told where (file, line, function, call stack): by the browser_* call that caused it, or by a `paused` action. '
      + 'browser_* tools cannot act on a paused page; look with inspect_paused and continue with resume. The panel shows the pause and lets the user '
      + 'resume. Without `on` it lists your pause points; remove takes an id or "all".',
    inputSchema: { type: 'object', properties: {
      on: { type: 'string', enum: ['request', 'dom', 'line', 'event', 'now'] },
      url: { type: 'string', description: 'request: part of the request URL ("" = any request). line: part of the script URL' },
      hold: { type: 'boolean', description: 'request: keep the page running and only hold matching requests until resume' },
      afterInput: { type: 'boolean', description: 'request with hold: hold only requests that follow a click, tap or key press in the page (yours or the user\'s, within about 5 s); '
        + 'the page\'s own requests, such as its first load, pass. Use it to show the state after an action, e.g. switching a variant' },
      selector: { type: 'string', description: 'dom: CSS selector of the element to watch' },
      change: { type: 'string', enum: ['any', 'content', 'attributes', 'removed'], description: 'dom: what counts (default any = content or attributes)' },
      text: { type: 'string', description: 'line: code to find in the loaded scripts, e.g. "renderResults(data"; the pause is set where it occurs. Spacing need not match. On minified sites search for what survives minifying: strings, property and method names' },
      line: { type: 'number', description: 'line: 1-based line in the script `url`, or the line to pick when `text` occurs several times' },
      column: { type: 'number', description: 'line: 1-based column, for minified code, or the column to pick (with url and line) when `text` occurs several times on one line' },
      condition: { type: 'string', description: 'line: pause only when this expression is true there' },
      event: { type: 'string', description: 'event: the event name, e.g. click, submit, keydown, input' },
      once: { type: 'boolean', description: 'Remove the point after its first pause (default true)' },
      remove: { type: 'string', description: 'Remove this pause point (id), or "all"' },
    } } },
    { name: 'resume', description: 'Let your paused tab run again and let held requests go. `step` (over, into, out) runs to the next line instead and '
      + 'returns where it stopped. `what` limits it to "page" or "requests" (default both). At a pause point you can also take that point away '
      + '(remove: true), or load the page again instead of letting it run on (`reload`), e.g. to see the same moment a second time. '
      + 'The user has the same choices in the side panel.',
    inputSchema: { type: 'object', properties: {
      step: { type: 'string', enum: ['over', 'into', 'out'] },
      what: { type: 'string', enum: ['all', 'page', 'requests'] },
      remove: { type: 'boolean', description: 'Also remove the pause point the page is paused at (a point set with once: false)' },
      reload: { type: 'string', enum: ['again', 'skip', 'remove'], description: 'Reload the paused page: "again" pauses at the same point once more '
        + '(a used-up point is set again) and returns where it stopped; "skip" lets the point\'s next hit pass and pauses at the one after; '
        + '"remove" reloads without the point' },
    } } },
    { name: 'inspect_paused', description: 'Look at your paused tab without changing it: the call stack and the variables of a call frame, or the value '
      + 'of an `expression` there (e.g. "data.items.length", "this.state"). Read-only: expressions that would change something are refused.',
    inputSchema: { type: 'object', properties: {
      expression: { type: 'string', description: 'JavaScript evaluated in the frame; omit for the call stack and variables' },
      frame: { type: 'number', description: 'Call frame, 0 = where it stopped (default)' },
    } } },
    { name: 'hide_overlays', description: 'Temporarily hide (true) or show again (false) all highlights, e.g. around evidence screenshots. '
      + 'The side panel is browser UI and never appears in page screenshots.',
    inputSchema: { type: 'object', properties: { hidden: { type: 'boolean' } }, required: ['hidden'] } },
    { name: 'get_queue', description: 'Return and clear what the user sent from the browser (marks, recordings, messages) without waiting. '
      + 'Use it when the user says they sent, marked or recorded something. recent=true also returns what was delivered in the last hour.',
      inputSchema: { type: 'object', properties: { recent: { type: 'boolean' } } } },
    { name: 'wait_for_action', description: 'Block until the user acts in the side panel (next/back/question/annotation/recording) and return the actions. '
      + 'A recording action carries the clicks, changes, keys, scrolls, swipes and navigations the user demonstrated. '
      + 'An annotation action includes the labelled screenshot inline. Prefer running `node bridge wait` as a background shell job.',
    inputSchema: { type: 'object', properties: { timeoutSec: { type: 'number', description: 'Default 600' } } } },
  ];

  const AUTOSTART = new Set(['set_step', 'highlight', 'clear_highlights', 'hide_overlays', 'throttle', 'emulate_device', 'pause', 'load_tour', 'request_demo', 'record_tour']);
  const server = new Server({ name: 'show-and-tell', version: JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS, ...(await driver.list(log)).map(t =>
    ({ ...t, description: 'Shared show-and-tell browser (the one the user sees): ' + (t.description || '') }))] }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const a = req.params.arguments || {};
    if (req.params.name.startsWith('browser_')) {
      try {
        const r = await driver.call(req.params.name, a);
        const user = await userActivity();
        return user ? { ...r, content: [{ type: 'text', text: userNote(user) }, ...(r.content || [])] } : r;
      }
      catch (e) { return reply({ ok: false, error: String(e.message || e) }); }
    }
    try {
      if (AUTOSTART.has(req.params.name) && !(await browserVersion())) await ensureBrowser();
      switch (req.params.name) {
        case 'start_browser': {
          const r = await ensureBrowser({ force: true });
          if (r.browser) await driver.reset(); // a new browser process: Playwright reattaches on next use
          await call('POST', '/claim', { session: SESSION, label: LABEL }).catch(() => {});
          return done(r);
        }
        case 'status': {
          const s = await call('GET', '/status');
          return done({ ...s, you: s.sessions?.find(x => x.id === SESSION)?.name || LABEL });
        }
        case 'load_tour': return done(await cmd({ cmd: 'loadTour', tour: a.tour, start: +(a.start || 0) }));
        case 'record_tour': return done(await cmd({ cmd: 'recordTour', tour: a.tour, name: a.name, size: a.size,
          pace: a.pace, captions: a.captions, cards: a.cards, zoom: a.zoom, hidpi: a.hidpi, out: a.out }));
        case 'stop_recording': return done(await cmd({ cmd: 'recordStop', discard: !!a.discard }));
        case 'request_demo': return done(await cmd({ cmd: 'requestDemo', prompt: String(a.prompt || '') }));
        case 'tabs': return done(await cmd({ cmd: 'tabs', action: a.action || 'list', id: a.id, timeoutMs: a.timeoutMs, select: !!a.select }));
        case 'say': return done(await call('POST', '/say', { session: SESSION, label: LABEL, text: String(a.text || '') }));
        case 'goto_step': return done(await cmd({ cmd: 'gotoStep', index: +a.index }));
        case 'end_tour': return done(await cmd({ cmd: 'endTour' }));
        case 'set_step': return done(await cmd({ cmd: 'setStep', label: String(a.label ?? '') }));
        case 'highlight': return done(await cmd({ cmd: 'highlight', keep: !!a.keep, item: {
          selector: a.selector, text: a.text, label: a.label, style: a.style, color: a.color, id: a.id, scroll: a.scroll,
          gesture: a.gesture, direction: a.direction, to: a.to, url: a.url } }));
        case 'clear_highlights': return done(await cmd({ cmd: 'clearHighlights', id: a.id }));
        case 'hide_overlays': return done(await cmd({ cmd: 'hideOverlays', hidden: a.hidden !== false }));
        case 'throttle': {
          const network = a.downloadKbps ? { downloadKbps: a.downloadKbps, uploadKbps: a.uploadKbps, latencyMs: a.latencyMs } : a.preset;
          if (network === undefined && a.cpu === undefined) return reply({ ok: false, error: 'give preset, downloadKbps or cpu ("off" resets both)' });
          return done(await cmd({ cmd: 'throttle', network, cpu: a.cpu }));
        }
        case 'emulate_device': {
          if (a.preset === undefined && a.width === undefined) return reply({ ok: false, error: 'give a preset (phone, small-phone, tablet, off) or a width' });
          return done(await cmd({ cmd: 'device', preset: a.preset, width: a.width, height: a.height, scale: a.scale, touch: a.touch, mobile: a.mobile }));
        }
        case 'pause': return done(await cmd({ cmd: 'pause', on: a.on, url: a.url, hold: a.hold, afterInput: a.afterInput, selector: a.selector, change: a.change, text: a.text,
          line: a.line, column: a.column, condition: a.condition, event: a.event, once: a.once, remove: a.remove }));
        case 'resume': return done(await cmd({ cmd: 'resume', step: a.step, what: a.what, remove: a.remove, reload: a.reload }));
        case 'inspect_paused': return reply(await cmd({ cmd: 'inspectPaused', expression: a.expression, frame: a.frame }));
        case 'get_queue': return withShots(await call('GET', '/queue' + (a.recent ? '?recent=1' : '')));
        case 'wait_for_action': {
          const t = Math.max(1, Math.min(86400, +(a.timeoutSec || 600)));
          return withShots(await call('GET', `/wait?timeout=${t}&session=${SESSION}&label=${LABEL}`, null, { signal: extra?.signal }));
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
  for (const act of [...(body.actions || []), ...(body.recent || [])]) {
    for (const file of [act.labelledImagePath].filter(Boolean)) {
      try { content.push({ type: 'image', data: fs.readFileSync(file).toString('base64'), mimeType: file.endsWith('.jpg') ? 'image/jpeg' : 'image/png' }); } catch {}
    }
  }
  return { content };
}
