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
- "UI language: English default; i18next infrastructure from the start (all strings through keys)" — the phase 0 SPA skeletons render **no user-facing strings**; i18n init ships with `packages/ui` in phase 6.
- Every change to `main` goes through a PR (ruleset "main: pull requests only", squash merges). Conventional commits.
- "`.env.example` per application; all secrets only in env."
- Repository text, code and documentation in English.
- Versions are pinned through the pnpm catalog; **never `latest`** in package manifests or Dockerfiles (Prisma `latest` currently resolves to an rc).

## Review Focus

Inputs the spec implies but that need explicit tests (each pinned to the owning task):

1. **Protected-path hook with unusual paths** (Task 10): absolute paths, `..` traversal, paths outside the project, look-alike directories (`docs/clientele/`) and `.env.production.example` must be classified correctly — a false block stops legitimate work, a false allow leaks a client document.
2. **Format-on-edit hook on a file it cannot format** (Task 10): a file with a syntax error mid-edit, a file that no longer exists, or one under `dist/`/`generated/` must never exit non-zero or block Claude.
3. **gitleaks bootstrap under network or integrity failure** (Task 7): a tampered or missing checksum must fail loudly and leave no binary in the cache; a cached binary must work offline.
4. **API startup with a bad `PORT`** (Task 2): `PORT=abc`, `PORT=0`, `PORT=70000` must fail fast with a message naming `PORT`; unknown variables must be ignored.
5. **`/api` precedence over the SPA fallback behind Caddy** (Task 5 and Task 6): an unknown `/api/...` path must return the API's JSON 404, never `index.html`, otherwise cookies and CSRF assumptions of D11 silently break.

---

## Task overview

| # | Task | Deliverable | Verified by |
|---|---|---|---|
| 1 | Workspace root + `@tms/config` | pnpm workspace, catalog, Turborepo, shared tsconfig/eslint/jest presets | vitest test of the eslint import-restriction rule; `pnpm install` |
| 2 | NestJS API skeletons | `apps/api-admin`, `apps/api-driver` with reserved logger/Sentry slots | Jest unit (env) + e2e-spec (404 JSON) |
| 3 | Vite SPA skeletons + MSW | `apps/web-admin`, `apps/web-driver` | Vitest render test; `vite build` |
| 4 | Prisma `db` package | schema, `prisma.config.ts`, migration scripts | `prisma validate`; compose migrate exit 0 (Task 5) |
| 5 | Compose + Dockerfiles + Caddy + smoke | `infra/**` | `infra/smoke.sh` and `infra/smoke.sh --full` |
| 6 | Playwright skeleton | `e2e/**` | smoke specs against compose `full` |
| 7 | Hygiene + gitleaks scripts | `tools/scripts/**`, `.gitleaks.toml` | vitest + bash tests |
| 8 | Git hooks | husky, lint-staged, commitlint | commitlint pipe tests; pre-commit demo |
| 9 | CI workflows + Dependabot | `.github/**` | actionlint; green checks on the PR |
| 10 | Claude Code plugin skeleton + project settings | `tools/claude-plugin/**`, `.claude/settings.json` | vitest hook tests; `claude plugin validate --strict` |
| 11 | Documentation | CLAUDE.md, README, PR template, architecture, ADR 0001/0002 | hygiene line limit; prettier |
| 12 | `claude --chrome` check + ruleset required checks + journal | outside-repo steps | recorded outcomes |
| 13 | PR | PR to `main` per spec section 13 | CI green, review |

---

### Task 1: Workspace root and `@tms/config`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.nvmrc`, `turbo.json`, `.editorconfig`, `.prettierrc.json`, `.prettierignore`
- Modify: `.gitignore` (add `.cache/`, `generated/`, `infra/.env`)
- Create: `packages/config/package.json`, `packages/config/tsconfig/base.json`, `packages/config/tsconfig/nest.json`, `packages/config/tsconfig/react.json`, `packages/config/tsconfig/react-node.json`, `packages/config/tsconfig/library.json`, `packages/config/eslint/base.mjs`, `packages/config/eslint/node.mjs`, `packages/config/eslint/react.mjs`, `packages/config/jest/create-config.mjs`, `packages/config/eslint.config.mjs`, `packages/config/vitest.config.mjs`
- Test: `packages/config/test/eslint-node.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `nodeConfig({ tsconfigRootDir: string, allowedDomainSubpaths?: string[] }): FlatConfig[]`, `reactConfig({ tsconfigRootDir: string }): FlatConfig[]`, `createJestConfig({ rootDir: string }): JestConfig`, tsconfig presets `@tms/config/tsconfig/{base,nest,react,react-node,library}.json`, catalog entries used by every later task (`"typescript": "catalog:"` etc.).

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
    "claude": "claude --plugin-dir tools/claude-plugin/ethernal-nest-react"
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

`.prettierignore`:

```
node_modules
dist
coverage
.turbo
.cache
pnpm-lock.yaml
docs/client
**/generated
playwright-report
test-results
apps/*/public/mockServiceWorker.js
```

Append to `.gitignore`:

```
# Tool caches and generated code
.cache/
**/generated/

