# Client documents (local only)

This folder holds client-provided reference material (functional description of the reference
TMS/TAS system, terminal architecture drawings, roadmap, proposal deck). Everything in this folder
except this README is ignored by git and must never be committed: the repository is public.

If you are onboarding, ask the project owner for the documents and place them here. The design
spec in `docs/superpowers/specs/` cites them by section number.

This folder also holds `forbidden-terms.txt`, a local-only, gitignored, newline-separated list of
the client's name and its spellings. `tools/scripts/check-hygiene.mjs` reads it (and the
`FORBIDDEN_TERMS` CI secret, which holds the same terms for the pipeline, where this file does not
exist) to fail the hygiene check if any of those terms ever appear in tracked repository text. Ask
the project owner for the current list; extend it if a new spelling turns up.
