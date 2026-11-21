import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

/** A small extension page: its content centred on the surface colour. */
@customElement('sat-centered-page')
export class SatCenteredPage extends LitElement {
  static override styles = css`
    :host { display: grid; place-items: center; box-sizing: border-box; height: 100%; padding: 24px;
      background: var(--md-sys-color-surface); color: var(--md-sys-color-on-surface); font-family: system-ui, "Segoe UI", sans-serif; }
  `;
  override render() { return html`<slot></slot>`; }
}

declare global { interface HTMLElementTagNameMap { 'sat-centered-page': SatCenteredPage; } }
