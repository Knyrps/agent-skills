import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@m3e/web/button';
import '@m3e/web/card';
import '@m3e/web/progress-indicator';
import '../atoms/icons.js';
import { fire, type } from '../styles.js';
import type { VideoView } from '../types.js';

/**
 * A review video being recorded: preparing, the 3-2-1 countdown, recording, saving.
 * Fires `sat-video-stop` and `sat-video-discard`.
 */
@customElement('sat-video-card')
export class SatVideoCard extends LitElement {
  static override styles = [type, css`
    :host { display: block; }
    m3e-card { --m3e-card-padding: 16px; }
    .content { display: flex; flex-direction: column; gap: 6px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; width: 100%; }
    .bar { padding: 8px 0 6px; }
    m3e-linear-progress-indicator { display: block; width: 100%; }
    .count { display: flex; align-items: center; gap: 16px; padding: 8px 0; }
    m3e-circular-progress-indicator { flex: none; --m3e-circular-wavy-progress-indicator-diameter: 64px; --m3e-circular-flat-progress-indicator-diameter: 64px; }
    .rec { color: var(--md-sys-color-error); --m3e-icon-size: 18px; }
    .lock { --m3e-icon-size: 16px; }
    .text { white-space: pre-wrap; overflow-wrap: anywhere; }
  `];
  @property({ attribute: false }) video: VideoView | null = null;
  /** "3/9 – Pay with a saved card": the step on camera, when it has a label. */
  @property() label = '';
  @property() explanation = '';

  override render() {
    const v = this.video;
    if (!v) return nothing;
    const saving = v.state === 'finishing';
    return html`<m3e-card variant="filled">
      <div slot="content" class="content">
        <div class="label-m muted">Video recording</div>
        ${this.label ? html`<div class="title-l text" id="step">${this.label}</div>` : nothing}
        ${this.explanation ? html`<div class="body-l text">${this.explanation}</div>` : nothing}
        ${v.state === 'countdown' ? html`<div class="count">
            <m3e-circular-progress-indicator variant="wavy" value=${((4 - (v.count ?? 3)) / 3) * 100}><span class="title-l" id="countdown">${v.count ?? ''}</span></m3e-circular-progress-indicator>
            <div class="body-m muted grow">Recording starts. Keep your hands off the page.</div>
          </div>` : nothing}
        ${v.state === 'starting' || saving ? html`<div class="bar"><m3e-linear-progress-indicator mode="indeterminate"></m3e-linear-progress-indicator></div>
          <div class="body-m">${saving ? 'Saving the video…' : 'Preparing the recording…'}</div>` : nothing}
        ${v.state === 'recording' ? html`<div class="bar"><m3e-linear-progress-indicator variant="wavy" value=${((v.step + 1) / Math.max(1, v.steps)) * 100}></m3e-linear-progress-indicator></div>
          <div class="row body-m"><m3e-icon class="rec" name="radio_button_checked" filled></m3e-icon><span>Recording ${v.width}×${v.height} · step ${v.step + 1} of ${v.steps}</span></div>` : nothing}
        ${saving ? nothing : html`<div class="row body-s muted"><m3e-icon class="lock" name="lock"></m3e-icon><span>The window size is locked until the video is done.</span></div>`}
      </div>
      <div slot="actions" class="actions">
        <m3e-button id="video-discard" variant="outlined" ?disabled=${saving} @click=${() => fire(this, 'sat-video-discard')}>
          <m3e-icon slot="icon" name="delete"></m3e-icon>Discard</m3e-button>
        <m3e-button id="video-stop" variant="filled" ?disabled=${saving} @click=${() => fire(this, 'sat-video-stop')}>
          <m3e-icon slot="icon" name="stop"></m3e-icon>Stop and save</m3e-button>
      </div>
    </m3e-card>`;
  }
}

declare global { interface HTMLElementTagNameMap { 'sat-video-card': SatVideoCard; } }
