# Phase 0: Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the complete development environment for the TMS Platform POC: pnpm/Turborepo monorepo with shared tooling, skeletons of both NestJS APIs and both Vite SPAs, Prisma package, docker-compose (postgres, mailpit, migrate, caddy), git hooks, CI with hygiene checks, Playwright/MSW skeletons, the Claude Code plugin skeleton (hooks, `plan-critic`, `verify`, `pr`), CLAUDE.md, PR template and repository documentation, so that phase 1 starts on green CI.

**Architecture:** One pnpm workspace (`apps/*`, `packages/*`, `e2e`, `tools/*`) orchestrated by Turborepo with a pnpm **catalog** as the single place for dependency versions. Shared tsconfig/eslint/jest presets live in `packages/config`. The two NestJS apps compile to CommonJS exactly like the official Nest 12 template (Nest 12 itself ships ESM; Node 24 `require(esm)` and Jest with `--experimental-vm-modules` handle it). The two Vite apps are ESM. The `db` package holds the Prisma 7 schema and config only (no models yet) so the compose `migrate` one-shot service and the CI drift check are real from day one. Production-like topology is exercised by the compose `full` profile: Caddy serves each SPA and forwards `/api` to its API on one origin (spec D11); in dev Vite proxies `/api`.

**Tech Stack:** Node 24, pnpm 12.5.1, Turborepo 2.11, TypeScript ~6.0.3 (TS 7 is not yet supported by `@nestjs/cli` 12 or typescript-eslint 8), NestJS 12.1, Jest 30 + ts-jest 29 + supertest 7, React 19.3 + Vite 8.3 + Vitest 5 + Testing Library 16, MSW 2.15, Playwright 1.63, Prisma 7.10 (8 is still an rc), zod 4.6, ESLint 10 + typescript-eslint 8.70 + eslint-plugin-boundaries 7, Prettier 3.9, husky 9 + lint-staged 17 + commitlint 21, gitleaks 8.30.1, Docker Compose v5, Caddy 2, Mailpit v1.31, Postgres 16, GitHub Actions (checkout v7, setup-node v7, pnpm/action-setup v6, upload-artifact v7), Claude Code 2.1.280 (`claude plugin validate --strict`, `--plugin-dir`, `--chrome`).

**Spec:** `docs/superpowers/specs/2026-09-23-rbac-checkin-design.md`, section 16 phase 0, plus sections 6 (structure), 13 (PR protocol), 14 (dev environment and Claude Code setup), decisions D11 and D12.

## Global Constraints

- Public repository: **client documents live only in `docs/client/` (gitignored) and the client name never appears in repository text** ("the client").
- "Code quality: SOLID, clean module boundaries, extensible, testable; quality over speed."
- "Dependency rule: `contracts ← db ← domain ← apps` ... Enforced with `eslint-plugin-boundaries`. Additional rule: `apps/api-driver` may import only `@tms/domain/checkin` and `@tms/domain/shared`."
- "Single origin: reverse proxy (Caddy) in compose serves the SPA and forwards `/api`; Vite `server.proxy` in dev." (D11)
- "Migrations never run inside a Nest process" — compose one-shot `migrate` service, `predev` locally. (D12)
- "Git hooks (husky): pre-commit lint-staged + gitleaks; commit-msg commitlint; pre-push `turbo run typecheck test --filter=...[origin/main]`. Gitleaks also in CI (hooks can be bypassed)."
- CI: "`prisma migrate diff` (drift), `tsc --noEmit`, eslint with boundaries, build, gitleaks, check that no `*.pdf|*.pptx|*.docx` exists outside `docs/client/`."
- "**CLAUDE.md** kept short" — enforced at 150 lines by the hygiene check.
- Plugin: "`tools/claude-plugin/ethernal-nest-react/` (`.claude-plugin/plugin.json`, `skills/<name>/SKILL.md`, `agents/`, `hooks/hooks.json`), loaded with `claude --plugin-dir tools/claude-plugin/ethernal-nest-react`, validated with `claude plugin validate`."
- Hooks: "`PostToolUse` (`Edit|Write`, `*.ts`/`*.tsx`) → eslint --fix + prettier on the file; `PreToolUse` blocks (exit 2) edits to `.env`, `.env.*` except `*.example`, and `docs/client/**`; `Stop` reminds about `pnpm verify` when `apps/` or `packages/` have changes."
- "UI language: English default; i18next infrastructure from the start (all strings through keys)" — the phase 0 SPA skeletons render **no user-facing strings** except the static `<title>` in `index.html`, which cannot go through i18n before React mounts and is asserted by the smoke tests; i18n init ships with `packages/ui` in phase 6.
- Every change to `main` goes through a PR (ruleset "main: pull requests only", squash merges). Conventional commits with a **header of at most 100 characters** (`@commitlint/config-conventional`).
- The client name never appears in repository text: guarded mechanically by the hygiene check reading the gitignored `docs/client/forbidden-terms.txt` (locally, pre-commit) and the `FORBIDDEN_TERMS` repository secret (CI). The check never prints the term itself.
- "`.env.example` per application; all secrets only in env."
- Repository text, code and documentation in English.
- Versions are pinned through the pnpm catalog; **never `latest`** in package manifests or Dockerfiles (Prisma `latest` currently resolves to an rc).

## Review Focus

Inputs the spec implies but that need explicit tests (each pinned to the owning task):

1. **Protected-path hook with unusual paths** (Task 10a): absolute paths, `..` traversal, paths outside the project, look-alike directories (`docs/clientele/`) and `.env.production.example` must be classified correctly — a false block stops legitimate work, a false allow leaks a client document.
2. **Format-on-edit hook on a file it cannot format** (Task 10a): a file with a syntax error mid-edit, a file that no longer exists, or one under `dist/`/`generated/` must never exit non-zero or block Claude.
3. **gitleaks bootstrap under network or integrity failure** (Task 7): a tampered or missing checksum must fail loudly and leave no binary in the cache; a cached binary must work offline.
4. **API startup with a bad `PORT`** (Task 2): `PORT=abc`, `PORT=0`, `PORT=70000` must fail fast with a message naming `PORT`; unknown variables must be ignored.
5. **`/api` precedence over the SPA fallback behind Caddy** (Task 5b and Task 6): an unknown `/api/...` path must return the API's JSON 404, never `index.html`, otherwise cookies and CSRF assumptions of D11 silently break.

## Execution notes (apply to every task)

- **Journal as you go**: every task's Commit step also appends its row (date, task, approach, start, end, rework, notes) to `docs/efficiency/critical-path.md` and includes that file in the commit. Do not batch rows at the end.
- **Claude CLI path**: `claude` is not on `PATH` in non-interactive shells on this machine; scripts use `"${CLAUDE_BIN:-claude}"` and verification steps call `~/.local/bin/claude` explicitly.
- **Background servers in verification steps**: start them with `timeout <seconds> <command> &` (never bare `pnpm ... &` + `kill %1`, which leaves `node`/`vite` children holding 3001/5173 with `strictPort`).
- **Commit headers**: at most 100 characters; the commit-msg hook (Task 8) rejects longer ones.
- **Fallbacks**: when a step names a fallback (Jest ESM options, `pnpm deploy --legacy`, Mailpit healthcheck), the acceptance criterion stays the same and the fallback used is recorded in the journal row and the PR "Risks and notes".

---

## Task overview

| # | Task | Deliverable | Verified by |
|---|---|---|---|
| 1 | Workspace root + `@tms/config` | pnpm workspace, catalog, Turborepo, shared tsconfig/eslint/jest presets | vitest test of the eslint import-restriction rule; `pnpm install` |
| 2 | NestJS API skeletons | `apps/api-admin`, `apps/api-driver` with reserved logger/Sentry slots | Jest unit (env) + e2e-spec (404 JSON) |
| 3 | Vite SPA skeletons + MSW | `apps/web-admin`, `apps/web-driver` | Vitest render test; `vite build` |
| 4 | Prisma `db` package | schema, `prisma.config.ts`, migration scripts | `prisma validate`; compose migrate exit 0 (Task 5a) |
| 5a | Compose default profile: postgres, mailpit, migrate | `infra/docker-compose.yml`, `migrate.Dockerfile`, `.dockerignore`, `smoke.sh`, `predev` | `infra/smoke.sh`; negative check (bad password gates the apps) |
| 5b | Compose `full` profile: APIs, SPAs behind Caddy | `api.Dockerfile`, `web.Dockerfile`, `Caddyfile`, `smoke.sh --full` | `infra/smoke.sh --full` |
| 6 | Playwright skeleton | `e2e/**` | smoke specs against compose `full` |
| 7 | Hygiene (documents, CLAUDE.md length, forbidden terms) + gitleaks scripts | `tools/scripts/**`, `.gitleaks.toml` | vitest + bash tests |
| 8 | Git hooks | husky, lint-staged, commitlint | commitlint pipe tests; pre-commit demos |
| 9 | CI workflows + Dependabot + `FORBIDDEN_TERMS` secret | `.github/**` | actionlint; green checks on the PR |
| 10a | Plugin hooks | `tools/claude-plugin/ethernal-nest-react/{.claude-plugin,hooks}`, tests | 54 vitest tests; `claude plugin validate --strict` |
| 10b | Plugin agent, skills, marketplace, project settings | `agents/`, `skills/`, `marketplace.json`, `.claude/settings.json` | `claude plugin validate --strict`; plugin loads from project settings |
| 11 | Documentation | CLAUDE.md, README, PR template, architecture, ADR 0001/0002 | hygiene line limit; prettier |
| 12 | `claude --chrome` check + ruleset required checks + human decisions | outside-repo steps | recorded outcomes |
| 13 | PR | PR to `main` per spec section 13 | CI green, review |

---

### Task 1: Workspace root and `@tms/config`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, `turbo.json`, `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `eslint.config.mjs` (root, for root-level files linted by lint-staged)
- Modify: `.gitignore` (add `.cache/`, `generated/`, `tools/claude-plugin/tests/tmp/`)
- Create: `packages/config/package.json`, `packages/config/tsconfig/base.json`, `packages/config/tsconfig/nest.json`, `packages/config/tsconfig/react.json`, `packages/config/tsconfig/react-node.json`, `packages/config/tsconfig/library.json`, `packages/config/eslint/base.mjs`, `packages/config/eslint/node.mjs`, `packages/config/eslint/react.mjs`, `packages/config/jest/create-config.mjs`, `packages/config/eslint.config.mjs`, `packages/config/vitest.config.mjs`
- Test: `packages/config/test/eslint-node.test.mjs`, `packages/config/test/eslint-boundaries.test.mjs` with fixtures under `packages/config/test/fixtures/`

**Interfaces:**
- Consumes: nothing.
- Produces: `nodeConfig({ tsconfigRootDir: string, allowedDomainSubpaths?: string[], boundariesRootPath?: string }): FlatConfig[]`, `reactConfig({ tsconfigRootDir: string }): FlatConfig[]`, `createJestConfig({ rootDir: string }): JestConfig`, tsconfig presets `@tms/config/tsconfig/{base,nest,react,react-node,library}.json`, catalog entries used by every later task (`"typescript": "catalog:"` etc.).

- [ ] **Step 1: Write the root workspace files**

`package.json`:

```json
{
  "name": "tms-platform",
  "private": true,
  "packageManager": "pnpm@12.5.1",
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "prepare": "husky",
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "e2e": "pnpm --filter @tms/e2e e2e",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "hygiene": "node tools/scripts/check-hygiene.mjs && tools/scripts/gitleaks.sh git --redact --no-banner",
    "verify": "turbo run lint typecheck test build && pnpm format:check && pnpm hygiene",
    "compose": "docker compose -f infra/docker-compose.yml",
    "claude": "\"${CLAUDE_BIN:-claude}\" --plugin-dir tools/claude-plugin/ethernal-nest-react"
  },
  "devDependencies": {
    "@commitlint/cli": "catalog:",
    "@commitlint/config-conventional": "catalog:",
    "eslint": "catalog:",
    "husky": "catalog:",
    "lint-staged": "catalog:",
    "prettier": "catalog:",
    "turbo": "catalog:",
    "typescript": "catalog:"
  },
  "lint-staged": {
    "*.{ts,tsx,mts,cts,js,mjs,cjs}": ["eslint --fix --no-warn-ignored", "prettier --write"],
    "*.{json,md,yml,yaml,css,html}": ["prettier --write"]
  }
}
```

`pnpm-workspace.yaml` (the catalog is the only place versions are written; `allowBuilds` is pnpm 12's allowlist for dependency lifecycle scripts, otherwise `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`):

```yaml
packages:
  - apps/*
  - packages/*
  - e2e
  - tools/scripts
  - tools/claude-plugin

catalog:
  # language and tooling
  typescript: ~6.0.3
  '@types/node': ^24.13.6
  eslint: ^10.11.0
  '@eslint/js': ^10.0.1
  typescript-eslint: ^8.70.1
  eslint-plugin-boundaries: ^7.2.0
  eslint-config-prettier: ^10.1.8
  eslint-plugin-react-hooks: ^7.1.1
  eslint-plugin-react-refresh: ^0.5.7
  globals: ^17.12.0
  prettier: ^3.9.9
  turbo: ^2.11.3
  husky: ^9.1.7
  lint-staged: ^17.5.1
  '@commitlint/cli': ^21.2.3
  '@commitlint/config-conventional': ^21.2.3
  vitest: ^5.0.1
  zod: ^4.6.5
  dotenv: ^18.0.3
  # nest
  '@nestjs/common': ^12.1.0
  '@nestjs/core': ^12.1.0
  '@nestjs/platform-express': ^12.1.0
  '@nestjs/testing': ^12.1.0
  '@nestjs/cli': ^12.0.5
  '@nestjs/schematics': ^12.0.5
  reflect-metadata: ^0.2.2
  rxjs: ^7.8.2
  jest: ^30.5.2
  ts-jest: ^29.4.12
  '@types/jest': ^30.0.0
  supertest: ^7.3.0
  '@types/supertest': ^7.2.1
  '@types/express': ^5.0.6
  # react
  react: ^19.3.0
  react-dom: ^19.3.0
  '@types/react': ^19.3.0
  '@types/react-dom': ^19.3.0
  vite: ^8.3.0
  '@vitejs/plugin-react': ^6.1.1
  jsdom: ^30.1.1
  '@testing-library/react': ^16.3.3
  '@testing-library/dom': ^10.4.2
  msw: ^2.15.0
  '@playwright/test': ^1.63.0
  # data
  prisma: ^7.10.0

allowBuilds:
  esbuild: true
  prisma: true
  '@prisma/engines': true
  msw: true
```

`.npmrc`:

```ini
engine-strict=true
```

`.nvmrc`:

```
24
```

`turbo.json`:

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "ui": "stream",
  "globalDependencies": [".nvmrc", "pnpm-workspace.yaml", "packages/config/**"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"],
      "inputs": ["$TURBO_DEFAULT$", "!**/*.md"]
    },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "dev": { "cache": false, "persistent": true, "dependsOn": ["^build"] }
  }
}
```

`.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

`.prettierrc.json`:

```json
{ "singleQuote": true, "printWidth": 100, "trailingComma": "all", "semi": true }
```

`.prettierignore` (the approved spec, plans and journals are prose reviewed by humans and must not be rewritten by the formatter):

```
node_modules
dist
coverage
.turbo
.cache
pnpm-lock.yaml
docs/client
docs/superpowers
docs/efficiency
**/generated
playwright-report
test-results
apps/*/public/mockServiceWorker.js
```

Root `eslint.config.mjs` (ESLint 10 looks for a config from the linted file's directory upward; root-level files such as `commitlint.config.mjs` need this one, while workspace packages keep their own):

```js
import { globalIgnores } from 'eslint/config';
import { nodeConfig } from './packages/config/eslint/node.mjs';

export default [
  globalIgnores(['apps/**', 'packages/**', 'e2e/**', 'tools/**']),
  ...nodeConfig({ tsconfigRootDir: import.meta.dirname }),
];
```

Append to `.gitignore`:

```
# Tool caches and generated code
.cache/
**/generated/
tools/claude-plugin/tests/tmp/
```

- [ ] **Step 2: Write the `packages/config` manifest, vitest config and the failing test**

`packages/config/package.json`:

```json
{
  "name": "@tms/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Shared tsconfig, eslint, jest and vitest presets for the TMS platform monorepo",
  "exports": {
    "./tsconfig/*": "./tsconfig/*",
    "./eslint/node": "./eslint/node.mjs",
    "./eslint/react": "./eslint/react.mjs",
    "./jest": "./jest/create-config.mjs"
  },
  "scripts": {
    "lint": "eslint .",
    "test": "vitest run"
  },
  "dependencies": {
    "@eslint/js": "catalog:",
    "eslint-config-prettier": "catalog:",
    "eslint-plugin-boundaries": "catalog:",
    "eslint-plugin-react-hooks": "catalog:",
    "eslint-plugin-react-refresh": "catalog:",
    "globals": "catalog:",
    "typescript-eslint": "catalog:"
  },
  "devDependencies": {
    "eslint": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  },
  "peerDependencies": {
    "eslint": "^10.0.0",
    "typescript": ">=6.0.0 <7"
  }
}
```

`packages/config/vitest.config.mjs`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['test/**/*.test.mjs'] } });
```

`packages/config/test/eslint-node.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { nodeConfig } from '../eslint/node.mjs';

