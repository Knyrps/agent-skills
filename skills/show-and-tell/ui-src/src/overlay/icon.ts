import { svg } from 'lit-html';
import type { TemplateResult } from 'lit-html';
import { ICON_PATHS } from './icon-paths.js';

export type IconName = keyof typeof ICON_PATHS;

/** A Material Symbol as inline SVG, coloured by `currentColor`. */
export const icon = (name: IconName, cls = ''): TemplateResult =>
  svg`<svg class=${cls} viewBox="0 -960 960 960" aria-hidden="true"><path d=${ICON_PATHS[name]}></path></svg>` as unknown as TemplateResult;
