import { LitElement, css, html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import '@m3e/web/button';
import '@m3e/web/dialog';
import '@m3e/web/icon-button';
import '@m3e/web/list';
import '../atoms/icons.js';
import { fire, type } from '../styles.js';

export interface AllowedHost { host: string; always: boolean }

/**
 * The sites the user allowed the agent on, to take one back: a dialog with one row per host, "This session"
 * or "Always", and a remove button. Sites on this machine and shared patterns are not listed; they are not
 * the user's grants. Fires `sat-revoke-host` with the host.
 */
@customElement('sat-hosts-dialog')
export class SatHostsDialog extends LitElement {
  static override styles = [type, css`
    :host { display: contents; }
    m3e-list { --m3e-list-item-leading-space: 0; --m3e-list-item-trailing-space: 0; }
    .host { overflow-wrap: anywhere; }
    .empty { padding: 8px 0; }
  `];
  @property({ attribute: false }) hosts: AllowedHost[] = [];
  @query('m3e-dialog') private dialog!: HTMLElement & { show(): Promise<void>; hide(v?: string): Promise<void> };

  show() { return this.dialog.show(); }

  override render() {
    return html`<m3e-dialog id="hosts-dialog" dismissible close-label="Close">
      <span slot="header">Allowed sites</span>
      <div class="body-m muted">The agent can read and act on these sites with your sign-ins. Take a site back to stop that.</div>
      ${this.hosts.length ? html`<m3e-list id="hosts-list">${this.hosts.map(h => html`<m3e-list-item data-host=${h.host}>
          <span class="host">${h.host}</span>
          <span slot="supporting-text">${h.always ? 'Always' : 'This session'}</span>
          <m3e-icon-button slot="trailing" aria-label="Take back ${h.host}" title="Take back ${h.host}"
            @click=${() => fire<string>(this, 'sat-revoke-host', h.host)}><m3e-icon name="delete"></m3e-icon></m3e-icon-button>
        </m3e-list-item>`)}</m3e-list>`
        : html`<div class="body-m empty" id="hosts-empty">No sites allowed. Sites on this machine are always allowed.</div>`}
      <div slot="actions" end><m3e-button variant="text" @click=${() => this.dialog.hide()}>Done</m3e-button></div>
    </m3e-dialog>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-hosts-dialog': SatHostsDialog; } }