async function lint(source, { allowedDomainSubpaths } = {}) {
  const eslint = new ESLint({
    cwd: import.meta.dirname,
    overrideConfigFile: true,
    overrideConfig: [
      ...nodeConfig({ tsconfigRootDir: import.meta.dirname, allowedDomainSubpaths }),
      // Type-aware rules need a TS project; the rule under test is specifier based.
      tseslint.configs.disableTypeChecked,
    ],
  });
  const [result] = await eslint.lintText(source, { filePath: 'src/example.ts' });
  return result.messages.map((m) => m.ruleId);
}

describe('nodeConfig allowedDomainSubpaths', () => {
  const restricted = { allowedDomainSubpaths: ['checkin', 'shared'] };

  it('rejects @tms/domain/admin when only checkin and shared are allowed', async () => {
    expect(await lint(`import { x } from '@tms/domain/admin';\nexport { x };\n`, restricted)).toContain(
      'no-restricted-imports',
    );
  });

  it('rejects the root @tms/domain export', async () => {
    expect(await lint(`import { x } from '@tms/domain';\nexport { x };\n`, restricted)).toContain(
      'no-restricted-imports',
    );
  });

  it('allows @tms/domain/checkin and @tms/domain/shared', async () => {
    const ids = await lint(
      `import { a } from '@tms/domain/checkin';\nimport { b } from '@tms/domain/shared';\nexport { a, b };\n`,
      restricted,
    );
    expect(ids).not.toContain('no-restricted-imports');
  });

  it('does not restrict @tms/domain when no subpaths are given', async () => {
    expect(await lint(`import { x } from '@tms/domain/admin';\nexport { x };\n`)).not.toContain(
      'no-restricted-imports',
    );
  });
});
```

`packages/config/test/eslint-boundaries.test.mjs` (the dependency rule is verified now against fixtures, not discovered in phase 1). Fixtures: `test/fixtures/packages/domain/src/index.ts` (`export const domain = 1;`), `test/fixtures/packages/db/src/index.ts` (`export const db = 1;`), `test/fixtures/packages/contracts/src/index.ts` (`export const contracts = 1;`):

```js
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { nodeConfig } from '../eslint/node.mjs';

const fixtures = path.join(import.meta.dirname, 'fixtures');

async function lint(relFile, source) {
  const eslint = new ESLint({
    cwd: fixtures,
    overrideConfigFile: true,
    overrideConfig: [
      ...nodeConfig({ tsconfigRootDir: fixtures, boundariesRootPath: fixtures }),
      tseslint.configs.disableTypeChecked,
    ],
  });
  const [result] = await eslint.lintText(source, { filePath: path.join(fixtures, relFile) });
  return result.messages.map((m) => m.ruleId);
}

describe('dependency rule contracts <- db <- domain <- apps', () => {
  it('forbids db importing domain', async () => {
    const ids = await lint('packages/db/src/x.ts', `import { domain } from '../../domain/src/index';\nexport { domain };\n`);
    expect(ids).toContain('boundaries/element-types');
  });

  it('allows domain importing db and contracts', async () => {
    const ids = await lint(
      'packages/domain/src/y.ts',
      `import { db } from '../../db/src/index';\nimport { contracts } from '../../contracts/src/index';\nexport { db, contracts };\n`,
    );
    expect(ids).not.toContain('boundaries/element-types');
  });

  it('forbids contracts importing anything internal', async () => {
    const ids = await lint('packages/contracts/src/z.ts', `import { db } from '../../db/src/index';\nexport { db };\n`);
    expect(ids).toContain('boundaries/element-types');
  });
});
```

- [ ] **Step 3: Install and run the tests to verify they fail**

Run: `pnpm install` (if pnpm reports `ERR_PNPM_IGNORED_BUILDS`, add every listed package to `allowBuilds` in `pnpm-workspace.yaml` and re-run; commit the final list), then `pnpm --filter @tms/config test`.

Expected: FAIL — `Failed to load url ../eslint/node.mjs` (the preset does not exist yet).

- [ ] **Step 4: Write the presets**

`packages/config/tsconfig/base.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true
  }
}
```

`packages/config/tsconfig/nest.json` (mirrors the official Nest 12 template: CommonJS output because the app has no `"type": "module"`, decorators with metadata):

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "resolvePackageJsonExports": true,
    "allowSyntheticDefaultImports": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "strictPropertyInitialization": false,
    "declaration": false,
    "removeComments": true,
    "incremental": true,
    "types": ["node", "jest"]
  }
}
```

`packages/config/tsconfig/react.json`:

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "erasableSyntaxOnly": true,
    "noEmit": true
  }
}
```

`packages/config/tsconfig/react-node.json` (for `vite.config.ts`):

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true
  }
}
```

`packages/config/tsconfig/library.json` (ESM libraries compiled to `dist/`; used from phase 1 by `contracts`, `auth-core`, `domain`, `logger`):

```json
{
  "extends": "./base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "declaration": true,
    "declarationMap": true,
    "verbatimModuleSyntax": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

`packages/config/eslint/base.mjs`:

```js
import path from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

/** Repository root, derived from this file's real location (packages/config/eslint). */
export const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

export const ignores = globalIgnores([
  '**/dist/**',
  '**/coverage/**',
  '**/node_modules/**',
  '**/generated/**',
  '**/.turbo/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '**/public/mockServiceWorker.js',
]);

/**
 * Dependency rule from the spec (section 3): contracts <- db <- domain <- apps.
 * eslint-plugin-boundaries v7: element patterns are folder patterns (no file part), and
 * `capture` names one entry per wildcard. Paths are matched relative to `rootPath`, so the same
 * configuration works when eslint runs inside any workspace package.
 *
 * @param {string} rootPath repository root (or a fixtures root in tests)
 */
export function boundariesConfig(rootPath) {
  return {
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': rootPath,
      'boundaries/elements': [
        { type: 'contracts', pattern: 'packages/contracts' },
        { type: 'db', pattern: 'packages/db' },
        { type: 'auth-core', pattern: 'packages/auth-core' },
        { type: 'logger', pattern: 'packages/logger' },
        { type: 'domain', pattern: 'packages/domain' },
        { type: 'ui', pattern: 'packages/ui' },
        { type: 'app', pattern: 'apps/*', capture: ['app'] },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message: '${file.type} may not import ${dependency.type} (dependency rule contracts <- db <- domain <- apps)',
          rules: [
            { from: 'db', allow: ['contracts'] },
            { from: 'auth-core', allow: ['contracts'] },
            { from: 'logger', allow: ['contracts'] },
            { from: 'domain', allow: ['contracts', 'db', 'auth-core', 'logger'] },
            { from: 'ui', allow: ['contracts'] },
            { from: 'app', allow: ['contracts', 'db', 'auth-core', 'logger', 'domain', 'ui'] },
          ],
        },
      ],
    },
  };
}

/**
 * @param {{ tsconfigRootDir: string, boundariesRootPath?: string }} options
 */
export function baseConfig({ tsconfigRootDir, boundariesRootPath = repoRoot }) {
  return defineConfig([
    ignores,
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      },
    },
    { files: ['**/*.{js,mjs,cjs}'], extends: [tseslint.configs.disableTypeChecked] },
    boundariesConfig(boundariesRootPath),
    prettier,
  ]);
}
```

`packages/config/eslint/node.mjs`:

```js
import globals from 'globals';
import { defineConfig } from 'eslint/config';
import { baseConfig } from './base.mjs';

/**
 * ESLint configuration for Node packages and NestJS apps.
 *
 * @param {{ tsconfigRootDir: string, allowedDomainSubpaths?: string[], boundariesRootPath?: string }} options
 *   `allowedDomainSubpaths` restricts imports of `@tms/domain` to the listed subpath
 *   exports (spec section 3: api-driver may import only checkin and shared).
 *   `boundariesRootPath` overrides the repository root for the boundaries plugin (tests only).
 */
export function nodeConfig({ tsconfigRootDir, allowedDomainSubpaths, boundariesRootPath }) {
  const config = [
    ...baseConfig({ tsconfigRootDir, boundariesRootPath }),
    { languageOptions: { globals: globals.node } },
  ];
  if (allowedDomainSubpaths) {
    config.push({
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '@tms/domain',
                  '@tms/domain/**',
                  ...allowedDomainSubpaths.map((sub) => `!@tms/domain/${sub}`),
                ],
                message: `This app may import only ${allowedDomainSubpaths
                  .map((sub) => `@tms/domain/${sub}`)
                  .join(' and ')} (spec section 3).`,
              },
            ],
          },
        ],
      },
    });
  }
  return defineConfig(config);
}
```

`packages/config/eslint/react.mjs`:

```js
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig } from 'eslint/config';
import { baseConfig } from './base.mjs';

/** @param {{ tsconfigRootDir: string }} options */
export function reactConfig({ tsconfigRootDir }) {
  return defineConfig([
    ...baseConfig({ tsconfigRootDir }),
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: { globals: globals.browser },
      extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    },
  ]);
}
```

`packages/config/jest/create-config.mjs`:

```js
/**
 * Jest configuration for NestJS apps (mirrors the official Nest 12 template).
 * Run with `NODE_OPTIONS=--experimental-vm-modules` because @nestjs/* ship ESM.
 *
 * @param {{ rootDir: string }} options
 * @returns {import('jest').Config}
 */
export function createJestConfig({ rootDir }) {
  return {
    rootDir,
    moduleFileExtensions: ['js', 'json', 'ts'],
    testEnvironment: 'node',
    testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
    transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
    collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
    coverageDirectory: '<rootDir>/coverage',
  };
}
```

`packages/config/eslint.config.mjs`:

```js
import { nodeConfig } from './eslint/node.mjs';

export default nodeConfig({ tsconfigRootDir: import.meta.dirname });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @tms/config test`
Expected: 7 passed (4 import-restriction, 3 boundaries).

Run: `pnpm --filter @tms/config lint && pnpm exec eslint eslint.config.mjs`
Expected: exit 0 for both (the second proves root-level files have a config).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc .nvmrc turbo.json .editorconfig .prettierrc.json .prettierignore .gitignore eslint.config.mjs packages/config docs/efficiency/critical-path.md
git commit -m "build: bootstrap pnpm workspace, turborepo and shared config presets"
```

---

### Task 2: NestJS API skeletons (`api-admin`, `api-driver`)

**Files:**
- Create (per app, `apps/api-admin` shown; `apps/api-driver` identical except name, default port 3002 and the eslint restriction): `package.json`, `nest-cli.json`, `tsconfig.json`, `tsconfig.build.json`, `jest.config.mjs`, `eslint.config.mjs`, `.env.example`, `src/main.ts`, `src/app.ts`, `src/app.module.ts`, `src/config/env.ts`
- Test: `apps/api-admin/src/config/env.spec.ts`, `apps/api-admin/test/app.e2e-spec.ts` (same for api-driver)

**Interfaces:**
- Consumes: `@tms/config/tsconfig/nest.json`, `nodeConfig`, `createJestConfig` (Task 1).
- Produces: `configureApp(app: INestApplication): INestApplication` in `src/app.ts` (global prefix `api`, shutdown hooks) used by `main.ts`, tests and later by phase 1 when the logger/Sentry are wired; `loadEnv(source: NodeJS.ProcessEnv): Env` with `Env = { NODE_ENV: 'development' | 'test' | 'production'; PORT: number }`; `AppModule`. Containers reach the API on `PORT` (3001 admin, 3002 driver); every route lives under `/api`.

- [ ] **Step 1: Write the failing unit test for env validation**

`apps/api-admin/src/config/env.spec.ts`:

```ts
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv({})).toEqual({ NODE_ENV: 'development', PORT: 3001 });
  });

  it('coerces PORT from a string', () => {
    expect(loadEnv({ PORT: '3005' }).PORT).toBe(3005);
  });

  it.each(['abc', '0', '70000', '-1', '3001.5'])('rejects PORT=%s naming the variable', (port) => {
    expect(() => loadEnv({ PORT: port })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('ignores unrelated variables', () => {
    expect(loadEnv({ HOME: '/home/x', PATH: '/bin' })).toEqual({ NODE_ENV: 'development', PORT: 3001 });
  });
});
```

For `apps/api-driver` the default port assertion is `3002`.

- [ ] **Step 2: Write the app package files**

`apps/api-admin/package.json` (no `"type"` field: the app compiles to CommonJS like the Nest 12 template):

```json
{
  "name": "@tms/api-admin",
  "version": "0.0.0",
  "private": true,
  "description": "Back-office API (admin and operator) of the TMS platform",
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "node dist/main.js",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "NODE_OPTIONS=--experimental-vm-modules jest"
  },
  "dependencies": {
    "@nestjs/common": "catalog:",
    "@nestjs/core": "catalog:",
    "@nestjs/platform-express": "catalog:",
    "reflect-metadata": "catalog:",
    "rxjs": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@nestjs/cli": "catalog:",
    "@nestjs/schematics": "catalog:",
    "@nestjs/testing": "catalog:",
    "@tms/config": "workspace:*",
    "@types/express": "catalog:",
    "@types/jest": "catalog:",
    "@types/node": "catalog:",
    "@types/supertest": "catalog:",
    "eslint": "catalog:",
    "jest": "catalog:",
    "supertest": "catalog:",
    "ts-jest": "catalog:",
    "typescript": "catalog:"
  }
}
```

`apps/api-admin/nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true, "tsConfigPath": "tsconfig.build.json" }
}
```

`apps/api-admin/tsconfig.json`:

```json
{
  "extends": "@tms/config/tsconfig/nest.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "." },
  "include": ["src", "test"]
}
```

`apps/api-admin/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "./src" },
  "include": ["src"],
  "exclude": ["node_modules", "test", "dist", "**/*.spec.ts"]
}
```

`apps/api-admin/jest.config.mjs`:

```js
import { createJestConfig } from '@tms/config/jest';

export default createJestConfig({ rootDir: import.meta.dirname });
```

`apps/api-admin/eslint.config.mjs`:

```js
import { nodeConfig } from '@tms/config/eslint/node';

export default nodeConfig({ tsconfigRootDir: import.meta.dirname });
```

`apps/api-driver/eslint.config.mjs` (the only app with the restriction):

```js
import { nodeConfig } from '@tms/config/eslint/node';

export default nodeConfig({
  tsconfigRootDir: import.meta.dirname,
  allowedDomainSubpaths: ['checkin', 'shared'],
});
```

`apps/api-admin/.env.example`:

```ini
# Back-office API. Variables are read from the process environment (e.g. `PORT=3005 pnpm dev`);
# .env loading arrives with ConfigModule in phase 1. Never commit a real .env.
NODE_ENV=development
PORT=3001
```

(`apps/api-driver/.env.example`: same with `PORT=3002` and the comment "Kiosk API".)

- [ ] **Step 3: Write the source**

`apps/api-admin/src/config/env.ts`:

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export type Env = z.infer<typeof EnvSchema>;

/** Validates process.env at startup; fails fast with every offending variable named. */
export function loadEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  return result.data;
}
```

(`api-driver`: `.default(3002)`.)

`apps/api-admin/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';

