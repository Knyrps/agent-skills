// The in-page UI as one script for the content-script world: lit-html and the templates, on a global that
// content.js (highlights, Annotate) and stage.js (review videos) read. No custom elements here: a content
// script has none. Loaded before content.js, and injected again before stage.js; the second load is a no-op.
import { html, render } from 'lit-html';
import * as annotate from './annotate.js';
import { overlayStyles } from './overlay-styles.js';
import * as stage from './stage.js';
import { stageStyles } from './stage-styles.js';

const ui = {
  render, html,
  overlay: { styles: overlayStyles, toolbar: annotate.toolbar, note: annotate.note, noteEditor: annotate.noteEditor },
  stage: { styles: stageStyles, card: stage.card, tabStrip: stage.tabStrip },
};
export type ShowAndTellUI = typeof ui;

declare global { var __showAndTellUI: ShowAndTellUI | undefined; }
globalThis.__showAndTellUI ??= ui;
