import { loadConfig, hostAllowed } from './allow.js';
import { markdown } from './markdown.js';

const $ = id => document.getElementById(id);
const S = chrome.storage.session;
let tabUrl = '', toastTimer = 0, tabAllowed = false;
const steps = n => { n = Math.max(0, n); return `${n} step${n === 1 ? '' : 's'}`; };

// The open port tells the worker (and through it the agent) that the panel is visible.
(function connectPort() {
  chrome.runtime.connect({ name: 'panel' }).onDisconnect.addListener(() => setTimeout(connectPort, 1000));
})();

// Without a tour, step label or video the panel is just the channel to the agent: Annotate, Record, message.
// Chrome's tab group colours, for the dot next to a session's name.
const GROUP = { grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#188038', pink: '#d01884',
  purple: '#a142f4', cyan: '#007b83', orange: '#fa903e' };

// The session whose tab is in front, if any: the panel shows it and sends to it.
let frontTabId = null;
async function frontSession() {
  const { sessionTabs = {}, sessions = [] } = await S.get(['sessionTabs', 'sessions']);
  const id = Object.keys(sessionTabs).find(k => sessionTabs[k].tabId === frontTabId);
  if (!id) return null;
  const live = sessions.find(x => x.id === id);
  return { id, name: live?.name || sessionTabs[id].name, color: sessionTabs[id].color, listening: !!live?.listening, live: !!live };
}

async function render() {
  const s = await S.get(['step', 'steps', 'waiting', 'listener', 'connected', 'outbox', 'tour', 'tourIndex', 'tourRunning',
    'tourTab', 'explanation', 'video']);
  const pending = (s.outbox || []).length;
  $('conn-text').textContent = (s.connected ? 'Connected' : 'Offline') + (pending ? ` · ${pending} pending` : '');
  $('conn').classList.toggle('ok', !!s.connected);
  const me = await frontSession();
  const who = me?.name || s.listener || 'the agent';
  const listening = me ? me.listening : s.waiting;
  $('who-name').textContent = me?.name || s.listener || 'show-and-tell';
  $('listen-text').textContent = !s.connected ? 'Bridge offline · messages are kept'
    : me && !me.live ? 'Session ended · messages go to the latest agent'
      : listening ? 'Listening' : me || s.listener ? 'Not listening · messages wait for it' : 'No agent listening · messages are kept';
  $('listen').classList.toggle('on', !!(s.connected && listening));
  for (const e of [$('listen'), $('avatar')]) e.style.setProperty('--session', me ? GROUP[me.color] || '' : '');
  $('q').placeholder = `Message ${me?.name || s.listener || 'the agent'}`;
  const onTour = !!s.tour && (s.tourTab == null || s.tourTab === frontTabId);
  const label = s.video || onTour ? s.step : (s.steps || {})[me?.id || ''] || '';
  $('tour').hidden = !(onTour || label || s.video);
  $('step').textContent = label || '—';
  $('step').hidden = !!s.video && !label;
  if (s.video) $('annotate').disabled = $('rec').disabled = true; else renderRecording();
  $('explanation').textContent = s.explanation || '';
  $('explanation').hidden = !s.explanation;
  const v = s.video;
  $('nav').hidden = !!v;
  $('video-nav').hidden = !v;
  $('countdown').hidden = v?.state !== 'countdown';
  $('card').classList.toggle('rec', v?.state === 'recording');
  if (v) {
    $('step-kicker').textContent = 'Video recording';
    $('countdown').textContent = v.state === 'countdown' ? String(v.count) : '';
    $('busy').toggleAttribute('data-on', v.state === 'starting' || v.state === 'finishing');
    $('status').textContent = { countdown: 'Recording starts. Keep your hands off the page.', starting: 'Preparing the recording…',
      finishing: 'Saving the video…' }[v.state] || `● Recording ${v.width}×${v.height} · step ${v.step + 1} of ${v.steps}`;
    $('video-stop').disabled = $('video-discard').disabled = v.state === 'finishing';
    return;
  }
  $('step-kicker').textContent = 'Current step';
  if (onTour) {
    // A scripted tour runs here; the agent is only needed for questions.
    $('back').disabled = !!s.tourRunning || (s.tourIndex ?? 0) <= 0;
    $('next').disabled = !!s.tourRunning;
    $('busy').toggleAttribute('data-on', !!s.tourRunning);
    $('status').textContent = s.tourRunning ? 'Preparing the step…' : '';
    return;
  }
  $('back').disabled = $('next').disabled = false;
  $('status').textContent = listening ? `${who} is waiting for you.` : `${who} is working…`;
  $('busy').toggleAttribute('data-on', !!(s.connected && !listening));
}