@Module({
  imports: [
    // Phase 1 slot: LoggerModule.forRoot(...) from @tms/logger must be the first import.
    // Phase 1 slot: SentryModule.forRoot() from @sentry/nestjs/setup follows the logger.
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

`apps/api-admin/src/app.ts`:

```ts
import type { INestApplication } from '@nestjs/common';

/** Applies the settings shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
```

`apps/api-admin/src/main.ts`:

```ts
// Phase 1 slot: `import './instrument';` (Sentry) must stay the first import of this file.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env);
  const app = await NestFactory.create(AppModule, {
    // Phase 1 slot: bufferLogs lets nestjs-pino take over via app.useLogger(app.get(Logger)).
    bufferLogs: true,
  });
  configureApp(app);
  await app.listen(env.PORT);
}

void bootstrap();
```

`apps/api-driver` mirrors these files (same module and bootstrap; comments say "kiosk API").

- [ ] **Step 4: Write the failing e2e-spec**

`apps/api-admin/test/app.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app';

describe('api-admin skeleton (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers an unknown /api route with a JSON 404 and no stack trace', async () => {
    const res = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Cannot GET /api/does-not-exist',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js:\d+/);
  });

  it('serves nothing outside the /api prefix', async () => {
    await request(app.getHttpServer()).get('/').expect(404);
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail, then pass**

Run: `pnpm install && pnpm --filter @tms/api-admin test`
Expected before Step 3 files exist: FAIL (cannot find module). After: PASS, 2 suites (`env.spec.ts`, `app.e2e-spec.ts`).

If Jest fails with `Must use import to load ES Module` or `Cannot use import statement outside a module` on `@nestjs/*`, confirm `NODE_OPTIONS=--experimental-vm-modules` is in the script; if it still fails, switch the ts-jest transform options in `createJestConfig` to `{ tsconfig: '<rootDir>/tsconfig.json', useESM: true }` and add `extensionsToTreatAsEsm: ['.ts']` — record the outcome in the journal.

Run: `pnpm --filter @tms/api-admin build && (PORT=3101 timeout 15 node apps/api-admin/dist/main.js &) && sleep 3 && curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3101/api/x`
Expected: `404` (the server exits by itself after 15 s).

Run: `PORT=abc node apps/api-admin/dist/main.js; echo exit=$?`
Expected: error message containing `Invalid environment: PORT` and a non-zero exit.

Repeat all of the above for `@tms/api-driver` on port 3102.

Run: `pnpm --filter @tms/api-admin --filter @tms/api-driver lint typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api-admin apps/api-driver pnpm-lock.yaml docs/efficiency/critical-path.md
git commit -m "feat(api): add api-admin and api-driver skeletons with logger and Sentry slots"
```

---

### Task 3: Vite SPA skeletons with MSW (`web-admin`, `web-driver`)

**Files:**
- Create (per app, `apps/web-admin` shown; `apps/web-driver` differs in name, port 5174, proxy target 3002 and title `TMS Kiosk`): `package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `eslint.config.mjs`, `.env.example`, `src/main.tsx`, `src/App.tsx`, `src/vite-env.d.ts`, `src/mocks/handlers.ts`, `src/mocks/browser.ts`, `src/test/setup.ts`, `public/mockServiceWorker.js` (generated)
- Test: `apps/web-admin/src/App.test.tsx`

**Interfaces:**
- Consumes: `@tms/config/tsconfig/react.json`, `react-node.json`, `reactConfig` (Task 1).
- Produces: SPA root element `<main data-testid="app-root">` (Playwright and the smoke test rely on it), document titles `TMS Admin` / `TMS Kiosk`, `handlers: HttpHandler[]` in `src/mocks/handlers.ts` (FE lanes add handlers here), env flag `VITE_ENABLE_MOCKS`.

- [ ] **Step 1: Write the failing render test**

`apps/web-admin/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('mounts the application root', () => {
    render(<App />);
    expect(screen.getByTestId('app-root')).toBeTruthy();
  });

  it('renders no user-facing text yet (all copy arrives through i18n keys in phase 6)', () => {
    const { container } = render(<App />);
    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step 2: Write the package files**

`apps/web-admin/package.json`:

```json
{
  "name": "@tms/web-admin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Back-office SPA of the TMS platform",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "typecheck": "tsc -b",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "catalog:",
    "react-dom": "catalog:"
  },
  "devDependencies": {
    "@testing-library/dom": "catalog:",
    "@testing-library/react": "catalog:",
    "@tms/config": "workspace:*",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "eslint": "catalog:",
    "jsdom": "catalog:",
    "msw": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:",
    "vitest": "catalog:"
  },
  "msw": { "workerDirectory": ["public"] }
}
```

`apps/web-admin/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TMS Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web-admin/vite.config.ts` (dev proxy implements D11 for local development):

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

(`web-driver`: `port: 5174`, target `http://localhost:3002`.)

`apps/web-admin/tsconfig.json`:

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" }]
}
```

`apps/web-admin/tsconfig.app.json`:

```json
{
  "extends": "@tms/config/tsconfig/react.json",
  "compilerOptions": { "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo" },
  "include": ["src"]
}
```

`apps/web-admin/tsconfig.node.json`:

```json
{
  "extends": "@tms/config/tsconfig/react-node.json",
  "compilerOptions": { "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo" },
  "include": ["vite.config.ts"]
}
```

`apps/web-admin/eslint.config.mjs`:

```js
import { reactConfig } from '@tms/config/eslint/react';

export default reactConfig({ tsconfigRootDir: import.meta.dirname });
```

`apps/web-admin/.env.example`:

```ini
# Set to true to serve API responses from MSW handlers (src/mocks) instead of the backend.
VITE_ENABLE_MOCKS=false
```

- [ ] **Step 3: Write the source**

`apps/web-admin/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_MOCKS?: string;
}
```

`apps/web-admin/src/App.tsx`:

```tsx
/**
 * Application root. Deliberately empty in phase 0: the first screens arrive in phase 6
 * together with the design system and i18n (every string through a key).
 */
export function App() {
  return <main data-testid="app-root" />;
}
```

`apps/web-admin/src/mocks/handlers.ts`:

```ts
import type { HttpHandler } from 'msw';

/** Request handlers used when VITE_ENABLE_MOCKS=true. FE lanes add handlers per contract. */
export const handlers: HttpHandler[] = [];
```

`apps/web-admin/src/mocks/browser.ts`:

```ts
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
```

`apps/web-admin/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

async function enableMocking(): Promise<void> {
  if (import.meta.env.VITE_ENABLE_MOCKS !== 'true') return;
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass' });
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

void enableMocking().then(() => {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
```

`apps/web-admin/src/test/setup.ts`:

```ts
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
```

Generate the service worker (commits `public/mockServiceWorker.js`, as MSW recommends):

```bash
pnpm --filter @tms/web-admin exec msw init public --save
pnpm --filter @tms/web-driver exec msw init public --save
```

`apps/web-driver` mirrors everything with `TMS Kiosk`, port 5174 and proxy target 3002.

- [ ] **Step 4: Run the tests and builds**

Run: `pnpm install && pnpm --filter @tms/web-admin --filter @tms/web-driver test`
Expected: 2 passed per app.

Run: `pnpm --filter @tms/web-admin --filter @tms/web-driver build lint typecheck`
Expected: exit 0, `apps/web-admin/dist/index.html` contains `<title>TMS Admin</title>`.

Run (dev proxy check, API from Task 2 built): `(timeout 25 node apps/api-admin/dist/main.js &) && (cd apps/web-admin && timeout 25 pnpm exec vite &) && sleep 6 && curl -s http://localhost:5173/api/nope`
Expected: the Nest JSON 404 body (`"statusCode":404`), not HTML; both processes exit by themselves.

- [ ] **Step 5: Commit**

```bash
git add apps/web-admin apps/web-driver pnpm-lock.yaml docs/efficiency/critical-path.md
git commit -m "feat(web): add web-admin and web-driver Vite skeletons with MSW and dev API proxy"
```

---

### Task 4: Prisma `db` package skeleton

**Files:**
- Create: `packages/db/package.json`, `packages/db/prisma.config.ts`, `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/migration_lock.toml`, `packages/db/.env.example`, `packages/db/tsconfig.json`, `packages/db/eslint.config.mjs`

**Interfaces:**
- Consumes: catalog `prisma`, `dotenv` (Task 1).
- Produces: scripts `db:validate`, `db:migrate:dev`, `db:migrate:deploy`, `db:migrate:status`, `db:drift`; env `DATABASE_URL`; `prisma/migrations/` directory that the compose `migrate` service (Task 5a) and CI drift job (Task 9) consume. Phase 1 adds models, the generated client, `PrismaService` and the permission sync.

- [ ] **Step 1: Write the package**

`packages/db/package.json` (`prisma` is a runtime dependency here on purpose: the `migrate` container runs the CLI):

```json
{
  "name": "@tms/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Prisma schema, migrations and database access for the TMS platform",
  "scripts": {
    "db:validate": "prisma validate",
    "db:migrate:dev": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:migrate:status": "prisma migrate status",
    "db:drift": "prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "prisma validate"
  },
  "dependencies": {
    "dotenv": "catalog:",
    "prisma": "catalog:"
  },
  "devDependencies": {
    "@tms/config": "workspace:*",
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "typescript": "catalog:"
  }
}
```

`packages/db/prisma.config.ts` (Prisma 7 moved the datasource URL out of the schema; `dotenv/config` loads `packages/db/.env` locally, containers pass `DATABASE_URL` directly. Prisma's own `env()` helper throws **eagerly** at config load, which would break `prisma validate` in `turbo run test` wherever the variable is unset; `datasource` is optional for `validate`/`generate` and required for migration commands, so it is set only when the variable exists and Prisma itself reports the missing datasource for `migrate`):

```ts
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// DATABASE_URL: required by migrate/introspection commands, optional for validate/generate.
const url = process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(url ? { datasource: { url } } : {}),
});
```

`packages/db/prisma/schema.prisma` (no models in phase 0; the generator block is configured now so phase 1 only adds models):

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../generated/client"
  moduleFormat = "esm"
}

datasource db {
  provider = "postgresql"
}
```

`packages/db/prisma/migrations/migration_lock.toml`:

```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., Git)
provider = "postgresql"
```

`packages/db/.env.example`:

```ini
DATABASE_URL=postgresql://tms:tms@localhost:5432/tms
```

`packages/db/tsconfig.json`:

```json
{
  "extends": "@tms/config/tsconfig/library.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["prisma.config.ts"]
}
```

`packages/db/eslint.config.mjs`:

```js
import { nodeConfig } from '@tms/config/eslint/node';

export default nodeConfig({ tsconfigRootDir: import.meta.dirname });
```

- [ ] **Step 2: Verify without a database**

Run (deliberately **without** `packages/db/.env` and with `DATABASE_URL` unset, as in the CI `verify` job): `pnpm install && env -u DATABASE_URL pnpm --filter @tms/db test lint typecheck`
Expected: `prisma validate` prints "The schema ... is valid"; lint and typecheck exit 0.

Run: `env -u DATABASE_URL pnpm --filter @tms/db db:migrate:deploy; echo exit=$?`
Expected: Prisma's missing-datasource error, non-zero exit, no connection attempt to any default.

Then `cp packages/db/.env.example packages/db/.env` for local work. (If the installed Prisma prints a config-loading error, run `pnpm --filter @tms/db exec prisma init --help` and align `prisma.config.ts` with the CLI's documented shape; the acceptance criteria are unchanged.)

- [ ] **Step 3: Verify against Postgres (throwaway container)**

```bash
docker run -d --rm --name tms-db-check -e POSTGRES_USER=tms -e POSTGRES_PASSWORD=tms -e POSTGRES_DB=tms -p 55432:5432 postgres:16-alpine
sleep 5
DATABASE_URL=postgresql://tms:tms@localhost:55432/tms pnpm --filter @tms/db db:migrate:deploy
DATABASE_URL=postgresql://tms:tms@localhost:55432/tms pnpm --filter @tms/db db:drift; echo "drift exit=$?"
docker stop tms-db-check
```

Expected: `migrate deploy` reports no pending migrations and exits 0; `db:drift` exits 0 (empty schema equals empty database). Exit code 2 would mean drift.

- [ ] **Step 4: Commit**

```bash
git add packages/db pnpm-lock.yaml docs/efficiency/critical-path.md
git commit -m "feat(db): add Prisma 7 package skeleton with migration and drift scripts"
```

---

### Task 5a: docker-compose default profile (postgres, mailpit, migrate) and smoke test

**Files:**
- Create: `infra/docker-compose.yml` (all services, `full` profile included; its images are built in Task 5b), `infra/.env.example`, `infra/smoke.sh`, `infra/docker/migrate.Dockerfile`, `.dockerignore`
- Modify: `package.json` (root) — add `"predev": "pnpm --filter @tms/db db:migrate:deploy"` (D12; phase 1 changes it to `migrate dev` + permission sync)

**Interfaces:**
- Consumes: `@tms/db` scripts and `prisma.config.ts` (Task 4).
- Produces: default profile = `postgres`, `mailpit`, `migrate`; `infra/smoke.sh [--full]` used by developers and CI (`--full` is exercised in Task 5b). Env file `infra/.env` (from `infra/.env.example`) read by compose because the project directory is the compose file's directory. Profile `test` (shortened lockouts) is added in phase 2 when lockout exists.

- [ ] **Step 1: Write the compose file and env example**

`infra/.env.example`:

```ini
POSTGRES_PASSWORD=tms
POSTGRES_PORT=5432
MAILPIT_UI_PORT=8025
MAILPIT_SMTP_PORT=1025
CADDY_ADMIN_PORT=8080
CADDY_KIOSK_PORT=8081
```

`infra/docker-compose.yml`:

```yaml
name: tms

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: tms
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-tms}
      POSTGRES_DB: tms
    ports:
      - '${POSTGRES_PORT:-5432}:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U tms -d tms']
      interval: 5s
      timeout: 3s
      retries: 12

  mailpit:
    image: axllent/mailpit:v1.31
    ports:
      - '${MAILPIT_UI_PORT:-8025}:8025'
      - '${MAILPIT_SMTP_PORT:-1025}:1025'
    healthcheck:
      test: ['CMD', '/mailpit', 'readyz']
      interval: 5s
      timeout: 3s
      retries: 12

  # One-shot: applies migrations (phase 1 adds the permission sync). Never runs inside an app (D12).
  migrate:
    build:
      context: ..
      dockerfile: infra/docker/migrate.Dockerfile
    environment:
      DATABASE_URL: postgresql://tms:${POSTGRES_PASSWORD:-tms}@postgres:5432/tms
    depends_on:
      postgres:
        condition: service_healthy
    restart: 'no'

  api-admin:
    profiles: [full]
    build:
      context: ..
      dockerfile: infra/docker/api.Dockerfile
      args:
        APP: api-admin
    environment:
      NODE_ENV: production
      PORT: '3001'
      DATABASE_URL: postgresql://tms:${POSTGRES_PASSWORD:-tms}@postgres:5432/tms
    depends_on:
      migrate:
        condition: service_completed_successfully

  api-driver:
    profiles: [full]
    build:
      context: ..
      dockerfile: infra/docker/api.Dockerfile
      args:
        APP: api-driver
    environment:
      NODE_ENV: production
      PORT: '3002'
      DATABASE_URL: postgresql://tms:${POSTGRES_PASSWORD:-tms}@postgres:5432/tms
    depends_on:
      migrate:
        condition: service_completed_successfully

  # Single origin per application (D11): serves the SPA and forwards /api to its API.
  caddy:
    profiles: [full]
    build:
      context: ..
      dockerfile: infra/docker/web.Dockerfile
    ports:
      - '${CADDY_ADMIN_PORT:-8080}:8080'
      - '${CADDY_KIOSK_PORT:-8081}:8081'
    depends_on:
      - api-admin
      - api-driver

volumes:
  pgdata:
```

- [ ] **Step 2: Write `.dockerignore` and the migrate image**

`.dockerignore` (repository root; keeps client documents, secrets and caches out of every build context. Workspace packages such as `e2e/` and `tools/` stay in the context because `pnpm install --frozen-lockfile` needs every importer listed in the lockfile to exist):

```
.git
node_modules
**/node_modules
**/dist
**/coverage
**/.turbo
**/generated
.cache
docs
**/playwright-report
**/test-results
**/.env
**/.env.*
!**/.env.example
```

`infra/docker/migrate.Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@12.5.1
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@tms/db..."
RUN pnpm --filter "@tms/db" deploy --legacy /out

FROM node:24-bookworm-slim AS runtime
# Prisma's schema engine needs OpenSSL on Debian slim images.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /out .
USER node
# Phase 1 appends the permission sync: node dist/sync-permissions.js
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]
```

- [ ] **Step 3: Write the smoke script**

`infra/smoke.sh` (`chmod +x`):

```bash
#!/usr/bin/env bash
# Smoke test for the compose stack. Usage: infra/smoke.sh [--full]
# Default profile: postgres, mailpit, migrate. --full: also api-admin, api-driver, caddy.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
[ -f .env ] && set -a && . ./.env && set +a

compose() { docker compose -f docker-compose.yml "$@"; }
fail() { echo "FAIL $*" >&2; exit 1; }

wait_http() { # name url
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$2"; then echo "ok   $1 reachable ($2)"; return 0; fi
    sleep 2
  done
  fail "$1 not reachable at $2"
}

# 1. migrate is a one-shot service: it must exit 0.
for _ in $(seq 1 60); do
  cid=$(compose ps -aq migrate)
  state=$(docker inspect --format '{{.State.Status}}:{{.State.ExitCode}}' "$cid" 2>/dev/null || echo missing)
  case "$state" in
    exited:0) echo "ok   migrate exited 0"; break ;;
    exited:*) compose logs migrate; fail "migrate $state" ;;
  esac
  sleep 2
done
[ "$state" = "exited:0" ] || fail "migrate did not finish (state $state)"

# 2. mailpit API answers.
wait_http mailpit "http://localhost:${MAILPIT_UI_PORT:-8025}/api/v1/info"

if [ "${1:-}" = "--full" ]; then
  check_origin() { # name port title
    wait_http "$1" "http://localhost:$2/"
    curl -fsS "http://localhost:$2/" | grep -q "<title>$3</title>" || fail "$1: title '$3' not served"
    echo "ok   $1 serves the SPA"
    # Caddy starts before Nest has bound its port (depends_on = started), so retry until the API answers.
    code=""
    for _ in $(seq 1 30); do
      code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$2/api/does-not-exist")
      [ "$code" = "404" ] && break
      sleep 2
    done
    [ "$code" = "404" ] || fail "$1: /api answered $code, expected 404 from the API"
    body=$(curl -sS "http://localhost:$2/api/does-not-exist")
    echo "$body" | grep -q '"statusCode":404' || fail "$1: /api did not reach the API (got: $body)"
    echo "ok   $1 forwards /api to the API (JSON 404, not index.html)"
  }
  check_origin web-admin "${CADDY_ADMIN_PORT:-8080}" "TMS Admin"
  check_origin web-driver "${CADDY_KIOSK_PORT:-8081}" "TMS Kiosk"
fi

echo "smoke: all checks passed"
```

- [ ] **Step 4: Run the default profile**

```bash
cp infra/.env.example infra/.env
pnpm compose config -q && echo "compose file valid"
pnpm compose up -d --build
infra/smoke.sh
```

Expected: `ok   migrate exited 0`, `ok   mailpit reachable`, `smoke: all checks passed`. If the Mailpit healthcheck command is rejected, replace it with `['CMD', 'wget', '-qO-', 'http://localhost:8025/api/v1/info']` and record it.

Negative check (migrations gate the database consumers): `pnpm compose down -v && POSTGRES_PASSWORD=wrong pnpm compose up -d postgres mailpit && pnpm compose run --rm -e DATABASE_URL=postgresql://tms:not-the-password@postgres:5432/tms migrate; echo exit=$?` → the migrate run exits non-zero with an authentication error, and `service_completed_successfully` in the compose file means the `full` profile apps would never start after such a failure. Then `pnpm compose down -v && pnpm compose up -d --build && infra/smoke.sh` to restore the stack.

