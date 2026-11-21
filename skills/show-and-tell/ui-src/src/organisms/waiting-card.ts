import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import '@m3e/web/card';
import '@m3e/web/loading-indicator';
import { type } from '../styles.js';

/** Shown in the test page's tab while no bridge runs to serve it. */
@customElement('sat-waiting-card')
export class SatWaitingCard extends LitElement {
  static override styles = [type, css`
    :host { display: block; width: min(560px, 100%); }
    m3e-card { --m3e-card-padding: 24px; }
    .content { display: flex; flex-direction: column; gap: 16px; }
    .head { gap: 16px; }
    m3e-loading-indicator { flex: none; --m3e-loading-indicator-contained-active-indicator-color: var(--md-sys-color-secondary);
      --m3e-loading-indicator-contained-container-color: var(--md-sys-color-secondary-container); }
    code { font: 14px/20px ui-monospace, Consolas, monospace; padding: 2px 6px; border-radius: 6px; background: var(--md-sys-color-surface-container-highest); }
  `];
  override render() {
    return html`<m3e-card variant="filled" role="status" aria-live="polite"><div slot="content" class="content">
      <div class="row head"><m3e-loading-indicator variant="contained"></m3e-loading-indicator><div class="headline-s">Waiting for show-and-tell</div></div>
      <div class="body-l">The test page comes with show-and-tell's bridge, and no bridge is running right now.</div>
      <div class="body-m muted">Start an agent session that has show-and-tell, or run <code>node &lt;skill&gt;/bridge serve</code>.
        This page switches to the test page by itself as soon as it is there.</div>
    </div></m3e-card>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-waiting-card': SatWaitingCard; } }
