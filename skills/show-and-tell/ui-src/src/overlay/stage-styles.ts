// How the video stage looks: the input shield, captions, the progress bar, the cards and the tab strip.
// Colour tokens (light scheme) come from m3-tokens.css; `branding.accent` replaces the primary colour.
export const stageStyles = `
    .shield{position:fixed;inset:0;pointer-events:auto;cursor:none;background:transparent}
    .cap{position:fixed;left:50%;bottom:30px;translate:-50% 0;box-sizing:border-box;width:max-content;max-width:min(780px,calc(100vw - 32px));padding:12px 20px;
      border-radius:12px;background:color-mix(in srgb,var(--md-sys-color-inverse-surface) 94%,transparent);
      color:var(--md-sys-color-inverse-on-surface);font:400 18px/26px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.15px;text-align:center;
      box-shadow:0 1px 3px rgb(0 0 0/.3),0 4px 8px 3px rgb(0 0 0/.15);transition:opacity .25s cubic-bezier(.2,0,0,1),translate .25s cubic-bezier(.2,0,0,1)}
    .cap .ch{font:500 12px/16px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.5px;margin-bottom:4px;
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
      padding:40px 48px;border-radius:28px;background:var(--md-sys-color-surface-container-lowest);box-shadow:0 1px 2px rgb(0 0 0/.3),0 2px 6px 2px rgb(0 0 0/.15);
      animation:rise .5s cubic-bezier(.2,0,0,1)}
    @keyframes rise{from{translate:0 16px;opacity:0}}
    .logo{max-height:44px;max-width:220px;margin-bottom:8px}
    .kicker{font:500 14px/20px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.1px;color:var(--md-sys-color-primary)}
    .title{font:400 36px/44px system-ui,"Segoe UI",Roboto,sans-serif;margin:0}
    .sub{font:500 16px/24px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.15px;color:var(--md-sys-color-on-surface-variant)}
    .list{display:grid;grid-template-columns:auto 1fr;gap:6px 20px;margin-top:8px;font:400 16px/24px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.5px}
    .list .tm{font-variant-numeric:tabular-nums;color:var(--md-sys-color-on-surface-variant)}
    .foot{margin-top:12px;padding-top:16px;border-top:1px solid var(--md-sys-color-outline-variant);align-self:stretch;
      font:400 14px/20px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.25px;color:var(--md-sys-color-on-surface-variant)}
    /* The video moved to another tab: a Chrome-style tab with the page's icon and title slides in at the top. */
    .tabbar{position:fixed;top:0;left:50%;translate:-50% 0;display:flex;align-items:flex-end;gap:16px;padding:8px 24px 0;
      border-radius:0 0 16px 16px;background:var(--md-sys-color-surface-container-highest);box-shadow:0 1px 2px rgb(0 0 0/.3),0 2px 6px 2px rgb(0 0 0/.15);
      transition:opacity .35s cubic-bezier(.2,0,0,1),translate .35s cubic-bezier(.2,0,0,1)}
    .tabbar.hide{translate:-50% -110%}
    .tabbar .kind{align-self:center;white-space:nowrap;padding-bottom:8px;font:500 12px/16px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.5px;color:var(--md-sys-color-primary)}
    .tab{position:relative;display:flex;align-items:center;gap:8px;height:36px;width:max-content;max-width:min(260px,32vw);padding:0 12px;
      border-radius:10px 10px 0 0;background:var(--md-sys-color-surface);color:var(--md-sys-color-on-surface);font:500 14px/20px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.1px}
    .tab::before,.tab::after{content:'';position:absolute;bottom:0;width:10px;height:10px}
    .tab::before{left:-10px;background:radial-gradient(circle at 0 0,transparent 9.5px,var(--md-sys-color-surface) 10px)}
    .tab::after{right:-10px;background:radial-gradient(circle at 100% 0,transparent 9.5px,var(--md-sys-color-surface) 10px)}
    .tab .ic{flex:none;width:16px;height:16px;border-radius:2px}
    .tab svg.ic{fill:var(--md-sys-color-on-surface-variant)}
    .tab .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tab .x{flex:none;width:16px;height:16px;margin-left:4px;fill:var(--md-sys-color-on-surface-variant)}
    /* Inactive tabs sit on the strip itself, like in Chrome: no surface, muted text, a divider between. */
    .tab.off{background:transparent;color:var(--md-sys-color-on-surface-variant);font-weight:400}
    .tab.off::before,.tab.off::after{display:none}
    .tab.off + .tab.off::before{display:block;content:'';left:0;top:10px;bottom:10px;width:1px;height:auto;background:var(--md-sys-color-outline-variant)}
    /* A tab the video opens grows into the strip, like Chrome adds a tab (the reverse of closing). */
    .tab.new{overflow:hidden;animation:tabopen .4s .45s cubic-bezier(.2,0,0,1) both}
    @keyframes tabopen{from{max-width:0;padding-left:0;padding-right:0;margin-left:-8px;opacity:0}to{max-width:min(260px,32vw);opacity:1}}
    /* A tab the video leaves and closes: its X is pressed (M3 state layer), then the tab collapses out of the strip. */
    .tab .x{border-radius:50%}
    .tab.closing .x{animation:xpress .95s .5s linear both}
    @keyframes xpress{0%,100%{background:transparent;box-shadow:none}
      30%{background:color-mix(in srgb,var(--md-sys-color-on-surface) 8%,transparent);box-shadow:0 0 0 5px color-mix(in srgb,var(--md-sys-color-on-surface) 8%,transparent)}
      45%,85%{background:color-mix(in srgb,var(--md-sys-color-on-surface) 20%,transparent);box-shadow:0 0 0 5px color-mix(in srgb,var(--md-sys-color-on-surface) 20%,transparent)}}
    .tab.closing{overflow:hidden;animation:tabclose .35s 1.45s cubic-bezier(.3,0,.8,.15) forwards}
    @keyframes tabclose{to{max-width:0;padding-left:0;padding-right:0;margin-left:-8px;opacity:0}}
    .tabs{display:flex;align-items:flex-end;gap:8px}
    /* The other tabs, not listed: one inactive tab with an ellipsis, always between the two. */
    .tab.more{padding:0 16px;font-size:20px;font-weight:700;color:var(--md-sys-color-on-surface-variant)}`;
