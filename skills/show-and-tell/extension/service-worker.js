// Owns the WebSocket to the bridge, the action outbox and the highlight list.
// State lives in chrome.storage.session so it survives service-worker restarts and navigations;
// the side panel and the content scripts render from it.
import { loadConfig, hostAllowed, pageKey } from './allow.js';
import { stepTiming, estimateMs, pickSize, bitrate } from './video-plan.js';

const S = chrome.storage.session;
S.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {}); // content scripts read highlights
S.set({ connected: false });
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.alarms.create('keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async () => {
  connect();
  // The bridge sends the session list only when it changes; tabs opened since then are swept here.
  const { sessions = [], endedSessions = [] } = await S.get(['sessions', 'endedSessions']);
  sweepTabs(sessions, endedSessions);
});
chrome.runtime.onStartup.addListener(() => connect());
chrome.runtime.onInstalled.addListener(() => connect());

let lock = Promise.resolve();
const serial = fn => { const p = lock.then(fn); lock = p.catch(() => {}); return p; };
// ------------------------------------------------------------------ allowed hosts
// Config patterns, plus what the bridge pushes: the hosts file's loopback names, current config files and
// this session's grants. Other hosts need the user's answer in the panel; the agent can only ask.
// "This session" grants also live here (until the browser restarts) and go back to a restarted bridge.
let hostState = { allow: [], loopback: [], granted: [] }, localGrants = [];
const hostsReady = S.get(['hostState', 'localGrants']).then(r => {
  if (r.hostState) hostState = r.hostState;
  localGrants = r.localGrants || [];
});
const allowed = async url => {
  await hostsReady;
  const { allow, loopback, granted } = hostState;
  return hostAllowed(url, [...(await loadConfig()).allowlist, ...allow, ...loopback, ...granted, ...localGrants]);
};
const resendGrants = async () => { await hostsReady; for (const host of localGrants) send({ type: 'hostGrant', host, mode: 'session' }); };
const hostOf = url => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };

async function setHostState(next) {
  hostState = { allow: next.allow || [], loopback: next.loopback || [], granted: next.granted || [] };
  await S.set({ hostState: { ...hostState, granted: [...new Set([...hostState.granted, ...localGrants])] } });
}

// Records a grant here at once (the bridge confirms with its next push) and wakes pages on that host,
// whose content script stayed idle.
async function grantHost(host, mode, { tell = true } = {}) {
  await hostsReady;
  if (!localGrants.includes(host)) {
    localGrants = [...localGrants, host];
    await S.set({ localGrants });
    await setHostState(hostState);
  }
  if (tell) send({ type: 'hostGrant', host, mode });
  for (const t of await chrome.tabs.query({})) {
    if (hostOf(t.url || '') === host) chrome.tabs.sendMessage(t.id, { cmd: 'recheck' }).catch(() => {});
  }
}

// One question per host at a time, shown in the panel; resolves "session", "always", "no" or "timeout".
const hostAsks = new Map(); // host -> { promise, resolve }
async function askUser(host, why = '', who = '') {
  if (hostAsks.has(host)) return hostAsks.get(host).promise;
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  const id = 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  hostAsks.set(host, { promise, resolve, id });
  const list = async fn => serial(async () => { const { hostQuestions = [] } = await S.get('hostQuestions'); await S.set({ hostQuestions: fn(hostQuestions) }); });
  who ||= (await S.get('listener')).listener || '';
  await list(q => [...q, { id, host, why, who }]);
  const timer = setTimeout(() => resolve('timeout'), 120000);
  const decision = await promise;
  clearTimeout(timer);
  hostAsks.delete(host);
  await list(q => q.filter(x => x.id !== id));
  return decision;
}

// Allowed, or allowed after asking the user. Returns an error text when not.
async function permit(url, why) {
  if (await allowed(url)) return '';
  const host = hostOf(url);
  // The session's placeholder tab, a new tab page, …: nothing to ask the user about.
  if (!host || !/^https?:/i.test(url)) return isPlaceholder(url) ? 'no page is open in your tab yet: pass url, or open one with browser_navigate first'
    : `not an http(s) page: ${url}`;
  const decision = await askUser(host, why);
  if (decision === 'session' || decision === 'always') { await grantHost(host, decision); return ''; }
  return decision === 'no' ? `the user did not allow ${host}` : `the user did not answer the question about ${host} in the side panel`;
}

// All hosts a tour visits, asked up front so a tour or video does not stop halfway.
async function permitTour(tour, why, tab) {
  tab ||= await activeTab();
  const urls = [...new Set([...(tour?.steps || []).map(s => s.url).filter(Boolean), ...(tour?.steps?.[0]?.url ? [] : [tab?.url].filter(Boolean))])];
  for (const u of urls) { const e = await permit(u, why); if (e) return e; }
  return '';
}

// ------------------------------------------------------------------ bridge connection

let ws = null, backoff = 1000, retry = null, ping = null;
const panels = new Set();
let video = null; // the recording in progress, see "video recording" below
S.set({ video: null });

async function connect() {
  if (ws) return;
  const { bridgeUrl } = await loadConfig();
  if (ws) return;
  const sock = new WebSocket(bridgeUrl);
  ws = sock;
  sock.onopen = () => {
    backoff = 1000;
    S.set({ connected: true });
    clearInterval(ping);
    ping = setInterval(() => send({ type: 'ping' }), 20000); // traffic keeps the worker alive
    send({ type: 'panel', open: panels.size > 0 });
    resendGrants();
    sessionTabs().then(map => send({ type: 'knownSessions', sessions: Object.entries(map).filter(([, e]) => e.pid && !e.ended)
      .map(([id, e]) => ({ id, name: e.name, color: e.color, pid: e.pid })) }));
    flushOutbox();
  };
  sock.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    onBridge(m).catch(err => console.warn('[show-and-tell]', err));
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    clearInterval(ping);
    S.set({ connected: false, waiting: false });
    if (!retry) retry = setTimeout(() => { retry = null; connect(); }, backoff);
    backoff = Math.min(backoff * 2, 15000);
  };
}

function send(m) {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(m));
  return true;
}

// ------------------------------------------------------------------ outbox (nothing is lost)

// `to`: the session the input belongs to (its tab, tour or video); empty = whoever drove the browser last.
async function enqueue(action, to = '') {
  const item = { id: crypto.randomUUID(), action: { ...action, ts: Date.now(), ...(to && { to }) } };
  await serial(async () => {
    const { outbox = [] } = await S.get('outbox');
    outbox.push(item);
    await S.set({ outbox });
  });
  if (!send({ type: 'action', ...item })) connect();
  if (['question', 'annotation', 'recording'].includes(action.type)) await chatUser(to, item.id, action);
  return { id: item.id, delivered: ws?.readyState === WebSocket.OPEN };
}

// ------------------------------------------------------------------ conversation in the panel
// Per session ("" = no session's tab): what the user sent and what the agent did in the browser, shown
// in the panel like a chat. Kept until the browser restarts, at most 60 entries per session.
const chatEdit = fn => serial(async () => {
  const { chats = {} } = await S.get('chats');
  if (fn(chats) === false) return;
  for (const k of Object.keys(chats)) if (chats[k].length > 60) chats[k].splice(0, chats[k].length - 60);
  await S.set({ chats });
});

// The user's own steps, without the setViewport/navigate it starts with and the tab markers.
const recSteps = (steps = []) => Math.max(0, steps.filter(s => !['newTab', 'switchTab', 'closeTab'].includes(s.type)).length - 2);
// An annotation and a recording sent with one message arrive as two actions: one bubble.
function chatUser(to, id, a) {
  const att = a.type === 'annotation' ? `Annotation · ${a.annotations?.length || 0}`
    : a.type === 'recording' ? `Recording · ${recSteps(a.recording?.steps)} steps${a.recording?.tabs ? ` · ${a.recording.tabs} tabs` : ''}` : '';
  return chatEdit(chats => {
    const list = chats[to || ''] ||= [];
    const last = list[list.length - 1];
    if (last?.role === 'user' && att && last.text === (a.text || '') && Date.now() - last.ts < 3000) {
      last.att.push(att); last.ids.push(id); return;
    }
    list.push({ role: 'user', ids: [id], text: a.text || '', att: att ? [att] : [], ts: Date.now(), acked: false });
  });
}

const chatAgent = (sid, entry) => chatEdit(chats => { (chats[sid || ''] ||= []).push({ role: 'agent', ts: Date.now(), ...entry }); });

async function flushOutbox() {
  const { outbox = [] } = await S.get('outbox');
  for (const item of outbox) send({ type: 'action', ...item });
}

const ack = async id => {
  await serial(async () => {
    const { outbox = [] } = await S.get('outbox');
    await S.set({ outbox: outbox.filter(x => x.id !== id) });
  });
  await chatEdit(chats => {
    for (const list of Object.values(chats)) {
      const m = list.find(x => x.role === 'user' && x.ids?.includes(id));
      if (m && !m.acked) { m.acked = true; return; }
    }
    return false;
  });
};

// ------------------------------------------------------------------ one tab per agent session
// Every session works in its own tab, grouped and named after it ("app", "app 2", …) in its colour. The
// first session takes the tab in front if no session owns it; later ones get a new tab. The panel shows,
// and sends to, the session whose tab is in front. Commands without a session (the CLI) use that tab.

const sessionTabs = () => S.get('sessionTabs').then(r => r.sessionTabs || {});
// A session's tabs: the one it started in plus every tab opened from them (see "tabs opened from a
// session's tab" below). tabId is the working tab, the newest one still open; tools act there.
const tabsOf = e => (e.tabs?.length ? e.tabs : [e.tabId]);
async function sessionOfTab(tabId) {
  for (const [sid, e] of Object.entries(await sessionTabs())) if (tabsOf(e).includes(tabId)) return sid;
  return '';
}

async function groupTab(tab, name, color) {
  try {
    const groupId = tab.groupId >= 0 ? tab.groupId : await chrome.tabs.group({ tabIds: tab.id, createProperties: { windowId: tab.windowId } });
    await chrome.tabGroups.update(groupId, { title: name, color });
    await rememberGroup(name);
    return groupId;
  } catch { return -1; }
}

// The session's tab: its own if still open, else the front tab if nobody owns it, else a new one.
function sessionTab(m, { create = true } = {}) {
  return serial(async () => {
    const map = await sessionTabs();
    const e = map[m.session];
    if (e) {
      const t = await chrome.tabs.get(e.tabId).catch(() => null);
      if (t) {
        if (m.sessionName && (e.name !== m.sessionName || e.color !== m.color)) {
          await groupTab(t, m.sessionName, m.color);
          map[m.session] = { ...e, name: m.sessionName, color: m.color };
          await S.set({ sessionTabs: map });
        }
        return t;
      }
      // The working tab closed while the session has others: the agent chooses where to go on, so a script
      // never acts on a page it has not looked at.
      if (tabsOf(e).some(id => id !== e.tabId)) {
        if (!create) return null;
        throw new Error(`your working tab was closed${e.lostUrl ? ` (${e.lostUrl})` : ''}; call tabs to list your other tabs and select one`);
      }
    }
    if (!create) return null;
    const owned = new Set(Object.values(map).flatMap(tabsOf));
    const front = await activeTab();
    // Only a web page in front is taken over; browser pages (new tab, settings) get a tab of the session's own.
    let t = front && !owned.has(front.id) && /^https?:/.test(front.url) && front.groupId < 0 && !(await isLab(front.url)) ? front : null;
    t ||= await chrome.tabs.create({ windowId: front?.windowId, active: true,
      url: chrome.runtime.getURL('tab.html') + '?s=' + encodeURIComponent(m.session) + '&n=' + encodeURIComponent(m.sessionName || '') });
    const name = m.sessionName || 'agent', color = m.color || 'blue';
    await groupTab(t, name, color);
    map[m.session] = { tabId: t.id, tabs: [t.id], name, color };
    await S.set({ sessionTabs: map });
    return chrome.tabs.get(t.id);
  });
}