If `pnpm --filter @tms/db deploy --legacy` is rejected by pnpm 12, drop `--legacy` and add `injectWorkspacePackages: true` to `pnpm-workspace.yaml`; the acceptance criterion is unchanged.

- [ ] **Step 5: Add `predev` and commit**

Root `package.json` scripts: add `"predev": "pnpm --filter @tms/db db:migrate:deploy"` right before `"dev"`.

```bash
git add infra .dockerignore package.json docs/efficiency/critical-path.md
git commit -m "build(infra): add compose default profile, migrate image and smoke test"
```

---

### Task 5b: docker-compose `full` profile: API images, SPA images behind Caddy

**Files:**
- Create: `infra/docker/api.Dockerfile`, `infra/docker/web.Dockerfile`, `infra/docker/Caddyfile`

**Interfaces:**
- Consumes: compose services `api-admin`, `api-driver`, `caddy` already declared in Task 5a; `@tms/api-*` `dist/main.js` on `PORT` (Task 2); `@tms/web-*` `dist/` and titles (Task 3); `infra/smoke.sh --full` (Task 5a).
- Produces: admin origin `http://localhost:${CADDY_ADMIN_PORT:-8080}`, kiosk origin `http://localhost:${CADDY_KIOSK_PORT:-8081}`; `/api/*` forwarded to the matching API (D11). Used by Task 6 (Playwright), the `e2e` CI job and Task 12.

- [ ] **Step 1: Write the API image, the web image and the Caddyfile**

`infra/docker/api.Dockerfile` (one Dockerfile for both APIs, selected by `APP`):

```dockerfile
# syntax=docker/dockerfile:1.7
ARG APP
FROM node:24-bookworm-slim AS build
ARG APP
RUN npm install -g pnpm@12.5.1
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@tms/${APP}..."
RUN pnpm --filter "@tms/${APP}" build \
 && pnpm --filter "@tms/${APP}" deploy --legacy --prod /out

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
USER node
CMD ["node", "dist/main.js"]
```

`infra/docker/web.Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@12.5.1
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@tms/web-admin..." --filter "@tms/web-driver..."
RUN pnpm --filter "@tms/web-admin" --filter "@tms/web-driver" build

FROM caddy:2-alpine
COPY infra/docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web-admin/dist /srv/web-admin
COPY --from=build /repo/apps/web-driver/dist /srv/web-driver
```

`infra/docker/Caddyfile`:

```
{
	auto_https off
	admin off
}

# Back-office: SPA + /api -> api-admin (single origin, D11)
:8080 {
	encode gzip
	handle /api/* {
		reverse_proxy api-admin:3001
	}
	handle {
		root * /srv/web-admin
		try_files {path} /index.html
		file_server
	}
}

# Kiosk: SPA + /api -> api-driver
:8081 {
	encode gzip
	handle /api/* {
		reverse_proxy api-driver:3002
	}
	handle {
		root * /srv/web-driver
		try_files {path} /index.html
		file_server
	}
}
```

- [ ] **Step 2: Run the full profile**

```bash
pnpm compose --profile full up -d --build
infra/smoke.sh --full
```

Expected: both origins serve their SPA titles, `/api/does-not-exist` returns the Nest JSON 404 (after the retry loop), and a deep link such as `curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/some/route` prints `200`. Leave the stack running for Task 6. If `pnpm --filter X deploy --legacy --prod` is rejected by pnpm 12, drop `--legacy` and add `injectWorkspacePackages: true` to `pnpm-workspace.yaml`; the acceptance criterion is unchanged.

- [ ] **Step 3: Commit**

```bash
git add infra/docker docs/efficiency/critical-path.md
git commit -m "build(infra): add API and web images with Caddy single-origin proxy (full profile)"
```

---

### Task 6: Playwright skeleton

**Files:**
- Create: `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/tsconfig.json`, `e2e/eslint.config.mjs`, `e2e/tests/web-admin/smoke.spec.ts`, `e2e/tests/web-driver/smoke.spec.ts`, `e2e/README.md`

**Interfaces:**
- Consumes: compose `full` origins (Task 5b), `data-testid="app-root"` and titles (Task 3).
- Produces: `pnpm e2e` (root) runs both Playwright projects; env `E2E_ADMIN_URL`, `E2E_DRIVER_URL` default to the Caddy origins. `install-browsers` installs Chromium only (no OS packages, so no `sudo` prompt on a developer machine); CI installs with `--with-deps`. Helpers (Mailpit, TOTP, seed API) are added by the QA lane when the flows exist.

- [ ] **Step 1: Write the package and config**

`e2e/package.json` (no `test` script on purpose: `turbo run test` must never start Playwright, which needs the compose stack; the root `pnpm e2e` script calls `e2e`):

```json
{
  "name": "@tms/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Playwright end-to-end tests for web-admin and web-driver",
  "scripts": {
    "e2e": "playwright test",
    "e2e:ui": "playwright test --ui",
    "install-browsers": "playwright install chromium",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "@playwright/test": "catalog:",
    "@tms/config": "workspace:*",
    "@types/node": "catalog:",
    "eslint": "catalog:",
    "typescript": "catalog:"
  }
}
```

`e2e/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

const adminUrl = process.env['E2E_ADMIN_URL'] ?? 'http://localhost:8080';
const driverUrl = process.env['E2E_DRIVER_URL'] ?? 'http://localhost:8081';
const ci = Boolean(process.env['CI']);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'web-admin',
      testDir: './tests/web-admin',
      use: { ...devices['Desktop Chrome'], baseURL: adminUrl },
    },
    {
      name: 'web-driver',
      testDir: './tests/web-driver',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: driverUrl,
        viewport: { width: 1280, height: 1024 },
        hasTouch: true,
      },
    },
  ],
});
```

`e2e/tsconfig.json`:

```json
{
  "extends": "@tms/config/tsconfig/library.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true, "types": ["node"] },
  "include": ["playwright.config.ts", "tests"]
}
```

`e2e/eslint.config.mjs`:

```js
import { nodeConfig } from '@tms/config/eslint/node';

export default nodeConfig({ tsconfigRootDir: import.meta.dirname });
```

- [ ] **Step 2: Write the smoke specs**

`e2e/tests/web-admin/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.describe('web-admin smoke', () => {
  test('serves the SPA on the admin origin', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('TMS Admin');
    await expect(page.getByTestId('app-root')).toBeAttached();
  });

  test('forwards /api to api-admin on the same origin (D11)', async ({ request }) => {
    const res = await request.get('/api/does-not-exist');
    expect(res.status()).toBe(404);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(await res.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });

  test('deep links fall back to the SPA, not to a 404', async ({ page }) => {
    const res = await page.goto('/some/client/route');
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId('app-root')).toBeAttached();
  });
});
```

`e2e/tests/web-driver/smoke.spec.ts`: identical with `TMS Kiosk` and the kiosk origin.

`e2e/README.md`:

```markdown
# End-to-end tests

Playwright projects `web-admin` and `web-driver` run against the compose `full` profile
(`pnpm compose --profile full up -d --build && infra/smoke.sh --full`), the same topology as
production: Caddy serves each SPA and forwards `/api` to its API on one origin.

- `pnpm --filter @tms/e2e install-browsers` once per machine.
- `pnpm e2e` runs everything; `E2E_ADMIN_URL` / `E2E_DRIVER_URL` override the origins.
- Traces and screenshots are kept on failure (`playwright-report/`, `test-results/`).
- Every test creates its own users, cards and orders (from phase 2 on) so tests can run in parallel.
```

- [ ] **Step 3: Run**

```bash
pnpm install
pnpm --filter @tms/e2e install-browsers
pnpm compose --profile full up -d --build && infra/smoke.sh --full
pnpm e2e
pnpm --filter @tms/e2e lint typecheck
```

Expected: 6 passed (3 per project); lint and typecheck exit 0. Leave the stack running for Task 12 or stop it with `pnpm compose --profile full down`.

- [ ] **Step 4: Commit**

```bash
git add e2e pnpm-lock.yaml docs/efficiency/critical-path.md
git commit -m "test(e2e): add Playwright skeleton with smoke specs against the compose full profile"
```

---

### Task 7: Hygiene and gitleaks scripts

**Files:**
- Create: `tools/scripts/package.json`, `tools/scripts/check-hygiene.mjs`, `tools/scripts/gitleaks.sh`, `tools/scripts/gitleaks.test.sh`, `tools/scripts/eslint.config.mjs`, `tools/scripts/vitest.config.mjs`, `.gitleaks.toml`
- Create (local only, gitignored by `docs/client/*`): `docs/client/forbidden-terms.txt` — one term per line: every spelling of the client's name that appears in the client documents' file names and text (ASCII and diacritic variants); Stefan owns this list.
- Modify: `docs/client/README.md` — one paragraph describing `forbidden-terms.txt` and the `FORBIDDEN_TERMS` CI secret (this is the last edit to that folder before Task 10a's hook and Task 10b's deny rule protect it).
- Test: `tools/scripts/check-hygiene.test.mjs`

**Interfaces:**
- Consumes: `git ls-files`, `git grep`, root `CLAUDE.md` (Task 11; the check tolerates a missing file until then), `docs/client/forbidden-terms.txt` or env `FORBIDDEN_TERMS` (newline- or comma-separated).
- Produces: `node tools/scripts/check-hygiene.mjs [--staged]` (exit 1 with one line per problem; `--staged` greps the index for the pre-commit hook), `tools/scripts/gitleaks.sh <gitleaks args>` (pinned 8.30.1, checksum-verified, cached in `.cache/gitleaks/`), `findForbiddenDocuments(files: string[]): string[]`, `claudeMdLineCount(text: string): number`, `parseForbiddenTerms(text: string): string[]`, `gitGrepForbidden({ repoRoot, terms, staged }): string[]` (returns `file:line`, never the matched text), `runHygiene({ trackedFiles, claudeMd, forbiddenHits }): string[]`. Used by root `pnpm hygiene`, the pre-commit hook (Task 8) and CI (Task 9).

- [ ] **Step 1: Write the failing hygiene tests**

`tools/scripts/check-hygiene.test.mjs`:

```js
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_MD_MAX_LINES,
  findForbiddenDocuments,
  gitGrepForbidden,
  parseForbiddenTerms,
  runHygiene,
} from './check-hygiene.mjs';

describe('parseForbiddenTerms', () => {
  it('splits on newlines and commas, trims, drops blanks and comments', () => {
    expect(parseForbiddenTerms('# client names\nAcme\n acme corp ,ACME-X\n\n')).toEqual(['Acme', 'acme corp', 'ACME-X']);
  });
  it('returns an empty list for empty input', () => {
    expect(parseForbiddenTerms('')).toEqual([]);
  });
});

describe('gitGrepForbidden', () => {
  function tempRepo() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hyg-'));
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 't');
    return { dir, git };
  }

  it('reports file:line of a tracked hit, case-insensitively and word-bounded, without the text', () => {
    const { dir, git } = tempRepo();
    writeFileSync(path.join(dir, 'a.md'), 'first line\nBuilt for ZORGCORP in 2026\nzorgcorporation is a different word\n');
    git('add', 'a.md');
    git('commit', '-qm', 'x');
    const hits = gitGrepForbidden({ repoRoot: dir, terms: ['zorgcorp'], staged: false });
    expect(hits).toEqual(['a.md:2']);
  });

  it('ignores docs/client and returns nothing when nothing matches', () => {
    const { dir, git } = tempRepo();
    writeFileSync(path.join(dir, 'clean.md'), 'nothing here\n');
    execFileSync('mkdir', ['-p', path.join(dir, 'docs/client')]);
    writeFileSync(path.join(dir, 'docs/client/README.md'), 'zorgcorp appears here legitimately\n');
    git('add', '.');
    git('commit', '-qm', 'x');
    expect(gitGrepForbidden({ repoRoot: dir, terms: ['zorgcorp'], staged: false })).toEqual([]);
  });

  it('greps staged content with staged: true and skips git entirely without terms', () => {
    const { dir, git } = tempRepo();
    writeFileSync(path.join(dir, 'b.ts'), '// zorgcorp\n');
    git('add', 'b.ts');
    expect(gitGrepForbidden({ repoRoot: dir, terms: ['zorgcorp'], staged: true })).toEqual(['b.ts:1']);
    expect(gitGrepForbidden({ repoRoot: '/nonexistent', terms: [], staged: true })).toEqual([]);
  });
});

describe('findForbiddenDocuments', () => {
  it('flags pdf, pptx and docx outside docs/client regardless of case', () => {
    const files = ['README.md', 'docs/spec.PDF', 'apps/x/deck.pptx', 'notes/a.Docx', 'src/a.ts'];
    expect(findForbiddenDocuments(files)).toEqual(['docs/spec.PDF', 'apps/x/deck.pptx', 'notes/a.Docx']);
  });

  it('allows documents anywhere under docs/client/', () => {
    expect(findForbiddenDocuments(['docs/client/a.pdf', 'docs/client/sub/b.docx'])).toEqual([]);
  });

  it('does not flag look-alike names', () => {
    expect(findForbiddenDocuments(['report.pdf.txt', 'docs/clientele/x.pdf.md', 'pdfkit.ts'])).toEqual([]);
  });
});

describe('runHygiene', () => {
  it('reports nothing for a clean repository', () => {
    expect(runHygiene({ trackedFiles: ['a.ts'], claudeMd: 'short\n' })).toEqual([]);
  });

  it('reports an over-long CLAUDE.md with its line count', () => {
    const claudeMd = Array.from({ length: CLAUDE_MD_MAX_LINES + 1 }, (_, i) => `line ${i}`).join('\n');
    const problems = runHygiene({ trackedFiles: [], claudeMd });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`CLAUDE.md has ${CLAUDE_MD_MAX_LINES + 1} lines`));
  });

  it('tolerates a missing CLAUDE.md', () => {
    expect(runHygiene({ trackedFiles: [], claudeMd: null })).toEqual([]);
  });

  it('reports every forbidden document on its own line', () => {
    const problems = runHygiene({ trackedFiles: ['x.pdf', 'y.docx'], claudeMd: '' });
    expect(problems).toEqual([
      'client-type document outside docs/client/: x.pdf',
      'client-type document outside docs/client/: y.docx',
    ]);
  });

  it('reports forbidden-term hits by location only', () => {
    const problems = runHygiene({ trackedFiles: [], claudeMd: '', forbiddenHits: ['README.md:12', 'docs/adr/0001.md:3'] });
    expect(problems).toEqual([
      'forbidden term (client name) at README.md:12',
      'forbidden term (client name) at docs/adr/0001.md:3',
    ]);
  });
});
```

- [ ] **Step 2: Write the hygiene script and package**

`tools/scripts/package.json`:

```json
{
  "name": "@tms/scripts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Repository hygiene and tooling scripts",
  "scripts": {
    "lint": "eslint .",
    "test": "vitest run && bash gitleaks.test.sh"
  },
  "devDependencies": {
    "@tms/config": "workspace:*",
    "eslint": "catalog:",
    "vitest": "catalog:"
  }
}
```

`tools/scripts/vitest.config.mjs`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['*.test.mjs'] } });
```

`tools/scripts/eslint.config.mjs`:

```js
import { nodeConfig } from '@tms/config/eslint/node';

export default nodeConfig({ tsconfigRootDir: import.meta.dirname });
```

`tools/scripts/check-hygiene.mjs`:

```js
#!/usr/bin/env node
/**
 * Repository hygiene (spec sections 13 and 14; public repository):
 *  - no *.pdf|*.pptx|*.docx tracked outside docs/client/,
 *  - CLAUDE.md stays short,
 *  - no forbidden term (the client's name) in tracked text; terms come from the gitignored
 *    docs/client/forbidden-terms.txt and/or the FORBIDDEN_TERMS env (CI secret). The term itself
 *    is never printed. `--staged` greps the index instead of the working tree (pre-commit).
 * Exit 1 with one line per problem.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_DOCUMENT_RE = /\.(pdf|pptx|docx)$/i;
export const CLIENT_DOCS_DIR = 'docs/client/';
export const CLAUDE_MD_MAX_LINES = 150;
export const FORBIDDEN_TERMS_FILE = 'docs/client/forbidden-terms.txt';

/** @param {string[]} trackedFiles */
export function findForbiddenDocuments(trackedFiles) {
  return trackedFiles.filter((f) => FORBIDDEN_DOCUMENT_RE.test(f) && !f.startsWith(CLIENT_DOCS_DIR));
}

/** @param {string} text */
export function claudeMdLineCount(text) {
  return text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
}

/** @param {string} text newline- or comma-separated terms; `#` starts a comment line */
export function parseForbiddenTerms(text) {
  return [...new Set(text.split(/[\n,]/).map((t) => t.trim()).filter((t) => t && !t.startsWith('#')))];
}

/**
 * Word-bounded, case-insensitive fixed-string search over tracked text (or the index).
 * @param {{ repoRoot: string, terms: string[], staged: boolean }} input
 * @returns {string[]} `file:line` locations, never the matched text
 */
export function gitGrepForbidden({ repoRoot, terms, staged }) {
  if (terms.length === 0) return [];
  const args = ['grep', '-I', '-n', '-i', '-w', '-F'];
  if (staged) args.push('--cached');
  for (const term of terms) args.push('-e', term);
  args.push('--', '.', `:(exclude)${CLIENT_DOCS_DIR}`);
  try {
    const out = execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [file, lineNo] = line.split(':');
        return `${file}:${lineNo}`;
      });
  } catch (error) {
    if (error && error.status === 1) return []; // git grep: no match
    throw error;
  }
}

