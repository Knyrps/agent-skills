import { html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '@m3e/web/button';
import '@m3e/web/chips';
import '@m3e/web/divider';
import '@m3e/web/form-field';
import '@m3e/web/icon-button';
import '@m3e/web/segmented-button';
import '@m3e/web/switch';
import type { M3eFilterChipSetElement } from '@m3e/web/chips';
import type { M3eSegmentedButtonElement } from '@m3e/web/segmented-button';
import type { M3eSwitchElement } from '@m3e/web/switch';
import '../atoms/icons.js';
import { LabElement } from '../atoms/element.js';
import { GROUPS } from '../events.js';
import type { EventGroup, EventType } from '../events.js';
import { DEFAULTS } from '../log.js';
import type { LogConfig } from '../log.js';

const FROM: [LogConfig['from'], string][] = [['both', 'User + agent'], ['user', 'User'], ['agent', 'Agent']];
const ALL = GROUPS.flatMap(g => g.types.map(t => t.type));
const matches = (g: EventGroup, t: EventType, q: string) => !q || `${t.type} ${t.label} ${t.note} ${g.name}`.toLowerCase().includes(q);

/**
 * Debug options: a side sheet docked at the right of the test page. Whose events the log shows, the cards'
 * own reactions, and the raw DOM events by group as filter chips, narrowed by the search field. Takes the
 * settings and fires `sat-lab-config` with the changed ones and `sat-lab-debug-close`; keeps only the search text.
 */
@customElement('sat-lab-debug')
export class LabDebug extends LabElement {
  @property({ attribute: false }) cfg: LogConfig = DEFAULTS;
  @state() private search = '';

  private change(patch: Partial<LogConfig>) {
    this.dispatchEvent(new CustomEvent<LogConfig>('sat-lab-config', { detail: { ...this.cfg, ...patch }, bubbles: true, composed: true }));
  }
  private set(types: string[], on: boolean) {
    const set = new Set(this.cfg.types);
    for (const t of types) on ? set.add(t) : set.delete(t);
    this.change({ types: [...set] });
  }
  private on(type: string) { return this.cfg.types.includes(type); }
  /** The event types the search leaves visible: the sheet's All and None act on these. */
  private get visible(): string[] {
    return GROUPS.flatMap(g => g.types.filter(t => matches(g, t, this.search)).map(t => t.type));
  }

  private group(g: EventGroup) {
    const shown = g.types.filter(t => matches(g, t, this.search));
    if (!shown.length) return nothing;
    const on = g.types.filter(t => this.on(t.type)).length, types = shown.map(t => t.type), all = types.every(t => this.on(t));
    // The chip set reports its selection; the change is what differs from the settings among the chips shown.
    const picked = (e: Event) => {
      const value = (e.currentTarget as M3eFilterChipSetElement).value;
      const now = new Set(Array.isArray(value) ? value : value ? [value] : []);
      const set = new Set(this.cfg.types);
      for (const t of types) now.has(t) ? set.add(t) : set.delete(t);
      this.change({ types: [...set] });
    };
    return html`
      <section class="group" data-group=${g.name}>
        <div class="group-head">
          <span class="title-s grow">${g.name}</span>
          <span class="count body-s muted">${on}/${g.types.length}</span>
          <m3e-button class="gbox" variant="text" size="extra-small" @click=${() => this.set(types, !all)}>${all ? 'None' : 'All'}</m3e-button>
        </div>
        <m3e-filter-chip-set multi aria-label="${g.name} events" @change=${picked}>
          ${shown.map(t => html`<m3e-filter-chip class="ev" data-type=${t.type} value=${t.type} title=${t.note || t.type}
            ?selected=${this.on(t.type)}>${t.type}</m3e-filter-chip>`)}
        </m3e-filter-chip-set>
      </section>`;
  }

  protected override render() {
    const c = this.cfg, n = c.types.length, groups = GROUPS.map(g => this.group(g));
    return html`
      <aside class="sheet" role="complementary" aria-label="Debug options">
        <div class="sheet-head">
          <span class="title-l grow">Debug options</span>
          <m3e-icon-button id="debug-close" aria-label="Close debug options"
            @click=${() => this.dispatchEvent(new CustomEvent('sat-lab-debug-close', { bubbles: true, composed: true }))}>
            <m3e-icon name="close"></m3e-icon></m3e-icon-button>
        </div>
        <div class="sheet-body">
          <div class="label-l muted">Log events from</div>
          <m3e-segmented-button id="log-from"
            @change=${(e: Event) => this.change({ from: (e.currentTarget as M3eSegmentedButtonElement).value as LogConfig['from'] })}>
            ${FROM.map(([value, label]) => html`<m3e-button-segment value=${value} ?checked=${c.from === value}>${label}</m3e-button-segment>`)}
          </m3e-segmented-button>
          <label class="switch-row">
            <span class="txt grow"><span class="body-l">Card reactions</span>
              <span class="body-s muted">What the cards report: tapped, hovered, Ctrl+K…</span></span>
            <m3e-switch id="demo" ?checked=${c.demo} @change=${(e: Event) => this.change({ demo: (e.currentTarget as M3eSwitchElement).checked })}></m3e-switch>
          </label>
          <m3e-divider></m3e-divider>
          <div class="raw-head">
            <span class="title-m grow">Raw events</span>
            <span id="adv-sum" class="body-s muted">${n ? `${n} of ${ALL.length} on` : 'None on'}</span>
          </div>
          <m3e-form-field variant="outlined" hide-subscript="auto">
            <m3e-icon slot="prefix" name="search"></m3e-icon>
            <label slot="label" for="ev-search">Search events</label>
            <input id="ev-search" type="search" autocomplete="off" .value=${this.search}
              @input=${(e: Event) => { this.search = (e.target as HTMLInputElement).value.trim().toLowerCase(); }}>
          </m3e-form-field>
          <div class="row actions">
            <m3e-button id="ev-all" variant="text" size="small" @click=${() => this.set(this.visible, true)}>All</m3e-button>
            <m3e-button id="ev-none" variant="text" size="small" @click=${() => this.set(this.visible, false)}>None</m3e-button>
            <span class="grow"></span>
            <m3e-button id="ev-reset" variant="text" size="small" @click=${() => this.change({ ...DEFAULTS })}>Reset</m3e-button>
          </div>
          <div id="ev-list">
            ${groups.some(g => g !== nothing) ? groups : html`<p class="body-m muted empty">No event matches “${this.search}”.</p>`}
          </div>
        </div>
      </aside>`;
  }
}
