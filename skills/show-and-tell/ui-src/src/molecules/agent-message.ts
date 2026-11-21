import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@m3e/web/progress-indicator';
import '../atoms/app-icon.js';
import '../atoms/icons.js';
import { type } from '../styles.js';
import { markdown, markdownStyles } from './markdown.js';

/**
 * Something the agent did or said: an optional small label, the text (plain, or Markdown for a reply),
 * and a quiet line under it. While `working`, a wavy loader takes the icon's place and the text shimmers.
 */
@customElement('sat-agent-message')
export class SatAgentMessage extends LitElement {
  static override styles = [type, markdownStyles, css`
    :host { display: flex; gap: 12px; align-items: flex-start; }
    sat-app-icon { --sat-app-icon-size: 28px; }
    m3e-circular-progress-indicator { flex: none; --m3e-circular-wavy-progress-indicator-diameter: 28px; --m3e-circular-flat-progress-indicator-diameter: 28px;
      /* The loader stands where the agent's icon stands, so it takes the session's colour like the icon. */
      --m3e-progress-indicator-color: var(--session, var(--md-sys-color-primary));
      --m3e-progress-indicator-track-color: color-mix(in srgb, var(--session, var(--md-sys-color-primary)) 24%, transparent); }
    .quiet { display: grid; place-items: center; flex: none; width: 28px; height: 28px; color: var(--md-sys-color-on-surface-variant); --m3e-icon-size: 22px; }
    .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-top: 2px; min-height: 26px; justify-content: center; }
    .text { overflow-wrap: anywhere; white-space: pre-wrap; }
    .text.md-host { white-space: normal; }
    :host([working]) .text { color: transparent; background: linear-gradient(90deg, var(--md-sys-color-on-surface) 0 38%,
      var(--md-sys-color-outline) 50%, var(--md-sys-color-on-surface) 62% 100%) 0 0 / 300% 100%; -webkit-background-clip: text; background-clip: text;
      animation: sheen 2.4s linear infinite; }
    @keyframes sheen { from { background-position: 100% 0; } to { background-position: 0 0; } }
    @media (prefers-reduced-motion: reduce) { :host([working]) .text { animation: none; color: inherit; background: none; } }
  `];
  @property() label = '';
  @property() text = '';
  /** Render `text` as Markdown (an agent reply). */
  @property({ type: Boolean }) rich = false;
  /** A smaller, greyer text: activity lines and notes. */
  @property({ type: Boolean }) small = false;
  @property() meta = '';
  @property({ type: Boolean, reflect: true }) working = false;
  /** A note that is not the agent speaking, e.g. "No reply here yet". Shows a clock instead of the icon. */
  @property({ type: Boolean }) note = false;

  override render() {
    const lead = this.working
      ? html`<m3e-circular-progress-indicator variant="wavy" indeterminate aria-label="Working"></m3e-circular-progress-indicator>`
      : this.note ? html`<span class="quiet"><m3e-icon name="schedule"></m3e-icon></span>` : html`<sat-app-icon></sat-app-icon>`;
    return html`${lead}
      <div class="body">
        ${this.label ? html`<div class="label-m muted">${this.label}</div>` : nothing}
        ${this.rich ? html`<div class="text md-host body-l">${markdown(this.text)}</div>`
          : html`<div class="text ${this.small ? 'body-m' : 'body-l'} ${this.note ? 'muted' : ''}">${this.text}</div>`}
        <slot></slot>
        ${this.meta ? html`<div class="label-s muted">${this.meta}</div>` : nothing}
      </div>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-agent-message': SatAgentMessage; } }