async function refreshTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl = t?.url || '';
  if (frontTabId !== (t?.id ?? null)) { frontTabId = t?.id ?? null; render(); renderChat(true); renderThrottle(); }
  const placeholder = tabUrl.startsWith(chrome.runtime.getURL('tab.html'));
  const { hostState: hs = {}, connected } = await S.get(['hostState', 'connected']);
  const ok = hostAllowed(tabUrl, [...(await loadConfig()).allowlist, ...(hs.allow || []), ...(hs.loopback || []), ...(hs.granted || [])]);
  let host = '', web = false;
  try { const u = new URL(tabUrl); host = u.hostname; web = /^https?:$/.test(u.protocol); } catch {}
  $('notice').hidden = ok || placeholder;
  $('notice-text').textContent = web
    ? `${host} is not allowed, so the agent can't point, mark or record here.`
    : 'This page is not a website, so the agent can\'t point, mark or record here.';
  $('notice-actions').hidden = !web;
  $('allow-always').disabled = !connected;
  tabAllowed = ok;
  renderRecording();
}

// The conversation with the session in front: what the user sent and what the agent did in the browser.
// The agent's own replies stay in the agent chat; here the agent speaks through its actions and questions.
const clock = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const spark = () => { const s = el('span', 'spark'); s.innerHTML = '<svg><use href="#spark"/></svg>'; return s; };
const ICON = { Annotation: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/>', Recording: '<circle cx="12" cy="12" r="6"/>' };

function userMsg(m) {
  // Attachments sit above the bubble as their own cards, right-aligned; the bubble holds only the text.
  const row = el('div', 'msg user');
  if (m.att?.length) {
    const atts = el('div', 'atts');
    for (const a of m.att) {
      const chip = el('span', 'att md-typescale-label-large');
      chip.innerHTML = `<svg viewBox="0 0 24 24">${ICON[a.split(' ')[0]] || ''}</svg>`;
      chip.append(a);
      atts.append(chip);
    }
    row.append(atts);
  }
  if (m.text) row.append(el('div', 'bubble md-typescale-body-large', m.text));
  row.append(el('div', 'meta md-typescale-label-small', `${m.acked ? 'Sent' : 'Not sent yet · bridge offline'} · ${clock(m.ts)}`));
  return row;
}

function agentMsg(m) {
  const row = el('div', 'msg agent'), body = el('div', 'agent-body');
  if (m.kind === 'activity') {
    if (Date.now() - m.ts < 5000) row.classList.add('working');
    body.append(el('div', 'text md-typescale-body-medium', m.text.charAt(0).toUpperCase() + m.text.slice(1)),
      el('div', 'md-typescale-label-small muted', `${m.count > 1 ? `${m.count} actions in the browser` : 'In the browser'} · ${clock(m.ts)}`));
  } else if (m.kind === 'request') {
    body.append(el('div', 'md-typescale-label-medium muted', 'Asked you to show it'), el('div', 'md-typescale-body-large', m.text),
      el('div', 'md-typescale-label-small muted', clock(m.ts)));
  } else if (m.kind === 'point') {
    body.append(el('div', 'md-typescale-label-medium muted', `Pointed at something${m.host ? ` on ${m.host}` : ''}`),
      el('div', 'md-typescale-body-large', m.text || m.selector), el('div', 'md-typescale-label-small muted', clock(m.ts)));
  } else if (m.kind === 'say') {
    const md = markdown(m.text || '');
    md.classList.add('md-typescale-body-large');
    body.append(md, el('div', 'md-typescale-label-small muted', clock(m.ts)));
  } else body.append(el('div', 'md-typescale-body-large', m.text || ''));
  row.append(spark(), body);
  return row;
}

// Between the user's message reaching the agent and its reply here. A reply that never comes here (the
// agent answered in its own chat, or the harness has no panel replies) is pointed out after 2 minutes.
function thinkingMsg(since) {
  const row = el('div', 'msg agent'), body = el('div', 'agent-body');
  const late = Date.now() - since > 120000;
  if (!late) row.classList.add('working');
  body.append(el('div', 'text md-typescale-body-medium', late ? 'No reply here yet. It may have answered in the agent chat.' : 'Thinking…'));
  row.append(spark(), body);
  return row;
}

let chatTimer = 0;
async function renderChat(jump = false) {
  clearTimeout(chatTimer);
  const box = $('chat');
  const atEnd = jump || box.scrollHeight - box.scrollTop - box.clientHeight < 48;
  const { chats = {}, demoRequest, hostQuestions = [], thinking = {} } = await S.get(['chats', 'demoRequest', 'hostQuestions', 'thinking']);
  const me = await frontSession();
  const list = chats[me?.id || ''] || [];
  // A pending request shows as its live card instead of its history entry.
  const shown = demoRequest ? list.filter((m, i) => !(m.kind === 'request' && i === list.findLastIndex(x => x.kind === 'request'))) : list;
  const since = me && thinking[me.id];
  $('log').replaceChildren(...shown.map(m => (m.role === 'user' ? userMsg(m) : agentMsg(m))), ...(since ? [thinkingMsg(since)] : []));
  if (since && Date.now() - since <= 120000) chatTimer = setTimeout(renderChat, 120000 - (Date.now() - since) + 100);
  $('empty').hidden = shown.length > 0 || !!demoRequest || hostQuestions.length > 0;
  $('empty-text').textContent = me ? `Mark the page, show it by doing it, or just ask ${me.name}.` : 'Mark the page, show it by doing it, or just ask.';
  if (atEnd) box.scrollTop = box.scrollHeight;
  // The "working" sheen ends 5 s after the last action.
  const last = list[list.length - 1];
  if (last?.kind === 'activity' && Date.now() - last.ts < 5000) { clearTimeout(chatTimer); chatTimer = setTimeout(renderChat, 5000 - (Date.now() - last.ts) + 50); }
}

async function renderThrottle() {
  const { throttles = {} } = await S.get('throttles');
  const t = frontTabId != null ? throttles[frontTabId] : null;
  $('throttle').hidden = !t;
  if (t) $('throttle-label').textContent = [t.network && `Network ${t.network}`, t.cpu && `CPU ${t.cpu}× slower`].filter(Boolean).join(' · ');
}
$('throttle-off').addEventListener('click', async () => {
  const r = await chrome.runtime.sendMessage({ type: 'throttleOff' });
  toast(r?.ok ? 'Throttling is off for this tab.' : 'Could not turn throttling off.');
});

// The agent wants to work on a host that is not allowed; the user decides here.
async function renderHostAsk() {
  const { hostQuestions: qs = [] } = await S.get('hostQuestions');
  const q = qs[0];
  $('host-ask').hidden = !q;
  if (!q) return;
  $('host-ask').dataset.host = q.host;
  $('host-ask-title').textContent = q.host;
  $('host-ask-text').textContent = `${q.who || 'The agent'} wants to ${q.why || 'work on this site'}. `
    + 'It could then read and act on this site in the shared browser, with your sign-ins. "Always" saves it in config.local.json.';
  $('host-ask-more').hidden = qs.length < 2;
  $('host-ask-more').textContent = qs.length > 1 ? `${qs.length - 1} more waiting` : '';
}
const decide = decision => chrome.runtime.sendMessage({ type: 'hostDecision', host: $('host-ask').dataset.host, decision });
$('host-no').addEventListener('click', () => decide('no'));
$('host-session').addEventListener('click', () => decide('session'));
$('host-always').addEventListener('click', () => decide('always'));
const allowHere = async mode => {
  const r = await chrome.runtime.sendMessage({ type: 'hostAllow', url: tabUrl, mode });
  toast(r?.ok ? `${r.host} is allowed${mode === 'always' ? ' from now on' : ' until the browser restarts'}.` : r?.error || 'Could not allow this host.');
};
$('allow-session').addEventListener('click', () => allowHere('session'));
$('allow-always').addEventListener('click', () => allowHere('always'));

function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4000);
}

