// show-and-tell adapter for OpenCode (V2 plugin API). It implements the bridge's adapter contract
// (references/adapters.md) for OpenCode sessions:
//
// - Each OpenCode session gets its own show-and-tell session (`_session` on its show-and-tell tool calls):
//   its own tab, panel conversation and listener, even when one MCP process serves several chats.
// - What the user sends from the panel arrives in the session as a user message; no watcher job needed.
// - The agent's reply to that message is mirrored into the panel conversation.
// - Permission prompts of the session can be answered in the panel as well as in OpenCode.
// - What the user did in the session's tab is attached to the next tool result, whichever tool it is.
//
// Options (opencode.json "plugins": [{ "package": "<path>", "options": { … } }]):
//   server    MCP server name of show-and-tell (default "show-and-tell")
//   port      bridge port (default DEMO_BRIDGE_PORT or 47613)
//   delivery  "queue" (default: after the current turn) or "steer" (into the running turn)
//   permissions  false to keep permission prompts in OpenCode only
import { pathToFileURL } from 'node:url';

const norm = s => String(s).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DECISIONS = [{ id: 'once', label: 'Allow once' }, { id: 'always', label: 'Always allow' }, { id: 'reject', label: 'Deny' }];

export default {
  id: 'show-and-tell',
  async setup(ctx) {
    const opts = ctx.options || {};
    const prefix = norm(opts.server || 'show-and-tell') + '_';
    const base = `http://127.0.0.1:${+(opts.port || process.env.DEMO_BRIDGE_PORT || 47613)}`;
    const delivery = opts.delivery === 'steer' ? 'steer' : 'queue';
    const ours = tool => norm(tool).startsWith(prefix);
    const isSay = tool => norm(tool) === prefix + 'say';
    const stop = new AbortController();

    const bridge = async (method, path, body, signal) => {
      const r = await fetch(base + path, { method, signal, headers: { 'X-Show-And-Tell': '1', ...(body && { 'Content-Type': 'application/json' }) },
        ...(body && { body: JSON.stringify(body) }) });
      if (!r.ok) throw new Error(`${method} ${path}: ${r.status}`);
      return r.json();
    };

    // OpenCode session -> { id (bridge session), label, turn: { inbox, delivered, text, said } | null }
    const bound = new Map();
    const bridgeId = sessionID => ('oc-' + sessionID).replace(/[^\w.-]/g, '-').slice(0, 64);
    async function bind(sessionID) {
      let b = bound.get(sessionID);
      if (b) return b;
      let title = '';
      try { title = (await ctx.session.get({ sessionID }))?.title || ''; } catch {}
      const label = (title || ctx.location?.project?.directory?.split(/[\\/]/).pop() || 'opencode').replace(/[^\w .-]+/g, '-').trim().slice(0, 40);
      b = { id: bridgeId(sessionID), label, turns: [] };
      bound.set(sessionID, b);
      listen(sessionID, b);
      return b;
    }

    // The session's listener: the same long poll a watcher job would run.
    async function listen(sessionID, b) {
      while (!stop.signal.aborted && bound.get(sessionID) === b) {
        try {
          const q = new URLSearchParams({ timeout: 600, session: b.id, label: b.label });
          const r = await bridge('GET', `/wait?${q}`, null, stop.signal);
          if (r?.actions?.length) await deliver(sessionID, b, r.actions);
        } catch {
          if (stop.signal.aborted) return;
          await sleep(5000); // bridge not running yet
        }
      }
    }

    async function deliver(sessionID, b, actions) {
      const answers = actions.filter(a => a.type === 'answer');
      for (const a of answers) {
        try { await ctx.permission.reply({ sessionID, requestID: a.ask, decision: a.choice }); } catch {}
      }
      const rest = actions.filter(a => a.type !== 'answer');
      if (!rest.length) return;
      const files = rest.flatMap(a => [a.labelledImagePath].filter(Boolean)).map(p => ({ uri: pathToFileURL(p).href, name: p.split(/[\\/]/).pop() }));
      const fromPanel = rest.some(a => ['question', 'annotation', 'recording'].includes(a.type));
      const text = [
        `<show-and-tell from="panel">`,
        fromPanel
          ? 'The user sent this from the show-and-tell side panel in the shared browser. They are looking at the panel: your reply in this chat is shown there automatically, so answer normally and do not call say.'
          : 'Events from the show-and-tell side panel in the shared browser.',
        '```json',
        JSON.stringify(rest, null, 2),
        '```',
        '</show-and-tell>',
      ].join('\n');
      try {
        const inbox = await ctx.session.prompt({ sessionID, text, ...(files.length && { files }), metadata: { showAndTell: true }, delivery });
        if (fromPanel) b.turns.push({ inbox: inbox?.id, delivered: false, text: '', said: false });
      } catch (e) {
        await bridge('POST', '/say', { session: b.id, label: b.label, text: `Could not hand this to the agent: ${e.message || e}` }).catch(() => {});
      }
    }

    async function mirror(sessionID, b) {
      const turn = b.turns[0];
      if (!turn?.delivered) return;
      b.turns.shift();
      if (turn.said) return;
      await bridge('POST', '/say', { session: b.id, label: b.label, text: turn.text.trim() || 'Done.' }).catch(() => {});
    }

    // Tool calls: name the session on show-and-tell calls; tell the agent about the user's input after any tool.
    await ctx.tool.hook('execute.before', async event => {
      if (!ours(event.tool)) return;
      const b = await bind(event.sessionID);
      if (event.input && typeof event.input === 'object') event.input = { ...event.input, _session: b.id, _label: b.label };
    });
    await ctx.tool.hook('execute.after', async event => {
      const b = bound.get(event.sessionID);
      if (!b) return;
      if (isSay(event.tool) && b.turns[0]?.delivered) b.turns[0].said = true;
      if (ours(event.tool) || event.status !== 'completed') return; // show-and-tell results carry it themselves
      const r = await bridge('GET', `/user-events?session=${encodeURIComponent(b.id)}`).catch(() => null);
      if (!r?.events?.length) return;
      const note = 'The user worked in your show-and-tell browser tab meanwhile:\n' + r.events.map(e => '- ' + e.text).join('\n')
        + '\nThe page may have changed: re-read it (browser_snapshot) before relying on earlier refs or state.';
      const c = event.result?.content;
      event.result = { ...event.result, content: typeof c === 'string' || c == null ? [c, note].filter(Boolean).join('\n\n') : [...c, { type: 'text', text: note }] };
    });

    // Events: reply mirroring and permission prompts.
    (async () => {
      const types = ['session.inbox.delivered', 'session.text.ended', 'session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted',
        'permission.asked', 'permission.replied', 'session.deleted'];
      for await (const ev of ctx.event.subscribe({ types, signal: stop.signal })) {
        const d = ev.data || {};
        const b = bound.get(d.sessionID);
        if (!b) continue;
        try {
          switch (ev.type) {
            // The run ends with execution.succeeded; a queued message can also start a new turn inside the
            // same run, so the next delivered message closes the turn before it.
            case 'session.inbox.delivered': {
              const t = b.turns.find(x => x.inbox === d.inboxID);
              if (b.turns[0]?.delivered && b.turns[0] !== t) await mirror(d.sessionID, b);
              if (t) t.delivered = true;
              break;
            }
            case 'session.text.ended': if (b.turns[0]?.delivered) b.turns[0].text = d.text || ''; break;
            case 'session.execution.succeeded': await mirror(d.sessionID, b); break;
            case 'session.execution.failed': case 'session.execution.interrupted':
              if (b.turns[0]?.delivered) { b.turns.shift(); await bridge('POST', '/say', { session: b.id, label: b.label, text: ev.type.endsWith('failed') ? 'The agent stopped with an error; see the agent chat.' : 'The agent was interrupted.' }).catch(() => {}); }
              break;
            case 'permission.asked':
              if (opts.permissions === false) break;
              await bridge('POST', '/ask', { session: b.id, label: b.label, id: d.id, kind: 'permission',
                title: `${d.action}${d.resources?.length ? ': ' + d.resources.join(', ') : ''}`.slice(0, 200),
                detail: d.message || '', options: DECISIONS });
              break;
            case 'permission.replied': await bridge('POST', '/ask/done', { id: d.requestID, note: `Answered in the agent chat: ${d.reply}` }).catch(() => {}); break;
            case 'session.deleted': bound.delete(d.sessionID); break;
          }
        } catch {}
      }
    })().catch(() => {});

    return () => stop.abort();
  },
};
