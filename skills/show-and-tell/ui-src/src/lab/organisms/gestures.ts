import { html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import '@m3e/web/button';
import '@m3e/web/card';
import '@m3e/web/menu';
import type { M3eMenuElement } from '@m3e/web/menu';
import '../atoms/icons.js';
import { LabElement } from '../atoms/element.js';
import { card, CardStates } from '../atoms/card.js';
import type { Report } from '../log.js';

// Enough cards to overflow the strip even on very wide screens.
const PRODUCTS = Array.from({ length: 20 }, (_, i) => i + 1);

/** The cards that react to pointer gestures: tap, double tap, long press, pinch, swipe, drag and drop, clicks, hover, scroll. */
@customElement('sat-lab-gestures')
export class LabGestures extends LabElement {
  @property({ attribute: false }) report: Report = () => {};
  @state() private scale = 1;
  @state() private dropped = false;
  @state() private over = false;
  @state() private clicks = 0;
  @query('#strip') private strip!: HTMLElement;
  @query('#drag') private dragBox!: HTMLElement;
  @query('#drop') private dropZone!: HTMLElement;
  @query('#menu') private menu!: M3eMenuElement;
  @query('#menu-anchor') private anchor!: HTMLElement;
  @query('#scr') private scroller!: HTMLElement;

  private cards = new CardStates(this, {
    tap: 'Tap or click', dtap: 'Tap twice quickly', lp: 'Hold for 0.6 s', pinch: 'Pinch, or Ctrl + wheel',
    'strip-box': 'Swipe, scroll or drag sideways', drop: 'Drop the box here', 'btn-box': '0 clicks', dbl: 'Double click here',
    ctx: 'Right click for a menu', hover: 'Point at this', 'scr-box': 'Scroll this box',
  });
  private taps = 0;
  private lastUp = 0;
  private holdTimer = 0;
  private points = new Map<number, [number, number]>();
  private pinchStart = 0;
  private scaleStart = 1;
  private stripDrag: [number, number] | null = null;
  private pointerDrag: [number, number] | null = null;
  private stripTimer = 0;
  private scrollTimer = 0;

  // Tap: a pointer down and up on the same spot.
  private tap(e: Event) { this.taps++; this.cards.set('tap', `Tapped ${this.taps}×`); this.report('tap', e); }

  // Double tap: two pointer ups within 350 ms.
  private doubleTap(e: Event) {
    const t = performance.now();
    if (t - this.lastUp < 350) { this.cards.set('dtap', 'Double tapped'); this.report('double tap', e); this.lastUp = 0; } else this.lastUp = t;
  }

  // Long press: held 600 ms without moving away.
  private holdStart(e: Event) {
    this.cards.set('lp', 'Holding…', false);
    this.holdTimer = window.setTimeout(() => { this.cards.set('lp', 'Long pressed'); this.report('long press', e); }, 600);
  }
  private holdEnd() { clearTimeout(this.holdTimer); }

  // Pinch: two touch points, or Ctrl + wheel on a mouse or trackpad.
  private zoom(s: number, e: Event, how: string) {
    this.scale = Math.min(3, Math.max(.5, s));
    const percent = Math.round(this.scale * 100) + '%';
    this.cards.set('pinch', 'Zoom ' + percent);
    this.report(how + ' ' + percent, e);
  }
  private pinchDown(e: PointerEvent) {
    this.points.set(e.pointerId, [e.clientX, e.clientY]);
    if (this.points.size === 2) { this.pinchStart = this.spread(); this.scaleStart = this.scale; }
  }
  private pinchMove(e: PointerEvent) {
    if (!this.points.has(e.pointerId)) return;
    this.points.set(e.pointerId, [e.clientX, e.clientY]);
    if (this.points.size === 2 && this.pinchStart) this.zoom(this.scaleStart * this.spread() / this.pinchStart, e, 'pinch');
  }
  private pinchUp(e: PointerEvent) { this.points.delete(e.pointerId); if (this.points.size < 2) this.pinchStart = 0; }
  private pinchWheel(e: WheelEvent) { if (!e.ctrlKey) return; e.preventDefault(); this.zoom(this.scale * (e.deltaY < 0 ? 1.1 : .9), e, 'ctrl+wheel zoom'); }
  private spread() { const [a, b] = [...this.points.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  // Swipe strip: scrolls with touch, the wheel, or a mouse drag.
  private stripDown(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    this.stripDrag = [e.clientX, this.strip.scrollLeft];
    this.strip.setPointerCapture(e.pointerId);
  }
  private stripMove(e: PointerEvent) { if (this.stripDrag) this.strip.scrollLeft = this.stripDrag[1] - (e.clientX - this.stripDrag[0]); }
  private stripScroll() {
    const strip = this.strip;
    const first = ([...strip.children] as HTMLElement[]).find(c => c.offsetLeft - strip.offsetLeft + c.offsetWidth > strip.scrollLeft + 4);
    if (!first) return;
    this.cards.set('strip-box', 'First card in view: ' + first.dataset.n);
    clearTimeout(this.stripTimer);
    this.stripTimer = window.setTimeout(() => this.report('strip scrolled to card ' + first.dataset.n), 200);
  }

  // Drag to the drop zone: HTML5 drag and drop, or a pointer drag (touch, and pages that use pointer events).
  private drop(e: Event, how: string) {
    this.dropped = true; this.over = false;
    this.dragBox.style.translate = '';
    this.cards.set('drop', `Dropped (${how})`);
    this.report('dropped via ' + how, e);
  }
  private dragStart(e: DragEvent) { e.dataTransfer?.setData('text/plain', 'box'); this.report('drag start', e); }
  private dragDown(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    this.pointerDrag = [e.clientX, e.clientY];
    this.dragBox.setPointerCapture(e.pointerId);
  }
  private dragMove(e: PointerEvent) {
    if (this.pointerDrag) this.dragBox.style.translate = `${e.clientX - this.pointerDrag[0]}px ${e.clientY - this.pointerDrag[1]}px`;
  }
  private dragUp(e: PointerEvent) {
    if (!this.pointerDrag) return;
    this.pointerDrag = null; this.dragBox.style.translate = '';
    const r = this.dropZone.getBoundingClientRect();
    if (e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom) this.drop(e, 'pointer');
  }

  // Click, double click, right click with a menu, hover.
  private buttonClick(e: Event) {
    this.clicks++;
    this.cards.set('btn-box', `${this.clicks} click${this.clicks > 1 ? 's' : ''}`);
    this.report('click', e);
  }
  private doubleClick(e: Event) { this.cards.set('dbl', 'Double clicked'); this.report('double click', e); }
  private contextMenu(e: MouseEvent) {
    e.preventDefault();
    Object.assign(this.anchor.style, { left: e.clientX + 'px', top: e.clientY + 'px' });
    void this.menu.show(this.anchor);
    this.cards.set('ctx', 'Menu open', false);
    this.report('right click', e);
  }
  private choose(e: Event, what: string) { this.cards.set('ctx', 'Chose ' + what); this.report('menu: ' + what, e); }
  private hover(e: Event) { this.cards.set('hover', 'Hovered'); this.report('hover', e); }

  // Scroll inside a box.
  private boxScroll() {
    const top = Math.round(this.scroller.scrollTop);
    this.cards.set('scr-box', `Scrolled to ${top} px`);
    clearTimeout(this.scrollTimer);
    this.scrollTimer = window.setTimeout(() => this.report('box scrolled to ' + top), 200);
  }

  protected override firstUpdated() {
    // Lit's @wheel is passive; zooming has to stop the page's own Ctrl + wheel zoom.
    this.querySelector('#pinch')!.addEventListener('wheel', e => this.pinchWheel(e as WheelEvent), { passive: false });
    const lp = this.querySelector('#lp')!;
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) lp.addEventListener(t, () => this.holdEnd());
    const tap = this.querySelector('#tap')!, dtap = this.querySelector('#dtap')!, pinch = this.querySelector('#pinch')!;
    tap.addEventListener('pointerup', e => this.tap(e));
    dtap.addEventListener('pointerup', e => this.doubleTap(e));
    lp.addEventListener('pointerdown', e => this.holdStart(e));
    lp.addEventListener('contextmenu', e => e.preventDefault());
    pinch.addEventListener('pointerdown', e => this.pinchDown(e as PointerEvent));
    pinch.addEventListener('pointermove', e => this.pinchMove(e as PointerEvent));
    for (const t of ['pointerup', 'pointercancel']) pinch.addEventListener(t, e => this.pinchUp(e as PointerEvent));
    this.querySelector('#dbl')!.addEventListener('dblclick', e => this.doubleClick(e));
    this.querySelector('#ctx')!.addEventListener('contextmenu', e => this.contextMenu(e as MouseEvent));
    this.querySelector('#hover')!.addEventListener('mouseenter', e => this.hover(e));
    const drop = this.dropZone;
    drop.addEventListener('dragover', e => { e.preventDefault(); this.over = true; });
    drop.addEventListener('dragleave', () => { this.over = false; });
    drop.addEventListener('drop', e => { e.preventDefault(); this.drop(e, 'html5'); });
  }

  protected override updated() { this.dropZone.classList.toggle('over', this.over); }

  private box() {
    return html`<div><m3e-button id="drag" variant="tonal" draggable="true" @dragstart=${this.dragStart} @pointerdown=${this.dragDown}
      @pointermove=${this.dragMove} @pointerup=${this.dragUp}><m3e-icon slot="icon" name="drag_indicator"></m3e-icon>Box</m3e-button></div>`;
  }

  protected override render() {
    const c = this.cards;
    return html`
      ${card({ id: 'tap', title: 'Tap target', state: c.get('tap') })}
      ${card({ id: 'dtap', title: 'Double tap', state: c.get('dtap') })}
      ${card({ id: 'lp', title: 'Long press', state: c.get('lp') })}
      ${card({ id: 'pinch', title: 'Pinch area', state: c.get('pinch') },
        html`<m3e-icon class="zoom" name="zoom_in" style="transform: scale(${this.scale})"></m3e-icon>`)}
      ${card({ id: 'strip-box', title: 'Swipe strip', state: c.get('strip-box'), wide: true }, html`
        <div class="strip" id="strip" @pointerdown=${this.stripDown} @pointermove=${this.stripMove}
          @pointerup=${() => { this.stripDrag = null; }} @scroll=${this.stripScroll}>
          ${PRODUCTS.map(n => html`<m3e-card class="item" variant="outlined" data-n=${n}><div slot="content" class="label-l">Product ${n}</div></m3e-card>`)}
        </div>`)}
      ${card({ id: 'drag-box', title: 'Drag me' }, this.dropped ? '' : this.box())}
      ${card({ id: 'drop', title: 'Drop here', state: c.get('drop'), outlined: true }, this.dropped ? this.box() : '')}
      ${card({ id: 'btn-box', title: 'Click', state: c.get('btn-box') }, html`
        <div><m3e-button id="btn" variant="filled" @click=${this.buttonClick}>${this.clicks ? `Clicked ${this.clicks}` : 'Click'}</m3e-button></div>`)}
      ${card({ id: 'dbl', title: 'Double click', state: c.get('dbl') })}
      ${card({ id: 'ctx', title: 'Right click', state: c.get('ctx') })}
      ${card({ id: 'hover', title: 'Hover', state: c.get('hover') })}
      ${card({ id: 'scr-box', title: 'Scroll inside', state: c.get('scr-box') }, html`<div id="scr" @scroll=${this.boxScroll}><div></div></div>`)}
      <span id="menu-anchor"></span>
      <m3e-menu id="menu">
        ${['Copy', 'Delete'].map(v => html`<m3e-menu-item data-v=${v} @click=${(e: Event) => this.choose(e, v)}>${v}</m3e-menu-item>`)}
      </m3e-menu>`;
  }
}
