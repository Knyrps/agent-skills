---
name: show-and-tell
description: "Two-way pointing channel with the user on a live web page in a shared browser. You show things (highlights, labels, gesture illustrations like tap/swipe/drag) and the user shows you things (marks with notes, recorded clicks and gestures, messages) from a side panel. On top: guided tours with Next/Back and recorded review videos (MP4 with captions, chapters, cards). Use for 'show me', 'where is…', 'look at what I marked/sent/recorded', walkthroughs, demos, demonstrating code changes and customer review videos."
---

# show-and-tell

A Chrome for Testing window that you and the user share. You point at things in the page; the user points
back through the **show-and-tell side panel** (Annotate, Record, message). No tour is needed for either.
Guided tours and videos are optional layers on top. The panel is browser UI and never in page screenshots.

`<skill>` below is this skill's directory (the folder with this SKILL.md). Commands work in any shell.

## Pieces

- **Browser**: Chrome for Testing on its own profile, CDP `127.0.0.1:9334`, extension preloaded.
  `start_browser` launches it (idempotent) and opens the panel; it outlives the session.
- **show-and-tell MCP**: `start_browser`, `status`, `highlight`, `clear_highlights`, `hide_overlays`, `get_queue`,
  `wait_for_action`, `say`, `tabs`, `request_demo`, `throttle`, `set_step`, `load_tour`, `goto_step`, `end_tour`, `record_tour`,
  `stop_recording`. Each also exists as a CLI: `node "<skill>/bridge" <start|status|highlight <css> [--label t]
  [--gesture g] [--direction d] [--to css] [--url u] [--style s] [--keep]|clear|hide|show|queue [--recent]|wait|cancel|
  say --session <id> <text|->|request <prompt>|throttle <preset|off> [--cpu n]|step <label>|tour <file>|goto <n>|end|
  record <file> [--name n] [--size s]|record-stop|record-cancel>`.
- **`browser_*` tools** of the same MCP (Playwright MCP, attached to this browser) drive the page when you
  need more than `highlight` can do: `browser_snapshot`, `browser_click`, `browser_type`,
  `browser_evaluate`, `browser_navigate`, … They start the browser if needed and act in the app tab, never
  the panel. A separate plain `playwright` server, if the host has one, is your private browser the
  user does not see; use it only for work the user should not watch.

## Your own tab

