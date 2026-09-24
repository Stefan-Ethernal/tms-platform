# Claude Code plugin workspace

`ethernal-nest-react/` is the plugin. This directory is also a local plugin **marketplace**
(`.claude-plugin/marketplace.json`) registered by the repository's `.claude/settings.json`, and a
workspace package holding the vitest tests for the hook scripts, so the plugin folder itself stays
publishable.

- `pnpm --filter @tms/claude-plugin test` — hook unit and CLI tests
- `pnpm --filter @tms/claude-plugin validate` — `claude plugin validate --strict` for the
  marketplace and the plugin (set `CLAUDE_BIN=~/.local/bin/claude` if `claude` is not on PATH)