// The tab a command acts on, brought to the front when the user is meant to look at it.
async function tabFor(m, { show = false } = {}) {
  const t = m.session ? await sessionTab(m) : await activeTab();
  if (t && show && !t.active) { await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true }).catch(() => {}); }
  return t;
}

// ------------------------------------------------------------------ tabs opened from a session's tab
// Chrome puts every tab a grouped tab opens (links with target=_blank, window.open, forms, also without a
// click) into its group, so the group says which session a tab belongs to; Chrome's opener field is often
// empty. Popup windows cannot hold groups: they belong to the session of the tab that opened them, which
// Chrome does report there. Such a tab joins the session's tabs, and the agent is told; its calls stay on
// its working tab until it switches (`tabs`), so nothing moves under a running script.
const groupsOf = async e => new Set((await Promise.all(tabsOf(e).map(id => chrome.tabs.get(id).catch(() => null))))
  .map(t => t?.groupId ?? -1).filter(g => g >= 0));
// A new tab's first page load belongs to the new-tab news, not another line.
const freshTabs = new Map(); // tabId -> until
// Last known address per tab, for the news when one closes (chrome.tabs.onRemoved has none).
const tabUrls = new Map();
// Tabs created recently, for tours waiting for a tab their step opens (also without a session).
const createdTabs = []; // { id, ts }
async function adoptTab(tab) {
  if (!tab?.id || tab.url?.endsWith('/panel.html')) return;
  let report = null;
  await serial(async () => {
    const map = await sessionTabs();
    if (Object.values(map).some(e => tabsOf(e).includes(tab.id))) return;
    let sid = '';
    if (tab.groupId >= 0) for (const [k, e] of Object.entries(map)) { if ((await groupsOf(e)).has(tab.groupId)) { sid = k; break; } }
    if (!sid && tab.openerTabId != null) {
      const win = await chrome.windows.get(tab.windowId).catch(() => null);
      if (win?.type === 'popup') sid = Object.keys(map).find(k => tabsOf(map[k]).includes(tab.openerTabId)) || '';
    }
    if (!sid) return;
    const e = map[sid];
    e.tabs = [...tabsOf(e).filter(id => id != null), tab.id];
    e.opened = { ...(e.opened || {}), [tab.id]: Date.now() };
    await S.set({ sessionTabs: map });
    if (!e.ended) report = sid;
  });
  if (report) tabNews(report, 'newTab', tab.id, Date.now());
}
// What the agent hears about it, once the new tab knows its address.
async function tabNews(session, kind, tabId, ts, url = '') {
  for (let i = 0; i < 10 && !url; i++) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    url = t?.url || t?.pendingUrl || '';
    if (!url || url === 'about:blank') { url = ''; await new Promise(r => setTimeout(r, 200)); }
  }
  send({ type: 'userEvent', session, event: { kind, url: url || 'about:blank', tab: tabId, ts } });
}

// A video records one tab; a tab or popup opened from it would go unrecorded (and push the recorded tab to
// the background), so the video stops with an error that says why.
async function videoSawTab(tab) {
  const v = video;
  if (!v || v.finishing || tab.id === v.tabId) return;
  const rec = await chrome.tabs.get(v.tabId).catch(() => null);
  if (tab.openerTabId !== v.tabId && !(rec && rec.groupId >= 0 && tab.groupId === rec.groupId)) return;
  v.opened?.add(tab.id); // checked after the step: followed with waitForTab, or an error
}

chrome.tabs.onCreated.addListener(tab => {
  freshTabs.set(tab.id, Date.now() + 5000);
  createdTabs.push({ id: tab.id, ts: Date.now() }); if (createdTabs.length > 30) createdTabs.shift();
  videoSawTab(tab);
  adoptTab(tab);
});
chrome.tabs.onUpdated.addListener((id, info, tab) => {
  if (info.url) tabUrls.set(id, info.url);
  if (!('groupId' in info)) return;
  if (info.groupId >= 0) { videoSawTab(tab); adoptTab(tab); return; }
  // Dragged out of the group: no longer the session's (its working tab stays, the user can't lose that).
  serial(async () => {
    const map = await sessionTabs();
    for (const e of Object.values(map)) if (e.tabs?.includes(id) && e.tabId !== id) { e.tabs = e.tabs.filter(x => x !== id); await S.set({ sessionTabs: map }); }
  });
});

// A closed tab leaves its session, and the agent is told. When it was the working tab, no other tab is
// picked for it: its next call fails until it selects one with `tabs` (or, without others, gets a new tab).
chrome.tabs.onRemoved.addListener(tabId => serial(async () => {
  const url = tabUrls.get(tabId) || ''; tabUrls.delete(tabId);
  const map = await sessionTabs();
  const sid = Object.keys(map).find(k => tabsOf(map[k]).includes(tabId));
  if (!sid) return;
  const e = map[sid], rest = tabsOf(e).filter(x => x !== tabId && x != null);
  if (!rest.length) delete map[sid];
  else {
    e.tabs = rest;
    if (e.opened) delete e.opened[tabId];
    const working = e.tabId === tabId;
    if (working) { e.tabId = null; e.lostUrl = url; }
    if (!e.ended) tabNews(sid, working ? 'workingTabClosed' : 'tabClosed', tabId, Date.now(), url || 'a page');
  }
  await S.set({ sessionTabs: map });
}));

// The `tabs` tool: list the session's tabs, select one as the working tab, or wait for one to open.
// `since`: the start of the agent's previous call, so a tab its last click opened counts as new.
async function sessionTabsCmd(m) {
  const describe = async e => {
    const out = [];
    for (const id of tabsOf(e)) {
      const t = await chrome.tabs.get(id).catch(() => null);
      if (!t) continue;
      const win = await chrome.windows.get(t.windowId).catch(() => null);
      out.push({ id, url: t.url || t.pendingUrl, title: t.title, working: id === e.tabId, ...(win?.type === 'popup' && { popup: true }), ...(t.active && { inFront: true }) });
    }
    return out;
  };
  const map = await sessionTabs(), e = map[m.session || ''];
  if (!e) return { ok: true, tabs: [], note: 'no tab yet; your first browser call opens one' };
  if (m.action === 'select') {
    const id = +m.id;
    if (!tabsOf(e).includes(id) || !(await chrome.tabs.get(id).catch(() => null))) return { ok: false, error: `tab ${m.id} is not one of yours`, tabs: await describe(e) };
    await serial(async () => { const mp = await sessionTabs(); if (mp[m.session]) { mp[m.session].tabId = id; delete mp[m.session].lostUrl; await S.set({ sessionTabs: mp }); } });
    return { ok: true, selected: id, tabs: await describe((await sessionTabs())[m.session]) };
  }
  if (m.action === 'waitForNew') {
    const since = e.tabsSeenAt || 0, end = Date.now() + Math.min(60000, Math.max(0, +m.timeoutMs || 10000));
    for (;;) {
      const cur = (await sessionTabs())[m.session];
      const fresh = cur && Object.entries(cur.opened || {}).filter(([, ts]) => ts >= since - 200).sort((a, b) => b[1] - a[1])[0];
      if (fresh) {
        const id = +fresh[0];
        if (m.select) await sessionTabsCmd({ ...m, action: 'select', id });
        const all = await describe((await sessionTabs())[m.session]);
        return { ok: true, tab: all.find(t => t.id === id), tabs: all };
      }
      if (Date.now() > end) return { ok: false, error: 'no new tab opened', tabs: cur ? await describe(cur) : [] };
      await new Promise(r => setTimeout(r, 200));
    }
  }
  return { ok: true, tabs: await describe(e) };
}
// waitForNew counts tabs opened since the agent's previous tabs call.
const sessionTabsSeen = async (m, out) => { await serial(async () => { const mp = await sessionTabs(); if (mp[m.session]) { mp[m.session].tabsSeenAt = Date.now(); await S.set({ sessionTabs: mp }); } }); return out; };

