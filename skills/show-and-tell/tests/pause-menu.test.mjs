// Checks: the pause card's split button (Resume + menu), reloading from a pause, and the header in a narrow panel.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { agent, panel, page, show, check, summary, sleep, LAB, SKILL, ENV, SHOTS } from './lib.mjs';
const a = await agent();
await a.tool('browser_navigate', { url: LAB + '?p7' });
const pn = await panel();
const card = async () => JSON.parse(await pn.P(`(() => { const e = document.getElementById('pause'), v = id => { const x = document.getElementById(id); return !x.hidden && x.getClientRects().length > 0; };
  return JSON.stringify({ hidden: e.hidden, state: e.dataset.state, title: document.getElementById('pause-title').textContent, detail: document.getElementById('pause-detail').textContent,
    text: v('pause-action'), split: v('pause-split'), more: v('pause-more'), single: document.getElementById('pause-split').classList.contains('single'),
    remove: !document.getElementById('pause-remove').hidden, open: document.getElementById('pause-menu').open, expanded: document.getElementById('pause-more').ariaExpanded }); })()`));
const stored = async () => Object.values(JSON.parse(await pn.P(`chrome.storage.session.get('pauses').then(x => JSON.stringify(x.pauses || {}))`)))[0] || null;
let lab = await page(u => u.endsWith('?p7'));
await lab.send('Page.bringToFront'); await sleep(600);
const box = () => lab.ev(`document.querySelector('#load-box .state').innerText`).catch(e => e.message);
const mark = () => lab.ev(`window.__mark = 1`);
const marked = () => lab.ev(`window.__mark === 1`).catch(e => e.message);
const J = s => { try { return JSON.parse(s); } catch { return { raw: s }; } };
const only = process.argv[2];
const clean = async () => { await a.tool('pause', { remove: 'all' }); await a.tool('resume'); await sleep(500); while ((await a.wait(1)).length); };
const run = async (name, fn) => { if (only && !only.split(',').includes(name)) return; await clean(); console.log(`\n== ${name}`); try { await fn(); } catch (e) { check(name + ' ran through', false, e.stack); } };
// clip: "top" = the app bar, "pinned" = the cards, "all" = the whole panel.
const shot = async (name, clip = 'pinned') => { for (const scheme of ['light', 'dark']) {
  await pn.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }); await sleep(350);
  const r = JSON.parse(await pn.P(`(() => { const r = document.querySelector('.${clip === 'top' ? 'top' : 'pinned'}').getBoundingClientRect();
    return JSON.stringify(${clip === 'all'} ? { x: 0, y: 0, width: innerWidth, height: Math.min(innerHeight, 420) } : { x: 0, y: Math.max(0, r.top - 4), width: innerWidth, height: r.height + 8 }); })()`));
  fs.writeFileSync(path.join(SHOTS, `pause-menu-${name}-${scheme}.png`), Buffer.from((await pn.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 2 } })).data, 'base64'));
} await pn.send('Emulation.setEmulatedMedia', { features: [] }); };
const width = async w => { if (w) await pn.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 0, mobile: false }); else await pn.send('Emulation.clearDeviceMetricsOverride'); await sleep(300); };
const openMenu = async () => { await pn.click('#pause-more'); await sleep(700); };
const choose = async what => { await openMenu(); await pn.click(`#pause-menu [data-do="${what}"]`); await sleep(1500); };
const LINE = 'renderItems(data.items)';
const paused = async () => { await mark(); await lab.click('#load'); await sleep(900); return stored(); };

await run('header', async () => {
  console.log('      panel width ' + await pn.P('innerWidth'));
  const measure = () => pn.P(`(() => { const h = document.querySelector('.top').getBoundingClientRect(), l = document.getElementById('listen-text'), c = document.getElementById('conn');
    return JSON.stringify({ height: Math.round(h.height), lines: Math.round(l.getBoundingClientRect().height / parseFloat(getComputedStyle(l).lineHeight)), cut: l.scrollWidth > l.clientWidth, text: l.textContent,
      title: document.getElementById('listen').title, conn: c.title, connText: document.getElementById('conn-text').hidden ? null : c.textContent, connWidth: Math.round(c.getBoundingClientRect().width), overflow: document.documentElement.scrollWidth > innerWidth }); })()`).then(JSON.parse);
  // The side panel is never narrower than 360 px; 320 for margin.
  for (const w of [0, 360, 320]) {
    await width(w);
    const m = await measure();
    check(`header at ${w || 'its own width'}: one line, nothing overflows`, m.lines === 1 && !m.overflow && m.title === m.text, JSON.stringify(m));
    await shot('header-' + (w || 'default'), 'top');
  }
  await width(0);
});

