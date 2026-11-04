#!/usr/bin/env node
// QA_BASE_URL=http://localhost:4197 node scripts/qa-selection-popups.mjs
// Real popup-toggle clicks, selection/telemetry preservation and reload persistence.
// Synthetic incident only; S2 lifecycle coverage is in ghostMaps/lifecycle.test.mjs.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { chromeExecutablePath } from './qa-chrome.mjs';
const base = process.env.QA_BASE_URL || 'http://localhost:4173';
const browser = await puppeteer.launch({
  headless: true,
  executablePath: chromeExecutablePath(),
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-webgl',
  ],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));
  // Font servers are not part of the selection contract; avoid blocking boot
  // when an external stylesheet cannot be reached in a local/offline setup.
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com')
      void request.abort().catch(() => {});
    else void request.continue().catch(() => {});
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    const original = window.fetch;
    window.fetch = (input, options) => {
      if (String(input).includes('/api/chester-county-ems/details?')) {
        return Promise.resolve(
          Response.json({
            incidentNumber: 'F26000001',
            observedAt: Date.now(),
            units: [
              {
                unit: 'QA MEDIC',
                status: 'On Scene',
                entered: '11-03-2026 10:05:00',
              },
            ],
          }),
        );
      }
      if (String(input).includes('/api/chester-county-ems')) {
        return Promise.resolve(
          Response.json({
            observedAt: Date.now(),
            fetchedAt: Date.now(),
            stale: false,
            rows: [
              {
                id: 'ems:F26000001',
                incidentNumber: 'F26000001',
                category: 'ems',
                type: 'SYNTHETIC POPUP TEST',
                location: 'EXAMPLE RD',
                municipality: 'Example Township',
                station: '01',
                detailUrl:
                  'https://webcad.chesco.org/WebCad/livecadcomments-ems.asp?incidentno=F26000001',
                mapPosition: {
                  lat: 39.96,
                  lon: -75.605,
                  kind: 'intersection',
                  approximate: true,
                },
              },
            ],
          }),
        );
      }
      return original(input, options);
    };
  });
  async function selectFixture() {
    await page.waitForFunction(
      () =>
        window.__godsEyeView?.dataManager &&
        document.querySelector('#loading-screen')?.classList.contains('hidden'),
      { timeout: 120000 },
    );
    console.log('App ready');
    await page.evaluate(async () => {
      const app = window.__godsEyeView;
      app.styleManager.beginLocationNavigation();
      app.viewer.camera.setView({
        destination: app.viewer.camera.position.constructor.fromDegrees(
          -75.605,
          39.96,
          5000,
        ),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      });
      await app.dataManager.setEnabled('chester-county-ems', true);
      await app.dataManager.layers.get('chester-county-ems').module.update();
      app.viewer.scene.requestRender();
    });
    await page.waitForFunction(
      () => {
        const app = window.__godsEyeView;
        const entity =
          app.viewer.dataSources.getByName('chester-county-ems')[0]?.entities
            .values[0];
        if (!entity) return false;
        const pixel = app.viewer.scene.cartesianToCanvasCoordinates(
          entity.position.getValue(app.viewer.clock.currentTime),
        );
        return (
          pixel &&
          app.viewer.scene.pick({ x: pixel.x, y: pixel.y - 10 })?.id?.id ===
            entity.id
        );
      },
      { timeout: 30000 },
    );
    const point = await page.evaluate(() => {
      const app = window.__godsEyeView;
      const entity =
        app.viewer.dataSources.getByName('chester-county-ems')[0].entities
          .values[0];
      const pixel = app.viewer.scene.cartesianToCanvasCoordinates(
        entity.position.getValue(app.viewer.clock.currentTime),
      );
      return { x: pixel.x, y: pixel.y };
    });
    await page.mouse.click(point.x, point.y - 10);
    await page.waitForSelector('#inspection-map-popups', { visible: true });
    await page.waitForFunction(() =>
      document
        .querySelector('#object-inspection-panel h3')
        ?.textContent.includes('SYNTHETIC POPUP TEST'),
    );
  }
  const state = () =>
    page.evaluate(() => {
      const app = window.__godsEyeView;
      return {
        id: app.dataManager.layers
          .get('chester-county-ems')
          .module.getInspectionInfo()?.id,
        markers:
          app.viewer.dataSources.getByName('chester-county-ems')[0].entities
            .values.length,
        cards:
          window.__gevWorldOverlay.getDiagnostics().entriesBySource[
            'chester-county-ems-selected'
          ] || 0,
        camera: app.styleManager.getCameraState(),
      };
    });
  const clickPopupToggle = async () => {
    // The rail labels fold away after the inspector opens. Wait for the
    // actual button to receive the pointer before sending a real click.
    await page.waitForFunction(() => {
      const button = document.getElementById('inspection-map-popups');
      if (!button) return false;
      const rect = button.getBoundingClientRect();
      return (
        rect.width > 0 &&
        button.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        )
      );
    });
    await page.locator('#inspection-map-popups').click();
  };
  await page.goto(`${base}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await selectFixture();
  await page.waitForFunction(
    () =>
      (window.__gevWorldOverlay.getDiagnostics().entriesBySource[
        'chester-county-ems-selected'
      ] || 0) === 1,
  );
  const before = await state();
  await clickPopupToggle();
  await page.waitForFunction(
    () =>
      document
        .querySelector('#inspection-map-popups')
        .getAttribute('aria-pressed') === 'false',
  );
  const hidden = await state();
  assert.equal(hidden.cards, 0);
  assert.equal(hidden.id, before.id);
  assert.equal(hidden.markers, 1);
  assert.deepEqual(hidden.camera, before.camera);
  console.log(
    'Real toggle hides the card and preserves selection, markers and camera',
  );
  await page.waitForFunction(() =>
    document
      .querySelector('#object-inspection-panel')
      .textContent.includes('QA MEDIC'),
  );
  await mkdir('qa-shots/selection-popups', { recursive: true });
  await page.screenshot({ path: 'qa-shots/selection-popups/details.png' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await selectFixture();
  assert.equal(
    await page.$eval('#inspection-map-popups', (el) =>
      el.getAttribute('aria-pressed'),
    ),
    'false',
  );
  assert.equal(
    (await state()).cards,
    0,
    'hidden popups stay hidden after reload and a fresh selection',
  );
  await clickPopupToggle();
  await page.waitForFunction(
    () =>
      (window.__gevWorldOverlay.getDiagnostics().entriesBySource[
        'chester-county-ems-selected'
      ] || 0) === 1,
  );
  assert.equal((await state()).id, before.id);
  console.log(
    'PASS: real toggle clicks hide/restore popup, preserve selection, markers, camera and live details, and persist after reload.',
  );
} finally {
  await browser.close();
}
