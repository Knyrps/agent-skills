import { css } from 'lit';

/** The test page's styles. Its own elements render into the page, so this is one sheet the page adopts. */
export const styles = css`
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  /* Sideways swipes and wheels stay in the page instead of triggering Chrome's back/forward gesture. */
  html, body { overscroll-behavior: none; }
  body { margin: 0; background: var(--md-sys-color-surface); color: var(--md-sys-color-on-surface);
    font-family: system-ui, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  [hidden] { display: none !important; }
  m3e-theme, sat-lab-page { display: block; }
  sat-lab-page { min-height: 100vh; }
  sat-lab-gestures, sat-lab-controls { display: contents; }
  .title-m { font: 500 16px/24px system-ui, "Segoe UI", sans-serif; letter-spacing: .15px; }
  .body-l { font: 400 16px/24px system-ui, "Segoe UI", sans-serif; letter-spacing: .5px; }
  .body-m { font: 400 14px/20px system-ui, "Segoe UI", sans-serif; letter-spacing: .25px; }
  .body-s { font: 400 12px/16px system-ui, "Segoe UI", sans-serif; letter-spacing: .4px; }
  .label-l { font: 500 14px/20px system-ui, "Segoe UI", sans-serif; letter-spacing: .1px; }
  .muted { color: var(--md-sys-color-on-surface-variant); }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .grow { flex: 1; min-width: 0; }

  /* Layout: a sticky app bar, the cards in four columns, the debug side sheet at the right. */
  header { position: sticky; top: 0; z-index: 5; padding: 0 12px; background: var(--md-sys-color-surface); }
  header .trailing { display: flex; align-items: center; gap: 4px; }
  header a { display: inline-flex; align-items: center; gap: 4px; padding: 0 12px; color: var(--md-sys-color-primary); text-decoration: none; }
  header a m3e-icon { --m3e-icon-size: 18px; }
  .lab-body { display: flex; align-items: flex-start; }
  main { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding: 12px 20px 20px; }
  @media (max-width: 720px) { main { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

  /* Cards. A card that reacted takes the secondary container. */
  .box { --m3e-card-padding: 16px; min-width: 0; user-select: none; touch-action: none; }
  .box.wide { grid-column: span 2; }
  .box.ok { --m3e-filled-card-container-color: var(--md-sys-color-secondary-container);
    --m3e-filled-card-text-color: var(--md-sys-color-on-secondary-container);
    --m3e-outlined-card-container-color: var(--md-sys-color-secondary-container); }
  .lab-card { display: flex; flex-direction: column; gap: 6px; min-width: 0; min-height: 92px; }
  .lab-card h3 { margin: 0; }
  .state { color: var(--md-sys-color-on-surface-variant); }
  .ok .state { color: inherit; }
  .lab-card m3e-form-field { display: block; width: 100%; min-width: 0; }
  .lab-card input { min-width: 0; width: 100%; }
  /* The slider shrinks with its card, and its inactive track stands out from both card colours
     (its default, secondary-container, is the colour of a card that has reacted). */
  .lab-card m3e-slider { width: 100%; --m3e-slider-min-width: 0;
    --m3e-slider-inactive-track-color: var(--md-sys-color-outline-variant);
    --m3e-slider-tick-inactive-color: var(--md-sys-color-on-surface-variant); }
  .check { display: flex; align-items: center; gap: 4px; cursor: pointer; }

  .zoom { align-self: center; color: var(--md-sys-color-on-surface-variant); transition: transform .05s; --m3e-icon-size: 28px; }
  #pinch { overflow: hidden; }
  .strip { display: flex; gap: 8px; overflow-x: auto; padding: 4px 0; scroll-behavior: auto; touch-action: pan-x; scrollbar-width: thin; }
  .item { flex: none; width: 136px; height: 80px; --m3e-card-padding: 16px; --m3e-outlined-card-container-color: var(--md-sys-color-surface-container-low); }
  .item [slot="content"] { height: 100%; display: grid; place-items: center; }
  /* The box keeps its place above the cards while a finger drags it (translate). */
  #drag { position: relative; z-index: 2; cursor: grab; }
  #drop { --m3e-outlined-card-outline-color: var(--md-sys-color-outline); }
  #drop.over { --m3e-outlined-card-outline-color: var(--md-sys-color-primary);
    --m3e-outlined-card-container-color: var(--md-sys-color-primary-container); }
  #hover:hover { --m3e-filled-card-container-color: var(--md-sys-color-tertiary-container);
    --m3e-filled-card-text-color: var(--md-sys-color-on-tertiary-container); }
  #scr { height: 72px; overflow: auto; touch-action: pan-y; border-radius: 8px; background: var(--md-sys-color-surface-container-low); }
  #scr > div { height: 500px; }
  #items { margin: 0; padding-left: 20px; }
  #items:empty { display: none; }
  #menu-anchor { position: fixed; width: 0; height: 0; }

  /* The log: monospace lines on a container; raw events are quieter. */
  sat-lab-log { grid-column: 1 / -1; display: block; height: 160px; overflow: auto; padding: 10px 14px; border-radius: 12px;
    background: var(--md-sys-color-surface-container); color: var(--md-sys-color-on-surface);
    font: 12px/18px ui-monospace, Consolas, monospace; }
  sat-lab-log .raw { color: var(--md-sys-color-on-surface-variant); }

  /* Debug options: a standard side sheet (M3 has no component for it in M3E): docked at the right, it stays
     in view while the page scrolls; below 900 px it floats over the cards. Everything inside is stock M3E. */
  sat-lab-debug { position: sticky; top: 72px; flex: none; display: block; width: 360px; height: calc(100vh - 84px);
    margin: 0 12px 12px 0; }
  .sheet { display: flex; flex-direction: column; height: 100%; border-radius: 16px; overflow: hidden;
    background: var(--md-sys-color-surface-container-low); color: var(--md-sys-color-on-surface); }
  .sheet-head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 4px 24px; }
  .sheet-body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 8px 24px 24px;
    scrollbar-width: thin; }
  .sheet m3e-segmented-button { width: 100%; }
  .switch-row { display: flex; align-items: center; gap: 16px; cursor: pointer; }
  .switch-row .txt, .raw-head { display: flex; flex-direction: column; }
  .raw-head { flex-direction: row; align-items: baseline; gap: 8px; }
  .sheet m3e-form-field { display: block; width: 100%; }
  .sheet input { min-width: 0; width: 100%; }
  .sheet .actions { margin: -16px -12px -4px; }
  #ev-list { display: flex; flex-direction: column; gap: 16px; }
  .group-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .title-s { font: 500 14px/20px system-ui, "Segoe UI", sans-serif; letter-spacing: .1px; }
  .title-l { font: 400 22px/28px system-ui, "Segoe UI", sans-serif; }
  .empty { margin: 0; }
  @media (max-width: 900px) { sat-lab-debug { position: fixed; top: 72px; right: 0; z-index: 6; max-width: calc(100vw - 24px);
    box-shadow: 0 2px 6px 2px rgb(0 0 0 / .15), 0 1px 2px rgb(0 0 0 / .3); border-radius: 16px; } }
`;
