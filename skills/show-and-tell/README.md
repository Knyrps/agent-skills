# show-and-tell

A two-way pointing channel between you and an AI coding agent on a live web page. You and the agent
share one browser window:

- **The agent shows you things**: highlights, labels and looping gesture illustrations (tap, swipe,
  drag, pinch, scroll …) on page elements.
- **You show the agent things** from the **show-and-tell side panel**, with or without a tour:
  - **Annotate**: click an element to mark it, or drag a frame, an arrow or a pen stroke, each with a note.
  - **Record**: captures what you do in the page (clicks, typing, keys, scrolling, swipes, navigation).
  - **Message** and **Send**, with the annotation or recording attached.
  The panel reads like an agent chat: your messages, what the agent did and asked in the browser, and its
  replies (the `say` tool, Markdown; "Thinking…" until it answers). The agent hears you through a
  background watcher; the panel shows which session is listening. It is a side channel, not a copy of
  the agent chat, and says so at the top of the conversation.
- **You can work in the agent's tab too**: what you click, type and open there (not what the agent does)
  is listed at the start of the agent's next show-and-tell result, so it re-reads the page instead of
  acting on a state that no longer holds.
- **Several agents at once**: each session works in its own named, coloured tab group, and the panel talks
  to the session whose tab is in front. Tabs opened from a session's tab (links, `window.open`, forms, popup
  windows) belong to it: they join its group and the agent is told, but its calls stay on its working tab until it
  switches with the `tabs` tool. Tours and videos can follow a tab a step opens (`waitForTab`, `backToTab`); a video then shows a Chrome-style
  tab chip with the page's title. **Record** follows tabs and popups opened from the recorded tab and marks each change. When a session's MCP process has exited, its tab group turns grey
  ("… · ended") and closes 15 minutes later (kept, ungrouped, if you looked at it). Sessions that are
  only quiet are never touched.
- **Guided tours** with Back / Next, and **review videos** (MP4 with captions, chapter labels, progress bar,
  intro/section/outro cards and a drawn cursor or finger) are layers on top. While a video records, the
  window keeps its recording size: resizing or maximizing it is undone at once.
- **Throttling** of the network and CPU per tab, like DevTools, shown in the panel with a Turn off button.
- **Pausing the page**: the agent can hold chosen requests while the page keeps running (to show a loading
  state), or stop the page's JavaScript at a request, a line of code, a DOM change or an event, like DevTools
  breakpoints, and read variables there without changing anything. The panel shows "Page paused" or
  "Holding requests" with a **Resume** / **Release** button that works without the agent. At a breakpoint,
  Resume is a split button: its menu reloads the page to the same breakpoint, reloads and lets it pass once,
  reloads without it, or resumes and removes it. The agent has the same choices. Chrome's own
  "Paused in debugger" overlay does not appear. Everything paused runs again when the tab loads another page
  or closes, when the agent's session ends, and a minute after the last bridge is gone.

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
| `extension/` | MV3 extension: side panel (Lit + `@m3e/web`, built into `extension/ui/`), service worker (bridge socket, outbox, capture), content script (highlights, annotation, recorder) |
| `extension/config.json` | Bridge URL and shared host patterns; `config.local.json` (git-ignored) holds hosts you allowed and video branding |
| `bridge/hosts.js` | Which hosts are allowed: loopback and the hosts file's loopback names, config patterns, your grants |
| `extension/gestures.js`, `stage.js` | Gesture glyphs and the drawn pointer; the video stage (captions, cards, input shield) |
| `extension/pause.js` | Pause points and held requests, over the same debugger connection as throttling |
| `references/video.md` | How the agent writes review videos |
| `bridge/` | MCP server, bridge server and CLI (`index.js`); `driver.js` runs Playwright MCP on the shared browser. Dependencies: `@modelcontextprotocol/sdk`, `@playwright/mcp` |
| `config/` | MCP config snippets per agent host |
| `ui-src/` | UI source in TypeScript: side panel, small pages, overlay and video stage templates, test page. Builds `extension/ui/` and `scripts/lab-vendor/lab.js`. Not needed at runtime |
| `vendor-src/` | Rebuilds `extension/vendor/m3-tokens.css` (Material 3 colour roles). Not needed at runtime |
| `scripts/lab.mjs`, `scripts/real-input-check.mjs` | Test page and the end-to-end check with real input (see below) |