/** @param {{ trackedFiles: string[], claudeMd: string | null, forbiddenHits?: string[] }} input */
export function runHygiene({ trackedFiles, claudeMd, forbiddenHits = [] }) {
  const problems = findForbiddenDocuments(trackedFiles).map(
    (f) => `client-type document outside docs/client/: ${f}`,
  );
  if (claudeMd !== null) {
    const lines = claudeMdLineCount(claudeMd);
    if (lines > CLAUDE_MD_MAX_LINES) {
      problems.push(`CLAUDE.md has ${lines} lines (max ${CLAUDE_MD_MAX_LINES}); move detail into docs/`);
    }
  }
  for (const hit of forbiddenHits) problems.push(`forbidden term (client name) at ${hit}`);
  return problems;
}

function main() {
  const staged = process.argv.includes('--staged');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const claudeMdPath = path.join(repoRoot, 'CLAUDE.md');
  const claudeMd = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf8') : null;

  const termsPath = path.join(repoRoot, FORBIDDEN_TERMS_FILE);
  const terms = parseForbiddenTerms(
    [process.env['FORBIDDEN_TERMS'] ?? '', existsSync(termsPath) ? readFileSync(termsPath, 'utf8') : ''].join('\n'),
  );
  if (terms.length === 0) {
    console.warn(`hygiene: forbidden-terms check skipped (no ${FORBIDDEN_TERMS_FILE} and no FORBIDDEN_TERMS)`);
  }
  const forbiddenHits = gitGrepForbidden({ repoRoot, terms, staged });

  const problems = runHygiene({ trackedFiles, claudeMd, forbiddenHits });
  for (const p of problems) console.error(`hygiene: ${p}`);
  if (problems.length > 0) process.exit(1);
  console.log(`hygiene: ok (${trackedFiles.length} tracked files, ${terms.length} forbidden terms${staged ? ', staged' : ''})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 3: Run the hygiene tests**

Run: `pnpm install && pnpm --filter @tms/scripts exec vitest run`
Expected: 13 passed (2 parse, 3 git grep, 3 documents, 5 runHygiene).

Create `docs/client/forbidden-terms.txt` (gitignored; the client name spellings, one per line) and add the paragraph to `docs/client/README.md`. Then:

Run: `node tools/scripts/check-hygiene.mjs; echo exit=$?`
Expected: `hygiene: ok (... tracked files, N forbidden terms)`, exit 0 — the tracked text is clean today (verified by the critic pass with a word-bounded grep).

Run: `printf 'the client is %s\n' "$(head -1 docs/client/forbidden-terms.txt)" > /tmp/leak.md && cp /tmp/leak.md docs/leak-demo.md && git add docs/leak-demo.md && node tools/scripts/check-hygiene.mjs --staged; echo exit=$?; git rm -q --cached docs/leak-demo.md && rm docs/leak-demo.md /tmp/leak.md`
Expected: `hygiene: forbidden term (client name) at docs/leak-demo.md:1`, exit 1, and the term itself does not appear in the output.

- [ ] **Step 4: Write the gitleaks wrapper and its test**

`tools/scripts/gitleaks.sh` (`chmod +x`):

```bash
#!/usr/bin/env bash
# Runs a pinned, checksum-verified gitleaks. Downloads once into .cache/gitleaks/<version>/.
# Usage: tools/scripts/gitleaks.sh <gitleaks arguments>
# Env: GITLEAKS_BASE_URL overrides the release URL (used by the test).
set -euo pipefail

VERSION="8.30.1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CACHE_DIR="${GITLEAKS_CACHE_DIR:-$ROOT/.cache/gitleaks/$VERSION}"
BIN="$CACHE_DIR/gitleaks"
BASE_URL="${GITLEAKS_BASE_URL:-https://github.com/gitleaks/gitleaks/releases/download/v$VERSION}"

if [ ! -x "$BIN" ]; then
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    x86_64) arch="x64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) echo "gitleaks.sh: unsupported architecture $arch" >&2; exit 1 ;;
  esac
  asset="gitleaks_${VERSION}_${os}_${arch}.tar.gz"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "gitleaks.sh: downloading $asset" >&2
  curl -fsSL "$BASE_URL/$asset" -o "$tmp/$asset"
  curl -fsSL "$BASE_URL/gitleaks_${VERSION}_checksums.txt" -o "$tmp/checksums.txt"
  if ! (cd "$tmp" && grep " $asset\$" checksums.txt | sha256sum -c - >/dev/null); then
    echo "gitleaks.sh: checksum verification FAILED for $asset; refusing to install" >&2
    exit 1
  fi
  mkdir -p "$CACHE_DIR"
  tar -xzf "$tmp/$asset" -C "$CACHE_DIR" gitleaks
fi

exec "$BIN" "$@"
```

`tools/scripts/gitleaks.test.sh`:

```bash
#!/usr/bin/env bash
# Tests for gitleaks.sh: install (from the repo cache when present, otherwise download), offline
# reuse, tampered checksum. Runs inside `turbo run test`, so it avoids the network whenever the
# repository cache (.cache/gitleaks/8.30.1) already holds the binary.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SCRIPT="$HERE/gitleaks.sh"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
pass() { echo "ok   $1"; }
fail() { echo "FAIL $1" >&2; exit 1; }

# 1. install path: seed from the repository cache if present (no network), else download + verify
if [ -x "$ROOT/.cache/gitleaks/8.30.1/gitleaks" ]; then
  mkdir -p "$work/cache" && cp "$ROOT/.cache/gitleaks/8.30.1/gitleaks" "$work/cache/gitleaks"
fi
out="$(GITLEAKS_CACHE_DIR="$work/cache" "$SCRIPT" version)"
[ "$out" = "8.30.1" ] || fail "expected version 8.30.1, got '$out'"
pass "installs and runs the pinned version"

# 2. cached binary is reused without network
out="$(GITLEAKS_CACHE_DIR="$work/cache" GITLEAKS_BASE_URL="http://127.0.0.1:9/unreachable" "$SCRIPT" version)"
[ "$out" = "8.30.1" ] || fail "cached binary not reused"
pass "reuses the cached binary offline"

# 3. tampered checksum: refuses to install, leaves no binary
mkdir -p "$work/release"
asset="gitleaks_8.30.1_$(uname -s | tr '[:upper:]' '[:lower:]')_x64.tar.gz"
cp "$work/cache/gitleaks" "$work/gitleaks" && (cd "$work" && tar -czf "release/$asset" gitleaks)
echo "0000000000000000000000000000000000000000000000000000000000000000  $asset" > "$work/release/gitleaks_8.30.1_checksums.txt"
if GITLEAKS_CACHE_DIR="$work/cache2" GITLEAKS_BASE_URL="file://$work/release" "$SCRIPT" version 2>"$work/err"; then
  fail "tampered checksum was accepted"
fi
grep -q "checksum verification FAILED" "$work/err" || fail "no checksum error message"
[ ! -e "$work/cache2/gitleaks" ] || fail "binary cached despite failed checksum"
pass "refuses a tampered checksum and caches nothing"
```

`.gitleaks.toml` (repository root; default rules only. No path allowlist for `.env.example`: a real value pasted into an example file is the most likely leak, so it must trip the scan. A future false positive gets a `[[allowlists]]` entry with `regexTarget = "match"` for that specific placeholder, never a path):

```toml
title = "TMS platform gitleaks config"

[extend]
useDefault = true
```

- [ ] **Step 5: Run the gitleaks tests and a repository scan**

Run: `tools/scripts/gitleaks.sh git --redact --no-banner; echo exit=$?` (first run downloads and verifies the binary into `.cache/gitleaks/8.30.1/`)
Expected: `no leaks found`, exit 0.

Run: `bash tools/scripts/gitleaks.test.sh`
Expected: three `ok` lines, no download (the cache is seeded). (Test 3 requires `uname -m` = x86_64; on arm64 adjust the asset name in the test to `arm64`.)

Run: `pnpm --filter @tms/scripts test lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add tools/scripts .gitleaks.toml docs/client/README.md pnpm-lock.yaml docs/efficiency/critical-path.md
git commit -m "build(tooling): add hygiene checks and pinned checksum-verified gitleaks wrapper"
```

---

### Task 8: Git hooks (husky, lint-staged, commitlint)

**Files:**
- Create: `.husky/pre-commit`, `.husky/commit-msg`, `.husky/pre-push`, `commitlint.config.mjs`
- Modify: root `package.json` (`prepare` script and `lint-staged` block already written in Task 1)

**Interfaces:**
- Consumes: `tools/scripts/gitleaks.sh` (Task 7), lint-staged config (Task 1), `turbo` tasks `typecheck` and `test`.
- Produces: hooks installed by `pnpm install` (via `prepare`); commit messages must satisfy `@commitlint/config-conventional`.

- [ ] **Step 1: Write the hook files**

`commitlint.config.mjs`:

```js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [2, 'always', 200],
  },
};
```

`.husky/pre-commit`:

```sh
pnpm exec lint-staged
node tools/scripts/check-hygiene.mjs --staged
tools/scripts/gitleaks.sh git --pre-commit --staged --redact --no-banner
```

`.husky/commit-msg`:

```sh
pnpm exec commitlint --edit "$1"
```

`.husky/pre-push`:

```sh
# Typecheck and test only what changed relative to origin/main (spec section 14).
git fetch --quiet origin main
pnpm exec turbo run typecheck test --filter='...[origin/main]'
```

- [ ] **Step 2: Install and test the hooks**

Run: `pnpm install` (runs `prepare` → `husky`), then `ls .husky && cat .git/hooks/pre-commit 2>/dev/null | head -3; git config core.hooksPath`
Expected: `core.hooksPath` is `.husky/_` (husky 9 layout).

Commit message rules:

```bash
echo "bad message" | pnpm exec commitlint; echo "exit=$?"          # expected: exit=1, subject-empty/type-empty errors
echo "feat(api): add env schema" | pnpm exec commitlint; echo "exit=$?"   # expected: exit=0
printf 'feat: %s\n' "$(printf 'x%.0s' $(seq 1 100))" | pnpm exec commitlint; echo "exit=$?"   # expected: exit=1, header-max-length
```

Root-level files have an ESLint config (Task 1): `pnpm exec eslint commitlint.config.mjs; echo "exit=$?"` → `exit=0`.

Secret detection in pre-commit (a fake GitHub token: the default `github-pat` rule needs `ghp_` + 36 alphanumerics **with entropy ≥ 3**, so use random hex, not a repeated character):

```bash
printf 'export const token = "ghp_%s";\n' "$(openssl rand -hex 18)" > tools/scripts/leak-demo.mjs
git add tools/scripts/leak-demo.mjs
git commit -m "test: leak demo"; echo "exit=$?"      # expected: gitleaks reports 1 leak, exit != 0
git reset -q tools/scripts/leak-demo.mjs && rm tools/scripts/leak-demo.mjs
```

Formatting in pre-commit (the file must be lint-clean apart from formatting, otherwise `eslint --fix` fails on an unfixable rule and the commit is rejected for the wrong reason):

```bash
printf 'export const  x=1\n' > apps/api-admin/src/format-demo.ts
git add apps/api-admin/src/format-demo.ts
git commit -m "test: format demo"; echo "exit=$?"    # expected: exit=0
git show HEAD:apps/api-admin/src/format-demo.ts      # expected: export const x = 1;
git reset -q --soft HEAD~1 && git reset -q apps/api-admin/src/format-demo.ts && rm apps/api-admin/src/format-demo.ts
```

Record all outcomes in the journal row.

- [ ] **Step 3: Commit**

```bash
git add .husky commitlint.config.mjs package.json docs/efficiency/critical-path.md
git commit -m "build(hooks): add husky pre-commit, commit-msg and pre-push hooks"
```

Expected: this commit itself passes all three hooks (header 62 characters).

---

### Task 9: CI workflows and Dependabot

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/e2e.yml`, `.github/dependabot.yml`

**Interfaces:**
- Consumes: root scripts (Task 1), `@tms/db` scripts (Task 4), `infra/smoke.sh` (Task 5a), `pnpm e2e` (Task 6), hygiene and gitleaks (Task 7).
- Produces: check names `verify`, `hygiene`, `db-drift`, `e2e` (used by the ruleset in Task 12).

- [ ] **Step 1: Write `ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

env:
  TURBO_TELEMETRY_DISABLED: '1'
  DO_NOT_TRACK: '1'

jobs:
  verify:
    name: verify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run lint typecheck test build
      - run: pnpm format:check

  hygiene:
    name: hygiene
    runs-on: ubuntu-latest
    env:
      FORBIDDEN_TERMS: ${{ secrets.FORBIDDEN_TERMS }}
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
      - name: FORBIDDEN_TERMS secret must exist (the client name must never reach the public repo)
        run: |
          if [ -z "$FORBIDDEN_TERMS" ]; then
            echo "::error::Repository secret FORBIDDEN_TERMS is not set"; exit 1
          fi
      - name: No client-type documents outside docs/client, CLAUDE.md within limit, no forbidden terms
        run: node tools/scripts/check-hygiene.mjs
      - name: gitleaks over the full history
        run: tools/scripts/gitleaks.sh git --redact --no-banner

  db-drift:
    name: db-drift
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: tms
          POSTGRES_PASSWORD: tms
          POSTGRES_DB: tms
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U tms -d tms"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 12
    env:
      DATABASE_URL: postgresql://tms:tms@localhost:5432/tms
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile --filter @tms/db...
      - name: Apply migrations
        run: pnpm --filter @tms/db db:migrate:deploy
      - name: Schema matches migrations (no drift)
        run: pnpm --filter @tms/db db:drift
```

- [ ] **Step 2: Write `e2e.yml`**

```yaml
name: E2E

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: e2e-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  e2e:
    name: e2e
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Start the full stack
        run: |
          cp infra/.env.example infra/.env
          pnpm compose --profile full up -d --build
      - name: Smoke test the stack
        run: infra/smoke.sh --full
      - name: Install Chromium with OS dependencies
        run: pnpm --filter @tms/e2e exec playwright install --with-deps chromium
      - name: Playwright
        run: pnpm e2e
        env:
          CI: 'true'
      - name: Compose logs on failure
        if: failure()
        run: pnpm compose --profile full logs --no-color
      - uses: actions/upload-artifact@v7
        if: failure()
        with:
          name: playwright-report
          path: |
            e2e/playwright-report
            e2e/test-results
          retention-days: 7
      - name: Stop the stack
        if: always()
        run: pnpm compose --profile full down -v
```

- [ ] **Step 3: Write `dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      dev-minor-patch:
        dependency-type: development
        update-types: [minor, patch]
      prod-minor-patch:
        dependency-type: production
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: /infra/docker
    schedule:
      interval: weekly
```

