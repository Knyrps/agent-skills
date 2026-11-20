# Review videos with record_tour

A video is a scripted tour that plays by itself while the tab is recorded. Read this before writing one.

## What ends up in the video

- **Intro card**: `tour.title`, then `tour.subtitle` or today's date and `branding.name`.
- **Section slide**: when a step's `section` differs from the previous one ("Section 2 of 3 · Checkout").
- **Caption block** (bottom centre) on every step: the chapter ("2 · Title") above the step's `caption`,
  else its `explanation`, split into pages of whole sentences and shown at reading pace. The same text goes
  to the `.vtt`. A **progress bar** (bottom edge, one tick per chapter) shows where the video is.
- **Drawn pointer**: an arrow cursor for mouse actions, a finger dot for touch actions (`swipe`,
  `longPress`). It glides to each target, presses with a ripple, types character by character, scrolls
  smoothly and leaves a trail on swipes and drags.
- **Highlights** from `highlights[]`, including looping gesture illustrations.
- **Outro card**: the chapter list with times, plus `branding.footer`.

Page loads are cut out. The real mouse and keyboard are blocked while recording; Esc in the page or
**Stop and save** in the panel stops it and keeps what was recorded (`partial: true`), **Discard** deletes it.

## Step fields for videos

| Field | Meaning |
| --- | --- |
| `caption` | Text for the video instead of `explanation`; `false` = no caption |
| `dwell` | ms the step stays on screen; default is the reading time of the caption |
| `section` | Section name; a slide appears when it changes |
| `video: false` | The step runs off camera (sign-ins, resets) |
| `cpu` | CPU slowdown from this step on (`4`, `6`; `1` ends it), e.g. to show how the page feels on a slow device |
| `network` | Throttle from this step on: `fast-4g`, `slow-4g`, `3g`, `offline`, `off`. Full page loads are cut out of the video, so it shows what loads within a page (spinners, lazy lists, offline messages) |

## Actions

| Action | Shown as |
| --- | --- |
| `{ click: css, text? }` | cursor glides there and clicks |
| `{ doubleClick: css }`, `{ rightClick: css }` | double click, right click (opens `contextmenu`) |
| `{ hover: css, ms? }` | cursor rests on the element |
| `{ fill: css, value }` | click, then typing; `<select>` picks the option by value or label |
| `{ press: "Enter", on?: css }` | key press; Enter on an input submits its form |
| `{ scroll: css }` | smooth scroll until the element is in view |
| `{ scrollBy: 400, in?: css }` | smooth scroll of the page or a container (`{x, y}` for both axes) |
| `{ swipe: css, direction }` or `{ swipe: css, to: css }` | finger swipe; scrolls the container under it |
| `{ longPress: css, ms? }` | finger hold with a filling ring |
| `{ drag: css, to: css }` | press, move with a trail, drop (HTML5 drag events when draggable) |
| `{ drag: css, by: [dx, dy], in?: css }` | drag by an offset, e.g. a slider handle; `"40%"` is relative to the `in` element (default: the parent) |
| `{ waitForTab: ms }` | after an action that opens a tab or popup window: the video moves there, and a Chrome-style tab strip slides in at the top: the tab it came from and the new one side by side, each with its icon and title ("New tab" / "Popup window"). A popup of another size is letterboxed |
| `{ backToTab: "previous" \| "home", close?: true }` | back to the tab before (or the first one), with a "Back to" tab chip; `close` closes the tab it leaves |

A step that opens a tab without `waitForTab` ends the video with `videoError`: it would happen off camera.
| `{ waitFor: css, text? }`, `{ wait: ms }` | waits, nothing shown |

Every action takes `after` (ms of pause afterwards); clicks and drags take `touch: true` to show a finger instead of the cursor (phone-sized videos). Actions use synthetic events: CSS `:hover` styles
and native touch scrolling do not react to them. Show such effects with a highlight instead.

## Writing a good review video

- One idea per step, 1–3 sentences of caption. Captions are read, not skimmed: around 12 words a page.
- Start every section with a step that has a `url`, so a failure can be rerun from there.
- Keep sign-ins off camera (`video: false`) or done before recording; the demo profile keeps sessions.
- Use real-looking but non-sensitive data. Everything visible ends up in the file.
- Prefer showing the result of an action with a highlight and a short `label`.
- `pace` scales all reading times (1.2 for customers new to the app).

## Options and output

`record_tour({ tour, name?, size?, pace?, captions?, cards?, zoom?, hidpi?, out? })`

- `size`: `auto` (largest of 1080p/900p/720p that fits the screen 1:1), a preset, or `WIDTHxHEIGHT`.
- `zoom`: page zoom while recording. On a 125 % screen, `0.8` shows a 1280×720 video at the page's 1:1
  desktop layout instead of a cramped 1024×576 one. Chrome keeps zoom per site; it is restored afterwards.
- `hidpi` (default true): Chrome renders the tab at a higher pixel density, so the file gets up to 1080
  lines of real detail (at most twice the window's pixels): a 1280×720 window becomes a sharp 1920×1080 video.
- `captions: false`: no captions in the picture and no `.vtt`. `cards: false`: no intro, section or outro.
- `out`: also copy the video and its sidecars to this file or folder.
- Files land in the bridge's data folder (`videos/`) and are deleted after 14 days: `<name>.mp4`,
  `<name>.vtt`, `<name>.chapters.txt` (YouTube chapter format) and `<name>.json` (manifest).

`videoReady` carries `path`, `vtt`, `chaptersPath`, `chapters[]`, `durationMs`, `width`, `height`, `bytes`,
`partial`, `copiedTo`. Report the path and length to the user; never inline the video.

## Branding

`extension/config.local.json` (git-ignored) sets it per machine, then restart the browser:

```json
{ "allowlist": ["*.customer.local"],
  "branding": { "name": "Customer GmbH", "logo": "local/logo.svg", "accent": "#00589c", "footer": "Feedback to …" } }
```

`logo` is a file under `extension/` (put it in the git-ignored `extension/local/`), an `https:` URL or a
data URL. `accent` replaces the primary colour of cards, chapter label, progress bar and pointer marks.
