# demonstrate

Guided UI tours for an AI coding agent (OpenCode). The agent drives a browser through the Playwright
MCP. The user watches the same browser and answers in the **demonstrate side panel** with Zurück,
Weiter, Markieren (point at things), Zeig ich dir (record what you do) and a question field. The agent can also draw highlights around page elements.

```
OpenCode ──stdio──> bridge (MCP)  ──HTTP 127.0.0.1:47613──<  `node bridge wait` (background job)
                        │ WebSocket /ext (Origin = extension only)
                        ▼
              Chrome for Testing  (CDP 127.0.0.1:9334, profile %LOCALAPPDATA%\demonstrate\profile)
              ├─ extension: side panel (browser UI) + in-page highlight/picker layer
              └─ playwright-demo MCP attaches via --cdp-endpoint (lazily, on its first call)
```

| Path | What |
| --- | --- |
| `scripts/browser.mjs` | `start` / `stop` / `status` / `panel` for the demo browser |
| `extension/` | MV3 extension: side panel (Material Web), service worker (bridge socket and outbox), content script (highlights, picker) |
| `extension/config.json` | Host allowlist and bridge URL |
| `bridge/` | MCP server, bridge server, and CLI (`index.js`). Its only dependency is `@modelcontextprotocol/sdk` |
| `config/opencode.snippet.jsonc` | OpenCode config for the `demonstrate` and `playwright-demo` MCP servers |
| `vendor-src/` | Rebuilds `extension/vendor/` (Material Web bundle, M3 color tokens). Not needed at runtime |

## Why Chrome for Testing

Branded Chrome (since v137) ignores `--load-extension`, so the extension would need a manual "Load
unpacked" per profile. Chrome for Testing, the Chromium build Playwright installs, still honours the
flag. (Edge also honours it today; set `DEMO_BROWSER_PATH` to `msedge.exe` to use Edge.) The
Playwright MCP doesn't care which binary it is: with `--cdp-endpoint` it attaches to whatever
Chromium is listening on that port.

## Install

```pwsh
cd $HOME\.agents\skills\demonstrate\bridge
npm i
npx playwright install chromium    # only if %LOCALAPPDATA%\ms-playwright\chromium-* is missing
```

Merge `config/opencode.snippet.jsonc` into `~/.config/opencode/opencode.jsonc`. It adds
`demonstrate` and a second Playwright server, `playwright-demo`, on `--cdp-endpoint
http://127.0.0.1:9334`. The normal `playwright` server stays untouched and keeps launching its own
browser, so nothing has to be started by hand for either. OpenCode reloads its config on save.

Environment overrides: `DEMO_BROWSER_PATH`, `DEMO_CDP_PORT` (9334), `DEMO_PROFILE`,
`DEMO_BRIDGE_PORT` (47613), `DEMO_DATA` (queue + element screenshots, default
`%LOCALAPPDATA%\demonstrate`).

Allowlist: edit `extension/config.json` (`"localhost"`, `"*.dev.local"` = host and all subdomains),
then restart the browser (`browser.mjs stop`, then `start`).

## First start

```pwsh
$D = "$HOME\.agents\skills\demonstrate"
node "$D\bridge" start   # expect "bridge": { "extensionConnected": true, "panelOpen": true }
```

In OpenCode the agent does the same through the `start_browser` tool. `set_step`, `highlight`,
`clear_highlights` and `hide_overlays` also start the browser if it is not running.

When OpenCode runs the demonstrate MCP, that process owns the bridge port. Without OpenCode, run
`node "$D\bridge" serve` in a second terminal.

## Manual test of every control

Open any page on `http://localhost:<port>/` in the demo browser, then:

| Test | Do | Expect |
| --- | --- | --- |
| Weiter | `node "$D\bridge" wait --timeout 60`, then click **Weiter** | Panel shows "Der Agent wartet auf dich." The CLI prints `{"actions":[{"type":"next",…}]}` |
| Zurück | Same, click **Zurück** | `"type":"back"` |
| Frage | Same, type a question, press Enter | `"type":"question","text":"…"` |
| Markieren | `wait`, click **Markieren**, hover (dashed outline) and click one element, drag a frame, scroll the page and an inner scroll area with the wheel, switch to the arrow and drag one inside the scroll area (Enter after each note), click a number circle to add or change its note (Esc restores it, the bin deletes the mark), **Fertig**, type a question, **Senden**. Esc instead of Fertig cancels, Ctrl+Z undoes | Clicks don't reach the page. Marks keep a colour and number each, stay on their content while scrolling, and are clipped to their scroll area. A "Markierung · N" chip appears and the drawing disappears. Output is one `"type":"annotation"` action with `annotations[]` (document coordinates, `color`, note, `elements[]` labelled 1a, 1b …), `imageArea`, `imagePath` (all marks, also those scrolled out of view) and `labelledImagePath` (plus dashed element outlines, for the model only). No "being debugged" bar appears |
| request_demo | `node "$D\bridge" request "Zeig mir die Suche"`, then `wait`, act in the page, **Aufnahme beenden**, **Senden** | The panel shows the request card and recording starts by itself. Output is a `recording` action with `requestId` and `prompt`. **Verwerfen** instead gives `demoDeclined` |
| Zeig ich dir | `wait`, click **Zeig ich dir**, click/type/select/swipe/scroll in the page, follow a link, click **Aufnahme beenden**, type a question next to the "Aufnahme · N Schritte" chip, click **Senden** | The page reacts normally and the panel counts steps. Output is one `"type":"recording"` action: `recording.steps` (Recorder format plus `swipe`/`urlChange`) across both pages, passwords as `•••`, the comment in `text`. **Verwerfen** (while recording) or the chip's × drops it |
| Step label | `node "$D\bridge" step "2/5 – Test"` | Panel shows the label |
| Highlight | `node "$D\bridge" highlight h1 --label "Titel" --style spotlight` | Blue ring and callout, rest of the page dimmed. Output `"found": true` |
| Hide/show | `node "$D\bridge" hide`, then `show` | Highlights disappear and come back |
| Clear | `node "$D\bridge" clear` | Highlights removed |
| Buffering | Stop the bridge, click **Weiter**, start the bridge, run `wait` | The buffered `next` is delivered |
| Allowlist | Open `http://127.0.0.1:<port>/` | Panel shows the "nicht freigegeben" notice. `highlight` returns an error |
| Cancel | `wait` in one terminal, `node "$D\bridge" cancel` in another | The wait prints `{"actions":[],"cancelled":true}` |

## Verify playwright-demo drives this browser

1. Start the browser and open `http://localhost:<port>/` in it by hand.
2. In OpenCode, ask the agent to run `browser_tabs` (list) on **playwright-demo**.
3. The list must contain your localhost tab and `chrome-extension://jedpjgmldnhcfdejimlabhppmffdijei/panel.html`.
   `node "$D\scripts\browser.mjs" status` lists the same pages.
4. Have the agent navigate the localhost tab with playwright-demo. The page must change in the window
   you are watching.

`ECONNREFUSED 127.0.0.1:9334` means the demo browser is not running: call `start_browser` and retry.
A separate window with an empty `about:blank` means the agent used the plain `playwright` server.

## Rebuild the vendored UI library

```pwsh
cd $HOME\.agents\skills\demonstrate\vendor-src
npm i
npm run build   # writes extension/vendor/material-web.js and m3-tokens.css
```
