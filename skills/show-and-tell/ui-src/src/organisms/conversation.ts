import { LitElement, css, html, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@m3e/web/chips';
import '../atoms/app-icon.js';
import '../atoms/icons.js';
import '../molecules/agent-message.js';
import '../molecules/user-message.js';
import { fire, type } from '../styles.js';
import type { ChatMessage, Suggestion } from '../types.js';

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
/** An action counts as "in progress" for this long after it happened. */
const FRESH = 5000;
/** After this long without a reply here, say that it may be in the agent chat. */
const LATE = 120000;

/**
 * The conversation with the session in front: what the user sent, what the agent did in the browser and
 * what it replied. It scrolls by itself and stays at the latest entry unless the user scrolled up.
 * The default slot comes after the entries (the host question). Fires `sat-suggest`.
 */
@customElement('sat-conversation')
export class SatConversation extends LitElement {
  static override styles = [type, css`
    :host { display: flex; flex-direction: column; gap: 16px; min-height: 0; overflow-y: auto; scrollbar-width: none; padding: 8px 16px 16px;
      scroll-behavior: smooth; }
    :host([scrolled]) { mask-image: linear-gradient(to bottom, transparent 0, #000 20px); }
    .empty { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; gap: 12px; padding: 0 4px 8px; }
    .empty sat-app-icon { --sat-app-icon-size: 48px; }
    .scope { justify-content: center; gap: 4px; --m3e-icon-size: 14px; }
    @media (prefers-reduced-motion: reduce) { :host { scroll-behavior: auto; } }
  `];
  @property({ attribute: false }) messages: ChatMessage[] = [];
  /** When the user's last message reached the agent, while its reply here is still open. */
  @property({ attribute: false }) thinkingSince: number | null = null;
  /** The agent asked to be shown something and recording has started. */
  @property() request = '';
  /** The greeting instead of an empty list. */
  @property({ type: Boolean }) empty = false;
  /** The session's name, for the greeting. */
  @property() name = '';

  /** The view follows the latest entry until the user scrolls away from it. */
  private following = true;
  private timer = 0;
  private resized = new ResizeObserver(() => this.follow());

  override connectedCallback() {
    super.connectedCallback();
    this.addEventListener('scroll', this.onScroll, { passive: true });
    this.resized.observe(this);
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('scroll', this.onScroll);
    this.resized.disconnect();
    clearTimeout(this.timer);
  }
  private onScroll = () => {
    this.toggleAttribute('scrolled', this.scrollTop > 4);
    this.following = this.scrollHeight - this.scrollTop - this.clientHeight < 48;
  };
  private follow() { if (this.following) this.scrollTo({ top: this.scrollHeight, behavior: 'instant' }); }

  /** Show the latest entry, e.g. after the tab in front changed. */
  jumpToEnd() { this.following = true; this.follow(); }

  protected override updated(_changed: PropertyValues) {
    this.follow();
    // The entries render after this element does: follow again once they have their height.
    const entries = [...this.renderRoot.querySelectorAll<LitElement>('sat-agent-message, sat-user-message')];
    void Promise.all(entries.map(e => e.updateComplete)).then(() => this.follow());
    // Come back when "in progress" or "thinking" runs out, so the loader stops by itself.
    clearTimeout(this.timer);
    const now = Date.now(), last = this.messages[this.messages.length - 1];
    const due = [last?.kind === 'activity' ? last.ts + FRESH : 0, this.thinkingSince ? this.thinkingSince + LATE : 0].filter(t => t > now);
    if (due.length) this.timer = window.setTimeout(() => this.requestUpdate(), Math.min(...due) - now + 50);
  }

  private entry(m: ChatMessage, isLast: boolean) {
    const time = clock(m.ts);
    if (m.role === 'user') return html`<sat-user-message class="msg user" text=${m.text ?? ''} .attachments=${m.att ?? []} ?acked=${!!m.acked} time=${time}></sat-user-message>`;
    if (m.kind === 'activity') {
      const text = (m.text ?? '').replace(/^./, c => c.toUpperCase());
      return html`<sat-agent-message class="msg agent" small text=${text} ?working=${isLast && Date.now() - m.ts < FRESH}
        meta="${(m.count ?? 1) > 1 ? `${m.count} actions in the browser` : 'In the browser'} · ${time}"></sat-agent-message>`;
    }
    if (m.kind === 'request') return html`<sat-agent-message class="msg agent" label="Asked you to show it" text=${m.text ?? ''} meta=${time}></sat-agent-message>`;
    if (m.kind === 'point') return html`<sat-agent-message class="msg agent" label="Pointed at something${m.host ? ` on ${m.host}` : ''}"
      text=${m.text || m.selector || ''} meta=${time}></sat-agent-message>`;
    return html`<sat-agent-message class="msg agent" ?rich=${m.kind === 'say'} text=${m.text ?? ''} meta=${time}></sat-agent-message>`;
  }

  override render() {
    const since = this.thinkingSince, late = since != null && Date.now() - since > LATE;
    return html`
      ${this.empty ? html`<div class="empty" id="empty">
        <sat-app-icon></sat-app-icon>
        <div class="headline-s">What do you want to show?</div>
        <div class="body-m muted" id="empty-text">Mark the page, show it by doing it, or just ask${this.name ? ` ${this.name}` : ''}.</div>
        <m3e-chip-set>
          <m3e-suggestion-chip id="sug-annotate" @click=${() => fire<Suggestion>(this, 'sat-suggest', 'annotate')}><m3e-icon slot="icon" name="draw"></m3e-icon>Mark something on the page</m3e-suggestion-chip>
          <m3e-suggestion-chip id="sug-record" @click=${() => fire<Suggestion>(this, 'sat-suggest', 'record')}><m3e-icon slot="icon" name="radio_button_checked"></m3e-icon>Show it by doing it</m3e-suggestion-chip>
          <m3e-suggestion-chip id="sug-ask" @click=${() => fire<Suggestion>(this, 'sat-suggest', 'ask')}><m3e-icon slot="icon" name="chat_bubble"></m3e-icon>Ask a question</m3e-suggestion-chip>
        </m3e-chip-set>
      </div>` : nothing}
      ${this.messages.length ? html`<div class="row label-s muted scope" id="scope" role="note"
          title="Only what you send here, and the agent's replies to it, shows in this panel. Everything else stays in the agent chat.">
        <m3e-icon name="info"></m3e-icon><span>Only panel messages show here</span></div>` : nothing}
      <div id="log" style="display: contents">${this.messages.map((m, i) => this.entry(m, i === this.messages.length - 1))}
        ${since == null ? nothing : late
          ? html`<sat-agent-message class="msg agent" small note text="No reply here yet. It may have answered in the agent chat."></sat-agent-message>`
          : html`<sat-agent-message class="msg agent" small working text="Thinking…"></sat-agent-message>`}</div>
      ${this.request ? html`<sat-agent-message id="request" class="msg agent" label="Asks you to show it" text=${this.request}>
        <div class="body-m muted">Recording has started. Do it in the page, then press Stop below.</div></sat-agent-message>` : nothing}
      <slot></slot>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-conversation': SatConversation; } }
