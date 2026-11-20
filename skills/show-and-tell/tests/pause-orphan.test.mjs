// Check: the only agent goes away with its bridge while its page is paused; after a minute the page runs again.
import { agent, panel, page, check, summary, sleep, LAB } from './lib.mjs';
const a = await agent();
await a.tool('browser_navigate', { url: LAB + '?p5' });
const pn = await panel();
const lab = await page(u => u.endsWith('?p5'));
await lab.send('Page.bringToFront'); await sleep(600);
const stored = async () => JSON.parse(await pn.P(`chrome.storage.session.get('pauses').then(x => JSON.stringify(x.pauses || {}))`));
await a.tool('pause', { on: 'request', url: '/api/items', hold: true, once: false });
await a.tool('pause', { on: 'now' });
const s = Object.values(await stored())[0];
check('paused with a hold set', !!s?.paused && s.points.length === 1, JSON.stringify(s));
await a.close();
const t = Date.now();
await sleep(20000);
check('still paused after 20 s offline', !!Object.values(await stored())[0]?.paused);
let free = false;
for (let i = 0; i < 70 && !free; i++) { await sleep(1000); free = !Object.keys(await stored()).length; }
check('released after about a minute offline', free && (await lab.ev('1 + 1')) === 2, `${Math.round((Date.now() - t) / 1000)} s`);
const card = await pn.P(`document.getElementById('pause').hidden`);
check('card gone', card === true);
summary();
process.exit(0);
