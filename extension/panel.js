import { loadConfig, hostAllowed } from './allow.js';

const $ = id => document.getElementById(id);
const S = chrome.storage.session;
let tabUrl = '', toastTimer = 0, tabAllowed = false;

// The open port tells the worker (and through it the agent) that the panel is visible.
(function connectPort() {
  chrome.runtime.connect({ name: 'panel' }).onDisconnect.addListener(() => setTimeout(connectPort, 1000));
})();

async function render() {
  const s = await S.get(['step', 'waiting', 'connected', 'outbox', 'tour', 'tourIndex', 'tourRunning', 'explanation']);
  $('step').textContent = s.step || '—';
  $('explanation').textContent = s.explanation || '';
  $('explanation').hidden = !s.explanation;
  if (s.tour) {
    // A scripted tour runs here; the agent is only needed for questions.
    $('back').disabled = !!s.tourRunning || (s.tourIndex ?? 0) <= 0;
    $('next').disabled = !!s.tourRunning;
    $('busy').toggleAttribute('data-on', !!s.tourRunning);
    $('status').textContent = s.tourRunning ? 'Schritt wird vorbereitet …'
      : s.connected && s.waiting ? 'Fragen beantwortet der Agent sofort.' : 'Fragen werden gesammelt, bis der Agent zuhört.';
    $('status').classList.toggle('waiting', !s.tourRunning);
    const pending = (s.outbox || []).length;
    $('conn-text').textContent = (s.connected ? 'Verbunden' : 'Offline') + (pending ? ` · ${pending} ausstehend` : '');
    $('conn').classList.toggle('ok', !!s.connected);
    return;
  }
  $('back').disabled = $('next').disabled = false;
  const pending = (s.outbox || []).length;
  $('conn-text').textContent = (s.connected ? 'Verbunden' : 'Offline') + (pending ? ` · ${pending} ausstehend` : '');
  $('conn').classList.toggle('ok', !!s.connected);
  $('status').textContent = !s.connected ? 'Agent nicht verbunden – Eingaben werden gepuffert.'
    : s.waiting ? 'Der Agent wartet auf dich.' : 'Der Agent arbeitet …';
  $('status').classList.toggle('waiting', !!(s.connected && s.waiting));
  $('busy').toggleAttribute('data-on', !!(s.connected && !s.waiting));
}

async function refreshTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl = t?.url || '';
  const ok = hostAllowed(tabUrl, (await loadConfig()).allowlist);
  let host = tabUrl; try { host = new URL(tabUrl).host || tabUrl; } catch {}
  $('notice').hidden = ok;
  $('notice-text').textContent = `Diese Seite (${host || 'leer'}) ist nicht freigegeben – Markieren und Aufnehmen sind hier aus.`;
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
  if (r?.error) return toast('Fehler: ' + r.error);
  if (r?.local) return;
  toast(r?.delivered ? 'Gesendet.' : 'Gespeichert – wird zugestellt, sobald der Agent verbunden ist.');
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
    if (failed) return toast('Fehler: ' + failed.error);
    toast(results.every(r => r?.delivered) ? 'Gesendet.' : 'Gespeichert – wird zugestellt, sobald der Agent verbunden ist.');
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
// "Zeig ich dir": the page records what the user does; stopping sends it, with the question field
// as the comment, to the agent.
async function renderRecording() {
  const { recording, recordingDraft, annotationDraft, demoRequest } = await S.get(['recording', 'recordingDraft', 'annotationDraft', 'demoRequest']);
  $('request').hidden = !demoRequest;
  if (demoRequest) $('request-text').textContent = demoRequest.prompt;
  $('annot-chip').hidden = !annotationDraft;
  if (annotationDraft) $('annot-chip-text').label = `Markierung · ${annotationDraft.annotations.length}`;
  $('annotate').disabled = !tabAllowed || !!recording;
  const on = !!recording;
  $('rec').classList.toggle('recording', on);
  $('rec-label').textContent = on ? 'Aufnahme beenden' : 'Zeig ich dir';
  $('rec').disabled = !on && (!tabAllowed || !!recordingDraft);
  $('rec-chip').hidden = !recordingDraft;
  if (recordingDraft) {
    $('rec-chip-text').label = `Aufnahme · ${Math.max(0, recordingDraft.steps.length - 2)} Schritte`;
  }
  $('rec-discard').hidden = !on;
  $('rec-count').hidden = !on;
  // setViewport and the starting page are not the user's steps.
  if (on) $('rec-count').textContent = `${Math.max(0, recording.steps.length - 2)} Schritte`;
}

$('rec').addEventListener('click', async () => {
  const { recording } = await S.get('recording');
  if (!recording) {
    const r = await chrome.runtime.sendMessage({ type: 'recStart' }).catch(e => ({ error: e.message }));
    if (r?.error) return toast(r.error);
    return toast('Aufnahme läuft – mach es in der Seite vor.');
  }
  const r = await chrome.runtime.sendMessage({ type: 'recStop' }).catch(e => ({ error: e.message }));
  if (r?.error) return toast('Fehler: ' + r.error);
  toast('Aufnahme angehängt – Frage dazu schreiben und senden.');
  window.focus();
  $('q').focus();
});
$('annotate').addEventListener('click', async () => {
  toast('In der Seite: Klick markiert ein Element, Ziehen zeichnet. Dann „Fertig“ (Esc bricht ab).');
  const r = await chrome.runtime.sendMessage({ type: 'annotate' }).catch(e => ({ error: e.message }));
  if (r?.error) return toast('Fehler: ' + r.error);
  if (r?.cancelled) return toast('Markieren abgebrochen.');
  toast('Markierung angehängt – Frage dazu schreiben und senden.');
  window.focus();
  $('q').focus();
});
$('annot-chip-text').addEventListener('remove', async e => {
  e.preventDefault();
  await chrome.runtime.sendMessage({ type: 'annotationDrop' });
  toast('Markierung entfernt.');
});
// md-input-chip removes itself on "remove" unless the default is prevented
$('rec-chip-text').addEventListener('remove', async e => {
  e.preventDefault();
  await chrome.runtime.sendMessage({ type: 'recDrop' });
  toast('Aufnahme entfernt.');
});
$('rec-discard').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'recStop', discard: true });
  toast('Aufnahme verworfen.');
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
