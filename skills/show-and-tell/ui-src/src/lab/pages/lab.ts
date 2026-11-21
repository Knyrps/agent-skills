// The test page (served by scripts/lab.mjs): every element reacts to real mouse, touch and keyboard input and
// to the skill's scripted actions, and a log lists what happened, by whom. Built like an app with Material 3
// Expressive components, so the controls live in shadow DOM the way they do in real apps. It shares the
// colour tokens with the extension and nothing else.
import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '@m3e/web/theme';
import { LabElement } from '../atoms/element.js';
import { card } from '../atoms/card.js';
import '../organisms/controls.js';
import '../organisms/debug.js';
import '../organisms/gestures.js';
import '../organisms/log.js';
import { layout } from '../templates/layout.js';
import { LabLog } from '../log.js';
import type { LogConfig } from '../log.js';
import { styles } from '../styles.js';

const KEY = 'labLog', OPEN = 'labDebugOpen';
function saved(): Partial<LogConfig> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<LogConfig>; } catch { return {}; }
}

@customElement('sat-lab-page')
export class LabPage extends LabElement {
  /** `lab` is the page with all cards, `next` the second page that recordings move to. */
  @property() page: 'lab' | 'next' = 'lab';
  @state() private debugOpen = sessionStorage.getItem(OPEN) === '1';
  @state() private cfg: LogConfig;
  private log = new LabLog(saved());

  constructor() {
    super();
    this.cfg = this.log.cfg;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, styles.styleSheet!];
  }

  override connectedCallback() {
    super.connectedCallback();
    this.log.report('page loaded: ' + location.pathname);
    addEventListener('keydown', e => { if (e.key === 'Escape' && this.debugOpen && !e.defaultPrevented && (e.target as Element)?.closest?.('sat-lab-debug')) this.setDebug(false); });
  }

  private setDebug(open: boolean) { this.debugOpen = open; sessionStorage.setItem(OPEN, open ? '1' : '0'); }
  private configure(e: CustomEvent<LogConfig>) {
    this.cfg = e.detail;
    localStorage.setItem(KEY, JSON.stringify(this.cfg));
    this.log.configure(this.cfg);
  }

  protected override render() {
    const next = this.page === 'next';
    const link = next
      ? html`<a href="/" id="back-link"><m3e-icon name="arrow_back"></m3e-icon>Back to the lab</a>`
      : html`<a href="/next" id="next-link">Next page<m3e-icon name="arrow_forward"></m3e-icon></a>`;
    const cards = html`
      ${next
        ? card({ id: 'second', title: 'Second page', state: { text: 'For recordings that span pages.', ok: false }, wide: true })
        : html`<sat-lab-gestures .report=${this.log.report}></sat-lab-gestures>
            <sat-lab-controls .report=${this.log.report} .whoOf=${(e: Event) => this.log.whoOf(e)}></sat-lab-controls>`}
      <sat-lab-log id="log" .log=${this.log}></sat-lab-log>`;
    const sheet = this.debugOpen
      ? html`<sat-lab-debug id="debug-panel" .cfg=${this.cfg} @sat-lab-config=${this.configure}
          @sat-lab-debug-close=${() => this.setDebug(false)}></sat-lab-debug>`
      : nothing;
    return layout({ title: next ? 'Next page' : 'Gesture lab', link, debugOpen: this.debugOpen, onDebug: () => this.setDebug(!this.debugOpen) }, cards, sheet);
  }
}
