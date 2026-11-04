/** Connect a local browser tab to the local MCP server's view commands. */
export function connectViewSession(
  actions,
  { fetchImpl = globalThis.fetch, intervalMs = 1000 } = {},
) {
  const session =
    globalThis.crypto?.randomUUID?.() ??
    `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const controller = new AbortController();
  let timer;
  let replies = [];
  async function poll() {
    try {
      const response = await fetchImpl('/api/view-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, replies }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      });
      if (response.status === 403 || response.status === 404) return;
      if (!response.ok) throw new Error('View session unavailable');
      const { commands } = await response.json();
      replies = [];
      for (const command of commands) {
        try {
          const action = actions[command.action];
          if (typeof action !== 'function')
            throw new Error('Unknown view action');
          replies.push({
            id: command.id,
            result: await action(...command.args),
          });
        } catch (error) {
          replies.push({ id: command.id, error: error.message });
        }
      }
    } catch {
      /* Retry transient failures without interrupting the globe. */
    }
    if (!controller.signal.aborted) timer = setTimeout(poll, intervalMs);
  }
  void poll();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