# Compose environment
infra/.env
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

- [ ] **Step 3: Install and run the test to verify it fails**

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
 * Elements are matched against paths relative to the repository root, so the same
 * configuration works when eslint runs inside any workspace package.
 */
export const boundariesConfig = {
  plugins: { boundaries },
  settings: {
    'boundaries/root-path': repoRoot,
    'boundaries/elements': [
      { type: 'contracts', pattern: 'packages/contracts/**' },
      { type: 'db', pattern: 'packages/db/**' },
      { type: 'auth-core', pattern: 'packages/auth-core/**' },
      { type: 'logger', pattern: 'packages/logger/**' },
      { type: 'domain', pattern: 'packages/domain/**' },
      { type: 'ui', pattern: 'packages/ui/**' },
      { type: 'app', pattern: 'apps/*/**', capture: ['app'] },
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

/**
 * @param {{ tsconfigRootDir: string }} options
 */
export function baseConfig({ tsconfigRootDir }) {
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
    boundariesConfig,
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
 * @param {{ tsconfigRootDir: string, allowedDomainSubpaths?: string[] }} options
 *   `allowedDomainSubpaths` restricts imports of `@tms/domain` to the listed subpath
 *   exports (spec section 3: api-driver may import only checkin and shared).
 */
export function nodeConfig({ tsconfigRootDir, allowedDomainSubpaths }) {
  const config = [
    ...baseConfig({ tsconfigRootDir }),
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

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @tms/config test`
Expected: 4 passed.

Run: `pnpm --filter @tms/config lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc .nvmrc turbo.json .editorconfig .prettierrc.json .prettierignore .gitignore packages/config
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
# Back-office API. Copy to .env for local overrides; never commit .env.
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

Run: `pnpm --filter @tms/api-admin build && PORT=3101 node apps/api-admin/dist/main.js & sleep 3; curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3101/api/x; kill %1`
Expected: `404`.

Run: `PORT=abc node apps/api-admin/dist/main.js; echo exit=$?`
Expected: error message containing `Invalid environment: PORT` and a non-zero exit.

Repeat all of the above for `@tms/api-driver` on port 3102.

Run: `pnpm --filter @tms/api-admin --filter @tms/api-driver lint typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api-admin apps/api-driver pnpm-lock.yaml
git commit -m "feat(api): add api-admin and api-driver NestJS skeletons with reserved logger and Sentry slots"
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

Run (dev proxy check, API from Task 2 running on 3001): `pnpm --filter @tms/api-admin start & pnpm --filter @tms/web-admin dev & sleep 5; curl -s http://localhost:5173/api/nope; kill %1 %2`
Expected: the Nest JSON 404 body (`"statusCode":404`), not HTML.

- [ ] **Step 5: Commit**

```bash
git add apps/web-admin apps/web-driver pnpm-lock.yaml
git commit -m "feat(web): add web-admin and web-driver Vite skeletons with MSW and dev API proxy"
```

---

### Task 4: Prisma `db` package skeleton

**Files:**
- Create: `packages/db/package.json`, `packages/db/prisma.config.ts`, `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/migration_lock.toml`, `packages/db/.env.example`, `packages/db/tsconfig.json`, `packages/db/eslint.config.mjs`

**Interfaces:**
- Consumes: catalog `prisma`, `dotenv` (Task 1).
- Produces: scripts `db:validate`, `db:migrate:dev`, `db:migrate:deploy`, `db:migrate:status`, `db:drift`; env `DATABASE_URL`; `prisma/migrations/` directory that the compose `migrate` service (Task 5) and CI drift job (Task 9) consume. Phase 1 adds models, the generated client, `PrismaService` and the permission sync.

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

`packages/db/prisma.config.ts` (Prisma 7 moved the datasource URL out of the schema; `dotenv/config` loads `packages/db/.env` locally, containers pass `DATABASE_URL` directly. The `env()` helper from `prisma/config` reads the variable lazily, so `prisma validate` works without a database while `migrate deploy` fails clearly when the variable is missing):

```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

If the installed Prisma does not export `env` from `prisma/config`, use `url: process.env['DATABASE_URL'] ?? 'postgresql://unset:unset@localhost:5432/unset'` and keep the acceptance criteria below.

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
Expected: a clear error naming `DATABASE_URL`, non-zero exit (no silent connection to a default).

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
git add packages/db pnpm-lock.yaml
git commit -m "feat(db): add Prisma 7 package skeleton with migration and drift scripts"
```

---

### Task 5: docker-compose, Dockerfiles, Caddy and smoke test

**Files:**
- Create: `infra/docker-compose.yml`, `infra/.env.example`, `infra/smoke.sh`, `infra/docker/api.Dockerfile`, `infra/docker/migrate.Dockerfile`, `infra/docker/web.Dockerfile`, `infra/docker/Caddyfile`, `.dockerignore`
- Modify: `package.json` (root) — add `"predev": "pnpm --filter @tms/db db:migrate:deploy"` (D12; phase 1 changes it to `migrate dev` + permission sync)

**Interfaces:**
- Consumes: `@tms/api-admin`/`@tms/api-driver` `dist/main.js` on `PORT` (Task 2), `@tms/web-*` `dist/` (Task 3), `@tms/db` scripts (Task 4).
- Produces: default profile = `postgres`, `mailpit`, `migrate`; profile `full` adds `api-admin`, `api-driver`, `caddy`. Admin origin `http://localhost:${CADDY_ADMIN_PORT:-8080}`, kiosk origin `http://localhost:${CADDY_KIOSK_PORT:-8081}`; `/api/*` forwarded to the matching API. `infra/smoke.sh [--full]` used by developers and CI. Profile `test` (shortened lockouts) is added in phase 2 when lockout exists.

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

- [ ] **Step 2: Write the Dockerfiles and Caddyfile**

`.dockerignore` (repository root; keeps client documents and caches out of every build context):

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
e2e
tools/claude-plugin
**/playwright-report
**/test-results
**/.env
**/.env.*
!**/.env.example
```

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

Negative check (Review Focus: migrations gate the apps): `POSTGRES_PASSWORD=wrong pnpm compose --profile full up -d api-admin; sleep 20; pnpm compose ps -a` → `migrate` exited non-zero and `api-admin` never started (state `created`). Then `pnpm compose --profile full down`.

- [ ] **Step 5: Run the full profile**

```bash
pnpm compose --profile full up -d --build
infra/smoke.sh --full
pnpm compose --profile full down
```

Expected: both origins serve their SPA titles and return the Nest JSON 404 under `/api`. If `pnpm deploy --legacy` is rejected by pnpm 12, drop `--legacy` and add `injectWorkspacePackages: true` to `pnpm-workspace.yaml`; the acceptance criterion is unchanged.

- [ ] **Step 6: Add `predev` and commit**

Root `package.json` scripts: add `"predev": "pnpm --filter @tms/db db:migrate:deploy"` right before `"dev"`.

```bash
git add infra .dockerignore package.json
git commit -m "build(infra): add docker-compose stack, multi-stage Dockerfiles, Caddy single-origin proxy and smoke test"
```

---

### Task 6: Playwright skeleton

**Files:**
- Create: `e2e/package.json`, `e2e/playwright.config.ts`, `e2e/tsconfig.json`, `e2e/eslint.config.mjs`, `e2e/tests/web-admin/smoke.spec.ts`, `e2e/tests/web-driver/smoke.spec.ts`, `e2e/README.md`

**Interfaces:**
- Consumes: compose `full` origins (Task 5), `data-testid="app-root"` and titles (Task 3).
- Produces: `pnpm e2e` (root) runs both Playwright projects; env `E2E_ADMIN_URL`, `E2E_DRIVER_URL` default to the Caddy origins. Helpers (Mailpit, TOTP, seed API) are added by the QA lane when the flows exist.

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
    "install-browsers": "playwright install --with-deps chromium",
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
git add e2e pnpm-lock.yaml
git commit -m "test(e2e): add Playwright skeleton with smoke specs against the compose full profile"
```

---

### Task 7: Hygiene and gitleaks scripts

**Files:**
- Create: `tools/scripts/package.json`, `tools/scripts/check-hygiene.mjs`, `tools/scripts/gitleaks.sh`, `tools/scripts/gitleaks.test.sh`, `tools/scripts/eslint.config.mjs`, `tools/scripts/vitest.config.mjs`, `.gitleaks.toml`
- Test: `tools/scripts/check-hygiene.test.mjs`

**Interfaces:**
- Consumes: `git ls-files`, root `CLAUDE.md` (Task 11; the check tolerates a missing file until then).
- Produces: `node tools/scripts/check-hygiene.mjs` (exit 1 with one line per problem), `tools/scripts/gitleaks.sh <gitleaks args>` (pinned 8.30.1, checksum-verified, cached in `.cache/gitleaks/`), `findForbiddenDocuments(files: string[]): string[]`, `claudeMdLineCount(text: string): number`, `runHygiene({ trackedFiles, claudeMd }): string[]`. Used by root `pnpm hygiene`, the pre-commit hook (Task 8) and CI (Task 9).

- [ ] **Step 1: Write the failing hygiene tests**

`tools/scripts/check-hygiene.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { CLAUDE_MD_MAX_LINES, findForbiddenDocuments, runHygiene } from './check-hygiene.mjs';

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
 * Repository hygiene (spec section 13, CI):
 *  - no *.pdf|*.pptx|*.docx tracked outside docs/client/ (public repository, client documents),
 *  - CLAUDE.md stays short (spec section 14).
 * Exit 1 with one line per problem.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_DOCUMENT_RE = /\.(pdf|pptx|docx)$/i;
export const CLIENT_DOCS_DIR = 'docs/client/';
export const CLAUDE_MD_MAX_LINES = 150;

/** @param {string[]} trackedFiles */
export function findForbiddenDocuments(trackedFiles) {
  return trackedFiles.filter((f) => FORBIDDEN_DOCUMENT_RE.test(f) && !f.startsWith(CLIENT_DOCS_DIR));
}

/** @param {string} text */
export function claudeMdLineCount(text) {
  return text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
}

/** @param {{ trackedFiles: string[], claudeMd: string | null }} input */
export function runHygiene({ trackedFiles, claudeMd }) {
  const problems = findForbiddenDocuments(trackedFiles).map(
    (f) => `client-type document outside docs/client/: ${f}`,
  );
  if (claudeMd !== null) {
    const lines = claudeMdLineCount(claudeMd);
    if (lines > CLAUDE_MD_MAX_LINES) {
      problems.push(`CLAUDE.md has ${lines} lines (max ${CLAUDE_MD_MAX_LINES}); move detail into docs/`);
    }
  }
  return problems;
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const claudeMdPath = path.join(repoRoot, 'CLAUDE.md');
  const claudeMd = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, 'utf8') : null;
  const problems = runHygiene({ trackedFiles, claudeMd });
  for (const p of problems) console.error(`hygiene: ${p}`);
  if (problems.length > 0) process.exit(1);
  console.log(`hygiene: ok (${trackedFiles.length} tracked files checked)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 3: Run the hygiene tests**

Run: `pnpm install && pnpm --filter @tms/scripts exec vitest run`
Expected: 8 passed.

Run: `node tools/scripts/check-hygiene.mjs; echo exit=$?`
Expected: `hygiene: ok (...)`, exit 0 (client PDFs are untracked).

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
# Tests for gitleaks.sh: happy path, offline reuse, tampered checksum.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/gitleaks.sh"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
pass() { echo "ok   $1"; }
fail() { echo "FAIL $1" >&2; exit 1; }

# 1. happy path: downloads, verifies and runs
out="$(GITLEAKS_CACHE_DIR="$work/cache" "$SCRIPT" version)"
[ "$out" = "8.30.1" ] || fail "expected version 8.30.1, got '$out'"
pass "downloads and runs the pinned version"

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

`.gitleaks.toml` (repository root):

```toml
title = "TMS platform gitleaks config"

[extend]
useDefault = true

[allowlist]
description = "Example env files hold placeholders, not secrets"
paths = ['''(^|/)\.env\.example$''', '''\.env\.[a-z]+\.example$''']
```

- [ ] **Step 5: Run the gitleaks tests and a repository scan**

Run: `bash tools/scripts/gitleaks.test.sh`
Expected: three `ok` lines. (Test 3 requires `uname -m` = x86_64; on arm64 adjust the asset name in the test to `arm64`.)

Run: `tools/scripts/gitleaks.sh git --redact --no-banner; echo exit=$?`
Expected: `no leaks found`, exit 0.

Run: `pnpm --filter @tms/scripts test lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add tools/scripts .gitleaks.toml pnpm-lock.yaml
git commit -m "build(tooling): add hygiene check and pinned checksum-verified gitleaks wrapper"
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
```

Secret detection in pre-commit (a fake GitHub token matching the default `github-pat` rule):

```bash
printf 'const token = "ghp_%s";\n' "$(printf 'A%.0s' $(seq 1 36))" > tools/scripts/leak-demo.mjs
git add tools/scripts/leak-demo.mjs
git commit -m "test: leak demo"; echo "exit=$?"      # expected: gitleaks reports 1 leak, exit != 0
git reset -q tools/scripts/leak-demo.mjs && rm tools/scripts/leak-demo.mjs
```

Formatting in pre-commit: stage a `.ts` file with `const  x=1` spacing inside `apps/api-admin/src/`, commit with a valid message, and confirm the committed content is prettier-formatted (`git show HEAD:<file>`); then `git reset --soft HEAD~1` and drop the file. Record both outcomes in the journal.

- [ ] **Step 3: Commit**

```bash
git add .husky commitlint.config.mjs package.json
git commit -m "build(hooks): add husky pre-commit (lint-staged + gitleaks), commit-msg (commitlint) and pre-push hooks"
```

Expected: this commit itself passes all three hooks.

---

### Task 9: CI workflows and Dependabot

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/e2e.yml`, `.github/dependabot.yml`

**Interfaces:**
- Consumes: root scripts (Task 1), `@tms/db` scripts (Task 4), `infra/smoke.sh` (Task 5), `pnpm e2e` (Task 6), hygiene and gitleaks (Task 7).
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
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
      - name: No client-type documents outside docs/client, CLAUDE.md within limit
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
      - run: pnpm --filter @tms/e2e install-browsers
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

- [ ] **Step 4: Lint the workflows locally**

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`
Expected: no output, exit 0.

- [ ] **Step 5: Commit and push, then watch the checks**

```bash
git add .github
git commit -m "ci: add verify, hygiene, db-drift and e2e workflows with Dependabot"
git push -u origin feat/phase-0-bootstrap
gh run list --branch feat/phase-0-bootstrap --limit 5
gh run watch --exit-status $(gh run list --branch feat/phase-0-bootstrap --workflow CI --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch --exit-status $(gh run list --branch feat/phase-0-bootstrap --workflow E2E --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: `verify`, `hygiene`, `db-drift` and `e2e` all succeed. Fix and re-push until green; record the number of iterations in the journal.

---

### Task 10: Claude Code plugin skeleton and project settings

**Files:**
- Create: `tools/claude-plugin/package.json`, `tools/claude-plugin/vitest.config.mjs`, `tools/claude-plugin/eslint.config.mjs`, `tools/claude-plugin/README.md`
- Create (the plugin proper, kept free of tests and package files so it stays publishable): `tools/claude-plugin/ethernal-nest-react/.claude-plugin/plugin.json`, `tools/claude-plugin/ethernal-nest-react/README.md`, `tools/claude-plugin/ethernal-nest-react/hooks/hooks.json`, `tools/claude-plugin/ethernal-nest-react/hooks/lib/stdin.mjs`, `tools/claude-plugin/ethernal-nest-react/hooks/lib/protect.mjs`, `tools/claude-plugin/ethernal-nest-react/hooks/lib/format.mjs`, `tools/claude-plugin/ethernal-nest-react/hooks/lib/reminder.mjs`, `tools/claude-plugin/ethernal-nest-react/hooks/protect-files.mjs`, `tools/claude-plugin/ethernal-nest-react/hooks/format-on-edit.mjs`, `tools/claude-plugin/ethernal-nest-react/hooks/verify-reminder.mjs`, `tools/claude-plugin/ethernal-nest-react/agents/plan-critic.md`, `tools/claude-plugin/ethernal-nest-react/skills/verify/SKILL.md`, `tools/claude-plugin/ethernal-nest-react/skills/pr/SKILL.md`
- Create: `.claude/settings.json`
- Test: `tools/claude-plugin/tests/protect.test.mjs`, `tools/claude-plugin/tests/format.test.mjs`, `tools/claude-plugin/tests/reminder.test.mjs`, `tools/claude-plugin/tests/hooks-cli.test.mjs`

**Interfaces:**
- Consumes: root `pnpm verify` (Task 1), `.github/pull_request_template.md` (Task 11; the `pr` skill reads it).
- Produces: `classifyEdit(filePath: string | undefined, cwd: string): { blocked: boolean; reason?: string }`, `shouldFormat(relPath: string | undefined): boolean`, `shouldRemind({ porcelain: string; stopHookActive: boolean }): boolean`; the `plan-critic` agent used from this phase on; skills invoked as `/ethernal-nest-react:verify` and `/ethernal-nest-react:pr`. The plugin is loaded with `pnpm claude` (`claude --plugin-dir tools/claude-plugin/ethernal-nest-react`). Skills `new-module`, `add-permission`, `db-migration`, `new-admin-page`, `e2e-scenario`, `docs-sync` and agents `security-reviewer`, `qa-e2e`, `architecture-reviewer`, `docs-writer` are added in the phase that first needs them, each written with `superpowers:writing-skills`.

**Documented facts this task relies on** (verified 2026-09-23 against code.claude.com/docs): `hooks.json` is `{"hooks": {"<Event>": [{"matcher": "...", "hooks": [{"type": "command", "command": "..."}]}]}}`; `${CLAUDE_PLUGIN_ROOT}` is the plugin's absolute path; hook stdin JSON carries `tool_name`, `tool_input.file_path`, `cwd`, and for Stop `stop_hook_active`; a PreToolUse hook blocks with exit code 2 and stderr as the reason; a Stop hook prevents stopping with stdout `{"decision":"block","reason":"..."}` (a non-blocking "systemMessage" is not documented for Stop, so the reminder is a one-shot block guarded by `stop_hook_active`); agent frontmatter accepts `name`, `description`, `tools` (comma-separated), `model: inherit`; permission rules `Edit(<glob>)` also cover Write and NotebookEdit and are relative to the project directory; `**` crosses directories. A marketplace pointing at a directory inside the repo is not documented for project settings, so auto-loading is deferred to the end of the POC (spec: "publishable as a private marketplace at the end").

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

`tools/claude-plugin/tests/hooks-cli.test.mjs` (the executables, driven over stdin exactly as Claude Code drives them):

```js
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const hooks = path.resolve(import.meta.dirname, '../ethernal-nest-react/hooks');
const run = (script, input) =>
  spawnSync('node', [path.join(hooks, script)], { input: JSON.stringify(input), encoding: 'utf8' });

describe('protect-files.mjs', () => {
  it('exits 2 with a reason for a protected path', () => {
    const r = run('protect-files.mjs', { tool_name: 'Write', tool_input: { file_path: '.env' }, cwd: '/work/p' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('.env');
  });
  it('exits 0 for an ordinary path and for a notebook path', () => {
    expect(run('protect-files.mjs', { tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' }, cwd: '/work/p' }).status).toBe(0);
    expect(run('protect-files.mjs', { tool_name: 'NotebookEdit', tool_input: { notebook_path: 'docs/client/a.ipynb' }, cwd: '/work/p' }).status).toBe(2);
  });
  it('exits 0 on malformed input instead of blocking everything', () => {
    const r = spawnSync('node', [path.join(hooks, 'protect-files.mjs')], { input: 'not json', encoding: 'utf8' });
    expect(r.status).toBe(0);
  });
});

describe('format-on-edit.mjs', () => {
  it('exits 0 for a file that does not exist', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'fmt-'));
    const r = run('format-on-edit.mjs', { tool_name: 'Edit', tool_input: { file_path: 'missing.ts' }, cwd });
    expect(r.status).toBe(0);
  });
  it('exits 0 for a file with a syntax error (formatter failure is never fatal)', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'fmt-'));
    writeFileSync(path.join(cwd, 'broken.ts'), 'const = ;\n');
    const r = run('format-on-edit.mjs', { tool_name: 'Edit', tool_input: { file_path: 'broken.ts' }, cwd });
    expect(r.status).toBe(0);
  });
  it('exits 0 for a non-code file without running anything', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'fmt-'));
    const r = run('format-on-edit.mjs', { tool_name: 'Write', tool_input: { file_path: 'notes.md' }, cwd });
    expect(r.status).toBe(0);
  });
});

describe('verify-reminder.mjs', () => {
  it('exits 0 and prints nothing when stop_hook_active is true', () => {
    const r = run('verify-reminder.mjs', { hook_event_name: 'Stop', stop_hook_active: true, cwd: process.cwd() });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });
  it('exits 0 and prints nothing outside a git repository', () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
    const r = run('verify-reminder.mjs', { hook_event_name: 'Stop', stop_hook_active: false, cwd });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
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
    "validate": "claude plugin validate ethernal-nest-react --strict"
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

`tools/claude-plugin/README.md`:

```markdown
# Claude Code plugin workspace

`ethernal-nest-react/` is the plugin (loaded with `pnpm claude`, i.e.
`claude --plugin-dir tools/claude-plugin/ethernal-nest-react`). This directory around it holds
the vitest tests for the hook scripts so the plugin folder itself stays publishable.

- `pnpm --filter @tms/claude-plugin test` — hook unit and CLI tests
- `pnpm --filter @tms/claude-plugin validate` — `claude plugin validate --strict` (needs the Claude CLI)
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
 * @param {string | undefined} filePath absolute or relative to `cwd`
 * @param {string} cwd project directory
 * @returns {{ blocked: boolean, reason?: string }}
 */
export function classifyEdit(filePath, cwd) {
  if (!filePath) return { blocked: false };
  const abs = path.resolve(cwd, filePath);
  const rel = path.relative(cwd, abs).split(path.sep).join('/');
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
 *   porcelain: output of `git status --porcelain`; stopHookActive: true when this Stop
 *   already blocked once in this turn (never block twice).
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

`hooks/protect-files.mjs`:

```js
#!/usr/bin/env node
import { readStdinJson } from './lib/stdin.mjs';
import { classifyEdit } from './lib/protect.mjs';

const input = await readStdinJson();
const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
const verdict = classifyEdit(filePath, input.cwd ?? process.cwd());
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

const input = await readStdinJson();
const cwd = input.cwd ?? process.cwd();
const filePath = input.tool_input?.file_path;
if (!filePath) process.exit(0);

const abs = path.resolve(cwd, filePath);
const rel = path.relative(cwd, abs);
if (rel.startsWith('..') || !shouldFormat(rel) || !existsSync(abs)) process.exit(0);

// Formatting is best effort: a parse error in a half-written file must never block Claude.
const run = (args) => {
  try {
    execFileSync('pnpm', ['exec', ...args, abs], { cwd, stdio: 'ignore', timeout: 45_000 });
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

const input = await readStdinJson();
const cwd = input.cwd ?? process.cwd();

let porcelain = '';
try {
  porcelain = execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  process.exit(0); // not a git repository: nothing to remind about
}

if (shouldRemind({ porcelain, stopHookActive: Boolean(input.stop_hook_active) })) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: REMINDER }));
}
process.exit(0);
```

- [ ] **Step 4: Run the hook tests**

Run: `pnpm install && pnpm --filter @tms/claude-plugin test lint`
Expected: 52 tests pass (protect 20, format 20, reminder 4, cli 8).

- [ ] **Step 5: Write the `plan-critic` agent**

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

- [ ] **Step 6: Write the `verify` and `pr` skills**

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

- **Hooks**: `PreToolUse` blocks edits to `.env`, `.env.*` (except `*.example`) and `docs/client/**`;
  `PostToolUse` runs eslint --fix and prettier on edited TypeScript/JavaScript files; `Stop`
  reminds (once) to run `pnpm verify` when `apps/` or `packages/` have uncommitted changes.
- **Agents**: `plan-critic` (read-only critic for specs and plans).
- **Skills**: `verify`, `pr`. More (`new-module`, `add-permission`, `db-migration`,
  `new-admin-page`, `e2e-scenario`, `docs-sync`) and agents (`security-reviewer`, `qa-e2e`,
  `architecture-reviewer`, `docs-writer`) arrive with the phases that need them.

Load: `claude --plugin-dir tools/claude-plugin/ethernal-nest-react` (or `pnpm claude`).
Validate: `claude plugin validate tools/claude-plugin/ethernal-nest-react --strict`.
```

- [ ] **Step 7: Write the project settings**

`.claude/settings.json` (always-on layer that does not depend on the plugin being loaded; the hook adds the `.env.*` nuance):

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
      "Bash(pnpm --filter:*)",
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
    "deny": ["Edit(docs/client/**)", "Edit(.env)", "Edit(**/.env)"]
  }
}
```

If `claude plugin validate --strict` or Claude Code rejects the `$schema` key, remove it.

- [ ] **Step 8: Validate the plugin with the CLI**

Run: `~/.local/bin/claude plugin validate tools/claude-plugin/ethernal-nest-react --strict; echo exit=$?`
Expected: report with no errors or warnings, exit 0. Fix any flagged frontmatter field and re-run.

Manual hook check (record in the journal): start `pnpm claude` in a terminal, ask Claude to append a comment to `apps/api-admin/.env.example` (allowed) and to `docs/client/README.md` (blocked with the reason shown), then edit a `.ts` file with bad spacing and confirm the file is formatted after the edit. If this cannot be done in the current environment, mark it `not run` in the PR.

- [ ] **Step 9: Commit**

```bash
git add tools/claude-plugin .claude/settings.json pnpm-lock.yaml
git commit -m "feat(plugin): add ethernal-nest-react plugin skeleton with protect/format/verify hooks, plan-critic agent and verify/pr skills"
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
- `pnpm compose --profile full up -d --build && infra/smoke.sh --full && pnpm e2e` — production-like
  stack behind Caddy (:8080 admin, :8081 kiosk) plus Playwright
