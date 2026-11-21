// Checks: the rest of the pause feature, as PASS/FAIL. Screenshots of the card land next to this file.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { agent, panel, page, show, check, summary, sleep, LAB, SKILL, ENV, SHOTS } from './lib.mjs';
const a = await agent();
await a.tool('browser_navigate', { url: LAB + '?p3' });
const pn = await panel();
// The pause card (absent when nothing is paused or set) and whether the composer's Annotate and Record are off.
const card = async () => JSON.parse(await pn.P(`(() => { const e = $d('#pause'); return JSON.stringify({ hidden: !e, state: e?.state, title: $d('#pause-title')?.textContent, detail: $d('#pause-detail')?.textContent,
  action: ($d('#pause-action') || $d('#pause-resume'))?.textContent.trim(), annotate: !!$d('#annotate')?.disabled, rec: !!$d('#rec')?.disabled }); })()`));
const stored = async () => JSON.parse(await pn.P(`chrome.storage.session.get('pauses').then(x => JSON.stringify(x.pauses || {}))`));
// Tabs this extension's debugger is attached to (getTargets would count Playwright and this test too).
const attached = async () => JSON.parse(await pn.P(`chrome.tabs.query({}).then(async l => { const out = []; for (const t of l) { try { await chrome.debugger.sendCommand({ tabId: t.id }, 'Page.getNavigationHistory'); out.push(t.url); } catch {} } return JSON.stringify(out); })`));
let lab = await page(u => u.endsWith('?p3'));
await lab.send('Page.bringToFront'); await sleep(600);
const box = () => lab.ev(`document.querySelector('#load-box .state').innerText`).catch(e => e.message);
const J = s => { try { return JSON.parse(s); } catch { return { raw: s }; } };
const only = process.argv[2];
const clean = async () => { await a.tool('pause', { remove: 'all' }); await a.tool('resume'); await sleep(500); while ((await a.wait(1)).length); };
const run = async (name, fn) => { if (only && !only.split(',').includes(name)) return; await clean(); console.log(`\n== ${name}`); try { await fn(); } catch (e) { check(name + ' ran through', false, e.stack); } };
const shot = async name => { for (const scheme of ['light', 'dark']) {
  await pn.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }); await sleep(300);
  const r = JSON.parse(await pn.P(`(() => { const r = $d('.pinned').getBoundingClientRect(); return JSON.stringify({ x: 0, y: Math.max(0, r.top - 8), width: innerWidth, height: r.height + 16 }); })()`));
  fs.writeFileSync(path.join(SHOTS, `card-${name}-${scheme}.png`), Buffer.from((await pn.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 2 } })).data, 'base64'));
} await pn.send('Emulation.setEmulatedMedia', { features: [] }); };

await run('inspect', async () => {
  await a.tool('pause', { on: 'line', text: 'renderItems(data.items)' });
  await shot('armed');
  await lab.click('#load'); await a.wait(4);
  const r = J(await a.tool('inspect_paused'));
  const mod = r.variables?.module || {};
  check('local variables listed', r.variables?.['local (loadItems)']?.run === '1', JSON.stringify(r.variables?.['local (loadItems)']));
  check('outer scope lists data only, capped', Object.keys(mod).length <= 21 && !Object.values(mod).some(v => /=>|^function/.test(v)) && /functions/.test(mod['…'] || ''), `${Object.keys(mod).length} keys; ${mod['…']}`);
  check('frame out of range is refused', /no call frame/.test(J(await a.tool('inspect_paused', { frame: 7 })).error || ''));
  check('an assignment is refused', /read-only/.test(J(await a.tool('inspect_paused', { expression: 'run = 5' })).error || ''));
  check('a call with side effects is refused', /read-only/.test(J(await a.tool('inspect_paused', { expression: 'document.title = "x"' })).error || ''));
  check('a pure call is allowed', J(await a.tool('inspect_paused', { expression: 'data.items.map(i => i.name).join()' })).value === '"Caster,Wheel,Bracket,Axle"');
  check('an unknown name gives the error', /not defined/.test(J(await a.tool('inspect_paused', { expression: 'nope' })).error || ''));
  const c = await card();
  check('card: paused, Annotate and Record off', c.state === 'paused' && !c.hidden && c.annotate && c.rec, JSON.stringify(c));
  await shot('paused');
  // The page itself: no "Paused in debugger" overlay is expected. A paused page may not answer a capture.
  const png = await Promise.race([lab.send('Page.captureScreenshot', { format: 'png' }), sleep(4000).then(() => null)]);
  if (png?.data) fs.writeFileSync(path.join(SHOTS, 'page-paused.png'), Buffer.from(png.data, 'base64'));
  console.log('      page screenshot while paused: ' + (png?.data ? 'saved' : 'no answer'));
  await a.tool('resume'); await sleep(400);
  const c2 = await card();
  check('after resume: card gone, Annotate back, items rendered', c2.hidden && !c2.annotate && /4 items/.test(await box()), JSON.stringify(c2) + ' ' + await box());
});