// The message shows up in the conversation, so only problems get a snackbar.
async function act(type, extra = {}) {
  const r = await chrome.runtime.sendMessage({ type: 'action', action: { type, url: tabUrl, ...extra } })
    .catch(e => ({ error: e.message }));
  if (r?.error) toast('Error: ' + r.error);
  return r;
}

const clearInput = () => { $('q').value = ''; fit(); canSend(); };
async function send() {
  const text = $('q').value.trim();
  // Attachments go out with the message: an annotation and/or a recording, each as its own action.
  const { recordingDraft, annotationDraft } = await S.get(['recordingDraft', 'annotationDraft']);
  if (recordingDraft || annotationDraft) {
    const results = [];
    if (annotationDraft) results.push(await chrome.runtime.sendMessage({ type: 'annotationSend', text }).catch(e => ({ error: e.message })));
    if (recordingDraft) results.push(await chrome.runtime.sendMessage({ type: 'recSend', text, url: tabUrl }).catch(e => ({ error: e.message })));
    const failed = results.find(r => r?.error);
    if (failed) return toast('Error: ' + failed.error);
    return clearInput();
  }
  if (!text) { $('q').focus(); return; }
  const r = await act('question', { text });
  if (!r?.error) clearInput();
}

// The composer grows with its text up to a few lines; Send is on when there is something to send.
function fit() { const q = $('q'); q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 160) + 'px'; }
async function canSend() {
  const { recordingDraft, annotationDraft } = await S.get(['recordingDraft', 'annotationDraft']);
  $('send').disabled = !$('q').value.trim() && !recordingDraft && !annotationDraft;
}
$('q').addEventListener('input', () => { fit(); canSend(); });
$('sug-annotate').addEventListener('click', () => $('annotate').click());
$('sug-record').addEventListener('click', () => $('rec').click());
$('sug-ask').addEventListener('click', () => $('q').focus());

