'use strict';

// TypeScript 7 ships the native "tsc" compiler only; the classic JS Compiler API returns
// in 7.1 (https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0).
// typescript-eslint (and the sub-packages it loads for type-aware linting) throws at
// import time when it sees TypeScript >= 7, so every package below needs the classic 6.x
// compiler while the rest of the workspace stays on the catalog's typescript@~7.0.2.
//
// A plain `overrides`/`packageExtensions` entry does not work here: most consumers of
// typescript-eslint (packages/config, each app) already have typescript@~7.0.2 as a
// sibling devDependency, and pnpm's peer-dependency resolution prefers that already-present
// sibling over anything declared in overrides/packageExtensions. This hook instead rewrites
// each package's own manifest before pnpm resolves it, turning the "typescript" peer
// dependency into a hard dependency on @typescript/typescript6 (kept in sync with the
// pnpm-workspace.yaml catalog entry of the same name) so it resolves independently of
// whatever "typescript" the consuming package/app declares for its own tsc/vite build.
const TS6_ALIAS = 'npm:@typescript/typescript6@~6.0.2';

const NEEDS_TS6 = new Set([
  'typescript-eslint',
  '@typescript-eslint/parser',
  '@typescript-eslint/project-service',
  '@typescript-eslint/tsconfig-utils',
  '@typescript-eslint/typescript-estree',
  '@typescript-eslint/utils',
  '@typescript-eslint/eslint-plugin',
  '@typescript-eslint/type-utils',
  'ts-api-utils',
]);

function readPackage(pkg) {
  if (NEEDS_TS6.has(pkg.name)) {
    pkg.dependencies = pkg.dependencies || {};
    pkg.dependencies.typescript = TS6_ALIAS;
    if (pkg.peerDependencies) {
      delete pkg.peerDependencies.typescript;
    }
    if (pkg.peerDependenciesMeta) {
      delete pkg.peerDependenciesMeta.typescript;
    }
  }
  return pkg;
}

module.exports = {
  hooks: { readPackage },
};
