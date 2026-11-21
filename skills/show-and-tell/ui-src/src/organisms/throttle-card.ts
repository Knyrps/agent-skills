import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@m3e/web/button';
import '@m3e/web/callout';
import '../atoms/icons.js';
import { fire, type } from '../styles.js';

/** The tab's network or CPU is slowed down, or (kind "device") the tab is shown as another device. Fires `sat-throttle-off`. */
@customElement('sat-throttle-card')
export class SatThrottleCard extends LitElement {
  static override styles = [type, css`
    :host { display: block; }
    m3e-callout { display: block; }
    .actions { display: flex; justify-content: flex-end; margin-top: 4px; }
  `];
  /** "Network 3G · CPU 6× slower", or "Phone · 390 × 844 · 3× · touch · mobile" */
  @property() label = '';
  /** Which of the two it is; also the prefix of the ids inside. */
  @property() kind: 'throttle' | 'device' = 'throttle';
  override render() {
    const device = this.kind === 'device';
    return html`<m3e-callout variant="secondary" role="status">
      <m3e-icon slot="icon" name=${device ? 'devices' : 'network_wifi_2_bar'}></m3e-icon>
      <span slot="label">${device ? 'Shown as a device' : 'Throttled'}</span>
      <span id="${this.kind}-label">${this.label}</span>
      <div class="actions"><m3e-button id="${this.kind}-off" variant="text" size="small" @click=${() => fire(this, 'sat-throttle-off')}>Turn off</m3e-button></div>
    </m3e-callout>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-throttle-card': SatThrottleCard; } }
