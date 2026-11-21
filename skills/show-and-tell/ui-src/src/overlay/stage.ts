// What a review video shows on top of the page: the intro, section and outro cards and the tab strip.
// stage.js owns the timing and the state; these are the templates it renders.
import { html, nothing } from 'lit-html';
import type { TemplateResult } from 'lit-html';
import { icon } from './icon.js';
import { ICON_PATHS } from './icon-paths.js';

export interface Branding { name?: string; logoData?: string; footer?: string; accent?: string }
export interface Card {
  kind?: 'intro' | 'section' | 'outro';
  kicker?: string;
  title?: string;
  subtitle?: string;
  chapters?: { time: string; title: string }[];
}
export interface TabChip {
  kind?: string;
  title?: string;
  url?: string;
  favicon?: string;
  tabs?: StripTab[];
}
export interface StripTab { title?: string; url?: string; favicon?: string; active?: boolean; new?: boolean; closing?: boolean; more?: boolean }

const logo = (b: Branding) => (b.logoData ? html`<img class="logo" alt="" src=${b.logoData}>` : nothing);

/** The content of a card. The logo is on the intro and the outro, the footer on the outro only. */
export function card(c: Card, b: Branding = {}): TemplateResult {
  if (c.kind === 'section') return html`<div class="kicker">${c.kicker || 'Section'}</div><h1 class="title">${c.title}</h1>`;
  if (c.kind === 'outro') {
    const chapters = c.chapters || [];
    return html`${logo(b)}<div class="kicker">${c.kicker || 'Thank you for watching'}</div><h1 class="title">${c.title}</h1>
      ${chapters.length ? html`<div class="list">${chapters.map(ch => html`<span class="tm">${ch.time}</span><span>${ch.title}</span>`)}</div>` : nothing}
      ${b.footer ? html`<div class="foot">${b.footer}</div>` : nothing}`;
  }
  return html`${logo(b)}<div class="kicker">${c.kicker || b.name || 'Review'}</div><h1 class="title">${c.title}</h1>
    ${c.subtitle ? html`<div class="sub">${c.subtitle}</div>` : nothing}`;
}

const favicon = (t: StripTab) => (t.favicon
  // A favicon that does not load gives way to the globe.
  ? html`<img class="ic" alt="" src=${t.favicon} @error=${(e: Event) => { (e.target as HTMLElement).replaceWith(globe()); }}>`
  : icon('public', 'ic'));
function globe(): SVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'ic'); s.setAttribute('viewBox', '0 -960 960 960');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICON_PATHS.public); s.append(p);
  return s;
}

/**
 * The video moved to another tab: a Chrome-style strip with the tab it came from and the one it is in
 * now; "⋯" stands for the tabs between or around them.
 */
export function tabStrip(t: TabChip): TemplateResult {
  const list: StripTab[] = t.tabs?.length ? t.tabs : [{ title: t.title, url: t.url, favicon: t.favicon, active: true }];
  return html`<span class="kind">${t.kind || 'New tab'}</span><span class="tabs">${list.map(x => (x.more
    ? html`<span class="tab off more" aria-hidden="true"><span class="t">⋯</span></span>`
    : html`<span class="tab ${x.active ? 'on' : 'off'}${x.new ? ' new' : ''}${x.closing ? ' closing' : ''}">${favicon(x)}<span class="t">${x.title || x.url || ''}</span>${icon('close', 'x')}</span>`))}</span>`;
}