Works on Windows, macOS and Linux with Node.js 20 or newer.

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
   The rule covers the `browser_*` tools too; the agent can ask but never grant. An allowed site can try to
   instruct the agent through its own text (prompt injection), with your sign-ins at hand, so allow only sites
   you trust. The shield in the panel header lists the sites you allowed and takes one back.

5. **Certificates.** The shared browser holds your sign-ins, so a bad certificate on a real site stops it like
   any Chrome. Self-signed certificates are accepted on `localhost`, and on names your hosts file maps to
   loopback when they serve HTTPS on port 443 or on a port listed in `config.local.json` as
   `{ "httpsPorts": [5001] }`. Their keys are read when the browser starts, so a dev server started later
   needs a browser restart. `{ "ignoreCertificateErrors": true }` accepts every certificate error everywhere;
   it is meant for setups the above does not cover.

Environment overrides: `DEMO_BROWSER_PATH` (any Chromium that honours `--load-extension`, for
example Edge), `DEMO_CDP_PORT` (9334), `DEMO_PROFILE`, `DEMO_BRIDGE_PORT` (47613), `DEMO_LAB_PORT` (47614, the test page), `DEMO_DATA`
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

## Automated checks

`node <skill>/tests/run.mjs` copies the skill to a temporary folder and runs it there on its own ports
(bridge 47713, CDP 9434, test page 47714) in its own browser profile, so a running show-and-tell is not
touched. It runs every `tests/*.test.mjs` and prints PASS/FAIL per check; screenshots (light and dark) land
in `%TEMP%/show-and-tell-test/shots`. `run.mjs pause-menu once,kept` runs some sections of one test,
`--keep` reuses the running test browser, `--clean` stops it and removes the copy. Needs
`npm install` in `bridge/`.

## Manual test of every control

The bridge serves a test page on `http://localhost:47614/` (and `/next`; `DEMO_LAB_PORT` changes the port)
whenever it runs, and the browser opens it on start as a pinned tab. New tabs (Ctrl+T, the panel's **+**) open it too:
the extension sends Chrome's new tab page there (redirecting, not overriding it, so Chrome doesn't ask "Change back to Google?"). It is not a separate process: while no bridge runs
(no agent session with show-and-tell, no `bridge serve`), its tab shows a notice and switches to the page
once a bridge is up. Agent sessions never take the lab tab over as their own. The page is built like a
Material 3 Expressive app with `@m3e/web` components (their controls live in shadow DOM, as in real apps). Every
element reacts to real mouse, touch and keyboard input and to the skill's scripted actions, and a log at
the bottom says who caused each event:

- `[user]`: real input outside the agent's calls.
- `[agent]`: input during one of the agent's `browser_*` calls. Playwright's input is as trusted as a
  person's, so the extension marks the tab with `<html data-show-and-tell-agent="call">` meanwhile.
- `[agent · scripted]`: the extension playing the agent's tour or video steps (`data-show-and-tell-agent="scripted"`).
- `[… · component]`: an event a component fires itself, credited to whoever acted last.

Only calls through show-and-tell are recognised as the agent's. Anything else that drives this browser over
CDP port 9334 (the real-input check below, raw CDP scripts, a separately configured Playwright) looks like a
person's input and is labelled `[user]`; agent sessions are told about it as the user's too.

