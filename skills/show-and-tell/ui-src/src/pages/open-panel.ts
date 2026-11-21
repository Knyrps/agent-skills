// Helper tab used by scripts/browser.mjs: sidePanel.open() needs a real user gesture, so the script sends
// a trusted click (CDP Input) to this page, which opens the panel and closes itself. A click anywhere counts.
import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import '@m3e/web/button';
import '@m3e/web/icon';
import '@m3e/web/theme';
import '@m3e/icons/outlined/view_sidebar';
import '../templates/centered-page.js';

@customElement('sat-open-panel-page')
export class SatOpenPanelPage extends LitElement {
  static override styles = css`:host { display: block; height: 100%; cursor: pointer; }`;
  private windowId: number | null = null;

  override connectedCallback() {
    super.connectedCallback();
    void chrome.windows.getCurrent().then(w => { this.windowId = w.id ?? null; document.title = 'show-and-tell:ready'; });
    document.addEventListener('click', () => {
      if (this.windowId == null) return;
      chrome.sidePanel.open({ windowId: this.windowId })
        .then(() => { document.title = 'show-and-tell:opened'; setTimeout(() => window.close(), 300); })
        .catch((e: Error) => { document.title = 'show-and-tell:error ' + e.message; });
    });
  }

  override render() {
    return html`<sat-centered-page><m3e-button id="open" variant="tonal" size="medium">
      <m3e-icon slot="icon" name="view_sidebar"></m3e-icon>Open the show-and-tell panel</m3e-button></sat-centered-page>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-open-panel-page': SatOpenPanelPage; } }
