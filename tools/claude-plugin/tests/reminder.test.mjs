import { describe, expect, it } from 'vitest';
import { shouldRemind } from '../ethernal-nest-react/hooks/lib/reminder.mjs';

describe('shouldRemind', () => {
  it('reminds when apps/ or packages/ have changes', () => {
    expect(
      shouldRemind({ porcelain: ' M apps/api-admin/src/main.ts\n', stopHookActive: false }),
    ).toBe(true);
    expect(
      shouldRemind({ porcelain: '?? packages/db/prisma/x.sql\n', stopHookActive: false }),
    ).toBe(true);
  });
  it('handles renames by their destination', () => {
    expect(
      shouldRemind({ porcelain: 'R  docs/a.md -> apps/x/b.md\n', stopHookActive: false }),
    ).toBe(true);
    expect(shouldRemind({ porcelain: 'R  apps/a.ts -> docs/b.md\n', stopHookActive: false })).toBe(
      false,
    );
  });
  it('stays quiet for docs-only changes or a clean tree', () => {
    expect(
      shouldRemind({ porcelain: ' M docs/architecture.md\n M CLAUDE.md\n', stopHookActive: false }),
    ).toBe(false);
    expect(shouldRemind({ porcelain: '', stopHookActive: false })).toBe(false);
  });
  it('never blocks twice in a row', () => {
    expect(shouldRemind({ porcelain: ' M apps/x.ts\n', stopHookActive: true })).toBe(false);
  });
});
