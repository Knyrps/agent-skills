import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import '@m3e/web/button';
import '@m3e/web/chips';
import '@m3e/web/icon-button';
import '../atoms/icons.js';
import { fire, type } from '../styles.js';
import type { AttachmentKind } from '../types.js';

/**
 * The chat input: a message, the attachments that go out with it (an annotation, a recording), and the
 * two ways to make one. The pill and its borderless field are the one custom container in the panel;
 * the buttons inside are stock M3E.
 * Fires `sat-send` (the text), `sat-annotate`, `sat-record`, `sat-record-discard` and `sat-drop` (which attachment).
 */
@customElement('sat-composer')
export class SatComposer extends LitElement {
  static override styles = [type, css`
    :host { display: block; padding: 4px 12px 12px; }
    .pill { display: flex; flex-direction: column; gap: 2px; padding: 14px 10px 6px 12px; border-radius: 28px; background: var(--md-sys-color-surface-container-high); }
    :host([narrow]) .pill { padding: 14px 6px 6px 8px; }
    m3e-chip-set { padding: 0 4px 6px; }
    textarea { all: unset; display: block; box-sizing: border-box; width: 100%; min-height: 32px; max-height: 160px; overflow-y: auto; padding: 2px 8px 6px;
      font: 400 16px/24px system-ui, "Segoe UI", sans-serif; letter-spacing: .5px; color: var(--md-sys-color-on-surface);
      white-space: pre-wrap; overflow-wrap: anywhere; cursor: text; scrollbar-width: thin; }
    textarea::placeholder { color: var(--md-sys-color-on-surface-variant); opacity: 1; }
    .tools { display: flex; align-items: center; gap: 4px; }
    :host([narrow]) .tools, :host([recording]) .tools { gap: 0; }
  `];
  @property() placeholder = 'Message the agent';
  /** "Annotation · 3" while one is attached. */
  @property() annotation = '';
  /** "Recording · 12 steps · 2 tabs" while one is attached. */
  @property() recordingDraft = '';
  /** The user is marking the page right now: the button cancels. */
  @property({ type: Boolean }) annotating = false;
  @property({ type: Boolean, attribute: 'annotate-disabled' }) annotateDisabled = false;
  /** A recording runs: the button stops it. */
  @property({ type: Boolean, reflect: true }) recording = false;
  /** "6 steps", shown on the stop button. */
  @property({ attribute: 'recording-label' }) recordingLabel = '';
  @property({ type: Boolean, attribute: 'record-disabled' }) recordDisabled = false;
  @property({ type: Boolean, reflect: true }) narrow = false;

  @state() private text = '';
  @query('textarea') private field!: HTMLTextAreaElement;

  /** Empty the field after the message went out. */
  clear() { this.text = ''; this.field.value = ''; this.fit(); }
  focusField() { this.field.focus(); }

  private get canSend() { return !!(this.text.trim() || this.annotation || this.recordingDraft); }
  private fit() { const q = this.field; q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 160) + 'px'; }
  private onInput = () => { this.text = this.field.value; this.fit(); };
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
  };
  private send() {
    if (!this.canSend) { this.focusField(); return; }
    fire<string>(this, 'sat-send', this.text.trim());
  }
  private drop(e: Event, what: AttachmentKind) { e.preventDefault(); fire<AttachmentKind>(this, 'sat-drop', what); }

  override render() {
    const size = this.narrow ? 'extra-small' : 'small';
    return html`<div class="pill">
      ${this.annotation || this.recordingDraft ? html`<m3e-chip-set id="attachments">
        ${this.annotation ? html`<m3e-input-chip id="annot-chip-text" removable @remove=${(e: Event) => this.drop(e, 'annotation')}>
          <m3e-icon slot="icon" name="draw"></m3e-icon>${this.annotation}</m3e-input-chip>` : nothing}
        ${this.recordingDraft ? html`<m3e-input-chip id="rec-chip-text" removable @remove=${(e: Event) => this.drop(e, 'recording')}>
          <m3e-icon slot="icon" name="radio_button_checked"></m3e-icon>${this.recordingDraft}</m3e-input-chip>` : nothing}
      </m3e-chip-set>` : nothing}
      <textarea id="q" rows="1" aria-label="Message" placeholder=${this.placeholder} @input=${this.onInput} @keydown=${this.onKey}></textarea>
      <div class="tools">
        ${this.recording
          ? html`<m3e-icon-button id="annotate" size="small" aria-label="Annotate" title="Mark elements or draw on the page" ?disabled=${this.annotateDisabled}
              @click=${() => fire(this, 'sat-annotate')}><m3e-icon name="draw"></m3e-icon></m3e-icon-button>`
          : html`<m3e-button id="annotate" variant=${this.annotating ? 'tonal' : 'text'} size=${size} title="Mark elements or draw on the page"
              ?disabled=${this.annotateDisabled} @click=${() => fire(this, 'sat-annotate')}>
              <m3e-icon slot="icon" name="draw"></m3e-icon><span id="annotate-label">${this.annotating ? 'Cancel' : 'Annotate'}</span></m3e-button>`}
        <m3e-button id="rec" variant=${this.recording ? 'tonal' : 'text'} size=${size} title="Record what you do in the page"
          ?disabled=${this.recordDisabled} @click=${() => fire(this, 'sat-record')}>
          <m3e-icon slot="icon" name=${this.recording ? 'stop' : 'radio_button_checked'}></m3e-icon>
          <span id="rec-label">${this.recording ? `Stop · ${this.recordingLabel}` : 'Record'}</span></m3e-button>
        ${this.recording ? html`<m3e-icon-button id="rec-discard" size="small" aria-label="Discard the recording" title="Discard the recording"
          @click=${() => fire(this, 'sat-record-discard')}><m3e-icon name="close"></m3e-icon></m3e-icon-button>` : nothing}
        <span class="grow"></span>
        <m3e-icon-button id="send" variant="filled" aria-label="Send" title="Send (Enter) · Shift+Enter for a new line"
          ?disabled=${!this.canSend} @click=${() => this.send()}><m3e-icon name="arrow_upward"></m3e-icon></m3e-icon-button>
      </div>
    </div>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-composer': SatComposer; } }
