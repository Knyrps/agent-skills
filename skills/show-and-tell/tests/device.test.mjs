// Checks: emulate_device shows the session's tab as a phone or at a given width, without touching the window,
// keeps it across navigations, and ends with "off", the panel's button or the session.
import { agent, panel, page, check, summary, sleep, LAB } from './lib.mjs';
const a = await agent();
await a.tool('browser_navigate', { url: LAB + '?device' });
const pn = await panel();
const lab = await page(u => u.endsWith('?device'));
await lab.send('Page.bringToFront'); await sleep(600);
const J = s => { try { return JSON.parse(s); } catch { return { raw: s }; } };
const only = process.argv[2];
const run = async (name, fn) => { if (only && !only.split(',').includes(name)) return; console.log(`\n== ${name}`); try { await fn(); } catch (e) { check(name + ' ran through', false, e.stack); } };
// What the page itself measures.
const seen = s => s.ev(`JSON.stringify({ width: innerWidth, ratio: devicePixelRatio, narrow: matchMedia('(max-width: 400px)').matches, touch: navigator.maxTouchPoints, mobileUa: / Mobile /.test(navigator.userAgent) })`).then(J);
const win = () => pn.P(`chrome.windows.getLastFocused().then(w => JSON.stringify([w.width, w.height, w.state]))`);
const card = () => pn.P(`(() => { const e = $d('#device'); return JSON.stringify(e ? { label: $d('#device-label')?.textContent } : null); })()`).then(J);
const state = () => pn.P(`chrome.storage.session.get('throttles').then(x => JSON.stringify(x.throttles || {}))`).then(J);
const attached = async () => JSON.parse(await pn.P(`chrome.tabs.query({}).then(async l => { const out = []; for (const t of l) { try { await chrome.debugger.sendCommand({ tabId: t.id }, 'Page.getNavigationHistory'); out.push(t.url); } catch {} } return JSON.stringify(out); })`));
const before = await seen(lab), window0 = await win();

await run('phone', async () => {
  const r = J(await a.tool('emulate_device', { preset: 'phone' }));
  check('the phone preset is set and says what the page measures', r.ok && r.viewport?.width === 390 && r.viewport.pixelRatio === 3 && /Phone/.test(r.device), JSON.stringify(r).slice(0, 300));
  const s = await seen(lab);
  check('the page is 390 wide, matches narrow media queries and has 3 device pixels per pixel', s.width === 390 && s.narrow && s.ratio === 3, JSON.stringify(s));
  check('it sees a touch screen and a mobile user agent', s.touch > 0 && s.mobileUa, JSON.stringify(s));
  check('the window keeps its size', (await win()) === window0, `${window0} -> ${await win()}`);
  const c = await card();
  check('the panel shows the device view', !!c && /Phone · 390/.test(c.label), JSON.stringify(c));
  check('a phone that fits the tab is not reported as cut off', !r.cutOff, r.cutOff);
  // The agent's own input lands where it aims: a click through Playwright on the button it sees.
  const nav = await a.tool('browser_navigate', { url: LAB + '?device' }); await sleep(500);
  const ref = (/\[ref=(\w+)\]/.exec(((await a.tool('browser_snapshot')) + nav).match(/.*button "Click".*/)?.[0] || '') || [])[1];
  const clicked = await a.tool('browser_click', { element: 'Click button', target: ref, ref }); await sleep(400);
  check('the agent\'s click lands on the button in the device view', /1 click/.test(await lab.ev(`$d('#btn-box .state')?.innerText || ''`)), clicked.replace(/\s+/g, ' ').slice(0, 200));
  await a.tool('browser_navigate', { url: LAB + '?device' }); await sleep(800);
  check('it stays on after the tab loads a page', (await seen(lab)).width === 390, JSON.stringify(await seen(lab)));
});

await run('width', async () => {
  const r = J(await a.tool('emulate_device', { width: 600 }));
  const s = await seen(lab);
  check('a width alone gives a plain tab of that width: no touch, the screen\'s own pixels, the desktop user agent',
    r.ok && s.width === 600 && !s.narrow && s.touch === 0 && !s.mobileUa && s.ratio === before.ratio, JSON.stringify([r.device, s]));
  const t = J(await a.tool('emulate_device', { preset: 'tablet', width: 700 }));
  check('own values override a preset\'s', t.ok && (await seen(lab)).width === 700 && (await seen(lab)).touch > 0, JSON.stringify(t).slice(0, 200));
  const wide = J(await a.tool('emulate_device', { width: 1600 }));
  check('a width larger than the tab says the user sees only part of it', wide.ok && /top left part/.test(wide.cutOff || '') && (await seen(lab)).width === 1600 && /partly out of view/.test((await card())?.label || ''), JSON.stringify(wide).slice(0, 300));
  check('several sizes in a row use one tab and one debugger connection', (await attached()).length === 1, JSON.stringify(await attached()));
});

await run('refused', async () => {
  check('an unknown preset is refused with the list', /phone, small-phone, tablet/.test(J(await a.tool('emulate_device', { preset: 'watch' })).error || ''));
  check('a width out of range is refused', /200 to 4000/.test(J(await a.tool('emulate_device', { width: 50 })).error || ''));
  check('neither preset nor width is refused', /preset/.test(J(await a.tool('emulate_device', {})).error || ''));
});

await run('off', async () => {
  const r = J(await a.tool('emulate_device', { preset: 'off' })); await sleep(400);
  const s = await seen(lab);
  check('off gives the tab its own size, pixels, input and user agent back', r.ok && s.width === before.width && s.ratio === before.ratio && s.touch === before.touch && !s.mobileUa, JSON.stringify([before, s]));
  check('the panel card is gone and the tab is let go', !(await card()) && (await attached()).length === 0, JSON.stringify([await card(), await attached()]));
  await a.tool('emulate_device', { preset: 'small-phone' }); await sleep(400);
  await pn.P(`$d('#device-off').click()`); await sleep(800);
  check('Turn off in the panel ends it too', (await seen(lab)).width === before.width && !(await card()), JSON.stringify(await seen(lab)));
});

await run('with-throttle', async () => {
  await a.tool('emulate_device', { preset: 'phone' });
  await a.tool('throttle', { preset: 'slow-4g' });
  await a.tool('throttle', { preset: 'off' }); await sleep(400);
  check('turning throttling off keeps the device view', (await seen(lab)).width === 390 && !!(await card()), JSON.stringify(await state()));
  await a.tool('emulate_device', { preset: 'off' }); await sleep(300);
});

await run('session-end', async () => {
  const b = await agent('agent-device');
  await b.tool('browser_navigate', { url: LAB + '?device-b' });
  const r = J(await b.tool('emulate_device', { preset: 'phone' }));
  const other = await page(u => u.endsWith('?device-b'));
  check('another session emulates in its own tab only', (await seen(other)).width === 390 && (await seen(lab)).width === before.width, JSON.stringify([await seen(other), await seen(lab)]));
  await b.close();
  let w = 390;
  for (let i = 0; i < 80 && w === 390; i++) { await sleep(500); w = (await seen(other).catch(() => ({}))).width; }
  check('when that session ends, its tab gets its own size back', w !== 390 && !Object.values(await state()).some(t => t.device), JSON.stringify([w, r.tabId, await state()]));
});

summary();
await a.close(); process.exit(0);
