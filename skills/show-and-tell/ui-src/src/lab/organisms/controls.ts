import { html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import '@m3e/web/button';
import '@m3e/web/checkbox';
import '@m3e/web/dialog';
import '@m3e/web/form-field';
import '@m3e/web/option';
import '@m3e/web/select';
import '@m3e/web/slider';
import type { M3eDialogElement } from '@m3e/web/dialog';
import type { M3eCheckboxElement } from '@m3e/web/checkbox';
import type { M3eSelectElement } from '@m3e/web/select';
import type { M3eSliderThumbElement } from '@m3e/web/slider';
import { LabElement } from '../atoms/element.js';
import { card, CardStates } from '../atoms/card.js';
import type { Cause, Report } from '../log.js';

interface Item { name: string; price: string }

/** The cards with form controls: typing, search, select, checkbox, slider, dialog, a shortcut, new tabs, loading data. */
@customElement('sat-lab-controls')
export class LabControls extends LabElement {
  @property({ attribute: false }) report: Report = () => {};
  /** Who caused an event; a field's change comes on blur, its value from whoever typed. */
  @property({ attribute: false }) whoOf: (e: Event) => Cause = () => ({ who: '', how: '' });
  @query('#dlg') private dialog!: M3eDialogElement;

  private cards = new CardStates(this, {
    'name-box': 'Hello, …', 'form-box': 'Type and press Enter', 'size-box': 'Size S', 'agree-box': 'Unchecked', 'vol-box': 'Volume 20',
    'dlg-box': 'Closed', 'keys-box': 'Press Ctrl+K', 'tabs-box': 'Opens /next in a new tab or a popup window', 'load-box': 'Nothing loaded',
  });
  private typedBy: Cause | undefined;
  private loads = 0;

  private onShortcut = (e: KeyboardEvent) => {
    if (e.key !== 'k' || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.cards.set('keys-box', 'Ctrl+K pressed');
    this.report('shortcut Ctrl+K', e);
  };
  override connectedCallback() { super.connectedCallback(); addEventListener('keydown', this.onShortcut); }
  override disconnectedCallback() { super.disconnectedCallback(); removeEventListener('keydown', this.onShortcut); }

  private nameInput(e: Event) {
    this.typedBy = this.whoOf(e);
    this.cards.set('name-box', 'Hello, ' + ((e.target as HTMLInputElement).value || '…'));
  }
  private nameChange(e: Event) { this.report(`name changed to "${(e.target as HTMLInputElement).value}"`, e, this.typedBy); }
  private search(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    this.cards.set('form-box', `Searched for "${(e.target as HTMLInputElement).value}"`);
    this.report('search submitted', e);
  }
  private size(e: Event) {
    const value = String((e.currentTarget as M3eSelectElement).value);
    this.cards.set('size-box', 'Size ' + value);
    this.report('select: ' + value, 'component');
  }
  private agree(e: Event) {
    const checked = (e.currentTarget as M3eCheckboxElement).checked;
    this.cards.set('agree-box', checked ? 'Checked' : 'Unchecked');
    // M3E fires change itself (untrusted); it is credited to whoever clicked, like any component event.
    void e; this.report('checkbox ' + checked, 'component');
  }
  private volume(e: Event) { this.cards.set('vol-box', 'Volume ' + (e.currentTarget as M3eSliderThumbElement).value); }
  private volumeChange(e: Event) { this.report('slider ' + (e.currentTarget as M3eSliderThumbElement).value, 'component'); }
  private openDialog(e: Event) { void this.dialog.show(); this.cards.set('dlg-box', 'Dialog open', false); this.report('dialog opened', e); }
  private confirmDialog(e: Event) { this.cards.set('dlg-box', 'Dialog confirmed'); this.report('dialog confirmed', e); }

  // New tabs: a link with target=_blank, window.open and a popup window, all opening the second page.
  private windowOpen(e: Event) { window.open('/next?via=window.open'); this.report('window.open', e); }
  private popup(e: Event) { window.open('/next?via=popup', 'lab-popup', 'popup,width=720,height=520'); this.report('popup window', e); }

  // Load data: a request with a loading state, for pausing a page between the click and the result. The README's
  // pause examples stop at the call below by its text and in these functions by name, and read `run` and `data`.
  // Keep those names, and do not quote the call in a comment: the bundle keeps comments, and the text must occur once.
  private renderItems(items: Item[]) {
    const list = this.querySelector('#items')!;
    list.replaceChildren(...items.map(item => Object.assign(document.createElement('li'), { textContent: item.name + ' · ' + item.price })));
    this.cards.set('load-box', items.length + ' items loaded');
  }
  private async loadItems(e: Event) {
    const run = ++this.loads;
    this.cards.set('load-box', 'Loading…', false);
    const res = await fetch('/api/items?run=' + run);
    const data = await res.json() as { items: Item[] };
    this.renderItems(data.items);
    this.report('items loaded', e);
  }

  protected override render() {
    const c = this.cards;
    return html`
      ${card({ id: 'name-box', title: 'Type', state: c.get('name-box') }, html`
        <m3e-form-field variant="outlined" hide-subscript="auto"><label slot="label" for="name">Name</label>
          <input id="name" autocomplete="off" @input=${this.nameInput} @change=${this.nameChange}></m3e-form-field>`)}
      ${card({ id: 'form-box', title: 'Search (Enter)', state: c.get('form-box') }, html`
        <m3e-form-field variant="outlined" hide-subscript="auto"><label slot="label" for="query">Search</label>
          <input id="query" type="search" autocomplete="off" @keydown=${this.search}></m3e-form-field>`)}
      ${card({ id: 'size-box', title: 'Select', state: c.get('size-box') }, html`
        <m3e-form-field variant="outlined" hide-subscript="auto"><label slot="label" for="size">Size</label>
          <m3e-select id="size" @change=${this.size}>
            ${['S', 'M', 'L'].map((v, i) => html`<m3e-option value=${v} ?selected=${!i}>${v}</m3e-option>`)}
          </m3e-select></m3e-form-field>`)}
      ${card({ id: 'agree-box', title: 'Checkbox', state: c.get('agree-box') }, html`
        <label class="check body-l"><m3e-checkbox id="agree" @change=${this.agree}></m3e-checkbox>I agree</label>`)}
      ${card({ id: 'vol-box', title: 'Slider', state: c.get('vol-box') }, html`
        <m3e-slider min="0" max="100" labelled><m3e-slider-thumb id="vol" value="20" aria-label="Volume"
          @input=${this.volume} @change=${this.volumeChange}></m3e-slider-thumb></m3e-slider>`)}
      ${card({ id: 'dlg-box', title: 'Dialog', state: c.get('dlg-box') }, html`
        <div><m3e-button id="open-dlg" variant="outlined" @click=${this.openDialog}>Open dialog</m3e-button></div>`)}
      ${card({ id: 'keys-box', title: 'Shortcut', state: c.get('keys-box') })}
      ${card({ id: 'tabs-box', title: 'New tabs', state: c.get('tabs-box'), wide: true }, html`
        <div class="row">
          <m3e-button id="newtab-link" variant="outlined" href="/next?via=link" target="_blank"
            @click=${(e: Event) => this.report('link to a new tab', e)}>Link</m3e-button>
          <m3e-button id="newtab-open" variant="outlined" @click=${this.windowOpen}>window.open</m3e-button>
          <m3e-button id="newtab-popup" variant="outlined" @click=${this.popup}>Popup</m3e-button>
        </div>`)}
      ${card({ id: 'load-box', title: 'Load data', state: c.get('load-box'), wide: true }, html`
        <div><m3e-button id="load" variant="outlined" @click=${this.loadItems}>Load items</m3e-button></div>
        <ul id="items" class="body-m"></ul>`)}
      <m3e-dialog id="dlg">
        <span slot="header">Confirm</span>
        A modal dialog.
        <div slot="actions" end>
          <m3e-button id="dlg-ok" @click=${this.confirmDialog}><m3e-dialog-action return-value="ok">OK</m3e-dialog-action></m3e-button>
        </div>
      </m3e-dialog>`;
  }
}
