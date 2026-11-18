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
async function render() {
  const s = await S.get(['step', 'waiting', 'listener', 'connected', 'outbox', 'tour', 'tourIndex', 'tourRunning', 'explanation', 'video']);
  const pending = (s.outbox || []).length;
  $('conn-text').textContent = (s.connected ? 'Connected' : 'Offline') + (pending ? ` · ${pending} pending` : '');
  $('conn').classList.toggle('ok', !!s.connected);
  const who = s.listener || 'the agent';
  $('listen-text').textContent = !s.connected ? 'Bridge offline · input is kept'
    : s.waiting ? `${who} is listening` : s.listener ? `Saved until ${who} listens` : 'No agent listening · input is kept';
  $('listen').classList.toggle('on', !!(s.connected && s.waiting));
  $('tour').hidden = !(s.tour || s.step || s.video);
  $('step').textContent = s.step || '—';
  $('step').hidden = !!s.video && !s.step;
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
  if (s.tour) {
    // A scripted tour runs here; the agent is only needed for questions.
    $('back').disabled = !!s.tourRunning || (s.tourIndex ?? 0) <= 0;
    $('next').disabled = !!s.tourRunning;
    $('busy').toggleAttribute('data-on', !!s.tourRunning);
    $('status').textContent = s.tourRunning ? 'Preparing the step…' : '';
    return;
  }
  $('back').disabled = $('next').disabled = false;
  $('status').textContent = s.waiting ? 'The agent is waiting for you.' : 'The agent is working…';
  $('busy').toggleAttribute('data-on', !!(s.connected && !s.waiting));
}

async function refreshTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl = t?.url || '';
  const { hostState: hs = {}, connected } = await S.get(['hostState', 'connected']);
  const ok = hostAllowed(tabUrl, [...(await loadConfig()).allowlist, ...(hs.allow || []), ...(hs.loopback || []), ...(hs.granted || [])]);
  let host = '', web = false;
  try { const u = new URL(tabUrl); host = u.hostname; web = /^https?:$/.test(u.protocol); } catch {}
  $('notice').hidden = ok;
  $('notice-text').textContent = web
    ? `${host} is not allowed, so the agent can't point, mark or record here.`
    : 'This page is not a website, so the agent can\'t point, mark or record here.';
  $('notice-actions').hidden = !web;
  $('allow-always').disabled = !connected;
  tabAllowed = ok;
  renderRecording();
}

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
});
renderHostAsk();
renderRecording();
chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === 'complete') refreshTab(); });
render();
refreshTab();
