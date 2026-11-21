import { LitElement } from 'lit';

/**
 * Base of the test page's own elements. They render into the page itself, not into a shadow root: the page
 * exists so that agents and checks can address its cards by id (`#tap`, `#load-box .state`). The M3E controls
 * inside them keep their shadow DOM, the way controls in real apps do. Styles are in `styles.ts`, adopted by the page.
 */
export class LabElement extends LitElement {
  protected override createRenderRoot(): HTMLElement { return this; }
}
