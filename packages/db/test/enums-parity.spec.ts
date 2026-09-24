import { DB_MIRRORED_ENUMS } from '@tms/contracts';
import { $Enums } from '../src';

/** Every mirrored enum now exists in the schema; the list stays so a later phase can stage a new enum. */
const NOT_YET_IN_SCHEMA: readonly string[] = [];

const mirrored: Record<string, { options: readonly (string | number)[] }> = {
  ...DB_MIRRORED_ENUMS,
};
const generated: Record<string, Record<string, string>> = { ...$Enums };

const expectedNames = Object.keys(mirrored)
  .filter((name) => !NOT_YET_IN_SCHEMA.includes(name))
  .sort();

describe('enum parity between @tms/contracts and schema.prisma', () => {
  it('generates exactly the mirrored enums that exist in the schema so far', () => {
    expect(expectedNames).toHaveLength(14);
    expect(Object.keys(generated).sort()).toEqual(expectedNames);
  });

  it.each(expectedNames)('%s has the same members in both places', (name) => {
    const schema = mirrored[name];
    if (schema === undefined) {
      throw new Error(`${name} is not in DB_MIRRORED_ENUMS`);
    }
    expect(Object.values(generated[name] ?? {}).sort()).toEqual([...schema.options].sort());
  });
});
