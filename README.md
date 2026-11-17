# agent-skills

Skills for AI coding agents (Claude Code, OpenCode, VS Code with GitHub Copilot, Codex, and other hosts
that read `SKILL.md` skills and talk to MCP servers).

| Skill | What it does |
| --- | --- |
| [demonstrate](skills/demonstrate) | Guided UI tours in a real browser. The agent drives the page and explains each step in a side panel; you click Next/Back, ask questions, annotate the page or record what you do, and the agent sees it. Also demonstrates code changes ("show me what changed") |

## Set up with your agent

Paste this into your agent (in the host you want the skill in):

```text
Set up the "demonstrate" agent skill from https://github.com/Knyrps/agent-skills for the agent host
you are running in.

1. Clone the repo to a stable folder outside any project (for example ~/src/agent-skills). The skill
   is skills/demonstrate; call its absolute path <skill>.
2. Read <skill>/README.md, section "Install", and follow it:
   - run `npm install` in <skill>/bridge, and `npx playwright install chromium` if Playwright's
     Chromium is not installed yet;
   - link <skill> into this host's personal skills folder as "demonstrate" (symlink, or a junction
     on Windows), using the host's documented location;
   - register the two MCP servers "demonstrate" and "playwright-demo" in this host's MCP config, using
     the matching snippet in <skill>/config/ with <skill> replaced by the absolute path. Merge into
     the existing config; do not change or remove other servers, including an existing "playwright".
3. Ask me which dev hosts the tours should run on and add them to the allowlist in
   <skill>/extension/config.json (keep "localhost").
4. Verify with `node <skill>/bridge start`: the output must show extensionConnected: true and
   panelOpen: true, and a browser window with the demonstrate side panel opens.
5. Tell me what you changed and whether I need to restart or reload the agent so it picks up the new
   skill and MCP servers.
```

Afterwards, ask the agent for a tour, for example "Give me a tour of the checkout on localhost:3000" or
"Demonstrate my uncommitted changes".

## Manual install

See [skills/demonstrate/README.md](skills/demonstrate/README.md#install).
