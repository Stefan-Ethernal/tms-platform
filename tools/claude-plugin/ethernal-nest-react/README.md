# ethernal-nest-react

Claude Code plugin for Ethernal's NestJS + React + Prisma projects.

- **Hooks**: `PreToolUse` blocks edits to `.env`, `.env.*` (except `*.example`) and `docs/client/**`
  (paths resolved against the project root, not the session cwd); `PostToolUse` runs eslint --fix
  and prettier on edited TypeScript/JavaScript files, best effort; `Stop` adds a non-blocking
  reminder to run `pnpm verify` when `apps/` or `packages/` have uncommitted changes.
- **Agents**: `plan-critic` (read-only critic for specs and plans).
- **Skills**: `verify`, `pr`. More (`new-module`, `add-permission`, `db-migration`,
  `new-admin-page`, `e2e-scenario`, `docs-sync`) and agents (`security-reviewer`, `qa-e2e`,
  `architecture-reviewer`, `docs-writer`) arrive with the phases that need them.

Loading: the repository's `.claude/settings.json` registers the local marketplace `tms`
(`tools/claude-plugin`) and enables `ethernal-nest-react@tms`, so the plugin is active once the
folder is trusted. Fallback: `pnpm claude` (`claude --plugin-dir tools/claude-plugin/ethernal-nest-react`).
Validate: `pnpm --filter @tms/claude-plugin validate`.
