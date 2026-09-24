# Phase 2 — Task 01: Plan

> Part of the phase 2 plan: read [index.md](index.md) (constraints, shared interfaces, env) and this file only.


**Files:**
- Create: `docs/superpowers/plans/2026-09-23-phase-2-auth/` (this plan: `index.md`, one `task-NN.md` per task, `review.md`)
- Modify: `docs/efficiency/critical-path.md` (rows for spikes, plan writing, reconcile, critic pass)

**Interfaces:**
- Consumes: the spec; the phase 1 plan (reconcile source).
- Produces: the task list, names and verification criteria every later task uses.

- [ ] **Step 1: Reconcile with the final phase 1 plan**

Open `docs/superpowers/plans/2026-09-23-phase-1-foundation.md` (final version, after its critic pass). For every row of "Phase 1 interfaces assumed" compare name, package, signature and file location. Edit this plan wherever phase 1 differs (the phase 1 name wins). Record the differences in a "Reconcile with phase 1" table at the end of this document (`# | assumed | phase 1 final | tasks edited`).

- [ ] **Step 2: Critic pass**

Dispatch `ethernal-nest-react:plan-critic` (fresh context, read-only) with this plan, the spec and CLAUDE.md. Apply accepted findings, then add the critic table (`# | Severity | Finding | Change made`) and "Estimated rework prevented" at the end of this document.

- [ ] **Step 3: Verify and commit**

Run: `pnpm exec prettier --check docs/superpowers/plans/2026-09-23-phase-2-auth/ docs/efficiency/critical-path.md && grep -nE 'T[B]D|T[O]DO|implement [l]ater|[Ss]imilar to [T]ask' docs/superpowers/plans/2026-09-23-phase-2-auth/; echo "placeholders=$?"`
Expected: prettier clean; `placeholders=1` (grep found nothing; the bracketed classes keep the command from matching itself).

```bash
git add docs/superpowers/plans/2026-09-23-phase-2-auth/ docs/efficiency/critical-path.md
git commit -m "docs: add the phase 2 auth plan"
```

PR body: diagram type `flowchart` (the two stacks and their bases); boundaries: docs only; verification: prettier + placeholder grep output; reviewer: `/code-review`.
