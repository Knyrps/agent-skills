# demonstrate

Guided UI tours for an AI coding agent. The agent drives a browser through the Playwright MCP. You
watch the same browser and answer in the **demonstrate side panel**:

- **Back / Next** step through the tour.
- **Annotate** lets you point at things: click an element to mark it, or drag a frame, an arrow or a
  pen stroke, each with an optional note.
- **Record** captures what you do in the page (clicks, typing, keys, scrolling, swipes, navigation).
- A **question field** sends a question, with the annotation or recording attached.

The agent can also draw highlights around page elements, and ask you to show it something
(`request_demo`).

```
agent ──stdio──> bridge (MCP)  ──HTTP 127.0.0.1:47613──<  `node bridge wait` (background job)
                     │ WebSocket /ext (Origin = extension only)
                     ▼
           Chrome for Testing  (CDP 127.0.0.1:9334, own profile)
           ├─ extension: side panel (browser UI) + in-page highlight, annotation and recorder layer
           └─ playwright-demo MCP attaches via --cdp-endpoint (lazily, on its first call)
```

| Path | What |
| --- | --- |
| `SKILL.md` | Instructions for the agent |
| `scripts/browser.mjs` | `start` / `stop` / `status` / `panel` for the demo browser |
| `extension/` | MV3 extension: side panel (Material Web), service worker (bridge socket, outbox, capture), content script (highlights, annotation, recorder) |
| `extension/config.json` | Host allowlist and bridge URL |
| `bridge/` | MCP server, bridge server and CLI (`index.js`). Its only dependency is `@modelcontextprotocol/sdk` |
| `config/` | MCP config snippets per agent host |
| `vendor-src/` | Rebuilds `extension/vendor/` (Material Web bundle, M3 colour tokens). Not needed at runtime |

Works on Windows, macOS and Linux with Node.js 18 or newer.

## Why Chrome for Testing

Branded Chrome (since v137) ignores `--load-extension`, so the extension would need a manual "Load
unpacked" per profile. Chrome for Testing, the Chromium build Playwright installs, still honours the
flag. The Playwright MCP doesn't care which binary it is: with `--cdp-endpoint` it attaches to
whatever Chromium is listening on that port.

## Install

`<skill>` is the folder that contains this README.

1. **Dependencies and browser**

   ```sh
   cd <skill>/bridge
   npm install
   npx playwright install chromium   # skip if Playwright's Chromium is already installed
   ```

2. **Skill.** Make `<skill>` visible in your agent's skills folder: clone or copy it there, or link it
   (symlink on macOS/Linux, `New-Item -ItemType Junction` on Windows). Common locations:

   | Agent | Personal skills folder |
   | --- | --- |
   | Claude Code | `~/.claude/skills/demonstrate` |
   | OpenCode | `~/.config/opencode/skills/demonstrate` (also reads `~/.claude/skills` and `~/.agents/skills`) |
   | VS Code (GitHub Copilot agent mode) | `~/.copilot/skills/demonstrate`, or `.github/skills/demonstrate` in a project |
   | Codex CLI | `~/.codex/skills/demonstrate` |

   Hosts change these paths now and then; the host's own docs win.

3. **MCP servers.** Register two stdio servers in the agent host:
   - `demonstrate`: `node <skill>/bridge/index.js`
   - `playwright-demo`: `npx -y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9334 --ignore-https-errors`

   Ready-made snippets for OpenCode, Claude Code, VS Code and Codex are in `config/`. Keep any existing
   `playwright` server as it is: it launches its own browser, while `playwright-demo` attaches to the
   demo browser.

4. **Allowlist.** The panel, highlights, annotation and recording only work on hosts listed in
   `extension/config.json` (default `localhost` and `*.dev.local`; `*.example.com` = that host and all
   subdomains). Add your dev hosts, then restart the browser (`node <skill>/scripts/browser.mjs stop`,
   then `start`).

Environment overrides: `DEMO_BROWSER_PATH` (any Chromium that honours `--load-extension`, for
example Edge), `DEMO_CDP_PORT` (9334), `DEMO_PROFILE`, `DEMO_BRIDGE_PORT` (47613), `DEMO_DATA`
(queue, screenshots and profile; default `%LOCALAPPDATA%\demonstrate` on Windows,
`~/Library/Application Support/demonstrate` on macOS, `~/.local/share/demonstrate` on Linux).

