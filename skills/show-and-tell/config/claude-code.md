# Claude Code

Replace `<skill>` with the absolute skill path, then run:

```sh
claude mcp add --scope user show-and-tell -- node <skill>/bridge/index.js
claude mcp add --scope user playwright-demo -- npx -y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9334 --ignore-https-errors
```

The skill waits for the user through a background shell job. If it falls back to `wait_for_action`,
that call blocks up to 10 minutes; raise Claude Code's MCP tool timeout (`MCP_TOOL_TIMEOUT`, in ms) if
it gets cut off.
