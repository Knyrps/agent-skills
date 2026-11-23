# agent-skills

Skills for AI coding agents (Claude Code, OpenCode, VS Code with GitHub Copilot, Codex, and other hosts
that read `SKILL.md` skills and talk to MCP servers).

| Skill | What it does |
| --- | --- |
| [show-and-tell](skills/show-and-tell) | A browser you and the agent share. The agent shows you things on the live page (highlights, labels, gestures); you show it things from a side panel (mark elements with notes, record what you do, ask), and it hears you right away. On top: guided tours of a feature or of your code changes, and review videos (MP4 with captions, chapters and a drawn cursor) |

## Set up with your agent

Paste this into your agent (in the host you want the skill in):

```text
Set up the "show-and-tell" agent skill from https://github.com/Knyrps/agent-skills for the agent host
you are running in.

1. Clone the repo to a stable folder outside any project (for example ~/src/agent-skills). The skill
   is skills/show-and-tell; call its absolute path <skill>.
2. Read <skill>/README.md, section "Install", and follow it:
   - run `npm install` in <skill>/bridge, and `npx playwright install chromium` if Playwright's
     Chromium is not installed yet;
   - link <skill> into this host's personal skills folder as "show-and-tell" (symlink, or a junction
     on Windows), using the host's documented location;
   - register the MCP server "show-and-tell" in this host's MCP config (an old "playwright-demo" entry
     on port 9334 can be removed: show-and-tell now includes those tools), using
     the matching snippet in <skill>/config/ with <skill> replaced by the absolute path. Merge into
     the existing config; do not change or remove other servers, including an existing "playwright".
3. Don't touch the host allowlist: sites on this machine (localhost, hosts-file entries pointing to
   127.0.0.1) work right away, and I allow any other host myself when the side panel asks.
4. Verify with `node <skill>/bridge start`: the output must show extensionConnected: true and
   panelOpen: true, and a browser window with the show-and-tell side panel opens.
5. Tell me what you changed and whether I need to restart or reload the agent so it picks up the new
   skill and MCP servers.
```

Afterwards, point at things together, for example "Show me where the discount is calculated on
localhost:3000", "Look at what I marked", "Walk me through my uncommitted changes" or "Record a review
video of the checkout".

## Manual install

See [skills/show-and-tell/README.md](skills/show-and-tell/README.md#install).

## License

[MIT](LICENSE). The built extension files bundle a few libraries; their notices are in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
