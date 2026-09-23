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
