import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

/**
 * The show-and-tell mark: a pointer (show) with a speech dot (tell) on a rounded tile, the same drawing
 * as extension/icons/icon.svg. The tile takes the colour of the agent session in front (`--session`);
 * with no session it takes the primary colour. Size it with `--sat-app-icon-size` (default 40px).
 */
@customElement('sat-app-icon')
export class SatAppIcon extends LitElement {
  static override styles = css`
    :host { display: inline-block; flex: none; width: var(--sat-app-icon-size, 40px); height: var(--sat-app-icon-size, 40px); }
    svg { display: block; width: 100%; height: 100%; }
    rect { fill: var(--session, var(--md-sys-color-primary)); }
    path { fill: var(--sat-app-icon-on, var(--md-sys-color-on-primary)); }
    circle { fill: color-mix(in srgb, var(--session, var(--md-sys-color-primary)) 40%, var(--sat-app-icon-on, var(--md-sys-color-on-primary))); }
  `;

  override render() {
    return html`<svg viewBox="0 0 24 24" role="img" aria-label="show-and-tell">
      <rect width="24" height="24" rx="6"></rect>
      <g transform="translate(12 12) scale(.8) translate(-12.75 -10.7)">
        <path d="M4 2.5 15.5 11l-5.2 1 3 5.6-2.4 1.3-3-5.6L4 17z"></path>
        <circle cx="18.5" cy="5.5" r="3"></circle>
      </g>
    </svg>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { 'sat-app-icon': SatAppIcon; }
}
