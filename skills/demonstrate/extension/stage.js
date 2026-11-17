// Video stage: injected into the tour tab only while a video is recorded. It draws what frames the page in
// the video (captions, chapter label, progress bar, intro/outro/section cards) and shields the page from
// the real mouse and keyboard, so only the scripted actions reach it. The worker sends the full state on
// every change (`{ cmd: 'stage', state }`) and again after each page load, so nothing here has to persist.
// Material 3: the panel's colour tokens (light scheme), type scale and elevation; `branding.accent`
// replaces the primary colour.
(() => {
  if (window.top !== window) return;
  if (globalThis.__demonstrateStage) return;

  const FONT = 'system-ui,"Segoe UI",Roboto,sans-serif';
  const EL2 = '0 1px 2px rgb(0 0 0/.3),0 2px 6px 2px rgb(0 0 0/.15)';
  const EL3 = '0 1px 3px rgb(0 0 0/.3),0 4px 8px 3px rgb(0 0 0/.15)';
  const STYLES = `
    .shield{position:fixed;inset:0;pointer-events:auto;cursor:none;background:transparent}
    .cap{position:fixed;left:50%;bottom:30px;translate:-50% 0;box-sizing:border-box;max-width:min(780px,84vw);padding:12px 20px;
      border-radius:12px;background:color-mix(in srgb,var(--md-sys-color-inverse-surface) 94%,transparent);
      color:var(--md-sys-color-inverse-on-surface);font:400 18px/26px ${FONT};letter-spacing:.15px;text-align:center;
      box-shadow:${EL3};transition:opacity .25s cubic-bezier(.2,0,0,1),translate .25s cubic-bezier(.2,0,0,1)}
    .lower{position:fixed;left:24px;top:24px;display:flex;align-items:center;gap:12px;padding:8px 20px 8px 8px;border-radius:16px;
      background:var(--md-sys-color-surface-container-high);color:var(--md-sys-color-on-surface);box-shadow:${EL2};
      transition:opacity .3s cubic-bezier(.2,0,0,1),translate .3s cubic-bezier(.2,0,0,1)}
    .lower .n{box-sizing:border-box;min-width:40px;height:40px;padding:0 10px;border-radius:12px;background:var(--md-sys-color-primary);
      color:var(--md-sys-color-on-primary);font:500 16px/40px ${FONT};text-align:center}
    .lower .k{font:500 11px/16px ${FONT};letter-spacing:.5px;color:var(--md-sys-color-on-surface-variant);text-transform:uppercase}
    .lower .t{font:500 16px/24px ${FONT};letter-spacing:.15px}
    .hide{opacity:0!important}
    .cap.hide{translate:-50% 10px}
    .lower.hide{translate:-12px 0}
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
      font:400 14px/20px ${FONT};letter-spacing:.25px;color:var(--md-sys-color-on-surface-variant)}`;

  let host = null, root = null, els = {}, state = {}, lowerTimer = 0;
  const tokens = fetch(chrome.runtime.getURL('vendor/m3-tokens.css')).then(r => r.text())
    .then(css => `:host{${(css.match(/:root\s*\{([^}]*)\}/) || [])[1] || ''}}`).catch(() => '');

  function mount() {
    if (host?.isConnected) return;
    if (!host) {
      host = document.createElement('demonstrate-stage');
      host.setAttribute('style', 'all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;'
        + 'margin:0!important;padding:0!important;border:0!important;background:transparent!important;overflow:visible!important;'
        + 'pointer-events:none!important;z-index:2147483646!important;');
      host.popover = 'manual';
      root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style class="tokens"></style><style>${STYLES}</style><div class="shield"></div>
        <div class="bar"><div class="fill"></div></div><div class="lower hide"><span class="n"></span><span><div class="k"></div><div class="t"></div></span></div>
        <div class="cap hide"></div><div class="card hide"><div class="in"></div></div>`;
      for (const k of ['shield', 'bar', 'fill', 'lower', 'cap', 'card', 'in']) els[k] = root.querySelector('.' + k);
      els.n = els.lower.querySelector('.n'); els.k = els.lower.querySelector('.k'); els.t = els.lower.querySelector('.t');
      const style = root.querySelector('.tokens');
      tokens.then(css => { style.textContent = css; });
    }
    document.documentElement.appendChild(host);
    try { host.showPopover(); } catch {}
    // The demonstrate overlay (highlights and the drawn pointer) must stay above the stage.
    const overlay = document.querySelector('demonstrate-overlay');
    if (overlay?.matches(':popover-open')) { try { overlay.hidePopover(); overlay.showPopover(); } catch {} }
  }

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
    const l = s.lower;
    clearTimeout(lowerTimer);
    if (l && !s.card) {
      els.n.textContent = String(l.n);
      els.k.textContent = l.kicker || `Chapter ${l.n} of ${l.of}`;
      els.t.textContent = l.title;
      els.lower.classList.remove('hide');
      const left = (l.until || 0) - Date.now();
      if (left > 0) lowerTimer = setTimeout(() => els.lower.classList.add('hide'), left);
      else els.lower.classList.add('hide');
    } else els.lower.classList.add('hide');
    els.cap.classList.toggle('hide', !s.caption || !!s.card);
    if (s.caption) els.cap.textContent = s.caption;
    els.card.classList.toggle('hide', !s.card);
    if (s.card) {
      const html = cardHtml(s.card, b);
      if (els.in.dataset.html !== html) { els.in.innerHTML = html; els.in.dataset.html = html; els.in.style.animation = 'none'; void els.in.offsetWidth; els.in.style.animation = ''; }
    }
  }

  function end() {
    stage.active = false;
    clearTimeout(lowerTimer);
    host?.remove();
    for (const t of BLOCKED) removeEventListener(t, block, true);
  }

  const stage = globalThis.__demonstrateStage = { active: true };
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