// Tours: wait for a tab the step opened (in the tour tab's group, from it, or a popup it opened).
async function waitForTabFrom(fromId, since, ms) {
  const from = await chrome.tabs.get(fromId).catch(() => null);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const c of createdTabs.filter(x => x.ts >= since - 200 && x.id !== fromId).reverse()) {
      const t = await chrome.tabs.get(c.id).catch(() => null);
      if (t && (t.openerTabId === fromId || (from && from.groupId >= 0 && t.groupId === from.groupId))) return t;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

// ------------------------------------------------------------------ cleanup of ended sessions
// Only sessions the bridge reports as ended are touched: their MCP process has exited, so no chat can use
// them again. Silence, an offline bridge or an unknown session never count. An ended session's placeholder
// tab closes at once; a real page turns into a grey "<name> · ended" group. 15 minutes later the tab
// closes, unless the user opened it after the session ended or it is in front: then it is only ungrouped.
// Groups restored from the last browser run go back to their session if it is still alive; the rest are
// ungrouped (placeholders closed).
const ENDED_MS = 15 * 60000;
const isPlaceholder = url => (url || '').startsWith(chrome.runtime.getURL('tab.html'));
const ungroup = tabId => chrome.tabs.ungroup(tabId).catch(() => {});

async function rememberGroup(name) {
  const { ourGroups = [] } = await chrome.storage.local.get('ourGroups');
  if (!ourGroups.includes(name)) await chrome.storage.local.set({ ourGroups: [...ourGroups, name].slice(-50) });
}

function sweepTabs(live, endedIds) {
  return serial(async () => {
    await adoptRestored(live);
    const map = await sessionTabs(), ids = new Set(live.map(s => s.id)), gone = new Set(endedIds);
    let changed = false;
    for (const [sid, e] of Object.entries(map)) {
      const tabs = (await Promise.all(tabsOf(e).map(id => chrome.tabs.get(id).catch(() => null)))).filter(Boolean);
      if (!tabs.length) { delete map[sid]; changed = true; continue; }
      if (tabs.length !== tabsOf(e).length) {
        e.tabs = tabs.map(t => t.id);
        if (!e.tabs.includes(e.tabId)) e.tabId = null; // closed while the worker slept: the agent picks
        changed = true;
      }
      const t = tabs.find(x => x.id === e.tabId) || tabs[0];
      // The pid goes back to a new bridge after a handover, so it can still tell when this session ends.
      const pid = live.find(s => s.id === sid)?.pid;
      if (pid && e.pid !== pid) { e.pid = pid; changed = true; }
      if (ids.has(sid) && !gone.has(sid)) {
        if (e.ended) { await groupTab(t, e.name, e.color); delete e.ended; delete e.looked; changed = true; }
        continue;
      }
      if (!e.ended && !gone.has(sid)) continue; // not reported as ended: someone may still need it
      if (!e.ended) {
        for (const x of tabs.filter(x => isPlaceholder(x.url))) await chrome.tabs.remove(x.id).catch(() => {});
        const kept = tabs.filter(x => !isPlaceholder(x.url));
        if (!kept.length) { delete map[sid]; changed = true; continue; }
        e.tabs = kept.map(x => x.id); if (!e.tabs.includes(e.tabId)) e.tabId = e.tabs[e.tabs.length - 1];
        for (const g of new Set(kept.map(x => x.groupId).filter(g => g >= 0))) await chrome.tabGroups.update(g, { title: `${e.name} · ended`, color: 'grey' }).catch(() => {});
        e.ended = Date.now(); changed = true;
        continue;
      }
      if (Date.now() - e.ended < ENDED_MS) continue;
      const looked = new Set(e.looked || []);
      for (const x of tabs) { if (looked.has(x.id) || x.active) await ungroup(x.id); else await chrome.tabs.remove(x.id).catch(() => {}); }
      delete map[sid]; changed = true;
    }
    if (changed) await S.set({ sessionTabs: map });
  });
}

// The user opening an ended session's tab means they want it: it is kept (ungrouped) later.
chrome.tabs.onActivated.addListener(({ tabId }) => serial(async () => {
  const map = await sessionTabs();
  const e = Object.values(map).find(x => x.ended && tabsOf(x).includes(tabId) && !x.looked?.includes(tabId));
  if (e) { e.looked = [...(e.looked || []), tabId]; await S.set({ sessionTabs: map }); }
}));

// Groups Chrome restores from the last run (it brings back tabs and groups, not the extension's map): one
// whose name is a running session's goes back to it, on every sweep, since restored tabs can appear late.
// In the first minute after the browser starts, groups of ours that no running session claims are
// ungrouped and their placeholders closed. Tabs the user opened are never in our groups, so never touched.
const bootedAt = S.get('bootedAt').then(async r => { if (r.bootedAt) return r.bootedAt; const t = Date.now(); await S.set({ bootedAt: t }); return t; });
async function adoptRestored(live) {
  const { ourGroups = [] } = await chrome.storage.local.get('ourGroups');
  if (!ourGroups.length) return false;
  const names = new Set(ourGroups), map = await sessionTabs(), startup = Date.now() - (await bootedAt) < 60000;
  const owned = new Set(Object.values(map).flatMap(tabsOf));
  let changed = false;
  for (const g of await chrome.tabGroups.query({})) {
    const name = String(g.title || '').replace(/ · ended$/, '');
    if (!names.has(name)) continue;
    const tabs = (await chrome.tabs.query({ groupId: g.id })).filter(t => !owned.has(t.id));
    if (!tabs.length) continue;
    // A grey "· ended" group belonged to a session that is gone; a new one with the same name must not get it.
    const s = startup && !/ · ended$/.test(g.title || '') && live.find(x => x.name === name && !map[x.id]);
    if (s) {
      const keep = tabs.find(t => !isPlaceholder(t.url)) || tabs[0];
      map[s.id] = { tabId: keep.id, tabs: [...tabs.filter(t => t !== keep).map(t => t.id), keep.id], name: s.name, color: s.color };
      for (const t of tabs) owned.add(t.id);
      changed = true;
      await chrome.tabGroups.update(g.id, { title: s.name, color: s.color }).catch(() => {});
      continue;
    }
    if (!startup || live.some(x => x.name === name)) continue;
    for (const t of tabs) {
      if (isPlaceholder(t.url)) await chrome.tabs.remove(t.id).catch(() => {}); else await ungroup(t.id);
    }
  }
  if (changed) await S.set({ sessionTabs: map });
  return changed;
}
// ------------------------------------------------------------------ bridge -> extension

async function onBridge(m) {
  if (m.type === 'ack') return ack(m.id);
  if (m.type === 'pong') return;
  if (m.cmd === 'setStep') {
    // A session's tour labels its own steps; the bridge re-sends every label on reconnect.
    const { tour, tourSession = '' } = await S.get(['tour', 'tourSession']);
    if (tour && tourSession === (m.session || '')) return;
    return serial(async () => {
      const { steps = {} } = await S.get('steps');
      if (m.label) steps[m.session || ''] = String(m.label); else delete steps[m.session || ''];
      await S.set({ steps });
    });
  }
  if (m.cmd === 'setWaiting') {
    await S.set({ waiting: !!m.waiting, listener: String(m.listener || ''), sessions: m.sessions || [], endedSessions: m.ended || [] });
    return sweepTabs(m.sessions || [], m.ended || []);
  }
  if (m.cmd === 'hosts') return setHostState(m);
  if (m.cmd === 'lab') return S.set({ labUrl: String(m.url || LAB_DEFAULT) });
  if (m.cmd === 'thinking') return serial(async () => { const { thinking = {} } = await S.get('thinking'); thinking[m.session] = m.ts; await S.set({ thinking }); });
  if (m.cmd === 'say') {
    await serial(async () => { const { thinking = {} } = await S.get('thinking'); delete thinking[m.session]; await S.set({ thinking }); });
    return chatAgent(m.session, { kind: 'say', text: String(m.text || '') });
  }
  if (m.cmd === 'activity') {
    const a = { text: String(m.text || ''), who: String(m.who || ''), session: String(m.session || ''), ts: Date.now() };
    // A run of browser actions is one entry that updates in place, like an agent's "working" line.
    return chatEdit(chats => {
      const list = chats[a.session] ||= [];
      const last = list[list.length - 1];
      if (last?.kind === 'activity' && a.ts - last.ts < 60000) Object.assign(last, { text: a.text, ts: a.ts, count: (last.count || 1) + 1 });
      else list.push({ role: 'agent', kind: 'activity', text: a.text, who: a.who, ts: a.ts, count: 1 });
    });
  }
  if (!m.rid) return;
  let result;
  try { result = await command(m); } catch (e) { result = { ok: false, error: String(e?.message || e) }; }
  send({ type: 'result', rid: m.rid, ...result });
}

// A tour belongs to the session that loaded it; another session's tour is left alone.
async function tourBusy(m) {
  const { tour, tourSession = '' } = await S.get(['tour', 'tourSession']);
  if (!tour || tourSession === (m.session || '')) return '';
  const name = (await sessionTabs())[tourSession]?.name || 'another agent session';
  return `${name} is running a tour in this browser; wait until it ends`;
}

async function command(m) {
  // The agent's browser_* call starts or ends: the session's page is told, so it can tell the agent's
  // (equally trusted) input from the user's. Allowed during a video too; it changes nothing on screen.
  if (m.cmd === 'agentBusy') {
    const tab = (await sessionTabs())[m.session];
    if (tab) await chrome.tabs.sendMessage(tab.tabId, { cmd: 'agentBusy', on: !!m.on }).catch(() => {});
    return { ok: true };
  }
  if (video && !['state', 'recordStop', 'setStep', 'askHost', 'tabs'].includes(m.cmd)) {
    const who = video.session && video.session !== m.session ? ` by ${(await sessionTabs())[video.session]?.name || 'another session'}` : '';
    return { ok: false, error: `a video is being recorded${who}; ${who ? 'wait until it is done' : 'wait for videoReady or call recordStop'}` };
  }
  switch (m.cmd) {
    // The bridge asks for the session's tab before each browser_* call.
    case 'sessionTab': {
      // Playwright cannot act in a background tab (it waits for animation frames, which Chrome pauses
      // there), so a tab that opened on top is put behind the working tab again for the call.
      let t = await sessionTab(m);
      if (t && !t.active) t = await chrome.tabs.update(t.id, { active: true }).catch(() => t);
      return t ? { ok: true, tabId: t.id, url: t.pendingUrl || t.url } : { ok: false, error: 'could not open a tab for this session' };
    }
    // The bridge asks on behalf of the browser_* tools; it records the grant itself.
    case 'askHost': {
      const decision = await askUser(String(m.host), m.why, m.who);
      if (decision === 'session' || decision === 'always') await grantHost(String(m.host), decision, { tell: false });
      return { ok: true, decision };
    }
    case 'recordTour': {
      const busy = await tourBusy(m);
      if (busy) return { ok: false, error: busy };
      const tab = await tabFor(m, { show: true });
      const e = await permitTour(m.tour, 'record a video there', tab);
      return e ? { ok: false, error: e } : recordTour(m, tab);
    }
    case 'tabs': return sessionTabsSeen(m, await sessionTabsCmd(m));
    case 'recordStop':
      if (video?.session && m.session && video.session !== m.session) return { ok: false, error: 'this video belongs to another session' };
      return recordStop(m);
    case 'highlight': {
      const r = await highlight({ ...m, session: m.session || '', tab: await tabFor(m, { show: true }) });
      // The agent pointing at something is part of the conversation; tour steps are not.
      if (r.ok) await chatAgent(m.session, { kind: 'point', text: m.item?.label || '', selector: String(m.item?.selector || ''), host: hostOf(r.url || '') });
      return r;
    }
    // network and cpu are independent; "off" for the network without a cpu value resets both.
    case 'throttle': {
      const tab = await tabFor(m);
      if (!tab) return { ok: false, error: 'no tab' };
      if (m.network === 'off' && m.cpu === undefined) return { ...(await throttleOff(tab.id)), tabId: tab.id };
      const out = { ok: true, tabId: tab.id };
      if (m.network !== undefined) Object.assign(out, await setNetwork(tab.id, m.network));
      if (out.ok && m.cpu !== undefined) Object.assign(out, await setCpu(tab.id, m.cpu));
      return out;
    }
    // A session clears its own highlights only.
    case 'clearHighlights':
      await serial(async () => {
        const { highlights = [] } = await S.get('highlights');
        const mine = h => !m.session || h.session === m.session;
        await S.set({ highlights: highlights.filter(h => !mine(h) || (m.id && h.id !== m.id)) });
      });
      return { ok: true };
    case 'hideOverlays':
      await S.set({ overlaysHidden: !!m.hidden });
      return { ok: true, hidden: !!m.hidden };
    // Steps can take longer than the bridge waits for a reply: start them and report failures as stepError.
    case 'loadTour': {
      const busy = await tourBusy(m);
      if (busy) return { ok: false, error: busy };
      const tab = await tabFor(m, { show: true });
      const e = await permitTour(m.tour, 'run a tour there', tab);
      if (e) return { ok: false, error: e };
      await S.set({ tour: validTour(m.tour), tourIndex: -1, tourRunning: false, tourSession: m.session || '', tourTab: tab?.id ?? null, tourHome: tab?.id ?? null, tourStepTabs: {}, tourStack: [] });
      gotoStep(m.start ?? 0, { replay: true });
      return { ok: true, steps: m.tour.steps.length };
    }
    case 'gotoStep': {
      const busy = await tourBusy(m);
      if (busy) return { ok: false, error: busy };
      gotoStep(+m.index, { replay: true });
      return { ok: true };
    }
    case 'endTour': {
      const busy = await tourBusy(m);
      if (busy) return { ok: false, error: busy };
      const { tourSession: ts = '', tourTab: tt, tourThrottled } = await S.get(['tourSession', 'tourTab', 'tourThrottled']);
      await clearSessionHighlights(ts);
      if (tourThrottled && tt != null) await throttleOff(tt);
      await S.set({ tour: null, tourIndex: -1, explanation: '', step: '', tourRunning: false, tourSession: '', tourTab: null, tourHome: null, tourStepTabs: {}, tourStack: [], tourThrottled: false });
      return { ok: true };
    }
    // The agent asks the user to show something: the panel shows the prompt and recording starts.
    case 'requestDemo': {
      const id = 'r' + Date.now().toString(36);
      const tab = await tabFor(m, { show: true });
      const denied = tab ? await permit(tab.url, 'see what you do there') : '';
      if (denied) return { ok: false, error: denied };
      const r = await startRecording(tab);
      if (r.error) return { ok: false, error: r.error };
      await S.set({ demoRequest: { id, prompt: String(m.prompt || ''), session: m.session || '' }, recordingDraft: null });
      await chatAgent(m.session, { kind: 'request', text: String(m.prompt || '') });
      return { ok: true, requestId: id };
    }
    case 'state': {
      const tab = m.session ? (await sessionTab(m, { create: false })) || await activeTab() : await activeTab();
      return { ok: true, panelOpen: panels.size > 0, ...(video && { video: (await S.get('video')).video }),
        tab: tab && { url: tab.url, title: tab.title, allowed: await allowed(tab.url) } };
    }
    default: return { ok: false, error: 'unknown command ' + m.cmd };
  }
}

const GESTURES = ['tap', 'double-tap', 'long-press', 'swipe', 'pinch', 'click', 'double-click', 'right-click', 'hover', 'drag', 'scroll'];

// Highlights belong to a session and its tab; replacing or clearing them leaves other sessions' alone.
const clearSessionHighlights = session => serial(async () => {
  const { highlights = [] } = await S.get('highlights');
  await S.set({ highlights: highlights.filter(h => (h.session || '') !== session) });
});

async function highlight({ item = {}, keep, tab, session = '' }) {
  if (!item.selector) return { ok: false, error: 'selector is required' };
  tab ||= await activeTab();
  if (!tab) return { ok: false, error: 'no active tab' };
  // `url` opens the page first, so showing one thing needs no browser driving by the agent.
  if (item.url && tab.url !== item.url) {
    const denied = await permit(String(item.url), 'show you something there');
    if (denied) return { ok: false, error: denied };
    await navigate(tab.id, String(item.url));
    tab = await chrome.tabs.get(tab.id);
  }
  const denied = await permit(tab.url, 'show you something there');
  if (denied) return { ok: false, error: denied };
  const h = {
    id: String(item.id || 'h' + Date.now().toString(36)),
    selector: String(item.selector),
    text: item.text ? String(item.text) : '',
    label: item.label ? String(item.label) : '',
    style: ['spotlight', 'none'].includes(item.style) ? item.style : 'outline',
    color: item.color ? String(item.color) : '',
    gesture: item.gesture ? String(item.gesture) : '',
    direction: item.direction ? String(item.direction) : '',
    to: item.to ? String(item.to) : '',
    pageKey: pageKey(tab.url),
    tabId: tab.id,
    session,
  };
  if (h.gesture && !GESTURES.includes(h.gesture)) return { ok: false, error: `unknown gesture "${h.gesture}"; use one of ${GESTURES.join(', ')}` };
  if (h.direction && !['left', 'right', 'up', 'down', 'in', 'out'].includes(h.direction)) return { ok: false, error: 'direction must be left, right, up, down, in or out' };
  await serial(async () => {
    const { highlights = [] } = await S.get('highlights');
    const others = highlights.filter(x => (x.session || '') !== session);
    const mine = keep ? highlights.filter(x => (x.session || '') === session && x.id !== h.id) : [];
    await S.set({ highlights: [...others, ...mine, h] });
  });
  const probe = await chrome.tabs.sendMessage(tab.id, { cmd: 'probe', id: h.id, scroll: item.scroll !== false })
    .catch(e => ({ found: null, note: 'page not ready yet (' + e.message + '); the highlight appears once it loads' }));
  return { ok: true, id: h.id, url: tab.url, ...probe };
}

// ------------------------------------------------------------------ scripted tours
// The agent hands over the whole tour once; Next/Back then run here without a model round trip.
// Step: { title, explanation?, url?, actions?, highlights?, agent? }. `url` navigates before the step;
// a step without one continues on the current page. `agent: true` hands the step to the agent.

function validTour(tour) {
  if (!tour || !Array.isArray(tour.steps) || tour.steps.length === 0) throw new Error('tour.steps must be a non-empty array');
  tour.steps.forEach((s, i) => { if (!s.title) throw new Error(`step ${i + 1} has no title`); });
  return tour;
}

let running = false;

async function gotoStep(index, { replay }) {
  const { tour, tourSession: owner = '', tourTab, tourHome, tourStepTabs = {}, tourStack = [] } = await S.get(['tour', 'tourSession', 'tourTab', 'tourHome', 'tourStepTabs', 'tourStack']);
  if (!tour) return { ok: false, error: 'no tour loaded' };
  if (running) return { ok: false, error: 'a step is still running' };
  const steps = tour.steps;
  if (index >= steps.length) {
    await enqueue({ type: 'tourEnd', step: steps.length - 1 }, owner);
    return { ok: true, ended: true };
  }
  index = Math.max(0, index);
  const step = steps[index];
  running = true;
  await S.set({ tourIndex: index, tourRunning: true, step: `${index + 1}/${steps.length} – ${step.title}`,
    explanation: step.explanation || '' });
  await clearSessionHighlights(owner);
  try {
    if (step.agent) {
      await enqueue({ type: 'agentStep', step: index, title: step.title }, owner);
      return { ok: true, step: index, agent: true };
    }
    let tab = tourTab != null ? await chrome.tabs.get(tourTab).catch(() => null) : await activeTab();
    if (!tab) throw new Error('the tour\'s tab was closed');
    // Going back (or jumping) replays from the last navigation, so the page state matches the step.
    // `network` / `cpu` throttle the tour's tab from this step on ("off" / 1 end it); so does ending the tour.
    if (step.network !== undefined || step.cpu !== undefined) {
      for (const r of [step.network !== undefined && await setNetwork(tab.id, step.network), step.cpu !== undefined && await setCpu(tab.id, step.cpu)]) {
        if (r && !r.ok) throw new Error(`step ${index + 1}: ${r.error}`);
      }
      await S.set({ tourThrottled: true });
    }
    let from = index;
    if (replay) while (from > 0 && !steps[from].url) from--;
    // A step can move the tour to a tab it opened (waitForTab) and back (backToTab); each step remembers
    // the tab it started on, so Back replays on the right one.
    const ctx = { home: tourHome ?? tab.id, stack: [] };
    if (replay && tourStepTabs[from]) {
      const t = await chrome.tabs.get(tourStepTabs[from].tab).catch(() => null);
      if (t) { tab = t; ctx.stack = [...tourStepTabs[from].stack]; }
      else { tab = (await chrome.tabs.get(ctx.home).catch(() => null)) || tab; }
    } else ctx.stack = [...tourStack];
    for (let i = from; i <= index; i++) {
      const s = steps[i];
      tourStepTabs[i] = { tab: tab.id, stack: [...ctx.stack] };
      if (s.url && i === from) await navigate(tab.id, s.url);
      if (s.actions?.length) tab = await chrome.tabs.get(await run(tab.id, s.actions, i, false, ctx));
    }
    await S.set({ tourTab: tab.id, tourStepTabs, tourStack: ctx.stack });
    if (!tab.active) await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    for (const [i, h] of (step.highlights || []).entries()) {
      await run(tab.id, [{ waitFor: h.selector, text: h.text, after: 0 }], index);
      const r = await highlight({ item: { id: h.id || 'h' + i, ...h }, keep: i > 0, tab: await chrome.tabs.get(tab.id), session: owner });
      if (!r.ok) throw new Error(`step ${index + 1} highlight: ${r.error}`);
      if (r.found === false) throw new Error(`step ${index + 1} highlight not found: ${h.selector}`);
    }
    return { ok: true, step: index };
  } catch (e) {
    const error = String(e?.message || e);
    await enqueue({ type: 'stepError', step: index, error }, owner);
    return { ok: false, step: index, error };
  } finally {
    running = false;
    await S.set({ tourRunning: false });
  }
}

// One action per message: an action that loads a new page closes the message channel, which then
// counts as done once the new page is ready.
// Scripted clicks are untrusted, so Chrome's popup blocker would drop a window.open they trigger, unlike a
// person's click. Tours and videos run on allowed hosts only; popups are allowed there for their steps.
const popupsAllowed = new Set();
async function allowPopups(tabId) {
  try {
    const u = new URL((await chrome.tabs.get(tabId)).url);
    if (!/^https?:$/.test(u.protocol) || popupsAllowed.has(u.origin)) return;
    await chrome.contentSettings.popups.set({ primaryPattern: `${u.protocol}//${u.hostname}/*`, setting: 'allow', scope: 'regular' });
    popupsAllowed.add(u.origin);
  } catch {}
}

// Returns the tab the actions ended on (tours can move to a tab a step opened).
async function run(tabId, actions, i, cinematic = false, ctx = null) {
  ownNav.set(tabId, Date.now() + 600000);
  try { return await runNow(tabId, actions, i, cinematic, ctx); } finally { ownNav.set(tabId, Date.now() + 1500); }
}

async function runNow(tabId, actions, i, cinematic, ctx) {
  let prevStart = Date.now();
  await allowPopups(tabId);
  for (const a of actions) {
    if (a.waitForTab != null || a.backToTab != null) {
      if (!ctx) throw new Error(`step ${i + 1}: waitForTab and backToTab go in a step's actions`);
      tabId = a.waitForTab != null ? await tourWaitForTab(tabId, prevStart, +a.waitForTab || 10000, i, ctx) : await tourBackToTab(tabId, a, i, ctx);
      ownNav.set(tabId, Date.now() + 600000);
      continue;
    }
    prevStart = Date.now();
    let r;
    try { r = await chrome.tabs.sendMessage(tabId, { cmd: 'runActions', actions: [a], cinematic, accent: cinematic ? video?.stage?.branding?.accent : '' }); }
    catch (e) {
      if (!/closed|Receiving end/i.test(e.message)) throw e;
      await pageReady(tabId);
      continue;
    }
    if (!r?.ok) throw new Error(`step ${i + 1}: ${r?.error || 'actions failed'}`);
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'loading') await pageReady(tabId);
  }
  return tabId;
}

