# Efficiency journal: token-budget lane

Retrospective on the 2026-09-24 token-usage incident: why several parallel sessions,
run to speed up phase 1/2/3 planning, cost more than they saved, and what changed as a
result. The resulting rules live in `CLAUDE.md` → Token budget; this entry is the "why".

## What happened

Between 2026-09-20 and 2026-09-24 up to 6 sessions were active in the same hour: the
phase 1 plan-writing/execution session, a phase 2 planning session, a phase 3 planning
session, plus one-off worktree sessions for CI and doc fixes. The intent was to
parallelise independent lanes (phase 2 and phase 3 planning while phase 1 executes) to
finish faster. It backfired for two compounding reasons:

- **Every call re-reads the whole context.** Cache-read tokens (~2 billion across the
  measured transcripts) dwarfed output tokens (~14 million) by two orders of magnitude.
  Context size, not output, drives the weekly/5-hour limits — so the number of live
  sessions times their average context size is the real cost driver, not how much work
  each session produces.
- **Single-file plans do not scale with agent count.** The phase 2 plan was one 567 KB
  file (~140k tokens). Every writer and critic subagent dispatched against it read it
  whole, because there was no smaller unit to hand them. Multiplied across ~5,320 Opus
  subagent calls (median context 156k, p90 380k) and a Fable main session averaging
  290k, this was the single largest avoidable cost.
- **Planning ahead of merged code compounds the waste.** Phase 2 and phase 3 were
  planned before phase 1 had merged, so when phase 1's actual (reviewed, critic-amended)
  interfaces landed, both later plans needed a reconciliation pass — a 27-item reconcile
  against the phase 2 plan alone. That rework was itself paid for at full-plan-read cost,
  once per lane.

Net effect: the weekly usage limit (67%) and 5-hour limit (44%) were both on track to run
out days before reset, without the parallel lanes actually finishing any faster — each
lane still had to wait for the others to stabilize before its own plan could be trusted.

## Root causes, ranked by cost

1. Whole-plan reads by every subagent (no per-task file boundary).
2. Too many concurrent sessions/lanes for the actual dependency graph between them (phase
   2 and 3 both depend on phase 1's real interfaces, not just its spec).
3. Model selection defaulting to the most capable tier (Opus implementers, Fable main
   session) for work that a mid-tier model handles in the same number of turns.
4. No forcing function to `/clear` a session once its context grew past the point where
   most of it was re-read scaffolding rather than live task state.

## Lessons and recommendations

- **Plan as a directory, not a file.** Split into `index.md` (constraints, shared
  interfaces, overview) plus one `task-NN.md` per task. Hand an implementer or reviewer
  the index and only its own task file — never the whole plan. This is the fix for the
  single biggest cost driver above; applied to phase 2 (`307621f`).
- **Plan just-in-time, not ahead.** Write phase N+1's detailed plan only after phase N is
  merged, so it reconciles against real code once, not speculatively against a spec that
  may still shift. Phase 3's detailed plan was put on hold for exactly this reason.
- **Fewer parallel sessions.** Cap at 2 concurrent sessions (e.g. one executing, one
  reviewing). Three or more looked faster but cost more in reconciliation than it saved
  in wall-clock — Stefan's own conclusion after running three.
- **Fewer, more targeted subagents per task.** Dispatch one implementer per task (never
  parallel implementers on the same plan — they conflict), and size the review loop to
  the finding, not the whole branch; batch same-shape mechanical edits into one dispatch
  instead of one subagent each.
- **Minimum viable model per role.** Sonnet for the main coordinating session and for
  implementers/reviewers when the task file already carries the code to write or check;
  Opus reserved for design judgment and auth/RBAC review; Fable reserved for the
  `plan-critic` pass, once per phase — not for a main session that stays open all day.
- **`/clear` on a budget, not on instinct.** Once `/context` passes ~150k, clear rather
  than let a session's own scrollback become the thing being re-read on every turn.
- **Short outputs while iterating.** Scoped `pnpm turbo run <task> --filter=<package>`
  during a task; full `pnpm verify` once, right before the PR; tail long command output
  instead of pasting it into the next dispatch.

## Where the rules live now

The prescriptive form of these lessons is `CLAUDE.md` → Token budget (added in #23); this
entry is the retrospective backing it — re-read it before proposing a return to more
parallel lanes or a heavier default model, since that is exactly the configuration that
produced the incident.
