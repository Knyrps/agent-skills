import { html } from 'lit';
import type { TemplateResult } from 'lit';
import '@m3e/web/app-bar';
import '@m3e/web/icon-button';
import '../atoms/icons.js';

export interface LayoutOptions {
  title: string;
  /** The link to the other page, in the app bar. */
  link: TemplateResult;
  debugOpen: boolean;
  onDebug: () => void;
}

/** The test page's layout: app bar with the page link and the debug button, the cards, and the debug side sheet at the right. */
export const layout = (o: LayoutOptions, cards: unknown, sheet: unknown): TemplateResult => html`
  <header>
    <m3e-app-bar>
      <span slot="title">${o.title}</span>
      <span slot="subtitle">show-and-tell test page</span>
      <span slot="trailing" class="trailing label-l">
        ${o.link}
        <m3e-icon-button id="debug-btn" aria-label="Debug options" title="Debug options" variant=${o.debugOpen ? 'tonal' : 'standard'}
          toggle ?selected=${o.debugOpen} aria-expanded=${o.debugOpen} @click=${o.onDebug}><m3e-icon name="bug_report"></m3e-icon></m3e-icon-button>
      </span>
    </m3e-app-bar>
  </header>
  <div class="lab-body">
    <main>${cards}</main>
    ${sheet}
  </div>`;
