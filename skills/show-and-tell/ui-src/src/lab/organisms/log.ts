import { text } from '../log.js';
import type { LabLog, Line } from '../log.js';

/**
 * The log at the bottom of the test page: one line per event the settings let through. Lines are appended
 * directly (up to 5,000, several a second while the pointer moves), not rendered from a template: a plain element.
 */
export class LabLogView extends HTMLElement {
  private store!: LabLog;
  get log(): LabLog { return this.store; }
  set log(log: LabLog) {
    if (log === this.store) return;
    this.store = log;
    log.addEventListener('reset', this.reset);
    log.addEventListener('line', this.line);
    log.addEventListener('fold', this.fold);
    this.reset();
  }
  private rows = new WeakMap<Line, HTMLElement>();

  private get atEnd() { return this.scrollHeight - this.scrollTop - this.clientHeight < 24; }

  private row(x: Line): HTMLElement {
    const d = document.createElement('div');
    if (x.kind === 'raw') d.className = 'raw';
    d.textContent = text(x);
    this.rows.set(x, d);
    return d;
  }

  private reset = () => {
    this.rows = new WeakMap();
    this.replaceChildren(...this.log.buffer.filter(x => this.log.shown(x)).map(x => this.row(x)));
    this.scrollTop = this.scrollHeight;
  };
  private line = (e: Event) => {
    const { line, dropped } = (e as CustomEvent<{ line: Line; dropped?: Line }>).detail;
    if (dropped) this.rows.get(dropped)?.remove();
    if (!this.log.shown(line)) return;
    const end = this.atEnd;
    this.append(this.row(line));
    if (end) this.scrollTop = this.scrollHeight;
  };
  private fold = (e: Event) => {
    const { line } = (e as CustomEvent<{ line: Line }>).detail;
    const row = this.rows.get(line);
    if (row) row.textContent = text(line);
  };
}
customElements.define('sat-lab-log', LabLogView);
