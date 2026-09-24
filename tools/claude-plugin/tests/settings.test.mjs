import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const settings = JSON.parse(readFileSync(path.join(repoRoot, '.claude/settings.json'), 'utf8'));

describe('.claude/settings.json permissions', () => {
  it('does not carry a broad allow rule for git status, diff or log', () => {
    // Claude Code recognizes read-only forms of git as a built-in read-only command set and runs
    // them without a permission prompt in every mode (docs: "Read-only commands"), so an explicit
    // allow rule here only widens the surface to the *write* forms these prefixes also match,
    // e.g. `git diff --output=<path>` (9-I1).
    const broad = settings.permissions.allow.filter((rule) =>
      /^Bash\(git (status|diff|log):\*\)$/.test(rule),
    );
    expect(broad).toEqual([]);
  });

  it('allows only the exact pnpm install invocations, not the write form `pnpm install <pkg>`', () => {
    expect(settings.permissions.allow).toContain('Bash(pnpm install)');
    expect(settings.permissions.allow).toContain('Bash(pnpm install --frozen-lockfile)');
    expect(settings.permissions.allow).not.toContain('Bash(pnpm install:*)');
  });

  it('denies Vite mode-scoped local env files (.env.<mode>.local) (9-M4)', () => {
    expect(settings.permissions.deny).toContain('Edit(/**/.env.*.local)');
  });
});
