import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const pluginRoot = path.join(repoRoot, 'tools/claude-plugin/ethernal-nest-react');
const hooksConfig = JSON.parse(readFileSync(path.join(pluginRoot, 'hooks/hooks.json'), 'utf8'));

function matchersFor(event) {
  return (hooksConfig.hooks[event] ?? []).flatMap((entry) =>
    (entry.matcher ?? '').split(/[|,]/).filter(Boolean),
  );
}

function commandsFor(event) {
  return (hooksConfig.hooks[event] ?? []).flatMap((entry) => entry.hooks.map((h) => h.command));
}

describe('hooks.json wiring (9-I2)', () => {
  it('wires PreToolUse to Edit, Write and NotebookEdit', () => {
    const matchers = matchersFor('PreToolUse');
    for (const tool of ['Edit', 'Write', 'NotebookEdit']) {
      expect(matchers).toContain(tool);
    }
  });

  it('wires PostToolUse to Edit and Write', () => {
    const matchers = matchersFor('PostToolUse');
    for (const tool of ['Edit', 'Write']) {
      expect(matchers).toContain(tool);
    }
  });

  it('points every hook command at a script that actually exists on disk', () => {
    for (const event of Object.keys(hooksConfig.hooks)) {
      for (const command of commandsFor(event)) {
        const resolved = command.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot);
        const match = resolved.match(/node "([^"]+)"/);
        expect(match, `unexpected command shape for ${event}: ${command}`).not.toBeNull();
        expect(existsSync(match[1]), `${match[1]} (from ${event}) does not exist`).toBe(true);
      }
    }
  });

  it('the wired PreToolUse command actually blocks an absolute .env path', () => {
    const command = hooksConfig.hooks.PreToolUse[0].hooks[0].command;
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: path.join(repoRoot, '.env') },
      cwd: repoRoot,
    });
    const result = spawnSync('sh', ['-c', command], {
      input: payload,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PROJECT_DIR: repoRoot },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('.env');
  });
});
