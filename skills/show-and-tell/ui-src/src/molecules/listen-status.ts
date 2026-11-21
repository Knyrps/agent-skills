import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../atoms/status-dot.js';
import type { DotState } from '../atoms/status-dot.js';

/** The line under the session's name: a dot and whether the agent hears the panel. */
@customElement('sat-listen-status')
export class SatListenStatus extends LitElement {
  static override styles = css`
    :host { display: inline-flex; align-items: center; gap: 2px; min-width: 0; }
    span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;
  @property() state: DotState = 'idle';
  @property() text = '';
  override render() { return html`<sat-status-dot state=${this.state}></sat-status-dot><span id="listen-text">${this.text}</span>`; }
}

declare global { interface HTMLElementTagNameMap { 'sat-listen-status': SatListenStatus; } }
