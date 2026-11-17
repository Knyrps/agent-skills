// Gesture glyphs, shared with content.js through globalThis.__demonstrateGestures. Two uses: a highlight
// with a `gesture` shows a looping illustration on its element (nothing is performed), and scripted
// actions in a video drive `pointer`, a drawn cursor or finger that moves, presses and leaves a trail.
(() => {
  if (window.top !== window || globalThis.__demonstrateGestures) return;

  const NS = 'http://www.w3.org/2000/svg';
  const TOUCH = ['tap', 'double-tap', 'long-press', 'swipe', 'pinch'];
  const MOUSE = ['click', 'double-click', 'right-click', 'hover', 'drag', 'scroll'];
  const DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  const BUTTON = { click: 'left', 'double-click': 'left', 'right-click': 'right', drag: 'left', scroll: 'wheel' };
  const ARROW = 'M0 0v16.5l4.4-4 3 6.9 2.7-1.2-3-6.7h5.9z';
  const RING = 2 * Math.PI * 20;
  const STYLES = `
    .gest{position:fixed;left:0;top:0;width:100vw;height:100vh;overflow:visible;pointer-events:none;
      filter:drop-shadow(0 1px 2px rgb(0 0 0/.35))}
    .gest .halo{fill:none;stroke:#fff;stroke-opacity:.85;stroke-linecap:round;stroke-linejoin:round}
    .gest .guide{fill:none;stroke:var(--c,#0b57d0);stroke-width:2.5;stroke-linecap:round;stroke-dasharray:.1 7}
    .gest .tip,.gest .chev{fill:none;stroke:var(--c,#0b57d0);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
    .gest .trail{fill:none;stroke:var(--c,#0b57d0);stroke-width:7;stroke-linecap:round;stroke-opacity:.55}
    .gest .rip{fill:none;stroke:var(--c,#0b57d0);stroke-width:2.5}
    .gest .ring{fill:none;stroke:var(--c,#0b57d0);stroke-width:4;stroke-linecap:round}
    .gest .dot-halo{fill:none;stroke:#fff;stroke-width:6;stroke-opacity:.9}
    .gest .dot{fill:var(--c,#0b57d0);fill-opacity:.32;stroke:var(--c,#0b57d0);stroke-width:2.5}
    .gest .arrow{fill:#1a1b21;stroke:#fff;stroke-width:1.4;stroke-linejoin:round}
    .gest .pill{fill:#fff;stroke:#1a1b21;stroke-width:1.4}
    .gest .split{fill:none;stroke:#1a1b21;stroke-width:1.2}
    .gest .btn{fill:var(--c,#0b57d0)}
    .gest .wheel{fill:#1a1b21}`;

  // One loop of each illustration in ms: when the pointer is down, moves, fills its hold ring.
  const TL = {
    tap: { len: 2200, press: [[500, 660]] },
    'double-tap': { len: 2400, press: [[500, 610], [770, 880]] },
    'long-press': { len: 3200, press: [[500, 2000]], hold: [560, 1900] },
    swipe: { len: 2500, press: [[350, 1300]], move: [450, 1200] },
    pinch: { len: 2700, press: [[350, 1500]], move: [500, 1400] },
    drag: { len: 3200, press: [[650, 2050]], move: [850, 1900], enter: 450 },
    click: { len: 2400, press: [[650, 780]], enter: 450 },
    'double-click': { len: 2600, press: [[650, 750], [900, 1000]], enter: 450 },
    'right-click': { len: 2400, press: [[650, 780]], enter: 450 },
    hover: { len: 2600, press: [], enter: 600 },
    scroll: { len: 2600, press: [], enter: 450, wheel: [600, 1900] },
  };

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const ease = k => (k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
  const attr = (n, attrs) => { for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
  const mk = (tag, attrs, parent) => { const n = attr(document.createElementNS(NS, tag), attrs); parent?.append(n); return n; };
  const line = (n, x1, y1, x2, y2) => attr(n, { x1, y1, x2, y2 });
  const on = (n, yes) => { n.style.display = yes ? '' : 'none'; };

  // Open arrowhead at B, pointing away from A.
  function head(ax, ay, bx, by) {
    const l = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / l, uy = (by - ay) / l;
    const wing = s => `${(bx - 9 * ux - s * 6 * uy).toFixed(1)} ${(by - 9 * uy + s * 6 * ux).toFixed(1)}`;
    return `M${wing(1)}L${bx.toFixed(1)} ${by.toFixed(1)}L${wing(-1)}`;
  }

  // A pointer and everything it can leave behind: guide path, trail, ripple, hold ring.
  function glyph(parent, mouse) {
    const g = mk('g', {}, parent);
    const p = { g, mouse,
      track: mk('line', { class: 'halo', 'stroke-width': 7 }, g), guide: mk('line', { class: 'guide' }, g),
      tipHalo: mk('path', { class: 'halo', 'stroke-width': 6.5 }, g), tip: mk('path', { class: 'tip' }, g),
      trail: mk('line', { class: 'trail' }, g), rip: mk('circle', { class: 'rip' }, g),
      ring: mk('circle', { class: 'ring', r: 20 }, g), body: mk('g', {}, g) };
    if (!mouse) {
      mk('circle', { class: 'dot-halo', r: 13 }, p.body);
      mk('circle', { class: 'dot', r: 13 }, p.body);
      return p;
    }
    mk('path', { class: 'arrow', d: ARROW }, p.body);
    p.badge = mk('g', { transform: 'translate(14 20) scale(.8)' }, p.body);
    mk('rect', { class: 'pill', width: 16, height: 24, rx: 8 }, p.badge);
    p.left = mk('path', { class: 'btn', d: 'M8 .7v8.3H.7V8A7.3 7.3 0 0 1 8 .7z' }, p.badge);
    p.right = mk('path', { class: 'btn', d: 'M8 .7A7.3 7.3 0 0 1 15.3 8v1H8z' }, p.badge);
    mk('path', { class: 'split', d: 'M8 0v9M0 9h16' }, p.badge);
    p.wheel = mk('rect', { class: 'wheel', x: 6.5, y: 3, width: 3, height: 6, rx: 1.5 }, p.badge);
    p.chev = mk('path', { class: 'chev' }, p.badge);
    return p;
  }

  // s: { a opacity, from, to?, k progress from->to, off? entry offset, down 0..1, rip 0..1|null, hold 0..1|null,
  //      guide?, trail?, button?: left|right|wheel, dir?, phase? }
  function paint(p, s) {
    const [ax, ay] = s.from, [bx, by] = s.to || s.from, [ox, oy] = s.off || [0, 0];
    const pathed = ax !== bx || ay !== by;
    const x = ax + (bx - ax) * s.k + ox, y = ay + (by - ay) * s.k + oy;
    p.g.style.opacity = s.a;
    const guide = pathed && !!s.guide;
    for (const n of [p.track, p.guide, p.tipHalo, p.tip]) on(n, guide);
    if (guide) {
      line(p.track, ax, ay, bx, by); line(p.guide, ax, ay, bx, by);
      const d = head(ax, ay, bx, by);
      p.tipHalo.setAttribute('d', d); p.tip.setAttribute('d', d);
    }
    const trail = pathed && s.k > 0 && s.trail !== false;
    on(p.trail, trail);
    if (trail) line(p.trail, ax, ay, x, y);
    const rip = s.rip != null && s.rip < 1;
    on(p.rip, rip);
    const [rx, ry] = s.ripAt || [ax + ox, ay + oy];
    if (rip) { attr(p.rip, { cx: rx, cy: ry, r: (p.mouse ? 4 : 12) + 26 * s.rip }); p.rip.style.opacity = 1 - s.rip; }
    on(p.ring, s.hold != null);
    if (s.hold != null) attr(p.ring, { cx: x, cy: y, 'stroke-dasharray': RING, 'stroke-dashoffset': RING * (1 - s.hold), transform: `rotate(-90 ${x} ${y})` });
    const scale = p.mouse ? 1.35 * (1 - .1 * s.down) : 1 - .18 * s.down;
    p.body.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(3)})`);
    if (!p.mouse) return;
    on(p.badge, !!s.button);
    on(p.left, s.button === 'left' && s.down > 0);
    on(p.right, s.button === 'right' && s.down > 0);
    const wheel = s.button === 'wheel';
    on(p.wheel, wheel); on(p.chev, wheel);
    if (!wheel) return;
    const ph = s.phase ?? 0, d = 5 * ph, dir = DIRS[s.dir] ? s.dir : 'down';
    p.wheel.setAttribute('y', 3 + 1.5 * DIRS[dir][1] * Math.sin(ph * Math.PI));
    p.chev.setAttribute('d', { down: `M3 ${29 + d}l5 5 5-5`, up: `M3 ${-5 - d}l5-5 5 5`,
      right: `M${21 + d} 7l5 5-5 5`, left: `M${-5 - d} 7l-5 5 5 5` }[dir]);
    p.chev.style.opacity = s.phase == null ? 0 : 1 - .8 * ph;
  }

  // Where an illustration plays on its element: rect in client px, `to` an optional end point.
  function geometry(kind, dir, rect, to) {
    const c = [rect.x + rect.w / 2, rect.y + rect.h / 2];
    const u = DIRS[dir] || DIRS[kind === 'swipe' ? 'left' : kind === 'scroll' ? 'down' : 'right'];
    const L = clamp(Math.max(rect.w, rect.h) * .5, 90, 240);
    const g = { from: c, button: BUTTON[kind], dir: dir || 'down' };
    if (kind === 'swipe') {
      if (to) Object.assign(g, { to, guide: true });
      else Object.assign(g, { from: [c[0] - u[0] * L / 2, c[1] - u[1] * L / 2], to: [c[0] + u[0] * L / 2, c[1] + u[1] * L / 2], guide: true });
    } else if (kind === 'drag') Object.assign(g, { to: to || [c[0] + u[0] * L, c[1] + u[1] * L], guide: true });
    else if (kind === 'pinch') {
      const d0 = 16, d1 = clamp(Math.min(rect.w, rect.h) * .35, 40, 110), out = dir !== 'in';
      const [s, e] = out ? [d0, d1] : [d1, d0], k = Math.SQRT1_2;
      g.pair = [-1, 1].map(sg => ({ from: [c[0] + sg * s * k, c[1] + sg * s * k], to: [c[0] + sg * e * k, c[1] + sg * e * k] }));
    }
    return g;
  }

  // The animation state of one loop at time t (ms since the loop started).
  function stateAt(kind, t) {
    const T = TL[kind];
    const a = Math.min(seg(t, 0, 250), 1 - seg(t, T.len - 350, T.len - 50));
    let down = 0, rip = null;
    for (const [s, e] of T.press) {
      if (t >= s && t < e) down = Math.max(down, seg(t, s, s + 80));
      else if (t >= e && t < e + 120) down = Math.max(down, 1 - seg(t, e, e + 120));
      if (!T.move && !T.hold && t >= s && t < s + 650) rip = seg(t, s, s + 650);
    }
    const k = T.move ? ease(seg(t, ...T.move)) : 0;
    const e = T.enter ? 1 - ease(seg(t, 0, T.enter)) : 0;
    const hold = T.hold && t >= T.hold[0] && t < T.press[0][1] ? seg(t, ...T.hold) : null;
    const phase = T.wheel && t >= T.wheel[0] && t < T.wheel[1] ? ((t - T.wheel[0]) / 433) % 1 : null;
    return { a, down, rip, k, off: [44 * e, 60 * e], hold, phase };
  }

  let layer = null, pointerLayer = null;
  const items = new Map(); // id -> { kind, t0, color, glyphs }

  // Illustrations go into `root` before `before` (so callouts stay on top); the performed pointer goes last.
  function attach(root, before) {
    const style = document.createElement('style');
    style.textContent = STYLES;
    layer = mk('svg', { class: 'gest' });
    pointerLayer = mk('svg', { class: 'gest pointer' });
    root.insertBefore(style, root.firstChild);
    root.insertBefore(layer, before);
    root.append(pointerLayer);
    for (const it of items.values()) it.g.remove();
    items.clear();
    if (P.glyph) { P.glyph = null; P.touch = null; }
  }

  // items: [{ id, kind, rect: {x,y,w,h} | null, to: [x,y] | null, dir, color }]
  function sync(list, now = performance.now()) {
    if (!layer) return false;
    const live = new Set();
    for (const s of list) {
      if (!TL[s.kind]) continue;
      live.add(s.id);
      let it = items.get(s.id);
      if (!it || it.kind !== s.kind) {
        it?.g.remove();
        const g = mk('g', {}, layer);
        const mouse = MOUSE.includes(s.kind);
        it = { kind: s.kind, t0: now, g, glyphs: s.kind === 'pinch' ? [glyph(g, false), glyph(g, false)] : [glyph(g, mouse)] };
        items.set(s.id, it);
      }
      it.g.style.setProperty('--c', s.color || '#0b57d0');
      on(it.g, !!s.rect);
      if (!s.rect) continue;
      const st = stateAt(s.kind, (now - it.t0) % TL[s.kind].len), geo = geometry(s.kind, s.dir, s.rect, s.to);
      if (geo.pair) geo.pair.forEach((p, i) => paint(it.glyphs[i], { ...st, ...p, guide: false, rip: null }));
      else paint(it.glyphs[0], { ...st, ...geo });
    }
    for (const [id, it] of items) if (!live.has(id)) { it.g.remove(); items.delete(id); }
    paintPointer(now);
    return items.size > 0 || P.on;
  }

  // ---- the performed pointer: scripted actions in a video move it; every method returns when its motion ends.
  const P = { on: false, mouse: true, x: 0, y: 0, move: null, down: 0, downAt: 0, upAt: 0, ripAt: null, ripT: -1e9,
    hold: null, trail: null, button: '', wheel: null, glyph: null, touch: null, color: '#0b57d0', fadeAt: 0 };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function pos(now) {
    if (!P.move) return [P.x, P.y];
    const m = P.move, k = ease(seg(now, m.t0, m.t0 + m.dur));
    const x = m.x0 + (m.x1 - m.x0) * k, y = m.y0 + (m.y1 - m.y0) * k + Math.sin(k * Math.PI) * m.arc;
    if (k >= 1) { P.move = null; P.x = m.x1; P.y = m.y1; }
    return [x, y];
  }

  function paintPointer(now) {
    if (!pointerLayer) return;
    if (P.on && !P.glyph) {
      P.glyph = glyph(pointerLayer, true);
      P.touch = glyph(pointerLayer, false);
    }
    if (!P.glyph) return;
    pointerLayer.style.setProperty('--c', P.color);
    const [x, y] = pos(now);
    const a = P.on ? seg(now, P.fadeAt, P.fadeAt + 200) : 1 - seg(now, P.fadeAt, P.fadeAt + 250);
    const down = P.down ? seg(now, P.downAt, P.downAt + 80) : 1 - seg(now, P.upAt, P.upAt + 120);
    const rip = now - P.ripT < 650 ? seg(now, P.ripT, P.ripT + 650) : null;
    const hold = P.hold ? seg(now, P.hold.t0, P.hold.t0 + P.hold.dur) : null;
    const phase = P.wheel ? ((now - P.wheel) / 433) % 1 : null;
    const from = P.trail || [x, y];
    const s = { a, from, to: [x, y], k: 1, down, rip, ripAt: P.ripAt, hold, guide: false, trail: !!P.trail,
      button: P.button, dir: P.dir, phase };
    paint(P.mouse ? P.glyph : P.touch, s);
    (P.mouse ? P.touch : P.glyph).g.style.opacity = 0;
  }

  const pointer = {
    get active() { return P.on || performance.now() - P.fadeAt < 300; },
    get at() { return [P.x, P.y]; },
    // Appears at (x, y) or keeps its place; `touch` swaps the cursor for a finger dot.
    async show({ touch = false, x, y, color } = {}) {
      if (color) P.color = color;
      P.mouse = !touch;
      if (x != null) { P.move = null; P.x = x; P.y = y; }
      if (!P.on) { P.on = true; P.fadeAt = performance.now(); await sleep(200); }
    },
    async hide() { if (!P.on) return; pos(performance.now()); P.on = false; P.fadeAt = performance.now(); await sleep(260); },
    // Glides along a slight arc; the duration grows with the distance.
    async glide(x, y, ms) {
      const now = performance.now(), [x0, y0] = pos(now), d = Math.hypot(x - x0, y - y0);
      if (d < 1) return;
      const dur = ms ?? clamp(180 + d * .55, 250, 750);
      P.x = x; P.y = y;
      P.move = { x0, y0, x1: x, y1: y, t0: now, dur, arc: P.trail ? 0 : -Math.min(40, d * .12) };
      await sleep(dur);
    },
    async press(button = 'left') {
      P.button = button; P.down = 1; P.downAt = performance.now();
      P.ripAt = pos(P.downAt); P.ripT = P.downAt;
      await sleep(90);
    },
    async release() {
      P.down = 0; P.upAt = performance.now(); P.hold = null; P.trail = null;
      await sleep(120);
      if (!P.down) P.button = P.wheel ? 'wheel' : '';
    },
    async click(button = 'left', count = 1) {
      for (let i = 0; i < count; i++) { await pointer.press(button); await sleep(60); await pointer.release(); if (i < count - 1) await sleep(60); }
      P.button = '';
    },
    hold(ms) { P.hold = { t0: performance.now(), dur: ms }; },
    trail(on) { P.trail = on ? pos(performance.now()) : null; },
    wheel(dir) { P.button = dir ? 'wheel' : ''; P.dir = dir; P.wheel = dir ? performance.now() : null; },
  };

  globalThis.__demonstrateGestures = { KINDS: [...TOUCH, ...MOUSE], TOUCH, MOUSE, attach, sync, pointer,
    geometry, stateAt, timeline: TL };
})();