// Restored test-page tabs show the waiting page when the browser starts without a bridge.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { agent, targets, check, summary, sleep, SKILL, ENV, LAB } from './lib.mjs';
const b = cmd => spawnSync(process.execPath, [path.join(SKILL, 'scripts', 'browser.mjs'), cmd], { env: ENV, encoding: 'utf8' }).stdout;
// A session leaves test-page tabs behind, and the bridge learns where the test page is.
const a = await agent();
await a.tool('browser_navigate', { url: LAB + '?restored' });
await sleep(1000); await a.close(); await sleep(1500);
b('stop'); await sleep(1500); b('start');
let pages = [];
for (let i = 0; i < 40; i++) { await sleep(500); pages = (await targets().catch(() => [])).filter(t => t.type === 'page' && !t.url.endsWith('/panel.html')); if (pages.length && pages.every(t => t.url.includes('lab-offline.html'))) break; }
check('restored test-page tabs show the waiting page, not Chrome\'s error page', pages.length > 0 && pages.some(t => t.url.includes('lab-offline.html')), pages.map(t => t.url).join(' | '));
// Once a bridge runs, they turn back into the test page.
const a2 = await agent('agent-b');
// Only the test-page tabs: other sites a test left open in the kept profile are not the point.
const ours = t => t.url.startsWith(LAB) || t.url.includes('lab-offline.html');
for (let i = 0; i < 30; i++) { await sleep(500); pages = (await targets().catch(() => [])).filter(t => t.type === 'page' && ours(t)); if (pages.length && pages.every(t => t.url.startsWith(LAB) && t.title === 'Gesture lab')) break; }
check('with a bridge every one of them shows the test page', pages.every(t => t.url.startsWith(LAB) && t.title === 'Gesture lab'), pages.filter(t => !(t.url.startsWith(LAB) && t.title === 'Gesture lab')).map(t => t.url + ' [' + t.title + ']').join(' | ') || pages.length + ' tabs');
summary();
await a2.close(); process.exit(0);
