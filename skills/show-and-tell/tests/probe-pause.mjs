// Probe: line and DOM pause points on real production sites (not a committed test).
import { agent, panel, sleep } from './lib.mjs';
const a = await agent(); await a.tool('start_browser'); const pn = await panel();
const J = s => { try { return JSON.parse(s); } catch { return { raw: String(s).slice(0, 300) }; } };
const sites = (process.argv[2] || 'https://github.com/,https://developer.mozilla.org/en-US/,https://www.wikipedia.org/').split(',');
const texts = (process.argv[3] || 'addEventListener(,querySelector(,JSON.parse(,fetch(').split(',');
for (const url of sites) {
  await pn.P(`chrome.runtime.sendMessage({ type: 'hostAllow', url: ${JSON.stringify(url)}, mode: 'session' })`); await sleep(800);
  console.log('\n#', url, String(await a.tool('browser_navigate', { url })).match(/Page Title: .*/)?.[0]);
  await sleep(2500);
  for (const text of texts) {
    const r = J(await a.tool('pause', { on: 'line', text }));
    console.log(`  line ${JSON.stringify(text)}:`, r.ok ? `ok ${r.at} ${String(r.code).slice(0, 80)}` : String(r.error).slice(0, 300), r.matches ? `| ${r.matches.length} matches, e.g. ${JSON.stringify(r.matches.slice(0, 2)).slice(0, 300)}` : '');
    await a.tool('pause', { remove: 'all' });
  }
  const d = J(await a.tool('pause', { on: 'dom', selector: 'body' }));
  console.log('  dom body:', d.ok ? `ok ${d.pauses}` : d.error);
  await a.tool('pause', { remove: 'all' });
}
await a.close(); process.exit(0);
