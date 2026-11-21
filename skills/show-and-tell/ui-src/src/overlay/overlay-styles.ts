// How the in-page overlay looks: highlights, the picker, marks, notes and the Annotate controls.
// Colour tokens come from m3-tokens.css, which content.js loads into the overlay's shadow root.
export const overlayStyles = `
    .box{position:fixed;left:0;top:0;box-sizing:border-box;border:2px solid var(--c);border-radius:12px;
      box-shadow:0 0 0 2px #fff,0 0 0 0 color-mix(in srgb,var(--c) 40%,transparent);animation:ring 1.6s cubic-bezier(.2,0,0,1) 3}
    @keyframes ring{from{box-shadow:0 0 0 2px #fff,0 0 0 2px color-mix(in srgb,var(--c) 45%,transparent)}
      to{box-shadow:0 0 0 2px #fff,0 0 0 16px transparent}}
    .label{position:fixed;left:0;top:0;box-sizing:border-box;max-width:min(320px,calc(100vw - 8px));padding:12px 16px;
      border-radius:12px;background:var(--c);color:#fff;font:500 14px/20px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.1px;
      box-shadow:0 1px 3px rgb(0 0 0/.3),0 4px 8px 3px rgb(0 0 0/.15);white-space:pre-wrap;overflow-wrap:anywhere;
      animation:pop .2s cubic-bezier(.2,0,0,1)}
    @keyframes pop{from{scale:.92}}
    .dim{position:fixed;left:0;top:0;width:100vw;height:100vh}
    .dim path{fill:rgb(0 0 0/.32)}
    .pick{position:fixed;left:0;top:0;box-sizing:border-box;border:2px dashed var(--md-sys-color-primary,#000);
      background:color-mix(in srgb,var(--md-sys-color-primary,#000) 8%,transparent);border-radius:8px}
    .pick-tag{position:fixed;left:0;top:0;padding:4px 8px;border-radius:4px;background:var(--md-sys-color-inverse-surface,#2f3036);
      color:var(--md-sys-color-inverse-on-surface,#f1f0f7);
      font:500 12px/16px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.5px;white-space:nowrap;
      box-shadow:0 1px 2px rgb(0 0 0/.3),0 1px 3px 1px rgb(0 0 0/.15)}
    .annot{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;touch-action:none;
      font:400 14px/20px system-ui,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
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
    .mark .badge text{fill:var(--on,#fff);font:600 12px system-ui,"Segoe UI",Roboto,sans-serif;text-anchor:middle;dominant-baseline:central;pointer-events:none}
    .note,.note-edit{position:fixed;left:0;top:0;box-sizing:border-box;display:flex;align-items:flex-start;gap:8px;
      color:var(--md-sys-color-on-surface,#1a1b21);transform-origin:17px 17px;animation:grow .18s cubic-bezier(.2,0,0,1)}
    .note.left,.note-edit.left{flex-direction:row-reverse}
    .note.up,.note-edit.up{align-items:flex-end;transform-origin:17px calc(100% - 17px)}
    .note.left,.note-edit.left{transform-origin:calc(100% - 17px) 17px}
    .note.left.up,.note-edit.left.up{transform-origin:calc(100% - 17px) calc(100% - 17px)}
    @keyframes grow{from{scale:.6;opacity:0}}
    .note .num,.note-edit .num{flex:none;width:22px;height:22px;border-radius:50%;background:var(--c);color:var(--on,#fff);
      box-shadow:0 0 0 1px var(--md-sys-color-surface,#fff);font:600 12px/22px system-ui,"Segoe UI",Roboto,sans-serif;text-align:center}
    .note{max-width:280px;min-height:34px;padding:6px 14px 6px 6px;border-radius:17px;cursor:pointer;
      background:var(--note-bg);
      box-shadow:0 1px 2px rgb(0 0 0/.3),0 2px 6px 2px rgb(0 0 0/.15)}
    .note.left{padding:6px 6px 6px 14px}
    :host{--note-bg:var(--md-sys-color-surface-container-lowest,#fff)}
    :host(.dark){--note-bg:var(--md-sys-color-surface-container-high,#282a2f)}
    .note::before{content:'';position:absolute;inset:0;border-radius:inherit;background:currentColor;opacity:0;transition:opacity .15s}
    .note:hover::before{opacity:.08}
    .note .text{min-width:0;padding-top:1px;font:400 14px/20px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.25px;white-space:pre-wrap;overflow-wrap:anywhere}
    /* ---- Annotate controls: plain templates that look like the M3E ones in the panel ---- */
    .note-edit{width:328px;padding:8px 6px 6px 8px;border-radius:16px;cursor:default;
      background:var(--md-sys-color-surface-container-high,#f4e6da);
      box-shadow:0 1px 3px rgb(0 0 0/.3),0 4px 8px 3px rgb(0 0 0/.15)}
    .note-edit .num{margin-top:17px}
    .note-edit .field{flex:1;min-width:0}
    /* a filled text field: small label, value, and an active line in the mark's colour */
    .note-edit .tf{display:block;box-sizing:border-box;padding:6px 16px 6px;border-radius:4px 4px 0 0;cursor:text;
      background:var(--md-sys-color-surface-container-highest,#eee0d5);box-shadow:inset 0 -2px 0 var(--c)}
    .note-edit .lbl{display:block;font:400 12px/16px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.4px;color:var(--c)}
    .note-edit input{all:unset;box-sizing:border-box;display:block;width:100%;
      font:400 16px/24px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.5px;color:inherit;cursor:text;caret-color:var(--c)}
    .note-edit input::placeholder{color:var(--md-sys-color-on-surface-variant,#51443a)}
    .note-edit .help{padding:4px 16px 0;font:400 12px/16px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.4px;color:var(--md-sys-color-on-surface-variant,#51443a)}
    /* icon buttons: 40px, round, with a state layer; a selected tool becomes a rounded square */
    .ib{all:unset;position:relative;box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;
      width:40px;height:40px;margin:4px;border-radius:20px;color:var(--md-sys-color-on-surface-variant,#51443a);cursor:pointer;
      transition:border-radius .2s cubic-bezier(.2,0,0,1),background-color .2s cubic-bezier(.2,0,0,1)}
    .ib::before,.bar .filled::before{content:'';position:absolute;inset:0;border-radius:inherit;background:currentColor;opacity:0;transition:opacity .15s}
    .ib:hover::before,.bar .filled:hover::before{opacity:.08}
    .ib:active::before,.bar .filled:active::before{opacity:.12}
    .ib:focus-visible,.bar .filled:focus-visible{outline:3px solid var(--md-sys-color-secondary,#725a42);outline-offset:2px}
    .ib:disabled{cursor:default;opacity:.38}
    .ib:disabled::before{opacity:0}
    .ib.on{border-radius:12px;background:var(--md-sys-color-secondary-container,#feddbe);color:var(--md-sys-color-on-secondary-container,#58432e)}
    .ib svg,.bar .filled svg{width:24px;height:24px;fill:currentColor;flex:none}
    .note-edit .del{margin:4px 0 0}
    .bar{position:fixed;top:16px;left:50%;translate:-50% 0;display:flex;align-items:center;gap:0;padding:4px 12px 4px 8px;border-radius:999px;
      background:var(--md-sys-color-surface-container,#faebe0);color:var(--md-sys-color-on-surface-variant,#51443a);
      box-shadow:0 1px 3px rgb(0 0 0/.3),0 4px 8px 3px rgb(0 0 0/.15);cursor:default;user-select:none}
    .bar .filled{all:unset;position:relative;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:8px;
      height:40px;padding:0 24px 0 16px;margin-left:8px;border-radius:20px;cursor:pointer;
      font:500 14px/20px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.1px;
      background:var(--md-sys-color-primary,#000);color:var(--md-sys-color-on-primary,#fff)}
    .bar .filled svg{width:20px;height:20px}
    .bar .filled:disabled{cursor:default;background:color-mix(in srgb,var(--md-sys-color-on-surface,#221a14) 12%,transparent);
      color:color-mix(in srgb,var(--md-sys-color-on-surface,#221a14) 38%,transparent)}
    .bar .filled:disabled::before{opacity:0}
    .bar .hint{padding:0 12px 0 8px;font:400 12px/16px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.4px;white-space:nowrap}
    .bar .sep{width:1px;height:24px;background:var(--md-sys-color-outline-variant,#d6c3b6);margin:0 4px}
    .annot [data-tip]:hover::after{z-index:1;content:attr(data-tip);position:absolute;top:calc(100% + 8px);left:50%;translate:-50% 0;
      padding:4px 8px;border-radius:4px;background:var(--md-sys-color-inverse-surface,#382f28);color:var(--md-sys-color-inverse-on-surface,#feeee3);
      font:400 12px/16px system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:.4px;white-space:nowrap;pointer-events:none}
    @media (max-width:680px){.bar .hint{display:none}.bar{padding:4px 8px 4px 4px}.ib{margin:2px}}`;
