# Findings

Research notes from the review of show-and-tell. They informed the fixes; they are not plans.

## Loading the extension without `--load-extension`

- Branded Chrome ignores `--load-extension` since version 137 ("--load-extension is not allowed in Google
  Chrome, ignoring"). Chrome for Testing and Chromium still accept it; that is why `scripts/browser.mjs` launches
  Chrome for Testing (Playwright's build).
- The supported replacement is the CDP command `Extensions.loadUnpacked`. It needs both
  `--enable-unsafe-extension-debugging` and `--remote-debugging-pipe`; it is not offered over
  `--remote-debugging-port`. With a pipe, the bridge would have to own the browser's stdin/stdout, and a
  browser restored by the user (not started by the bridge) would have no pipe.
- The `--disable-features=DisableLoadExtensionCommandLineSwitch` workaround was a temporary escape hatch and
  should not be relied on.
- Conclusion: keep Chrome for Testing with `--load-extension`. Should it stop working there, switch the launch
  to a pipe plus `Extensions.loadUnpacked`, which the bridge can do since it starts the browser.

Sources: chromium-extensions PSA "Removing --load-extension flag in Chrome branded builds";
developer.chrome.com CDP `Extensions` domain; bitcrowd.dev "Loading Chrome extensions for development in 2025".

## Panel replies

- Not measured: there is no usage data on how often users answer in the panel instead of the chat. In the manual
  test the reply area was used for host questions, pause cards and short notes on annotations; longer requests
  went to the chat.
- Kept as is (the panel stays a conversation). The fixes that make it easier to use were made instead: the host
  question scrolls into view, the Thinking loader shows the session's colour.

## Pausing on real sites

Probed on github.com, developer.mozilla.org and wikipedia.org (`tests/probe-pause.mjs`, not part of the suite):

- DOM pauses (`on: 'dom', selector: 'body'`) were set on every site.
- Line pauses by code text worked, but the old matching had three problems on minified bundles:
  - The code shown for each match was the start of the line, which in a bundle is the start of the file, so
    the agent could not tell the matches apart. Each match now shows the code around it.
  - Matches on the same line could not be picked: only `line` was compared. `column` now picks too.
  - Text written with spaces (`var b = a + 1`) was not found in minified code (`var b=a+1`). The search now
    retries with any spacing between tokens and says so.
- Common calls (`addEventListener(`, `JSON.parse(`) occur 5 to 20+ times per site, so a pause by text needs
  something specific. Local names are mangled; strings, property and method names survive. The not-found
  message now says this and points to request or DOM pauses.

## Annotation accuracy

- A frame drawn around a visible element also listed elements whose boxes fell inside it but which the user
  could not see: cards scrolled out of a carousel ("Product 7", "Product 8" next to "Drop here").
- Fixed: a frame lists only elements of which at least half shows, after clipping by every scrolling or
  clipping ancestor and the window, and which are not covered by another element.