await run('once', async () => {
  const set = J(await a.tool('pause', { on: 'line', text: LINE }));
  const p = await paused();
  check('paused at a once point: it is named, and no longer set', p?.paused?.point?.id === set.id && p.paused.point.kept === false && p.points.length === 0, JSON.stringify(p));
  let c = await card();
  check('card: split button, menu button, no "remove" item', c.state === 'paused' && c.split && c.more && !c.text && !c.single && !c.remove, JSON.stringify(c));
  await shot('split');
  await width(320); await shot('split-320'); await width(0);
  await openMenu();
  c = await card();
  check('menu opens from the trailing button', c.open && c.expanded === 'true', JSON.stringify(c));
  const items = JSON.parse(await pn.P(`JSON.stringify([...document.querySelectorAll('#pause-menu md-menu-item')].filter(i => !i.hidden).map(i => i.textContent.trim()))`));
  check('menu: the three reload items', items.join('|') === 'Reload to breakpoint|Reload and ignore breakpoint once|Reload and remove breakpoint', items.join('|'));
  const fit = JSON.parse(await pn.P(`(() => { const r = document.getElementById('pause-menu').shadowRoot.querySelector('.menu').getBoundingClientRect(); return JSON.stringify({ left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), w: innerWidth }); })()`));
  check('menu lies inside the panel', fit.left >= 0 && fit.right <= fit.w, JSON.stringify(fit));
  await shot('menu', 'all');
  await width(320); await sleep(300); await shot('menu-320', 'all'); await width(0);
  await pn.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await pn.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(600);
  c = await card();
  check('Escape closes the menu and the page stays paused', !c.open && c.expanded === 'false' && c.state === 'paused', JSON.stringify(c));
  await choose('again');
  let s = await stored();
  check('reload to breakpoint: reloaded, running, same point set again', (await marked()) === false && !s?.paused && s?.points[0]?.id === set.id && s.points[0].once === true, JSON.stringify(s) + ' marked ' + await marked());
  c = await card();
  check('card: pause point set', c.state === 'armed' && c.text && !c.split, JSON.stringify(c));
  let w = await a.wait(3);
  check('the agent is told what the user chose', w.some(x => x.type === 'resumed' && x.by === 'user' && /reloaded.*pauses at .* again/.test(x.note)), JSON.stringify(w));
  let p2 = await paused();
  check('it pauses there again', p2?.paused?.point?.id === set.id && /loadItems/.test(p2.paused.fn), JSON.stringify(p2?.paused));
  w = await a.wait(3);
  check('and the agent hears of the new pause', w.some(x => x.type === 'paused'), JSON.stringify(w));
  await choose('skip');
  s = await stored();
  check('ignore once: reloaded, point set with one hit to pass', (await marked()) === false && s?.points[0]?.id === set.id && s.points[0].skip === 1, JSON.stringify(s));
  c = await card();
  check('card says that the next hit passes', /lets the next hit pass/.test(c.detail), c.detail);
  p2 = await paused();
  check('first hit passes: not paused, items rendered, point still set', !p2?.paused && /4 items/.test(await box()) && p2?.points[0]?.id === set.id && !p2.points[0].skip, JSON.stringify(p2) + ' ' + await box());
  check('no pause news for the passed hit', !(await a.wait(2)).some(x => x.type === 'paused'));
  p2 = await paused();
  check('second hit pauses', p2?.paused?.point?.id === set.id, JSON.stringify(p2));
  await choose('drop');
  s = await stored(); c = await card();
  check('reload and remove: reloaded, nothing set, card gone', (await marked()) === false && !s && c.hidden, JSON.stringify(s) + JSON.stringify(c));
  w = await a.wait(3);
  check('the agent is told about it', w.some(x => x.type === 'resumed' && /removed the pause point/.test(x.note)), JSON.stringify(w));
  await lab.click('#load'); await sleep(900);
  check('the page loads its items without pausing', /4 items/.test(await box()) && !(await stored()), await box());
});

await run('kept', async () => {
  const set = J(await a.tool('pause', { on: 'line', text: LINE, once: false }));
  let p = await paused();
  check('paused at a kept point', p?.paused?.point?.kept === true && p.points.length === 1, JSON.stringify(p));
  let c = await card();
  check('menu has "Resume and remove breakpoint"', c.remove && c.more, JSON.stringify(c));
  await openMenu(); await shot('menu-kept', 'all');
  await pn.click('#pause-menu [data-do="remove"]'); await sleep(1200);
  let s = await stored();
  check('resume and remove: runs on, point gone', !s && /4 items/.test(await box()), JSON.stringify(s) + ' ' + await box());
  let w = await a.wait(3);
  check('the agent is told the point was removed', w.some(x => x.type === 'resumed' && /removed the pause point/.test(x.note)), JSON.stringify(w));

  await a.tool('pause', { on: 'line', text: LINE, once: false });
  p = await paused();
  await pn.click('#pause-resume'); await sleep(1000);
  s = await stored();
  check('Resume keeps a kept point', !s?.paused && s?.points.length === 1 && /4 items/.test(await box()), JSON.stringify(s));
  p = await paused();
  await a.tool('pause', { remove: 'all' }); await sleep(400);
  c = await card();
  check('point removed by the agent while paused: "remove" item goes', c.state === 'paused' && !c.remove && c.more, JSON.stringify(c));
  await choose('again'); s = await stored();
  check('reload to breakpoint sets it again as kept', (await marked()) === false && s?.points[0]?.once === false, JSON.stringify(s));
});

