# Harness adapters

show-and-tell works in any agent harness that speaks MCP or can run a shell command. Three things depend on
the harness, though, and an adapter can do them better than the agent can:

| | Without an adapter | With an adapter |
| --- | --- | --- |
| Panel input reaches the agent | The agent runs a watcher job (`bridge wait`) | The adapter puts it into the session as a user message |
| The agent's reply reaches the panel | The agent calls `say` | The adapter mirrors the reply |
| Permission prompts | Only in the harness | Also in the panel, answerable there |
| Several chats on one MCP process | They share one tab and conversation | Each chat gets its own |

An adapter is a small plugin for one harness that talks to the bridge over HTTP. Everything below is the
whole contract; nothing in it is specific to one harness.

## Bridge HTTP API

The bridge listens on `http://127.0.0.1:47613` (`DEMO_BRIDGE_PORT`). Every request needs the header
`X-Show-And-Tell: 1` and must not carry an `Origin` header (browsers can't call it).

A **session** is a string matching `[\w.-]{1,64}`, chosen by the adapter, e.g. `oc-<harness session id>`.
Its **label** is the name the user sees on the tab group and in the panel (the chat's title).

### Name the session on tool calls

Add two arguments to every call of a show-and-tell MCP tool (they are removed before the tool runs):

```json
{ "_session": "oc-ses_123", "_label": "Fix the filter" }
```

The tool then acts for that session: its own tab, conversation, host questions and user-activity log.
Without them a call belongs to the MCP process's own session.

### Receive what the user sends

```
GET /wait?session=<id>&label=<label>&timeout=<s>
→ { "actions": [ … ] }            (empty after the timeout)
```

Long poll in a loop. While a poll is open the panel shows the session as listening and tool results stop
asking the agent for a watcher. Action types are described in SKILL.md ("What the user sends"); an
annotation's `labelledImagePath` is a PNG worth attaching. Hand `question`, `annotation` and `recording`
actions to the session as a user message and tell the agent that its reply is shown in the panel.

### Reply in the panel

```
POST /say { "session", "label", "text" }      text is Markdown
```

Mirror the agent's final text of the turn that answered panel input. The panel shows "Thinking…" from the
delivery until this arrives. Skip it when the agent called the `say` tool itself in that turn.

### Ask the user in the panel

```
POST /ask { "session", "label", "id", "title", "detail"?, "kind"?, "options": [{ "id", "label" }] }
POST /ask/done { "id", "note"? }
```

Shows a card in the session's conversation with up to four buttons; the first option is the primary
action, the last the dismissive one. The user's click arrives through `/wait` as
`{ "type": "answer", "ask": "<id>", "choice": "<option id>" }`. Call `/ask/done` when the question was
answered elsewhere or is no longer needed; `note` is kept in the conversation.

### The user's own input

```
GET /user-events?session=<id>
→ { "events": [{ "kind", "ts", "text", … }] }    read once
```

What the user did in the session's tab (clicks, edits, keys, navigations) that the agent did not cause.
show-and-tell's own tool results already include it; an adapter can append it to every other tool result
too, so the agent notices a changed page before its next browser call.

## Adapters

- **OpenCode**: [`adapters/opencode`](../adapters/opencode/index.js), a V2 plugin. Load it with
  `"plugins": [{ "package": "<skill>/adapters/opencode" }]` in `opencode.json(c)`; options are listed at
  the top of the file.

A new adapter needs: a tool-call hook that can add arguments (for `_session`), a way to add a user message
to a session, an event or hook for the agent's final text, and optionally a permission hook. Harnesses that
can't add messages to a running session keep the watcher for delivery and use the rest.