## First start

```sh
node <skill>/bridge start   # expect "bridge": { "extensionConnected": true, "panelOpen": true }
```

The agent does the same through the `start_browser` tool. `set_step`, `highlight`, `clear_highlights`
and `hide_overlays` also start the browser if it is not running. If the side panel doesn't open by
itself, click the demonstrate icon in the toolbar (puzzle menu).

When the agent host runs the demonstrate MCP, that process owns the bridge port. Without an agent, run
`node <skill>/bridge serve` in a second terminal.

## Manual test of every control

Open any page on `http://localhost:<port>/` in the demo browser, then:

| Test | Do | Expect |
| --- | --- | --- |
| Next | `node <skill>/bridge wait --timeout 60`, then click **Next** | Panel shows "The agent is waiting for you." The CLI prints `{"actions":[{"type":"next",…}]}` |
| Back | Same, click **Back** | `"type":"back"` |
| Question | Same, type a question, press Enter | `"type":"question","text":"…"` |
| Annotate | `wait`, click **Annotate**, hover (dashed outline) and click one element, drag a frame, scroll the page and an inner scroll area with the wheel, switch to the arrow and drag one inside the scroll area (Enter after each note), click a number circle to add or change its note (Esc restores it, the bin deletes the mark), **Done**, type a question, **Send**. Esc instead of Done cancels, Ctrl+Z undoes | Clicks don't reach the page. Each mark has its own colour and number, stays on its content while scrolling, and is clipped to its scroll area. An "Annotation · N" chip appears and the drawing disappears. Output is one `"type":"annotation"` action with `annotations[]` (document coordinates, `color`, note, `elements[]` labelled 1a, 1b …), `imageArea`, `imagePath` (all marks, also those scrolled out of view) and `labelledImagePath` (plus dashed element outlines, for the model only). No "being debugged" bar appears |
| request_demo | `node <skill>/bridge request "Show me the search"`, then `wait`, act in the page, **Stop recording**, **Send** | The panel shows the request card and recording starts by itself. Output is a `recording` action with `requestId` and `prompt`. **Discard** instead gives `demoDeclined` |
| Record | `wait`, click **Record**, click/type/select/swipe/scroll in the page, follow a link, click **Stop recording**, type a question next to the "Recording · N steps" chip, click **Send** | The page reacts normally and the panel counts steps. Output is one `"type":"recording"` action: `recording.steps` (Recorder format plus `swipe`/`urlChange`) across both pages, passwords as `•••`, the comment in `text`. **Discard** (while recording) or the chip's × drops it |
| Step label | `node <skill>/bridge step "2/5 – Test"` | Panel shows the label |
| Highlight | `node <skill>/bridge highlight h1 --label "Title" --style spotlight` | Blue ring and callout, rest of the page dimmed. Output `"found": true` |
| Hide/show | `node <skill>/bridge hide`, then `show` | Highlights disappear and come back |
| Clear | `node <skill>/bridge clear` | Highlights removed |
| Buffering | Stop the bridge, click **Next**, start the bridge, run `wait` | The buffered `next` is delivered |
| Allowlist | Open `http://127.0.0.1:<port>/` | Panel shows the "not on the allowlist" notice. `highlight` returns an error |
| Cancel | `wait` in one terminal, `node <skill>/bridge cancel` in another | The wait prints `{"actions":[],"cancelled":true}` |

## Verify playwright-demo drives this browser

1. Start the browser and open `http://localhost:<port>/` in it by hand.
2. Ask the agent to run `browser_tabs` (list) on **playwright-demo**.
3. The list must contain your localhost tab and `chrome-extension://jedpjgmldnhcfdejimlabhppmffdijei/panel.html`.
   `node <skill>/scripts/browser.mjs status` lists the same pages.
4. Have the agent navigate the localhost tab with playwright-demo. The page must change in the window
   you are watching.

`ECONNREFUSED 127.0.0.1:9334` means the demo browser is not running: call `start_browser` and retry.
A separate window with an empty `about:blank` means the agent used the plain `playwright` server.

## Rebuild the vendored UI library

```sh
cd <skill>/vendor-src
npm install
npm run build   # writes extension/vendor/material-web.js and m3-tokens.css
```