await run('plain', async () => {
  await a.tool('pause', { on: 'now' }); await sleep(500);
  const c = await card();
  check('paused without a point: a single Resume button', c.state === 'paused' && c.split && c.single && !c.more, JSON.stringify(c));
  await shot('single');
  check('agent: reload again needs a point', /no pause point/.test(J(await a.tool('resume', { reload: 'again' })).error || ''));
  await pn.click('#pause-resume'); await sleep(900);
  check('Resume lets it run', (await card()).hidden);
});

await run('step', async () => {
  const set = J(await a.tool('pause', { on: 'line', text: 'const run = ++loads' }));
  await paused();
  const st = J(await a.tool('resume', { step: 'over' }));
  const s = await stored();
  check('after a step the pause still knows its point', st.paused?.point?.id === set.id && s?.paused?.point?.id === set.id && (await card()).more, JSON.stringify(st.paused));
  await choose('again');
  const s2 = await stored();
  check('reload to breakpoint works after stepping', (await marked()) === false && s2?.points[0]?.id === set.id, JSON.stringify(s2));
});

await run('kinds', async () => {
  for (const [name, spec, want] of [['request', { on: 'request', url: '/api/items' }, /request to/], ['event', { on: 'event', event: 'click' }, /click listener/], ['dom', { on: 'dom', selector: '#items' }, /#items/]]) {
    await clean();
    const set = J(await a.tool('pause', spec));
    let p = await paused();
    check(`${name}: paused at its point`, p?.paused?.point?.id === set.id && want.test(p.paused.point.label), JSON.stringify(p?.paused || set));
    await choose('again'); await sleep(600);
    let s = await stored();
    check(`${name}: reloaded with the point set again`, (await marked()) === false && !s?.paused && s?.points[0]?.id === set.id, JSON.stringify(s) + ' marked ' + await marked());
    p = await paused();
    check(`${name}: pauses again after the reload`, p?.paused?.point?.id === set.id, JSON.stringify(p));
    await a.tool('resume'); await sleep(500);
  }
});

await run('agent', async () => {
  // A line that runs while the page loads, so a reload pauses by itself.
  const set = J(await a.tool('pause', { on: 'line', text: "$('#load').addEventListener('click', loadItems)" }));
  check('point set at load-time code', set.ok, JSON.stringify(set));
  let r = J(await a.tool('browser_navigate', { url: LAB + '?p7' }).catch(e => e.message));
  let s = await stored();
  check('navigating pauses at it', !!s?.paused && s.paused.point?.id === set.id, JSON.stringify(s) + JSON.stringify(r).slice(0, 300));
  r = J(await a.tool('resume', { reload: 'again' }));
  check('agent reload again: returns the new pause', r.ok && r.reloaded && r.paused?.point?.id === set.id, JSON.stringify(r));
  check('no extra news for its own reload', !(await a.wait(2)).length);
  r = J(await a.tool('resume', { reload: 'skip' }));
  s = await stored();
  check('agent reload skip: passes the hit, page loaded', r.ok && r.reloaded && r.running && !s?.paused && s?.points[0]?.id === set.id, JSON.stringify(r) + JSON.stringify(s));
  r = J(await a.tool('browser_navigate', { url: LAB + '?p7' }).catch(e => e.message));
  s = await stored();
  check('next load pauses again', !!s?.paused, JSON.stringify(s));
  r = J(await a.tool('resume', { reload: 'remove' }));
  await sleep(800); s = await stored();
  check('agent reload remove: reloaded, nothing set', r.ok && r.reloaded && !s, JSON.stringify(r) + JSON.stringify(s));
  check('reload when not paused is a no-op with a note', /nothing was paused/.test(J(await a.tool('resume', { reload: 'again' })).note || ''));

  await a.tool('pause', { on: 'line', text: LINE, once: false });
  lab = await page(u => u.endsWith('?p7')); await lab.send('Page.bringToFront'); await sleep(400);
  await paused(); await a.wait(3);
  r = J(await a.tool('resume', { remove: true }));
  s = await stored();
  check('agent resume remove: runs on, point gone', r.ok && r.resumed && !s, JSON.stringify(r) + JSON.stringify(s));

  // CLI
  await a.tool('pause', { on: 'line', text: LINE });
  await paused(); await a.wait(3);
  const cli = (...args) => J(execFileSync(process.execPath, [path.join(SKILL, 'bridge', 'index.js'), ...args, '--session', a.sid], { env: ENV, encoding: 'utf8' }));
  r = cli('resume', '--reload', 'again');
  s = await stored();
  check('CLI resume --reload again', r.ok && r.reloaded && s?.points.length === 1, JSON.stringify(r) + JSON.stringify(s));
  await paused(); await a.wait(3);
  r = cli('resume', '--remove');
  check('CLI resume --remove', r.ok && r.resumed, JSON.stringify(r));
});

await clean();
await a.close();
summary();
process.exit(0);