// The video goes on in another tab: the recorder switches its source, the stage moves along, and a tab chip
// with the page's real title says where the viewer is now.
async function videoSwitch(v, tabId, kind) {
  v.followed.add(tabId); v.visited.add(tabId);
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await videoCmd({ cmd: 'switch', streamId });
  v.tabId = tabId;
  const t = await chrome.tabs.get(tabId);
  await stage(v, { tabChip: { kind, title: t.title || '', favicon: t.favIconUrl || '', url: t.url, at: Date.now() } });
}

// { waitForTab: ms }: the previous action opened a tab or popup; the tour goes on there.
async function tourWaitForTab(fromId, since, ms, i, ctx) {
  const t = await waitForTabFrom(fromId, since, ms);
  if (!t) throw new Error(`step ${i + 1}: no new tab opened within ${ms} ms`);
  let url = '';
  for (let k = 0; k < 50 && !/^https?:/.test(url); k++) { url = (await chrome.tabs.get(t.id).catch(() => null))?.url || ''; if (!/^https?:/.test(url)) await new Promise(r => setTimeout(r, 200)); }
  const denied = await permit(url || t.pendingUrl || 'about:blank', 'continue the tour there');
  if (denied) throw new Error(`step ${i + 1}: ${denied}`);
  await pageReady(t.id);
  ctx.stack.push(fromId);
  await chrome.tabs.update(t.id, { active: true }).catch(() => {});
  if (ctx.video) {
    const win = await chrome.windows.get(t.windowId).catch(() => null);
    await videoSwitch(ctx.video, t.id, win?.type === 'popup' ? 'Popup window' : 'New tab');
  }
  return t.id;
}

