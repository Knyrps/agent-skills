import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@m3e/web/button';
import '@m3e/web/card';
import '../atoms/icons.js';
import { fire, type } from '../styles.js';
import type { HostDecision } from '../types.js';

/** The agent wants to work on a host that is not allowed; the user decides. Fires `sat-host-decision`. */
@customElement('sat-host-question')
export class SatHostQuestion extends LitElement {
  static override styles = [type, css`
    :host { display: block; }
    m3e-card { --m3e-card-padding: 16px; }
    .head { color: var(--md-sys-color-primary); }
    .content { display: flex; flex-direction: column; gap: 4px; }
    .host { overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; width: 100%; }
  `];
  @property() host = '';
  @property() text = '';
  /** How many more questions wait behind this one. */
  @property({ type: Number }) more = 0;
  @property({ type: Boolean }) narrow = false;

  private decide(d: HostDecision) { fire<HostDecision>(this, 'sat-host-decision', d); }

  // A question needs an answer: bring it fully into view when it appears, when the next one takes its place and when
  // its card settles on its height (the buttons inside render after it), even if the user had scrolled up.
  private shown = new ResizeObserver(() => this.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
  override connectedCallback() { super.connectedCallback(); this.shown.observe(this); }
  override disconnectedCallback() { super.disconnectedCallback(); this.shown.disconnect(); }
  protected override updated(changed: Map<string, unknown>) {
    if (changed.has('host')) void this.updateComplete.then(() => this.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
  }

  override render() {
    const size = this.narrow ? 'extra-small' : 'small';
    return html`<m3e-card variant="outlined" role="alertdialog" aria-labelledby="host-ask-title">
      <div slot="header" class="row label-l head"><m3e-icon name="shield_lock"></m3e-icon><span>Allow the agent here?</span></div>
      <div slot="content" class="content">
        <div class="title-m host" id="host-ask-title">${this.host}</div>
        <div class="body-m muted" id="host-ask-text">${this.text}</div>
      </div>
      <div slot="actions" class="actions">
        <m3e-button id="host-no" variant="text" size=${size} @click=${() => this.decide('no')}>No</m3e-button>
        <m3e-button id="host-session" variant="outlined" size=${size} @click=${() => this.decide('session')}>This session</m3e-button>
        <m3e-button id="host-always" variant="filled" size=${size} @click=${() => this.decide('always')}>Always</m3e-button>
      </div>
      ${this.more ? html`<div slot="footer" class="label-m muted" id="host-ask-more">${this.more} more waiting</div>` : nothing}
    </m3e-card>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-host-question': SatHostQuestion; } }
