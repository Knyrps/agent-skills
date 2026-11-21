// Video stage: injected into the tour tab only while a video is recorded. It draws what frames the page in
// the video (captions, chapter label, progress bar, intro/outro/section cards) and shields the page from
// the real mouse and keyboard, so only the scripted actions reach it. The worker sends the full state on
// every change (`{ cmd: 'stage', state }`) and again after each page load, so nothing here has to persist.
// Material 3: the panel's colour tokens (light scheme), type scale and elevation; `branding.accent`
// replaces the primary colour.
(() => {
  if (window.top !== window) return;
  if (globalThis.__showAndTellStage) return;

  // The stage's templates and styles: built from ui-src/src/overlay/ into ui/overlay.js, injected before this script.
  const UI = globalThis.__showAndTellUI;
  const STYLES = UI.stage.styles;

  let host = null, root = null, els = {}, state = {};
  const tokens = fetch(chrome.runtime.getURL('vendor/m3-tokens.css')).then(r => r.text())
    .then(css => `:host{${(css.match(/:root\s*\{([^}]*)\}/) || [])[1] || ''}}`).catch(() => '');

  function mount() {
    if (host?.isConnected) return;
    if (!host) {
      host = document.createElement('show-and-tell-stage');
      host.setAttribute('style', 'all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;'
        + 'margin:0!important;padding:0!important;border:0!important;background:transparent!important;overflow:visible!important;'
        + 'pointer-events:none!important;z-index:2147483646!important;');
      host.popover = 'manual';
      root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style class="tokens"></style><style>${STYLES}</style><div class="shield"></div>
        <div class="bar"><div class="fill"></div></div>
        <div class="cap hide"><div class="ch"></div><div class="tx"></div></div><div class="tabbar hide"></div><div class="card hide"><div class="in"></div></div>`;
      for (const k of ['shield', 'bar', 'fill', 'cap', 'ch', 'tx', 'tabbar', 'card', 'in']) els[k] = root.querySelector('.' + k);
      const style = root.querySelector('.tokens');
      tokens.then(css => { style.textContent = css; });
    }
    document.documentElement.appendChild(host);
    raise();
  }

  // The top layer paints in opening order: a modal dialog or popover the page opens later covers the
  // stage, so the stage goes back on top, and the show-and-tell overlay (highlights, drawn pointer) above it.
  function raise() {
    if (!host?.isConnected) return;
    for (const el of [host, document.querySelector('show-and-tell-overlay')]) {
      if (!el || (el !== host && !el.matches(':popover-open'))) continue;
      try { if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); } catch {}
    }
  }
  // The caption makes way: it moves to the top while a highlight sits under it, and fades while the drawn
  // pointer works underneath it (e.g. a dialog's footer buttons). A parked pointer does not count.
  let last = '', movedAt = 0, top = false;
  function dodge() {
    if (!els.cap) return;
    const p = globalThis.__showAndTellGestures?.pointer, at = p?.active ? p.at : null;
    const key = at ? at.map(Math.round).join() : '';
    if (key !== last) { last = key; movedAt = Date.now(); }
    const shown = stage.active && !els.cap.classList.contains('hide');
    const r = els.cap.getBoundingClientRect(), gap = 30, h = r.height;
    // Where the caption sits at the bottom, whatever its current position.
    const base = { left: r.left, right: r.right, top: innerHeight - gap - h, bottom: innerHeight - gap };
    const hits = (b, m = 0) => b.x < base.right + m && b.x + b.w > base.left - m && b.y < base.bottom + m && b.y + b.h > base.top - m;
    const wantTop = shown && (globalThis.__showAndTellBoxes || []).some(b => hits(b, 12));
    if (wantTop !== top) { top = wantTop; els.cap.style.translate = top ? `-50% ${-(innerHeight - 2 * gap - h)}px` : ''; }
    let over = false;
    if (shown && at && Date.now() - movedAt < 1500) {
      const c = top ? { left: r.left, right: r.right, top: gap, bottom: gap + h } : base;
      over = at[0] > c.left - 48 && at[0] < c.right + 48 && at[1] > c.top - 48 && at[1] < c.bottom + 24;
    }
    els.cap.classList.toggle('dodge', over);
  }
  setInterval(dodge, 100);

  let raising = 0;
  const later = () => { cancelAnimationFrame(raising); raising = requestAnimationFrame(raise); };
  new MutationObserver(ms => { if (stage.active && ms.some(m => m.target !== host && m.target.localName !== 'show-and-tell-overlay')) later(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['open'], subtree: true });
  addEventListener('toggle', e => { if (stage.active && e.newState === 'open' && e.target !== host && e.target.localName !== 'show-and-tell-overlay') later(); }, true);

  // Real input never reaches the page while recording; Esc stops the recording.
  const block = e => {
    if (!e.isTrusted || !stage.active) return;
    if (e.type === 'keydown' && e.key === 'Escape') chrome.runtime.sendMessage({ type: 'videoStop' }).catch(() => {});
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const BLOCKED = ['keydown', 'keyup', 'keypress', 'wheel', 'touchstart', 'touchmove', 'mousedown', 'pointerdown', 'click', 'contextmenu'];

  function render() {
    mount();
    const s = state, b = s.branding || {};
    if (b.accent) { host.style.setProperty('--md-sys-color-primary', b.accent); host.style.setProperty('--md-sys-color-on-primary', '#fff'); }
    els.shield.style.display = s.shield === false ? 'none' : '';
    // Progress: one segment per chapter, filled up to the current one.
    const f = s.footer;
    els.bar.style.display = f && f.count > 1 && !s.card ? '' : 'none';
    if (f) {
      els.fill.style.width = `${(100 * (f.index + 1)) / f.count}%`;
      els.bar.querySelectorAll('.tick').forEach(t => t.remove());
      for (let i = 1; i < f.count; i++) {
        const t = document.createElement('div');
        t.className = 'tick';
        t.style.left = `${(100 * i) / f.count}%`;
        els.bar.append(t);
      }
    }
    // The caption block carries the chapter ("2 · Title") above the caption for the whole step; the text
    // stays in place while the block fades out, so it never blanks mid-fade.
    const l = s.lower, on = !s.card && !!(l || s.caption);
    if (on) {
      els.ch.textContent = l ? `${l.n} · ${l.title}` : '';
      els.tx.textContent = s.caption || '';
    }
    els.cap.classList.toggle('hide', !on);
    tabChip(s);
    els.card.classList.toggle('hide', !s.card);
    if (s.card) {
      // The card rises in again whenever its content changes.
      const key = JSON.stringify([s.card, b.name, b.footer, !!b.logoData]);
      if (els.in.dataset.key !== key) { UI.render(UI.stage.card(s.card, b), els.in); els.in.dataset.key = key; els.in.style.animation = 'none'; void els.in.offsetWidth; els.in.style.animation = ''; }
    }
  }

  // { kind, title, favicon, at }: shown for 3.5 s from t, the same in every tab the video passes through.
  let chipTimer = 0;
  function tabChip(s) {
    const t = s.tabChip, left = t ? 3500 - (Date.now() - (t.at || 0)) : 0, on = !!t && !s.card && left > 0;
    if (on) {
      // Both tabs side by side, as in a tab strip: the one the video came from and the one it is in now;
      // "…" stands for tabs between or around them.
      const key = JSON.stringify(t);
      if (els.tabbar.dataset.key !== key) { UI.render(UI.stage.tabStrip(t), els.tabbar); els.tabbar.dataset.key = key; }
      clearTimeout(chipTimer); chipTimer = setTimeout(() => tabChip(state), left);
    }
    els.tabbar.classList.toggle('hide', !on);
  }

  function end() {
    stage.active = false;
    host?.remove();
    for (const t of BLOCKED) removeEventListener(t, block, true);
  }

  const stage = globalThis.__showAndTellStage = { active: true };
  for (const t of BLOCKED) addEventListener(t, block, { capture: true, passive: false });
  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m.cmd !== 'stage') return false;
    if (m.end) end();
    else {
      if (!stage.active) for (const t of BLOCKED) addEventListener(t, block, { capture: true, passive: false });
      stage.active = true;
      state = m.state || {};
      render();
    }
    reply({ ok: true });
    return false;
  });
})();
