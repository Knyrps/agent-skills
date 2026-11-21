import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@m3e/web/card';
import '../atoms/app-icon.js';
import { type } from '../styles.js';

/** What an agent session's placeholder tab says: whose tab it is, and why it exists. */
@customElement('sat-session-tab-card')
export class SatSessionTabCard extends LitElement {
  static override styles = [type, css`
    :host { display: block; width: min(480px, 100%); }
    m3e-card { --m3e-card-padding: 24px; }
    .content { display: flex; flex-direction: column; gap: 8px; }
    sat-app-icon { --sat-app-icon-size: 28px; }
    .kicker { color: var(--md-sys-color-primary); }
    h1 { margin: 0; font: 400 28px/36px system-ui, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
    p { margin: 0; }
  `];
  @property() name = 'Agent session';
  override render() {
    return html`<m3e-card variant="filled"><div slot="content" class="content">
      <div class="row label-l kicker"><sat-app-icon></sat-app-icon><span>show-and-tell</span></div>
      <h1 id="name">${this.name}</h1>
      <p class="body-m muted">This tab belongs to this agent session; it works here so it doesn't get in the way of other sessions.
        The side panel shows and talks to the session whose tab is in front.</p>
    </div></m3e-card>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-session-tab-card': SatSessionTabCard; } }
