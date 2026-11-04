import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewSessionRelay, viewSessionTools } from './viewSessions.js';
import { composeCatalog } from '../../src/tools/catalog.js';

test('MCP uses the chosen browser, waits for acknowledgement and returns its result', async () => {
  const relay = createViewSessionRelay();
  relay.exchange({ session: 'first' });
  relay.exchange({ session: 'second' });
  const catalog = composeCatalog({ tools: viewSessionTools(relay) });
  const sessions = await catalog.call('list_view_sessions', {});
  assert.equal(sessions.data.sessions.length, 2);
  await assert.rejects(
    catalog.call('save_view', { name: 'Home' }),
    /multiple tabs/,
  );
  const saving = catalog.call('save_view', { session: 'first', name: 'Home' });
  assert.deepEqual(relay.exchange({ session: 'second' }).commands, []);
  const { commands } = relay.exchange({ session: 'first' });
  assert.equal(commands[0].action, 'save');
  assert.deepEqual(commands[0].args, ['Home', false]);
  relay.exchange({
    session: 'second',
    replies: [{ id: commands[0].id, result: 'wrong tab' }],
  });
  relay.exchange({
    session: 'first',
    replies: [{ id: commands[0].id, result: { name: 'Home' } }],
  });
  assert.deepEqual((await saving).data, { name: 'Home' });
});
test('timed out commands do not run when a tab returns', async () => {
  const relay = createViewSessionRelay({ timeoutMs: 10 });
  relay.exchange({ session: 'tab' });
  await assert.rejects(relay.call('tab', 'restore', ['Home']), /acknowledge/);
  assert.deepEqual(relay.exchange({ session: 'tab' }).commands, []);
});
test('browser failures are returned truthfully and stale sessions expire', async () => {
  let now = 0;
  const relay = createViewSessionRelay({ now: () => now });
  relay.exchange({ session: 'tab' });
  const saving = relay.call('tab', 'save', ['Home']);
  const [{ id }] = relay.exchange({ session: 'tab' }).commands;
  relay.exchange({ session: 'tab', replies: [{ id, error: 'Storage full' }] });
  await assert.rejects(saving, /Storage full/);
  now = 16000;
  assert.deepEqual(relay.list(), []);
});

test('real HTTP relay supports stdio calls and rejects cross-origin/proxy requests', async (t) => {
  const { createServer } = await import('node:http');
  const { viewSessionsPlugin } = await import('./viewSessions.js');
  const { createRemoteViewRelay } = await import('./viewSessionClient.js');
  const routes = new Map();
  viewSessionsPlugin().configureServer({
    middlewares: { use: (path, handler) => routes.set(path, handler) },
  });
  const server = createServer((req, res) => {
    const handler = routes.get(req.url);
    if (handler) void handler(req, res);
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, body, headers = {}) {
    return fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }
  await post('/api/view-session', { session: 'browser' });
  const remote = createRemoteViewRelay({ apiBase: base });
  assert.equal((await remote.list())[0].session, 'browser');
  const response = remote.call('browser', 'restore', ['Home']);
  let commands = [];
  for (let attempt = 0; attempt < 20 && !commands.length; attempt++) {
    ({ commands } = await (
      await post('/api/view-session', { session: 'browser' })
    ).json());
  }
  assert.equal(commands[0].action, 'restore');
  await post('/api/view-session', {
    session: 'browser',
    replies: [{ id: commands[0].id, result: { name: 'Home' } }],
  });
  assert.deepEqual(await response, { name: 'Home' });
  for (const path of ['/api/view-session', '/api/view-control']) {
    assert.equal(
      (await post(path, {}, { Origin: 'https://other.invalid' })).status,
      403,
    );
    assert.equal(
      (await post(path, {}, { 'X-Forwarded-For': '192.0.2.1' })).status,
      403,
    );
  }
});
