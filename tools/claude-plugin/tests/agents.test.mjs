import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const agentsDir = join(import.meta.dirname, '..', 'ethernal-nest-react', 'agents');
const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

function frontmatter(file) {
  const text = readFileSync(join(agentsDir, file), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error(`${file}: no frontmatter`);
  const fields = Object.fromEntries(
    match[1].split('\n').map((line) => {
      const i = line.indexOf(':');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  return { fields, body: text.slice(match[0].length) };
}

describe('plugin agents', () => {
  const files = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));

  it('ships the security reviewer next to the plan critic', () => {
    expect(files.sort()).toEqual(['plan-critic.md', 'security-reviewer.md']);
  });

  it.each(files)('%s has a name matching its file and a description', (file) => {
    const { fields } = frontmatter(file);
    expect(fields.name).toBe(file.replace(/\.md$/, ''));
    expect(fields.description.length).toBeGreaterThan(40);
  });

  it.each(files)('%s is read-only (no write tools)', (file) => {
    const tools = frontmatter(file)
      .fields.tools.split(',')
      .map((t) => t.trim());
    for (const tool of WRITE_TOOLS) expect(tools).not.toContain(tool);
  });

  it('security reviewer covers every section 13 security topic', () => {
    const { body } = frontmatter('security-reviewer.md');
    for (const topic of [
      'brute force',
      'rate limit',
      'Origin',
      'cookie',
      'token reuse',
      'replay',
      'device key',
      'IDOR',
      'revocation',
      'enumeration',
      'last admin',
      'step-up',
    ]) {
      expect(body.toLowerCase()).toContain(topic.toLowerCase());
    }
  });
});