The bug icon in the lab's top bar opens **Debug options**, a side sheet at the right: **Log events from**
(User + agent, User, Agent), **Card reactions** (the cards' own lines, the default log) and, under **Raw
events**, every DOM event type as a chip in its group, with search, All, None and Reset. Every event is kept in a buffer of 5,000 lines and the settings
only filter what is shown, so changing them also shows or hides earlier events.

`node <skill>/scripts/real-input-check.mjs` then drives the lab and the side panel with real input (CDP
`Input.*`, trusted like a person's) and checks every element and control: taps, double taps, long press,
pinch, swipe, drag and drop, clicks, menus, typing, forms, dialogs, shortcuts, Annotate (including Esc while
the panel has focus), Record, Send, throttling, the host question and notice, tour Next/Back and video
Discard. It needs the browser and a bridge running. It starts by emptying the panel's message
queue, and each run leaves a temporary `*.nip.io` host allowed until the browser restarts.

By hand, open the lab (or any page on `http://localhost:<port>/`) in the demo browser, then:

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
| Hold a request | On the lab: `node <skill>/bridge pause request /api/items --hold`, click **Load items** (Load data card), then the panel's **Release** (or `node <skill>/bridge resume`) | The panel shows "Pause point set · holds requests to /api/items" with **Remove**. After the click the card stays on "Loading…", the rest of the page works, and the panel shows "Holding requests · /api/items?run=1 · 1 request waiting". **Release** lets it through ("4 items loaded") and a waiting session gets `resumed` with `by: "user"`. `--keep` holds every such request until `pause remove all` |
| Pause at a line | `node <skill>/bridge pause line "renderItems(data.items)"`, click **Load items**, then `node <skill>/bridge inspect`, `inspect data.items.length`, `inspect "run = 5"`, `resume --step into`, `resume` | The output names the place (`(index):404`). After the click the page is frozen and the panel shows "Page paused · breakpoint at (index):404 · loadItems()" with **Resume**; no "Paused in debugger" overlay in the page, and Annotate and Record are off. `inspect` lists the call stack and the local variables (`run`, `res`, `data`), the expression gives `4`, the assignment is refused as read-only, the step stops in `renderItems`, and `resume` lets the items appear |
| Other pause points | `pause request /api/items` (stops at the `fetch` call), `pause dom "#items"` (stops in `renderItems`), `pause event click` (stops in the page's click listener, not in the extension), `pause now`; with an agent: let it call `browser_click` on **Load items** with a point set, and `browser_snapshot` while paused | Each shows "Page paused" with its reason. The agent's click returns at once with "The page paused during browser_click: …", and calls on a paused page fail at once with "The page is paused: …" instead of hanging |
| Resume menu | `pause line "renderItems(data.items)"`, click **Load items**; in the panel open the arrow next to **Resume** and pick **Reload to breakpoint**, click **Load items** again; then try **Reload and ignore breakpoint once** and **Reload and remove breakpoint**. With `--keep` on the point: **Resume and remove breakpoint**. Same from the CLI: `resume --reload again\|skip\|remove`, `resume --remove` | Resume is a filled split button; while the menu is open its arrow button is round and the arrow points up. "Reload to breakpoint" reloads, the panel shows "Pause point set" and the next click pauses at the same line. "Ignore once" shows "(lets the next hit pass)": the first click loads the items, the second pauses. "Reload and remove" leaves nothing set. "Resume and remove" only appears for a kept point. A waiting session gets `resumed` with a `note` naming the choice. `pause now` shows a plain **Resume** button without a menu |
| Pause clean-up | Pause the page, then one of: reload the tab; close the tab; end the agent's session; stop every bridge and wait a minute | The page runs again (after a reload, a kept point stays set) and the panel card disappears |
| Host question | `node <skill>/bridge highlight h1 --url https://example.com/` (not allowed yet) | The panel asks "Allow the agent here?"; **No** returns `the user did not allow example.com`, **This session** opens the page. `localhost` pages never ask |
| Cancel | `wait` in one terminal, `node <skill>/bridge cancel` in another | The wait prints `{"actions":[],"cancelled":true}` |
| Gestures | `node <skill>/bridge highlight button --gesture double-tap --label Here --url http://localhost:<port>/`, then with `--gesture swipe --direction left --keep` on another element | The page opens; a finger dot taps twice with a ripple; the swipe shows a dotted path and a trail. An unknown gesture name returns the list of valid ones |
| Video | `node <skill>/bridge record tour.json --name test`, then `wait --timeout 300` | 3-2-1 countdown in the panel, the window shrinks to a 1:1 size, intro card, chapter labels, captions, a gliding cursor; Esc in the page or **Stop and save** keeps a partial video. `videoReady` has `path`, `vtt`, `chapters` and the window is restored |
| Window lock | During a video, resize or maximize the window | It snaps back to the recording size at once; the panel says the size is locked until the video is done. The video keeps its size |
| Reply in the panel | Send a message from the panel to a listening session; it answers with `say` (or `node <skill>/bridge say --session <id> "**Hi**"`) | "Thinking…" under your message, then the reply rendered as Markdown (raw HTML is shown as text). Without a reply, after two minutes it notes the answer may be in the agent chat |
| Your input in its tab | While an agent works in its tab, click and type there yourself, then let it call any show-and-tell tool | Its result starts with "The user worked in your browser tab …" listing your clicks, edits (passwords masked) and navigations, not the agent's own input. A field the agent typed into and you only left is not listed |
| New tabs | In an agent's tab, open a link in a new tab (or let the page call `window.open`), then let the agent call any show-and-tell tool; close the new tab and let it call again | The tab joins the agent's group; the result says "a new tab opened … (tab N). Your calls still act on your working tab", and they do until `tabs({ action: "select", id: N })`. Closing the working tab makes the next browser call fail until another is selected. A popup window belongs to the agent too (no group: popup windows can't hold one). A video step that opens a tab ends the video with `videoError` unless the step follows it with `waitForTab`, which moves the video there with a tab chip at the top |
| Record across tabs | **Record**, open the lab's **Popup** (New tabs card), click in the popup, close it, click in the first tab, **Stop** | The chip reads `Recording · N steps · 2 tabs`; the steps have `tab` numbers and `newTab`/`switchTab`/`closeTab` markers |
| New tab in a group | With an agent's tab in front, click **+** in the panel's top bar | An empty tab opens inside that agent's group (Ctrl+T would open one outside it). The agent's next result says `a new tab opened by the user, from the side panel`; its calls stay on its working tab. The button is hidden when the tab in front belongs to no session |
| Ended session | End an agent session (close its chat or the MCP process) | Within about 15 s its tab group turns grey, "<name> · ended"; a placeholder tab closes at once. 15 minutes later the tab closes, or is only ungrouped if you opened it meanwhile or it is in front. A quiet but running session is never touched |
| Browser restart | Restart the demo browser while a session runs | Chrome restores the group; it goes back to its running session. Groups of sessions that are gone are ungrouped |

## Verify the browser_* tools drive this browser

1. Start the browser and open `http://localhost:<port>/` in it by hand.
2. Ask the agent to run show-and-tell's `browser_snapshot`. It must describe your localhost page, not the
   side panel, without selecting a tab first.
3. Have the agent navigate with show-and-tell's `browser_navigate`. The page must change in the window
   you are watching.

A separate window with an empty `about:blank` means the agent used the plain `playwright` server.

## Rebuild the UI

The built files are committed, so the extension and the test page run without a build step. After changing
`ui-src/`:

```sh
cd <skill>/ui-src
npm install
npm run check   # type-check
npm run build   # writes extension/ui/*.js and scripts/lab-vendor/lab.js
```

The colour roles come from `vendor-src/` (`npm install`, then `npm run tokens` writes
`extension/vendor/m3-tokens.css`). `AGENTS.md` has the rules for working on the UI.
