# show-and-tell: rules for working on the UI

The UI is being rewritten to Material 3 Expressive (Lit + `@m3e/web`, TypeScript). `REWRITE-PLAN.md` has the
steps and their order. This file has the rules that hold while doing them and afterwards.

## Where things are

| Path | What |
|---|---|
| `ui-src/` | UI source (TypeScript). `npm run build` writes `extension/ui/<page>.js`; `npm run check` type-checks |
| `ui-src/src/atoms/` … `pages/` | Atomic design levels, see below |
| `extension/ui/` | Built bundles, committed. The extension runs without a build step |
| `ui-src/src/lab/` | The test page (same levels), built to `scripts/lab-vendor/lab.js`, not minified; `scripts/lab.mjs` serves it |
| `vendor-src/build.mjs` | Colour tokens (`npm run tokens`) |
| `extension/vendor/m3-tokens.css` | Generated colour roles, light and dark. Never edit by hand |
| `tests/` | `node tests/run.mjs` runs the checks on a throwaway copy with its own ports and profile. They describe the old UI until they are rewritten after the rewrite |

## Atomic design

- **Atoms**: `@m3e/web` elements, plus own ones (`sat-app-icon`, status dot).
- **Molecules**: e.g. listen status, attachment chip.
- **Organisms**: app bar, tour card, video card, pause card, throttle card, notice, host question,
  conversation, composer.
- **Templates**: the panel layout.
- **Pages**: panel, small pages, test page.

Rules:

- Imports only point downward. No organism imports another organism's internals.
- Only pages touch `chrome.*`, storage and messaging. Everything below takes properties and fires typed
  `CustomEvent`s (`bubbles: true, composed: true`).
- Own elements are prefixed `sat-`.
- Styling uses tokens only (`--md-sys-*`, `--session`). No literal colours or radii in components.
- The panel and the test page share the tokens and nothing else.
- In content scripts the levels are template functions (`atoms/callout.ts` returning `` html`…` ``), with
  the same downward-only rule.

## Content scripts cannot use custom elements

Content scripts run in Chrome's isolated world, where `customElements` is `null`. So the in-page overlay
(`content.js`) and the video stage (`stage.js`) use `lit-html`'s `render()` only: no `LitElement`, no
`@m3e/web`. Their controls (annotate toolbar, note editor, captions, cards) are own templates that look
like the M3E ones and use the same tokens. Per-frame position updates stay direct style writes.

## Design decisions

- **Colours: warm paper and ink.** Surfaces and containers are tonal spot from the seed `#8a6a4a`. The
  primary is black, white in dark, from the monochrome scheme. `m3e-theme` gives motion and shape only;
  it does not generate colours.
- **The session's colour is the only strong colour.** The app icon in the panel header, the icons next
  to the agent's messages and the status dot take the colour of the tab group of the session in front
  (`--session`). With no session they take the primary colour. The toolbar icon stays the fixed
  `icons/icon.svg`.
- **Icons** come from `@m3e/icons` (SVG, one import per icon), never from a font download. The app icon
  is the one own drawing.
- **The chat input** is a custom container: a 28px pill on `surface-container-high` with a
  borderless field. The buttons inside it are stock `m3e-button` / `m3e-icon-button`.
- **The test page's debug options** are the other one: a standard side sheet (M3E has none) docked at the
  right and sticky, on `surface-container-low`. Inside it everything is stock M3E: search field, segmented
  button, switch, filter chips. Not `m3e-drawer-container`: it scrolls its content itself, and the test
  page must keep document scrolling. Not a menu: stacked submenus were rejected.
- **Narrow panel**: below about 340px wide the panel uses smaller buttons and tighter padding, by
  container query.
- **Font**: `system-ui, "Segoe UI", sans-serif`. No bundled font.

## Things `@m3e/web` does that cost time once

- Static text inside `m3e-toolbar` sits under the toolbar's state layer unless it is positioned
  (`position: relative`).
- An indeterminate straight progress bar is `mode="indeterminate"`; only the circular one takes an
  `indeterminate` attribute.
- `m3e-form-field` and a plain `<input>` inside it do not shrink by themselves: give them a width.
- Snackbars (`M3eSnackbar.open`) open in the top layer, outside any wrapper: tokens and font must be on
  `:root`.
  They sit `--m3e-snackbar-margin` above the bottom (16px by default), over the composer's buttons: the
  panel keeps that margin at the composer's height plus 8px.
- Buttons have an invisible 48px touch area that is larger than their box. It is not an overflow bug.
- `m3e-menu-trigger for="…"` looks its menu up once, when it first renders: the menu must already be in the DOM.
- A menu item's `trailing-icon` slot is a 20px icon box (`!important`), and a submenu item uses it for its
  arrow: put counts or text in the label.
- `m3e-slider` has a minimum width: set `--m3e-slider-min-width: 0` inside narrow cards. Its inactive track
  is `secondary-container`, the colour of a card that has reacted: the test page uses `outline-variant`.
- Checked menu items and the like use `tertiary-container`, which is lime in this palette: point their
  `selected-container` tokens at `secondary-container`.

## Tests

- `node tests/run.mjs [name] [--keep|--clean]` runs `tests/*.test.mjs` on a throwaway copy with its own ports and
  profile; it needs `npm install` in `bridge/`. `ui` covers what the rewrite added (test page cards and debug
  sheet, slider, Annotate toolbar, session colour); `pause`, `pause-menu`, `pause-orphan` and `readme-rows`
  cover pausing and the pause card.
- `node scripts/real-input-check.mjs` drives the test page and the panel with real input (CDP `Input.*`).
- The panel and the test page are web components: tests find elements with `$d` / `$$d` (from `tests/lib.mjs`),
  which look through shadow roots. The Annotate overlay's root is closed: find its buttons with
  `DOM.getDocument({ pierce: true })` and their `data-tool` / `data-act` attributes.
- Test hooks are plain ids and `data-*` attributes (`#pause-more`, `[data-do="again"]`, `#listen-text`, …). Keep
  them where they cost nothing; do not bend the design to keep them.
- Never use the user's running browser. Do not reload the extension there without asking.

## Commits

- One commit per step of the plan, directly on `main`. No attribution lines in commit messages.