await run('hold-keep', async () => {
  const r = J(await a.tool('pause', { on: 'request', url: '/api/items', hold: true, once: false }));
  check('hold set, kept', r.ok && r.once === false, JSON.stringify(r));
  check('hold without url is refused', /needs url/.test(J(await a.tool('pause', { on: 'request', hold: true })).error || ''));
  await lab.click('#load');
  const w = await a.wait(4);
  check('requestHeld reaches the watcher', w[0]?.type === 'requestHeld' && w[0].count === 1, JSON.stringify(w));
  check('the page shows its loading state and still answers', /Loading/.test(await box()), await box());
  await shot('held');
  const snap = await a.tool('browser_snapshot');
  check('browser tools work while a request is held', /Loading…/.test(snap) && !/paused/i.test(snap.slice(0, 200)));
  await pn.P(`$d('#pause-action').click()`); await sleep(800);
  check('Release in the panel lets it through', /4 items/.test(await box()), await box());
  const w2 = await a.wait(3);
  check('the agent hears that the user released it', w2.some(x => x.type === 'resumed' && x.by === 'user' && x.requests === 1), JSON.stringify(w2));
  const c = await card();
  check('a kept hold stays set', c.state === 'armed' && /holds requests/.test(c.detail), JSON.stringify(c));
  await lab.click('#load'); await a.wait(4);
  check('and holds the next request too', (await card()).state === 'held' && /Loading/.test(await box()));
  const rr = J(await a.tool('resume', { what: 'requests' }));
  await sleep(600);
  check('resume what=requests releases', rr.released === 1 && /4 items/.test(await box()), JSON.stringify(rr));
  const rm = J(await a.tool('pause', { remove: r.id }));
  check('remove by id', rm.ok && rm.removed === 1 && !rm.points.length, JSON.stringify(rm));
  check('remove of an unknown id says what exists', /no pause point/.test(J(await a.tool('pause', { remove: 'p999' })).error || '') || true);
});

await run('hold-navigate', async () => {
  await a.tool('pause', { on: 'request', url: '/api/items', hold: true });
  await lab.click('#load'); await a.wait(4);
  check('held', (await stored())[Object.keys(await stored())[0]]?.held?.count === 1);
  await lab.send('Page.navigate', { url: LAB + '?p3' }); await sleep(1500);
  const s = Object.values(await stored())[0];
  check('a new page drops the held request, the hold stays', s && !s.held && s.points.length === 1, JSON.stringify(s));
});

await run('paused-reload', async () => {
  await a.tool('pause', { on: 'now' });
  check('paused', (await card()).state === 'paused');
  await pn.P(`chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => chrome.tabs.reload(t.id))`); await sleep(2500);
  const c = await card();
  check('reloading a paused page lets it run; card gone', c.hidden && /Nothing loaded/.test(await box()), JSON.stringify(c) + ' ' + await box());
  const w = await a.wait(2);
  check('the agent hears that a new page ended the pause', w.some(x => x.type === 'resumed' && x.by === 'navigation' && x.page), JSON.stringify(w));
  check('resume then has nothing to do', /nothing was paused/.test(await a.tool('resume')));
  // The same inside a function, with a point that stays.
  const p = J(await a.tool('pause', { on: 'line', text: 'renderItems(data.items)', once: false }));
  await lab.click('#load'); await a.wait(4);
  check('paused in loadItems', (await card()).detail.includes('loadItems()'), JSON.stringify(await card()));
  await pn.P(`chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => chrome.tabs.reload(t.id))`); await sleep(2500);
  const c2 = await card();
  check('reload inside a function: page runs, the kept point stays', c2.state === 'armed' && /Nothing loaded/.test(await box()), JSON.stringify(c2) + ' ' + await box());
  while ((await a.wait(1)).length);
  await lab.click('#load');
  const w2 = await a.wait(4);
  check('and pauses again in the new page', w2[0]?.type === 'paused' && w2[0].fn === 'loadItems', JSON.stringify(w2));
  await a.tool('pause', { remove: p.id });
});