- `pnpm claude` — Claude Code with the project plugin (`tools/claude-plugin/ethernal-nest-react`)

## Where things live

- `apps/api-admin`, `apps/api-driver` — NestJS; controllers only, no logic
- `apps/web-admin`, `apps/web-driver` — React SPAs
- `packages/config` — shared tsconfig/eslint/jest presets; `packages/db` — Prisma schema and migrations
- `packages/contracts`, `auth-core`, `domain`, `logger`, `ui` — arrive in phases 1-6 (see spec §6)
- `infra/` — compose, Dockerfiles, Caddyfile, `smoke.sh`; `e2e/` — Playwright
- `tools/scripts` — hygiene + gitleaks wrapper; `tools/claude-plugin` — Claude plugin and its tests
- `docs/adr/` — decisions; `docs/architecture.md` — technical docs; `docs/efficiency/` — journals
- `docs/client/` — client documents, gitignored, never committed, never modified by Claude

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
- Claude Code 2.1+ with the Claude in Chrome extension for visual verification (optional)

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
git add CLAUDE.md README.md .github/pull_request_template.md docs/architecture.md docs/adr
git commit -m "docs: add CLAUDE.md, README, PR template, architecture skeleton and ADR 0001-0002"
```

---

### Task 12: `claude --chrome` check, ruleset required checks, journal

**Files:**
- Modify: `docs/efficiency/critical-path.md` (rows for every task of this phase, the critic pass and the chrome check)
- Outside the repository: GitHub ruleset `main: pull requests only` (id 23869173)

**Interfaces:**
- Consumes: CI check names `verify`, `hygiene`, `db-drift`, `e2e` (Task 9), compose `full` stack (Task 5).
- Produces: `main` requires those four checks (strict policy); recorded chrome outcome.

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

- [ ] **Step 3: Update the journal**

Append one row per task (1-11), one for the critic pass over this plan, one for the chrome check and one for the PR, following the existing columns of `docs/efficiency/critical-path.md`. Times in Europe/Belgrade; `Approach` is `subagent` for tasks executed by implementer subagents, `human` for the chrome check if Stefan performed it.

```bash
git add docs/efficiency/critical-path.md
git commit -m "docs: log phase 0 tasks, critic pass and verification in the efficiency journal"
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

