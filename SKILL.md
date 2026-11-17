---
name: demonstrate
description: "Guided step-by-step UI tour in the Playwright browser with an on-page bar for next/back/questions/element picks. Use for walkthroughs, tours, demos, 'show me', and demonstrating code changes."
---

# demonstrate

You give the user a guided **tour** of a web app. You drive the browser through the Playwright MCP; the
user watches the same browser and answers through the **demonstrate side panel** (Zurück / Weiter /
Markieren / Zeig ich dir / Frage). The panel is browser UI, so it never appears in page screenshots. You also draw
**highlights** on page elements to point at what you are explaining.

`D` below is `$HOME\.agents\skills\demonstrate`. All commands are pwsh.

## Pieces

- **Browser**: Chrome for Testing on its own profile, CDP on `127.0.0.1:9334`, extension preloaded.
  `start_browser` launches it (idempotent) and opens the panel; it outlives the session.
- **playwright-demo MCP** (`tools["playwright-demo"].*`) drives this browser. Use it for the whole tour,
  never the plain `playwright` server, which runs a separate browser the user cannot see. It lists the
  side panel as a tab too (`chrome-extension://…/panel.html`): select the app tab with `browser_tabs`
  and act only on that.
- **demonstrate MCP** (`tools.demonstrate.*`): `start_browser`, `status`, `load_tour`, `goto_step`,
  `end_tour`, `request_demo` (ask the user to show you something; then wait), `set_step`, `highlight`, `clear_highlights`, `hide_overlays`, `get_queue`,
  `wait_for_action`. Every one also exists as a CLI: `node "$D\bridge" start | status |
  tour <file.json> [--start n] | goto <n> | end | request <prompt> | step <label> | highlight <css> [--label t] [--text t]
  [--style spotlight] [--id x] [--keep] | clear [id] | hide | show | wait [--timeout N] | cancel`.
- **Scripted tour**: you hand over every step at once; the extension runs Weiter/Zurück itself
  (navigation, actions, highlights, explanation in the panel) in about a second, without you. You are
  woken only for questions, element picks, `agent` steps, step errors and the end.

## Guardrail: allowlisted hosts

Tours run on allowlisted hosts only (`extension/config.json`, default `localhost`, `*.dev.local`).
If the target URL is on another host, stop and tell the user to add it to the allowlist; the panel and
highlights stay inactive there, and `highlight` returns an error.

## Demonstrating code changes

When the user asks to demonstrate changes ("show me what changed", "demonstrate all changes"), do this
before step 1; it supplies the tour's content and the running app.

