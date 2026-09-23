---
name: pr
description: Use when opening or updating a pull request on this repository - fills .github/pull_request_template.md from the real verification output (run /ethernal-nest-react:verify first), chooses a Mermaid diagram type per change, and creates the PR with gh.
---

# PR

## Preconditions

- Feature branch, conventional commits, rebased on `origin/main`.
- `/ethernal-nest-react:verify` ran in this session; you have its table and output.
- A PR that touches auth, RBAC, sessions or tokens needs the `security-reviewer` agent first;
  every other PR gets `/code-review`.

## Fill the template

Read `.github/pull_request_template.md` and fill every section:

1. **What and why**: 2-4 sentences. Name the spec section or decision (D1-D15) it implements.
2. **Diagram**: only when a picture explains better than text. Sequence for request flows,
   flowchart for state machines and pipelines, erDiagram for schema changes, block for topology.
3. **Affected boundaries**: packages/apps touched, public interfaces added or changed,
   migration yes/no and whether it is reversible.
4. **Verification**: paste the `scenario | layer | outcome` table with real results; for frontend
   changes add the numbered `claude --chrome` steps and the 2-4 screenshots.
5. **Risks and notes**: uncovered areas, follow-ups, ADR candidates, steps that could not run.

## Create

```bash
gh pr create --base main --title "<type>(<scope>): <summary>" --body-file <filled template>
```

The PR title becomes the squash commit on `main`, so it must be a valid conventional commit.
End the body with the attribution line the session's system reminder prescribes.
