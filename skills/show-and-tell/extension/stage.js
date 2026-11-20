// Video stage: injected into the tour tab only while a video is recorded. It draws what frames the page in
// the video (captions, chapter label, progress bar, intro/outro/section cards) and shields the page from
// the real mouse and keyboard, so only the scripted actions reach it. The worker sends the full state on
// every change (`{ cmd: 'stage', state }`) and again after each page load, so nothing here has to persist.
// Material 3: the panel's colour tokens (light scheme), type scale and elevation; `branding.accent`
// replaces the primary colour.
(() => {
  if (window.top !== window) return;
  if (globalThis.__showAndTellStage) return;

  const FONT = 'system-ui,"Segoe UI",Roboto,sans-serif';
  const EL2 = '0 1px 2px rgb(0 0 0/.3),0 2px 6px 2px rgb(0 0 0/.15)';
  const EL3 = '0 1px 3px rgb(0 0 0/.3),0 4px 8px 3px rgb(0 0 0/.15)';
  const STYLES = `
    .shield{position:fixed;inset:0;pointer-events:auto;cursor:none;background:transparent}
    .cap{position:fixed;left:50%;bottom:30px;translate:-50% 0;box-sizing:border-box;width:max-content;max-width:min(780px,calc(100vw - 32px));padding:12px 20px;
      border-radius:12px;background:color-mix(in srgb,var(--md-sys-color-inverse-surface) 94%,transparent);
      color:var(--md-sys-color-inverse-on-surface);font:400 18px/26px ${FONT};letter-spacing:.15px;text-align:center;
      box-shadow:${EL3};transition:opacity .25s cubic-bezier(.2,0,0,1),translate .25s cubic-bezier(.2,0,0,1)}
    .cap .ch{font:500 12px/16px ${FONT};letter-spacing:.5px;margin-bottom:4px;
      color:color-mix(in srgb,var(--md-sys-color-primary) 40%,var(--md-sys-color-inverse-on-surface))}
    .cap .ch:empty,.cap .tx:empty{display:none}
    .cap:has(.tx:empty) .ch{margin:0}
    .tx{transition:opacity .2s cubic-bezier(.2,0,0,1)}
    @media (max-width:600px){.cap{font-size:16px;line-height:24px;letter-spacing:.5px;padding:10px 16px}}
    .cap.dodge{opacity:.12}
    .hide{opacity:0!important}
    .cap.hide{translate:-50% 10px}
    .bar{position:fixed;left:0;right:0;bottom:0;height:4px;background:var(--md-sys-color-secondary-container)}
    .bar .fill{position:absolute;left:0;top:0;bottom:0;background:var(--md-sys-color-primary);transition:width .6s cubic-bezier(.2,0,0,1)}
    .bar .tick{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:var(--md-sys-color-surface)}
    .card{position:fixed;inset:0;display:grid;place-items:center;background:var(--md-sys-color-surface-container-low);
      color:var(--md-sys-color-on-surface);transition:opacity .4s cubic-bezier(.2,0,0,1)}
    .card .in{box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:12px;width:min(760px,80vw);
      padding:40px 48px;border-radius:28px;background:var(--md-sys-color-surface-container-lowest);box-shadow:${EL2};
      animation:rise .5s cubic-bezier(.2,0,0,1)}
    @keyframes rise{from{translate:0 16px;opacity:0}}
    .logo{max-height:44px;max-width:220px;margin-bottom:8px}
    .kicker{font:500 14px/20px ${FONT};letter-spacing:.1px;color:var(--md-sys-color-primary)}
    .title{font:400 36px/44px ${FONT};margin:0}
    .sub{font:500 16px/24px ${FONT};letter-spacing:.15px;color:var(--md-sys-color-on-surface-variant)}
    .list{display:grid;grid-template-columns:auto 1fr;gap:6px 20px;margin-top:8px;font:400 16px/24px ${FONT};letter-spacing:.5px}
    .list .tm{font-variant-numeric:tabular-nums;color:var(--md-sys-color-on-surface-variant)}
    .foot{margin-top:12px;padding-top:16px;border-top:1px solid var(--md-sys-color-outline-variant);align-self:stretch;
      font:400 14px/20px ${FONT};letter-spacing:.25px;color:var(--md-sys-color-on-surface-variant)}
    /* The video moved to another tab: a Chrome-style tab with the page's icon and title slides in at the top. */
    .tabbar{position:fixed;top:0;left:50%;translate:-50% 0;display:flex;align-items:flex-end;gap:16px;padding:8px 24px 0;
      border-radius:0 0 16px 16px;background:var(--md-sys-color-surface-container-highest);box-shadow:${EL2};
      transition:opacity .35s cubic-bezier(.2,0,0,1),translate .35s cubic-bezier(.2,0,0,1)}
    .tabbar.hide{translate:-50% -110%}
    .tabbar .kind{align-self:center;white-space:nowrap;padding-bottom:8px;font:500 12px/16px ${FONT};letter-spacing:.5px;color:var(--md-sys-color-primary)}
    .tab{position:relative;display:flex;align-items:center;gap:8px;height:36px;width:max-content;max-width:min(260px,32vw);padding:0 12px;
      border-radius:10px 10px 0 0;background:var(--md-sys-color-surface);color:var(--md-sys-color-on-surface);font:500 14px/20px ${FONT};letter-spacing:.1px}
    .tab::before,.tab::after{content:'';position:absolute;bottom:0;width:10px;height:10px}
    .tab::before{left:-10px;background:radial-gradient(circle at 0 0,transparent 9.5px,var(--md-sys-color-surface) 10px)}
    .tab::after{right:-10px;background:radial-gradient(circle at 100% 0,transparent 9.5px,var(--md-sys-color-surface) 10px)}
    .tab .ic{flex:none;width:16px;height:16px;border-radius:2px}
    .tab .ic.globe{fill:var(--md-sys-color-on-surface-variant)}
    .tab .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tab .x{flex:none;width:16px;height:16px;margin-left:4px;fill:var(--md-sys-color-on-surface-variant)}
    /* Inactive tabs sit on the strip itself, like in Chrome: no surface, muted text, a divider between. */
    .tab.off{background:transparent;color:var(--md-sys-color-on-surface-variant);font-weight:400}
    .tab.off::before,.tab.off::after{display:none}
    .tab.off + .tab.off::before{display:block;content:'';left:0;top:10px;bottom:10px;width:1px;height:auto;background:var(--md-sys-color-outline-variant)}
    .tab.on{animation:tabin .35s cubic-bezier(.2,0,0,1)}
    @keyframes tabin{from{opacity:0;translate:0 8px}}
    .tabs{display:flex;align-items:flex-end;gap:8px}`;

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

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function cardHtml(c, b) {
    const logo = b.logoData ? `<img class="logo" alt="" src="${esc(b.logoData)}">` : '';
    if (c.kind === 'section') return `<div class="kicker">${esc(c.kicker || 'Section')}</div><h1 class="title">${esc(c.title)}</h1>`;
    if (c.kind === 'outro') {
      const list = (c.chapters || []).map(ch => `<span class="tm">${esc(ch.time)}</span><span>${esc(ch.title)}</span>`).join('');
      return `${logo}<div class="kicker">${esc(c.kicker || 'Thank you for watching')}</div><h1 class="title">${esc(c.title)}</h1>`
        + (list ? `<div class="list">${list}</div>` : '') + (b.footer ? `<div class="foot">${esc(b.footer)}</div>` : '');
    }
    return `${logo}<div class="kicker">${esc(c.kicker || b.name || 'Review')}</div><h1 class="title">${esc(c.title)}</h1>`
      + (c.subtitle ? `<div class="sub">${esc(c.subtitle)}</div>` : '');
  }

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
      const html = cardHtml(s.card, b);
      if (els.in.dataset.html !== html) { els.in.innerHTML = html; els.in.dataset.html = html; els.in.style.animation = 'none'; void els.in.offsetWidth; els.in.style.animation = ''; }
    }
  }

  // { kind, title, favicon, at }: shown for 3.5 s from t, the same in every tab the video passes through.
  const GLOBE = '<svg class="ic globe" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h2.9c.3 1.3.8 2.5 1.4 3.6A8 8 0 0 1 5.1 16zM8 8H5.1a8 8 0 0 1 4.3-3.6C8.8 5.5 8.3 6.7 8 8zm4 12c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4z"/></svg>';
  const X = '<svg class="x" viewBox="0 0 24 24"><path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>';
  let chipTimer = 0;
  function tabChip(s) {
    const t = s.tabChip, left = t ? 3500 - (Date.now() - (t.at || 0)) : 0, on = !!t && !s.card && left > 0;
    if (on) {
      // Both tabs side by side, as in a tab strip: the one the video came from and the one it is in now.
      const list = t.tabs?.length ? t.tabs : [{ title: t.title, url: t.url, favicon: t.favicon, active: true }];
      const html = `<span class="kind">${esc(t.kind || 'New tab')}</span><span class="tabs">` + list.map(x => `<span class="tab ${x.active ? 'on' : 'off'}">`
        + (x.favicon ? `<img class="ic" alt="" src="${esc(x.favicon)}">` : GLOBE) + `<span class="t">${esc(x.title || x.url || '')}</span>${X}</span>`).join('') + '</span>';
      if (els.tabbar.dataset.html !== html) {
        els.tabbar.innerHTML = html; els.tabbar.dataset.html = html;
        for (const img of els.tabbar.querySelectorAll('img.ic')) img.onerror = () => { img.outerHTML = GLOBE; };
      }
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
