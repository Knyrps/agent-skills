// Pause points: breakpoints the agent sets in its own tab, and requests it holds back. Works like DevTools,
// over the same debugger connection as throttling. What the panel shows lives in chrome.storage.session
// under "pauses" (tabId -> { session, points, paused, held }); breakpoint ids, call frames and the waiting
// requests stay in memory, because they are only valid while this worker is attached.

const BLACKBOX = ['^chrome-extension://']; // never stop in an extension's content script
const DOM_TYPES = { content: ['subtree-modified'], attributes: ['attribute-modified'], removed: ['node-removed'], any: ['subtree-modified', 'attribute-modified'] };
const SCOPES = ['local', 'block', 'catch', 'closure', 'module', 'script'];
const KICK = 'show-and-tell-pause'; // the empty script that makes an idle page stop, see pauseNow
const READ_ONLY = 'inspection is read-only: this expression would change something, or calls code that might. Read variables and properties instead.';
const AGAIN_MS = 10000; // how long a reloaded page has to show a watched element again

const cut = (s, n = 200) => { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// chrome.debugger reports protocol errors as JSON text.
const errorText = e => { const s = String(e?.message || e); try { return JSON.parse(s).message || s; } catch { return s; } };
const fileOf = url => {
  if (!url) return 'script';
  // "(index)" as in DevTools: a script inside the page's own HTML.
  try { return new URL(url).pathname.split('/').filter(Boolean).pop() || '(index)'; } catch { return url.slice(-40); }
};

// One remote value as a short text.
function brief(o) {
  if (!o || o.type === 'undefined') return 'undefined';
  if (o.type === 'string') return JSON.stringify(cut(o.value));
  if (o.unserializableValue) return o.unserializableValue;
  if (o.subtype === 'null') return 'null';
  if (o.type !== 'object' && o.type !== 'function' && 'value' in o) return String(o.value);
  if (o.type === 'function') return cut((o.description || 'function').split('\n')[0], 80);
  const p = o.preview;
  if (!p?.properties) return cut(o.description || o.type, 120);
  const list = p.subtype === 'array';
  const body = p.properties.map(x => (list ? '' : x.name + ': ') + (x.type === 'string' ? JSON.stringify(cut(x.value, 60)) : x.value)).join(', ') + (p.overflow ? ', …' : '');
  return cut(`${o.description || ''} ${list ? `[${body}]` : `{${body}}`}`.trim(), 400);
}

export function createPauser({ S, serial, attach, idle, allowed, tell }) {
  const tabs = new Map(); // tabId -> live state, see fresh()
  let seq = 0;
  const cdp = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params);
  const quiet = (tabId, method, params) => cdp(tabId, method, params).catch(() => null);
  const fresh = session => ({ session, points: [], scripts: new Map(), debug: false, dom: false, fetch: false, root: 0,
    paused: null, frames: [], idle: false, held: new Map(), waiters: [], stepping: false, stepTimer: 0, nowPending: false, resumedBy: '',
    // cause: the point the page is paused at (kept while stepping). reloading: who reloads the paused page.
    // awaited: the agent's own reload waits for the next pause. note: what the user chose, for the agent.
    cause: null, reloading: '', awaited: false, skipping: false, note: '', domRun: 0 });

  const view = t => (t && (t.points.length || t.paused || t.held.size)) ? {
    session: t.session,
    points: t.points.map(({ id, kind, label, once, skip }) => ({ id, kind, label, once, ...(skip ? { skip } : {}) })),
    paused: t.paused,
    held: t.held.size ? { count: t.held.size, urls: [...new Set([...t.held.values()].map(h => h.url))].slice(0, 3) } : null,
  } : null;

  // Writes what the panel shows and tells the bridge. by: who or what caused the change.
  function publish(tabId, by, session, note) {
    const t = tabs.get(tabId), v = view(t);
    tell({ type: 'pauseState', tabId, session: t?.session ?? session ?? null, by, points: v?.points || [], paused: v?.paused || null, held: v?.held || null,
      ...(note ? { note } : {}) });
    return serial(async () => {
      const { pauses = {} } = await S.get('pauses');
      const now = view(tabs.get(tabId));
      if (now) pauses[tabId] = now; else delete pauses[tabId];
      await S.set({ pauses });
    });
  }

  const wake = (t, value) => { for (const w of t.waiters.splice(0)) w(value); };
  const next = (t, ms) => Promise.race([new Promise(r => t.waiters.push(r)), sleep(ms).then(() => 'timeout')]);
  // Waits through pauses and resumes until the test holds; false when the time is over.
  async function until(t, test, ms) {
    for (const end = Date.now() + ms; !test();) if (Date.now() >= end || (await next(t, end - Date.now())) === 'timeout') return test();
    return true;
  }
  const urlOf = (t, f) => f.url || t.scripts.get(f.location.scriptId)?.url || '';
  const place = (t, f) => f ? `${fileOf(urlOf(t, f))}:${f.location.lineNumber + 1}` : '';

  async function enableDebugger(tabId, t) {
    if (t.debug) return;
    t.debug = true;
    try {
      await cdp(tabId, 'Debugger.enable');
      await quiet(tabId, 'Debugger.setBlackboxPatterns', { patterns: BLACKBOX });
    } catch (e) { t.debug = false; throw e; }
  }

  // Held requests are a pattern list on the Fetch domain; it is sent whole on every change.
  async function syncFetch(tabId, t) {
    const urls = [...new Set(t.points.filter(p => p.hold).map(p => p.url))];
    if (urls.length) {
      await cdp(tabId, 'Fetch.enable', { patterns: urls.map(u => ({ urlPattern: `*${u.replace(/[\\*?]/g, '\\$&')}*`, requestStage: 'Request' })) });
      t.fetch = true;
    } else if (t.fetch) {
      await quiet(tabId, 'Fetch.disable');
      t.fetch = false;
    }
  }

  // ---------------------------------------------------------------- setting and removing points

  async function sourceOf(tabId, t, s) {
    if (s.source == null) {
      const r = await quiet(tabId, 'Debugger.getScriptSource', { scriptId: s.id });
      if (!r) { t.scripts.delete(s.id); return null; } // a script of an earlier page
      s.source = r.scriptSource || '';
    }
    return s.source;
  }

  // All places where the text occurs in the loaded scripts, in resource coordinates (an inline script
  // starts somewhere inside its document). Minified bundles are one long line, so each place is shown by the
  // code around it, not by its line. Not found as written, the text is tried again with any spacing
  // (a minifier drops the spaces of `a = b(c)`).
  const near = (src, i, len) => {
    const from = Math.max(0, i - 50), to = Math.min(src.length, i + len + 50);
    return (from ? '…' : '') + src.slice(from, to).replace(/\s+/g, ' ') + (to < src.length ? '…' : '');
  };
  async function findText(tabId, t, text, url) {
    const exact = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The same tokens with any spacing between them: words stay whole, punctuation and spaces may come and go.
    const loose = text.trim().split(/(\s+|[.,;:=+\-*/<>!&|?()[\]{}"'`])/).filter(x => x && !/^\s+$/.test(x))
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
    for (const [pattern, spacing] of [[exact, false], [loose, true]]) {
      const found = new Map();
      let scripts = 0, more = false;
      for (const s of [...t.scripts.values()]) {
        if (!s.url || /^chrome-extension:/.test(s.url) || (url && !s.url.includes(url))) continue;
        const src = await sourceOf(tabId, t, s);
        if (src == null) continue;
        scripts++;
        const re = new RegExp(pattern, 'g');
        for (let m; (m = re.exec(src));) {
          if (found.size >= 20) { more = true; break; }
          const i = m.index, before = src.slice(0, i), row = before.split('\n').length - 1, col = i - (before.lastIndexOf('\n') + 1);
          const line = s.startLine + row, column = row === 0 ? s.startColumn + col : col;
          found.set(`${s.url} ${line} ${column}`, { url: s.url, line: line + 1, column: column + 1, code: near(src, i, m[0].length) });
          if (!m[0].length) re.lastIndex++;
        }
      }
      if (found.size || spacing) return { matches: [...found.values()], scripts, more, spacing: spacing && found.size > 0 };
    }
  }

  const codeAt = (t, loc) => {
    const s = loc && t.scripts.get(loc.scriptId);
    if (s?.source == null) return '';
    const row = s.source.split('\n')[loc.lineNumber - s.startLine] || '';
    if (row.length <= 160) return row.trim();
    // A minified line: what is around the column, not the start of the bundle.
    const col = loc.lineNumber === s.startLine ? loc.columnNumber - s.startColumn : loc.columnNumber;
    return near(row, Math.max(0, col), 0);
  };

  async function make(tabId, t, spec) {
    const once = spec.once !== false;
    const same = (kind, key) => t.points.find(p => p.kind === kind && p.key === key);
    switch (spec.on) {
      case 'request': {
        const url = String(spec.url ?? '').trim(), key = (spec.hold ? 'hold ' : '') + url;
        if (same('request', key)) return { point: same('request', key) };
        if (spec.hold) {
          if (!url) return { error: 'holding requests needs url: a part of the request URL, e.g. "/api/products"' };
          const point = { kind: 'request', key, hold: true, url, once, label: `holds requests to ${url}` };
          t.points.push(point);
          try { await syncFetch(tabId, t); } catch (e) { t.points.pop(); throw e; }
          return { point, added: true };
        }
        await enableDebugger(tabId, t);
        await cdp(tabId, 'DOMDebugger.setXHRBreakpoint', { url });
        return { point: { kind: 'request', key, url, once, label: url ? `request to ${url}` : 'any request' } };
      }
      case 'dom': {
        const selector = String(spec.selector ?? '').trim(), change = spec.change || 'any';
        if (!selector) return { error: 'a DOM pause needs selector' };
        if (!DOM_TYPES[change]) return { error: `change must be one of ${Object.keys(DOM_TYPES).join(', ')}` };
        if (same('dom', `${selector} ${change}`)) return { point: same('dom', `${selector} ${change}`) };
        await enableDebugger(tabId, t);
        if (!t.dom) { await cdp(tabId, 'DOM.enable'); t.dom = true; }
        if (!t.root) t.root = (await cdp(tabId, 'DOM.getDocument', { depth: 0 })).root.nodeId;
        const { nodeId } = await cdp(tabId, 'DOM.querySelector', { nodeId: t.root, selector });
        if (!nodeId) return { error: `no element matches ${selector} (elements inside a shadow root cannot be watched)` };
        for (const type of DOM_TYPES[change]) await cdp(tabId, 'DOMDebugger.setDOMBreakpoint', { nodeId, type });
        const what = { content: 'content changes', attributes: 'attributes change', removed: 'is removed', any: 'changes' }[change];
        return { point: { kind: 'dom', key: `${selector} ${change}`, selector, nodeId, types: DOM_TYPES[change], once, label: `${selector} ${what}` } };
      }
      case 'event': {
        const eventName = String(spec.event ?? '').trim();
        if (!eventName) return { error: 'an event pause needs event, e.g. "click" or "submit"' };
        if (same('event', eventName)) return { point: same('event', eventName) };
        await enableDebugger(tabId, t);
        await cdp(tabId, 'DOMDebugger.setEventListenerBreakpoint', { eventName });
        return { point: { kind: 'event', key: eventName, eventName, once, label: `${eventName} listener` } };
      }
      case 'line': {
        await enableDebugger(tabId, t);
        let target;
        if (spec.text) {
          const { matches, scripts, more, spacing } = await findText(tabId, t, String(spec.text), spec.url && String(spec.url));
          if (!matches.length) return { error: `the text was not found in the ${scripts} loaded script${scripts === 1 ? '' : 's'}${spec.url ? ` matching ${spec.url}` : ''}, `
            + 'not even with other spacing. Production scripts are usually minified: local names are shortened and comments removed. '
            + 'Search for something minifying keeps: a string ("/api/items", an error message), a property or method name (".renderItems("), '
            + 'a DOM call with its argument; or pause on the request or the DOM change instead' };
          // Several places: line and column pick one (a minified bundle has them all on one line), url narrows the scripts.
          const picked = matches.filter(m => (!spec.line || m.line === +spec.line) && (!spec.column || m.column === +spec.column));
          if (picked.length !== 1) return { error: `the text occurs in ${matches.length}${more ? '+' : ''} places${picked.length ? '' : ' (none at that line and column)'}: `
            + 'use a longer text, or pass the url, line and column of the one you mean from the list (code shows what is around each)', matches };
          target = { url: picked[0].url, line: picked[0].line, column: picked[0].column, spacing };
        } else {
          if (!spec.url || !spec.line) return { error: 'a line pause needs text (code to search for), or url and line' };
          target = { urlRegex: String(spec.url).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), line: +spec.line, column: spec.column ? +spec.column : undefined };
        }
        const key = `${target.url || target.urlRegex} ${target.line} ${target.column || 0} ${spec.condition || ''}`;
        if (same('line', key)) return { point: same('line', key) };
        const params = {
          ...(target.url ? { url: target.url } : { urlRegex: target.urlRegex }), lineNumber: target.line - 1,
          ...(target.column ? { columnNumber: target.column - 1 } : {}), ...(spec.condition ? { condition: String(spec.condition) } : {}),
        };
        const r = await cdp(tabId, 'Debugger.setBreakpointByUrl', params);
        const loc = r.locations?.[0], s = loc && t.scripts.get(loc.scriptId);
        if (s) await sourceOf(tabId, t, s);
        const at = loc ? `${fileOf(s?.url)}:${loc.lineNumber + 1}` : `${fileOf(target.url || String(spec.url))}:${target.line}`;
        return {
          point: { kind: 'line', key, params, breakpointId: r.breakpointId, once, label: 'breakpoint at ' + at + (spec.condition ? ` if ${cut(spec.condition, 40)}` : '') },
          info: loc ? { at: `${at}:${loc.columnNumber + 1}`, code: codeAt(t, loc), ...(target.spacing && { note: 'found with other spacing than given' }) } : { note: 'no loaded script has that line yet; the pause applies once such a script loads' },
        };
      }
      default: return { error: 'on must be one of request, dom, line, event, now' };
    }
  }

  async function unset(tabId, t, point) {
    t.points = t.points.filter(p => p !== point);
    if (point.hold) return void await syncFetch(tabId, t).catch(() => {});
    if (point.kind === 'request') await quiet(tabId, 'DOMDebugger.removeXHRBreakpoint', { url: point.url });
    if (point.kind === 'event') await quiet(tabId, 'DOMDebugger.removeEventListenerBreakpoint', { eventName: point.eventName });
    if (point.kind === 'line') await quiet(tabId, 'Debugger.removeBreakpoint', { breakpointId: point.breakpointId });
    if (point.kind === 'dom') for (const type of point.types) await quiet(tabId, 'DOMDebugger.removeDOMBreakpoint', { nodeId: point.nodeId, type });
  }

  // Sets a point again that its own pause used up, under the same id. A watched element is new after a
  // reload and is looked up then, see watchAgain.
  async function rearm(tabId, t, point) {
    if (t.points.includes(point)) return;
    if (point.kind === 'line') point.breakpointId = (await cdp(tabId, 'Debugger.setBreakpointByUrl', point.params)).breakpointId;
    if (point.kind === 'request') await cdp(tabId, 'DOMDebugger.setXHRBreakpoint', { url: point.url });
    if (point.kind === 'event') await cdp(tabId, 'DOMDebugger.setEventListenerBreakpoint', { eventName: point.eventName });
    t.points.push(point);
  }

  // After a reload from a pause: watched elements are set again as soon as the new document has them.
  async function watchAgain(tabId, t) {
    const run = ++t.domRun;
    while (tabs.get(tabId) === t && run === t.domRun) {
      const open = t.points.filter(p => p.kind === 'dom' && !p.nodeId);
      if (!open.length) return;
      if (!t.root) t.root = (await quiet(tabId, 'DOM.getDocument', { depth: 0 }))?.root?.nodeId || 0;
      for (const p of open) {
        const nodeId = t.root && (await quiet(tabId, 'DOM.querySelector', { nodeId: t.root, selector: p.selector }))?.nodeId;
        if (!nodeId) continue;
        for (const type of p.types) await quiet(tabId, 'DOMDebugger.setDOMBreakpoint', { nodeId, type });
        p.nodeId = nodeId;
      }
      const late = t.points.filter(p => p.kind === 'dom' && !p.nodeId && p.again < Date.now());
      if (late.length) {
        t.points = t.points.filter(p => !late.includes(p));
        await publish(tabId, 'navigation');
        await settle(tabId);
      }
      await sleep(50);
    }
  }

  // Nothing set, paused or held any more: switch the domains off and let the tab go.
  async function settle(tabId) {
    const t = tabs.get(tabId);
    if (!t || t.points.length || t.paused || t.held.size || t.stepping || t.nowPending) return;
    tabs.delete(tabId);
    if (t.fetch) await quiet(tabId, 'Fetch.disable');
    if (t.dom) await quiet(tabId, 'DOM.disable');
    if (t.debug) await quiet(tabId, 'Debugger.disable');
    await idle(tabId);
  }

  async function add(tabId, session, spec) {
    await attach(tabId);
    let t = tabs.get(tabId);
    if (!t) tabs.set(tabId, t = fresh(session));
    t.session = session;
    try {
      if (spec.on === 'now') return await pauseNow(tabId, t);
      const made = await make(tabId, t, spec);
      if (made.error) return { ok: false, ...made };
      const point = made.point;
      if (!point.id) {
        point.id = 'p' + (++seq);
        if (!made.added) t.points.push(point);
        await publish(tabId, 'agent');
      }
      return { ok: true, id: point.id, pauses: point.label, once: point.once, ...(made.info || {}) };
    } catch (e) {
      return { ok: false, error: errorText(e) };
    } finally {
      await settle(tabId);
    }
  }

  // Stops at once: asks for a pause and runs an empty script, so the page does not wait for its next own code.
  async function pauseNow(tabId, t) {
    if (t.paused) return { ok: true, paused: t.paused, note: 'the page was already paused' };
    await enableDebugger(tabId, t);
    t.nowPending = true;
    const stopped = next(t, 3000);
    await cdp(tabId, 'Debugger.pause');
    cdp(tabId, 'Runtime.evaluate', { expression: `void 0\n//# sourceURL=${KICK}` }).catch(() => {});
    const r = await stopped;
    t.nowPending = false;
    return t.paused ? { ok: true, paused: t.paused } : { ok: false, error: r === 'timeout' ? 'the page did not pause within 3 s' : 'the page could not be paused' };
  }

  async function remove(tabId, id, by = 'agent') {
    const t = tabs.get(tabId);
    if (!t) return { ok: true, removed: 0 };
    const gone = t.points.filter(p => id === 'all' || p.id === id);
    if (!gone.length && id !== 'all') return { ok: false, error: `no pause point ${id}; the tab has ${t.points.map(p => p.id).join(', ') || 'none'}` };
    for (const p of gone) await unset(tabId, t, p);
    if (t.paused?.point && gone.includes(t.cause)) t.paused.point.kept = false;
    // Requests that only a removed hold kept waiting go on.
    if (t.held.size && !t.points.some(p => p.hold)) await releaseHeld(tabId, t, false);
    await publish(tabId, by);
    await settle(tabId);
    return { ok: true, removed: gone.length };
  }

  // ---------------------------------------------------------------- pausing and resuming

  function hitPoint(t, p) {
    if (p.hitBreakpoints?.length) return t.points.find(x => p.hitBreakpoints.includes(x.breakpointId));
    if (p.reason === 'XHR') return t.points.find(x => x.kind === 'request' && !x.hold && x.url === (p.data?.breakpointURL ?? ''));
    if (p.reason === 'DOM') return t.points.find(x => x.kind === 'dom' && x.nodeId === p.data?.nodeId);
    if (p.reason === 'EventListener') return t.points.find(x => x.kind === 'event' && p.data?.eventName === 'listener:' + x.eventName);
  }

  async function onPaused(tabId, t, p) {
    const hit = hitPoint(t, p);
    // "Ignore once": the point lets this hit pass and counts again from the next one.
    if (hit?.skip && !t.stepping && p.reason !== 'step') {
      hit.skip--;
      t.skipping = true;
      if (!(await quiet(tabId, 'Debugger.resume'))) t.skipping = false;
      return void publish(tabId, 'page');
    }
    clearTimeout(t.stepTimer);
    const stepped = t.stepping || p.reason === 'step';
    t.stepping = false;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !(await allowed(tab.url || ''))) return void quiet(tabId, 'Debugger.resume'); // not a page the agent may touch
    // A page stopped while idle is inside the empty script that stopped it: no page code to show. Code
    // without a file was run from outside (browser_evaluate, the console) and is left out of the call stack.
    const real = p.callFrames.filter(f => urlOf(t, f) !== KICK), own = real.filter(f => urlOf(t, f)), top = own[0];
    const point = hit, now = t.nowPending && !point;
    const reason = point ? point.label : now ? 'paused by the agent' : stepped ? (t.paused?.reason || 'step')
      : p.reason === 'XHR' ? `request to ${cut(p.data?.url || '', 80)}` : 'debugger statement in the page';
    t.nowPending = false;
    t.frames = own.length ? own : real.length ? real : p.callFrames;
    t.idle = !real.length;
    const where = top ? place(t, top) : real.length ? 'code run from outside the page (no file)' : 'between tasks (no page code was running)';
    t.paused = {
      reason, where, fn: top?.functionName || '', since: Date.now(), ...(stepped ? { stepped: true } : {}),
      ...(p.reason === 'XHR' && p.data?.url ? { request: cut(p.data.url, 300) } : {}),
      frames: own.slice(0, 5).map(f => ({ fn: f.functionName || '(anonymous)', at: place(t, f) })),
    };
    if (point?.once) await unset(tabId, t, point);
    // The point behind this pause, also after stepping on from it. kept: it is still set and pauses again.
    t.cause = point || (stepped ? t.cause : null);
    if (t.cause) t.paused.point = { id: t.cause.id, label: t.cause.label, kept: t.points.includes(t.cause) };
    const awaited = t.awaited;
    t.awaited = false;
    await publish(tabId, stepped ? 'step' : now || awaited ? 'agent' : 'breakpoint');
    wake(t, t.paused);
  }

  async function ran(tabId, t) {
    t.stepping = false;
    t.paused = null; t.frames = []; t.cause = null; t.reloading = '';
    const by = t.resumedBy || 'page', note = t.note;
    t.resumedBy = ''; t.note = '';
    await publish(tabId, by, undefined, note);
    wake(t, null);
    await settle(tabId);
  }

  function onResumed(tabId, t) {
    if (t.skipping) return void (t.skipping = false); // a hit that was let pass, see onPaused
    clearTimeout(t.stepTimer);
    // A step resumes and pauses again right away; only a step that runs on counts as resumed.
    if (t.stepping) t.stepTimer = setTimeout(() => ran(tabId, t), 700);
    else ran(tabId, t);
  }

  async function onHeld(tabId, t, p) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const point = t.points.find(x => x.hold && p.request.url.includes(x.url));
    if (!tab || !point || !(await allowed(tab.url || ''))) return void quiet(tabId, 'Fetch.continueRequest', { requestId: p.requestId });
    t.held.set(p.requestId, { url: p.request.url, method: p.request.method, type: p.resourceType, point });
    await publish(tabId, 'request');
  }

  async function releaseHeld(tabId, t, tidy = true) {
    const held = [...t.held];
    t.held.clear();
    for (const [requestId] of held) await quiet(tabId, 'Fetch.continueRequest', { requestId });
    if (tidy) for (const point of new Set(held.map(([, h]) => h.point))) if (point.once && t.points.includes(point)) await unset(tabId, t, point);
    return held.length;
  }

  // Loads the paused page again instead of letting it run on. how: "again" pauses at the same point once
  // more, "skip" lets that point's next hit pass, "remove" takes the point away.
  async function reload(tabId, t, how, by) {
    if (!['again', 'skip', 'remove'].includes(how)) return { ok: false, error: 'reload must be again, skip or remove' };
    if (!t.paused) return { ok: false, error: 'the page is not paused; reload it with browser_navigate instead' };
    const point = t.cause, since = t.paused.since, name = point && `${point.id} (${point.label})`;
    if (!point && how !== 'remove') return { ok: false, error: 'this pause has no pause point to come back to (the page was paused directly, or by its own debugger statement); use reload: "remove" or a plain resume' };
    try {
      if (how !== 'remove') { await rearm(tabId, t, point); point.skip = how === 'skip' ? 1 : 0; }
      else if (t.points.includes(point)) await unset(tabId, t, point);
    } catch (e) { return { ok: false, error: errorText(e) }; }
    // Watched elements are new after a reload: every DOM point is looked up again in the new document.
    for (const p of t.points) if (p.kind === 'dom') p.again = Date.now() + AGAIN_MS;
    clearTimeout(t.stepTimer);
    t.stepping = false;
    t.resumedBy = t.reloading = by;
    t.awaited = by === 'agent' && how !== 'remove';
    if (by === 'user') {
      t.note = 'The user reloaded the page from the side panel' + (!point ? '.' : how === 'again' ? `; it pauses at ${name} again.`
        : how === 'skip' ? `; ${name} lets its next hit pass and pauses at the one after.` : ` and removed the pause point ${name}.`);
    }
    const failed = await chrome.tabs.reload(tabId).then(() => '', errorText);
    if (failed || !(await until(t, () => t.paused?.since !== since, 5000))) {
      t.awaited = false; t.resumedBy = t.reloading = t.note = '';
      return { ok: false, error: failed || 'the page did not reload' };
    }
    // The user's choice shows in the panel; the agent's own reload returns where the page stopped again.
    if (by !== 'agent' || how === 'remove') return { ok: true, reloaded: true, ...(how === 'remove' && point ? { removed: point.id } : {}) };
    const again = await until(t, () => !!t.paused, 8000);
    t.awaited = false;
    return again ? { ok: true, reloaded: true, paused: t.paused }
      : { ok: true, reloaded: true, running: true, note: `the page has not paused again yet; ${point.id} is set, and a paused action follows when it does` };
  }

  // what: "all" (default), "page" or "requests". step: "over", "into" or "out" stops again at the next line.
  // remove: also takes away the point the page is paused at. reload: see reload().
  async function resume(tabId, { step, what = 'all', remove, reload: how, by = 'agent' } = {}) {
    const t = tabs.get(tabId);
    if (!t || (!t.paused && !t.held.size)) return { ok: true, note: 'nothing was paused or held in this tab' };
    if (how) return reload(tabId, t, how, by);
    if (remove && t.paused && t.cause && what !== 'requests') {
      if (by === 'user') t.note = `The user let it run again from the side panel and removed the pause point ${t.cause.id} (${t.cause.label}).`;
      if (t.points.includes(t.cause)) await unset(tabId, t, t.cause);
    }
    if (step) {
      const method = { over: 'Debugger.stepOver', into: 'Debugger.stepInto', out: 'Debugger.stepOut' }[step];
      if (!method) return { ok: false, error: 'step must be over, into or out' };
      if (!t.paused) return { ok: false, error: 'the page is not paused, so there is nothing to step through' };
      t.stepping = true; t.resumedBy = by;
      const stopped = next(t, 5000);
      try { await cdp(tabId, method); } catch (e) { t.stepping = false; return { ok: false, error: errorText(e) }; }
      const r = await stopped;
      return t.paused && r !== 'timeout' ? { ok: true, paused: t.paused } : { ok: true, running: true, note: 'the page ran on without stopping again' };
    }
    let released = 0, resumed = false;
    if (what !== 'page' && t.held.size) released = await releaseHeld(tabId, t);
    if (what !== 'requests' && t.paused) {
      t.resumedBy = by;
      const done = next(t, 3000);
      await quiet(tabId, 'Debugger.resume');
      await done;
      resumed = !t.paused;
    }
    if (tabs.get(tabId) === t) { if (released && !resumed) await publish(tabId, by); await settle(tabId); }
    return { ok: true, resumed, released, ...(t.paused ? { paused: t.paused } : {}), ...(t.held.size ? { stillHeld: t.held.size } : {}) };
  }

  // ---------------------------------------------------------------- read-only inspection while paused

  async function inspect(tabId, { expression, frame = 0 } = {}) {
    const t = tabs.get(tabId);
    if (!t?.paused) return { ok: false, error: 'the page is not paused' };
    const f = t.frames[+frame || 0];
    if (!f) return { ok: false, error: `no call frame ${frame}; there are ${t.frames.length}` };
    // outer: a scope around the function (module, closure, script) lists its data only, and fewer of it.
    const props = async (objectId, outer = false) => {
      const r = await quiet(tabId, 'Runtime.getProperties', { objectId, ownProperties: true, generatePreview: true });
      const every = (r?.result || []).filter(x => x.value), all = outer ? every.filter(x => x.value.type !== 'function') : every;
      const max = outer ? 20 : 40, hidden = [];
      const out = Object.fromEntries(all.slice(0, max).map(x => [x.name, brief(x.value)]));
      if (all.length > max) hidden.push(`${all.length - max} more`);
      if (every.length > all.length) hidden.push(`${every.length - all.length} functions`);
      if (hidden.length) out['…'] = `${hidden.join(' and ')} not listed; read one with expression`;
      return out;
    };
    if (expression) {
      const r = await cdp(tabId, 'Debugger.evaluateOnCallFrame', { callFrameId: f.callFrameId, expression: String(expression), throwOnSideEffect: true, generatePreview: true, timeout: 3000 })
        .catch(e => ({ exceptionDetails: { text: errorText(e) } }));
      if (r.exceptionDetails) {
        const text = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'could not evaluate';
        return { ok: false, error: /side-effect/i.test(text) ? READ_ONLY : cut(text.split('\n')[0], 300) };
      }
      const o = r.result;
      return { ok: true, in: t.idle ? 'the page (no function was running)' : `${f.functionName || '(anonymous)'} at ${place(t, f)}`, value: brief(o),
        ...(o.objectId && o.type === 'object' ? { properties: await props(o.objectId) } : {}) };
    }
    if (t.idle) return { ok: true, paused: t.paused.reason, frames: [], variables: {}, note: 'no page code was running, so there are no local variables; pass an expression to read page state' };
    const variables = {};
    let closures = 0;
    for (const s of f.scopeChain || []) {
      if (!SCOPES.includes(s.type) || !s.object?.objectId || (s.type === 'closure' && ++closures > 2)) continue;
      const vars = await props(s.object.objectId, !['local', 'block', 'catch'].includes(s.type));
      if (Object.keys(vars).length) variables[s.type + (s.name ? ` (${s.name})` : '') + (variables[s.type] ? ` ${Object.keys(variables).length}` : '')] = vars;
    }
    return {
      ok: true, paused: t.paused.reason, frame: +frame || 0,
      frames: t.frames.slice(0, 20).map((x, i) => ({ frame: i, fn: x.functionName || '(anonymous)', at: place(t, x) })),
      variables,
    };
  }

  // ---------------------------------------------------------------- events and cleanup

  function onEvent(source, method, params) {
    const tabId = source.tabId, t = tabs.get(tabId);
    if (!t) return;
    const fail = e => console.warn('[show-and-tell] pause', e);
    switch (method) {
      case 'Debugger.scriptParsed':
        t.scripts.set(params.scriptId, { id: params.scriptId, url: params.url || '', startLine: params.startLine || 0, startColumn: params.startColumn || 0 });
        break;
      case 'Debugger.paused': onPaused(tabId, t, params).catch(fail); break;
      case 'Debugger.resumed': onResumed(tabId, t); break;
      case 'Fetch.requestPaused': onHeld(tabId, t, params).catch(fail); break;
      case 'DOM.documentUpdated': {
        // A new document: the watched elements are gone, and so are their breakpoints. After a reload from
        // a pause they are set again on the new elements.
        t.root = 0;
        const before = t.points.length, now = Date.now();
        for (const p of t.points) if (p.kind === 'dom') p.nodeId = 0;
        t.points = t.points.filter(p => p.kind !== 'dom' || p.again > now);
        if (t.points.some(p => p.kind === 'dom')) watchAgain(tabId, t).catch(fail);
        if (t.points.length !== before) publish(tabId, 'navigation').then(() => settle(tabId)).catch(fail);
        break;
      }
    }
  }

  // A new page in the tab: requests of the old one no longer wait, and its scripts are gone.
  function navigated(tabId) {
    const t = tabs.get(tabId);
    if (!t) return;
    for (const [id, s] of t.scripts) if (s.source != null) t.scripts.delete(id);
    const before = t.held.size;
    for (const [id, h] of t.held) if (h.type !== 'Document') t.held.delete(id);
    if (t.held.size !== before) publish(tabId, 'navigation').then(() => settle(tabId)).catch(() => {});
  }

  // A new document took the place of a paused one (reload, another address): the debugger reports no
  // resume for that. at: when it happened, so a pause inside the new document stays.
  function replaced(tabId, at) {
    const t = tabs.get(tabId);
    if (!t?.paused || t.paused.since > at) return;
    clearTimeout(t.stepTimer);
    t.resumedBy = t.reloading || 'navigation';
    ran(tabId, t).catch(() => {});
  }

  // Everything off for one tab: points removed, requests released, page running.
  async function clear(tabId, by = 'agent') {
    const t = tabs.get(tabId);
    if (!t) return { ok: true, removed: 0 };
    const removed = t.points.length;
    for (const p of [...t.points]) await unset(tabId, t, p);
    const released = await releaseHeld(tabId, t, false);
    t.nowPending = false; t.stepping = false; clearTimeout(t.stepTimer);
    if (t.paused) { t.resumedBy = by; const done = next(t, 3000); await quiet(tabId, 'Debugger.resume'); await done; }
    if (tabs.get(tabId) === t) { t.paused = null; t.frames = []; await publish(tabId, by); await settle(tabId); }
    return { ok: true, removed, released };
  }

  async function clearSession(session, by = 'session ended') {
    for (const [tabId, t] of [...tabs]) if (t.session === session) await clear(tabId, by).catch(() => {});
  }

  async function clearAll(by) {
    for (const tabId of [...tabs.keys()]) await clear(tabId, by).catch(() => {});
  }

  // The debugger let go of the tab (tab closed, DevTools took over, …): the browser resumed it already.
  function dropped(tabId) {
    const t = tabs.get(tabId);
    if (!t) return;
    tabs.delete(tabId);
    clearTimeout(t.stepTimer);
    wake(t, null);
    publish(tabId, 'detached', t.session);
  }

  // After a worker restart nothing in memory matches the tabs any more: switch off what an earlier worker left.
  async function recover() {
    const { pauses = {} } = await S.get('pauses');
    for (const id of Object.keys(pauses)) {
      await quiet(+id, 'Fetch.disable');
      await quiet(+id, 'Debugger.disable');
    }
    await S.set({ pauses: {} });
  }

  return {
    add, remove, resume, inspect, clear, clearSession, clearAll, dropped, navigated, replaced, onEvent, recover,
    // A bridge that just connected learns what is paused.
    resend() { for (const [tabId, t] of tabs) { const v = view(t); if (v) tell({ type: 'pauseState', tabId, by: 'sync', ...v }); } },
    has: tabId => tabs.has(tabId),
    paused: tabId => tabs.get(tabId)?.paused || null,
    list: tabId => view(tabs.get(tabId)) || { points: [], paused: null, held: null },
  };
}
