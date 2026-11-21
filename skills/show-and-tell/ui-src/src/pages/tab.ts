// Placeholder for a new session tab: names the session it belongs to, in that session's colour.
import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import '@m3e/web/theme';
import '../organisms/session-tab-card.js';
import '../templates/centered-page.js';
import { GROUP } from '../session-colours.js';

@customElement('sat-tab-page')
export class SatTabPage extends LitElement {
  static override styles = css`:host { display: block; height: 100%; }`;
  @state() private name = '';
  @state() private colour = '';

  override connectedCallback() {
    super.connectedCallback();
    const q = new URLSearchParams(location.search);
    this.name = q.get('n') || '';
    if (this.name) document.title = this.name + ' · show-and-tell';
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    void chrome.storage.session.get('sessionTabs').then(({ sessionTabs = {} }) => {
      this.colour = GROUP[sessionTabs[q.get('s') || '']?.color]?.[dark ? 1 : 0] || '';
    }).catch(() => {});
  }

  override render() {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    return html`<sat-centered-page style=${this.colour ? `--session: ${this.colour}; --sat-app-icon-on: ${dark ? '#10131a' : '#fff'}` : ''}>
      <sat-session-tab-card name=${this.name || 'Agent session'}></sat-session-tab-card>
    </sat-centered-page>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-tab-page': SatTabPage; } }
