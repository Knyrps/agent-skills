// A stand-in for Playwright MCP: two tabs (the side panel first), browser_click reports the current tab,
// and after "crash" the next call fails like a closed browser until the client reconnects.
import fs from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const flag = process.env.FAKE_CRASH_FLAG;
const tabs = [{ title: 'show-and-tell', url: 'chrome-extension://abc/panel.html' }, { title: 'App', url: 'http://localhost/app' }];
let current = 0;
const ok = t => ({ content: [{ type: 'text', text: t }] });
const tool = name => ({ name, description: name, inputSchema: { type: 'object', properties: {} } });

const server = new Server({ name: 'fake', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ['browser_click', 'browser_close', 'browser_navigate', 'browser_resize', 'browser_run_code_unsafe', 'browser_tabs'].map(tool) }));
server.setRequestHandler(CallToolRequestSchema, async req => {
  const a = req.params.arguments || {};
  if (flag && fs.existsSync(flag)) { fs.rmSync(flag); return { isError: true, content: [{ type: 'text', text: 'Target page, context or browser has been closed' }] }; }
  if (req.params.name === 'browser_tabs' && a.action === 'list')
    return ok('### Result\n' + tabs.map((t, i) => `- ${i}: ${i === current ? '(current) ' : ''}[${t.title}](${t.url})`).join('\n'));
  if (req.params.name === 'browser_tabs' && a.action === 'select') { current = a.index; return ok('selected'); }
  if (req.params.name === 'browser_click') return ok(`clicked on ${tabs[current].url} pid ${process.pid}`);
  return ok('ran ' + req.params.name);
});
await server.connect(new StdioServerTransport());