- [ ] **Step 4: Lint the workflows locally and set the repository secret**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`
Expected: no output, exit 0.

Run: `gh secret set FORBIDDEN_TERMS --repo Stefan-Ethernal/tms-platform < docs/client/forbidden-terms.txt && gh secret list --repo Stefan-Ethernal/tms-platform`
Expected: `FORBIDDEN_TERMS` listed (value masked in every log; GitHub Actions also redacts it if it ever appears in output).

- [ ] **Step 5: Commit and push, then watch the checks**

```bash
git add .github docs/efficiency/critical-path.md
git commit -m "ci: add verify, hygiene, db-drift and e2e workflows with Dependabot"
git push -u origin feat/phase-0-bootstrap
gh run list --branch feat/phase-0-bootstrap --limit 5
gh run watch --exit-status $(gh run list --branch feat/phase-0-bootstrap --workflow CI --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch --exit-status $(gh run list --branch feat/phase-0-bootstrap --workflow E2E --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: `verify`, `hygiene`, `db-drift` and `e2e` all succeed. Fix and re-push until green; record the number of iterations in the journal.

---

### Task 10a: Claude Code plugin hooks (protect, format, verify reminder)

**Files:**
- Create: `tools/claude-plugin/package.json`, `tools/claude-plugin/vitest.config.mjs`, `tools/claude-plugin/eslint.config.mjs`
- Create (the plugin proper, kept free of tests and package files so it stays publishable): `tools/claude-plugin/ethernal-nest-react/.claude-plugin/plugin.json`, `tools/claude-plugin/ethernal-nest-react/hooks/hooks.json`, `tools/claude-plugin/ethernal-nest-react/hooks/lib/stdin.mjs`, `tools/claude-plugin/ethernal-nest-react/hooks/lib/project-root.mjs`, `tools/claude-plugin/ethernal-nest-react/hooks/lib/protect.mjs`, `tools/claude-plugin/ethernal-nest-react/hooks/lib/format.mjs`, `tools/claude-plugin/ethernal-nest-react/hooks/lib/reminder.mjs`, `tools/claude-plugin/ethernal-nest-react/hooks/protect-files.mjs`, `tools/claude-plugin/ethernal-nest-react/hooks/format-on-edit.mjs`, `tools/claude-plugin/ethernal-nest-react/hooks/verify-reminder.mjs`
- Test: `tools/claude-plugin/tests/protect.test.mjs`, `tools/claude-plugin/tests/format.test.mjs`, `tools/claude-plugin/tests/reminder.test.mjs`, `tools/claude-plugin/tests/hooks-cli.test.mjs` (writes temporary files under `tools/claude-plugin/tests/tmp/`, gitignored in Task 1)

**Interfaces:**
- Consumes: root `pnpm exec eslint` / `pnpm exec prettier` (Task 1), `.gitignore` entry for `tests/tmp/` (Task 1).
- Produces: `classifyEdit(filePath: string | undefined, projectRoot: string): { blocked: boolean; reason?: string }`, `shouldFormat(relPath: string | undefined): boolean`, `shouldRemind({ porcelain: string; stopHookActive: boolean }): boolean`, `REMINDER: string`; hook executables driven over stdin. Task 10b adds the agent, skills, marketplace and project settings around them.

**Documented facts this task relies on** (verified 2026-09-23 against code.claude.com/docs, corrected by the critic pass): `hooks.json` is `{"hooks": {"<Event>": [{"matcher": "...", "hooks": [{"type": "command", "command": "...", "timeout": n}]}]}}`; `${CLAUDE_PLUGIN_ROOT}` is the plugin's absolute path and `CLAUDE_PROJECT_DIR` is the project root where the session started (both exported to hook processes; `cwd` in the payload can be a subdirectory, so paths are resolved against `CLAUDE_PROJECT_DIR`); hook stdin JSON carries `tool_name`, `tool_input.file_path` (or `notebook_path`), `cwd`, and for Stop `stop_hook_active`; a PreToolUse hook blocks with exit code 2 and stderr as the reason; a Stop hook gives **non-blocking** guidance with stdout `{"hookSpecificOutput": {"hookEventName": "Stop", "additionalContext": "..."}}` (shown as "Stop hook feedback", no error), while `{"decision": "block"}` would prevent stopping.

- [ ] **Step 1: Write the failing hook unit tests**

`tools/claude-plugin/tests/protect.test.mjs`:

```js
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyEdit } from '../ethernal-nest-react/hooks/lib/protect.mjs';

const cwd = '/work/tms-platform';

describe('classifyEdit', () => {
  it.each([
    '.env',
    'apps/api-admin/.env',
    'infra/.env',
    '.env.local',
    '.env.production',
    'packages/db/.env.test',
    'docs/client/functional-description.pdf',
    'docs/client/README.md',
    'docs/client/sub/notes.md',
  ])('blocks %s', (p) => {
    const verdict = classifyEdit(p, cwd);
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain(p);
  });

  it.each([
    '.env.example',
    'apps/api-admin/.env.example',
    'infra/.env.example',
    '.env.production.example',
    'src/config/env.ts',
    'docs/clientele/notes.md',
    'docs/client-facing.md',
    'environment.ts',
  ])('allows %s', (p) => {
    expect(classifyEdit(p, cwd)).toEqual({ blocked: false });
  });

  it('normalises absolute paths and traversal inside the project', () => {
    expect(classifyEdit(path.join(cwd, '.env'), cwd).blocked).toBe(true);
    expect(classifyEdit('apps/../docs/client/x.pdf', cwd).blocked).toBe(true);
    expect(classifyEdit(path.join(cwd, 'apps/api-admin/.env.example'), cwd).blocked).toBe(false);
  });

  it('ignores paths outside the project (not this hook\'s concern)', () => {
    expect(classifyEdit('/tmp/other/.env', cwd)).toEqual({ blocked: false });
    expect(classifyEdit('../sibling/docs/client/x.pdf', cwd)).toEqual({ blocked: false });
  });

  it('allows a missing path', () => {
    expect(classifyEdit(undefined, cwd)).toEqual({ blocked: false });
  });
});
```

`tools/claude-plugin/tests/format.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { shouldFormat } from '../ethernal-nest-react/hooks/lib/format.mjs';

describe('shouldFormat', () => {
  it.each(['src/a.ts', 'src/a.tsx', 'x.mts', 'x.cts', 'hooks/h.mjs', 'a.cjs', 'a.js', 'a.jsx'])(
    'formats %s',
    (p) => expect(shouldFormat(p)).toBe(true),
  );
  it.each(['README.md', 'a.json', 'a.yml', 'a.prisma', 'Dockerfile', 'a.ts.md'])(
    'skips %s',
    (p) => expect(shouldFormat(p)).toBe(false),
  );
  it.each(['node_modules/x/a.ts', 'apps/x/dist/a.js', 'packages/db/generated/client.ts', '.turbo/a.js', 'coverage/a.js'])(
    'skips generated or vendored %s',
    (p) => expect(shouldFormat(p)).toBe(false),
  );
  it('skips a missing path', () => expect(shouldFormat(undefined)).toBe(false));
});
```

`tools/claude-plugin/tests/reminder.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { shouldRemind } from '../ethernal-nest-react/hooks/lib/reminder.mjs';

describe('shouldRemind', () => {
  it('reminds when apps/ or packages/ have changes', () => {
    expect(shouldRemind({ porcelain: ' M apps/api-admin/src/main.ts\n', stopHookActive: false })).toBe(true);
    expect(shouldRemind({ porcelain: '?? packages/db/prisma/x.sql\n', stopHookActive: false })).toBe(true);
  });
  it('handles renames by their destination', () => {
    expect(shouldRemind({ porcelain: 'R  docs/a.md -> apps/x/b.md\n', stopHookActive: false })).toBe(true);
    expect(shouldRemind({ porcelain: 'R  apps/a.ts -> docs/b.md\n', stopHookActive: false })).toBe(false);
  });
  it('stays quiet for docs-only changes or a clean tree', () => {
    expect(shouldRemind({ porcelain: ' M docs/architecture.md\n M CLAUDE.md\n', stopHookActive: false })).toBe(false);
    expect(shouldRemind({ porcelain: '', stopHookActive: false })).toBe(false);
  });
  it('never blocks twice in a row', () => {
    expect(shouldRemind({ porcelain: ' M apps/x.ts\n', stopHookActive: true })).toBe(false);
  });
});
```

`tools/claude-plugin/tests/hooks-cli.test.mjs` (the executables, driven over stdin exactly as Claude Code drives them; `CLAUDE_PROJECT_DIR` is passed the way Claude Code exports it):

```js
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const hooks = path.resolve(repoRoot, 'tools/claude-plugin/ethernal-nest-react/hooks');
const run = (script, input, env = {}) =>
  spawnSync('node', [path.join(hooks, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: input.cwd, ...env },
  });

describe('protect-files.mjs', () => {
  it('exits 2 with a reason for a protected path', () => {
    const r = run('protect-files.mjs', { tool_name: 'Write', tool_input: { file_path: '.env' }, cwd: '/work/p' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('.env');
  });
  it('exits 0 for an ordinary path and 2 for a notebook under docs/client', () => {
    expect(run('protect-files.mjs', { tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' }, cwd: '/work/p' }).status).toBe(0);
    expect(run('protect-files.mjs', { tool_name: 'NotebookEdit', tool_input: { notebook_path: 'docs/client/a.ipynb' }, cwd: '/work/p' }).status).toBe(2);
  });
  it('resolves against CLAUDE_PROJECT_DIR when the session cwd is a subdirectory', () => {
    const r = run(
      'protect-files.mjs',
      { tool_name: 'Edit', tool_input: { file_path: '/work/p/docs/client/x.pdf' }, cwd: '/work/p/apps/api-admin' },
      { CLAUDE_PROJECT_DIR: '/work/p' },
    );
    expect(r.status).toBe(2);
  });
  it('exits 0 on malformed input instead of blocking everything', () => {
    const r = spawnSync('node', [path.join(hooks, 'protect-files.mjs')], { input: 'not json', encoding: 'utf8' });
    expect(r.status).toBe(0);
  });
});

describe('format-on-edit.mjs', () => {
  it('exits 0 for a file that does not exist', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'fmt-'));
    expect(run('format-on-edit.mjs', { tool_name: 'Edit', tool_input: { file_path: 'missing.ts' }, cwd }).status).toBe(0);
  });
  it('exits 0 for a file with a syntax error (formatter failure is never fatal)', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'fmt-'));
    writeFileSync(path.join(cwd, 'broken.ts'), 'const = ;\n');
    expect(run('format-on-edit.mjs', { tool_name: 'Edit', tool_input: { file_path: 'broken.ts' }, cwd }).status).toBe(0);
  });
  it('exits 0 for a non-code file without running anything', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'fmt-'));
    expect(run('format-on-edit.mjs', { tool_name: 'Write', tool_input: { file_path: 'notes.md' }, cwd }).status).toBe(0);
  });
  it('formats a real file inside the repository with eslint --fix and prettier', () => {
    const dir = path.join(repoRoot, 'tools/claude-plugin/tests/tmp');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `fmt-${process.pid}-${Date.now()}.mjs`);
    writeFileSync(file, 'const  x=1\nexport { x }\n');
    try {
      const r = run('format-on-edit.mjs', { tool_name: 'Write', tool_input: { file_path: file }, cwd: repoRoot });
      expect(r.status).toBe(0);
      expect(readFileSync(file, 'utf8')).toBe('const x = 1;\nexport { x };\n');
    } finally {
      rmSync(file, { force: true });
    }
  }, 60_000);
});

describe('verify-reminder.mjs', () => {
  it('exits 0 and prints nothing when stop_hook_active is true', () => {
    const r = run('verify-reminder.mjs', { hook_event_name: 'Stop', stop_hook_active: true, cwd: repoRoot });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });
  it('exits 0 and prints nothing outside a git repository', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
    const r = run('verify-reminder.mjs', { hook_event_name: 'Stop', stop_hook_active: false, cwd });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });
  it('emits non-blocking additionalContext when apps/ has uncommitted changes', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'git-'));
    execFileSync('git', ['init', '-q'], { cwd });
    mkdirSync(path.join(cwd, 'apps/x'), { recursive: true });
    writeFileSync(path.join(cwd, 'apps/x/a.ts'), 'export const a = 1;\n');
    const r = run('verify-reminder.mjs', { hook_event_name: 'Stop', stop_hook_active: false, cwd });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe('Stop');
    expect(out.hookSpecificOutput.additionalContext).toContain('pnpm verify');
    expect(out.decision).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write the workspace package around the plugin**

`tools/claude-plugin/package.json`:

```json
{
  "name": "@tms/claude-plugin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Tests and tooling for the ethernal-nest-react Claude Code plugin",
  "scripts": {
    "lint": "eslint .",
    "test": "vitest run",
    "validate": "\"${CLAUDE_BIN:-claude}\" plugin validate . --strict && \"${CLAUDE_BIN:-claude}\" plugin validate ethernal-nest-react --strict"
  },
  "devDependencies": {
    "@tms/config": "workspace:*",
    "eslint": "catalog:",
    "vitest": "catalog:"
  }
}
```

`tools/claude-plugin/vitest.config.mjs`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['tests/**/*.test.mjs'] } });
```

`tools/claude-plugin/eslint.config.mjs`:

```js
import { nodeConfig } from '@tms/config/eslint/node';

export default nodeConfig({ tsconfigRootDir: import.meta.dirname });
```

- [ ] **Step 3: Write the plugin manifest and hooks**

`tools/claude-plugin/ethernal-nest-react/.claude-plugin/plugin.json`:

```json
{
  "name": "ethernal-nest-react",
  "version": "0.1.0",
  "description": "Ethernal's NestJS + React + Prisma workflow: TDD skills, verification and PR protocol, plan critic, and hooks that protect secrets and format on edit.",
  "author": { "name": "Ethernal" },
  "keywords": ["nestjs", "react", "prisma", "tdd", "hooks", "plan-critic"]
}
```

`tools/claude-plugin/ethernal-nest-react/hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/protect-files.mjs\"",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/format-on-edit.mjs\"",
            "timeout": 60
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/verify-reminder.mjs\"",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

`hooks/lib/stdin.mjs`:

```js
/** Reads the hook payload Claude Code writes to stdin. Returns {} when it is not JSON. */
export async function readStdinJson() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  try {
    return data.trim() ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}
```

`hooks/lib/protect.mjs`:

```js
import path from 'node:path';

const ENV_REASON = 'env files hold secrets and are edited by hand; change the matching .env.example instead';
const CLIENT_REASON = 'docs/client/ holds client documents that are never committed or modified by Claude';

/**
 * Decides whether an edit to `filePath` must be blocked (spec section 14 PreToolUse hook):
 * `.env`, `.env.*` except `*.example`, and everything under `docs/client/`.
 *
 * @param {string | undefined} filePath absolute or relative to `projectRoot`
 * @param {string} projectRoot the project root (CLAUDE_PROJECT_DIR), not the session cwd
 * @returns {{ blocked: boolean, reason?: string }}
 */
export function classifyEdit(filePath, projectRoot) {
  if (!filePath) return { blocked: false };
  const abs = path.resolve(projectRoot, filePath);
  const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
  if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return { blocked: false };

  const base = path.posix.basename(rel);
  if (base === '.env' || (base.startsWith('.env.') && !base.endsWith('.example'))) {
    return { blocked: true, reason: `${filePath}: ${ENV_REASON}` };
  }
  if (rel.startsWith('docs/client/')) {
    return { blocked: true, reason: `${filePath}: ${CLIENT_REASON}` };
  }
  return { blocked: false };
}
```

`hooks/lib/format.mjs`:

```js
import path from 'node:path';

const FORMATTABLE = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = /(^|\/)(node_modules|dist|coverage|generated|\.turbo)\//;

/** @param {string | undefined} relPath */
export function shouldFormat(relPath) {
  if (!relPath) return false;
  const normalised = relPath.split(path.sep).join('/');
  if (SKIP_DIRS.test(normalised)) return false;
  return FORMATTABLE.has(path.posix.extname(normalised));
}
```

`hooks/lib/reminder.mjs`:

```js
const WATCHED = /^(apps|packages)\//;

/**
 * @param {{ porcelain: string, stopHookActive: boolean }} input
 *   porcelain: output of `git status --porcelain`; stopHookActive: true when a Stop hook already
 *   ran for this stop (remind at most once per stop).
 */
export function shouldRemind({ porcelain, stopHookActive }) {
  if (stopHookActive) return false;
  return porcelain
    .split('\n')
    .filter((line) => line.length > 3)
    .some((line) => {
      const spec = line.slice(3).trim();
      const target = spec.includes(' -> ') ? spec.split(' -> ')[1] : spec;
      return WATCHED.test(target);
    });
}

export const REMINDER =
  'apps/ or packages/ have uncommitted changes. Before finishing, run `pnpm verify` ' +
  '(or state explicitly why it was skipped) and report the actual result to the user.';
```

`hooks/lib/project-root.mjs`:

```js
/** The project root Claude Code started in; the payload's cwd may be a subdirectory. */
export function projectRoot(input) {
  return process.env['CLAUDE_PROJECT_DIR'] ?? input.cwd ?? process.cwd();
}
```

`hooks/protect-files.mjs`:

```js
#!/usr/bin/env node
import { readStdinJson } from './lib/stdin.mjs';
import { classifyEdit } from './lib/protect.mjs';
import { projectRoot } from './lib/project-root.mjs';

const input = await readStdinJson();
const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
const verdict = classifyEdit(filePath, projectRoot(input));
if (verdict.blocked) {
  process.stderr.write(`[ethernal-nest-react] blocked: ${verdict.reason}\n`);
  process.exit(2);
}
```

`hooks/format-on-edit.mjs`:

```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readStdinJson } from './lib/stdin.mjs';
import { shouldFormat } from './lib/format.mjs';
import { projectRoot } from './lib/project-root.mjs';

const input = await readStdinJson();
const root = projectRoot(input);
const filePath = input.tool_input?.file_path;
if (!filePath) process.exit(0);

const abs = path.resolve(root, filePath);
const rel = path.relative(root, abs);
if (rel.startsWith('..') || !shouldFormat(rel) || !existsSync(abs)) process.exit(0);

// Formatting is best effort: a parse error in a half-written file must never block Claude.
const run = (args) => {
  try {
    execFileSync('pnpm', ['exec', ...args, abs], { cwd: root, stdio: 'ignore', timeout: 45_000 });
  } catch {
    /* ignored on purpose */
  }
};
run(['eslint', '--fix', '--no-warn-ignored']);
run(['prettier', '--write', '--log-level', 'warn']);
process.exit(0);
```

`hooks/verify-reminder.mjs`:

```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readStdinJson } from './lib/stdin.mjs';
import { REMINDER, shouldRemind } from './lib/reminder.mjs';
import { projectRoot } from './lib/project-root.mjs';

const input = await readStdinJson();
const root = projectRoot(input);

let porcelain = '';
try {
  porcelain = execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  process.exit(0); // not a git repository: nothing to remind about
}