1. **Scope.** Uncommitted changes (`git status`, `git diff HEAD`); if there are none, the branch against
   its base (`git merge-base HEAD origin/main`, or the repo's default branch). If both are empty or the
   base is unclear, ask in chat which range to show.
2. **Map** every changed file to the screen(s) and element(s) where its effect is visible. Changes with
   no visible effect (refactors, tests, config) go in one closing summary step instead of the tour.
   Done when every changed file is either mapped to a screen or listed in that summary.
3. **App.** If the app is not reachable, start its dev server from the project's own scripts
   (`package.json` / README) as a background shell job and wait until the URL answers. Check the URL
   against the allowlist (guardrail above).

Then plan one tour step per user-visible change, ordered along the app's natural navigation.

## Steps

1. **Plan.** Write the tour as numbered steps in chat: per step a title and what it shows. Keep each
   step to one idea. Done when the user can see the full list.
2. **Script it** as a tour object: `{ steps: [{ title, explanation, url?, actions?, highlights?, agent? }] }`.
   - `explanation`: 2–5 sentences shown in the panel; this replaces the chat explanation per step.
   - `url`: navigate first; omit to continue on the page the previous step left. Zurück replays from the
     nearest earlier step with a `url`, so give every step that changes page state a reachable `url`
     (a URL with query parameters is better than a chain of clicks).
   - `actions`: `{click: css, text?}`, `{fill: css, value}`, `{waitFor: css, text?}`, `{wait: ms}`.
   - `highlights`: as `highlight()` (`selector`, `text`, `label`, `style: "spotlight"`, `id`); the first
     replaces, the rest are added. Prefer stable selectors (id, `data-testid`, aria) plus `text`.
   - `agent: true` only for steps that cannot be scripted (they depend on a result you must see first);
     you then do that step by hand (step-by-step section) and `goto_step(n+1)` when the user clicks Weiter.
   Verify selectors before loading (playwright-demo `browser_evaluate` with `querySelector`): a missing one
   becomes a `stepError` mid-tour.
3. **Start.** Call `start_browser`. Check `bridge.extensionConnected: true` and `bridge.panelOpen: true`
   (otherwise tell the user to click the demonstrate toolbar icon). **Select the app tab** before any
   other playwright-demo call: the side panel is also a tab and usually the *current* one, so every
   locator would search the panel and time out. `browser_tabs({action:"list"})`, then
   `browser_tabs({action:"select", index})` on the tab whose URL is not `chrome-extension://` (the panel
   is normally index 0, so the app is normally index 1, never assume it), and check with
   `browser_evaluate(() => location.href)`: if it starts with `chrome-extension://`, select again. Repeat after `start_browser` restarts the browser.
   Sign-ins (Sitecore etc.) happen on that tab too; the demo profile keeps them. Then `load_tour({ tour })`. Tell the user in one line that the tour runs in the panel.
4. **Wait** (next section) and end your turn.
5. **React** to the returned `actions` (each carries `step`, 0-based):
   - `stepError`: fix the step (usually the selector), `load_tour` again with `start: step`, wait again.
   - `agentStep`: perform that step by hand (step-by-step section), then wait.
   - `tourEnd`: go to Finish.
   - `question`: answer `text` in chat, in the context of the current step. Stay on the step, wait again.
   - `recording`: the user demonstrated something ("Zeig ich dir", or your `request_demo`; then it carries
     `requestId` and `prompt`). `recording.steps` follows Chrome DevTools Recorder's format (`setViewport`,
     `navigate`, `click` with `button: "secondary"` for right clicks and `modifiers`, `doubleClick`,
     `change` = typed text or selection, `keyDown`, `scroll`) plus `longPress`, `swipe` (from/to point and
     element, direction, pointerType) and `urlChange` (SPA route, no reload); element steps carry
     `selectors`, `tag`, `text`. `text` is the user's question. Answer what they showed; on request replay
     it through playwright-demo or turn it into tour steps. `demoDeclined`: the user discarded your request.
   - `annotation`: the user marked the page ("Markieren": a click marks one element, dragging draws) and
     asks `text`. The marks may span more than the window. You get an inline image only you see: the user's
     numbered, coloured marks and notes plus dashed outlines labelled `1a`, `1b`… around the page elements
     each mark refers to. `annotations[]` is the legend: `n`, `kind` (element/rect/arrow/pen), `color`,
     `rect`, arrow `from`/`to`, the user's `note`, `elements[]` (`label`, `selectors`, `tag`, `text`, `rect`).
     All coordinates are document coordinates; `imageArea` is the page area the image shows. Refer to marks
     by number or colour and element text, never by the 1a labels. Answer, then wait again without
     advancing. `imagePath` is the user's own version.
   - `next`/`back` only reach you during an `agent` step: `goto_step(step ± 1)`, then wait.
   - `{"timeout": true}` or `{"cancelled": true}` with no actions: nothing happened; wait again or ask
     in chat whether to continue.
6. **Finish** after `tourEnd` or when the user ends the tour: `end_tour`, and summarise the tour in
   chat. Leave the browser running unless the user asks to close it.

### Step by step (agent steps)

Act through playwright-demo, `set_step("n/N – <title>")`, `highlight` what you talk about (check
`found: false` before explaining), explain in chat in 2–5 sentences, then wait.

## Waiting

Preferred: a **background shell job** so the chat stays free and no MCP timeout applies:

```pwsh
node "$HOME\.agents\skills\demonstrate\bridge" wait --timeout 1800
```

Run it with the shell tool's background option, then end your turn. Its completion notification carries
the JSON (`{"actions": [...]}`); continue with step 4. Keep exactly one wait pending at a time.

If the user writes in chat while a wait is pending, first release it with `node "$D\bridge" cancel`
(the background job then completes with `cancelled`, ignore that result), then answer the chat message,
then start a new wait if the tour continues.

Fallback when background jobs are unavailable: call `wait_for_action({ timeoutSec: 600 })`, which blocks
the turn until the user acts. Use `get_queue` to pick up actions without waiting (for example after a
cancel or a restart).

## Evidence screenshots

Before a screenshot that should show the plain page, call `hide_overlays(true)`; call
`hide_overlays(false)` right after. The side panel is never in page screenshots.

## Troubleshooting

- `extensionConnected: false`: call `start_browser` again; the extension reconnects within ~15 s.
  Panel clicks made while disconnected are buffered and delivered later.
- `bridge not running`: the demonstrate MCP is not attached; `node "$D\bridge" start` and
  `node "$D\bridge" wait` still work on their own (wait serves the bridge itself while it waits).
- playwright-demo fails with `ECONNREFUSED 127.0.0.1:9334`: the browser is not running; call
  `start_browser`, then retry.
- A playwright-demo locator times out on an element you can see: the current tab is the side panel.
  Select the app tab (step 3) and retry.
- Several OpenCode sessions each start a bridge; one owns port 47613 and a bridge with newer code
  takes it over automatically. One browser serves one tour at a time: if `status` shows a step you did
  not set, another session is touring, so ask the user before `load_tour`.
- Chrome for Testing missing: `npx playwright install chromium`, or set `DEMO_BROWSER_PATH`.
