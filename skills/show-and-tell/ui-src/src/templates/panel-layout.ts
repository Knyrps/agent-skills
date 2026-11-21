import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

/**
 * The panel's layout: the bar on top, the pinned state under it (tour or video, throttling, a paused
 * page, a page the agent may not use), the conversation taking the rest, and the input at the bottom.
 * Slots: `bar`, `pinned`, the default one (the conversation), `dock`.
 */
@customElement('sat-panel-layout')
export class SatPanelLayout extends LitElement {
  static override styles = css`
    :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: var(--md-sys-color-surface); color: var(--md-sys-color-on-surface); }
    .pinned { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 0 12px; }
    .pinned ::slotted(*) { margin-bottom: 0; }
    .chat { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .chat ::slotted(*) { flex: 1; }
    slot[name="bar"], slot[name="dock"] { display: block; flex: none; }
  `;
  override render() {
    return html`<slot name="bar"></slot>
      <div class="pinned"><slot name="pinned"></slot></div>
      <div class="chat"><slot></slot></div>
      <slot name="dock"></slot>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-panel-layout': SatPanelLayout; } }