if (shouldRemind({ porcelain, stopHookActive: Boolean(input.stop_hook_active) })) {
  // Non-blocking guidance: shown as "Stop hook feedback", never as a hook error.
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: REMINDER } }),
  );
}
process.exit(0);
```

- [ ] **Step 4: Run the hook tests and validate the manifest**

Run: `pnpm install && pnpm --filter @tms/claude-plugin test lint`
Expected: 55 tests pass (protect 20, format 20, reminder 4, cli 11).

Run: `~/.local/bin/claude plugin validate tools/claude-plugin/ethernal-nest-react --strict; echo exit=$?`
Expected: no errors or warnings, exit 0 (agents and skills are added in Task 10b; the manifest and hooks validate on their own).

- [ ] **Step 5: Commit**

```bash
git add tools/claude-plugin pnpm-lock.yaml docs/efficiency/critical-path.md
git commit -m "feat(plugin): add ethernal-nest-react hooks for protected files, format-on-edit and verify reminder"
```

---

### Task 10b: Plugin agent, skills, marketplace and project settings

**Files:**
- Create: `tools/claude-plugin/ethernal-nest-react/agents/plan-critic.md`, `tools/claude-plugin/ethernal-nest-react/skills/verify/SKILL.md`, `tools/claude-plugin/ethernal-nest-react/skills/pr/SKILL.md`, `tools/claude-plugin/ethernal-nest-react/README.md`, `tools/claude-plugin/.claude-plugin/marketplace.json`, `tools/claude-plugin/README.md`, `.claude/settings.json`

**Interfaces:**
- Consumes: the plugin manifest and hooks (Task 10a), root `pnpm verify` (Task 1), `.github/pull_request_template.md` (Task 11; the `pr` skill reads it, so Task 11 must land before the skill is first used).
- Produces: the `plan-critic` agent used from this phase on; skills invoked as `/ethernal-nest-react:verify` and `/ethernal-nest-react:pr`; the plugin auto-loads for every clone through the project marketplace `tms` (`extraKnownMarketplaces` with a `directory` source and `enabledPlugins`), with `pnpm claude` (`--plugin-dir`) as the fallback. Skills `new-module`, `add-permission`, `db-migration`, `new-admin-page`, `e2e-scenario`, `docs-sync` and agents `security-reviewer`, `qa-e2e`, `architecture-reviewer`, `docs-writer` are added in the phase that first needs them, each written with `superpowers:writing-skills`.

**Documented facts this task relies on** (verified 2026-09-23 against code.claude.com/docs): agent frontmatter accepts `name`, `description`, `tools` (comma-separated), `model: inherit`; skills are invoked as `/<plugin>:<skill>`; `claude plugin validate <path> --strict` validates a plugin or a marketplace directory; `extraKnownMarketplaces` accepts `{ "source": { "source": "directory", "path": "..." } }` and a relative path resolves against the repository's main checkout after the folder is trusted; `enabledPlugins` is an object `{ "<plugin>@<marketplace>": true }`; permission rules `Edit(<glob>)` also cover Write and NotebookEdit; a leading `/` anchors a path rule at the project directory (`Edit(/docs/client/**)`), `**` crosses directories; `Bash(<prefix>:*)` is a prefix match, and a wildcard before the subcommand (e.g. `Bash(pnpm --filter:*)`) allowlists arbitrary execution, so it is not used.

- [ ] **Step 1: Write the `plan-critic` agent**

`tools/claude-plugin/ethernal-nest-react/agents/plan-critic.md`:

```markdown
---
name: plan-critic
description: Read-only critic for design specs and phase implementation plans (the "critic" of the dreamer/realist/critic process). Use after superpowers:writing-plans and before any implementation, or when a spec is declared approved. Returns ranked findings with evidence and a concrete change; never edits files.
tools: Read, Grep, Glob, Bash
model: inherit
---

You are the critic. The realist has written a plan; your job is to find what will cause rework,
security holes, or wasted effort **before** implementation starts. You never edit files and you
never praise. Bash is for read-only verification only (`--help`, `npm view`, `git log`, `ls`);
you do not run installs, builds, formatters or anything that writes.

## Inputs

You receive the path of the plan and the path of the spec it implements (and CLAUDE.md if it
exists). Read all of them completely before writing anything.

## What to check, in this order

1. **Spec coverage**: every requirement of the spec's section that the plan claims to implement
   has a task; every task traces back to the spec (no invented scope; YAGNI).
2. **Contradictions**: between plan tasks, between plan and spec, between plan and locked
   decisions (D-tables), or with CLAUDE.md rules.
3. **Verification gaps**: tasks whose "test" does not actually exercise the deliverable; missing
   negative cases; success criteria that cannot be checked mechanically.
4. **Ordering and interfaces**: a task consuming a name, type or file that no earlier task
   produces, or under a different name.
5. **Security and data**: secrets, client data, permission checks, fail-open defaults, anything
   that would land in a public repository.
6. **Facts**: versions, flags, APIs and file formats the plan asserts. Verify the ones that matter
   with read-only commands and cite what you ran.
7. **Hidden human steps**: work the plan assumes a person will do without saying so.

## Output format

A markdown table, most severe first, then a one-line summary count:

| # | Severity | Finding | Evidence | Proposed change |
|---|---|---|---|---|

Severity: **HIGH** = would cause rework of a later task or a security/data exposure; **MEDIUM** =
would cause a failed run, flaky verification or a spec deviation; **LOW** = clarity, naming,
minor waste. Evidence is a `file:line` or a command you ran and its output. Proposed change is a
concrete edit, not "consider". At most 25 findings; if you have none in a category, say so in one
line. End with: `Summary: N findings (H high, M medium, L low)`.
```

- [ ] **Step 2: Write the `verify` and `pr` skills**

Use `superpowers:writing-skills` for the frontmatter and description conventions; the content below is the draft to start from.

`tools/claude-plugin/ethernal-nest-react/skills/verify/SKILL.md`:

```markdown
---
name: verify
description: Use before claiming any change is done, before committing a task and before opening a PR - runs the repository's verification (pnpm verify, Playwright and a claude --chrome walkthrough for frontend changes) and records what was actually run and its outcome as a scenario | layer | outcome table.
---

# Verify

Evidence before assertions. Nothing is "done" until the commands below ran in this session and
their real output is recorded.

## Backend or shared package change

1. `pnpm verify` from the repository root (lint, typecheck, unit + e2e-spec tests, build,
   format check, hygiene, gitleaks). Paste the last 20 lines of output.
2. If a migration is involved: `pnpm --filter @tms/db db:migrate:deploy` against the compose
   database, then `pnpm --filter @tms/db db:drift` (exit 0 = no drift).
3. Record a table:

   | scenario | layer | outcome |
   |---|---|---|
   | e.g. "unknown /api route returns JSON 404" | API e2e (supertest) | pass (2 tests) |

   Layers: unit, property, API e2e, UI e2e, security, manual.

## Frontend change

1. Everything above, then `pnpm compose --profile full up -d --build && infra/smoke.sh --full`.
2. `pnpm e2e` (Playwright). Paste the summary line.
3. In a terminal session started with `claude --chrome` (Claude in Chrome extension 1.0.36+,
   signed in with `/login`), open the affected origin (`http://localhost:8080` admin,
   `http://localhost:8081` kiosk), walk the changed flow in a real tab, take 2-4 screenshots and
   list the numbered steps you performed.

## Rules

- A failing or skipped step is reported as such, with the output. Never describe a check that did
  not run as if it had.
- If a command cannot run in the current environment (no Docker, no Chrome), say so explicitly
  and mark the row `not run: <reason>`.
```

`tools/claude-plugin/ethernal-nest-react/skills/pr/SKILL.md`:

````markdown
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
````

`tools/claude-plugin/ethernal-nest-react/README.md`:

```markdown
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
```

`tools/claude-plugin/README.md`:

```markdown
# Claude Code plugin workspace

`ethernal-nest-react/` is the plugin. This directory is also a local plugin **marketplace**
(`.claude-plugin/marketplace.json`) registered by the repository's `.claude/settings.json`, and a
workspace package holding the vitest tests for the hook scripts, so the plugin folder itself stays
publishable.

- `pnpm --filter @tms/claude-plugin test` — hook unit and CLI tests
- `pnpm --filter @tms/claude-plugin validate` — `claude plugin validate --strict` for the
  marketplace and the plugin (set `CLAUDE_BIN=~/.local/bin/claude` if `claude` is not on PATH)
```

- [ ] **Step 3: Write the marketplace manifest and the project settings**

`tools/claude-plugin/.claude-plugin/marketplace.json`:

```json
{
  "name": "tms",
  "owner": { "name": "Ethernal" },
  "metadata": { "description": "Plugins developed inside the TMS platform repository" },
  "plugins": [
    {
      "name": "ethernal-nest-react",
      "source": "./ethernal-nest-react",
      "description": "NestJS + React + Prisma workflow: protective hooks, plan critic, verify and PR skills"
    }
  ]
}
```

`.claude/settings.json` (the deny rules are the always-on layer that does not depend on the plugin being loaded; the hook adds the `.env.*` nuance. Leading `/` anchors at the project directory. No `Bash(pnpm --filter:*)`: a wildcard before the subcommand would allowlist arbitrary execution; scoped runs go through `pnpm turbo run <task> --filter=<pkg>`):

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(pnpm install:*)",
      "Bash(pnpm verify:*)",
      "Bash(pnpm lint:*)",
      "Bash(pnpm typecheck:*)",
      "Bash(pnpm test:*)",
      "Bash(pnpm build:*)",
      "Bash(pnpm e2e:*)",
      "Bash(pnpm format:*)",
      "Bash(pnpm hygiene:*)",
      "Bash(pnpm turbo run:*)",
      "Bash(pnpm compose ps:*)",
      "Bash(pnpm compose logs:*)",
      "Bash(pnpm compose config:*)",
      "Bash(docker compose ps:*)",
      "Bash(docker compose logs:*)",
      "Bash(docker ps:*)",
      "Bash(gh pr view:*)",
      "Bash(gh pr list:*)",
      "Bash(gh pr checks:*)",
      "Bash(gh pr diff:*)",
      "Bash(gh run list:*)",
      "Bash(gh run view:*)",
      "Bash(gh run watch:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git branch:*)"
    ],
    "deny": ["Edit(/docs/client/**)", "Edit(/.env)", "Edit(/**/.env)"]
  },
  "extraKnownMarketplaces": {
    "tms": { "source": { "source": "directory", "path": "./tools/claude-plugin" } }
  },
  "enabledPlugins": { "ethernal-nest-react@tms": true }
}
```

If `claude plugin validate --strict` or Claude Code rejects the `$schema` key, remove it.

- [ ] **Step 4: Validate the marketplace and the plugin, and check that it loads**

Run: `CLAUDE_BIN=~/.local/bin/claude pnpm --filter @tms/claude-plugin validate; echo exit=$?`
Expected: both reports without errors or warnings, exit 0. Fix any flagged frontmatter field and re-run.

Run (loads the plugin from the project settings in a fresh, non-interactive session; the folder must already be trusted): `cd /home/stefan/Ethernal/src/TankManagementSystem && ~/.local/bin/claude -p "List the plugins loaded in this session and the names of their hooks, agents and skills. Answer in one line." --output-format text`
Expected: the answer names `ethernal-nest-react` with `plan-critic`, `verify`, `pr` and the three hooks. If the relative `directory` path is not accepted, change `path` to the absolute checkout path for the journal record, keep `pnpm claude` as the documented fallback, and note it in the PR "Risks and notes".

Manual hook check (record in the journal): in that session ask Claude to append a comment to `apps/api-admin/.env.example` (allowed) and to `docs/client/README.md` (blocked, reason shown), then to fix spacing in a `.ts` file and confirm it is formatted after the edit. If this cannot be done in the current environment, mark it `not run` in the PR.

- [ ] **Step 5: Commit**

```bash
git add tools/claude-plugin .claude/settings.json docs/efficiency/critical-path.md
git commit -m "feat(plugin): add plan-critic agent, verify and pr skills, local marketplace and project settings"
```

---

### Task 11: Documentation: CLAUDE.md, README, PR template, architecture, ADRs

**Files:**
- Create: `CLAUDE.md`, `README.md`, `.github/pull_request_template.md`, `docs/architecture.md`, `docs/adr/README.md`, `docs/adr/0000-template.md`, `docs/adr/0001-two-nest-processes-shared-packages.md`, `docs/adr/0002-prisma-orm.md`

**Interfaces:**
- Consumes: everything above (commands, ports, structure).
- Produces: the PR template the `pr` skill fills; CLAUDE.md within the 150-line hygiene limit.

- [ ] **Step 1: Write CLAUDE.md**

```markdown
# TMS Platform

Terminal management platform POC: RBAC, user administration with invite + TOTP, driver kiosk
check-in (card + PIN), FIFO loading queue, audit log. Spec:
`docs/superpowers/specs/2026-09-23-rbac-checkin-design.md`. Plans: `docs/superpowers/plans/`.

## Stack

Node 24, pnpm 12 (catalog in `pnpm-workspace.yaml` is the only place versions live), Turborepo,
TypeScript ~6.0 (not 7), NestJS 12 (apps compile to CJS, Jest 30 with `--experimental-vm-modules`),
React 19 + Vite 8 + Vitest 5, Prisma 7, zod 4, Playwright, ESLint 10 with `eslint-plugin-boundaries`.

## Commands

- `pnpm install` — also installs husky hooks; copy `infra/.env.example` and `packages/db/.env.example` to `.env` once
- `pnpm compose up -d --build && infra/smoke.sh` — postgres, mailpit, migrate
- `pnpm dev` — `predev` applies migrations; api-admin :3001, api-driver :3002, web-admin :5173,
  web-driver :5174 (Vite proxies `/api`)
- `pnpm verify` — lint, typecheck, tests, build, format check, hygiene, gitleaks. Run before every PR.
- `pnpm turbo run <task> --filter=<package>` — scoped runs (this form is allowlisted; `pnpm --filter` is not)
- `pnpm compose --profile full up -d --build && infra/smoke.sh --full && pnpm e2e` — production-like
  stack behind Caddy (:8080 admin, :8081 kiosk) plus Playwright
- The plugin `ethernal-nest-react` loads from `.claude/settings.json` (marketplace `tms`); fallback `pnpm claude`

## Where things live

- `apps/api-admin`, `apps/api-driver` — NestJS; controllers only, no logic
- `apps/web-admin`, `apps/web-driver` — React SPAs
- `packages/config` — shared tsconfig/eslint/jest presets; `packages/db` — Prisma schema and migrations
- `packages/contracts`, `auth-core`, `domain`, `logger`, `ui` — arrive in phases 1-6 (see spec §6)
- `infra/` — compose, Dockerfiles, Caddyfile, `smoke.sh`; `e2e/` — Playwright
- `tools/scripts` — hygiene + gitleaks wrapper; `tools/claude-plugin` — Claude plugin and its tests
- `docs/adr/` — decisions; `docs/architecture.md` — technical docs; `docs/efficiency/` — journals
- `docs/client/` — client documents, gitignored, never committed, never modified by Claude;
  `docs/client/forbidden-terms.txt` feeds the hygiene check that keeps the client name out of the repo

## Rules

