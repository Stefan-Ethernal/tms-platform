# ADR-0004: Permission catalogue in code, synchronised by a pure planner

- Status: accepted
- Date: 2026-09-23
- Spec reference: section 9 (RBAC), section 6 (structure), D12 (who runs migrations)

## Context

Permission codes are referenced by `@RequirePermissions(...)` in controllers, so they must exist at
compile time and be reviewed in pull requests. Administrators still own the display name and
description of every permission and the grants of every role (section 9). Codes get renamed and
retired over time; a retired code must not break a role that still references it, and the sync must
run in every environment before the apps start (D12: the compose `migrate` one-shot, `predev`, the
seed) — never inside a Nest process. Section 6 places a `PermissionSyncService` in `domain/admin`,
which would pull Nest and the domain layer into the migrate image.

## Decision

- The catalogue lives in `@tms/contracts` (`PERMISSIONS`: `code`, `group`, `audience`,
  `defaultName`, `defaultDescription`, `renamedFrom?`); `validateCatalogue` guards its invariants.
- The sync lives in `@tms/db` as a pure planner plus an applier plus a CLI (plan deviation 1):
  `planPermissionSync(state, catalogue)` returns a `SyncPlan`; `syncPermissionsInTx` applies it in
  one `ReadCommitted` transaction under `pg_advisory_xact_lock(7301)`; `tms-sync-permissions` prints
  the `SyncReport` as one JSON line.
- Insert-only texts: `name` and `description` are written when a code first appears and never again.
- `renamedFrom` moves `RolePermission` rows to the new code (dropping a grant the role already holds),
  after which the old code is unreferenced and deleted in the same run.
- A code missing from the catalogue is deprecated while any role references it and deleted otherwise.
- Roles with `permissionsLocked` in `SEEDED_ROLES` (Admin) are matched by `Role.key`, not by name,
  and always hold exactly the active codes of their `audience`.
- Consumers: the `migrate` one-shot, `predev` (`db:setup`) and the seed. The applications never sync.

## Alternatives considered

- Sync at application startup: rejected by D12 — two processes would race on the same rows, a failed
  sync would surface as an app crash loop instead of a failed step, and the kiosk API would carry
  back-office write logic.
- A Nest `PermissionSyncService` in `domain/admin` executed by a Nest CLI inside the migrate image:
  rejected — the image would need `@nestjs/*` and `@tms/domain`, roughly tripling its size, and the
  seed (which runs before any module exists) could not call it.
- Permissions as database-only rows created and deleted in the UI: rejected by section 9 — a code the
  code base does not know cannot protect a route, and a deleted code would silently open one.

## Consequences

- Adding a permission is a catalogue entry in a pull request; renaming one adds the old code to
  `renamedFrom`, which stays until every deployment has passed the rename.
- Phase 3b's `domain/admin` edits names and descriptions through Prisma and reuses `SyncReport` for
  the "deprecated" flag; it never writes codes.
- Renaming the Admin role in the UI is safe because locking is keyed by `Role.key`.
- Two concurrent runs (for example `predev` and the compose one-shot on the same database) serialise
  on the advisory lock; the second plans an empty diff.
- Property tests (`fast-check`) pin `sync(sync(c)) == sync(c)` and grant preservation modulo renames
  for random catalogue diffs (section 13).
