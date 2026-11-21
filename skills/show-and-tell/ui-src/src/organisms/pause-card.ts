import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@m3e/web/button';
import '@m3e/web/callout';
import '@m3e/web/divider';
import '@m3e/web/icon-button';
import '@m3e/web/menu';
import '@m3e/web/split-button';
import '../atoms/icons.js';
import { fire, type } from '../styles.js';
import type { PauseChoice, PauseState } from '../types.js';

/**
 * The agent's pause points in the tab in front: the page stopped at one (Resume, with the other ways to
 * go on in a menu when there is a breakpoint), requests held back (Release), or points that are set and
 * waiting (Remove). Fires `sat-pause` with the choice.
 */
@customElement('sat-pause-card')
export class SatPauseCard extends LitElement {
  static override styles = [type, css`
    :host { display: block; }
    m3e-callout { display: block; }
    .detail { overflow-wrap: anywhere; white-space: pre-line; }
    .actions { display: flex; justify-content: flex-end; margin-top: 4px; }
  `];
  @property({ reflect: true }) state: PauseState = 'armed';
  @property() heading = '';
  @property() detail = '';
  /** Paused at a breakpoint: the menu has something to act on. */
  @property({ type: Boolean, attribute: 'has-point' }) hasPoint = false;
  /** The breakpoint stays set after this stop, so "resume and remove" makes sense. */
  @property({ type: Boolean }) kept = false;

  private choose(what: PauseChoice) { fire<PauseChoice>(this, 'sat-pause', what); }

  private actions() {
    if (this.state === 'held') return html`<m3e-button id="pause-action" variant="filled" size="small" @click=${() => this.choose('held')}>Release</m3e-button>`;
    if (this.state === 'armed') return html`<m3e-button id="pause-action" variant="text" size="small" @click=${() => this.choose('armed')}>Remove</m3e-button>`;
    const resume = html`<m3e-icon slot="icon" name="play_arrow"></m3e-icon>Resume`;
    if (!this.hasPoint) return html`<m3e-button id="pause-resume" variant="filled" size="small" @click=${() => this.choose('resume')}>${resume}</m3e-button>`;
    return html`<m3e-split-button id="pause-split" variant="filled" size="small">
        <m3e-button id="pause-resume" slot="leading-button" @click=${() => this.choose('resume')}>${resume}</m3e-button>
        <m3e-icon-button id="pause-more" slot="trailing-button" aria-label="More ways to continue" title="More ways to continue">
          <m3e-icon name="keyboard_arrow_down"></m3e-icon>
          <m3e-menu-trigger for="pause-menu"></m3e-menu-trigger>
        </m3e-icon-button>
      </m3e-split-button>
      <m3e-menu id="pause-menu" position-x="before">
        ${this.kept ? html`<m3e-menu-item id="pause-remove" @click=${() => this.choose('remove')}>Resume and remove breakpoint</m3e-menu-item>
          <m3e-divider></m3e-divider>` : nothing}
        <m3e-menu-item @click=${() => this.choose('again')}>Reload to breakpoint</m3e-menu-item>
        <m3e-menu-item @click=${() => this.choose('skip')}>Reload and ignore breakpoint once</m3e-menu-item>
        <m3e-menu-item @click=${() => this.choose('drop')}>Reload and remove breakpoint</m3e-menu-item>
      </m3e-menu>`;
  }

  override render() {
    const icon = this.state === 'paused' ? 'pause' : this.state === 'held' ? 'hourglass_top' : 'pause_circle';
    return html`<m3e-callout variant=${this.state === 'armed' ? 'secondary' : 'primary'} role="status">
      <m3e-icon slot="icon" name=${icon}></m3e-icon>
      <span slot="label" id="pause-title">${this.heading}</span>
      <span class="detail" id="pause-detail">${this.detail}</span>
      <div class="actions">${this.actions()}</div>
    </m3e-callout>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-pause-card': SatPauseCard; } }