// { backToTab: 'previous' | 'home', close?: true }: back to the tab before the last waitForTab, or the tour's
// first tab; close: true closes the tab it leaves.
async function tourBackToTab(fromId, a, i, ctx) {
  const target = a.backToTab === 'home' ? ctx.home : ctx.stack.pop() ?? ctx.home;
  if (a.backToTab === 'home') ctx.stack = [];
  if (!(await chrome.tabs.get(target).catch(() => null))) throw new Error(`step ${i + 1}: the tab to go back to was closed`);
  await chrome.tabs.update(target, { active: true }).catch(() => {});
  // A video switches its capture first: closing the tab it records would end the recording.
  if (ctx.video) await videoSwitch(ctx.video, target, 'Back to');
  if (a.close && fromId !== target) await chrome.tabs.remove(fromId).catch(() => {});
  return target;
}

async function pageReady(tabId, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'complete') {
      const r = await chrome.tabs.sendMessage(tabId, { cmd: 'ping' }).catch(() => null);
      if (r?.ok) return;
      if (!(await allowed(t.url))) throw new Error('the page left the allowlisted hosts: ' + t.url);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('page load timed out');
}

// Tabs the extension is navigating itself (tours, highlight with url, videos): not the user.
const ownNav = new Map(); // tabId -> until
async function navigate(tabId, url) {
  ownNav.set(tabId, Date.now() + 120000);
  try { return await navigateNow(tabId, url); } finally { ownNav.set(tabId, Date.now() + 1500); }
}

async function navigateNow(tabId, url) {
  const done = new Promise((resolve, reject) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(on); reject(new Error('page load timed out: ' + url)); }, 120000);
    const on = (id, info) => { if (id === tabId && info.status === 'complete') { clearTimeout(t); chrome.tabs.onUpdated.removeListener(on); resolve(); } };
    chrome.tabs.onUpdated.addListener(on);
  });
  await chrome.tabs.update(tabId, { url });
  await done;
  for (let i = 0; i < 50; i++) {
    const r = await chrome.tabs.sendMessage(tabId, { cmd: 'ping' }).catch(() => null);
    if (r?.ok) return;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('page is not on an allowlisted host or did not start the content script: ' + url);
}

async function tourAction(action) {
  const { tour, tourIndex = -1 } = await S.get(['tour', 'tourIndex']);
  if (video && (action.type === 'next' || action.type === 'back')) return { ok: true, local: true, busy: true };
  if (!tour || (action.type !== 'next' && action.type !== 'back')) return null;
  if (running) return { ok: true, local: true, busy: true };
  const target = tourIndex + (action.type === 'next' ? 1 : -1);
  if (target < 0) return { ok: true, local: true };
  gotoStep(target, { replay: action.type === 'back' });
  return { ok: true, local: true, delivered: true };
}

// ------------------------------------------------------------------ "Annotate": capture and paint
// The content script hides its overlay and describes every mark in document coordinates. The worker
// captures the page area around all marks (beyond the window if needed) and paints the marks itself:
// once as the user drew them, once more with a dashed, labelled outline (1a, 1b …) per page element a
// mark refers to - the same labels as the action's legend. Only the model sees that second copy.

const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';

// ------------------------------------------------------------------ network throttling
// As in DevTools: the extension stays attached to the tab as a debugger while it is throttled (the browser
// runs with --silent-debugger-extension-api, so no bar appears). Presets use DevTools' numbers.
const kbit = k => (k * 1000) / 8; // kbit/s -> bytes/s
const NETWORK = {
  'fast-4g': { label: 'Fast 4G', download: kbit(9000) * 0.9, upload: kbit(1500) * 0.9, latency: 60 * 2.75 },
  'slow-4g': { label: 'Slow 4G', download: kbit(1600) * 0.9, upload: kbit(750) * 0.9, latency: 150 * 3.75 },
  '3g': { label: '3G', download: kbit(500) * 0.8, upload: kbit(500) * 0.8, latency: 400 * 5 },
  offline: { label: 'Offline', offline: true, download: 0, upload: 0, latency: 0 },
};
const attachedTabs = new Set();
const throttles = () => S.get('throttles').then(r => r.throttles || {}); // tabId -> { network?, cpu? }
const setThrottleState = (tabId, patch) => serial(async () => {
  const t = await throttles();
  const next = { ...(t[tabId] || {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  if (Object.keys(next).length) t[tabId] = next; else delete t[tabId];
  await S.set({ throttles: t });
  return next;
});

async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  attachedTabs.add(tabId);
}
// Nothing throttled any more: let go of the tab.
async function detachIfIdle(tabId, state) {
  if (Object.keys(state).length || !attachedTabs.has(tabId)) return;
  await chrome.debugger.detach({ tabId }).catch(() => {});
  attachedTabs.delete(tabId);
}
chrome.debugger.onDetach.addListener(({ tabId }) => {
  attachedTabs.delete(tabId);
  serial(async () => { const t = await throttles(); if (t[tabId]) { delete t[tabId]; await S.set({ throttles: t }); } });
});

// spec: a preset name, "off", or { downloadKbps, uploadKbps, latencyMs, offline }.
async function setNetwork(tabId, spec) {
  if (spec == null || spec === '' || spec === 'off' || spec === false) {
    if (attachedTabs.has(tabId)) {
      await chrome.debugger.sendCommand({ tabId }, 'Network.emulateNetworkConditions',
        { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});
    }
    await detachIfIdle(tabId, await setThrottleState(tabId, { network: null }));
    return { ok: true, network: 'off' };
  }
  let n;
  if (typeof spec === 'string') {
    n = NETWORK[spec.toLowerCase()];
    if (!n) return { ok: false, error: `unknown network preset "${spec}"; use ${Object.keys(NETWORK).join(', ')} or off` };
  } else {
    const down = +spec.downloadKbps, up = +(spec.uploadKbps ?? spec.downloadKbps), lat = +(spec.latencyMs || 0);
    if (!spec.offline && !(down > 0)) return { ok: false, error: 'custom throttling needs downloadKbps (and optionally uploadKbps, latencyMs)' };
    n = { label: spec.offline ? 'Offline' : `${down} kbit/s, ${lat} ms`, offline: !!spec.offline, download: kbit(down || 0), upload: kbit(up || 0), latency: lat };
  }
  await attachDebugger(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
  await chrome.debugger.sendCommand({ tabId }, 'Network.emulateNetworkConditions',
    { offline: !!n.offline, latency: n.latency, downloadThroughput: n.download, uploadThroughput: n.upload });
  await setThrottleState(tabId, { network: n.label });
  return { ok: true, network: n.label };
}

// CPU slowdown as in DevTools ("4× slowdown"): rate 1 (or "off") is full speed, at most 20.
async function setCpu(tabId, rate) {
  const r = rate === 'off' || rate == null ? 1 : Math.round(+rate * 10) / 10;
  if (!(r >= 1 && r <= 20)) return { ok: false, error: 'cpu must be a slowdown factor from 1 (off) to 20, e.g. 4 or 6' };
  if (r === 1) {
    if (attachedTabs.has(tabId)) await chrome.debugger.sendCommand({ tabId }, 'Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
    await detachIfIdle(tabId, await setThrottleState(tabId, { cpu: null }));
    return { ok: true, cpu: 'off' };
  }
  await attachDebugger(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Emulation.setCPUThrottlingRate', { rate: r });
  await setThrottleState(tabId, { cpu: r });
  return { ok: true, cpu: `${r}× slowdown` };
}

// Network and CPU both back to normal.
async function throttleOff(tabId) {
  await setCpu(tabId, 'off');
  return { ...(await setNetwork(tabId, 'off')), cpu: 'off' };
}

async function captureArea(tab, spec) {
  const view = { x: spec.scroll.x, y: spec.scroll.y, width: spec.viewport.width, height: spec.viewport.height };
  const c = spec.clip;
  const beyond = c.x < view.x || c.y < view.y || c.x + c.width > view.x + view.width || c.y + c.height > view.y + view.height;
  const target = { tabId: tab.id };
  // A throttled tab is already attached; that attachment stays.
  const keep = attachedTabs.has(tab.id);
  try {
    if (!keep) await chrome.debugger.attach(target, '1.3');
  } catch (e) {
    // Another debugger client holds the tab: fall back to the visible window.
    const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { bitmap: await createImageBitmap(await (await fetch(url)).blob()), clip: view, captureError: String(e.message || e) };
  }
  try {
    const { data } = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', { format: 'png',
      captureBeyondViewport: beyond, clip: { ...c, scale: Math.min(1, 12000 / (c.height * spec.dpr)) } });
    return { bitmap: await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob()), clip: c };
  } finally {
    if (!keep) await chrome.debugger.detach(target).catch(() => {});
  }
}

function smoothPath(g, pts) {
  g.moveTo(...pts[0]);
  for (let i = 1; i < pts.length - 1; i++) {
    g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
  }
  g.lineTo(...pts[pts.length - 1]);
}

function arrowParts([f, t], k) {
  const dx = t[0] - f[0], dy = t[1] - f[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const L = Math.min(18 * k, len * 0.6), w = L * 0.55, bx = t[0] - ux * L, by = t[1] - uy * L;
  return { shaft: [f, [bx + ux * 2 * k, by + uy * 2 * k]], head: [t, [bx - uy * w, by + ux * w], [bx + uy * w, by - ux * w]] };
}

function wrap(g, text, maxW) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && g.measureText(next.trimEnd()).width > maxW) { lines.push(line.trimEnd()); line = word.trimStart(); }
      else line = next;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

// The same look as the overlay: halo, tinted frames, arrowhead, smoothed pen, numbered badge, note card.
function paintMarks(g, annotations, clip, k, surface = '#fff') {
  const X = x => (x - clip.x) * k, Y = y => (y - clip.y) * k, P = p => [X(p.x), Y(p.y)];
  for (const a of annotations) {
    const d = a.draw;
    if (!d || !a.rect) continue;
    g.save();
    if (d.clip) { g.beginPath(); g.rect(X(d.clip.x), Y(d.clip.y), d.clip.width * k, d.clip.height * k); g.clip(); }
    g.lineCap = g.lineJoin = 'round';
    const r = [X(a.rect.x), Y(a.rect.y), a.rect.width * k, a.rect.height * k];
    const arrow = a.kind === 'arrow' && arrowParts([P(a.from), P(a.to)], k);
    const shape = () => {
      g.beginPath();
      if (a.kind === 'rect' || a.kind === 'element') g.roundRect(...r, 10 * k);
      else if (arrow) { g.moveTo(...arrow.shaft[0]); g.lineTo(...arrow.shaft[1]); }
      else smoothPath(g, d.points.map(P));
    };
    const head = () => { g.beginPath(); g.moveTo(...arrow.head[0]); g.lineTo(...arrow.head[1]); g.lineTo(...arrow.head[2]); g.closePath(); };
    g.save();
    g.shadowColor = 'rgba(0,0,0,.28)'; g.shadowBlur = 3 * k; g.shadowOffsetY = k;
    g.strokeStyle = surface; g.fillStyle = surface; g.globalAlpha = 0.92; g.lineWidth = 7 * k;
    shape(); g.stroke();
    if (arrow) { head(); g.fill(); g.stroke(); }
    g.restore();
    if (a.kind === 'rect' || a.kind === 'element') { g.fillStyle = a.color + (a.kind === 'rect' ? '12' : '24'); shape(); g.fill(); }
    g.strokeStyle = a.color; g.lineWidth = (a.kind === 'element' ? 2.5 : 3) * k;
    shape(); g.stroke();
    if (arrow) { g.fillStyle = a.color; g.lineWidth = 2 * k; head(); g.fill(); g.stroke(); }
    g.restore();
  }
  // Note cards grow out of the badge, so the badge is painted last, on the card's number spot.
  for (const a of annotations) {
    const d = a.draw;
    if (!d?.noteBox || !a.note) continue;
    const box = d.noteBox, t = d.noteText;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.3)'; g.shadowBlur = 6 * k; g.shadowOffsetY = 2 * k;
    g.fillStyle = d.noteBg;
    g.beginPath(); g.roundRect(X(box.x), Y(box.y), box.width * k, box.height * k, d.noteRadius * k); g.fill();
    g.shadowColor = 'transparent';
    g.font = `400 ${14 * k}px ${FONT}`; g.fillStyle = d.noteFg; g.textBaseline = 'middle'; g.textAlign = 'start';
    wrap(g, a.note, (t.width + 2) * k).forEach((l, i) => g.fillText(l, X(t.x), Y(t.y) + (10 + 20 * i) * k));
    g.restore();
  }
  for (const a of annotations) {
    const d = a.draw;
    if (!d?.badge || !a.rect) continue;
    g.save();
    if (d.clip && !d.noteBox) { g.beginPath(); g.rect(X(d.clip.x), Y(d.clip.y), d.clip.width * k, d.clip.height * k); g.clip(); }
    const [bx, by] = P(d.badge);
    g.shadowColor = 'rgba(0,0,0,.28)'; g.shadowBlur = 3 * k; g.shadowOffsetY = k;
    g.fillStyle = a.color; g.strokeStyle = surface; g.lineWidth = 2 * k;
    g.beginPath(); g.arc(bx, by, 11 * k, 0, Math.PI * 2); g.fill();
    g.shadowColor = 'transparent'; g.stroke();
    g.fillStyle = d.on || '#fff'; g.font = `600 ${12 * k}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(a.n), bx, by + 0.5 * k);
    g.restore();
  }
}

function paintLabels(g, annotations, clip, k) {
  const X = x => (x - clip.x) * k, Y = y => (y - clip.y) * k;
  g.font = `600 ${11 * k}px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'start';
  for (const a of annotations) {
    for (const el of a.elements) {
      const r = el.rect;
      g.setLineDash([6 * k, 4 * k]);
      g.strokeStyle = a.color; g.lineWidth = 1.5 * k;
      g.strokeRect(X(r.x), Y(r.y), r.width * k, r.height * k);
      g.setLineDash([]);
      const w = g.measureText(el.label).width + 10 * k, h = 18 * k;
      const tx = Math.min(Math.max(0, X(r.x + r.width) - w), g.canvas.width - w);
      const ty = Math.min(Math.max(0, Y(r.y) - h - 2 * k), g.canvas.height - h);
      g.fillStyle = a.color;
      g.beginPath(); g.roundRect(tx, ty, w, h, 4 * k); g.fill();
      g.fillStyle = a.draw?.on || '#fff';
      g.fillText(el.label, tx + 5 * k, ty + h / 2);
    }
  }
}

async function toDataUrl(canvas) {
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:image/png;base64,' + btoa(bin);
}

async function renderAnnotation(tab, spec) {
  const { bitmap, clip, captureError } = await captureArea(tab, spec);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext('2d');
  const k = bitmap.width / clip.width;
  g.drawImage(bitmap, 0, 0);
  paintMarks(g, spec.annotations, clip, k, spec.surface);
  const image = await toDataUrl(canvas);
  paintLabels(g, spec.annotations, clip, k);
  const labelledImage = await toDataUrl(canvas);
  return {
    url: spec.url, viewport: spec.viewport, scroll: spec.scroll, dpr: spec.dpr,
    imageArea: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
    ...(captureError && { captureError }),
    annotations: spec.annotations.map(({ draw: _, ...a }) => a),
    image, labelledImage,
  };
}

// ------------------------------------------------------------------ video recording
// record_tour plays a scripted tour on one pinned tab while the offscreen page records that tab.
// The window is sized so the viewport maps 1:1 onto the output; page loads are cut by pausing.

let videoPort = null, videoRid = 0, portWaiter = null;
const videoReplies = new Map();

function onVideoPort(port) {
  videoPort = port;
  portWaiter?.();
  port.onMessage.addListener(m => {
    if (m.rid) return videoReplies.get(m.rid)?.(m);
    if (m.type === 'error' && video) { video.failure ||= m.error; video.abort = true; }
  });
  port.onDisconnect.addListener(() => {
    if (videoPort === port) videoPort = null;
    if (video && !video.finishing) { video.failure ||= 'the video recorder page closed'; video.abort = true; }
  });
}

function videoCmd(m, ms = 15000) {
  return new Promise((resolve, reject) => {
    if (!videoPort) return reject(new Error('the video recorder is not running'));
    const rid = ++videoRid;
    const t = setTimeout(() => { videoReplies.delete(rid); reject(new Error('the video recorder did not answer: ' + m.cmd)); }, ms);
    videoReplies.set(rid, r => { clearTimeout(t); videoReplies.delete(rid); r.ok === false ? reject(new Error(r.error)) : resolve(r); });
    videoPort.postMessage({ ...m, rid });
  });
}

async function openRecorder() {
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument().catch(() => {});
  videoPort = null;
  const connected = new Promise((resolve, reject) => {
    portWaiter = resolve;
    setTimeout(() => reject(new Error('the video recorder page did not start')), 10000);
  });
  await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'],
    justification: 'Records the demo tour tab to a video file' });
  await connected;
  portWaiter = null;
}

