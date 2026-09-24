import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(dir, e.name))
      : e.name.endsWith('.ts')
        ? [join(dir, e.name)]
        : [],
  );
}

describe('auth-core purity (spec section 3)', () => {
  it.each(sources(join(__dirname, '..', 'src')))(
    '%s imports no workspace package, Nest or Prisma',
    (file) => {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/from ['"]@tms\//);
      expect(text).not.toMatch(/from ['"]@nestjs\//);
      expect(text).not.toMatch(/from ['"](@prisma\/|prisma)/);
    },
  );
});
