// Checks what the M3E rewrite added: the test page's cards and debug side sheet, the slider inside its card,
// the Annotate toolbar drawn into the page, and the session colour in the panel header.
import fs from 'node:fs';
import path from 'node:path';
import { agent, panel, page, check, summary, sleep, LAB, SHOTS } from './lib.mjs';
const a = await agent();
await a.tool('browser_navigate', { url: LAB + '?ui' });
const pn = await panel();
const lab = await page(u => u.endsWith('?ui'));
await lab.send('Page.bringToFront'); await sleep(800);
const J = s => JSON.parse(s);
const only = process.argv[2];
const run = async (name, fn) => { if (only && !only.split(',').includes(name)) return; console.log(`\n== ${name}`); try { await fn(); } catch (e) { check(name + ' ran through', false, e.stack); } };
const width = async (s, w) => { if (w) await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 0, mobile: false }); else await s.send('Emulation.clearDeviceMetricsOverride'); await sleep(400); };
const shot = async (s, name) => fs.writeFileSync(path.join(SHOTS, `ui-${name}.png`), Buffer.from((await s.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const scheme = async (s, v) => { await s.send('Emulation.setEmulatedMedia', { features: v ? [{ name: 'prefers-color-scheme', value: v }] : [] }); await sleep(300); };

await run('cards', async () => {
  const ids = ['tap', 'dtap', 'lp', 'pinch', 'strip-box', 'drop', 'btn-box', 'dbl', 'ctx', 'hover', 'scr-box', 'name-box', 'form-box',
    'size-box', 'agree-box', 'vol-box', 'dlg-box', 'keys-box', 'tabs-box', 'load-box'];
  const missing = J(await lab.ev(`JSON.stringify(${JSON.stringify(ids)}.filter(id => !document.querySelector('#' + id + ' .state')))`));
  check('every card has its id and a status line in the page (not in a shadow root)', !missing.length, missing.join(', '));
  const controls = J(await lab.ev(`JSON.stringify(['#btn', '#name', '#query', '#size', '#agree', '#vol', '#open-dlg', '#newtab-link', '#load', '#drag', '#strip', '#scr', '#menu', '#dlg', '#log', '#next-link', '#debug-btn'].filter(s => !document.querySelector(s)))`));
  check('controls keep their ids', !controls.length, controls.join(', '));
  for (const [w, sch] of [[0, 'light'], [760, 'light'], [0, 'dark']]) {
    await width(lab, w); await scheme(lab, sch);
    const m = J(await lab.ev(`JSON.stringify({ over: document.documentElement.scrollWidth > innerWidth,
      // Cards only; what scrolls inside the swipe strip is clipped by it on purpose.
      out: [...document.querySelectorAll('.box')].filter(c => { const b = c.getBoundingClientRect(); return [...c.querySelectorAll('*')].some(e => { if (e.closest('.strip')) return false; const r = e.getBoundingClientRect(); return r.width && (r.right > b.right + 1 || r.left < b.left - 1); }); }).map(c => c.id) })`));
    check(`${w || 'full'} width, ${sch}: no horizontal overflow, nothing sticks out of its card`, !m.over && !m.out.length, JSON.stringify(m));
    await shot(lab, `lab-${w || 'full'}-${sch}`);
  }
  await width(lab, 0); await scheme(lab, '');
});

await run('slider', async () => {
  for (const w of [0, 760]) {
    await width(lab, w);
    const m = J(await lab.ev(`(() => { const c = document.querySelector('#vol-box').getBoundingClientRect(), s = document.querySelector('#vol-box m3e-slider').getBoundingClientRect();
      const card = getComputedStyle(document.querySelector('#vol-box')).getPropertyValue('--m3e-filled-card-container-color') || getComputedStyle(document.body).getPropertyValue('--md-sys-color-surface-container-highest');
      return JSON.stringify({ gap: Math.round(c.right - s.right), track: getComputedStyle(document.querySelector('#vol-box m3e-slider')).getPropertyValue('--m3e-slider-inactive-track-color').trim(),
        secondary: getComputedStyle(document.body).getPropertyValue('--md-sys-color-secondary-container').trim() }); })()`));
    check(`slider at ${w || 'full'} width stays inside its card`, m.gap >= 8, JSON.stringify(m));
    check('its inactive track is not the colour of a card that reacted', m.track && !/secondary-container/.test(m.track), JSON.stringify(m));
  }
  await width(lab, 0);
});

await run('debug-sheet', async () => {
  await lab.click('#debug-btn'); await sleep(500);
  const [innerW, clientW] = J(await lab.ev(`JSON.stringify([innerWidth, document.documentElement.clientWidth])`)); // the page scrollbar
  let m = J(await lab.ev(`(() => { const s = document.querySelector('#debug-panel'); if (!s) return JSON.stringify({ open: false }); const r = s.getBoundingClientRect();
    return JSON.stringify({ open: true, right: Math.round(innerWidth - r.right), top: Math.round(r.top), groups: s.querySelectorAll('.group').length, chips: s.querySelectorAll('.ev').length,
      search: !!s.querySelector('#ev-search'), sum: s.querySelector('#adv-sum').textContent }); })()`));
  check('the bug button opens the side sheet at the right, with search and all event chips', m.open && m.right <= 12 + (innerW - clientW) && m.search && m.groups === 11 && m.chips === 38, JSON.stringify(m));
  await shot(lab, 'debug-sheet');
  await lab.click('.ev[data-type="click"]'); await sleep(300);
  m = J(await lab.ev(`JSON.stringify({ sum: document.querySelector('#adv-sum').textContent, mouse: document.querySelector('[data-group="Mouse"] .count').textContent, stored: JSON.parse(localStorage.labLog).types })`));
  check('a chip turns its event type on and is remembered', m.mouse === '1/5' && m.stored.includes('click') && /1 of 38/.test(m.sum), JSON.stringify(m));
  await lab.click('#btn'); await sleep(300);
  check('the log then shows raw click events', J(await lab.ev(`JSON.stringify([...document.querySelectorAll('#log .raw')].some(d => /click/.test(d.textContent)))`)));
  await lab.click('#ev-search'); await lab.send('Input.insertText', { text: 'drag' }); await sleep(300);
  m = J(await lab.ev(`JSON.stringify({ groups: document.querySelectorAll('#ev-list .group').length, chips: document.querySelectorAll('#ev-list .ev').length })`));
  check('search narrows the chips', m.groups === 1 && m.chips === 7, JSON.stringify(m));
  await lab.click('#ev-all'); await sleep(300);
  check('All acts on what the search shows', /8 of 38/.test(await lab.ev(`document.querySelector('#adv-sum').textContent`)));
  await lab.click('#ev-reset'); await sleep(300);
  check('Reset turns raw events off', /None on/.test(await lab.ev(`document.querySelector('#adv-sum').textContent`)));
  await lab.ev(`scrollTo(0, 400)`); await sleep(300);
  check('the sheet stays in view while the page scrolls', J(await lab.ev(`JSON.stringify(Math.round(document.querySelector('#debug-panel').getBoundingClientRect().top))`)) < 100);
  await lab.ev(`scrollTo(0, 0)`);
  await lab.click('#debug-close'); await sleep(300);
  check('close removes it', !(await lab.ev(`!!document.querySelector('#debug-panel')`)));
});

await run('annotate', async () => {
  pn.ev(`chrome.runtime.sendMessage({ type: 'annotate' })`).catch(() => {}); await sleep(1200);
  const { root } = await lab.send('DOM.getDocument', { depth: -1, pierce: true });
  const attrs = []; const walk = n => { const at = n.attributes || []; for (let i = 0; i < at.length; i += 2) if (at[i] === 'data-tool' || at[i] === 'data-act') attrs.push(at[i + 1]); for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c); };
  walk(root);
  check('Annotate draws its toolbar into the page: three tools, undo, cancel, Done', ['rect', 'arrow', 'pen', 'undo', 'cancel', 'done'].every(x => attrs.includes(x)), attrs.join(','));
  await shot(lab, 'annotate');
  await lab.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await lab.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(600);
});

await run('session-colour', async () => {
  // A tab taken over from an ended session (grey group) is regrouped for this one: give it a moment.
  const probe = async () => J(await pn.P(`(async () => { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); const g = t.groupId >= 0 ? await chrome.tabGroups.get(t.groupId) : null;
    const icon = $d('sat-app-icon'); return JSON.stringify({ group: g?.color || null, session: getComputedStyle(icon).getPropertyValue('--session').trim(), primary: getComputedStyle(icon).getPropertyValue('--md-sys-color-primary').trim() }); })()`));
  let m = await probe();
  for (let i = 0; i < 20 && (!m.session || m.group === 'grey'); i++) { await sleep(500); m = await probe(); }
  // Light or dark variant, whichever scheme the panel is in (the test machine's own setting).
  const GROUP = { grey: ['#5f6368', '#dadce0'], blue: ['#1a73e8', '#8ab4f8'], red: ['#d93025', '#f28b82'], yellow: ['#b06000', '#fdd663'], green: ['#188038', '#81c995'],
    pink: ['#d01884', '#ff8bcb'], purple: ['#a142f4', '#c58af9'], cyan: ['#007b83', '#78d9ec'], orange: ['#c26401', '#fcad70'] };
  const dark = await pn.P(`matchMedia('(prefers-color-scheme: dark)').matches`);
  check('the app icon in the panel header takes the colour of the session\'s tab group', m.group && m.session.toLowerCase() === GROUP[m.group]?.[dark ? 1 : 0], JSON.stringify({ ...m, dark }));
  await shot(pn, 'panel');
});

await a.close();
summary();
process.exit(0);