- TDD: failing test first; every task ends with its own verification (`pnpm verify` or the
  task's scoped equivalent) and real output in the PR.
- Dependency rule `contracts <- db <- domain <- apps` (eslint boundaries); `api-driver` imports
  only `@tms/domain/checkin` and `@tms/domain/shared`.
- Every route is decorated `@RequirePermissions` or `@Public` (from phase 3a); audit records are
  written inside the caller's transaction; enums and DTO schemas live in `contracts`.
- UI strings only through i18n keys; `en` is the only bundle for now.
- Versions come from the pnpm catalog; never `latest`. Secrets only in env; `.env.example` per app.
- Conventional commits; feature branch; PR to `main` filled from the PR template by the `pr` skill.
- The client is referred to as "the client"; no client name anywhere in the repository.

## Working agreement

- Claude flags deviations from Claude Code best practices as a short, concrete reminder: no
  verifiable success criterion; skipping plan mode for anything beyond a small fix; prompts without
  `@` references to existing patterns; CLAUDE.md growing with what code already shows; manual
  repetition that should be a skill or hook; kitchen-sink sessions without `/clear`; a third
  correction instead of a restart; unscoped exploration in the main context (use a subagent);
  `claude -p` for CI-style automation; worktrees for parallel sessions.
- Process per phase: `superpowers:writing-plans` → `plan-critic` agent (fresh, read-only) →
  `superpowers:subagent-driven-development`. Log every task and critic pass in
  `docs/efficiency/<lane>.md` as it happens.
- Auth/RBAC/session/token PRs need `security-reviewer`; all others `/code-review`.
```

- [ ] **Step 2: Write the PR template**

`.github/pull_request_template.md`:

```markdown
## What and why

<!-- 2-4 sentences. Name the spec section or decision (D1-D15) this implements. -->

## Diagram

<!-- Mermaid when it explains better than text: sequence (flows), flowchart (state machines),
erDiagram (schema), block (topology). Delete this section if text is enough. -->

## Affected boundaries

- Packages/apps:
- Public interfaces added or changed:
- Migration: no | yes (reversible: yes/no)

## Verification

<!-- What was actually run and how it went, not what should be checked. -->

| scenario | layer | outcome |
|---|---|---|
|  |  |  |

<!-- Frontend changes: numbered steps performed in `claude --chrome` and 2-4 screenshots. -->

## Risks and notes

<!-- Uncovered areas, follow-ups, ADR candidates, steps that could not run and why. -->
```

- [ ] **Step 3: Write README.md**

````markdown
# TMS Platform

Proof of concept for a terminal management platform replacing a legacy TMS/TAS at petroleum
storage terminals: role-based access control, user administration with invite and TOTP, a driver
self-service kiosk (card + PIN), a FIFO loading queue for operators, and an audit log. Built by
Ethernal with Claude Code; the process itself is a deliverable (see `docs/RETROSPECTIVE.md` at the
end of the POC).

## Prerequisites

- Node 24 (`.nvmrc`), pnpm 12.5.1 (`corepack enable` picks it from `packageManager`)
- Docker with Compose v2 (used for Postgres, Mailpit, migrations and the production-like stack)
- Claude Code 2.1+ with the Claude in Chrome extension for visual verification (optional). If the
  `claude` binary is not on `PATH` in your shell, set `CLAUDE_BIN=~/.local/bin/claude`.
- Owners of the client documents also keep `docs/client/forbidden-terms.txt` (gitignored) so the
  hygiene check can guarantee the client name never enters this public repository.

## Quick start

```bash
pnpm install                                   # installs dependencies and git hooks
cp infra/.env.example infra/.env
cp packages/db/.env.example packages/db/.env
pnpm compose up -d --build && infra/smoke.sh   # postgres :5432, mailpit :8025, migrations applied
pnpm dev                                       # api-admin :3001, api-driver :3002, web-admin :5173, web-driver :5174
```

Production-like stack (Caddy on one origin per app): `pnpm compose --profile full up -d --build`,
then `infra/smoke.sh --full` and `pnpm e2e`. Admin at http://localhost:8080, kiosk at
http://localhost:8081.

## Verification

`pnpm verify` runs lint, typecheck, unit and API tests, build, format check, hygiene checks and
gitleaks. CI runs the same plus a Prisma drift check and the Playwright suite against the compose
stack. Every pull request records what was actually verified (see the PR template).

## Repository layout

| Path | Content |
|---|---|
| `apps/api-admin`, `apps/api-driver` | NestJS back-office and kiosk APIs |
| `apps/web-admin`, `apps/web-driver` | React SPAs (back office, kiosk + queue display) |
| `packages/*` | shared code: `config`, `db` (Prisma); `contracts`, `auth-core`, `domain`, `logger`, `ui` from phase 1 on |
| `infra/` | docker-compose, Dockerfiles, Caddyfile, smoke test |
| `e2e/` | Playwright tests |
| `tools/` | hygiene scripts, gitleaks wrapper, Claude Code plugin |
| `docs/` | spec, plans, ADRs, architecture, efficiency journals |

## Documentation

- Design spec: `docs/superpowers/specs/2026-09-23-rbac-checkin-design.md`
- Architecture: `docs/architecture.md`; decisions: `docs/adr/`
- Working with Claude Code in this repository: `CLAUDE.md`

## Status

Phase 0 (bootstrap) complete. Next: phase 1 (contracts, database schema, logger, audit, health).
````

- [ ] **Step 4: Write the architecture skeleton and ADRs**

`docs/architecture.md`:

````markdown
# Architecture

Maintained technical documentation. Business documentation lives in `README.md`; decisions in
`docs/adr/`. Sections marked "phase N" are filled when that phase lands.

## Context (C4 level 1)

```mermaid
flowchart LR
  admin([Administrator / Operator]) -->|browser| web[TMS Platform]
  driver([Driver]) -->|kiosk in the waiting room| web
  display([Queue display]) -->|read-only| web
  web -->|invite and reset emails| mail[(SMTP)]
  web -->|errors| sentry[(Sentry)]
```

## Containers (C4 level 2)

```mermaid
flowchart TB
  subgraph origin_admin[Origin :8080 — Caddy]
    web_admin[web-admin SPA] --- api_admin[api-admin NestJS :3001]
  end
  subgraph origin_kiosk[Origin :8081 — Caddy, isolated terminal network]
    web_driver[web-driver SPA + /display] --- api_driver[api-driver NestJS :3002]
  end
  api_admin --> db[(PostgreSQL 16)]
  api_driver --> db
  migrate[migrate one-shot: prisma migrate deploy + permission sync] --> db
  api_admin --> mailpit[(Mailpit / SMTP)]
```

Two NestJS processes share `contracts`, `db`, `auth-core` and `domain` through workspace packages
(ADR-0001). Each SPA and its API sit behind one origin: Caddy in compose, Vite's dev proxy locally
(D11). Migrations run only in the one-shot `migrate` service or `predev`, never in an app (D12).

## Dependency rule

`contracts <- db <- domain <- apps`; `auth-core` is Nest-free and Prisma-free. Enforced by
`eslint-plugin-boundaries` (`packages/config/eslint/base.mjs`). `api-driver` may import only
`@tms/domain/checkin` and `@tms/domain/shared` (`no-restricted-imports` in its eslint config).

## Environments

| | Development | Compose `full` / production |
|---|---|---|
| SPA | Vite dev server :5173 / :5174 | static files served by Caddy |
| `/api` | Vite `server.proxy` to :3001 / :3002 | Caddy `reverse_proxy` to the API container |
| Database | compose `postgres` | compose `postgres` (volume `pgdata`) |
| Migrations | `pnpm dev` → `predev` | `migrate` one-shot, apps wait for it |
| Email | Mailpit :8025 | SMTP from env |

## Data model — phase 1 (ERD generated from `schema.prisma`)

## Authentication flows — phase 2 (sequence diagrams)

## RBAC and permission sync — phase 3a/3b

## Check-in and queue state machines — phase 4/5

## Observability — phase 1 (logs, Sentry, audit)

## Testing strategy

See spec section 13. Phase 0 provides: Jest (unit + supertest e2e-spec) per API, Vitest per SPA
and tooling package, Playwright smoke against the compose `full` profile, CI jobs `verify`,
`hygiene`, `db-drift`, `e2e`.
````

`docs/adr/README.md`:

```markdown
# Architecture decision records

One file per decision, numbered, immutable once accepted (a new ADR supersedes an old one).
Template: `0000-template.md`. Planned: 0001 two processes, 0002 Prisma, 0003 origin/CSRF/sessions,
0004 permission catalogue and sync, 0005 kiosk device key model, 0006 transactions and events.
```

`docs/adr/0000-template.md`:

```markdown
# ADR-XXXX: Title

- Status: proposed | accepted | superseded by ADR-YYYY
- Date: YYYY-MM-DD
- Spec reference: section / decision id

## Context

## Decision

## Alternatives considered

## Consequences
```

`docs/adr/0001-two-nest-processes-shared-packages.md`:

```markdown
# ADR-0001: Two NestJS processes sharing workspace packages and one database

- Status: accepted
- Date: 2026-09-23
- Spec reference: section 5

## Context

The back office (admin, operator) and the kiosk (driver, queue display) have different users,
authentication methods and network exposure: the kiosk API is reachable only from the isolated
terminal network. They share the data model, permission catalogue and check-in domain.

## Decision

`api-admin` and `api-driver` are separate NestJS deployables. They share the Prisma client,
`contracts`, `auth-core` and `domain` through pnpm workspace packages. `api-driver` imports only
`@tms/domain/checkin` and `@tms/domain/shared` (subpath exports enforced by eslint), so
administrative modules are not in its import graph.

## Alternatives considered

- One Nest process with two route prefixes: simpler, no process or network isolation.
- Microservices with separate databases: real isolation, excessive complexity for this phase.

## Consequences

Isolation is at the level of loaded modules and lint rules, not a package-level guarantee; the
real boundary is the network. Two Dockerfiles/containers, shared migrations (one `migrate` job).
```

`docs/adr/0002-prisma-orm.md`:

```markdown
# ADR-0002: Prisma as the ORM

- Status: accepted
- Date: 2026-09-23
- Spec reference: section 2 (decisions table), section 7

## Context

The data model is relational with strong typing needs (statuses, enums mirrored in `contracts`),
migrations must run as a separate step (D12) and a drift check is part of CI.

## Decision

Prisma 7 (`prisma-client` generator, driver adapter for PostgreSQL, `prisma.config.ts` holding
the datasource URL). Schema and migrations live in `packages/db`; enums are defined in
`contracts` and mirrored in the schema with a unit test asserting set equality.

## Alternatives considered

- TypeORM or MikroORM: decorator-based entities in the Nest style, weaker migration tooling.
- Kysely/Drizzle: lighter, but the team's Prisma experience and the migration workflow won.

## Consequences

`prisma migrate deploy` in the compose `migrate` one-shot and in `predev`; CI drift check
`migrate diff --from-config-datasource --to-schema`. Prisma 8 is an rc at the time of writing;
the catalog pins `^7.10.0`.
```

- [ ] **Step 5: Verify**

Run: `node tools/scripts/check-hygiene.mjs && pnpm format:check && wc -l CLAUDE.md`
Expected: hygiene ok, prettier clean (run `pnpm format` first if needed), CLAUDE.md under 150 lines.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md .github/pull_request_template.md docs/architecture.md docs/adr docs/efficiency/critical-path.md
git commit -m "docs: add CLAUDE.md, README, PR template, architecture skeleton and ADR 0001-0002"
```

---

### Task 12: `claude --chrome` check, ruleset required checks, human decisions

**Files:**
- Modify: `docs/efficiency/critical-path.md` (rows for the chrome check, the ruleset update and any pending human decision; task rows were appended by each task)
- Outside the repository: GitHub ruleset `main: pull requests only` (id 23869173); repository secret `FORBIDDEN_TERMS` (set in Task 9, verified here)

**Interfaces:**
- Consumes: CI check names `verify`, `hygiene`, `db-drift`, `e2e` (Task 9), compose `full` stack (Task 5b).
- Produces: `main` requires those four checks (strict policy); recorded chrome outcome; an explicit list of decisions left to Stefan (repository LICENSE: a public repository without one is "all rights reserved"; the plan adds none).

- [ ] **Step 1: `claude --chrome` check (needs a terminal with Chrome and the extension; approach `human` if the session cannot do it)**

```bash
pnpm compose --profile full up -d --build && infra/smoke.sh --full
claude --chrome --plugin-dir tools/claude-plugin/ethernal-nest-react
```

In that session: "Open http://localhost:8080 in a tab, confirm the title is `TMS Admin`, then open http://localhost:8081 and confirm `TMS Kiosk`; take one screenshot of each." Expected: both pages load, screenshots produced. Record the outcome (or `not run: <reason>`) in the journal and in the PR's Verification section.

- [ ] **Step 2: Add required status checks to the ruleset (after the four checks have run at least once on the PR)**

```bash
gh api repos/Stefan-Ethernal/tms-platform/rulesets/23869173 > /tmp/ruleset.json
node -e '
  const r = JSON.parse(require("fs").readFileSync("/tmp/ruleset.json","utf8"));
  r.rules = r.rules.filter((x) => x.type !== "required_status_checks");
  r.rules.push({ type: "required_status_checks", parameters: {
    strict_required_status_checks_policy: true,
    do_not_enforce_on_create: false,
    required_status_checks: ["verify","hygiene","db-drift","e2e"].map((context) => ({ context })) } });
  const body = { name: r.name, target: r.target, enforcement: r.enforcement, conditions: r.conditions, rules: r.rules, bypass_actors: r.bypass_actors ?? [] };
  require("fs").writeFileSync("/tmp/ruleset-put.json", JSON.stringify(body));
'
gh api -X PUT repos/Stefan-Ethernal/tms-platform/rulesets/23869173 --input /tmp/ruleset-put.json --jq '.rules[].type'
```

Expected: the output lists the existing rule types plus `required_status_checks`. Verify with `gh pr checks` on the PR that all four are marked required.

- [ ] **Step 3: Complete the journal and list the human decisions**

Check that `docs/efficiency/critical-path.md` has one row per task (1 to 11, appended by each task's commit), plus rows for the critic pass, the chrome check and the ruleset update. `Approach` is `subagent` for tasks executed by implementer subagents, `human` for the chrome check if Stefan performed it. Add a short "Decisions for Stefan" list under the table: repository LICENSE choice; confirmation of the `docs/client/forbidden-terms.txt` contents; whether the `e2e` check should stay required on `main` once its duration is known.

```bash
git add docs/efficiency/critical-path.md
git commit -m "docs: log chrome check, ruleset update and open decisions in the efficiency journal"
```

---

### Task 13: Pull request

- [ ] **Step 1: Finish the branch**

Follow `superpowers:verification-before-completion`, then:

```bash
git fetch origin main && git rebase origin/main
pnpm verify
pnpm compose --profile full up -d --build && infra/smoke.sh --full && pnpm e2e
git push --force-with-lease
```

Expected: everything green locally; CI green on the branch.

- [ ] **Step 2: Open the PR with the `pr` skill**

Title: `build: phase 0 bootstrap — monorepo, tooling, compose, CI, hooks, Claude plugin skeleton`. Body from `.github/pull_request_template.md` with: what/why (spec §16 phase 0), a `block`/flowchart Mermaid of the compose topology, boundaries (all new; no migration), the verification table with real outcomes (config eslint test, API env + e2e-spec counts, web render tests, `prisma validate` + drift, smoke default and full, Playwright 6/6, hygiene tests, gitleaks tests, commitlint demos, hook tests, plugin validate, CI run URLs, chrome check), risks (fallbacks used if any, whether the relative marketplace path had to be made absolute, `test` profile deferred to phase 2, chrome check status, open decisions for Stefan).

```bash
gh pr create --base main --title "..." --body-file /tmp/pr-body.md
```

- [ ] **Step 3: Review**

Run `/code-review` on the PR (no auth code in this phase, so `security-reviewer` is not mandatory). Address findings per `superpowers:receiving-code-review`. Hand over to Stefan for merge.

---

## Deliberate deviations from the spec (all judged by the critic pass)

1. Caddy is in the `full` profile, not the default one (spec 17.1 lists it among default services): without app containers it has no upstreams; in dev Vite proxies (D11). Justified.
2. Compose `test` profile (shortened lockouts) deferred to phase 2 when lockout exists. Justified.
3. `packages/db` exists in phase 0 (spec lists `db` under phase 1) but only as schema + config, so `migrate`, `predev` and the drift check are real from the start. Justified once `prisma.config.ts` tolerates a missing `DATABASE_URL` for `validate` (finding 1).
4. No LICENSE file is added: the repository is public and the choice of licence is Stefan's; listed as an open decision in Task 12.
5. The `claude --chrome` check needs a terminal session with the extension; an autonomous session inside VS Code cannot perform it and must report `not run`. Justified: the spec item is satisfied by recording the outcome.

Two deviations proposed in the first draft were rejected by the critic and removed: a blocking Stop hook (the documented `additionalContext` is non-blocking) and deferring the project marketplace (a `directory` source with a relative path is documented).

## Critic pass over this plan: 24 findings, 24 accepted, 0 rejected

Run 2026-09-23 11:05–11:12 by a fresh read-only Plan agent over the spec, the plan, the journal and `.gitignore`; it verified versions, peer ranges, template contents and CLI flags read-only (`npm view`, tarball inspection, docs). Incorporated 11:12–11:45.

| # | Severity | Finding (abridged) | Change made |
|---|---|---|---|
| 1 | HIGH | Prisma `env()` throws eagerly, so `prisma validate` in `turbo run test` fails wherever `DATABASE_URL` is unset (CI `verify`, pre-push); the draft's fallback default URL would let `migrate deploy` connect silently | `datasource` set only when the variable exists; criteria rewritten (Task 4) |
| 2 | HIGH | "Client name never in the repo" had no mechanical guard | Forbidden-terms check in `check-hygiene.mjs` (file + `FORBIDDEN_TERMS` secret, `--staged` in pre-commit, never prints the term) with unit and git-repo tests (Tasks 7, 8, 9) |
| 3 | HIGH | No root `eslint.config.mjs`: lint-staged on `commitlint.config.mjs` fails, Task 8's own commit rejected | Root config added (Task 1) and checked in Tasks 1 and 8 |
| 4 | MEDIUM | Three commit headers over 100 chars, rejected by commitlint | Shortened; constraint added |
| 5 | MEDIUM | Fake token `ghp_AAAA…` has entropy 0, `github-pat` rule needs ≥ 3 | `openssl rand -hex 18` |
| 6 | MEDIUM | Deprecated `[allowlist]` and fail-open path allowlist for `.env.example` | Removed; default rules only |
| 7 | MEDIUM | Stop hook `decision: block` shows a hook error; `additionalContext` is the documented non-blocking form | Rewritten (Task 10a) |
| 8 | MEDIUM | Hooks and deny rules resolve against the session cwd; a subdirectory session fails open | `CLAUDE_PROJECT_DIR`, anchored `Edit(/...)` rules, subdirectory test |
| 9 | MEDIUM | `Bash(pnpm --filter:*)` allowlists arbitrary execution | Removed; `pnpm turbo run … --filter` documented |
| 10 | MEDIUM | `prettier --check .` would rewrite the approved spec, plans and journal | `docs/superpowers`, `docs/efficiency` in `.prettierignore` |
| 11 | MEDIUM | `smoke.sh --full` hits `/api` once while Caddy is up before Nest binds | Retry loop until 404 |
| 12 | MEDIUM | `playwright install --with-deps` prompts for `sudo` locally | Chromium only locally; `--with-deps` in CI |
| 13 | MEDIUM | Formatting demo file trips unfixable `no-unused-vars` | `export const  x=1` |
| 14 | MEDIUM | Format hook tests only asserted exit 0 | Positive test at the repo root asserting the formatted content |
| 15 | MEDIUM | Directory marketplace is documented; auto-load possible now | `marketplace.json` + `extraKnownMarketplaces` + `enabledPlugins` (Task 10b) |
| 16 | LOW | gitleaks test downloaded on every `turbo run test` | Seeds from the repo cache; download only when absent |
| 17 | LOW | Wrong expected test count | Corrected |
| 18 | LOW | Journal rows batched at the end | Each task's commit appends its row |
| 19 | LOW | Tasks 5 and 10 too large for one implementer | Split into 5a/5b and 10a/10b |
| 20 | LOW | boundaries v7 patterns misuse (`/**`, capture count) and untested until phase 1 | Folder patterns; fixture test added (Task 1) |
| 21 | LOW | `.env.example` comment promised `.env` loading nothing implements | Comment corrected |
| 22 | LOW | `claude` not on PATH in non-interactive shells | `${CLAUDE_BIN:-claude}` in scripts, README note |
| 23 | LOW | `kill %1` leaves node/vite children on the ports | `timeout` wrappers |
| 24 | LOW | `<title>` contradicts "no user-facing strings" | Constraint amended |

Estimated rework prevented: findings 1, 3, 4, 5, 13 would each have failed a task's own acceptance step; 2 and 8 are data-exposure guards that could not be repaired after a public push.
