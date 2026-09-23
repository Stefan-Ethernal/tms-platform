# ADR-0007: Client name kept out of the repository by convention

- Status: accepted
- Date: 2026-09-23
- Spec reference: sections 13–14 (hygiene), acceptance criterion 9

## Context

The repository is public. Client documents live in the gitignored `docs/client/`. From phase 1,
seed data (products, loading points) is built from those documents, the likeliest path for the
client's name to slip into a seed file, fixture, ADR or commit. A leak is practically irreversible:
forks, caches and search indexes keep the name after a history rewrite. Any mechanical check needs
the list of spellings, which is the name itself, stored outside the repository (a file on every
machine, a CI secret). A file-grepping check cannot cover commit messages or PR titles in any
variant.

The options considered, and what each would catch:

|            | Local pre-commit (gitignored list) | CI check (secret)                                        | What it misses                                                      |
| ---------- | ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| A          | yes                                | yes                                                      | only PR titles and commit messages                                  |
| B          | yes                                | no (CI still checks PDF/DOCX files and CLAUDE.md length) | `--no-verify`, web UI, another machine or worktree without the list |
| C (chosen) | no                                 | no                                                       | everything; relies only on discipline                               |

In every option, PR titles and commit messages are covered only by the convention.

## Decision

Option C, chosen by the project owner on 2026-09-23. The rule lives in `CLAUDE.md` (loaded by
every Claude Code session, subagents included) and applies to humans and tooling alike: repository
text, commit messages, PR titles and bodies, branch names, fixtures and seed data.

Still enforced mechanically: client-type documents outside `docs/client/` (hygiene check,
pre-commit and CI), secrets (gitleaks), and Claude's edits to `docs/client/` (plugin hook and
project settings deny rule).

## Alternatives considered

- A (local pre-commit + CI secret): would also catch what CI sees at push time, but still misses PR
  titles and commit messages, and needs the name stored twice (gitignored file, CI secret).
- B (local pre-commit only, no CI secret): CI still checks PDF/DOCX files and CLAUDE.md length, but
  the term check itself is bypassed by `--no-verify`, the GitHub web UI, or another machine or
  worktree that lacks the gitignored list.

## Consequences

Relies on discipline and review; reviewers (human and the `security-reviewer`/`/code-review`
passes) watch for the name, especially in seed data. If the name ever lands on GitHub, treat it as
an incident (rewrite history and ask GitHub support to purge cached views) rather than a normal
fix. Revisit this ADR if a leak happens or if more contributors join. Git history keeps the removed
check (Task 7 commits) if it is ever wanted back.