const metrics = tabId => chrome.tabs.sendMessage(tabId, { cmd: 'metrics' });
const even = n => Math.max(2, Math.round(n / 2) * 2);

// Resizes the window so the tab's viewport has the chosen size in device-independent pixels.
async function stageWindow(tab, size) {
  const win = await chrome.windows.get(tab.windowId);
  const restore = { id: win.id, state: win.state, left: win.left, top: win.top, width: win.width, height: win.height };
  const zoom = await chrome.tabs.getZoom(tab.id);
  let m = await metrics(tab.id);
  const scale = m.dpr / zoom;
  const vw = () => m.iw * zoom, vh = () => m.ih * zoom;
  const dx = win.width - vw(), dy = win.height - vh();
  const pick = pickSize(size, scale, { width: m.aw - dx, height: m.ah - dy });
  const target = pick.viewport;
  if (win.state !== 'normal') await chrome.windows.update(win.id, { state: 'normal' });
  let bounds = { left: m.ax, top: m.ay, width: Math.round(target.width + dx), height: Math.round(target.height + dy) };
  for (let i = 0; i < 4; i++) {
    await chrome.windows.update(win.id, bounds);
    await new Promise(r => setTimeout(r, 300));
    m = await metrics(tab.id);
    const ex = target.width - vw(), ey = target.height - vh();
    if (Math.abs(ex) < 1 && Math.abs(ey) < 1) break;
    bounds = { ...bounds, width: Math.round(bounds.width + ex), height: Math.round(bounds.height + ey) };
  }
  // Whatever the window ended up as, the output keeps the viewport's shape so nothing is letterboxed.
  const exact = Math.abs(target.width - vw()) < 1 && Math.abs(target.height - vh()) < 1 && !pick.scaled;
  const width = exact ? pick.width : even(vw() * scale), height = exact ? pick.height : even(vh() * scale);
  return { restore, width, height, viewport: { width: Math.round(vw()), height: Math.round(vh()) }, scale, exact };
}

// The window keeps its recording size until the video is done: a resize, maximize or minimize during the
// recording is undone at once (Chrome has no way to forbid it). The panel says the size is locked.
chrome.windows.onBoundsChanged.addListener(async w => {
  const v = video;
  if (!v?.locked || w.id !== v.locked.id || v.finishing) return;
  const b = v.locked, now = await chrome.windows.get(w.id).catch(() => null);
  if (!now || (now.state === 'normal' && now.left === b.left && now.top === b.top && now.width === b.width && now.height === b.height)) return;
  if (now.state !== 'normal') await chrome.windows.update(w.id, { state: 'normal' }).catch(() => {});
  await chrome.windows.update(w.id, { left: b.left, top: b.top, width: b.width, height: b.height }).catch(() => {});
  v.snaps = (v.snaps || 0) + 1;
  await S.set({ videoSnaps: v.snaps });
});

async function restoreWindow(r) {
  if (!r) return;
  if (r.state === 'normal') await chrome.windows.update(r.id, { left: r.left, top: r.top, width: r.width, height: r.height }).catch(() => {});
  else await chrome.windows.update(r.id, { state: r.state }).catch(() => {});
}

async function recordTour(m, tab) {
  if (video) return { ok: false, error: 'a video is already being recorded' };
  const tour = validTour(m.tour);
  const agentStep = tour.steps.findIndex(s => s.agent);
  if (agentStep >= 0) return { ok: false, error: `step ${agentStep + 1} is an agent step; videos need fully scripted tours` };
  const opts = { name: m.name || tour.title || '', size: m.size || 'auto', pace: Math.min(3, Math.max(0.3, +m.pace || 1)),
    captions: m.captions !== false, cards: m.cards !== false, hidpi: m.hidpi !== false, out: m.out || '' };
  tab ||= await activeTab();
  if (!tab) return { ok: false, error: 'no active tab' };
  // The first page has to be loaded to measure the viewport; this load is not recorded.
  const first = tour.steps.find(s => s.url)?.url;
  if (!(await allowed(tab.url))) {
    if (!first) return { ok: false, error: `the active tab is not on an allowlisted host: ${tab.url}` };
    await navigate(tab.id, first);
  }
  await S.set({ tour: null, tourIndex: -1, explanation: '', step: '', tourSession: '', tourTab: null });
  await clearSessionHighlights(m.session || '');
  // `zoom` (0.25–2) zooms the page for the recording, e.g. 0.8 on a 125 % screen shows the page at its
  // 1:1 desktop layout. Chrome keeps zoom per site, so the previous level is restored afterwards.
  const zoom = m.zoom ? Math.min(2, Math.max(0.25, +m.zoom)) : 0;
  const zoomBefore = zoom ? await chrome.tabs.getZoom(tab.id) : 0;
  if (zoom) { await chrome.tabs.setZoom(tab.id, zoom); await new Promise(r => setTimeout(r, 300)); }
  let staged = await stageWindow(tab, opts.size);
  // Leaving the maximized state can still be in progress and swallow the resize; try once more.
  if (!staged.exact) {
    await new Promise(r => setTimeout(r, 1000));
    staged = { ...(await stageWindow(tab, opts.size)), restore: staged.restore };
  }
  video = { tabId: tab.id, session: m.session || '', tour, opts, ...staged, zoomBefore, step: -1, abort: false, discard: false, failure: '', finishing: false,
    loading: false, onCamera: false, stage: {} };
  const w = await chrome.windows.get(tab.windowId);
  video.locked = { id: w.id, left: w.left, top: w.top, width: w.width, height: w.height };
  await S.set({ video: { state: 'starting', steps: tour.steps.length, step: -1, width: staged.width, height: staged.height } });
  runVideo(video);
  const z = zoom || 1;
  return { ok: true, width: staged.width, height: staged.height, exact: staged.exact,
    viewport: { width: Math.round(staged.viewport.width / z), height: Math.round(staged.viewport.height / z) },
    estimatedMs: estimateMs(tour, { ...opts, intro: opts.cards }) };
}

async function recordStop(m) {
  if (!video) return { ok: false, error: 'no video is being recorded' };
  video.abort = true;
  video.discard = !!m.discard;
  return { ok: true, stopping: true };
}

async function dwell(v, ms) {
  const end = Date.now() + ms;
  while (!v.abort && Date.now() < end) await new Promise(r => setTimeout(r, Math.min(200, end - Date.now())));
}

const panelVideo = (v, state, extra = {}) =>
  S.set({ video: { state, steps: v.tour.steps.length, step: v.step, width: v.width, height: v.height, ...extra } });

