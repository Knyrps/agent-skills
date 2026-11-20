// What the test extension's service worker logged, and (with an argument) an expression evaluated in it.
import { cdp, targets, sleep } from './lib.mjs';
const t = (await targets()).find(t => t.type === 'service_worker' && t.url.includes('service-worker.js'));
if (!t) { console.log('no service worker target'); process.exit(1); }
const s = await cdp(t.webSocketDebuggerUrl);
await s.send('Runtime.enable'); await sleep(500);
for (const e of s.events) {
  if (e.method === 'Runtime.consoleAPICalled') console.log(e.params.type, e.params.args.map(a => a.value ?? a.description ?? JSON.stringify(a.preview?.properties?.map(p => `${p.name}: ${p.value}`))).join(' '));
  if (e.method === 'Runtime.exceptionThrown') console.log('EXC', e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
}
if (process.argv[2]) console.log(JSON.stringify(await s.ev(process.argv[2]), null, 1));
process.exit(0);
