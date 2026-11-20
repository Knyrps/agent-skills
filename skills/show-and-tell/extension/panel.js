import { loadConfig, hostAllowed } from './allow.js';

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
  $('listen-text').textContent = !s.connected ? 'Bridge offline · input is kept'
    : me && !me.live ? `${who} has ended · input goes to the latest agent`
      : listening ? `${who} is listening` : me || s.listener ? `Saved until ${who} listens` : 'No agent listening · input is kept';
  $('listen').classList.toggle('on', !!(s.connected && listening));
  $('listen').style.setProperty('--session', me ? GROUP[me.color] || '' : '');
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
  if (frontTabId !== (t?.id ?? null)) { frontTabId = t?.id ?? null; render(); renderActivity(); renderThrottle(); }
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

// The agent's latest browser action; it fades after 5 s and goes after 30 s without another one.
let activityTimer = 0;
async function renderActivity() {
  clearTimeout(activityTimer);
  // The session in front, else whichever session acted last.
  const { activities = {} } = await S.get('activities');
  const me = await frontSession();
  const a = me ? activities[me.id] : Object.values(activities).sort((x, y) => y.ts - x.ts)[0];
  const age = a ? Date.now() - a.ts : Infinity;
  $('activity').hidden = age > 30000;
  if (age > 30000) return;
  $('activity-who').textContent = a.who ? a.who + ' is' : 'The agent is';
  $('activity-text').textContent = a.text;
  $('activity-age').textContent = age < 2000 ? 'now' : `${Math.round(age / 1000)} s ago`;
  $('activity').classList.toggle('old', age > 5000);
  activityTimer = setTimeout(renderActivity, 1000);
}

async function renderThrottle() {
  const { throttles = {} } = await S.get('throttles');
  const t = frontTabId != null ? throttles[frontTabId] : null;
  $('throttle').hidden = !t;
  if (t) $('throttle-label').textContent = t.label;
}
$('throttle-off').addEventListener('click', async () => {
  const r = await chrome.runtime.sendMessage({ type: 'throttleOff' });
  toast(r?.ok ? 'Network throttling is off for this tab.' : 'Could not turn throttling off.');
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

async function sentText(delivered) {
  const { waiting, listener } = await S.get(['waiting', 'listener']);
  if (delivered && waiting) return `Sent to ${listener || 'the agent'}.`;
  return `Saved. ${listener || 'The agent'} gets it as soon as it listens.`;
}

async function act(type, extra = {}) {
  const r = await chrome.runtime.sendMessage({ type: 'action', action: { type, url: tabUrl, ...extra } })
    .catch(e => ({ error: e.message }));
  if (r?.error) return toast('Error: ' + r.error);
  if (r?.local) return;
  toast(await sentText(r?.delivered));
}

async function send() {
  const text = $('q').value.trim();
  // Attachments go out with the question: an annotation and/or a recording, each as its own action.
  const { recordingDraft, annotationDraft } = await S.get(['recordingDraft', 'annotationDraft']);
  if (recordingDraft || annotationDraft) {
    const results = [];
    if (annotationDraft) results.push(await chrome.runtime.sendMessage({ type: 'annotationSend', text }).catch(e => ({ error: e.message })));
    if (recordingDraft) results.push(await chrome.runtime.sendMessage({ type: 'recSend', text, url: tabUrl }).catch(e => ({ error: e.message })));
    const failed = results.find(r => r?.error);
    if (failed) return toast('Error: ' + failed.error);
    toast(await sentText(results.every(r => r?.delivered)));
    $('q').value = '';
    return;
  }
  if (!text) { $('q').focus(); return; }
  await act('question', { text });
  $('q').value = '';
}

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
  $('annot-chip').hidden = !annotationDraft;
  if (annotationDraft) $('annot-chip-text').label = `Annotation · ${annotationDraft.annotations.length}`;
  $('annotate').disabled = !tabAllowed || !!recording;
  const on = !!recording;
  $('rec').classList.toggle('recording', on);
  $('rec-label').textContent = on ? 'Stop recording' : 'Record';
  $('rec').disabled = !on && (!tabAllowed || !!recordingDraft);
  $('rec-chip').hidden = !recordingDraft;
  if (recordingDraft) {
    $('rec-chip-text').label = `Recording · ${steps(recordingDraft.steps.length - 2)}`;
  }
  $('rec-discard').hidden = !on;
  $('rec-count').hidden = !on;
  // setViewport and the starting page are not the user's steps.
  if (on) $('rec-count').textContent = steps(recording.steps.length - 2);
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
  toast('Recording attached. Add a question and send it.');
  window.focus();
  $('q').focus();
});
$('annotate').addEventListener('click', async () => {
  toast('In the page: click an element to mark it, or drag to draw. Then click "Done" (Esc cancels).');
  const r = await chrome.runtime.sendMessage({ type: 'annotate' }).catch(e => ({ error: e.message }));
  if (r?.error) return toast('Error: ' + r.error);
  if (r?.cancelled) return toast('Annotation cancelled.');
  toast('Annotation attached. Add a question and send it.');
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
  if (c.activities || c.sessionTabs) renderActivity();
  if (c.throttles) renderThrottle();
});
renderHostAsk();
renderActivity();
renderRecording();
chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === 'complete') refreshTab(); });
render();
refreshTab();
