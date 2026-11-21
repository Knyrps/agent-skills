import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export type DotState = 'listening' | 'waiting' | 'idle' | 'offline';

/**
 * The dot in front of the status line. Listening: filled in the session's colour with a halo.
 * Waiting: a ring in that colour. Idle (no session): grey. Offline: error red.
 */
@customElement('sat-status-dot')
export class SatStatusDot extends LitElement {
  static override styles = css`
    :host { display: inline-block; flex: none; box-sizing: border-box; width: 8px; height: 8px; border-radius: 50%;
      margin: 3px; --c: var(--session, var(--md-sys-color-primary)); background: var(--md-sys-color-outline); }
    :host([state="listening"]) { background: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 22%, transparent); }
    :host([state="waiting"]) { background: transparent; box-shadow: inset 0 0 0 2px var(--c); }
    :host([state="offline"]) { background: var(--md-sys-color-error); }
  `;
  @property({ reflect: true }) state: DotState = 'idle';
  override render() { return html``; }
}

declare global { interface HTMLElementTagNameMap { 'sat-status-dot': SatStatusDot; } }