// The stage script draws captions, chapter label, progress bar and cards; it is injected again after
// every page load and always gets the whole state.
async function stage(v, patch) {
  Object.assign(v.stage, patch);
  await chrome.scripting.executeScript({ target: { tabId: v.tabId }, files: ['stage.js'] }).catch(() => {});
  await chrome.tabs.sendMessage(v.tabId, { cmd: 'stage', state: v.stage }).catch(() => {});
}

// A page started loading in the recorded tab: cut the load out of the video.
chrome.webNavigation.onBeforeNavigate.addListener(d => {
  const v = video;
  if (!v || d.tabId !== v.tabId || d.frameId !== 0 || v.finishing) return;
  v.loading = true;
  videoCmd({ cmd: 'pause' }).catch(() => {});
});

// After a page load: wait for the new page, redraw the stage, resume recording if the step is on camera.
async function settle(v) {
  const t = await chrome.tabs.get(v.tabId);
  if (!v.loading && t.status !== 'loading') return;
  await pageReady(v.tabId);
  v.loading = false;
  await stage(v, {});
  if (v.onCamera) await videoCmd({ cmd: 'resume' });
}

const now = async () => (await videoCmd({ cmd: 'now' })).t;
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

async function logoData(file) {
  if (!file) return '';
  if (/^(data|https?):/.test(file)) return file;
  try {
    const blob = await (await fetch(chrome.runtime.getURL(file))).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
  } catch { return ''; }
}

async function runVideo(v) {
  const { tour, opts } = v, steps = tour.steps, pace = opts.pace;
  // The video can move to tabs and popups a step opens (waitForTab) and back (backToTab).
  const vctx = { home: v.tabId, stack: [], video: v };
  v.opened = new Set(); v.followed = new Set(); v.visited = new Set([v.tabId]);
  const chapters = [], cues = [];
  const shown = steps.filter(s => s.video !== false);
  const sections = [...new Set(shown.map(s => s.section).filter(Boolean))];
  const title = tour.title || opts.name || steps[0].title;
  let mimeType = '', section = null, n = 0;
  const caption = async (text, ms) => {
    const t0 = await now();
    if (opts.captions) await stage(v, { caption: text });
    await dwell(v, ms);
    cues.push({ start: t0, end: await now(), text });
  };
  try {
    const { branding = {} } = await loadConfig();
    v.stage = { branding: { ...branding, logoData: await logoData(branding.logo) }, shield: true, footer: null, lower: null, caption: null,
      card: opts.cards ? { kind: 'intro', title, subtitle: tour.subtitle || [today(), branding.name].filter(Boolean).join(' · ') } : null };
    // The first page is already loaded; go there now so the intro card covers it, not a page load.
    if (steps[0].url && (await chrome.tabs.get(v.tabId)).url !== steps[0].url) await navigate(v.tabId, steps[0].url);
    await stage(v, {});
    for (let c = 3; c > 0 && !v.abort; c--) { await panelVideo(v, 'countdown', { count: c }); await dwell(v, 1000); }
    if (v.abort) throw Object.assign(new Error('cancelled'), { quiet: true });
    await openRecorder();
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: v.tabId });
    // Chrome renders a captured tab at a higher pixel density when the capture is larger than the tab, so
    // the video gets real detail beyond the window's pixels (up to 1080 lines, at most twice the window).
    const k = opts.hidpi === false ? 1 : Math.min(2, Math.max(1, 1080 / v.height));
    v.width = even(v.width * k); v.height = even(v.height * k);
    const info = await videoCmd({ cmd: 'start', streamId, width: v.width, height: v.height, fps: 30,
      bitrate: bitrate(v.width, v.height), name: opts.name || title });
    mimeType = info.mimeType;
    v.onCamera = true;
    if (opts.cards) await dwell(v, 2500 * pace);
    for (let i = 0; i < steps.length && !v.abort; i++) {
      const s = steps[i];
      v.step = i;
      await panelVideo(v, 'recording');
      await S.set({ step: `${i + 1}/${steps.length} – ${s.title}`, explanation: s.explanation || '' });
      await clearSessionHighlights(v.session);
      v.onCamera = s.video !== false;
      if (!v.onCamera) await videoCmd({ cmd: 'pause' });
      // A new section swaps the card in place (intro → section), so no page flashes between two cards;
      // the card also covers the navigation to the step's page.
      const newSection = v.onCamera && opts.cards && s.section && s.section !== section;
      if (newSection) {
        section = s.section;
        await chrome.tabs.sendMessage(v.tabId, { cmd: 'pointerHide' }).catch(() => {});
        await clearSessionHighlights(v.session);
        await stage(v, { caption: null, lower: null,
          card: { kind: 'section', title: s.section, kicker: `Section ${sections.indexOf(s.section) + 1} of ${sections.length}` } });
      } else await stage(v, { card: !v.onCamera || v.stage.card?.kind === 'intro' ? v.stage.card : null, caption: null, lower: null });
      if (s.network !== undefined || s.cpu !== undefined) {
        for (const r of [s.network !== undefined && await setNetwork(v.tabId, s.network), s.cpu !== undefined && await setCpu(v.tabId, s.cpu)]) {
          if (r && !r.ok) throw new Error(`step ${i + 1}: ${r.error}`);
        }
        v.throttled = true;
      }
      if (s.url && i > 0) await navigate(v.tabId, s.url);
      await settle(v);
      // After off-camera steps the recording resumes only now, with this step's card already in place.
      if (v.onCamera && v.held) { v.held = false; await videoCmd({ cmd: 'resume' }); }
      if (newSection) await dwell(v, 1600 * pace);
      const t = v.onCamera ? await now() : 0;
      if (v.onCamera) {
        n++;
        chapters.push({ t, title: s.title });
        const timing = stepTiming(s, opts);
        v.timing = timing;
        await stage(v, { card: null, footer: { index: n - 1, count: shown.length },
          lower: { n, of: shown.length, title: s.title },
          caption: opts.captions ? timing.pages[0] || null : null });
      }
      if (s.actions?.length) {
        await run(v.tabId, s.actions, i, v.onCamera, vctx);
        await settle(v);
        // A tab the step opened but did not follow (waitForTab) would happen off camera.
        const stray = [...v.opened].filter(id => !v.followed.has(id));
        if (stray.length) throw new Error(`step ${i + 1} opened a new tab or popup window; follow it with { waitForTab: ms } after the action that opens it `
          + `(the video moves there and shows the tab), or open the page with the step's url`);
      }
      const tab = await chrome.tabs.get(v.tabId);
      for (const [k, h] of (s.highlights || []).entries()) {
        await run(v.tabId, [{ waitFor: h.selector, text: h.text, after: 0 }], i);
        const r = await highlight({ item: { id: h.id || 'h' + k, ...h }, keep: k > 0, tab, session: v.session });
        if (!r.ok) throw new Error(`step ${i + 1} highlight: ${r.error}`);
        if (r.found === false) throw new Error(`step ${i + 1} highlight not found: ${h.selector}`);
      }
      if (!v.onCamera) {
        // Stay paused until the next on-camera step has set its card or captions; resuming here would
        // record the bare page for a moment. The pointer used off camera goes away too.
        await chrome.tabs.sendMessage(v.tabId, { cmd: 'pointerHide' }).catch(() => {});
        await clearSessionHighlights(v.session);
        v.held = true;
        continue;
      }
      // Captions: the first page has been up since the step began; the rest follow at reading pace.
      const { pages, times, total } = v.timing;
      const spent = (await now()) - t;
      if (!pages.length) { await dwell(v, Math.max(800, total - spent)); continue; }
      cues.push({ start: t, end: t, text: pages[0] });
      const first = cues[cues.length - 1];
      // While actions run the viewer watches the pointer, so only half of that time counts as reading.
      await dwell(v, Math.max(1500 * pace, times[0] - spent / 2));
      first.end = await now();
      for (let k = 1; k < pages.length && !v.abort; k++) await caption(pages[k], times[k]);
    }
    if (!v.abort && opts.cards) {
      const fmt = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
      await chrome.tabs.sendMessage(v.tabId, { cmd: 'pointerHide' }).catch(() => {});
      await clearSessionHighlights(v.session);
      await stage(v, { caption: null, lower: null, card: { kind: 'outro', title, chapters: chapters.map(c => ({ time: fmt(c.t), title: c.title })) } });
      if (v.held) { v.held = false; await videoCmd({ cmd: 'resume' }); }
      await dwell(v, Math.max(3000, 500 * chapters.length) * pace);
    }
  } catch (e) {
    if (!e.quiet) v.failure ||= String(e?.message || e);
    else v.discard = true;
  }
  v.finishing = true;
  await panelVideo(v, 'finishing');
  const partial = v.abort && !v.failure;
  try {
    if (v.failure || v.discard) {
      if (videoPort) await videoCmd({ cmd: 'stop', discard: true }, 30000).catch(() => {});
      await enqueue(v.failure ? { type: 'videoError', step: v.step, error: v.failure } : { type: 'videoDiscarded', step: v.step }, v.session);
    } else {
      // The bridge queues videoReady itself once the file is complete.
      await videoCmd({ cmd: 'stop', meta: { to: v.session, title, chapters, cues: opts.captions ? cues : [],
        steps: steps.map(s => s.title), width: v.width, height: v.height, mimeType, out: opts.out,
        ...(partial && { partial: true }) } }, 120000);
    }
  } catch (e) {
    await enqueue({ type: 'videoError', step: v.step, error: 'finishing the video failed: ' + (e?.message || e) }, v.session);
  } finally {
    await chrome.offscreen.closeDocument().catch(() => {});
    for (const id of v.visited || [v.tabId]) await chrome.tabs.sendMessage(id, { cmd: 'stage', end: true }).catch(() => {});
    await chrome.tabs.sendMessage(v.tabId, { cmd: 'pointerHide' }).catch(() => {});
    await S.set({ pointerAt: null });
    v.locked = null;
    await restoreWindow(v.restore);
    if (v.zoomBefore) await chrome.tabs.setZoom(v.tabId, v.zoomBefore).catch(() => {});
    if (v.throttled) await throttleOff(v.tabId).catch(() => {});
    video = null;
    await clearSessionHighlights(v.session);
    await S.set({ video: null, step: '', explanation: '' });
  }
}

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, windowType: 'normal' });
  if (t) return t;
  const [any] = await chrome.tabs.query({ active: true, windowType: 'normal' });
  return any;
}

// ------------------------------------------------------------------ panel / content -> worker

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  handle(m, sender).then(reply, e => reply({ error: String(e?.message || e) }));
  return true;
});

