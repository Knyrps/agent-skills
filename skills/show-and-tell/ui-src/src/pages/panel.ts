// The side panel: the one place that talks to chrome.*, storage and the service worker. It turns the
// worker's state into properties for the organisms and their events into messages for the worker.
import { LitElement, css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import '@m3e/web/theme';
import '../atoms/icons.js';
import { M3eSnackbar } from '@m3e/web/snackbar';
import '../organisms/app-bar.js';
import '../organisms/composer.js';
import '../organisms/conversation.js';
import '../organisms/host-question.js';
import '../organisms/notice.js';
import '../organisms/pause-card.js';
import '../organisms/throttle-card.js';
import '../organisms/tour-card.js';
import '../organisms/video-card.js';
import '../templates/panel-layout.js';
import type { SatComposer } from '../organisms/composer.js';
import type { SatConversation } from '../organisms/conversation.js';
import type { DotState } from '../atoms/status-dot.js';
import type { AllowMode, AttachmentKind, ChatMessage, HostDecision, PauseChoice, PauseState, Suggestion, VideoView } from '../types.js';
import { GROUP } from '../session-colours.js';
import { hostAllowed, loadConfig } from '../../../extension/allow.js';

const S = chrome.storage.session;
const KEYS = ['step', 'steps', 'waiting', 'listener', 'connected', 'outbox', 'tour', 'tourIndex', 'tourRunning', 'tourTab', 'tourHome',
  'explanation', 'video', 'sessionTabs', 'sessions', 'chats', 'demoRequest', 'hostQuestions', 'thinking', 'throttles', 'pauses',
  'recording', 'recordingDraft', 'annotationDraft', 'hostState'];

interface Session { id: string; name: string; color: string; listening: boolean; live: boolean }
type Reply = { ok?: boolean; error?: string; cancelled?: boolean; host?: string } | null | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = Record<string, any>;

const steps = (n: number) => { n = Math.max(0, n); return `${n} step${n === 1 ? '' : 's'}`; };
// The user's own steps (not the start or the tab markers), plus how many tabs a recording spans.
const MARKERS = ['newTab', 'switchTab', 'closeTab'];
const recLabel = (r: Data) => steps(r.steps.filter((s: Data) => !MARKERS.includes(s.type)).length - 2)
  + ((r.tabs?.length || r.tabs || 1) > 1 ? ` · ${r.tabs.length || r.tabs} tabs` : '');
const send = (message: Data): Promise<Reply> => chrome.runtime.sendMessage(message).catch((e: Error) => ({ error: e.message }));
const toast = (text: string) => M3eSnackbar.open(text, { duration: 4000 });

const PAUSE_DONE: Record<PauseChoice, string> = {
  resume: 'The page runs again.', remove: 'The page runs again, without the breakpoint.', again: 'Reloading to the breakpoint.',
  skip: 'Reloading. The breakpoint lets its next hit pass.', drop: 'Reloading without the breakpoint.', held: 'Requests released.',
  armed: 'Pause points removed.',
};

@customElement('sat-panel-page')
export class SatPanelPage extends LitElement {
  static override styles = css`
    :host { display: block; height: 100%; }
    sat-panel-layout { height: 100%; }
  `;

  @state() private data: Data = {};
  @state() private frontTabId: number | null = null;
  @state() private tabUrl = '';
  /** The page in front is one the agent may use. */
  @state() private tabAllowed = false;
  /** The page in front is the extension's own placeholder tab of a session. */
  @state() private placeholder = false;
  @state() private annotating = false;
  @state() private dark = matchMedia('(prefers-color-scheme: dark)').matches;
  @state() private narrow = matchMedia('(max-width: 340px)').matches;

  @query('sat-composer') private composer!: SatComposer;
  @query('sat-conversation') private conversation!: SatConversation;

  override connectedCallback() {
    super.connectedCallback();
    // The open port tells the worker (and through it the agent) that the panel is visible.
    const connect = () => chrome.runtime.connect({ name: 'panel' }).onDisconnect.addListener(() => setTimeout(connect, 1000));
    connect();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'session') return;
      void this.load();
      if (changes.hostState || changes.connected) void this.refreshTab();
    });
    chrome.tabs.onActivated.addListener(() => void this.refreshTab());
    chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === 'complete') void this.refreshTab(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => { this.dark = e.matches; });
    matchMedia('(max-width: 340px)').addEventListener('change', e => { this.narrow = e.matches; });
    // While annotating, the panel still has focus after the click: Esc and Ctrl+Z pressed here go to the page.
    addEventListener('keydown', e => {
      if (!this.annotating) return;
      const undo = e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey);
      if (e.key !== 'Escape' && !undo) return;
      e.preventDefault();
      void send({ type: 'annotateKey', key: e.key, ctrl: undo });
    }, true);
    void this.load();
    void this.refreshTab();
  }

  private async load() { this.data = await S.get(KEYS); }

  private async refreshTab() {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    const id = t?.id ?? null, changed = id !== this.frontTabId;
    this.tabUrl = t?.url || '';
    this.frontTabId = id;
    this.placeholder = this.tabUrl.startsWith(chrome.runtime.getURL('tab.html'));
    const { hostState: hs = {} } = await S.get('hostState');
    this.tabAllowed = hostAllowed(this.tabUrl, [...(await loadConfig()).allowlist, ...(hs.allow || []), ...(hs.loopback || []), ...(hs.granted || [])]);
    if (changed) { await this.updateComplete; this.conversation?.jumpToEnd(); }
  }

  /** The session whose tab is in front, if any: the panel shows it and sends to it. */
  private get me(): Session | null {
    const { sessionTabs = {}, sessions = [] } = this.data;
    const id = Object.keys(sessionTabs).find(k => (sessionTabs[k].tabs || [sessionTabs[k].tabId]).includes(this.frontTabId));
    if (!id) return null;
    const live = sessions.find((x: Data) => x.id === id);
    return { id, name: live?.name || sessionTabs[id].name, color: sessionTabs[id].color, listening: !!live?.listening, live: !!live };
  }

  // ---- what the user does

  private async act(type: string, extra: Data = {}): Promise<Reply> {
    const r = await send({ type: 'action', action: { type, url: this.tabUrl, ...extra } });
    if (r?.error) toast('Error: ' + r.error);
    return r;
  }

  private async onSend(text: string) {
    // Attachments go out with the message: an annotation and/or a recording, each as its own action.
    const { recordingDraft, annotationDraft } = this.data;
    if (recordingDraft || annotationDraft) {
      const results: Reply[] = [];
      if (annotationDraft) results.push(await send({ type: 'annotationSend', text }));
      if (recordingDraft) results.push(await send({ type: 'recSend', text, url: this.tabUrl }));
      const failed = results.find(r => r?.error);
      if (failed) return toast('Error: ' + failed.error);
      return this.composer.clear();
    }
    const r = await this.act('question', { text });
    if (!r?.error) this.composer.clear();
  }

  private attached(what: string) {
    toast(`${what} attached. Add a message and send it.`);
    window.focus();
    this.composer.focusField();
  }

  private async onAnnotate() {
    if (this.annotating) return void send({ type: 'annotateKey', key: 'Escape' });
    toast('In the page: click an element to mark it, or drag to draw. Then click "Done" (Esc cancels).');
    this.annotating = true;
    const r = await send({ type: 'annotate' });
    this.annotating = false;
    if (r?.error) return toast('Error: ' + r.error);
    if (r?.cancelled) return toast('Annotation cancelled.');
    this.attached('Annotation');
  }

  private async onRecord() {
    if (!this.data.recording) {
      const r = await send({ type: 'recStart' });
      return toast(r?.error || 'Recording. Do it in the page.');
    }
    const r = await send({ type: 'recStop' });
    if (r?.error) return toast('Error: ' + r.error);
    this.attached('Recording');
  }

  private async onDrop(what: AttachmentKind) {
    await send({ type: what === 'annotation' ? 'annotationDrop' : 'recDrop' });
    toast(what === 'annotation' ? 'Annotation removed.' : 'Recording removed.');
  }

  private async onPause(what: PauseChoice) {
    const extra: Partial<Record<PauseChoice, Data>> = { armed: { type: 'pauseClear' }, remove: { remove: true }, again: { reload: 'again' },
      skip: { reload: 'skip' }, drop: { reload: 'remove' } };
    const r = await send({ type: 'pauseResume', ...(extra[what] || {}) });
    toast(r?.ok ? PAUSE_DONE[what] : r?.error ? `Could not do that: ${r.error}.` : 'Could not do that. Reload the page to let it run again.');
  }

  private async onAllow(mode: AllowMode) {
    const r = await send({ type: 'hostAllow', url: this.tabUrl, mode });
    toast(r?.ok ? `${r.host} is allowed${mode === 'always' ? ' from now on' : ' until the browser restarts'}.` : r?.error || 'Could not allow this host.');
  }

  private onSuggest(what: Suggestion) {
    if (what === 'annotate') void this.onAnnotate();
    else if (what === 'record') void this.onRecord();
    else this.composer.focusField();
  }

  // ---- what the panel shows

  override render() {
    const d = this.data, me = this.me, connected = !!d.connected;
    const who = me?.name || d.listener || 'the agent';
    const listening = !!(me ? me.listening : d.waiting);
    const pending = (d.outbox || []).length;
    const status = !connected ? 'Bridge offline' : me && !me.live ? 'Session ended' : listening ? 'Listening'
      : me || d.listener ? 'Not listening' : 'No agent · messages kept';
    const hint = !connected ? 'Bridge offline · messages are kept' : me && !me.live ? 'Session ended · the latest agent gets messages'
      : listening ? 'Listening · panel messages only' : me || d.listener ? 'Not listening · messages wait' : 'No agent · messages are kept';
    const dot: DotState = !connected ? 'offline' : listening ? 'listening' : me?.live ? 'waiting' : 'idle';
    // The app icon and the dot take the session's colour; an ended session turns grey, no session leaves the primary.
    const colour = me ? (me.live ? GROUP[me.color]?.[this.dark ? 1 : 0] : 'var(--md-sys-color-outline)') : undefined;
    const tint = colour ? `--session: ${colour}; --sat-app-icon-on: ${me?.live ? (this.dark ? '#10131a' : '#fff') : 'var(--md-sys-color-surface)'}` : '';

    const video: VideoView | null = d.video || null;
    const onTour = !!d.tour && (d.tourTab == null || d.tourTab === this.frontTabId || d.tourHome === this.frontTabId);
    const label: string = video || onTour ? d.step || '' : (d.steps || {})[me?.id || ''] || '';
    const showTour = !video && (onTour || !!label);

    const throttle = this.frontTabId != null ? (d.throttles || {})[this.frontTabId] : null;
    const pause = this.frontTabId != null ? (d.pauses || {})[this.frontTabId] : null;
    const paused = !!pause?.paused;

    let host = '', web = false;
    try { const u = new URL(this.tabUrl); host = u.hostname; web = /^https?:$/.test(u.protocol); } catch { /* not a URL */ }
    const blocked = !this.tabAllowed && !this.placeholder;

    const list: ChatMessage[] = (d.chats || {})[me?.id || ''] || [];
    // A pending request shows as its live card instead of its history entry.
    const lastRequest = list.findLastIndex(m => m.kind === 'request');
    const shown = d.demoRequest ? list.filter((_m, i) => i !== lastRequest) : list;
    const questions: Data[] = d.hostQuestions || [];
    const q = questions[0];

    const recording = d.recording, on = !!recording;
    return html`<sat-panel-layout style=${tint}>
        <sat-app-bar slot="bar" name=${me?.name || d.listener || 'show-and-tell'} status=${status} title=${hint} dot=${dot}
          ?connected=${connected} pending=${pending} ?can-new-tab=${!!me?.live} @sat-new-tab=${async () => {
            const r = await send({ type: 'newSessionTab' });
            if (!r?.ok) toast(r?.error || 'Could not open a tab in this group.');
          }}></sat-app-bar>

        ${showTour ? html`<sat-tour-card slot="pinned" label=${label} explanation=${d.explanation || ''}
          status=${onTour ? (d.tourRunning ? 'Preparing the step…' : '') : listening ? `${who} is waiting for you.` : `${who} is working…`}
          ?busy=${onTour ? !!d.tourRunning : connected && !listening}
          ?back-disabled=${onTour && (!!d.tourRunning || (d.tourIndex ?? 0) <= 0)} ?next-disabled=${onTour && !!d.tourRunning}
          @sat-back=${() => this.act('back')} @sat-next=${() => this.act('next')}></sat-tour-card>` : nothing}
        ${video ? html`<sat-video-card slot="pinned" .video=${video} label=${label} explanation=${d.explanation || ''}
          @sat-video-stop=${() => send({ type: 'videoStop' })} @sat-video-discard=${() => send({ type: 'videoStop', discard: true })}></sat-video-card>` : nothing}
        ${throttle ? html`<sat-throttle-card slot="pinned" id="throttle"
          label=${[throttle.network && `Network ${throttle.network}`, throttle.cpu && `CPU ${throttle.cpu}× slower`].filter(Boolean).join(' · ')}
          @sat-throttle-off=${async () => {
            const r = await send({ type: 'throttleOff' });
            toast(r?.ok ? 'Throttling is off for this tab.' : 'Could not turn throttling off.');
          }}></sat-throttle-card>` : nothing}
        ${pause ? this.pauseCard(pause) : nothing}
        ${blocked ? html`<sat-notice slot="pinned" id="notice" ?web=${web} ?narrow=${this.narrow} ?always-disabled=${!connected}
          text=${web ? `${host} is not allowed, so the agent can't point, mark or record here.` : 'This page is not a website, so the agent can\'t point, mark or record here.'}
          @sat-allow=${(e: CustomEvent<AllowMode>) => this.onAllow(e.detail)}></sat-notice>` : nothing}

        <sat-conversation id="chat" .messages=${shown} .thinkingSince=${(me && (d.thinking || {})[me.id]) || null}
          request=${d.demoRequest?.prompt || ''} name=${me?.name || ''} ?empty=${!shown.length && !d.demoRequest && !questions.length}
          @sat-suggest=${(e: CustomEvent<Suggestion>) => this.onSuggest(e.detail)}>
          ${q ? html`<sat-host-question id="host-ask" host=${q.host} more=${questions.length - 1} ?narrow=${this.narrow}
            text="${q.who || 'The agent'} wants to ${q.why || 'work on this site'}. It could then read and act on this site in the shared browser, with your sign-ins. &quot;Always&quot; saves it in config.local.json."
            @sat-host-decision=${(e: CustomEvent<HostDecision>) => send({ type: 'hostDecision', host: q.host, decision: e.detail })}></sat-host-question>` : nothing}
        </sat-conversation>

        <sat-composer slot="dock" placeholder="Message ${who}" ?narrow=${this.narrow}
          annotation=${d.annotationDraft ? `Annotation · ${d.annotationDraft.annotations.length}` : ''}
          recordingDraft=${d.recordingDraft ? `Recording · ${recLabel(d.recordingDraft)}` : ''}
          ?annotating=${this.annotating} ?recording=${on} recording-label=${on ? recLabel(recording) : ''}
          ?annotate-disabled=${!!video || !this.tabAllowed || on || paused}
          ?record-disabled=${!!video || (!on && (!this.tabAllowed || !!d.recordingDraft || paused))}
          @sat-send=${(e: CustomEvent<string>) => this.onSend(e.detail)} @sat-annotate=${() => this.onAnnotate()}
          @sat-record=${() => this.onRecord()} @sat-drop=${(e: CustomEvent<AttachmentKind>) => this.onDrop(e.detail)}
          @sat-record-discard=${async () => { await send({ type: 'recStop', discard: true }); toast('Recording discarded.'); }}></sat-composer>
      </sat-panel-layout>`;
  }

  // The agent's pause points in the tab in front: the page stopped at one, requests held back, or points
  // that are set and waiting. The button always works, with or without the agent.
  private pauseCard(p: Data) {
    const waiting = p.held ? `${p.held.count} request${p.held.count === 1 ? '' : 's'} waiting` : '';
    const short = (u: string) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
    const state: PauseState = p.paused ? 'paused' : p.held ? 'held' : 'armed';
    const point = p.paused?.point;
    let heading: string, detail: (string | false | undefined)[];
    if (state === 'paused') {
      heading = 'Page paused';
      detail = [p.paused.reason, p.paused.frames?.length && [!p.paused.reason.includes(p.paused.where) && p.paused.where,
        p.paused.fn && `${p.paused.fn}()`].filter(Boolean).join(' '), waiting];
    } else if (state === 'held') {
      heading = 'Holding requests';
      detail = [short(p.held.urls[0] || ''), waiting];
    } else {
      heading = p.points.length === 1 ? 'Pause point set' : 'Pause points set';
      detail = p.points.map((x: Data) => x.label + (x.skip ? ' (lets the next hit pass)' : ''));
    }
    return html`<sat-pause-card slot="pinned" id="pause" state=${state} heading=${heading}
      detail=${detail.filter(Boolean).join(state === 'armed' ? '\n' : ' · ')} ?has-point=${!!point} ?kept=${!!point?.kept}
      @sat-pause=${(e: CustomEvent<PauseChoice>) => this.onPause(e.detail)}></sat-pause-card>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-panel-page': SatPanelPage; } }
