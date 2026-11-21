import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@m3e/web/chips';
import '../atoms/icons.js';
import { type } from '../styles.js';

/** A message the user sent: attachments as chips above the bubble, and whether it went out. */
@customElement('sat-user-message')
export class SatUserMessage extends LitElement {
  static override styles = [type, css`
    :host { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .bubble { max-width: 85%; padding: 10px 16px; border-radius: 20px 20px 4px 20px; white-space: pre-wrap; overflow-wrap: anywhere;
      background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); }
    .late { color: var(--md-sys-color-error); }
  `];
  @property() text = '';
  @property({ attribute: false }) attachments: string[] = [];
  @property({ type: Boolean }) acked = false;
  @property() time = '';

  override render() {
    return html`
      ${this.attachments.length ? html`<m3e-chip-set>${this.attachments.map(a => html`
        <m3e-chip><m3e-icon slot="icon" name=${a.startsWith('Recording') ? 'radio_button_checked' : 'draw'}></m3e-icon>${a}</m3e-chip>`)}</m3e-chip-set>` : nothing}
      ${this.text ? html`<div class="bubble body-l">${this.text}</div>` : nothing}
      <div class="label-s ${this.acked ? 'muted' : 'late'}">${this.acked ? 'Sent' : 'Not sent yet · bridge offline'} · ${this.time}</div>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-user-message': SatUserMessage; } }