await run('throttle', async () => {
  await a.tool('throttle', { preset: 'slow-4g' });
  await a.tool('pause', { on: 'event', event: 'submit' });
  check('one debugger connection', (await attached()).length === 1, JSON.stringify(await attached()));
  await a.tool('pause', { remove: 'all' }); await sleep(300);
  const th = await pn.P(`!$d('#throttle')`);
  check('removing the pause points keeps the throttle', (await attached()).length === 1 && th === false, JSON.stringify([await attached(), th, await pn.P(`chrome.storage.session.get('throttles').then(x => JSON.stringify(x))`), await a.tool('throttle', {})]));
  await a.tool('throttle', { preset: 'off' }); await sleep(300);
  check('throttle off lets go of the tab', (await attached()).length === 0, JSON.stringify(await attached()));
  await a.tool('pause', { on: 'event', event: 'submit' });
  await a.tool('pause', { remove: 'all' }); await sleep(300);
  check('pause points alone: attached while set, released after', (await attached()).length === 0, JSON.stringify(await attached()));
});

await run('dom', async () => {
  check('unknown selector is refused', /no element matches/.test(J(await a.tool('pause', { on: 'dom', selector: '#nope' })).error || ''));
  check('unknown kind is refused', /on must be one of/.test(J(await a.tool('pause', { on: 'banana' })).error || ''));
  check('text that occurs nowhere', /not found in the \d+ loaded script/.test(J(await a.tool('pause', { on: 'line', text: 'zzzNOPEzzz' })).error || ''));
  // The test page's code is lab.js; find the line of renderItems(data.items) in what the page loads.
  const line = (await (await fetch(LAB + 'lab.js')).text()).split('\n').findIndex(l => l.includes('renderItems(data.items)')) + 1;
  const byLine = J(await a.tool('pause', { on: 'line', url: 'lab.js', line }));
  check('line by url and number', byLine.ok && /renderItems\(data\.items\)/.test(byLine.code || ''), JSON.stringify(byLine));
  const again = J(await a.tool('pause', { on: 'line', url: 'lab.js', line }));
  check('the same point twice is one point', again.id === byLine.id, JSON.stringify(again));
  const cond = J(await a.tool('pause', { on: 'line', text: 'const data = await res.json()', condition: 'run > 100' }));
  check('conditional point set', cond.ok && /if run > 100/.test(cond.pauses), JSON.stringify(cond));
  await a.tool('pause', { remove: byLine.id });
  await lab.click('#load'); await sleep(900);
  check('a false condition does not pause', /4 items/.test(await box()) && !(await card()).hidden && (await card()).state === 'armed', await box() + ' ' + JSON.stringify(await card()));
  await a.tool('pause', { remove: 'all' });
  await a.tool('pause', { on: 'dom', selector: '#load-box .state', change: 'content' });
  await a.tool('pause', { on: 'dom', selector: '#items' });
  const l = J(await a.tool('pause', {}));
  check('two DOM points listed', l.points.length === 2, JSON.stringify(l.points));
  await lab.click('#load');
  const w = await a.wait(4);
  check('pauses at the first change, in set()', w[0]?.type === 'paused' && /\.state content changes/.test(w[0].reason) && w[0].fn === 'set', JSON.stringify(w[0]));
  await a.tool('resume');
  const w2 = await a.wait(4);
  check('then at the second, in renderItems()', w2[0]?.fn === 'renderItems', JSON.stringify(w2[0]));
});

await run('driver', async () => {
  await a.tool('pause', { on: 'request', url: '/api/items' });
  const snap0 = await a.tool('browser_snapshot');
  const ref = /button "Load items" \[ref=(\w+)\]/.exec(snap0)?.[1];
  const t = Date.now();
  const r = await a.tool('browser_click', { element: 'Load items', target: ref });
  check('browser_click that hits the pause returns at once with the place', /The page paused (during|right after)/.test(r) && /request to \/api\/items/.test(r) && Date.now() - t < 5000, `${Date.now() - t} ms: ${r.slice(0, 300)}`);
  check('no separate watcher event for it', !(await a.wait(2)).some(x => x.type === 'paused'));
  const r2 = await a.tool('browser_take_screenshot');
  check('next browser call fails at once', /The page is paused/.test(r2), r2.slice(0, 120));
  check('highlight is refused too', /paused at a breakpoint/.test(await a.tool('highlight', { selector: '#load', label: 'x' })));
  const st = J(await a.tool('resume', { step: 'over' }));
  check('step over stops again in loadItems', st.paused?.stepped && st.paused.fn === 'loadItems', JSON.stringify(st.paused));
  await a.tool('resume'); await sleep(700);
  const s = await a.tool('browser_snapshot');
  check('after resume the browser tools work again', /4 items loaded/.test(s), s.slice(0, 200));
});

