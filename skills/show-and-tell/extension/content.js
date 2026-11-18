// In-page layer, top frame only, allowlisted hosts only: draws the agent's highlights, records
// "Record" and runs "Annotate". Everything sits in a closed shadow root with pointer-events: none and is
// only attached while something is visible. The controls themselves live in the side panel.
(() => {
  if (window.top !== window || window.__showAndTell) return;
  window.__showAndTell = true;

  const S = chrome.storage.session;
  const DEFAULT_COLOR = '#0b57d0'; // Chrome GM3 primary
  const HOST_STYLE = 'all:initial!important;display:block!important;position:fixed!important;inset:0!important;'
    + 'width:100vw!important;height:100vh!important;margin:0!important;padding:0!important;border:0!important;'
    + 'background:transparent!important;overflow:visible!important;pointer-events:none!important;z-index:2147483647!important;';
  // Material 3 styling modelled on Chrome's in-product-help bubbles: primary focus ring,
  // primary-container callout with level-3 elevation, 32% scrim for the spotlight.
  const FONT = 'system-ui,"Segoe UI",Roboto,sans-serif';
  const STYLES = `
    .box{position:fixed;left:0;top:0;box-sizing:border-box;border:2px solid var(--c);border-radius:12px;
      box-shadow:0 0 0 2px #fff,0 0 0 0 color-mix(in srgb,var(--c) 40%,transparent);animation:ring 1.6s cubic-bezier(.2,0,0,1) 3}
    @keyframes ring{from{box-shadow:0 0 0 2px #fff,0 0 0 2px color-mix(in srgb,var(--c) 45%,transparent)}
      to{box-shadow:0 0 0 2px #fff,0 0 0 16px transparent}}
    .label{position:fixed;left:0;top:0;box-sizing:border-box;max-width:min(320px,calc(100vw - 8px));padding:12px 16px;
      border-radius:12px;background:var(--c);color:#fff;font:500 14px/20px ${FONT};letter-spacing:.1px;
      box-shadow:0 1px 3px rgb(0 0 0/.3),0 4px 8px 3px rgb(0 0 0/.15);white-space:pre-wrap;overflow-wrap:anywhere;
      animation:pop .2s cubic-bezier(.2,0,0,1)}
    @keyframes pop{from{scale:.92}}
    .dim{position:fixed;left:0;top:0;width:100vw;height:100vh}
    .dim path{fill:rgb(0 0 0/.32)}
    .pick{position:fixed;left:0;top:0;box-sizing:border-box;border:2px dashed var(--md-sys-color-primary,#0b57d0);
      background:color-mix(in srgb,var(--md-sys-color-primary,#0b57d0) 8%,transparent);border-radius:8px}
    .pick-tag{position:fixed;left:0;top:0;padding:4px 8px;border-radius:4px;background:var(--md-sys-color-inverse-surface,#2f3036);
      color:var(--md-sys-color-inverse-on-surface,#f1f0f7);
      font:500 12px/16px ${FONT};letter-spacing:.5px;white-space:nowrap;
      box-shadow:0 1px 2px rgb(0 0 0/.3),0 1px 3px 1px rgb(0 0 0/.15)}
    .annot{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;touch-action:none;
      font:400 14px/20px ${FONT};-webkit-font-smoothing:antialiased}
    .mark{position:fixed;left:0;top:0;width:100vw;height:100vh;overflow:visible;pointer-events:none;
      filter:drop-shadow(0 1px 1.5px rgb(0 0 0/.28))}
    .mark .halo{fill:none;stroke:var(--md-sys-color-surface,#fff);stroke-opacity:.92;stroke-width:7;stroke-linecap:round;stroke-linejoin:round}
    .mark path.halo{fill:var(--md-sys-color-surface,#fff);fill-opacity:0}
    .mark .line{fill:none;stroke:var(--c);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
    .mark .area{fill:color-mix(in srgb,var(--c) 7%,transparent)}
    .mark .el{fill:color-mix(in srgb,var(--c) 14%,transparent);stroke-width:2.5}
    .mark .head{fill:var(--c);stroke:var(--c);stroke-width:2;stroke-linejoin:round}
    .mark .badge{pointer-events:auto;cursor:pointer}
    .mark .badge circle{fill:var(--c);stroke:var(--md-sys-color-surface,#fff);stroke-width:2;transition:r .12s cubic-bezier(.2,0,0,1)}
    .mark .badge:hover circle{r:13}
    .mark .badge text{fill:var(--on,#fff);font:600 12px ${FONT};text-anchor:middle;dominant-baseline:central;pointer-events:none}
    .note,.note-edit{position:fixed;left:0;top:0;box-sizing:border-box;display:flex;align-items:flex-start;gap:8px;
      color:var(--md-sys-color-on-surface,#1a1b21);transform-origin:17px 17px;animation:grow .18s cubic-bezier(.2,0,0,1)}
    .note.left,.note-edit.left{flex-direction:row-reverse}
    .note.up,.note-edit.up{align-items:flex-end;transform-origin:17px calc(100% - 17px)}
    .note.left,.note-edit.left{transform-origin:calc(100% - 17px) 17px}
    .note.left.up,.note-edit.left.up{transform-origin:calc(100% - 17px) calc(100% - 17px)}
    @keyframes grow{from{scale:.6;opacity:0}}
    .note .num,.note-edit .num{flex:none;width:22px;height:22px;border-radius:50%;background:var(--c);color:var(--on,#fff);
      box-shadow:0 0 0 1px var(--md-sys-color-surface,#fff);font:600 12px/22px ${FONT};text-align:center}
    .note{max-width:280px;min-height:34px;padding:6px 14px 6px 6px;border-radius:17px;cursor:pointer;
      background:var(--note-bg);
      box-shadow:0 1px 2px rgb(0 0 0/.3),0 2px 6px 2px rgb(0 0 0/.15)}
    .note.left{padding:6px 6px 6px 14px}
    :host{--note-bg:var(--md-sys-color-surface-container-lowest,#fff)}
    :host(.dark){--note-bg:var(--md-sys-color-surface-container-high,#282a2f)}
    .note::before{content:'';position:absolute;inset:0;border-radius:inherit;background:currentColor;opacity:0;transition:opacity .15s}
    .note:hover::before{opacity:.08}
    .note .text{min-width:0;padding-top:1px;font:400 14px/20px ${FONT};letter-spacing:.25px;white-space:pre-wrap;overflow-wrap:anywhere}
    .note-edit{width:320px;padding:6px;border-radius:16px;cursor:default;
      background:var(--md-sys-color-surface-container-high,#e8e7ef);
      box-shadow:0 1px 3px rgb(0 0 0/.3),0 4px 8px 3px rgb(0 0 0/.15)}
    .note-edit .field{flex:1;min-width:0}
    .note-edit input{all:unset;box-sizing:border-box;display:block;width:100%;padding:6px 12px 4px;border-radius:4px 4px 0 0;
      background:var(--md-sys-color-surface-container-highest,#e2e2e9);border-bottom:2px solid var(--c);
      font:400 14px/20px ${FONT};letter-spacing:.25px;color:inherit;cursor:text;caret-color:var(--c)}
    .note-edit input::placeholder{color:var(--md-sys-color-on-surface-variant,#45464f)}
    .note-edit .help{padding:4px 12px 0;font:400 11px/16px ${FONT};letter-spacing:.4px;color:var(--md-sys-color-on-surface-variant,#45464f)}
    .note-edit .del{all:unset;position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;
      width:32px;height:32px;border-radius:50%;color:var(--md-sys-color-on-surface-variant,#45464f);cursor:pointer}
    .note-edit .del::before{content:'';position:absolute;inset:0;border-radius:inherit;background:currentColor;opacity:0;transition:opacity .15s}
    .note-edit .del:hover::before{opacity:.08}
    .note-edit .del:focus-visible{outline:3px solid var(--md-sys-color-secondary,#585e71);outline-offset:1px}
    .note-edit .del svg{width:20px;height:20px;fill:currentColor}
    .bar{position:fixed;top:16px;left:50%;translate:-50% 0;display:flex;align-items:center;gap:4px;padding:8px;border-radius:999px;
      background:var(--md-sys-color-surface-container,#eeedf4);color:var(--md-sys-color-on-surface-variant,#45464f);
      box-shadow:0 1px 3px rgb(0 0 0/.3),0 4px 8px 3px rgb(0 0 0/.15);cursor:default;user-select:none}
    .bar button{all:unset;position:relative;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:8px;
      height:40px;min-width:40px;border-radius:999px;color:inherit;cursor:pointer;font:500 14px/20px ${FONT};letter-spacing:.1px}
    .bar button::before{content:'';position:absolute;inset:0;border-radius:inherit;background:currentColor;opacity:0;transition:opacity .15s}
    .bar button:hover::before{opacity:.08}
    .bar button:active::before{opacity:.12}
    .bar button:focus-visible{outline:3px solid var(--md-sys-color-secondary,#585e71);outline-offset:2px}
    .bar button:disabled{cursor:default;opacity:.38}
    .bar button:disabled::before{opacity:0}
    .bar button.on{background:var(--md-sys-color-secondary-container,#c2e7ff);color:var(--md-sys-color-on-secondary-container,#001d35)}
    .bar button.filled{padding:0 20px 0 14px;margin-left:4px;background:var(--md-sys-color-primary,#0b57d0);color:var(--md-sys-color-on-primary,#fff)}
    .bar button.filled:disabled{opacity:1;background:color-mix(in srgb,var(--md-sys-color-on-surface,#1a1b21) 12%,transparent);
      color:color-mix(in srgb,var(--md-sys-color-on-surface,#1a1b21) 38%,transparent)}
    .bar svg{width:20px;height:20px;fill:currentColor;flex:none}
    .bar .hint{padding:0 8px 0 4px;font:400 12px/16px ${FONT};letter-spacing:.4px;white-space:nowrap}
    .bar .sep{width:1px;height:24px;background:var(--md-sys-color-outline-variant,#c5c6d0);margin:0 4px}
    .annot [data-tip]:hover::after{z-index:1;content:attr(data-tip);position:absolute;top:calc(100% + 12px);left:50%;translate:-50% 0;
      padding:4px 8px;border-radius:4px;background:var(--md-sys-color-inverse-surface,#2f3036);color:var(--md-sys-color-inverse-on-surface,#f1f0f7);
      font:400 12px/16px ${FONT};letter-spacing:.4px;white-space:nowrap;pointer-events:none}
    @media (max-width:680px){.bar .hint{display:none}.bar{gap:0;padding:6px}}`;

  let highlights = [], hidden = false, hoverEl = null, raf = 0, annotating = null, suspended = false;
  // The panel's Material colour tokens, scoped to the overlay's shadow root. The overlay sits on the page,
  // so it takes the page's lightness (host class "dark"), not the system theme.
  const tokens = fetch(chrome.runtime.getURL('vendor/m3-tokens.css')).then(r => r.text()).then(css => {
    const [light, dark = light] = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map(m => m[1]);
    return `:host{${light}}:host(.dark){${dark}}`;
  }).catch(() => '');

  function pageIsDark() {
    for (const el of [document.body, document.documentElement]) {
      const c = el && getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (c && (c[3] ?? 1) > 0.5) return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 < 0.45;
    }
    return getComputedStyle(document.documentElement).colorScheme.includes('dark') && matchMedia('(prefers-color-scheme: dark)').matches;
  }
  let host = null, root = null, dim = null, pickBox = null, pickTag = null, boxLayer = null, labelLayer = null;
  const cache = new Map(); // highlight id -> { key, el, count, error, t }
  const nodes = new Map(); // highlight id -> { box, label, sig }
  const show = (el, on) => { el.style.display = on ? '' : 'none'; };
  const here = () => location.origin + location.pathname;
  const G = globalThis.__showAndTellGestures; // gestures.js, loaded first
  const busy = () => G.pointer.active || !!globalThis.__showAndTellStage?.active;

  chrome.runtime.sendMessage({ type: 'hello', url: location.href })
    .then(r => { if (r?.allowed) init(); }).catch(() => {});

  function init() {
    load();
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'session' && (ch.highlights || ch.overlaysHidden)) load();
      if (area === 'session' && ch.recording) setRecording(!!ch.recording.newValue);
    });
    S.get('recording').then(s => setRecording(!!s.recording));
    chrome.runtime.onMessage.addListener(onMessage);
    setInterval(kick, 500); // picks up SPA route changes and top-layer changes
  }

  // ---------------------------------------------------------------- "Record" recorder
  // Watches what the user does without interfering and hands each step to the worker, which keeps
  // the recording across page loads. Steps follow Chrome DevTools Recorder's format where one exists.

  let recording = false, down = null, skipClickUntil = 0, scrollTimer = 0;
  const REC_EVENTS = { pointerdown: onRecDown, pointerup: onRecUp, click: onRecClick, dblclick: onRecDblClick,
    contextmenu: onRecContextMenu, change: onRecChange, keydown: onRecKey, focusin: onRecFocus, focusout: onRecBlur };

  function setRecording(on) {
    if (on === recording) return;
    recording = on;
    for (const [t, fn] of Object.entries(REC_EVENTS)) (on ? addEventListener : removeEventListener)(t, fn, true);
    (on ? addEventListener : removeEventListener)('scroll', onRecScroll, true);
  }

  const recStep = step => chrome.runtime.sendMessage({ type: 'recStep', step: { ...step, url: location.href, ts: Date.now() } }).catch(() => {});
  const ours = e => annotating || e.target === host || !(e.target instanceof Element);

  function target(el) {
    const d = describe(el);
    return { selectors: [[d.selector]], tag: d.tag, text: d.text.slice(0, 80) };
  }

  function onRecDown(e) {
    if (ours(e)) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now(), el: e.target, pointerType: e.pointerType, button: e.button };
  }

  // A pointer moved far between down and up is a swipe or drag; one held still is a long press.
  function onRecUp(e) {
    if (!down || ours(e)) { down = null; return; }
    const dx = e.clientX - down.x, dy = e.clientY - down.y, duration = Math.round(performance.now() - down.t);
    if (Math.hypot(dx, dy) > 30) {
      const to = document.elementFromPoint(e.clientX, e.clientY) || e.target;
      recStep({ type: 'swipe', pointerType: down.pointerType, from: { ...target(down.el), x: Math.round(down.x), y: Math.round(down.y) },
        to: { ...target(to), x: Math.round(e.clientX), y: Math.round(e.clientY) },
        direction: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'), duration });
      skipClickUntil = performance.now() + 300;
    } else if (down.button === 0 && duration > 600) {
      recStep({ type: 'longPress', pointerType: down.pointerType, ...target(down.el), duration });
      skipClickUntil = performance.now() + 300;
    }
    down = null;
  }

  function clickStep(e, extra) {
    const r = e.target.getBoundingClientRect();
    recStep({ type: 'click', ...target(e.target), offsetX: Math.round(e.clientX - r.left), offsetY: Math.round(e.clientY - r.top), ...extra });
  }

  function onRecClick(e) {
    if (ours(e) || performance.now() < skipClickUntil) return;
    flushTyping();
    clickStep(e, modifiers(e));
  }

  // The two clicks of a double click are already recorded; this marks them as one gesture.
  function onRecDblClick(e) {
    if (ours(e)) return;
    recStep({ type: 'doubleClick', ...target(e.target) });
  }

  function onRecContextMenu(e) {
    if (ours(e)) return;
    clickStep(e, { button: 'secondary', ...modifiers(e) });
  }

  const modifiers = e => {
    const m = ['ctrlKey', 'shiftKey', 'altKey', 'metaKey'].filter(k => e[k]).map(k => k.replace('Key', ''));
    return m.length ? { modifiers: m } : {};
  };

  // Typing: what a field holds when the user leaves it, presses a key that acts on it (Enter, Tab,
  // a shortcut) or clicks elsewhere - whichever comes first, reported once per value.
  let typing = null; // { el, value }
  const textValue = el => el.isContentEditable ? el.innerText : el.value;
  const isText = el => el.isContentEditable || (el.tagName === 'TEXTAREA')
    || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color'].includes(el.type));

  function onRecFocus(e) {
    if (ours(e)) return;
    flushTyping();
    typing = isText(e.target) ? { el: e.target, value: textValue(e.target) } : null;
  }

  function onRecBlur(e) {
    if (typing && e.target === typing.el) flushTyping();
  }

  function flushTyping() {
    if (!typing?.el.isConnected) { typing = null; return; }
    const value = textValue(typing.el);
    if (value === typing.value) return;
    typing.value = value;
    recStep({ type: 'change', ...target(typing.el), value: typing.el.type === 'password' ? '•••' : String(value ?? '') });
  }

  // Checkboxes and radios are covered by their click, text fields by flushTyping.
  function onRecChange(e) {
    const el = e.target;
    if (ours(e) || el.type === 'checkbox' || el.type === 'radio') return;
    if (isText(el)) { if (typing?.el === el) flushTyping(); return; }
    const value = el.tagName === 'SELECT' ? [...el.selectedOptions].map(o => o.value).join(',') : String(el.value ?? '');
    recStep({ type: 'change', ...target(el), value,
      ...(el.tagName === 'SELECT' && { label: [...el.selectedOptions].map(o => o.text.trim()).join(', ') }) });
  }

  const KEYS = ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Delete'];

  function onRecKey(e) {
    if (ours(e) || ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    const shortcut = e.ctrlKey || e.altKey || e.metaKey;
    if (!shortcut && !KEYS.includes(e.key)) return;
    flushTyping();
    recStep({ type: 'keyDown', key: e.key, ...modifiers(e), ...target(e.target) });
  }

  // What the visitor scrolled to: the nearest element around the screen centre that says something.
  function inView(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n === host) return {};
      if ((n.innerText || '').trim()) return { inView: target(n) };
    }
    return {};
  }

  // Scrolling settles into one step: where the page (or a scroll container) ended up.
  function onRecScroll(e) {
    clearTimeout(scrollTimer);
    const el = e.target === document ? null : e.target;
    scrollTimer = setTimeout(() => {
      const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      recStep(el instanceof Element
        ? { type: 'scroll', ...target(el), x: Math.round(el.scrollLeft), y: Math.round(el.scrollTop) }
        : { type: 'scroll', x: Math.round(scrollX), y: Math.round(scrollY), ...inView(center) });
    }, 600);
  }

  async function load() {
    const s = await S.get(['highlights', 'overlaysHidden']);
    highlights = Array.isArray(s.highlights) ? s.highlights : [];
    hidden = !!s.overlaysHidden;
    for (const id of cache.keys()) if (!highlights.some(h => h.id === id)) cache.delete(id);
    kick();
  }

  const visible = () => (hidden ? [] : highlights.filter(h => h.pageKey === here()));

  function kick() {
    if (suspended) return;
    const needed = visible().length > 0 || !!annotating || busy();
    if (!needed) { unmount(); return; }
    mount();
    // a page dialog/popover opened after us would cover the overlay: move back to the top
    if (host.matches(':popover-open') && document.querySelector('dialog[open]:modal, :popover-open:not(show-and-tell-overlay)')) {
      try { host.hidePopover(); host.showPopover(); } catch {}
    }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function mount() {
    if (!host) {
      host = document.createElement('show-and-tell-overlay');
      host.setAttribute('aria-hidden', 'true');
      host.setAttribute('style', HOST_STYLE);
      host.popover = 'manual';
      root = host.attachShadow({ mode: 'closed' });
      // Paint order = DOM order: scrim, every box, every callout, picker. A later box can never cover
      // an earlier callout.
      root.innerHTML = `<style class="tokens"></style><style>${STYLES}</style><svg class="dim"><path fill-rule="evenodd"/></svg>`
        + '<div class="boxes"></div><div class="labels"></div><div class="pick"></div><div class="pick-tag"></div>';
      [dim, pickBox, pickTag] = [root.querySelector('.dim'), root.querySelector('.pick'), root.querySelector('.pick-tag')];
      [boxLayer, labelLayer] = [root.querySelector('.boxes'), root.querySelector('.labels')];
      const style = root.querySelector('.tokens');
      tokens.then(css => { style.textContent = css; });
      G.attach(root, labelLayer);
    }
    if (!host.isConnected) {
      document.documentElement.appendChild(host);
      try { host.showPopover(); } catch {} // top layer, above page modals
    }
  }

  function unmount() { globalThis.__showAndTellBoxes = []; if (host?.isConnected) host.remove(); }

  // ---------------------------------------------------------------- highlights

  function find(h) {
    let list;
    try { list = [...document.querySelectorAll(h.selector)]; } catch { return { el: null, count: 0, error: 'invalid CSS selector' }; }
    if (h.text) {
      const t = h.text.toLowerCase();
      list = list.filter(n => (n.innerText || n.textContent || '').toLowerCase().includes(t));
      list = list.filter(n => !list.some(o => o !== n && n.contains(o))); // innermost match only
    }
    const vis = list.find(n => { const r = n.getBoundingClientRect(); return r.width > 0 || r.height > 0; });
    return { el: vis || list[0] || null, count: list.length };
  }

  // Client centre of the first visible match, for a gesture's end point.
  function centre(selector) {
    const r = find({ selector, text: '' }).el?.getBoundingClientRect();
    return r && (r.width || r.height) ? [r.left + r.width / 2, r.top + r.height / 2] : null;
  }

  function resolve(h) {
    const key = h.selector + '\n' + h.text;
    const now = performance.now();
    let c = cache.get(h.id);
    if (!c || c.key !== key || !c.el?.isConnected || now - c.t > 1000) {
      c = { key, t: now, ...find(h) };
      cache.set(h.id, c);
    }
    return c;
  }

  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  // Each callout tries below, above, right, left of its element: first a spot clear of every other
  // callout and every other box, then one clear of callouts only; failing both it stacks below the
  // callouts it would hit.
  function placeCallouts(callouts, boxes, W, H) {
    const placed = [], gap = 10, m = 4;
    const clamp = (r, lw, lh) => ({ x: Math.min(Math.max(m, r.x), W - lw - m), y: Math.min(Math.max(m, r.y), H - lh - m), w: lw, h: lh });
    for (const c of callouts) {
      const lw = c.n.label.offsetWidth, lh = c.n.label.offsetHeight;
      const candidates = [
        { x: c.x, y: c.y + c.h + gap }, { x: c.x, y: c.y - gap - lh },
        { x: c.x + c.w + gap, y: c.y }, { x: c.x - gap - lw, y: c.y },
      ].map(r => clamp(r, lw, lh)).filter(r => !overlaps(r, c));
      const others = boxes.filter(b => b.id !== c.id);
      let spot = candidates.find(r => !placed.some(p => overlaps(r, p)) && !others.some(b => overlaps(r, b)))
        || candidates.find(r => !placed.some(p => overlaps(r, p)));
      if (!spot) {
        spot = clamp({ x: c.x, y: c.y + c.h + gap }, lw, lh);
        for (let i = 0; i < placed.length && placed.some(p => overlaps(spot, p)); i++) {
          spot = { ...spot, y: Math.max(...placed.filter(p => overlaps(spot, p)).map(p => p.y + p.h + 6)) };
        }
      }
      placed.push(spot);
      c.n.label.style.transform = `translate(${spot.x}px,${spot.y}px)`;
    }
  }

  function frame() {
    raf = 0;
    if (suspended) return;
    const list = visible();
    if (!list.length && !annotating && !busy()) { unmount(); return; }
    mount();
    const W = innerWidth, H = innerHeight;
    let holes = '';
    const live = new Set();
    const boxes = [], callouts = [], gestures = [];
    for (const h of list) {
      live.add(h.id);
      let n = nodes.get(h.id);
      const sig = h.label + '\n' + (h.color || DEFAULT_COLOR);
      if (!n) {
        n = { box: document.createElement('div'), label: document.createElement('div') };
        n.box.className = 'box'; n.label.className = 'label';
        boxLayer.append(n.box);
        labelLayer.append(n.label);
        nodes.set(h.id, n);
      }
      if (n.sig !== sig) {
        n.sig = sig;
        n.box.style.setProperty('--c', h.color || DEFAULT_COLOR);
        n.label.style.setProperty('--c', h.color || DEFAULT_COLOR);
        n.label.textContent = h.label;
      }
      const el = resolve(h).el;
      const r = el?.getBoundingClientRect();
      if (!r || (r.width === 0 && r.height === 0)) { show(n.box, false); show(n.label, false); continue; }
      const p = 4, x = r.left - p, y = r.top - p, w = r.width + 2 * p, bh = r.height + 2 * p;
      show(n.box, h.style !== 'none');
      n.box.style.transform = `translate(${x}px,${y}px)`;
      n.box.style.width = w + 'px';
      n.box.style.height = bh + 'px';
      if (h.style === 'spotlight') holes += `M${x} ${y}h${w}v${bh}h${-w}z`;
      boxes.push({ id: h.id, x, y, w, h: bh });
      show(n.label, !!h.label);
      if (h.label) callouts.push({ n, id: h.id, x, y, w, h: bh });
      if (h.gesture) gestures.push({ id: h.id, kind: h.gesture, dir: h.direction, color: h.color || DEFAULT_COLOR,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height }, to: h.to ? centre(h.to) : null });
    }
    placeCallouts(callouts, boxes, W, H);
    globalThis.__showAndTellBoxes = boxes; // the video stage moves its caption off highlighted elements
    G.sync(gestures);
    for (const [id, n] of nodes) if (!live.has(id)) { n.box.remove(); n.label.remove(); nodes.delete(id); }
    show(dim, !!holes);
    if (holes) {
      dim.setAttribute('viewBox', `0 0 ${W} ${H}`);
      dim.firstElementChild.setAttribute('d', `M0 0H${W}V${H}H0z${holes}`);
    }
    const pr = annotating && hoverEl?.isConnected && hoverEl.getBoundingClientRect();
    show(pickBox, !!pr); show(pickTag, !!pr);
    if (pr) {
      pickBox.style.transform = `translate(${pr.left}px,${pr.top}px)`;
      pickBox.style.width = pr.width + 'px';
      pickBox.style.height = pr.height + 'px';
      pickTag.textContent = describeShort(hoverEl);
      pickTag.style.transform = `translate(${Math.max(0, pr.left)}px,${pr.top > 26 ? pr.top - 26 : pr.bottom + 4}px)`;
    }
    if (annot) renderAnnot();
    raf = requestAnimationFrame(frame);
  }

  async function probe(m) {
    await load();
    const h = highlights.find(x => x.id === m.id);
    if (!h) return { found: false, error: 'unknown highlight id' };
    if (h.pageKey !== here()) return { found: false, error: 'highlight belongs to another page' };
    cache.delete(h.id);
    const c = resolve(h);
    if (c.error) return { found: false, error: c.error };
    if (!c.el) return { found: false, count: 0, note: 'no element matches yet; the highlight appears when one does' };
    const r = c.el.getBoundingClientRect();
    if (m.scroll && (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth)) {
      const el = c.el, before = el.getBoundingClientRect().top;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      // smooth scrolling stalls while the window is occluded; jump if it has not started
      setTimeout(() => {
        if (el.isConnected && Math.abs(el.getBoundingClientRect().top - before) < 1) {
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        }
      }, 400);
    }
    return { found: true, count: c.count, element: describeShort(c.el), visible: r.width > 0 || r.height > 0 };
  }

  function describeShort(el) {
    const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}>${t ? ' ' + t : ''}`;
  }

  function describe(el) {
    const r = el.getBoundingClientRect();
    return {
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
      rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) },
      outerHTML: el.outerHTML.slice(0, 1000),
    };
  }

  const ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-id', 'aria-label', 'name', 'title'];
  const unique = sel => { try { return document.querySelectorAll(sel).length === 1; } catch { return false; } };
  const stableId = id => id && id.length < 64 && !/\d{3,}|^[a-f0-9-]{8,}$|^(ember|react|radix|mui|headlessui)|^:r|[:]/i.test(id);

  // Shortest unique path, anchored on stable ids / test attributes / aria where available.
  function cssPath(el) {
    let path = '';
    const join = s => (path ? s + ' > ' + path : s);
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      let seg = null;
      if (stableId(n.id)) seg = '#' + CSS.escape(n.id);
      else for (const a of ATTRS) {
        const v = n.getAttribute(a);
        if (v && v.length < 80) { seg = `${tag}[${a}="${CSS.escape(v)}"]`; break; }
      }
      if (seg && unique(join(seg))) return join(seg);
      seg ||= tag;
      const parent = n.parentElement;
      if (parent && !unique(join(seg))) {
        const same = [...parent.children].filter(c => c.tagName === n.tagName);
        if (same.length > 1) seg += `:nth-of-type(${same.indexOf(n) + 1})`;
      }
      path = join(seg);
      if (unique(path)) return path;
    }
    return path;
  }

  // ---------------------------------------------------------------- messages from the worker

  // ---------------------------------------------------------------- scripted tour step actions

  const pause = ms => new Promise(r => setTimeout(r, ms));

  async function waitFor(a, timeout = 15000) {
    const end = performance.now() + timeout;
    for (;;) {
      const { el, error } = find({ selector: a.selector, text: a.text || '' });
      if (error) throw new Error(`${a.selector}: ${error}`);
      if (el) return el;
      if (performance.now() > end) throw new Error(`element not found: ${a.selector}${a.text ? ' "' + a.text + '"' : ''}`);
      await pause(200);
    }
  }

  // Actions: { click | fill | waitFor | hover | doubleClick | rightClick | longPress | swipe | drag | scroll: selector,
  // text?, value?, to?, direction?, distance?, ms?, after? }, { scrollBy: px | {x, y}, in?: selector },
  // { press: key, on?: selector } or { wait: ms }. Live tours run them at once; a video (`cinematic`) shows a
  // drawn cursor or finger that travels to each target, presses, types and scrolls at watching speed.
  const ACTIONS = ['click', 'fill', 'waitFor', 'hover', 'doubleClick', 'rightClick', 'longPress', 'swipe', 'drag', 'scroll'];
  const P = G.pointer;
  let film = false, hovered = null, tint = DEFAULT_COLOR;

  const evt = (el, type, x, y, o = {}) => {
    const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y,
      button: o.button ?? 0, buttons: o.buttons ?? 0, detail: o.detail ?? 0 };
    if (type.startsWith('pointer')) return el.dispatchEvent(new PointerEvent(type, { ...init, pointerId: o.touch ? 2 : 1,
      pointerType: o.touch ? 'touch' : 'mouse', isPrimary: true, width: o.touch ? 20 : 1, height: o.touch ? 20 : 1 }));
    return el.dispatchEvent(new MouseEvent(type, init));
  };
  // The element a real pointer at (x, y) would hit, if it belongs to the target; else the target itself.
  const hit = (el, x, y) => { const h = pageElementAt(x, y); return h && (h === el || el.contains(h)) ? h : el; };
  const mid = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  // In a video the caption block covers the bottom of the window.
  const onScreen = r => r.top >= (film ? 24 : 0) && r.bottom <= innerHeight - (film ? 170 : 0) && r.left >= 0 && r.right <= innerWidth;

  // Brings the element into view: smoothly with a wheel badge in a video, at once otherwise.
  async function reveal(el, always = false) {
    if (!always && onScreen(el.getBoundingClientRect())) return;
    if (!film) { el.scrollIntoView({ block: 'center', behavior: 'instant' }); return; }
    const before = el.getBoundingClientRect().top;
    P.wheel(before > innerHeight / 2 ? 'down' : 'up');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    let last = NaN;
    for (let i = 0; i < 25; i++) {
      await pause(80);
      const t = el.getBoundingClientRect().top;
      if (Math.abs(t - last) < .5) break;
      last = t;
    }
    if (Math.abs(el.getBoundingClientRect().top - before) < 1 && !onScreen(el.getBoundingClientRect())) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    P.wheel(null);
    await pause(80);
  }

  async function hover(el, x, y, touch) {
    const h = hit(el, x, y);
    if (hovered && hovered !== h && hovered.isConnected) {
      for (const t of ['pointerout', 'pointerleave', 'mouseout', 'mouseleave']) evt(hovered, t, x, y, { touch });
    }
    if (hovered !== h) for (const t of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter']) evt(h, t, x, y, { touch });
    hovered = h;
    evt(h, 'pointermove', x, y, { touch }); if (!touch) evt(h, 'mousemove', x, y);
    return h;
  }

  // Travels to the element: the drawn pointer glides there in a video.
  async function approach(el, touch = false) {
    await reveal(el);
    const [x, y] = mid(el);
    if (film) {
      const shown = P.show({ touch, color: tint });
      kick();
      await shown;
      await P.glide(x, y);
    }
    return [x, y, await hover(el, x, y, touch)];
  }

  async function press(el, x, y, { button = 0, touch = false, count = 1 } = {}) {
    const btn = button === 2 ? 'right' : 'left', buttons = button === 2 ? 2 : 1;
    for (let i = 1; i <= count; i++) {
      if (film) await P.press(btn);
      evt(el, 'pointerdown', x, y, { button, buttons, touch }); evt(el, 'mousedown', x, y, { button, buttons, detail: i });
      if (i === 1 && el.focus && !el.contains(document.activeElement)) (el.closest('a,button,input,select,textarea,[tabindex],[contenteditable]') || el).focus?.({ preventScroll: true });
      if (film) await pause(70);
      evt(el, 'pointerup', x, y, { button, touch }); evt(el, 'mouseup', x, y, { button, detail: i });
      if (film) await P.release();
      if (button === 2) evt(el, 'contextmenu', x, y, { button: 2, buttons: 0 });
      else evt(el, 'click', x, y, { detail: i });
      if (count > 1 && i < count) await pause(film ? 90 : 0);
    }
    if (count === 2) evt(el, 'dblclick', x, y, { detail: 2 });
  }

  function setValue(el, v) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
    if (el.isContentEditable) el.textContent = v; else setter ? setter.call(el, v) : (el.value = v);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: v, inputType: 'insertText' }));
  }

  async function fill(el, value) {
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find(o => o.value === value || o.text.trim() === value);
      if (!opt) throw new Error(`no option "${value}" in ${describeShort(el)}`);
      el.value = opt.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    el.focus({ preventScroll: true });
    if (!film) { setValue(el, value); el.dispatchEvent(new Event('change', { bubbles: true })); return; }
    setValue(el, '');
    let typed = '';
    for (const ch of value) {
      typed += ch;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      setValue(el, typed);
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      await pause(30 + Math.random() * 30);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Scrollable ancestor (or self) along an axis.
  function scroller(el, axis) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n), o = axis === 'x' ? s.overflowX : s.overflowY;
      if (/(auto|scroll|overlay)/.test(o) && (axis === 'x' ? n.scrollWidth > n.clientWidth + 1 : n.scrollHeight > n.clientHeight + 1)) return n;
    }
    return document.scrollingElement;
  }

  const DIR = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

  // A touch swipe: the finger moves across the element; content under it scrolls the other way.
  async function swipe(el, a) {
    const [x, y, h] = await approach(el, true);
    const d = a.to ? null : DIR[a.direction || 'left'];
    if (!d && !a.to) throw new Error('swipe needs direction (left/right/up/down) or to');
    const r = el.getBoundingClientRect(), dist = +a.distance || Math.min(d?.[0] ? r.width * .6 : r.height * .6, 400);
    let end = a.to ? mid(await waitFor({ selector: a.to })) : [x + d[0] * dist, y + d[1] * dist];
    const from = [x - (a.to ? 0 : d[0] * dist / 2), y - (a.to ? 0 : d[1] * dist / 2)];
    if (!a.to) end = [x + d[0] * dist / 2, y + d[1] * dist / 2];
    if (film) await P.glide(...from, 250);
    evt(h, 'pointerdown', ...from, { touch: true, buttons: 1 });
    if (film) { await P.press(); P.trail(true); }
    const sc = d && scroller(el, d[0] ? 'x' : 'y');
    if (sc) sc.scrollBy({ left: -d[0] * dist * 1.4, top: -d[1] * dist * 1.4, behavior: film ? 'smooth' : 'instant' });
    const steps = film ? 12 : 4, ms = film ? 450 : 0;
    const glide = film ? P.glide(...end, ms) : null;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      evt(h, 'pointermove', from[0] + (end[0] - from[0]) * k, from[1] + (end[1] - from[1]) * k, { touch: true, buttons: 1 });
      if (film) await pause(ms / steps);
    }
    await glide;
    evt(h, 'pointerup', ...end, { touch: true });
    if (film) await P.release();
  }

  async function longPress(el, ms = 900) {
    const [x, y, h] = await approach(el, true);
    evt(h, 'pointerdown', x, y, { touch: true, buttons: 1 });
    if (film) { await P.press(); P.hold(ms); }
    await pause(ms);
    evt(h, 'contextmenu', x, y, { button: 0 });
    evt(h, 'pointerup', x, y, { touch: true });
    if (film) await P.release();
  }

  // Mouse drag with pointer events, plus HTML5 drag-and-drop events when the source is draggable.
  // `to` drops on an element; `by: [dx, dy]` moves by an offset (slider handles), in px or as "40%" of
  // the size of the `in` element (or of the dragged element's parent).
  async function drag(el, a) {
    if (!a.to && !Array.isArray(a.by)) throw new Error('drag needs to: selector or by: [dx, dy]');
    const [x, y, h] = await approach(el, !!a.touch);
    let target;
    if (a.to) target = await waitFor({ selector: a.to });
    else {
      const ref = (a.in ? await waitFor({ selector: a.in }) : el.parentElement).getBoundingClientRect();
      const off = (v, size) => (/%$/.test(String(v)) ? parseFloat(v) / 100 * size : +v || 0);
      const p = [x + off(a.by[0], ref.width), y + off(a.by[1], ref.height)];
      target = { point: p };
    }
    evt(h, 'pointerdown', x, y, { buttons: 1 }); evt(h, 'mousedown', x, y, { buttons: 1 });
    if (film) { await P.press(); P.trail(true); }
    const html5 = el.closest('[draggable="true"]');
    const dt = html5 ? new DataTransfer() : null;
    const dragEvt = (n, type, px, py) => n.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: px, clientY: py, dataTransfer: dt }));
    if (html5) dragEvt(html5, 'dragstart', x, y);
    const [tx, ty] = target.point || mid(target), steps = film ? 16 : 4, ms = film ? 650 : 0;
    const glide = film ? P.glide(tx, ty, ms) : null;
    for (let i = 1; i <= steps; i++) {
      const px = x + (tx - x) * i / steps, py = y + (ty - y) * i / steps, under = pageElementAt(px, py) || h;
      evt(under, 'pointermove', px, py, { buttons: 1 }); evt(under, 'mousemove', px, py, { buttons: 1 });
      if (html5 && !target.point) { if (i === steps) dragEvt(target, 'dragenter', px, py); dragEvt(under, 'dragover', px, py); }
      if (film) await pause(ms / steps);
    }
    await glide;
    const drop = target.point ? pageElementAt(tx, ty) || h : hit(target, tx, ty);
    if (html5) { dragEvt(drop, 'drop', tx, ty); dragEvt(html5, 'dragend', tx, ty); }
    evt(drop, 'pointerup', tx, ty); evt(drop, 'mouseup', tx, ty);
    if (film) await P.release();
    hovered = drop;
  }

  async function scrollBy(a) {
    const v = typeof a.scrollBy === 'number' ? { x: 0, y: a.scrollBy } : a.scrollBy;
    const box = a.in ? await waitFor({ selector: a.in }) : null;
    const sc = box ? scroller(box, v.x ? 'x' : 'y') : document.scrollingElement;
    if (film && box) await approach(box);
    if (film) P.wheel(v.y < 0 ? 'up' : v.y > 0 ? 'down' : v.x < 0 ? 'left' : 'right');
    sc.scrollBy({ left: v.x || 0, top: v.y || 0, behavior: film ? 'smooth' : 'instant' });
    if (film) { await pause(Math.min(1500, 300 + Math.hypot(v.x || 0, v.y || 0))); P.wheel(null); }
  }

  async function pressKey(a) {
    const el = a.on ? await waitFor({ selector: a.on }) : document.activeElement || document.body;
    const key = a.press, o = { key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, bubbles: true, cancelable: true };
    const go = el.dispatchEvent(new KeyboardEvent('keydown', o));
    if (key === 'Enter' && go) {
      const form = el.form || el.closest?.('form');
      if (form && el.tagName === 'INPUT') form.requestSubmit ? form.requestSubmit() : form.submit();
      else if (/^(BUTTON|A)$/.test(el.tagName)) el.click();
    }
    el.dispatchEvent(new KeyboardEvent('keyup', o));
  }

  async function runActions(actions, cinematic = false, accent = '') {
    film = cinematic;
    tint = accent || DEFAULT_COLOR;
    if (film && !P.active) {
      const { pointerAt } = await S.get('pointerAt');
      const shown = P.show({ x: pointerAt?.[0] ?? innerWidth * .7, y: pointerAt?.[1] ?? innerHeight * .75 });
      kick();
      await shown;
    }
    try {
      for (const a of actions) {
        if (a.wait) { await pause(+a.wait); continue; }
        if (a.scrollBy != null) { await scrollBy(a); await pause(a.after ?? (film ? 250 : 200)); continue; }
        if (a.press) { if (film) await pause(120); await pressKey(a); await pause(a.after ?? (film ? 350 : 300)); continue; }
        const kind = ACTIONS.find(k => typeof a[k] === 'string');
        if (!kind) throw new Error('unknown action ' + JSON.stringify(a));
        const el = await waitFor({ selector: a[kind], text: a.text }, a.timeout);
        if (kind === 'waitFor') continue;
        if (kind === 'scroll') await reveal(el, true);
        else if (kind === 'swipe') await swipe(el, a);
        else if (kind === 'longPress') await longPress(el, +a.ms || 900);
        else if (kind === 'drag') await drag(el, a);
        else {
          const touch = !!a.touch; // drawn as a finger (phone videos); the events stay mouse-compatible
          const [x, y, h] = await approach(el, touch);
          if (film && kind === 'hover') await pause(+a.ms || 600);
          if (kind === 'click' || kind === 'fill') await press(h, x, y, { touch });
          if (kind === 'doubleClick') await press(h, x, y, { count: 2 });
          if (kind === 'rightClick') await press(h, x, y, { button: 2 });
          if (kind === 'fill') await fill(el, String(a.value ?? ''));
        }
        await pause(a.after ?? (film ? 250 : 300));
      }
    } finally {
      if (film) S.set({ pointerAt: P.at }).catch(() => {});
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------- "Annotate": mark up the page
  // A click marks the element under it, dragging draws a frame, an arrow or a pen stroke; each mark can
  // get a note. Marks are stored relative to what they were drawn on (the document, a fixed layer or a
  // scroll container) and redrawn every frame, so they stay on their content while the user scrolls.
  // "Done" replies with every mark in document coordinates and hides the overlay; the worker captures
  // the page and draws the marks onto the image itself, then clears them with annotateClear.

  const SVG = 'http://www.w3.org/2000/svg';
  // Mark colours: tone 40 with white text on light pages, tone 80 with dark text on dark pages.
  const PALETTE = { light: ['#0b57d0', '#146c2e', '#b3541e', '#7b1fa2', '#00687a', '#a8336a'],
    dark: ['#a8c7fa', '#6dd58c', '#ffb68a', '#e0b6ff', '#5ed5e6', '#ffb0cd'] };
  const ICON = {
    rect: 'M18 4H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H6V6h12v12z',
    arrow: 'M9 5v2h6.59L4 18.59 5.41 20 17 8.41V15h2V5z',
    pen: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7.59 19.59 6.17z',
    delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12 1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[name]}"/></svg>`;
  let annot = null; // { layer, bar, marks, tool, drawing, note, reply }

  function startAnnotate(reply) {
    if (annot) finishAnnotate(null);
    annotating = true;
    suspended = false;
    mount();
    host.removeAttribute('aria-hidden'); // the note field takes focus
    host.classList.toggle('dark', pageIsDark());
    const layer = document.createElement('div');
    layer.className = 'annot';
    layer.innerHTML = `<div class="bar" role="toolbar">
        <button data-tool="rect" class="on" data-tip="Frame">${icon('rect')}</button>
        <button data-tool="arrow" data-tip="Arrow">${icon('arrow')}</button>
        <button data-tool="pen" data-tip="Pen">${icon('pen')}</button>
        <span class="hint">Click to mark an element</span>
        <span class="sep"></span>
        <button data-act="undo" data-tip="Undo (Ctrl+Z)" disabled>${icon('undo')}</button>
        <button data-act="cancel" data-tip="Cancel (Esc)">${icon('close')}</button>
        <button data-act="done" class="filled" disabled>${icon('check')}Done</button>
      </div>`;
    root.append(layer);
    annot = { layer, bar: layer.querySelector('.bar'), marks: [], seq: 0, tool: 'rect', drawing: null, note: null, reply };
    layer.addEventListener('pointerdown', annotDown);
    layer.addEventListener('pointermove', annotMove);
    layer.addEventListener('pointerup', annotUp);
    layer.addEventListener('wheel', annotWheel, { passive: false });
    annot.bar.addEventListener('pointerdown', e => e.stopPropagation());
    annot.bar.addEventListener('click', annotBar);
    addEventListener('keydown', annotKey, true);
    kick();
  }

  // ---- anchors: what a mark moves with

  const scrolls = (s, n) => (/(auto|scroll|overlay)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1)
    || (/(auto|scroll|overlay)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1);

  function anchorAt(x, y) {
    for (let n = pageElementAt(x, y); n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (scrolls(s, n)) return { type: 'el', el: n };
      if (s.position === 'fixed') return { type: 'fixed' };
    }
    return { type: 'doc' };
  }

  // Client position of the anchor's origin.
  function origin(a) {
    if (a.type === 'doc') return { x: -scrollX, y: -scrollY };
    if (a.type === 'fixed') return { x: 0, y: 0 };
    const r = a.el.getBoundingClientRect();
    return { x: r.left + a.el.clientLeft - a.el.scrollLeft, y: r.top + a.el.clientTop - a.el.scrollTop };
  }

  // The client area a scroll container shows its content in; null when the whole window does.
  function visibleArea(a) {
    if (a.type !== 'el') return null;
    if (!a.el.isConnected) return { x: 0, y: 0, w: 0, h: 0 };
    const r = a.el.getBoundingClientRect();
    return { x: r.left + a.el.clientLeft, y: r.top + a.el.clientTop, w: a.el.clientWidth, h: a.el.clientHeight };
  }

  const bboxOf = pts => {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  const intersect = (a, b) => {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y;
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  };
  const union = (a, b) => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };
  const overlapArea = (a, b) => { const r = intersect(a, b); return r ? r.w * r.h : 0; };

  // A mark's current client geometry, or null when its element is gone.
  function geom(m) {
    if (m.kind === 'element') {
      if (!m.el.isConnected) return null;
      const r = m.el.getBoundingClientRect(), p = 4;
      return { pts: [], box: { x: r.left - p, y: r.top - p, w: r.width + 2 * p, h: r.height + 2 * p } };
    }
    const o = origin(m.anchor);
    const pts = m.pts.map(([x, y]) => [x + o.x, y + o.y]);
    return { pts, box: bboxOf(pts) };
  }

  // ---- shapes

  function smoothPath(pts) {
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      d += `Q${pts[i][0]} ${pts[i][1]} ${(pts[i][0] + pts[i + 1][0]) / 2} ${(pts[i][1] + pts[i + 1][1]) / 2}`;
    }
    const l = pts[pts.length - 1];
    return d + `L${l[0]} ${l[1]}`;
  }

  function arrowPaths([f, t]) {
    const dx = t[0] - f[0], dy = t[1] - f[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const L = Math.min(18, len * 0.6), w = L * 0.55, bx = t[0] - ux * L, by = t[1] - uy * L;
    return {
      shaft: `M${f[0]} ${f[1]}L${bx + ux * 2} ${by + uy * 2}`,
      head: `M${t[0]} ${t[1]}L${bx - uy * w} ${by + ux * w}L${bx + uy * w} ${by - ux * w}Z`,
    };
  }

  const svgNode = (parent, tag, attrs = {}) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    parent.append(el);
    return el;
  };

  // Every mark is its own window-sized SVG, so CSS clip-path can cut it to its scroll container. Its
  // number badge is the handle for its note: click it to add or change the note.
  function newMark(kind, props) {
    const m = { kind, note: '', refs: [], card: null, quad: null, ...props };
    const dark = host.classList.contains('dark');
    m.color = PALETTE[dark ? 'dark' : 'light'][annot.seq++ % 6];
    m.on = dark ? '#1a1b21' : '#fff';
    m.svg = document.createElementNS(SVG, 'svg');
    m.svg.setAttribute('class', 'mark');
    m.svg.style.setProperty('--c', m.color);
    m.svg.style.setProperty('--on', m.on);
    const tag = kind === 'element' || kind === 'rect' ? 'rect' : 'path';
    m.halo = svgNode(m.svg, tag, { class: 'halo', rx: 10 });
    m.line = svgNode(m.svg, tag, { class: kind === 'element' ? 'line el' : kind === 'rect' ? 'line area' : 'line', rx: 10 });
    if (kind === 'arrow') m.head = svgNode(m.svg, 'path', { class: 'head' });
    m.badge = svgNode(m.svg, 'g', { class: 'badge' });
    svgNode(m.badge, 'circle', { r: 11 });
    m.num = svgNode(m.badge, 'text');
    m.badge.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); });
    m.badge.addEventListener('click', () => { if (!annot.drawing) openNote(m); });
    annot.layer.insertBefore(m.svg, annot.bar);
    annot.marks.push(m);
    updateBar();
    return m;
  }

  function removeMark(m) {
    if (annot.note?.m === m) annot.note = null;
    m.svg.remove();
    m.card?.remove();
    annot.marks = annot.marks.filter(x => x !== m);
    updateBar();
  }

  function drawMark(m, g, vis, n) {
    if (m.num.textContent !== String(n)) m.num.textContent = String(n);
    const shown = g && (!vis || intersect(vis, g.box));
    m.svg.style.display = shown ? '' : 'none';
    if (!shown) return;
    m.svg.style.clipPath = vis ? `inset(${vis.y}px ${innerWidth - vis.x - vis.w}px ${innerHeight - vis.y - vis.h}px ${vis.x}px)` : '';
    let bx, by;
    if (m.kind === 'element' || m.kind === 'rect') {
      for (const r of [m.halo, m.line]) {
        r.setAttribute('x', g.box.x); r.setAttribute('y', g.box.y);
        r.setAttribute('width', g.box.w); r.setAttribute('height', g.box.h);
      }
      [bx, by] = [g.box.x, g.box.y];
    } else if (m.kind === 'arrow') {
      const { shaft, head } = arrowPaths(g.pts);
      m.halo.setAttribute('d', shaft + head);
      m.line.setAttribute('d', shaft);
      m.head.setAttribute('d', head);
      [bx, by] = g.pts[0];
    } else {
      const d = smoothPath(g.pts);
      m.halo.setAttribute('d', d);
      m.line.setAttribute('d', d);
      [bx, by] = g.pts[0];
    }
    m.badge.setAttribute('transform', `translate(${bx},${by})`);
    m.badgeAt = { x: bx, y: by };
  }

  // A note card grows out of its mark's badge: the card's own number circle sits exactly on the badge
  // and the card opens towards one of four corners - the one that covers the least of the marks and
  // other notes and stays inside the window. The chosen corner sticks unless another is clearly better.
  const NUM = 17; // card edge to number-circle centre
  const QUADS = [{ left: true, up: true }, { left: false, up: true }, { left: true, up: false }, { left: false, up: false }];

  function placeNote(m, w, h, obstacles, placed) {
    const b = m.badgeAt, W = innerWidth, H = innerHeight, fixed = m.anchor.type === 'fixed';
    const outside = r => {
      const ox = Math.max(0, -r.x) + Math.max(0, r.x + r.w - W);
      const top = fixed ? 0 : -scrollY;
      const oy = Math.max(0, top - r.y) + (fixed ? Math.max(0, r.y + r.h - H) : 0);
      return (ox * r.h + oy * r.w) * 4;
    };
    const scored = QUADS.map((q, i) => {
      const r = { x: q.left ? b.x - w + NUM : b.x - NUM, y: q.up ? b.y - h + NUM : b.y - NUM, w, h, i };
      r.score = [...obstacles, ...placed].reduce((s, o) => s + overlapArea(r, o), 0) + outside(r);
      return r;
    });
    let best = scored.reduce((a, r) => (r.score < a.score ? r : a));
    const prev = m.quad != null && scored[m.quad];
    if (prev && prev.score <= best.score + 400) best = prev;
    m.quad = best.i;
    return best;
  }

  function renderAnnot() {
    const live = annot.marks.map((m, i) => {
      const g = geom(m), vis = visibleArea(m.anchor);
      drawMark(m, g, vis, i + 1);
      return { m, i, g, shown: !!g && (!vis || !!intersect(vis, g.box)) };
    });
    const obstacles = live.filter(x => x.shown).map(x => x.g.box), placed = [];
    // The open editor is placed first, so the other notes make way for it.
    live.sort((a, b) => (b.m === annot.note?.m) - (a.m === annot.note?.m));
    for (const { m, i, shown } of live) {
      if (!m.card) continue;
      m.card.style.display = shown ? '' : 'none';
      m.noteBox = null;
      if (!shown || !m.badgeAt) continue;
      const num = m.card.querySelector('.num');
      if (num.textContent !== String(i + 1)) num.textContent = String(i + 1);
      const spot = placeNote(m, m.card.offsetWidth, m.card.offsetHeight, obstacles, placed);
      placed.push(spot);
      m.card.classList.toggle('left', QUADS[spot.i].left);
      m.card.classList.toggle('up', QUADS[spot.i].up);
      m.card.style.transform = `translate(${spot.x}px,${spot.y}px)`;
      m.noteBox = spot;
    }
  }

  // ---- input

  function annotDown(e) {
    if (e.button !== 0) return;
    closeNote(true);
    e.preventDefault();
    annot.layer.setPointerCapture(e.pointerId);
    hoverEl = null;
    const anchor = anchorAt(e.clientX, e.clientY), o = origin(anchor);
    const p = [e.clientX - o.x, e.clientY - o.y];
    const m = newMark(annot.tool, { anchor, pts: annot.tool === 'pen' ? [p] : [p, p] });
    annot.drawing = { m, x0: e.clientX, y0: e.clientY, moved: false };
  }

  // Without a drag in progress, hovering outlines the element a click would mark.
  function annotMove(e) {
    const d = annot?.drawing;
    if (!d) {
      const onCanvas = e.target === annot.layer || (e.target.closest?.('svg.mark') && !e.target.closest('.badge'));
      hoverEl = !annot.note && onCanvas ? pageElementAt(e.clientX, e.clientY) : null;
      return;
    }
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) d.moved = true;
    const o = origin(d.m.anchor), p = [e.clientX - o.x, e.clientY - o.y];
    if (d.m.kind !== 'pen') { d.m.pts[1] = p; return; }
    const last = d.m.pts[d.m.pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 3) d.m.pts.push(p);
  }

  function annotUp(e) {
    const d = annot?.drawing;
    if (!d) return;
    annot.drawing = null;
    let m = d.m;
    if (!d.moved) {
      // A click without dragging marks exactly the element under it, whatever the tool.
      removeMark(m);
      annot.seq--; // the element mark takes over the dropped shape's colour
      const el = pageElementAt(d.x0, d.y0);
      if (!el) return;
      m = newMark('element', { el, anchor: anchorAt(d.x0, d.y0) });
    } else if (m.kind === 'pen') {
      const o = origin(m.anchor);
      m.pts.push([e.clientX - o.x, e.clientY - o.y]);
    }
    m.refs = refsOf(m);
    openNote(m);
  }

  // Wheel events land on the drawing layer; hand them to whatever would have scrolled under the pointer.
  function annotWheel(e) {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    let dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.shiftKey && !dx) [dx, dy] = [dy, 0];
    const can = n => {
      const s = getComputedStyle(n);
      const y = dy && /(auto|scroll|overlay)/.test(s.overflowY) && (dy > 0 ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : n.scrollTop > 0);
      const x = dx && /(auto|scroll|overlay)/.test(s.overflowX) && (dx > 0 ? n.scrollLeft + n.clientWidth < n.scrollWidth - 1 : n.scrollLeft > 0);
      return x || y;
    };
    for (let n = pageElementAt(e.clientX, e.clientY); n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (can(n)) { n.scrollBy({ left: dx, top: dy, behavior: 'instant' }); return; }
    }
    (document.scrollingElement || document.documentElement).scrollBy({ left: dx, top: dy, behavior: 'instant' });
  }

  // The editor replaces the mark's note card while open. Enter or a click elsewhere saves, Esc restores
  // the previous note; an emptied note leaves just the badge.
  function openNote(m) {
    closeNote(true);
    m.card?.remove();
    const card = document.createElement('div');
    card.className = 'note-edit';
    card.style.setProperty('--c', m.color);
    card.style.setProperty('--on', m.on);
    card.innerHTML = `<span class="num"></span><div class="field"><input aria-label="Note" placeholder="Add a note">
      <div class="help">Enter saves · Esc discards</div></div>
      <button class="del" data-tip="Delete mark" aria-label="Delete mark">${icon('delete')}</button>`;
    const input = card.querySelector('input');
    input.value = m.note;
    card.addEventListener('pointerdown', e => e.stopPropagation());
    card.querySelector('.del').addEventListener('click', () => removeMark(m));
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); closeNote(true); }
      if (e.key === 'Escape') { e.preventDefault(); closeNote(false); }
    });
    annot.layer.insertBefore(card, annot.bar);
    m.card = card;
    m.quad = null;
    hoverEl = null;
    annot.note = { input, m, prev: m.note };
    renderAnnot();
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  function closeNote(save) {
    const n = annot?.note;
    if (!n) return;
    annot.note = null;
    const { m } = n;
    m.note = save ? n.input.value.trim() : n.prev;
    m.card.remove();
    m.card = null;
    m.quad = null;
    if (!m.note) return;
    const card = document.createElement('div');
    card.className = 'note';
    card.style.setProperty('--c', m.color);
    card.style.setProperty('--on', m.on);
    card.innerHTML = '<span class="num"></span><span class="text"></span>';
    card.querySelector('.text').textContent = m.note;
    card.title = 'Edit note';
    card.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); });
    card.addEventListener('click', () => { if (!annot.drawing) openNote(m); });
    annot.layer.insertBefore(card, annot.bar);
    m.card = card;
  }

  function updateBar() {
    const empty = !annot.marks.length;
    annot.bar.querySelector('[data-act="undo"]').disabled = empty;
    annot.bar.querySelector('[data-act="done"]').disabled = empty;
  }

  function undo() {
    closeNote(true);
    const m = annot.marks[annot.marks.length - 1];
    if (m) removeMark(m);
  }

  function annotBar(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.tool) {
      closeNote(true);
      annot.tool = b.dataset.tool;
      for (const x of annot.bar.querySelectorAll('[data-tool]')) x.classList.toggle('on', x === b);
    } else if (b.dataset.act === 'undo') undo();
    else if (b.dataset.act === 'cancel') finishAnnotate(null);
    else if (b.dataset.act === 'done') annotDone();
  }

  function annotKey(e) {
    if (annot?.note) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      finishAnnotate(null);
    } else if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && annot?.reply) {
      e.preventDefault(); e.stopImmediatePropagation();
      undo();
    }
  }

  // The overlay goes away before the reply, so the worker's capture shows the bare page.
  function annotDone() {
    closeNote(true);
    if (!annot.marks.length) return finishAnnotate(null);
    renderAnnot();
    const spec = collectAnnotations();
    const reply = annot.reply;
    annot.reply = null;
    hoverEl = null;
    suspended = true;
    unmount();
    requestAnimationFrame(() => requestAnimationFrame(() => reply(spec)));
  }

  function finishAnnotate(result) {
    if (!annot) return;
    const { layer, reply } = annot;
    removeEventListener('keydown', annotKey, true);
    layer.remove();
    host?.setAttribute('aria-hidden', 'true');
    annot = null;
    annotating = null;
    hoverEl = null;
    suspended = false;
    try { reply?.(result); } catch {}
    kick();
  }

  // Page elements a mark refers to, fixed when it is drawn: the marked element, an arrow's target, else
  // the outermost meaningful elements inside the mark (interactive ones, images, elements with their own
  // text), else the element at its centre.
  const INTERACTIVE = 'a,button,input,select,textarea,label,img,svg,video,canvas,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="option"],[role="menuitem"]';
  const ownText = el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const pageElementAt = (x, y) => document.elementsFromPoint(x, y).find(el => el !== host && el.localName !== 'show-and-tell-stage' && el !== document.documentElement && el !== document.body) || null;

  function refsOf(m) {
    if (m.kind === 'element') return [m.el];
    const g = geom(m);
    if (m.kind === 'arrow') { const el = pageElementAt(...g.pts[1]); return el ? [el] : []; }
    const b = g.box, slack = 4;
    const inside = [...document.body.querySelectorAll('*')].filter(el => {
      if (el === host || el.closest('svg') && el.tagName.toLowerCase() !== 'svg') return false;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      if (r.left < b.x - slack || r.top < b.y - slack || r.right > b.x + b.w + slack || r.bottom > b.y + b.h + slack) return false;
      return el.matches(INTERACTIVE) || ownText(el);
    });
    const outer = inside.filter(el => !inside.some(o => o !== el && o.contains(el))).slice(0, 8);
    if (outer.length) return outer;
    const el = pageElementAt(b.x + b.w / 2, b.y + b.h / 2);
    return el ? [el] : [];
  }

  // How the worker repaints a note card: box, text box and the colours the theme resolved to.
  function noteDraw(m, doc) {
    const s = getComputedStyle(m.card), t = m.card.querySelector('.text').getBoundingClientRect();
    return { noteBox: doc(m.noteBox), noteText: doc({ x: t.left, y: t.top, w: t.width, h: t.height }),
      noteBg: s.backgroundColor, noteFg: s.color, noteRadius: parseFloat(s.borderTopLeftRadius) || 17 };
  }

  // Everything in document coordinates. `draw` is what the worker needs to paint the marks; `clip` is the
  // page area to capture: the current window plus every mark and note, even those scrolled out of view.
  function collectAnnotations() {
    const sx = scrollX, sy = scrollY;
    const doc = r => r && { x: Math.round(r.x + sx), y: Math.round(r.y + sy), width: Math.round(r.w ?? r.width), height: Math.round(r.h ?? r.height) };
    const pt = p => ({ x: Math.round(p[0] + sx), y: Math.round(p[1] + sy) });
    let area = { x: 0, y: 0, w: innerWidth, h: innerHeight };
    const annotations = annot.marks.map((m, i) => {
      const g = geom(m), vis = visibleArea(m.anchor);
      if (g) {
        const ext = { x: g.box.x - 16, y: g.box.y - 16, w: g.box.w + 32, h: g.box.h + 32 };
        const seen = vis ? intersect(ext, vis) : ext;
        if (seen) area = union(area, seen);
      }
      if (m.noteBox) area = union(area, { x: m.noteBox.x - 8, y: m.noteBox.y - 8, w: m.noteBox.w + 16, h: m.noteBox.h + 16 });
      return {
        n: i + 1,
        kind: m.kind,
        color: m.color,
        rect: g ? doc(g.box) : null,
        ...(m.kind === 'arrow' && g && { from: pt(g.pts[0]), to: pt(g.pts[1]) }),
        note: m.note,
        elements: m.refs.filter(el => el.isConnected).map((el, j) => ({ label: `${i + 1}${String.fromCharCode(97 + j)}`, ...target(el),
          rect: doc(el.getBoundingClientRect()) })),
        draw: g && {
          ...(m.kind === 'pen' && { points: g.pts.map(pt) }),
          badge: m.badgeAt && pt([m.badgeAt.x, m.badgeAt.y]),
          on: m.on,
          clip: vis && doc(vis),
          ...(m.noteBox && m.card && noteDraw(m, doc)),
        },
      };
    });
    const de = document.documentElement;
    const docW = Math.max(de.scrollWidth, document.body?.scrollWidth || 0, innerWidth);
    const docH = Math.max(de.scrollHeight, document.body?.scrollHeight || 0, innerHeight);
    const c = doc(area);
    const x = Math.max(0, c.x), y = Math.max(0, c.y);
    return {
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: Math.round(sx), y: Math.round(sy) },
      dpr: devicePixelRatio,
      surface: getComputedStyle(host).getPropertyValue('--md-sys-color-surface').trim() || '#fff',
      clip: { x, y, width: Math.min(docW, c.x + c.width) - x, height: Math.min(docH, c.y + c.height) - y },
      annotations,
    };
  }

  function onMessage(m, _sender, reply) {
    if (m.cmd === 'annotate') { startAnnotate(reply); return true; }
    if (m.cmd === 'annotateClear') { finishAnnotate(null); return false; }
    if (m.cmd === 'probe') { probe(m).then(reply, e => reply({ found: false, error: String(e) })); return true; }
    if (m.cmd === 'pointerHide') { G.pointer.hide().then(() => reply({ ok: true })); return true; }
    if (m.cmd === 'ping') { reply({ ok: document.readyState !== 'loading' }); return false; }
    if (m.cmd === 'metrics') {
      reply({ iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio,
        aw: screen.availWidth, ah: screen.availHeight, ax: screen.availLeft ?? 0, ay: screen.availTop ?? 0 });
      return false;
    }
    if (m.cmd === 'runActions') { runActions(m.actions || [], !!m.cinematic, m.accent).then(reply, e => reply({ ok: false, error: String(e?.message || e) })); return true; }
    return false;
  }
})();
