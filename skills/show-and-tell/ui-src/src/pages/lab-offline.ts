// Shown instead of Chrome's error page while nothing serves the test page; switches to it once the bridge
// (which serves it) runs. Only loopback addresses are followed.
import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import '@m3e/web/theme';
import '../organisms/waiting-card.js';
import '../templates/centered-page.js';
import { isLoopbackHost } from '../../../extension/allow.js';

@customElement('sat-lab-offline-page')
export class SatLabOfflinePage extends LitElement {
  static override styles = css`:host { display: block; height: 100%; }`;

  override connectedCallback() {
    super.connectedCallback();
    const target = (() => {
      try {
        const u = new URL(new URLSearchParams(location.search).get('u') || '');
        return u.protocol === 'http:' && isLoopbackHost(u.hostname) ? u.href : null;
      } catch { return null; }
    })();
    const poll = async () => {
      if (!target) return;
      try { await fetch(target, { method: 'HEAD', cache: 'no-store' }); location.replace(target); }
      catch { setTimeout(poll, 2000); }
    };
    void poll();
  }

  override render() { return html`<sat-centered-page><sat-waiting-card></sat-waiting-card></sat-centered-page>`; }
}

declare global { interface HTMLElementTagNameMap { 'sat-lab-offline-page': SatLabOfflinePage; } }
