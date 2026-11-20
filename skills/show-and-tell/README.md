# show-and-tell

A two-way pointing channel between you and an AI coding agent on a live web page. You and the agent
share one browser window:

- **The agent shows you things**: highlights, labels and looping gesture illustrations (tap, swipe,
  drag, pinch, scroll …) on page elements.
- **You show the agent things** from the **show-and-tell side panel**, with or without a tour:
  - **Annotate**: click an element to mark it, or drag a frame, an arrow or a pen stroke, each with a note.
  - **Record**: captures what you do in the page (clicks, typing, keys, scrolling, swipes, navigation).
  - **Message** and **Send**, with the annotation or recording attached.
  The panel reads like an agent chat: your messages, and what the agent did and asked in the browser.
  The agent hears it through a background watcher; the panel shows which session is listening.
- **Several agents at once**: each session works in its own named, coloured tab group, and the panel talks
  to the session whose tab is in front.
- **Guided tours** with Back / Next, and **review videos** (MP4 with captions, chapter labels, progress bar,
  intro/section/outro cards and a drawn cursor or finger) are layers on top.

```
agent ──stdio──> bridge (MCP)  ──HTTP 127.0.0.1:47613──<  `node bridge wait` (background job)
                     │ WebSocket /ext (Origin = extension only)
                     ▼
           Chrome for Testing  (CDP 127.0.0.1:9334, own profile)
           ├─ extension: side panel (browser UI) + in-page highlight, annotation and recorder layer
           └─ Playwright MCP, a child of the bridge, attaches via --cdp-endpoint; its browser_* tools
              are offered by the same MCP server
```

| Path | What |
| --- | --- |
| `SKILL.md` | Instructions for the agent |
| `scripts/browser.mjs` | `start` / `stop` / `status` / `panel` for the demo browser |
| `extension/` | MV3 extension: side panel (Material Web), service worker (bridge socket, outbox, capture), content script (highlights, annotation, recorder) |
| `extension/config.json` | Bridge URL and shared host patterns; `config.local.json` (git-ignored) holds hosts you allowed and video branding |
| `bridge/hosts.js` | Which hosts are allowed: loopback and the hosts file's loopback names, config patterns, your grants |
| `extension/gestures.js`, `stage.js` | Gesture glyphs and the drawn pointer; the video stage (captions, cards, input shield) |
| `references/video.md` | How the agent writes review videos |
| `bridge/` | MCP server, bridge server and CLI (`index.js`); `driver.js` runs Playwright MCP on the shared browser. Dependencies: `@modelcontextprotocol/sdk`, `@playwright/mcp` |
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
   | Claude Code | `~/.claude/skills/show-and-tell` |
   | OpenCode | `~/.config/opencode/skills/show-and-tell` (also reads `~/.claude/skills` and `~/.agents/skills`) |
   | VS Code (GitHub Copilot agent mode) | `~/.copilot/skills/show-and-tell`, or `.github/skills/show-and-tell` in a project |
   | Codex CLI | `~/.codex/skills/show-and-tell` |

   Hosts change these paths now and then; the host's own docs win.

3. **MCP server.** Register one stdio server in the agent host: `show-and-tell`: `node <skill>/bridge/index.js`.
   It also offers Playwright MCP's `browser_*` tools for the shared browser.

   Ready-made snippets for OpenCode, Claude Code, VS Code and Codex are in `config/`. Keep any existing
   `playwright` server as it is: that is the agent's private browser. An older `playwright-demo` entry
   (attached to port 9334) is no longer needed; remove it.

4. **Allowed hosts.** Nothing to do for sites on this machine: `localhost`, loopback addresses and every
   name your hosts file maps to `127.x` or `::1` (read live) are always allowed. For any other host the
   side panel asks you when the agent first wants it, or when you open it yourself: **This session** or
   **Always** (saved to the git-ignored `extension/config.local.json`). Patterns can also go there by hand,
   e.g. `{ "allowlist": ["grafana.example.zz", "*.staging.example"] }` (`*.x` = x and all subdomains).
   The rule covers the `browser_*` tools too; the agent can ask but never grant.

Environment overrides: `DEMO_BROWSER_PATH` (any Chromium that honours `--load-extension`, for
example Edge), `DEMO_CDP_PORT` (9334), `DEMO_PROFILE`, `DEMO_BRIDGE_PORT` (47613), `DEMO_DATA`
(queue, screenshots and profile; default `%LOCALAPPDATA%\show-and-tell` on Windows,
`~/Library/Application Support/show-and-tell` on macOS, `~/.local/share/show-and-tell` on Linux).

## First start

```sh
node <skill>/bridge start   # expect "bridge": { "extensionConnected": true, "panelOpen": true }
```

The agent does the same through the `start_browser` tool. `set_step`, `highlight`, `clear_highlights`
and `hide_overlays` also start the browser if it is not running. If the side panel doesn't open by
itself, click the show-and-tell icon in the toolbar (puzzle menu).

When the agent host runs the show-and-tell MCP, that process owns the bridge port. Without an agent, run
`node <skill>/bridge serve` in a second terminal.

## Manual test of every control

Open any page on `http://localhost:<port>/` in the demo browser, then:

| Test | Do | Expect |
| --- | --- | --- |
| Idle panel | Open the panel with no tour running | The greeting "What do you want to show?" with three suggestion chips above the composer (message field, Annotate, Record, Send arrow); no step card, no Back/Next. Send is off while there is nothing to send |
| Conversation | Let the agent navigate, click and `highlight` with a label, then send a message | The conversation shows one "working" line per run of browser actions (with a moving sheen while fresh), "Pointed at something" with the label, and your message as a bubble with "Sent" under it. Each session whose tab is in front has its own conversation |
| Watcher | `node <skill>/bridge wait --session s1 --label mine --timeout 60`, type a message, **Send** | The header names "mine" and says "Listening"; the message appears as a bubble with "Sent" and the CLI prints the `question` |
| Next | `node <skill>/bridge step "1/2 – Test"`, then `wait --timeout 60` and click **Next** | Step card and Back/Next appear. The CLI prints `{"actions":[{"type":"next",…}]}` |
| Back | Same, click **Back** | `"type":"back"` |
| Question | Same, type a question, press Enter | `"type":"question","text":"…"` |
| Annotate | `wait`, click **Annotate**, hover (dashed outline) and click one element, drag a frame, scroll the page and an inner scroll area with the wheel, switch to the arrow and drag one inside the scroll area (Enter after each note), click a number circle to add or change its note (Esc restores it, the bin deletes the mark), **Done**, type a question, **Send**. Esc instead of Done cancels, Ctrl+Z undoes | Clicks don't reach the page. Each mark has its own colour and number, stays on its content while scrolling, and is clipped to its scroll area. An "Annotation · N" chip appears and the drawing disappears. Output is one `"type":"annotation"` action with `annotations[]` (document coordinates, `color`, note, `elements[]` labelled 1a, 1b …), `imageArea`, `imagePath` (all marks, also those scrolled out of view) and `labelledImagePath` (plus dashed element outlines, for the model only). No "being debugged" bar appears |
| request_demo | `node <skill>/bridge request "Show me the search"`, then `wait`, act in the page, **Stop recording**, **Send** | The request appears in the conversation and recording starts by itself (Record reads "Stop · N steps"). Output is a `recording` action with `requestId` and `prompt`. **Discard** instead gives `demoDeclined` |
| Record | `wait`, click **Record**, click/type/select/swipe/scroll in the page, follow a link, click **Stop**, type a message next to the "Recording · N steps" chip, click **Send** | The page reacts normally and the panel counts steps. Output is one `"type":"recording"` action: `recording.steps` (Recorder format plus `swipe`/`urlChange`) across both pages, passwords as `•••`, the comment in `text`. **Discard** (while recording) or the chip's × drops it |
| Step label | `node <skill>/bridge step "2/5 – Test"` | Panel shows the label |
| Highlight | `node <skill>/bridge highlight h1 --label "Title" --style spotlight` | Blue ring and callout, rest of the page dimmed. Output `"found": true` |
| Hide/show | `node <skill>/bridge hide`, then `show` | Highlights disappear and come back |
| Clear | `node <skill>/bridge clear` | Highlights removed |
| Buffering | Stop the bridge, click **Next**, start the bridge, run `wait` | The buffered `next` is delivered |
| Allowed hosts | Open `https://example.com/` yourself | The panel says it is not allowed and offers "Allow this session" / "Always allow"; after a click, Annotate works without a reload |
| Two sessions | Start two agents in the same folder; let both open a page with show-and-tell's `browser_navigate`, then switch between their tabs and send a message | Each works in its own tab group ("app", "app 2", different colours) and neither navigates the other's tab. The panel header names the session whose tab is in front, and the message reaches only that session |
| Throttling | `node <skill>/bridge throttle 3g` on a localhost page, reload it, then `throttle off` (or the panel's **Turn off**) | The page loads slowly (about 2 s latency); the panel shows "Network throttled: 3G" while that tab is in front. `throttle offline` makes requests fail; `throttle --download 2000 --latency 300` sets custom values; `throttle --cpu 6` slows scripts about sixfold and the panel adds "CPU 6× slower" |
| Host question | `node <skill>/bridge highlight h1 --url https://example.com/` (not allowed yet) | The panel asks "Allow the agent here?"; **No** returns `the user did not allow example.com`, **This session** opens the page. `localhost` pages never ask |
| Cancel | `wait` in one terminal, `node <skill>/bridge cancel` in another | The wait prints `{"actions":[],"cancelled":true}` |
| Gestures | `node <skill>/bridge highlight button --gesture double-tap --label Here --url http://localhost:<port>/`, then with `--gesture swipe --direction left --keep` on another element | The page opens; a finger dot taps twice with a ripple; the swipe shows a dotted path and a trail. An unknown gesture name returns the list of valid ones |
| Video | `node <skill>/bridge record tour.json --name test`, then `wait --timeout 300` | 3-2-1 countdown in the panel, the window shrinks to a 1:1 size, intro card, chapter labels, captions, a gliding cursor; Esc in the page or **Stop and save** keeps a partial video. `videoReady` has `path`, `vtt`, `chapters` and the window is restored |
| Tests | `npm test` in `bridge` | Routing, browser_* forwarding, MP4 converter and timing rules pass |

## Verify the browser_* tools drive this browser

1. Start the browser and open `http://localhost:<port>/` in it by hand.
2. Ask the agent to run show-and-tell's `browser_snapshot`. It must describe your localhost page, not the
   side panel, without selecting a tab first.
3. Have the agent navigate with show-and-tell's `browser_navigate`. The page must change in the window
   you are watching.

A separate window with an empty `about:blank` means the agent used the plain `playwright` server.

## Rebuild the vendored UI library

```sh
cd <skill>/vendor-src
npm install
npm run build   # writes extension/vendor/material-web.js and m3-tokens.css
```
