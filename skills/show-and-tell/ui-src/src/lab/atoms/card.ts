import { html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import '@m3e/web/card';

export interface CardState { text: string; ok: boolean }
export interface CardOptions { id: string; title: string; state?: CardState; wide?: boolean; outlined?: boolean }

/** One card of the test page: a title, what happened to it last, and its control. `ok` tints it once it reacted. */
export const card = (o: CardOptions, control: unknown = nothing): TemplateResult => html`
  <m3e-card id=${o.id} variant=${o.outlined ? 'outlined' : 'filled'} class="box ${o.wide ? 'wide' : ''} ${o.state?.ok ? 'ok' : ''}">
    <div slot="content" class="lab-card">
      <h3 class="title-m">${o.title}</h3>
      ${o.state ? html`<div class="state body-m">${o.state.text}</div>` : nothing}
      ${control}
    </div>
  </m3e-card>`;

/** Mixin-free helper for organisms made of cards: the state line of each card, by card id. */
export class CardStates {
  private states = new Map<string, CardState>();
  constructor(private host: { requestUpdate(): void }, initial: Record<string, string>) {
    for (const [id, text] of Object.entries(initial)) this.states.set(id, { text, ok: false });
  }
  get(id: string): CardState { return this.states.get(id)!; }
  set(id: string, text: string, ok = true): void {
    this.states.set(id, { text, ok: ok || this.states.get(id)!.ok });
    this.host.requestUpdate();
  }
}
