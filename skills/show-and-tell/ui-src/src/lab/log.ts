// The test page's log, without any UI. Every event goes into a buffer (5,000 lines); the debug panel's
// settings only decide what is shown, so changing them shows or hides past events too. Who caused an event:
//   trusted input                → [user], or [agent] while show-and-tell marks a browser_* call
//   untrusted, during a step     → [agent · scripted] (the skill playing the agent's tour or video steps)
//   untrusted, from page code    → [user · component] / [agent · component]: whoever's input came last
import { LABELS } from './events.js';

export interface Cause { who: string; how: string }
export interface Line extends Cause {
  kind: 'note' | 'demo' | 'raw';
  time: string;
  what?: string;
  type?: string; label?: string; extra?: string; where?: string; key?: string; t?: number; n?: number;
}
export interface LogConfig { from: 'both' | 'user' | 'agent'; demo: boolean; types: string[] }
/** What a card reports: the DOM event behind it, 'component' for an event a component fires itself, or nothing for a note. */
export type Report = (what: string, e?: Event | 'component', credit?: Cause) => void;

export const DEFAULTS: LogConfig = { from: 'both', demo: true, types: [] };
const MAX = 5000;
const mark = () => document.documentElement.getAttribute('data-show-and-tell-agent');
const tag = (c: Cause) => c.who ? c.who + (c.how ? ' · ' + c.how : '') : c.how;

/** One line as the log shows it. */
export const text = (x: Line): string => x.time + '  '
  + (x.kind === 'raw' ? '· ' + x.label + (x.n! > 1 ? ' ×' + x.n : '') + x.extra + ' on ' + x.where : x.what)
  + (x.kind === 'note' ? '' : '  [' + tag(x) + ']');

export class LabLog extends EventTarget {
  readonly buffer: Line[] = [];
  cfg: LogConfig;
  private lastInput: { who: string; t: number } | null = null;

  constructor(saved: Partial<LogConfig>) {
    super();
    const { from, demo, types } = { ...DEFAULTS, ...saved };
    this.cfg = { from, demo, types };
    for (const t of ['pointerdown', 'keydown', 'beforeinput', 'wheel', 'touchstart'])
      addEventListener(t, e => { if (e.isTrusted) this.lastInput = { who: this.whoOf(e).who, t: performance.now() }; }, true);
    for (const type of Object.keys(LABELS)) addEventListener(type, e => this.raw(e), { capture: true, passive: true });
  }

  whoOf(e?: Event | null): Cause {
    const m = mark();
    if (e && e.isTrusted) return { who: m != null && m !== 'scripted' ? 'agent' : 'user', how: '' };
    if (m === 'scripted') return { who: 'agent', how: 'scripted' };
    return { who: this.lastInput && performance.now() - this.lastInput.t < 60000 ? this.lastInput.who : '', how: 'component' };
  }

  shown(x: Line): boolean {
    const c = this.cfg;
    return x.kind === 'note' || ((x.kind === 'demo' ? c.demo : c.types.includes(x.type!)) && (c.from === 'both' || !x.who || x.who === c.from));
  }

  /** New settings: the page saves them; the log shows the buffer again. */
  configure(cfg: LogConfig): void {
    this.cfg = cfg;
    this.dispatchEvent(new Event('reset'));
  }

  private add(x: Omit<Line, 'time'>): void {
    const line = { ...x, time: new Date().toLocaleTimeString() } as Line;
    this.buffer.push(line);
    const dropped = this.buffer.length > MAX ? this.buffer.shift() : undefined;
    this.dispatchEvent(new CustomEvent('line', { detail: { line, dropped } }));
  }

  report: Report = (what, e, credit) => {
    if (!e) return this.add({ kind: 'note', what, who: '', how: '' });
    const c = credit || this.whoOf(e === 'component' ? null : e);
    this.add({ kind: 'demo', what, ...c });
    // For checks that drive the page: what happened, and whether real input caused it.
    const w = window as unknown as { __lab?: unknown[] };
    (w.__lab ||= []).push({ what, trusted: e !== 'component' && e.isTrusted, agent: c.who === 'agent', event: e !== 'component' });
  };

  // Raw events, always recorded; repeats of one event on one element within a second fold into one line.
  private raw(e: Event): void {
    const t = e.target as EventTarget | null;
    if (t instanceof Element && (t.closest('#log, header, sat-lab-debug') || t.localName === 'show-and-tell-overlay')) return;
    const rel = (e as MouseEvent).relatedTarget;
    if ((e.type === 'mouseover' || e.type === 'mouseout') && rel && t instanceof Node && t.contains(rel as Node)) return;
    const extra = e.type.startsWith('key') ? ' ' + (e as KeyboardEvent).key
      : e.type === 'wheel' ? ' ' + Math.round((e as WheelEvent).deltaX) + ',' + Math.round((e as WheelEvent).deltaY)
      : (e as PointerEvent).pointerType ? ' ' + (e as PointerEvent).pointerType : '';
    const c = this.whoOf(e), w = where(t), key = e.type + extra + w + tag(c), now = performance.now();
    const last = this.buffer[this.buffer.length - 1];
    if (last && last.kind === 'raw' && last.key === key && now - last.t! < 1000) {
      last.n!++; last.t = now;
      this.dispatchEvent(new CustomEvent('fold', { detail: { line: last } }));
      return;
    }
    this.add({ kind: 'raw', type: e.type, label: LABELS[e.type] || e.type, extra, where: w, ...c, key, t: now, n: 1 });
  }
}

const name = (el: EventTarget | null): string => el === window ? 'window' : !(el instanceof Element) ? 'document' : el.id ? '#' + el.id
  : el.localName + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '');
function where(el: EventTarget | null): string {
  const b = el instanceof Element && el.closest('.box');
  return name(el) + (b && b !== el && b.id ? ' in #' + b.id : '');
}
