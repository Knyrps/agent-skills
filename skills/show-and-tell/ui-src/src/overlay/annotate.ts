// The controls of Annotate mode, drawn over the page: the toolbar, a note and its editor. They look like
// the M3E ones in the panel and use the same tokens, but are plain templates: a content script has no
// custom elements. content.js owns the behaviour and reads `data-tool` / `data-act` from the buttons.
import { html } from 'lit-html';
import type { TemplateResult } from 'lit-html';
import { icon } from './icon.js';
import type { IconName } from './icon.js';

export type Tool = 'rect' | 'arrow' | 'pen';

const toolButton = (tool: Tool, name: IconName, tip: string, current: Tool) => html`
  <button class="ib ${tool === current ? 'on' : ''}" data-tool=${tool} data-tip=${tip} aria-label=${tip} aria-pressed=${tool === current}>${icon(name)}</button>`;

/** The floating toolbar: three tools, a hint, undo, cancel and Done. Undo and Done wait for a first mark. */
export const toolbar = (s: { tool: Tool; empty: boolean }): TemplateResult => html`
  <div class="bar" role="toolbar" aria-label="Annotate">
    ${toolButton('rect', 'crop_square', 'Frame', s.tool)}
    ${toolButton('arrow', 'arrow_outward', 'Arrow', s.tool)}
    ${toolButton('pen', 'draw', 'Pen', s.tool)}
    <span class="hint">Click to mark an element</span>
    <span class="sep"></span>
    <button class="ib" data-act="undo" data-tip="Undo (Ctrl+Z)" aria-label="Undo" ?disabled=${s.empty}>${icon('undo')}</button>
    <button class="ib" data-act="cancel" data-tip="Cancel (Esc)" aria-label="Cancel">${icon('close')}</button>
    <button class="filled" data-act="done" ?disabled=${s.empty}>${icon('check')}Done</button>
  </div>`;

/** A saved note next to its mark; the number is filled in by the caller on every frame. */
export const note = (text: string): TemplateResult => html`<span class="num"></span><span class="text">${text}</span>`;

/** The editor that replaces a note while it is open. */
export const noteEditor = (): TemplateResult => html`
  <span class="num"></span>
  <div class="field">
    <label class="tf"><span class="lbl">Note</span><input aria-label="Note" placeholder="Add a note"></label>
    <div class="help">Enter saves · Esc discards</div>
  </div>
  <button class="ib del" data-tip="Delete mark" aria-label="Delete mark">${icon('delete')}</button>`;
