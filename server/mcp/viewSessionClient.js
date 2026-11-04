import { ToolError } from '../../src/tools/catalog.js';

/** The stdio MCP process reaches the running app's own local view relay. */
export function createRemoteViewRelay({
  apiBase,
  fetchImpl = globalThis.fetch,
}) {
  async function request(body) {
    let response;
    try {
      response = await fetchImpl(new URL('/api/view-control', apiBase), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new ToolError('unavailable', 'The local app server is unavailable');
    }
    if (!response.ok)
      throw new ToolError(
        'unavailable',
        'Local view control is unavailable; open the globe on this server',
      );
    const result = await response.json();
    if (result.error) throw new ToolError('unavailable', result.error);
    return result.data;
  }
  return {
    list: () => request({ action: 'sessions' }),
    call: (session, action, args) => request({ session, action, args }),
  };
}
