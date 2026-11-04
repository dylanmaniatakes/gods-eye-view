#!/usr/bin/env node
// Run against a local dev server: QA_BASE_URL=http://localhost:4185 node scripts/qa-saved-views.mjs
// Verifies real browser controls, persistent camera bookmarks and the HTTP MCP path.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { chromeExecutablePath } from './qa-chrome.mjs';
import { createRemoteViewRelay } from '../server/mcp/viewSessionClient.js';
const base = process.env.QA_BASE_URL || 'http://localhost:4173';
const relay = createRemoteViewRelay({ apiBase: base });
const browser = await puppeteer.launch({
  headless: true,
  protocolTimeout: 120000,
  executablePath: chromeExecutablePath(),
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-webgl',
  ],
});
try {
  console.log('Browser launched');
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120000);
  await page.setViewport({ width: 1440, height: 950 });
  console.log('Loading globe');
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  console.log('Document loaded');
  await page.waitForFunction(
    () => window.__godsEyeView?.styleManager?.savedViews,
    { timeout: 120000 },
  );
  await page.evaluate(() => {
    const { viewer } = window.__godsEyeView;
    viewer.camera.cancelFlight();
    viewer.trackedEntity = undefined;
  });
  const initial = await page.evaluate(() =>
    window.__godsEyeView.styleManager.getCameraState(),
  );
  console.log('Globe ready; opening views');
  await page.click('#saved-views-toggle');
  await page.type('.saved-views-panel form input', 'QA overview');
  await page.$eval('.saved-views-panel form', (form) => form.requestSubmit());
  await page.waitForFunction(() =>
    document
      .querySelector('.saved-views-panel li')
      ?.textContent.includes('QA overview'),
  );
  console.log('View saved through UI');
  const [session] = await relay.list();
  assert.ok(session);
  assert.equal(
    (await relay.call(session.session, 'list'))[0].name,
    'QA overview',
  );
  await page.evaluate(async () => {
    const Cartesian3 = window.__godsEyeView.viewer.camera.position.constructor;
    window.__godsEyeView.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(-75, 40, 50000),
      orientation: { heading: 0.4, pitch: -0.9, roll: 0 },
    });
  });
  const moved = await page.evaluate(() =>
    window.__godsEyeView.styleManager.getCameraState(),
  );
  let rpcId = 0;
  async function tool(name, args) {
    const response = await fetch(new URL('/mcp', base), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    const json = await response.json();
    assert.ok(!json.error, JSON.stringify(json.error));
    assert.ok(!json.result.isError, JSON.stringify(json.result));
    return json.result;
  }
  console.log('Restoring through MCP');
  await tool('restore_view', { session: session.session, name: 'QA overview' });
  const restored = await page.evaluate(() =>
    window.__godsEyeView.styleManager.getCameraState(),
  );
  for (const key of Object.keys(initial))
    assert.ok(Math.abs(initial[key] - restored[key]) < 0.01, `${key} restored`);
  await tool('restore_previous_view', { session: session.session });
  const undone = await page.evaluate(() =>
    window.__godsEyeView.styleManager.getCameraState(),
  );
  for (const key of Object.keys(moved))
    assert.ok(Math.abs(moved[key] - undone[key]) < 0.01, `${key} undo`);
  await tool('set_selection_camera', {
    session: session.session,
    focus: false,
  });
  const before = await page.evaluate(() =>
    window.__godsEyeView.styleManager.getCameraState(),
  );
  await page.evaluate(async () => {
    const Cartesian3 = window.__godsEyeView.viewer.camera.position.constructor;
    const { requestWorldFocus } = await import('/src/worldFocus.js');
    requestWorldFocus({
      kind: 'fire',
      id: 'qa-fire',
      position: Cartesian3.fromDegrees(-76, 41),
      label: 'QA synthetic fire',
    });
  });
  const after = await page.evaluate(() =>
    window.__godsEyeView.styleManager.getCameraState(),
  );
  assert.deepEqual(
    after,
    before,
    'ordinary world selection keeps the camera unchanged',
  );
  // Exercise the real aircraft click handler with a synthetic contact.
  await page.evaluate(async () => {
    const app = window.__godsEyeView;
    const nativeFetch = window.fetch;
    window.fetch = (input, init) =>
      String(input).includes('/api/flights')
        ? Promise.resolve(
            Response.json({ time: Date.now() / 1000, states: [] }),
          )
        : nativeFetch(input, init);
    await app.dataManager.setEnabled('flights', true);
    const layer = app.dataManager.layers.get('flights').module;
    const Cartesian3 = app.viewer.camera.position.constructor;
    const billboard = {
      id: 'abc123',
      position: Cartesian3.fromDegrees(-75, 40, 10000),
      show: true,
      rotation: 0,
    };
    layer.testing._addFlightTrackingCandidateForTest({
      icao24: 'abc123',
      billboard,
      meta: {
        callsign: 'QA123',
        rawLat: 40,
        rawLon: -75,
        altitude: 10000,
        renderAltitudeM: 10000,
        velocity: 200,
        true_track: 90,
        verticalRate: 0,
        klass: 'airliner',
        onGround: false,
      },
    });
    window.__qaOriginalPick = app.viewer.scene.pick;
    app.viewer.scene.pick = () => ({ primitive: billboard, id: 'abc123' });
  });
  const beforeAircraft = await page.evaluate(() =>
    window.__godsEyeView.styleManager.getCameraState(),
  );
  await page.mouse.click(1000, 450);
  const aircraftSelection = await page.evaluate(() => {
    const app = window.__godsEyeView;
    app.viewer.scene.pick = window.__qaOriginalPick;
    return {
      selected: app.dataManager.layers.get('flights').module.getTrackedInfo()
        ?.icao24,
      follows: Boolean(app.viewer.trackedEntity),
      camera: app.styleManager.getCameraState(),
    };
  });
  assert.equal(aircraftSelection.selected, 'abc123');
  assert.equal(
    aircraftSelection.follows,
    false,
    'click selects without follow ownership',
  );
  assert.deepEqual(aircraftSelection.camera, beforeAircraft);
  const explicitFocus = await page.evaluate(() => {
    const app = window.__godsEyeView;
    const layer = app.dataManager.layers.get('flights').module;
    const accepted = layer.refocusTrackedById('abc123', { origin: 'user' });
    const follows = Boolean(app.viewer.trackedEntity);
    app.styleManager.beginLocationNavigation();
    return { accepted, follows };
  });
  assert.deepEqual(explicitFocus, { accepted: true, follows: true });
  console.log(
    'Aircraft selection stays in place; explicit Focus engages follow',
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__godsEyeView?.styleManager?.savedViews,
  );
  assert.equal(
    await page.evaluate(
      () => window.__godsEyeView.styleManager.savedViews.list()[0].name,
    ),
    'QA overview',
  );
  console.log('Globe ready; opening views');
  await page.click('#saved-views-toggle');
  await mkdir('qa-shots/saved-views', { recursive: true });
  await page.screenshot({ path: 'qa-shots/saved-views/panel.png' });
  console.log(
    'PASS: UI save, browser persistence, MCP restore/undo, stdio relay path, in-place selection.',
  );
} finally {
  await browser.close();
}
