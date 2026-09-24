# Phase 2 — Task 02: `security-reviewer` agent

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `tools/claude-plugin/ethernal-nest-react/agents/security-reviewer.md`
- Create: `tools/claude-plugin/tests/agents.test.mjs`
- Modify: `tools/claude-plugin/ethernal-nest-react/README.md` (agents line)

**Interfaces:**
- Consumes: plugin layout from phase 0 (`agents/plan-critic.md` frontmatter style).
- Produces: agent `ethernal-nest-react:security-reviewer`, used by every PR of Tasks 03–22.

- [ ] **Step 1: Write the failing test**

`tools/claude-plugin/tests/agents.test.mjs`:

```js
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const agentsDir = join(import.meta.dirname, '..', 'ethernal-nest-react', 'agents');
const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

function frontmatter(file) {
  const text = readFileSync(join(agentsDir, file), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error(`${file}: no frontmatter`);
  const fields = Object.fromEntries(
    match[1].split('\n').map((line) => {
      const i = line.indexOf(':');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  return { fields, body: text.slice(match[0].length) };
}

describe('plugin agents', () => {
  const files = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));

  it('ships the security reviewer next to the plan critic', () => {
    expect(files.sort()).toEqual(['plan-critic.md', 'security-reviewer.md']);
  });

  it.each(files)('%s has a name matching its file and a description', (file) => {
    const { fields } = frontmatter(file);
    expect(fields.name).toBe(file.replace(/\.md$/, ''));
    expect(fields.description.length).toBeGreaterThan(40);
  });

  it.each(files)('%s is read-only (no write tools)', (file) => {
    const tools = frontmatter(file).fields.tools.split(',').map((t) => t.trim());
    for (const tool of WRITE_TOOLS) expect(tools).not.toContain(tool);
  });

  it('security reviewer covers every section 13 security topic', () => {
    const { body } = frontmatter('security-reviewer.md');
    for (const topic of [
      'brute force',
      'rate limit',
      'Origin',
      'cookie',
      'token reuse',
      'replay',
      'device key',
      'IDOR',
      'revocation',
      'enumeration',
      'last admin',
      'step-up',
    ]) {
      expect(body.toLowerCase()).toContain(topic.toLowerCase());
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm turbo run test --filter=@tms/claude-plugin`
Expected: FAIL — `ships the security reviewer next to the plan critic` (only `plan-critic.md` exists) and `ENOENT` for `security-reviewer.md`.

- [ ] **Step 3: Write the agent**

`tools/claude-plugin/ethernal-nest-react/agents/security-reviewer.md`:

```markdown
---
name: security-reviewer
description: Read-only security reviewer for pull requests that touch authentication, RBAC, sessions, tokens, secrets or the kiosk device model. Use before a PR leaves draft (mandatory for those PRs per CLAUDE.md). Returns ranked findings with file:line evidence and a concrete fix; never edits files.
tools: Read, Grep, Glob, Bash
model: inherit
---

You are the security reviewer of the TMS platform. You review one pull request (or a diff
range) for vulnerabilities and security regressions **before** it merges. You never edit files
and you never praise. Bash is for read-only commands only (`git diff`, `git log`, `git show`,
`ls`, `grep`); you do not run installs, builds, tests, formatters or anything that writes.

## Inputs

You receive a diff range (for example `main...HEAD`) or a PR number, and the paths of the spec
(`docs/superpowers/specs/*.md`), the phase plan and CLAUDE.md. Read the whole diff first, then
every changed file in full, then the spec sections the PR names (section 8 authentication,
section 9 RBAC, section 13 security list).

## Checklist (apply every item the diff touches; say "not touched" for the rest)

1. **Brute force and lockout**: every credential check (password, TOTP, recovery code, action
   token, PIN) runs under the same lockout counter and rate limit; a correct password alone never
   resets the failure counter before the second factor succeeds; attempts while locked are not
   counted; on public credential routes (login password step, 2FA-reset accept) a locked account's
   password is not verified at all (the dummy hash runs instead) and the answer is the same 401 as
   a wrong password — 423 with `Retry-After` only where the session already proved the account
   (MFA step, step-up, change password); the counter update is atomic (row lock or conditional
   update), never read-modify-write.
2. **Rate limit**: per IP and per account on every unauthenticated or credential-checking route;
   `trust proxy` trusts only the known proxy, so `X-Forwarded-For` cannot be spoofed.
3. **Enumeration and timing**: unknown account, wrong password, disabled account and locked
   account give identical status, body and a comparable duration (a dummy hash runs for unknown and
   locked accounts); "forgot password" always answers the same.
4. **Sessions and cookies**: token 32 random bytes, only its hash stored; cookie HttpOnly, Secure,
   SameSite=Strict, `__Host-` prefix or a documented fallback; token rotated on every scope
   upgrade (fixation); idle and absolute expiry enforced server-side; every request re-reads user
   status and kind (no cache); PRE_MFA/ENROLLMENT scopes cannot reach FULL routes.
5. **Revocation**: block, deactivate, password change, role change and 2FA reset delete all the
   user's sessions and unused tokens in the same transaction as the state change.
6. **Token reuse**: action tokens are single-use via one conditional update (`usedAt IS NULL AND
   expiresAt > now`), consumed only by POST, never logged, never in query strings (fragment only),
   expired tokens rejected; issuing a new token revokes older unused tokens of the same type.
7. **TOTP and replay**: ±1 step window; the replay guard (`totpLastUsedStep`) is updated atomically
   and also set at enrollment; attempts per pre-session are capped; secrets are encrypted with
   AES-256-GCM with AAD bound to the user and a key id; the pending secret lives only in the
   enrollment session; recovery codes are hashed and single-use.
8. **Authorization**: every route carries exactly one route-access marker (fail-closed); permission
   checks are AND; step-up is enforced where the spec or plan requires it; object-level checks:
   actor vs target (IDOR), self role change forbidden, last admin checked under a row lock
   (`SELECT ... FOR NO KEY UPDATE`) taken in one fixed order (admins by id, then actor and target
   by id), role `appliesTo` matches the user kind; driver JWTs and driver users are rejected on the
   admin API and staff cookies on the kiosk API.
9. **Origin and CSRF**: mutations require an allowed `Origin` or `Sec-Fetch-Site: same-origin`;
   no CORS with credentials; `Origin: null` rejected.
10. **Device key** (kiosk API): scope `display` can only read the display feed; keys are compared
    in constant time; the key is treated as a device tag, not a secret.
11. **Secrets and data exposure**: no password, PIN, token, cookie, TOTP secret, otpauth URI,
    recovery code or card serial in logs, audit metadata, Sentry events, error messages or test
    snapshots; the scrub list covers every new sensitive key; secrets only from env; dev secrets
    rejected in production; `Cache-Control: no-store` and helmet's headers (no `X-Powered-By`) on
    every API response; the client name appears nowhere.
12. **Transactions and side effects**: the state change and its audit record share one
    transaction; mail and other side effects run only after commit and cannot leak the token on
    failure.
13. **Input validation**: every body, query and param has a zod schema; lengths are bounded before
    expensive work (password ≤ 128 before argon2 or zxcvbn).
14. **Tests**: each item above that the diff touches has a negative test (wrong code, reused
    token, parallel requests, foreign Origin, missing permission, stale step-up); flag any
    security claim in the PR description that no test exercises.

## Output format

A markdown table, most severe first, then one summary line:

| #   | Severity | Finding | Evidence | Proposed fix |
| --- | -------- | ------- | -------- | ------------ |

Severity: **CRITICAL** = exploitable now (auth bypass, secret exposure, privilege escalation);
**HIGH** = exploitable under realistic conditions or a missing required control; **MEDIUM** =
defence-in-depth gap or missing negative test; **LOW** = hardening or clarity. Evidence is a
`file:line` from the diff or a command you ran with its output. Proposed fix is a concrete change.
At most 25 findings. End with: `Verdict: BLOCK | FIX BEFORE MERGE | OK` and
`Summary: N findings (C critical, H high, M medium, L low)`.
```

In `tools/claude-plugin/ethernal-nest-react/README.md` replace the agents bullet and the "More ... agents" sentence with:

```markdown
- **Agents**: `plan-critic` (read-only critic for specs and plans), `security-reviewer`
  (read-only review of auth/RBAC/session/token/secret changes; mandatory for those PRs).
- **Skills**: `verify`, `pr`. More (`new-module`, `add-permission`, `db-migration`,
  `new-admin-page`, `e2e-scenario`, `docs-sync`) and agents (`qa-e2e`, `architecture-reviewer`,
  `docs-writer`) arrive with the phases that need them.
```

- [ ] **Step 4: Run the tests and the validator**

Run: `pnpm turbo run test --filter=@tms/claude-plugin && CLAUDE_BIN=~/.local/bin/claude pnpm --filter @tms/claude-plugin validate`
Expected: all vitest files pass (the 6 existing phase 0 files — `format`, `hooks-cli`, `hooks-json`, `protect`, `reminder`, `settings` — plus `agents.test.mjs` with 1 + 2 + 2 + 1 = 6 new tests); both validations print "Validation passed".

- [ ] **Step 5: Dry run on a seeded vulnerability**

```bash
test -z "$(git status --short)" || { echo 'commit or stash first: the dry run needs a clean tree'; exit 1; }
git switch -c tmp/security-reviewer-dry-run
mkdir -p scratch && cat > scratch/vuln.ts <<'EOF'
import { Controller, Post, Body } from '@nestjs/common';
@Controller('auth')
export class VulnController {
  @Post('reset')
  reset(@Body() body: { token: string; password: string }) {
    console.log('reset with token', body.token);
    return { ok: true };
  }
}
EOF
git add scratch/vuln.ts && git commit -m "test: seeded vulnerability for the reviewer dry run" --no-verify
~/.local/bin/claude -p --plugin-dir tools/claude-plugin/ethernal-nest-react \
  "Use the security-reviewer agent to review the diff HEAD~1..HEAD. Print only its table and verdict." \
  | tee /tmp/security-reviewer-dry-run.txt
git switch - && git branch -D tmp/security-reviewer-dry-run
```

Expected (the reviewer is an LLM, so the bar is a minimum, not an exact table): the table flags at least 2 of the 3 seeded issues — (a) the token logged to the console (item 11), (b) the route without a route-access marker (item 8), (c) the body without a zod schema (item 13) — and the verdict is `BLOCK` or `FIX BEFORE MERGE`. Record the real table from `/tmp/security-reviewer-dry-run.txt` (every row, not only the seeded ones) in the journal and the PR. A run below that bar is a prompt fix (sharpen the checklist item it missed, run again, log both runs), not a red PR. The temporary branch is deleted; nothing of it is pushed.

- [ ] **Step 6: Commit**

```bash
git add tools/claude-plugin/ethernal-nest-react/agents/security-reviewer.md \
  tools/claude-plugin/tests/agents.test.mjs tools/claude-plugin/ethernal-nest-react/README.md \
  docs/efficiency/auth-core.md
git commit -m "feat(plugin): add the security-reviewer agent"
```

`docs/efficiency/auth-core.md` is created in this commit with the same header and columns as `docs/efficiency/critical-path.md` (title "Efficiency journal: auth-core lane (phase 2 stack A)").

PR body: diagram — none (text suffices); boundaries: `tools/claude-plugin` only; verification table: vitest counts, both validations, dry-run findings; reviewer: `/code-review`.
