import { css } from 'lit';

/** The M3 type scale as classes, with the system font. Shared by every level. */
export const type = css`
  :host { font-family: system-ui, "Segoe UI", sans-serif; color: var(--md-sys-color-on-surface); -webkit-font-smoothing: antialiased; }
  .display-m { font: 400 45px/52px system-ui, "Segoe UI", sans-serif; }
  .headline-s { font: 400 24px/32px system-ui, "Segoe UI", sans-serif; }
  .title-l { font: 400 22px/28px system-ui, "Segoe UI", sans-serif; }
  .title-m { font: 500 16px/24px system-ui, "Segoe UI", sans-serif; letter-spacing: .15px; }
  .body-l { font: 400 16px/24px system-ui, "Segoe UI", sans-serif; letter-spacing: .5px; }
  .body-m { font: 400 14px/20px system-ui, "Segoe UI", sans-serif; letter-spacing: .25px; }
  .body-s { font: 400 12px/16px system-ui, "Segoe UI", sans-serif; letter-spacing: .4px; }
  .label-l { font: 500 14px/20px system-ui, "Segoe UI", sans-serif; letter-spacing: .1px; }
  .label-m { font: 500 12px/16px system-ui, "Segoe UI", sans-serif; letter-spacing: .5px; }
  .label-s { font: 500 11px/16px system-ui, "Segoe UI", sans-serif; letter-spacing: .5px; }
  .muted { color: var(--md-sys-color-on-surface-variant); }
  .row { display: flex; align-items: center; gap: 8px; }
  .grow { flex: 1; min-width: 0; }
  [hidden] { display: none !important; }
`;

/** Fires a typed event that crosses shadow roots, as every level below a page does. */
export function fire<T>(from: HTMLElement, name: string, detail?: T): void {
  from.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
