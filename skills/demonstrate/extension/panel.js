import { loadConfig, hostAllowed } from './allow.js';

const $ = id => document.getElementById(id);
const S = chrome.storage.session;
let tabUrl = '', toastTimer = 0, tabAllowed = false;
const steps = n => { n = Math.max(0, n); return `${n} step${n === 1 ? '' : 's'}`; };

// The open port tells the worker (and through it the agent) that the panel is visible.
(function connectPort() {
  chrome.runtime.connect({ name: 'panel' }).onDisconnect.addListener(() => setTimeout(connectPort, 1000));
})();

async function render() {
  const s = await S.get(['step', 'waiting', 'connected', 'outbox', 'tour', 'tourIndex', 'tourRunning', 'explanation', 'video']);
  $('step').textContent = s.step || '—';
  $('explanation').textContent = s.explanation || '';
  $('explanation').hidden = !s.explanation;
  if (s.video) {
    $('back').disabled = $('next').disabled = true;
    $('busy').toggleAttribute('data-on', s.video.state === 'starting');
    $('status').textContent = s.video.state === 'starting' ? 'Preparing the video recording…'
      : `● Recording video (${s.video.width}×${s.video.height}) · step ${s.video.step + 1} of ${s.video.steps}`;
    $('status').classList.add('waiting');
    return;
  }
  if (s.tour) {
    // A scripted tour runs here; the agent is only needed for questions.
    $('back').disabled = !!s.tourRunning || (s.tourIndex ?? 0) <= 0;
    $('next').disabled = !!s.tourRunning;
    $('busy').toggleAttribute('data-on', !!s.tourRunning);
    $('status').textContent = s.tourRunning ? 'Preparing the step…'
      : s.connected && s.waiting ? 'The agent answers questions right away.' : 'Questions are kept until the agent is listening.';
    $('status').classList.toggle('waiting', !s.tourRunning);
    const pending = (s.outbox || []).length;
    $('conn-text').textContent = (s.connected ? 'Connected' : 'Offline') + (pending ? ` · ${pending} pending` : '');
    $('conn').classList.toggle('ok', !!s.connected);
    return;
  }
  $('back').disabled = $('next').disabled = false;
  const pending = (s.outbox || []).length;
  $('conn-text').textContent = (s.connected ? 'Connected' : 'Offline') + (pending ? ` · ${pending} pending` : '');
  $('conn').classList.toggle('ok', !!s.connected);
  $('status').textContent = !s.connected ? 'Agent not connected. Your input is kept until it is.'
    : s.waiting ? 'The agent is waiting for you.' : 'The agent is working…';
  $('status').classList.toggle('waiting', !!(s.connected && s.waiting));
  $('busy').toggleAttribute('data-on', !!(s.connected && !s.waiting));
}

async function refreshTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl = t?.url || '';
  const ok = hostAllowed(tabUrl, (await loadConfig()).allowlist);
  let host = tabUrl; try { host = new URL(tabUrl).host || tabUrl; } catch {}
  $('notice').hidden = ok;
  $('notice-text').textContent = `This page (${host || 'empty'}) is not on the allowlist, so Annotate and Record are off here.`;
  tabAllowed = ok;
  renderRecording();
}

function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4000);
}

async function act(type, extra = {}) {
  const r = await chrome.runtime.sendMessage({ type: 'action', action: { type, url: tabUrl, ...extra } })
    .catch(e => ({ error: e.message }));
  if (r?.error) return toast('Error: ' + r.error);
  if (r?.local) return;
  toast(r?.delivered ? 'Sent.' : 'Saved. It will be delivered once the agent connects.');
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
    toast(results.every(r => r?.delivered) ? 'Sent.' : 'Saved. It will be delivered once the agent connects.');
    $('q').value = '';
    return;
  }
  if (!text) { $('q').focus(); return; }
  await act('question', { text });
  $('q').value = '';
}

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
});
renderRecording();
chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === 'complete') refreshTab(); });
render();
refreshTab();
