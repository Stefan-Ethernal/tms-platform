import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { nodeConfig } from '../eslint/node.mjs';

const warnings = [];
vi.spyOn(console, 'warn').mockImplementation((...args) => {
  warnings.push(args.join(' '));
});

/** pnpm-style workspace: exports-only packages, dist stubs, node_modules symlinks. */
function createWorkspace() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tms-boundaries-')));
  const entry = (p) => ({ types: `./dist/${p}index.d.ts`, default: `./dist/${p}index.js` });
  const pkg = (dir, name, exports) => {
    fs.mkdirSync(path.join(root, dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, dir, 'dist', 'shared'), { recursive: true });
    fs.writeFileSync(
      path.join(root, dir, 'package.json'),
      JSON.stringify({ name, type: 'module', exports }),
    );
    for (const f of ['index', 'shared/index']) {
      fs.writeFileSync(
        path.join(root, dir, 'dist', `${f}.d.ts`),
        'export declare const x: number;\n',
      );
      fs.writeFileSync(path.join(root, dir, 'dist', `${f}.js`), 'export const x = 1;\n');
    }
  };
  pkg('packages/contracts', '@tms/contracts', { '.': entry('') });
  pkg('packages/db', '@tms/db', { '.': entry('') });
  pkg('packages/domain', '@tms/domain', { '.': entry(''), './shared': entry('shared/') });
  pkg('packages/nest-bootstrap', '@tms/nest-bootstrap', { '.': entry('') });
  for (const app of ['api-admin', 'web-admin']) {
    fs.mkdirSync(path.join(root, 'apps', app, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'apps', app, 'package.json'),
      JSON.stringify({ name: `@tms/${app}`, private: true }),
    );
  }
  const link = (from, dep, target) => {
    const linkPath = path.join(root, from, 'node_modules', dep);
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(path.relative(path.dirname(linkPath), path.join(root, target)), linkPath, 'dir');
  };
  link('packages/contracts', '@tms/db', 'packages/db');
  link('packages/db', '@tms/domain', 'packages/domain');
  link('packages/db', '@tms/contracts', 'packages/contracts');
  link('packages/domain', '@tms/db', 'packages/db');
  link('packages/nest-bootstrap', '@tms/domain', 'packages/domain');
  link('apps/api-admin', '@tms/nest-bootstrap', 'packages/nest-bootstrap');
  link('apps/web-admin', '@tms/nest-bootstrap', 'packages/nest-bootstrap');
  fs.mkdirSync(path.join(root, 'packages/contracts/node_modules/zod'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'packages/contracts/node_modules/zod/package.json'),
    JSON.stringify({ name: 'zod', main: 'index.js' }),
  );
  fs.writeFileSync(
    path.join(root, 'packages/contracts/node_modules/zod/index.js'),
    'module.exports = {};\n',
  );
  return root;
}

let ws;
beforeAll(() => {
  ws = createWorkspace();
});
afterAll(() => {
  fs.rmSync(ws, { recursive: true, force: true });
});

async function lint(relFile, source) {
  const eslint = new ESLint({
    cwd: ws,
    overrideConfigFile: true,
    overrideConfig: [
      ...nodeConfig({ tsconfigRootDir: ws, boundariesRootPath: ws }),
      tseslint.configs.disableTypeChecked,
    ],
  });
  const [result] = await eslint.lintText(source, { filePath: path.join(ws, relFile) });
  return result.messages;
}
const boundaryMessages = (messages) =>
  messages.filter((m) => m.ruleId === 'boundaries/dependencies').map((m) => m.message);
const RULE = '(dependency rule contracts <- db <- domain <- apps)';

describe('dependency rule over @tms/* package specifiers (pnpm symlinks, exports-only package.json)', () => {
  it('(a) forbids contracts importing @tms/db', async () => {
    const messages = await lint(
      'packages/contracts/src/x.ts',
      `import { x } from '@tms/db';\nexport { x };\n`,
    );
    expect(boundaryMessages(messages)).toEqual([`contracts may not import db ${RULE}`]);
  });
  it('(b) forbids db importing the @tms/domain/shared subpath export', async () => {
    const messages = await lint(
      'packages/db/src/x.ts',
      `import { x } from '@tms/domain/shared';\nexport { x };\n`,
    );
    expect(boundaryMessages(messages)).toEqual([`db may not import domain ${RULE}`]);
  });
  it('(c) allows domain importing @tms/db', async () => {
    const messages = await lint(
      'packages/domain/src/x.ts',
      `import { x } from '@tms/db';\nexport { x };\n`,
    );
    expect(boundaryMessages(messages)).toEqual([]);
  });
  it('(d) ignores external packages such as zod', async () => {
    const messages = await lint(
      'packages/contracts/src/y.ts',
      `import { z } from 'zod';\nexport { z };\n`,
    );
    expect(boundaryMessages(messages)).toEqual([]);
  });
  it('(e) forbids nest-bootstrap importing @tms/domain', async () => {
    const messages = await lint(
      'packages/nest-bootstrap/src/x.ts',
      `import { x } from '@tms/domain';\nexport { x };\n`,
    );
    expect(boundaryMessages(messages)).toEqual([`bootstrap may not import domain ${RULE}`]);
  });
  it('(f) allows an api app importing @tms/nest-bootstrap', async () => {
    const messages = await lint(
      'apps/api-admin/src/x.ts',
      `import { b } from '@tms/nest-bootstrap';\nexport { b };\n`,
    );
    expect(boundaryMessages(messages)).toEqual([]);
  });
  it('(g) forbids a web app importing @tms/nest-bootstrap', async () => {
    const messages = await lint(
      'apps/web-admin/src/x.ts',
      `import { b } from '@tms/nest-bootstrap';\nexport { b };\n`,
    );
    expect(boundaryMessages(messages)).toEqual([`web may not import bootstrap ${RULE}`]);
  });
  it('configures the plugin without deprecation warnings', () => {
    expect(warnings.filter((w) => w.includes('[boundaries]'))).toEqual([]);
  });
});