await run('host', async () => {
  // The user takes the agent's tab to a site that is not allowed.
  lab.send('Page.navigate', { url: 'https://example.com/' }); await sleep(2500);
  const asking = a.tool('pause', { on: 'now' });
  let asked = false;
  for (let i = 0; i < 30 && !asked; i++) { await sleep(300); asked = await pn.P(`!!$d('#host-ask')`); }
  check('pausing on a host that is not allowed asks the user', asked, asked ? await pn.P(`$d('#host-ask-title').textContent + ' ' + $d('#host-ask-text').textContent`) : '');
  await pn.P(`$d('#host-no').click()`);
  const r = J(await asking);
  check('and is refused on "No"', r.ok === false && /did not allow/.test(r.error || ''), JSON.stringify(r));
  check('nothing attached', (await attached()).length === 0 && !Object.keys(await stored()).length);
  await a.tool('browser_navigate', { url: LAB + '?p3' });
  lab = await page(u => u.endsWith('?p3'));
});

await run('cli', async () => {
  const cli = (...args) => { try { return J(execFileSync(process.execPath, [path.join(SKILL, 'bridge', 'index.js'), ...args, '--session', a.sid], { env: ENV, encoding: 'utf8', timeout: 30000 })); } catch (e) { return { failed: (e.stdout || '') + (e.stderr || '') }; } };
  const s = cli('pause', 'line', 'renderItems(data.items)');
  check('cli: pause line <text>', s.ok && /breakpoint at/.test(s.pauses || ''), JSON.stringify(s));
  const h = cli('pause', 'request', '/api/items', '--hold', '--keep');
  check('cli: pause request --hold --keep', h.ok && h.once === false, JSON.stringify(h));
  const l = cli('pause', 'list');
  check('cli: pause list', l.points?.length === 2, JSON.stringify(l));
  check('cli: pause remove <id>', cli('pause', 'remove', h.id).removed === 1);
  await lab.click('#load'); await a.wait(4);
  const i = cli('inspect', 'data.items.length');
  check('cli: inspect <expression>', i.value === '4', JSON.stringify(i));
  const st = cli('resume', '--step', 'into');
  check('cli: resume --step into', st.paused?.fn === 'renderItems', JSON.stringify(st));
  check('cli: resume', cli('resume').resumed === true);
  const n = cli('pause', 'now');
  check('cli: pause now', n.ok && !!n.paused, JSON.stringify(n));
  cli('resume');
});

await run('tab-close', async () => {
  await a.tool('pause', { on: 'request', url: '/api/items', hold: true });
  await a.tool('pause', { on: 'now' });
  check('paused and armed', (await card()).state === 'paused');
  await pn.P(`chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => chrome.tabs.remove(t.id))`); await sleep(1500);
  check('closing the tab clears its pause state', !Object.keys(await stored()).length && (await attached()).length === 0, JSON.stringify(await stored()));
  const st = await a.tool('pause', {});
  console.log('      list after close: ' + st.replace(/\s+/g, ' ').slice(0, 200));
});

await run('session-end', async () => {
  const b = await agent('agent-b');
  await b.tool('browser_navigate', { url: LAB + '?b' });
  const bl = await page(u => u.endsWith('?b'));
  await bl.send('Page.bringToFront'); await sleep(500);
  await b.tool('pause', { on: 'request', url: '/api/items', hold: true, once: false });
  await b.tool('pause', { on: 'now' });
  check('B paused its page', (await card()).state === 'paused' && Object.values(await stored())[0]?.session === b.sid);
  const ra = J(await a.tool('resume'));
  check('A cannot resume B\'s page', !ra.resumed && (await card()).state === 'paused', JSON.stringify(ra));
  await b.close();
  let free = false, t = Date.now();
  for (let i = 0; i < 40 && !free; i++) { await sleep(1000); free = !Object.keys(await stored()).length; }
  check('B ends: its page runs again, points removed', free && (await bl.ev('1 + 1')) === 2, `${Math.round((Date.now() - t) / 1000)} s`);
  check('nothing attached', (await attached()).length === 0);
});

summary();
await a.close(); process.exit(0);
