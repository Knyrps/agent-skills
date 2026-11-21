import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@m3e/web/app-bar';
import '@m3e/web/badge';
import '@m3e/web/icon-button';
import '../atoms/app-icon.js';
import '../atoms/icons.js';
import '../molecules/listen-status.js';
import type { DotState } from '../atoms/status-dot.js';
import { fire, type } from '../styles.js';

/**
 * Who the conversation is with: the app icon in the session's colour, the session's name, whether it
 * listens, a button for a new tab in its group, and the bridge with the messages still waiting to go out.
 * Fires `sat-new-tab`.
 */
@customElement('sat-app-bar')
export class SatAppBar extends LitElement {
  static override styles = [type, css`
    :host { display: block; }
    m3e-app-bar { --m3e-app-bar-container-color: var(--md-sys-color-surface); }
    .lead { display: inline-flex; margin-inline: 4px; }
    .trail { display: flex; align-items: center; }
    .conn { position: relative; display: inline-flex; }
    m3e-badge { position: absolute; top: 4px; right: 2px; }
  `];
  @property() name = 'show-and-tell';
  @property() status = '';
  @property() dot: DotState = 'idle';
  @property({ type: Boolean }) connected = false;
  @property({ type: Number }) pending = 0;
  /** A live session is in front: offer a new tab in its group. */
  @property({ type: Boolean, attribute: 'can-new-tab' }) canNewTab = false;

  override render() {
    const bridge = (this.connected ? 'Bridge connected' : 'Bridge offline')
      + (this.pending ? ` · ${this.pending} message${this.pending === 1 ? '' : 's'} not sent yet` : '');
    return html`<m3e-app-bar>
      <span slot="leading" class="lead"><sat-app-icon></sat-app-icon></span>
      <span slot="title" id="who-name">${this.name}</span>
      <sat-listen-status slot="subtitle" id="listen" state=${this.dot} text=${this.status} title=${this.status}></sat-listen-status>
      <span slot="trailing" class="trail">
        ${this.canNewTab ? html`<m3e-icon-button id="new-tab" aria-label="New tab in ${this.name}'s group" title="New tab in ${this.name}'s group"
          @click=${() => fire(this, 'sat-new-tab')}><m3e-icon name="add"></m3e-icon></m3e-icon-button>` : nothing}
        <span class="conn" id="conn" role="img" aria-label=${bridge} title=${bridge}>
          <m3e-icon-button disabled-interactive aria-label=${bridge}><m3e-icon name=${this.connected ? 'cloud_done' : 'cloud_off'}></m3e-icon></m3e-icon-button>
          ${this.pending ? html`<m3e-badge size="medium">${this.pending}</m3e-badge>` : nothing}
        </span>
      </span>
    </m3e-app-bar>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-app-bar': SatAppBar; } }
