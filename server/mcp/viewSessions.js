import { randomUUID } from 'node:crypto';
import { isLocalMcpRequest } from './plugin.js';
import { defineTool, ToolError } from '../../src/tools/catalog.js';

const ACTIONS = new Set([
  'list',
  'save',
  'restore',
  'remove',
  'undo',
  'selectionMode',
]);

/** Bounded, in-memory relay. Commands expire rather than executing after a tab returns. */
export function createViewSessionRelay({
  now = Date.now,
  timeoutMs = 8000,
} = {}) {
  const sessions = new Map();
  const pending = new Map();
  function prune() {
    for (const [id, session] of sessions)
      if (now() - session.seen > 15000) sessions.delete(id);
  }
  function exchange({ session, replies = [] }) {
    if (
      typeof session !== 'string' ||
      !/^[a-zA-Z0-9-]{1,64}$/.test(session) ||
      !Array.isArray(replies) ||
      replies.length > 32
    )
      throw new Error('Invalid view session');
    prune();
    if (!sessions.has(session) && sessions.size >= 32)
      throw new Error('View session limit reached');
    for (const reply of replies) {
      const request = pending.get(reply.id);
      if (request?.session === session) {
        clearTimeout(request.timer);
        pending.delete(reply.id);
        if (reply.error)
          request.reject(
            new ToolError('unavailable', String(reply.error).slice(0, 200)),
          );
        else request.resolve(reply.result);
      }
    }
    const state = sessions.get(session) ?? { commands: [] };
    state.seen = now();
    sessions.set(session, state);
    const commands = state.commands.filter((command) =>
      pending.has(command.id),
    );
    state.commands = [];
    return { commands };
  }
  function list() {
    prune();
    return [...sessions].map(([id, state]) => ({
      session: id,
      lastSeen: state.seen,
    }));
  }
  function call(session, action, args = []) {
    prune();
    if (!ACTIONS.has(action))
      throw new ToolError('invalid_arguments', 'Unknown view action');
    const active = list();
    session ||= active.length === 1 ? active[0].session : null;
    if (!session || !sessions.has(session))
      throw new ToolError(
        'unavailable',
        'Open the local globe; if multiple tabs are open, supply a session from list_view_sessions',
      );
    if (pending.size >= 32)
      throw new ToolError('retry_later', 'Too many pending view commands');
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        const state = sessions.get(session);
        if (state)
          state.commands = state.commands.filter(
            (command) => command.id !== id,
          );
        reject(
          new ToolError(
            'unavailable',
            'Browser did not acknowledge the view command; inspect its state before retrying',
          ),
        );
      }, timeoutMs);
      pending.set(id, { session, resolve, reject, timer });
      sessions.get(session).commands.push({ id, action, args });
    });
  }
  return { exchange, list, call };
}

const sessionProperty = {
  type: 'string',
  description:
    'Browser session from list_view_sessions; optional when exactly one local tab is connected.',
};

/** Local-only MCP tools, sharing the browser controls' implementation and storage. */
export function viewSessionTools(relay) {
  const spec = (
    name,
    title,
    description,
    action,
    properties = {},
    required = [],
    args = () => [],
  ) =>
    defineTool({
      name,
      title,
      description,
      kind: action === 'list' || action === 'sessions' ? 'query' : 'action',
      inputSchema: {
        type: 'object',
        properties:
          action === 'sessions'
            ? {}
            : { session: sessionProperty, ...properties },
        required,
        additionalProperties: false,
      },
      async run(input) {
        const data =
          action === 'sessions'
            ? { sessions: await relay.list() }
            : await relay.call(input.session, action, args(input));
        return { summary: title, data: data ?? {} };
      },
    });
  const name = { type: 'string', minLength: 1, maxLength: 80 };
  return [
    spec(
      'list_view_sessions',
      'List local globe tabs',
      'List browser tabs connected to this local app server. Choose a session when more than one is open.',
      'sessions',
    ),
    spec(
      'list_saved_views',
      'List saved camera views',
      'Read named camera bookmarks stored in the selected browser. Requires an open local globe tab.',
      'list',
    ),
    spec(
      'save_view',
      'Save current camera view',
      'Save the selected tab camera position and orientation under a name. Existing names require overwrite=true. Does not change the camera.',
      'save',
      { name, overwrite: { type: 'boolean' } },
      ['name'],
      (input) => [input.name, input.overwrite ?? false],
    ),
    spec(
      'restore_view',
      'Restore saved camera view',
      'Move the selected tab camera to a saved view, releasing follow/cockpit camera ownership. Does not change enabled layers or styling.',
      'restore',
      { name },
      ['name'],
      (input) => [input.name],
    ),
    spec(
      'delete_saved_view',
      'Delete saved camera view',
      'Remove a named camera bookmark from the selected browser.',
      'remove',
      { name },
      ['name'],
      (input) => [input.name],
    ),
    spec(
      'restore_previous_view',
      'Return to previous view',
      'Return to the camera position from before the last saved-view restore in this tab.',
      'undo',
    ),
    spec(
      'set_selection_camera',
      'Set selection camera behavior',
      'Choose whether ordinary object clicks focus the camera. false highlights/selects in place; explicit Focus and Follow remain available.',
      'selectionMode',
      { focus: { type: 'boolean' } },
      ['focus'],
      (input) => [input.focus],
    ),
  ];
}

/** Install a bounded browser relay, guarded identically to the local MCP endpoint. */
export function viewSessionsPlugin({ relay = createViewSessionRelay() } = {}) {
  const install = (server) => {
    for (const path of ['/api/view-session', '/api/view-control'])
      server.middlewares.use(path, async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        const reply = (status, data) => {
          res.statusCode = status;
          res.end(JSON.stringify(data));
        };
        if (
          !isLocalMcpRequest({
            remoteAddress: req.socket?.remoteAddress,
            localPort: req.socket?.localPort,
            host: req.headers.host,
            origin: req.headers.origin,
            headers: req.headers,
            env: process.env,
          })
        )
          return reply(403, { error: 'Local view sessions only' });
        if (
          req.method !== 'POST' ||
          !String(req.headers['content-type']).startsWith('application/json')
        )
          return reply(405, { error: 'POST JSON required' });
        let body = '';
        const timer = setTimeout(() => {
          reply(408, { error: 'Request timed out' });
          req.destroy();
        }, 5000);
        try {
          for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 65536) {
              reply(413, { error: 'Request too large' });
              req.destroy();
              return;
            }
          }
          const input = JSON.parse(body);
          if (path === '/api/view-control') {
            if (
              !input ||
              !Array.isArray(input.args ?? []) ||
              (input.args ?? []).length > 3
            )
              throw new Error('Invalid command');
            clearTimeout(timer);
            try {
              const data =
                input.action === 'sessions'
                  ? relay.list()
                  : await relay.call(input.session, input.action, input.args);
              reply(200, { data });
            } catch (error) {
              reply(200, { error: error.message });
            }
          } else reply(200, relay.exchange(input));
        } catch {
          if (!res.writableEnded)
            reply(400, { error: 'Invalid view session request' });
        } finally {
          clearTimeout(timer);
        }
      });
  };
  return {
    name: 'gev-view-sessions',
    configureServer: install,
    configurePreviewServer: install,
  };
}
