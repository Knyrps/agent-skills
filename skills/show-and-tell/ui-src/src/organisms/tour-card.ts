import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@m3e/web/button';
import '@m3e/web/card';
import '@m3e/web/progress-indicator';
import '../atoms/icons.js';
import { fire, type } from '../styles.js';

/** The current step of a tour, or a step label the agent set. Fires `sat-back` and `sat-next`. */
@customElement('sat-tour-card')
export class SatTourCard extends LitElement {
  static override styles = [type, css`
    :host { display: block; }
    m3e-card { --m3e-card-padding: 16px; }
    .content { display: flex; flex-direction: column; gap: 6px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; width: 100%; }
    m3e-linear-progress-indicator { display: block; width: 100%; }
    .text { white-space: pre-wrap; overflow-wrap: anywhere; }
  `];
  @property() label = '';
  @property() explanation = '';
  @property() status = '';
  /** The agent is working on the step: show the moving bar. */
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean, attribute: 'back-disabled' }) backDisabled = false;
  @property({ type: Boolean, attribute: 'next-disabled' }) nextDisabled = false;

  override render() {
    return html`<m3e-card variant="filled">
      <div slot="content" class="content">
        ${this.busy ? html`<m3e-linear-progress-indicator mode="indeterminate"></m3e-linear-progress-indicator>` : nothing}
        <div class="label-m muted">Current step</div>
        <div class="title-l text" id="step">${this.label || '—'}</div>
        ${this.explanation ? html`<div class="body-l text">${this.explanation}</div>` : nothing}
        ${this.status ? html`<div class="body-m muted">${this.status}</div>` : nothing}
      </div>
      <div slot="actions" class="actions">
        <m3e-button id="back" variant="outlined" ?disabled=${this.backDisabled} @click=${() => fire(this, 'sat-back')}>
          <m3e-icon slot="icon" name="arrow_back"></m3e-icon>Back</m3e-button>
        <m3e-button id="next" variant="filled" ?disabled=${this.nextDisabled} @click=${() => fire(this, 'sat-next')}>
          Next<m3e-icon slot="trailing-icon" name="arrow_forward"></m3e-icon></m3e-button>
      </div>
    </m3e-card>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-tour-card': SatTourCard; } }
