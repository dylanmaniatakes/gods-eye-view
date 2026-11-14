#!/usr/bin/env node
// QA_BASE_URL=http://localhost:4197 node scripts/qa-propagation.mjs
// Synthetic source reports, real globe rendering, chips, picks and persistence.
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
const hf = '[data-layer-id="hf-propagation"]';
const vhf = '[data-layer-id="vhf-propagation"]';
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    window.__propagationPhase = 'normal';
    window.__propagationCalls = 0;
    window.__propagationShift = 0;
    const clock = Date.now.bind(Date);
    Date.now = () => clock() + window.__propagationShift;
    const originalFetch = window.fetch;
    window.fetch = (input, options) => {
      const url = new URL(String(input), location.href);
      if (url.hostname !== 'db1.wspr.live')
        return originalFetch(input, options);
      window.__propagationCalls++;
      if (window.__propagationPhase === 'fail')
        return Promise.resolve(
          new Response('fixture offline', { status: 503 }),
        );
      const frequencies = {
        1: 1838100,
        3: 3570100,
        7: 7040100,
        14: 14097100,
        28: 28126100,
        144: 144489000,
      };
      const bands = url.searchParams
        .get('query')
        .match(/band IN \(([^)]+)\)/)[1]
        .split(',')
        .map(Number);
      const gridPairs = [
        ['FN20', 'IO91'],
        ['IO91', 'PM95'],
        ['PM95', 'QF56'],
        ['QF56', 'CM87'],
        ['CM87', 'FN20'],
        ['GF05', 'JN58'],
      ];
      const data = bands.flatMap((band) =>
        (band === 144
          ? [
              ['FN20', 'EN61'],
              ['FN20', 'FN21'],
            ]
          : gridPairs
        ).map(([tx_loc, rx_loc], index) => ({
          band,
          tx_sign: `N${band}${index}QA`,
          rx_sign: `G${band}${index}QA`,
          tx_loc,
          rx_loc,
          observed: Math.floor(Date.now() / 1000) - index * 120,
          frequency: frequencies[band],
          snr: -12 - index,
          reports: 2,
        })),
      );
      return Promise.resolve(
        Response.json({
          data: window.__propagationPhase === 'empty' ? [] : data,
        }),
      );
    };
    // The fixture checks the explicitly labelled WSPR fallback. Live MQTT is
    // exercised separately; unit tests exercise its report and abort lifecycle.
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(url, protocols) {
        if (String(url).includes('mqtt.pskreporter.info'))
          throw new Error('QA broker offline');
        super(url, protocols);
      }
    };
  });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.dataManager &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 90000 },
  );
  assert.equal(
    await page.evaluate(() => window.__propagationCalls),
    0,
    'disabled layers do not request reports',
  );
  await page.evaluate(async () => {
    const app = window.__godsEyeView;
    await app.dataManager.restoreEnabledLayerIds([]);
    await app.mapStackController.setStack('osm');
    app.viewer.camera.setView({
      destination: app.viewer.camera.position.constructor.fromDegrees(
        -30,
        25,
        22000000,
      ),
    });
    const button = document.querySelector('[data-rail-item="data-panel"]');
    if (document.getElementById('data-panel').classList.contains('collapsed'))
      button.click();
  });
  await page.$eval(`${hf} .data-toggle-btn`, (button) =>
    button.scrollIntoView({ block: 'center' }),
  );
  await page.click(`${hf} .data-toggle-btn`);
  await page.waitForFunction(
    () =>
      window.__godsEyeView.dataManager.layers
        .get('hf-propagation')
        .module.getStats().count === 30,
  );
  assert.equal(
    await page.$$eval(`${hf} [data-chip-id]`, (chips) => chips.length),
    5,
  );
  assert.equal(
    await page.$$eval(
      `${hf} .data-toggle-legend-swatch`,
      (swatches) => swatches.length,
    ),
    5,
  );
  const turnOff = ['10m', '40m', '80m', '160m'];
  for (const band of turnOff)
    await page.click(`${hf} [data-chip-id="${band}"]`);
  assert.equal(
    await page.evaluate(
      () =>
        window.__godsEyeView.dataManager.layers
          .get('hf-propagation')
          .module.getStats().count,
    ),
    6,
  );
  await page.$eval(`${vhf} .data-toggle-btn`, (button) =>
    button.scrollIntoView({ block: 'center' }),
  );
  await page.click(`${vhf} .data-toggle-btn`);
  await page.waitForFunction(async () => {
    const layer =
      window.__godsEyeView.dataManager.layers.get('vhf-propagation').module;
    await layer.update();
    return layer.getStats().count === 2;
  });
  await page.waitForFunction(() =>
    document
      .querySelector('[data-layer-id="vhf-propagation"]')
      .textContent.includes('PSK Reporter disconnected'),
  );
  await page.click(`${vhf} [data-chip-id="long"]`);
  assert.equal(
    await page.evaluate(
      () =>
        window.__godsEyeView.dataManager.layers
          .get('vhf-propagation')
          .module.getStats().count,
    ),
    1,
  );
  const target = await page.evaluate(() => {
    const viewer = window.__godsEyeView.viewer;
    viewer.camera.cancelFlight();
    viewer.camera.setView({
      destination: viewer.camera.position.constructor.fromDegrees(
        -30,
        25,
        22000000,
      ),
    });
    viewer.scene.requestRender();
    const ds = [...Array(viewer.dataSources.length)]
      .map((_, i) => viewer.dataSources.get(i))
      .find((ds) => ds.name === 'hf-propagation');
    const entity = ds.entities.values.find((e) => e.name.startsWith('N140QA'));
    const point = entity.position.getValue(viewer.clock.currentTime);
    const pixel = viewer.scene.cartesianToCanvasCoordinates(point);
    return { id: entity.id, x: pixel.x, y: pixel.y };
  });
  await page.waitForFunction(
    ({ id }) => {
      const viewer = window.__godsEyeView.viewer;
      const ds = [...Array(viewer.dataSources.length)]
        .map((_, i) => viewer.dataSources.get(i))
        .find((ds) => ds.name === 'hf-propagation');
      const entity = ds.entities.getById(id);
      const point = entity.position.getValue(viewer.clock.currentTime);
      const pixel = viewer.scene.cartesianToCanvasCoordinates(point);
      viewer.scene.requestRender();
      const picks = viewer.scene.drillPick(pixel, 10);
      const found = picks.some((pick) => pick.id?.id === id);
      if (found) window.__propagationPick = { x: pixel.x, y: pixel.y };
      return found;
    },
    {},
    target,
  );
  const pixel = await page.evaluate(() => window.__propagationPick);
  await page.mouse.click(pixel.x, pixel.y);
  await page.waitForFunction(
    () =>
      document
        .querySelector('#object-inspection-panel')
        ?.textContent.includes('N140QA') ||
      [...document.querySelectorAll('[data-rail-item]')].some((e) =>
        e.textContent.includes('OBJECT DETAILS'),
      ),
  );
  assert.ok(
    await page.evaluate(() => document.body.textContent.includes('N140QA')),
  );
  await mkdir('docs/media', { recursive: true });
  await page.screenshot({ path: 'docs/media/radio-propagation-synthetic.png' });
  // Successful empty responses replace prior geometry; failed refreshes retain
  // it only while each report remains inside the observation window.
  const recovery = await page.evaluate(async () => {
    const layer =
      window.__godsEyeView.dataManager.layers.get('hf-propagation').module;
    window.__propagationShift += 120001;
    window.__propagationPhase = 'fail';
    await layer.update();
    const failed = layer.getStats();
    window.__propagationPhase = 'empty';
    await layer.update();
    return { failed, empty: layer.getStats() };
  });
  assert.equal(recovery.failed.count, 6);
  assert.equal(recovery.failed.stale, true);
  assert.equal(recovery.empty.count, 0);
  assert.equal(recovery.empty.error, null);
  await page.evaluate(() => {
    window.__propagationPhase = 'normal';
  });
  await page.waitForFunction(async () => {
    const { decodeLayerStateParams } = await import('/src/data/layerState.js');
    const state = decodeLayerStateParams(
      new URLSearchParams(location.hash.slice(1)),
    );
    return (
      state?.enabledLayerIds.includes('hf-propagation') &&
      state.enabledLayerIds.includes('vhf-propagation') &&
      state.options['hf-propagation'].band10m === false &&
      state.options['vhf-propagation'].longPathsOnly === true
    );
  });
  console.log(
    'Propagation globe, filters, inspection, stale / empty and serialized options passed.',
  );
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.dataManager?.isEnabled('hf-propagation') &&
      window.__godsEyeView.dataManager.isEnabled('vhf-propagation'),
    { timeout: 90000 },
  );
  const params = await page.evaluate(() => ({
    hf: window.__godsEyeView.dataManager.layers
      .get('hf-propagation')
      .module.getParams(),
    vhf: window.__godsEyeView.dataManager.layers
      .get('vhf-propagation')
      .module.getParams(),
  }));
  assert.equal(params.hf.band20m, true);
  assert.equal(params.hf.band10m, false);
  assert.equal(params.vhf.longPathsOnly, true);
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const { setLocale } = await import('/src/i18n/index.js');
    await setLocale('de');
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    'narrow translated layout fits',
  );
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.restoreEnabledLayerIds([]),
  );
  assert.deepEqual(errors, []);
  console.log(
    'Propagation QA passed: disabled I/O, band filters, 2 m range filter, source fallback, globe pick / details, stale / empty, share restoration and narrow German layout.',
  );
} finally {
  await browser.close();
}