Several agent sessions can share the browser. Each works in its own tab, grouped and named after it
(`status` → `you`, e.g. "app 2" when another session runs in the same folder). Everything you do (`browser_*`,
highlights, tours, `request_demo`, videos) happens in that tab; there is no switching to other tabs
(`browser_tabs` is not offered). A tab opened from yours (a link with `target="_blank"`, `window.open`, a
popup window; by your click, the user or the page) joins your tabs, and your next result says so ("a new tab
opened … (tab 123)"). Your calls stay on your working tab until you switch, so a running sequence of calls is
never moved; decide whether the new tab matters:
- `tabs()` lists your tabs; `tabs({ action: "select", id })` makes one the working tab; select the earlier id
  to go back.
- A flow that opens a popup on purpose: click, then `tabs({ action: "waitForNew", select: true })` (it finds a
  tab your last call opened even if it appeared before), act there, then select the original tab again.
- If your working tab closes, your next browser call fails until you select another tab.
- Tours and videos: `{ waitForTab: ms }` after the action that opens a tab moves the tour there; `{ backToTab:
  "previous" | "home", close?: true }` returns. A video follows along and shows a tab chip with the page's title at
  the top; a video step that opens a tab without `waitForTab` ends with `videoError`. Showing something brings your tab to the front. What the user sends while
your tab is in front comes to you. Only one tour and one video run at a time: if another session's is
running, you get a busy error; wait or tell the user.

## Slow network and CPU

`throttle({ preset, cpu })` slows your tab like DevTools. Network: `fast-4g`, `slow-4g`, `3g`, `offline`, or
`downloadKbps`/`uploadKbps`/`latencyMs`. CPU: a slowdown factor (`4`, `6`, up to 20; `1` ends it). Each is set
on its own; `preset: "off"` without `cpu` resets both. Use it to show or check loading states, spinners,
offline handling and slow devices. It stays on until off (the panel shows it, and the user can turn it off),
so turn it off when you are done. In tours and videos a step's `network` and `cpu` fields do the same from
that step on; they end with the tour or video.

## When the user acts in your tab

The user can click, type and navigate in your tab while you work. What they did since your last call comes
first in your next show-and-tell result (`userActivity` in JSON results, a leading note on `browser_*`
results), e.g. `14:02:11 clicked button "Sortieren" (#sort)`. Your own `browser_*` input is never listed.
When it is there: re-read the page (`browser_snapshot`) before using earlier refs, and take the user's
changes into account instead of undoing them; ask if their intent is unclear.

## Working where the user watches

The user follows the shared browser; the panel shows each `browser_*` call ("clicking …", "requesting
data through the page"). Keep it followable:
- Showing or reproducing something: use the visible UI (navigate, click, type), so the page shows it.
- Reading a lot of data (logs, lists, JSON): calling the app's own API with `fetch` inside
  `browser_evaluate` is fine and uses the user's session, but nothing changes on screen. Say so in chat first
  ("I'm reading the logs through Grafana's API in your tab").
- Keep such requests small (short time ranges, `limit`): a call that runs longer than about a minute is
  cut off by the MCP client. Split long ranges instead of retrying the same query.

## Guardrail: allowed hosts

The shared browser holds the user's sign-ins, so every tool here (pointing, tours, videos and `browser_*`)
works only on allowed hosts. This machine is always allowed: `localhost`, loopback addresses and names the
hosts file maps to loopback. Any other host, even a private one on another network, is asked in the side
panel when you first use it ("No", "This session", "Always"); the call waits up to 2 minutes for the answer.
- `Not allowed: the user did not allow …`: respect it; don't retry or look for a way around.
- `… did not answer …`: tell the user in one line that the panel is asking, then retry once.
- Never edit `extension/config.json` or `config.local.json` yourself; only the user grants hosts.

## The watcher: hearing the user

The user can send at any time. You hear it through a **watcher**, a background shell job.

- `start_browser`, `status` and every tool that drives the browser return `watcher`. If `running` is false,
  start `watcher.command` at once as a background job (shell tool, background option) and do not wait on it.
- When it completes it carries `{"actions": [...]}`: handle them (next section), then start the watcher again.
  A completion with `timeout` or `cancelled` and no actions: start it again and say nothing.
- Keep it running while you chat; never cancel it to answer a chat message.
- The panel sends to the session whose tab is in front (else the one that drove the browser last) and
  shows "<session> is listening".
- No background jobs in this harness: when the user says they sent, marked or recorded something, call
  `get_queue` (`recent: true` also returns the last hour's delivered items).

## Show the user something

`highlight({ selector, text?, label?, gesture?, direction?, to?, url?, style?, keep? })`:

- `url` opens that page in the app tab first; no Playwright needed. Check `found: false` before talking.
- `label`: a short callout. `style`: `outline` (default), `spotlight` (dims the rest), `none` (no box).
- `gesture` loops an illustration on the element; it is never performed. Touch: `tap`, `double-tap`,
  `long-press`, `swipe`, `pinch`. Mouse: `click`, `double-click`, `right-click`, `hover`, `drag`, `scroll`.
  `direction`: left/right/up/down (swipe, drag, scroll), in/out (pinch). `to`: CSS of a swipe/drag end.
- `keep: true` adds to the current highlights; otherwise they are replaced. `clear_highlights` removes them.
- Prefer stable selectors (id, `data-testid`, aria) plus `text`. Explain in chat in 1–3 sentences.

## What the user sends

Every item in `actions` has a `type` (and `step` while a tour runs).

**Answer where the user asked.** The user who writes, marks or records in the panel is looking at the panel:
reply with `say({ text })` (Markdown; shell-only hosts: `node "<skill>/bridge" say --session <id> -` with the
text on stdin, the id is in the watcher command). The panel shows "Thinking…" until you do. In your own chat
add one line at most ("Answered in the panel."). Questions asked in your chat are answered in your chat.

- `question`: a message (`text`).
- `annotation`: the user marked the page ("Annotate": a click marks an element, dragging draws) and wrote
  `text`. You get an inline image only you see: the user's numbered, coloured marks and notes plus dashed
  outlines labelled `1a`, `1b`… around the elements each mark refers to. `annotations[]` is the legend: `n`,
  `kind` (element/rect/arrow/pen), `color`, `rect`, arrow `from`/`to`, `note`, `elements[]` (`label`,
  `selectors`, `tag`, `text`, `rect`). Coordinates are document coordinates; `imageArea` is what the image
  shows. Refer to marks by number or colour and element text, never by the 1a labels. `imagePath` is the
  user's own version.
- `recording`: the user demonstrated something ("Record", or your `request_demo`, then with `requestId`
  and `prompt`). `recording.steps` follows Chrome DevTools Recorder's format (`navigate`, `click` with
  `button: "secondary"` and `modifiers`, `doubleClick`, `change`, `keyDown`, `scroll`) plus `longPress`,
  `swipe` and `urlChange`; element steps carry `selectors`, `tag`, `text`. `text` is the user's comment.
  A recording follows tabs and popup windows opened from the recorded tab: then `recording.tabs` is their count,
  every step has `tab` (1 = where it started), and `newTab { tab, openedBy, url, popup? }`, `switchTab { tab }` and
  `closeTab { tab }` mark the changes; in a tour, `waitForTab`/`backToTab` replay them.
  `demoDeclined`: the user discarded your request.
- Tour and video events: `next`/`back`, `agentStep`, `stepError`, `tourEnd`, `videoReady`, `videoError`,
  `videoDiscarded` (sections below).

`request_demo({ prompt })` asks the user to show you something; the panel starts recording for them.

## Guided tour

1. **Plan** the steps in chat: title and what each shows, one idea per step.
2. **Script** `{ steps: [{ title, explanation, url?, actions?, highlights?, agent? }] }`:
   - `explanation`: 2–5 sentences, shown in the panel.
   - `url`: navigate first. Back replays from the nearest earlier step with a `url`, so give every step
     that changes page state a reachable `url`.
   - `actions`: `{click|fill|waitFor|hover|doubleClick|rightClick|longPress|swipe|drag|scroll: css, text?,
     value?, to?, direction?, ms?}`, `{scrollBy: px, in?: css}`, `{press: key, on?: css}`, `{wait: ms}`.
   - `highlights`: as `highlight()`; the first replaces, the rest are added.
   - `agent: true` only for steps you must do by hand: act, `set_step("n/N – title")`, highlight, explain,
     then `goto_step(n+1)` when `next` arrives.
   Verify selectors first (`browser_evaluate`); a missing one becomes `stepError`.
3. **Start**: `start_browser` (start the watcher), check `bridge.panelOpen`, then `load_tour({ tour })` and
   tell the user in one line that the tour runs in the panel.
4. **React**: `stepError` → fix the step, `load_tour` with `start: step`. `tourEnd` → `end_tour` and a short
   summary. Questions and marks during a tour refer to the current `step`.

## Demonstrating code changes

1. **Scope**: uncommitted changes (`git diff HEAD`), else the branch against its base. Unclear: ask.
2. **Map** every changed file to the screen and element where its effect shows; changes without a visible
   effect go into one closing summary step.
3. **App**: if it is not reachable, start its dev server from the project's scripts as a background job.
Then one tour step per visible change, in the app's natural order.

## Review video

`record_tour({ tour, name?, size?, pace?, captions?, cards?, zoom?, hidpi?, out? })` plays a scripted tour by itself and
records the tab as MP4 with captions, chapter labels, progress bar, intro/section/outro cards, a drawn
cursor or finger for every action, a `.vtt` and a chapter list. It returns at once; the watcher then gets
`videoReady { path, vtt, chapters, durationMs, … }` or `videoError { step, error }`. Read
`references/video.md` before writing a video tour.

## Evidence screenshots

Call `hide_overlays(true)` before a screenshot that should show the plain page, `hide_overlays(false)` after.

## Troubleshooting

- `extensionConnected: false`: `start_browser` again; the extension reconnects within ~15 s and replays
  what the user sent meanwhile.
- `bridge not running`: the MCP is not attached; the CLI (`start`, `wait`) works on its own.
- A `browser_*` call says the browser is closed: it reconnects once by itself; if it still fails,
  `start_browser` and retry.
- One browser serves one tour or video at a time. If `status` shows a step you did not set, another
  session is using it: ask the user first.
- Chrome for Testing missing: `npx playwright install chromium`, or set `DEMO_BROWSER_PATH`.