async function handle(m, sender) {
  switch (m.type) {
    case 'videoStop': return video ? recordStop(m) : { ok: false };
    case 'userEvent': if (sender.tab) await userEvent(sender.tab.id, m.event); return {};
    case 'annotateKey': {
      const t = await activeTab();
      return t ? chrome.tabs.sendMessage(t.id, { cmd: 'annotateKey', key: m.key, ctrl: !!m.ctrl }).catch(() => ({ ok: false })) : { ok: false };
    }
    // The panel's "Turn off" for the tab in front; the user can always end throttling.
    case 'throttleOff': { const t = await activeTab(); return t ? throttleOff(t.id) : { ok: false }; }
    // Only the panel answers: the user's click, never a bridge command.
    case 'hostDecision': {
      const q = hostAsks.get(String(m.host));
      if (!q || !['session', 'always', 'no'].includes(m.decision)) return { ok: false };
      q.resolve(m.decision);
      return { ok: true };
    }
    case 'hostAllow': {
      const host = hostOf(m.url || '');
      if (!host || !['session', 'always'].includes(m.mode)) return { ok: false };
      if (m.mode === 'always' && ws?.readyState !== WebSocket.OPEN) return { error: 'The bridge is offline, so "Always" cannot be saved now.' };
      await grantHost(host, m.mode);
      return { ok: true, host };
    }
    case 'annotate': case 'recStart':
      if (video) return { error: 'A video is being recorded.' };
      return m.type === 'recStart' ? startRecording() : handleAnnotate();
    case 'hello': return { allowed: await allowed(sender.tab?.url || m.url), tabId: sender.tab?.id ?? null };
    // Messages and Next/Back go to the session whose tab is in front.
    case 'action': {
      const front = await activeTab();
      const { tourIndex = -1, tour, tourTab, tourHome, tourSession = '' } = await S.get(['tourIndex', 'tour', 'tourTab', 'tourHome', 'tourSession']);
      // While the tour works in a popup window, the panel stays with the tour's first tab.
      const onTour = tour && (tourTab == null || tourTab === front?.id || tourHome === front?.id);
      if (onTour) { const local = await tourAction(m.action); if (local) return local; }
      const to = onTour ? tourSession : front ? await sessionOfTab(front.id) : '';
      return enqueue(onTour ? { ...m.action, step: tourIndex } : m.action, to);
    }
    case 'recStep': {
      if (!sender.tab) return {};
      await serial(async () => {
        const { recording } = await S.get('recording');
        if (!recording || !recTabs(recording).includes(sender.tab.id)) return;
        recPush(recording, sender.tab.id, m.step);
        await S.set({ recording });
      });
      return {};
    }
    // Stopping parks the recording as a draft; the panel sends it with the user's question.
    case 'recStop': {
      const { recording, demoRequest } = await S.get(['recording', 'demoRequest']);
      if (!recording || m.discard) {
        await S.set({ recording: null, demoRequest: null });
        if (demoRequest) await enqueue({ type: 'demoDeclined', requestId: demoRequest.id, prompt: demoRequest.prompt }, demoRequest.session);
        return { ok: true, discarded: true };
      }
      // Across tabs, every step says which tab (1 = where it started; newTab/switchTab/closeTab mark changes).
      const multi = recTabs(recording).length > 1;
      const steps = multi ? recording.steps.map(s => ('tab' in s ? s : { ...s, tab: 1 })) : recording.steps;
      await S.set({ recording: null, recordingDraft: { title: 'show-and-tell recording', startedAt: recording.startedAt,
        duration: Date.now() - recording.startedAt, steps, ...(multi && { tabs: recTabs(recording).length }), tabId: recording.tabId } });
      return { ok: true };
    }
    // Recordings and marks go to the session that asked for them, else to the one owning their tab.
    case 'recSend': {
      const { recordingDraft, demoRequest, tourIndex = -1, tour, tourTab } = await S.get(['recordingDraft', 'demoRequest', 'tourIndex', 'tour', 'tourTab']);
      if (!recordingDraft) return { error: 'There is no recording.' };
      await S.set({ recordingDraft: null, demoRequest: null });
      const { tabId, ...rec } = recordingDraft;
      const to = demoRequest?.session || await sessionOfTab(tabId);
      return enqueue({ type: 'recording', text: m.text || '', url: m.url,
        ...(demoRequest && { requestId: demoRequest.id, prompt: demoRequest.prompt }),
        ...(tour && tourTab === tabId && { step: tourIndex }), recording: rec }, to);
    }
    case 'recDrop': {
      const { demoRequest } = await S.get('demoRequest');
      await S.set({ recordingDraft: null, demoRequest: null });
      if (demoRequest) await enqueue({ type: 'demoDeclined', requestId: demoRequest.id, prompt: demoRequest.prompt }, demoRequest.session);
      return { ok: true };
    }
    case 'annotationSend': {
      const { annotationDraft, tourIndex = -1, tour, tourTab } = await S.get(['annotationDraft', 'tourIndex', 'tour', 'tourTab']);
      if (!annotationDraft) return { error: 'There is no annotation.' };
      await S.set({ annotationDraft: null });
      const { tabId, ...draft } = annotationDraft;
      return enqueue({ type: 'annotation', text: m.text || '', ...(tour && tourTab === tabId && { step: tourIndex }), ...draft },
        await sessionOfTab(tabId));
    }
    case 'annotationDrop':
      await S.set({ annotationDraft: null });
      return { ok: true };
    default: return { error: 'unknown message' };
  }
}

async function handleAnnotate() {
  const tab = await activeTab();
  if (!tab || !(await allowed(tab.url))) return { error: 'This page is not on the allowlist.' };
  const result = await chrome.tabs.sendMessage(tab.id, { cmd: 'annotate' });
  if (!result) return { cancelled: true };
  try {
    const annotationDraft = { ...(await renderAnnotation(tab, result)), tabId: tab.id };
    await S.set({ annotationDraft });
    return { ok: true, count: result.annotations.length };
  } finally {
    chrome.tabs.sendMessage(tab.id, { cmd: 'annotateClear' }).catch(() => {});
  }
}

async function startRecording(tab) {
  tab ||= await activeTab();
  if (!tab || !(await allowed(tab.url))) return { error: 'This page is not on the allowlist.' };
  await S.set({ recording: { startedAt: Date.now(), tabId: tab.id, steps: [
    { type: 'setViewport', width: tab.width, height: tab.height },
    { type: 'navigate', url: tab.url, ts: Date.now() },
  ] } });
  return { ok: true };
}

// ------------------------------------------------------------------ recording across tabs
// A recording follows tabs and popup windows opened from a recorded tab (same group, or opened by it), so a
// flow through a popup arrives whole. Tabs are numbered 1, 2, … in the order they joined; markers say when
// one opened (newTab), when the user went on in another (switchTab) and when one closed (closeTab).
const recTabs = r => r.tabs || [r.tabId];
const recNo = (r, id) => recTabs(r).indexOf(id) + 1;
function recPush(r, tabId, step, { quiet = false } = {}) {
  const n = recNo(r, tabId), multi = recTabs(r).length > 1;
  if (multi && !quiet && n !== (r.lastTab || 1)) r.steps.push({ type: 'switchTab', tab: n, ts: Date.now() });
  if (!quiet) r.lastTab = n;
  r.steps.push(multi ? { ...step, tab: n } : step);
}
async function recordingSawTab(tab) {
  if (!tab?.id) return;
  await serial(async () => {
    const { recording: r } = await S.get('recording');
    if (!r || recTabs(r).includes(tab.id)) return;
    let opener = recTabs(r).includes(tab.openerTabId) ? tab.openerTabId : null;
    if (!opener && tab.groupId >= 0) {
      for (const id of recTabs(r)) if ((await chrome.tabs.get(id).catch(() => null))?.groupId === tab.groupId) { opener = id; break; }
    }
    if (!opener) return;
    const win = await chrome.windows.get(tab.windowId).catch(() => null);
    r.tabs = [...recTabs(r), tab.id];
    r.steps.push({ type: 'newTab', tab: r.tabs.length, openedBy: recNo(r, opener), url: tab.pendingUrl || tab.url || '',
      ...(win?.type === 'popup' && { popup: true }), ts: Date.now() });
    await S.set({ recording: r });
  });
}
chrome.tabs.onCreated.addListener(tab => { recordingSawTab(tab); });
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (info.groupId >= 0) recordingSawTab(tab); });
chrome.tabs.onRemoved.addListener(tabId => serial(async () => {
  const { recording: r } = await S.get('recording');
  if (!r || !recTabs(r).includes(tabId) || recTabs(r).length < 2) return;
  r.steps.push({ type: 'closeTab', tab: recNo(r, tabId), ts: Date.now() });
  await S.set({ recording: r });
}));

// URL changes in the recorded tab: a full page load (`navigate`, a replay loads it) or an SPA route
// change (`urlChange`, a replay gets there by repeating the click before it).
function recordUrl(type, { tabId, frameId, url }) {
  if (frameId !== 0) return;
  serial(async () => {
    const { recording } = await S.get('recording');
    if (!recording || !recTabs(recording).includes(tabId)) return;
    const n = recNo(recording, tabId);
    const last = recording.steps.findLast(s => (s.tab || 1) === n || recTabs(recording).length === 1);
    if (type === 'navigate' && last?.type === 'navigate' && last.url === url) return;
    // A new tab's first address goes into its newTab marker.
    const opened = recording.steps.find(s => s.type === 'newTab' && s.tab === n);
    if (opened && (!opened.url || opened.url === 'about:blank')) opened.url = url;
    recPush(recording, tabId, { type, url, ts: Date.now() }, { quiet: true });
    await S.set({ recording });
  });
}
chrome.webNavigation.onCommitted.addListener(d => recordUrl('navigate', d));
chrome.webNavigation.onHistoryStateUpdated.addListener(d => recordUrl('urlChange', d));

// ------------------------------------------------------------------ the user's input in agent tabs
// Reported to the bridge per session; the bridge drops what falls into the agent's own calls. Nothing is
// reported while a video runs (the stage blocks input) or while the user records that tab on purpose.
async function userEvent(tabId, event) {
  if (video?.tabId === tabId) return;
  const { recording } = await S.get('recording');
  if (recording && recTabs(recording).includes(tabId)) return;
  // A tab no session owns is nobody's business; guessing a session would tell the wrong agent.
  const session = await sessionOfTab(tabId);
  if (session) send({ type: 'userEvent', session, event });
}
const userNav = (kind, { tabId, frameId, url, transitionType }) => {
  if (frameId !== 0 || (ownNav.get(tabId) || 0) > Date.now() || !/^https?:/.test(url)) return;
  if (kind === 'navigate' && (freshTabs.get(tabId) || 0) > Date.now()) return;
  if (transitionType === 'auto_subframe') return;
  userEvent(tabId, { kind, url, ts: Date.now(), ...(transitionType && { how: transitionType }) });
};
chrome.webNavigation.onCommitted.addListener(d => userNav('navigate', d));
chrome.webNavigation.onHistoryStateUpdated.addListener(d => userNav('urlChange', d));
// ------------------------------------------------------------------ the test page
// The bridge serves it (scripts/lab.mjs) and the browser opens it on start. While no bridge runs, its tab
// shows a notice that switches to the page once a bridge is up, instead of Chrome's error page. Sessions
// never take the lab tab over as their own; they open a tab of their own next to it.
const LAB_DEFAULT = 'http://localhost:47614/';
const labUrl = async () => (await S.get('labUrl')).labUrl || LAB_DEFAULT;
async function isLab(url) { try { return new URL(url).origin === new URL(await labUrl()).origin; } catch { return false; } }
chrome.webNavigation.onErrorOccurred.addListener(async d => {
  if (d.frameId !== 0 || /ERR_ABORTED/.test(d.error) || !(await isLab(d.url))) return;
  await chrome.tabs.update(d.tabId, { url: chrome.runtime.getURL('lab-offline.html') + '?u=' + encodeURIComponent(d.url) }).catch(() => {});
});

// Jumps within the page (#anchors, a table of contents) change only the fragment.
chrome.webNavigation.onReferenceFragmentUpdated.addListener(d => userNav('urlChange', d));

chrome.runtime.onConnect.addListener(port => {
  if (port.name === 'video') return onVideoPort(port);
  if (port.name !== 'panel') return;
  panels.add(port);
  connect();
  send({ type: 'panel', open: true });
  port.onDisconnect.addListener(() => { panels.delete(port); send({ type: 'panel', open: panels.size > 0 }); });
});

connect();