Title: `build: phase 0 bootstrap — monorepo, tooling, compose, CI, hooks, Claude plugin skeleton`. Body from `.github/pull_request_template.md` with: what/why (spec §16 phase 0), a `block`/flowchart Mermaid of the compose topology, boundaries (all new; no migration), the verification table with real outcomes (config eslint test, API env + e2e-spec counts, web render tests, `prisma validate` + drift, smoke default and full, Playwright 6/6, hygiene tests, gitleaks tests, commitlint demos, hook tests, plugin validate, CI run URLs, chrome check), risks (Task 5 fallbacks used if any, undocumented marketplace directory source, `test` profile deferred to phase 2, boundaries element-types exercised in phase 1, chrome check status).

```bash
gh pr create --base main --title "..." --body-file /tmp/pr-body.md
```

- [ ] **Step 3: Review**

Run `/code-review` on the PR (no auth code in this phase, so `security-reviewer` is not mandatory). Address findings per `superpowers:receiving-code-review`. Hand over to Stefan for merge.

---

## Deliberate deviations and open points for the critic

1. Caddy is in the `full` profile, not the default one (spec 17.1 lists it among default services): without app containers it has no upstreams; in dev Vite proxies (D11).
2. Compose `test` profile (shortened lockouts) deferred to phase 2 when lockout exists.
3. `packages/db` exists in phase 0 (spec lists `db` under phase 1) but only as schema + config, so `migrate`, `predev` and the drift check are real from the start.
4. `boundaries/element-types` is configured but only testable in phase 1 when `packages/contracts`, `domain` etc. exist; the api-driver subpath restriction is tested now.
5. The Stop hook is a one-shot `decision: block` reminder (guarded by `stop_hook_active`) because a non-blocking Stop message is not documented.
6. Plugin auto-loading via a project marketplace is not documented for directory sources; `pnpm claude` and CLAUDE.md carry the `--plugin-dir` instruction until the private marketplace at the end of the POC.
7. No LICENSE file is added: the repository is public and the choice of licence is Stefan's.
8. The `claude --chrome` check needs a terminal session with the extension; an autonomous session inside VS Code cannot perform it and must report `not run`.
