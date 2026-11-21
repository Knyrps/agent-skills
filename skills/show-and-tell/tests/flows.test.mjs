// End-to-end checks of agent flows through the panel, with real input and without scrolling for the tester:
// what a user has to click must be on screen by itself.
import { agent, panel, page, check, summary, sleep, LAB } from './lib.mjs';
const a = await agent();
await a.tool('browser_navigate', { url: LAB + '?flows' });
const pn = await panel();
const lab = await page(u => u.endsWith('?flows'));
await lab.send('Page.bringToFront'); await sleep(800);
const J = s => { try { return JSON.parse(s); } catch { return { raw: s }; } };
const only = process.argv[2];
const run = async (name, fn) => { if (only && !only.split(',').includes(name)) return; console.log(`\n== ${name}`); try { await fn(); } catch (e) { check(name + ' ran through', false, e.stack); } };
// Clicks where an element is right now, without scrolling it into view; reports whether it was really there.
const clickInPlace = async (s, sel) => {
  const r = J(await s.ev(`(() => { const e = $d(${JSON.stringify(sel)}); if (!e) return 'null'; const b = e.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2; let hit = document.elementFromPoint(x, y); while (hit?.shadowRoot) { const h = hit.shadowRoot.elementFromPoint(x, y); if (!h || h === hit) break; hit = h; }
    const inside = n => { for (; n; n = n.parentNode || n.host) if (n === e) return true; return false; };
    return JSON.stringify({ x, y, onScreen: y > 0 && y < innerHeight, hits: inside(hit) }); })()`));
  if (r?.x != null) for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await s.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  return r;
};

await run('host-question', async () => {
  // A long conversation first, so the question appears below the fold.
  for (const s of ['#tap', '#dtap', '#lp', '#pinch', '#strip', '#drag', '#btn', '#dbl', '#ctx', '#hover']) await a.tool('highlight', { selector: s, keep: true, scroll: false });
  // The user has scrolled up to read: the question must still come into view.
  await sleep(500); await pn.P(`$d('#chat').scrollTop = 0`); await sleep(300);
  const host = `ask-${Date.now().toString(36)}.127.0.0.1.nip.io`;
  const call = a.tool('highlight', { selector: 'body', url: `http://${host}:47714/` });
  let shown = false;
  for (let i = 0; i < 40 && !shown; i++) { await sleep(250); shown = await pn.P(`!!$d('#host-session')`); }
  check('the host question appears', shown);
  await sleep(800);
  const r = await clickInPlace(pn, '#host-session');
  check('"This session" is on screen and clickable without scrolling', r?.onScreen && r?.hits, JSON.stringify(r));
  const res = J(await Promise.race([call, sleep(20000).then(() => '{"timeout":true}')]));
  check('the agent call goes on with the answer', res.ok === true, JSON.stringify(res).slice(0, 200));
  await a.tool('browser_navigate', { url: LAB + '?flows' });
});

// The overlay's root is closed: read a node's inline style through the pierce tree.
const overlayStyles = async (s, cls) => {
  const { root } = await s.send('DOM.getDocument', { depth: -1, pierce: true });
  const out = [], walk = n => { const a = n.attributes || [], at = {}; for (let i = 0; i < a.length; i += 2) at[a[i]] = a[i + 1];
    if (at.class === cls && /--c:/.test(at.style || '')) out.push(at.style);
    for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c); };
  walk(root); return out;
};

await run('offscreen-label', async () => {
  await lab.send('Page.bringToFront');
  await a.tool('highlight', { selector: '#tap', label: 'Tap here', scroll: false });
  await lab.ev(`scrollTo(0, 0)`); await sleep(1200);
  const before = await overlayStyles(lab, 'label');
  check('a label shows next to its element in view', before.length === 1 && !/display: none/.test(before[0]), JSON.stringify(before));
  await lab.ev(`scrollTo(0, document.body.scrollHeight)`); await sleep(600);
  const after = await overlayStyles(lab, 'label');
  check('scrolled out of view, the label hides instead of sticking to the edge', after.length === 1 && /display: none/.test(after[0]), JSON.stringify(after));
  await lab.ev(`scrollTo(0, 0)`); await sleep(600);
  check('back in view, the label shows again', !/display: none/.test((await overlayStyles(lab, 'label'))[0] || 'display: none'));
  await a.tool('clear_highlights');
});

summary();
await a.close(); process.exit(0);
