/** The project root Claude Code started in; the payload's cwd may be a subdirectory. */
export function projectRoot(input) {
  return process.env['CLAUDE_PROJECT_DIR'] ?? input.cwd ?? process.cwd();
}
