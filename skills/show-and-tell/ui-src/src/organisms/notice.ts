import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@m3e/web/button';
import '@m3e/web/callout';
import '../atoms/icons.js';
import { fire, type } from '../styles.js';
import type { AllowMode } from '../types.js';

/**
 * The page in front is one the agent may not use. A website can be allowed from here; anything else
 * (a browser page, a file) cannot, so it has no buttons. Fires `sat-allow` with the mode.
 */
@customElement('sat-notice')
export class SatNotice extends LitElement {
  static override styles = [type, css`
    :host { display: block; }
    m3e-callout { display: block; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
    :host([narrow]) .actions { gap: 0; }
  `];
  @property() text = '';
  /** The page is a website, so it can be allowed. */
  @property({ type: Boolean }) web = false;
  /** "Always" needs the bridge to save it. */
  @property({ type: Boolean, attribute: 'always-disabled' }) alwaysDisabled = false;
  @property({ type: Boolean, reflect: true }) narrow = false;

  override render() {
    const size = this.narrow ? 'extra-small' : 'small';
    return html`<m3e-callout variant=${this.web ? 'error' : 'secondary'} role="status">
      <m3e-icon slot="icon" name=${this.web ? 'warning' : 'block'}></m3e-icon>
      <span slot="label">${this.web ? 'Not allowed here' : 'Not a website'}</span>
      <span id="notice-text">${this.text}</span>
      ${this.web ? html`<div class="actions" id="notice-actions">
        <m3e-button id="allow-session" variant="text" size=${size} @click=${() => fire<AllowMode>(this, 'sat-allow', 'session')}>Allow this session</m3e-button>
        <m3e-button id="allow-always" variant="text" size=${size} ?disabled=${this.alwaysDisabled} @click=${() => fire<AllowMode>(this, 'sat-allow', 'always')}>Always allow</m3e-button>
      </div>` : nothing}
    </m3e-callout>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-notice': SatNotice; } }