$('video-stop').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'videoStop' }));
$('video-discard').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'videoStop', discard: true }));
$('next').addEventListener('click', () => act('next'));
$('back').addEventListener('click', () => act('back'));
$('send').addEventListener('click', send);
$('q').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
// "Record": the page records what the user does; stopping sends it, with the question field
// as the comment, to the agent.
async function renderRecording() {
  const { recording, recordingDraft, annotationDraft, demoRequest } = await S.get(['recording', 'recordingDraft', 'annotationDraft', 'demoRequest']);
  $('request').hidden = !demoRequest;
  if (demoRequest) $('request-text').textContent = demoRequest.prompt;
  $('annot-chip-text').hidden = !annotationDraft;
  if (annotationDraft) $('annot-chip-text').label = `Annotation · ${annotationDraft.annotations.length}`;
  $('annotate').disabled = !tabAllowed || !!recording;
  const on = !!recording;
  $('rec').classList.toggle('recording', on);
  // setViewport and the starting page are not the user's steps.
  $('rec-label').textContent = on ? `Stop · ${steps(recording.steps.length - 2)}` : 'Record';
  $('rec').disabled = !on && (!tabAllowed || !!recordingDraft);
  $('rec-chip-text').hidden = !recordingDraft;
  if (recordingDraft) $('rec-chip-text').label = `Recording · ${steps(recordingDraft.steps.length - 2)}`;
  $('attachments').hidden = !annotationDraft && !recordingDraft;
  $('rec-discard').hidden = !on;
  canSend();
}

$('rec').addEventListener('click', async () => {
  const { recording } = await S.get('recording');
  if (!recording) {
    const r = await chrome.runtime.sendMessage({ type: 'recStart' }).catch(e => ({ error: e.message }));
    if (r?.error) return toast(r.error);
    return toast('Recording. Do it in the page.');
  }
  const r = await chrome.runtime.sendMessage({ type: 'recStop' }).catch(e => ({ error: e.message }));
  if (r?.error) return toast('Error: ' + r.error);
  toast('Recording attached. Add a message and send it.');
  window.focus();
  $('q').focus();
});
// While annotating, the panel still has focus after the click: Esc and Ctrl+Z pressed here go to the page.
let annotatingNow = false;
addEventListener('keydown', e => {
  if (!annotatingNow) return;
  const undo = e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey);
  if (e.key !== 'Escape' && !undo) return;
  e.preventDefault();
  chrome.runtime.sendMessage({ type: 'annotateKey', key: e.key, ctrl: undo }).catch(() => {});
}, true);
$('annotate').addEventListener('click', async () => {
  if (annotatingNow) return chrome.runtime.sendMessage({ type: 'annotateKey', key: 'Escape' }).catch(() => {});
  toast('In the page: click an element to mark it, or drag to draw. Then click "Done" (Esc cancels).');
  annotatingNow = true;
  $('annotate').classList.add('active');
  $('annotate-label').textContent = 'Cancel';
  const r = await chrome.runtime.sendMessage({ type: 'annotate' }).catch(e => ({ error: e.message }))
    .finally(() => { annotatingNow = false; $('annotate').classList.remove('active'); $('annotate-label').textContent = 'Annotate'; });
  if (r?.error) return toast('Error: ' + r.error);
  if (r?.cancelled) return toast('Annotation cancelled.');
  toast('Annotation attached. Add a message and send it.');
  window.focus();
  $('q').focus();
});
$('annot-chip-text').addEventListener('remove', async e => {
  e.preventDefault();
  await chrome.runtime.sendMessage({ type: 'annotationDrop' });
  toast('Annotation removed.');
});
// md-input-chip removes itself on "remove" unless the default is prevented
$('rec-chip-text').addEventListener('remove', async e => {
  e.preventDefault();
  await chrome.runtime.sendMessage({ type: 'recDrop' });
  toast('Recording removed.');
});
$('rec-discard').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'recStop', discard: true });
  toast('Recording discarded.');
});

chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'session') return;
  render();
  if (c.recording || c.recordingDraft || c.annotationDraft || c.demoRequest) renderRecording();
  if (c.hostState || c.connected) refreshTab();
  if (c.hostQuestions) renderHostAsk();
  if (c.chats || c.sessionTabs || c.sessions || c.demoRequest || c.hostQuestions || c.thinking) renderChat();
  if (c.throttles) renderThrottle();
});
renderHostAsk();
renderChat(true);
renderRecording();
chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === 'complete') refreshTab(); });
render();
refreshTab();
