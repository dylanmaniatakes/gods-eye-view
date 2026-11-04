// Display-only flight filtering through real row chips and right-rail controls.
// QA_BASE_URL=http://localhost:4173 node scripts/qa-flight-filters.mjs
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const output = process.env.QA_OUTPUT_DIR || '/tmp/gev-flight-filters';
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1440, height: 950 });
  await page.goto(
    `${process.env.QA_BASE_URL || 'http://localhost:4173'}/?welcome=0#v=2&lat=40&lon=-77&alt=500000&pitch=-90&style=normal&hud=minimal&hv=1&dm=OFF&map=osm&l=`,
    { waitUntil: 'domcontentloaded', timeout: 90000 },
  );
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.dataManager &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 90000 },
  );
  await page.evaluate(async () => {
    const app = window.__godsEyeView;
    for (const [id, entry] of app.dataManager.layers)
      if (entry.enabled) await app.dataManager.setEnabled(id, false);
    const layer = app.dataManager.layers.get('flights').module;
    layer.update = async () => {}; // Only the synthetic snapshot supplies observations.
    await app.dataManager.setEnabled('flights', true);
    app.dataManager.setLayerParams('flights', { models3d: false });
    app.styleManager.beginLocationNavigation();
    app.viewer.camera.cancelFlight();
    app.viewer.camera.setView({
      destination: app.viewer.camera.position.constructor.fromDegrees(
        -77,
        40,
        500000,
      ),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    const classes = ['light', 'helicopter', 'airliner', 'bizjet'];
    const altitudes = [20, 1000, 6000, 11000];
    const fixture = Array.from({ length: 400 }, (_, index) => ({
      id: (10000 + index).toString(16).padStart(6, '0'),
      callsign: `QA${String(index).padStart(4, '0')}`,
      latitude: 40 + (Math.floor(index / 20) - 10) * 0.02,
      longitude: -77 + ((index % 20) - 10) * 0.02,
      altitudeM: altitudes[index % 4],
      klass: classes[index % 4],
      onGround: index % 4 === 0,
    }));
    const seeded = layer.__focusEvidence.setAircraft(fixture);
    if (!seeded.ok || seeded.count !== 400)
      throw new Error('Aircraft fixture failed');
    app.styleManager.setPanelCollapsed('data-panel', false, {
      explicit: true,
      persist: false,
    });
    app.viewer.scene.requestRender();
  });
  const count = () =>
    page.evaluate(
      () =>
        window.__godsEyeView.dataManager.layers
          .get('flights')
          .module.__focusEvidence.snapshot()
          .filter((row) => row.show).length,
    );
  const waitCount = async (expected) => {
    await page.waitForFunction(
      (n) =>
        window.__godsEyeView.dataManager.layers
          .get('flights')
          .module.__focusEvidence.snapshot()
          .filter((row) => row.show).length === n,
      { timeout: 15000 },
      expected,
    );
    results.push({ expected, actual: await count() });
  };
  await page.waitForFunction(() => {
    const rows = window.__godsEyeView.dataManager.layers
      .get('flights')
      .module.__focusEvidence.snapshot();
    return rows.length === 400 && rows.filter((row) => row.show).length < 100;
  });
  const automatic = await count();
  assert.ok(automatic > 0 && automatic < 100);
  const chip = (id) =>
    `[data-layer-id="flights"] [data-chip-id="flight-${id}"]`;
  assert.equal(
    await page.$$eval(
      '[data-layer-id="flights"] [data-chip-id^="flight-"]',
      (nodes) => nodes.length,
    ),
    5,
  );
  await page.click(chip('declutter'));
  await waitCount(400);
  await page.click(chip('airborne'));
  await waitCount(300);
  await page.click(chip('airborne'));
  await waitCount(400);
  await page.click(chip('types'));
  await waitCount(100);
  await page.click(chip('types'));
  await waitCount(400);
  await page.click(chip('list'));
  await page.waitForSelector('#flight-panel:not(.collapsed)');
  await page.waitForFunction(() => {
    const body = document.querySelector('.flight-panel-body');
    return body.clientHeight > 0 && body.scrollHeight > body.clientHeight;
  });
  assert.ok(
    await page.$eval(
      '.flight-panel-body',
      (body) => body.clientHeight > 0 && body.scrollHeight > body.clientHeight,
    ),
    'the panel body owns a real bounded scrolling box',
  );
  await page.click('#flight-altitude-enabled');
  const input = async (selector, value) =>
    page.$eval(
      selector,
      (element, text) => {
        element.value = text;
        element.dispatchEvent(new Event('change', { bubbles: true }));
      },
      value,
    );
  await input('#flight-min-altitude', '10000');
  await input('#flight-max-altitude', '30000');
  await waitCount(100);
  // The quick toggle retains the panel's exact altitude limits.
  await page.click(chip('altitude'));
  await waitCount(400);
  await page.click(chip('altitude'));
  await waitCount(100);
  await page.click('#flight-altitude-enabled');
  await page.click('#flight-type-enabled');
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('#flight-panel button')].find(
      (el) => el.textContent.trim() === 'Clear types',
    );
    button.click();
  });
  await waitCount(0);
  await page.click('[data-flight-class="helicopter"]');
  await waitCount(100);
  await page.click('#flight-type-enabled');
  await waitCount(400);
  await page.click('#flight-declutter');
  await page.waitForFunction(
    () =>
      window.__godsEyeView.dataManager.layers
        .get('flights')
        .module.__focusEvidence.snapshot()
        .filter((row) => row.show).length < 100,
  );
  const roster = await page.evaluate(() =>
    window.__godsEyeView.dataManager.layers
      .get('flights')
      .module.getFlightList(),
  );
  assert.equal(roster.total, 400);
  assert.equal(roster.matching, 400);
  assert.equal(roster.rows.length, 50);
  assert.equal(roster.pages, 8);
  assert.equal(
    await page.evaluate(
      () =>
        window.__godsEyeView.dataManager.layers
          .get('flights')
          .module.getAnalystRecords(1000).length,
    ),
    400,
  );
  await page.screenshot({ path: `${output}/filters.png` });
  const hidden = await page.evaluate(() => {
    const layer = window.__godsEyeView.dataManager.layers.get('flights').module;
    const marker = layer.__focusEvidence.snapshot().find((row) => !row.show);
    return {
      id: marker.id,
      label: layer.getFlightList({ search: marker.id }).rows[0].label,
    };
  });
  const search = await page.$('#flight-search');
  await search.scrollIntoView();
  await search.type(hidden.label);
  await page.waitForSelector(`[data-flight-id="${hidden.id}"]`);
  assert.equal(
    await page.$$eval('[data-flight-id]', (nodes) => nodes.length),
    1,
  );
  await page.screenshot({ path: `${output}/search.png` });
  await page.click(`[data-flight-id="${hidden.id}"]`);
  await page.waitForFunction(
    (id) =>
      window.__godsEyeView.dataManager.layers
        .get('flights')
        .module.getTrackedInfo()?.icao24 === id,
    {},
    hidden.id,
  );
  const selected = await page.evaluate(() =>
    window.__godsEyeView.dataManager.layers
      .get('flights')
      .module.getFlightList()
      .rows.find((row) => row.selected),
  );
  assert.ok(
    selected,
    'an automatically hidden flight can still be selected from the list',
  );
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('gev:flight-display-filters:v1')),
  );
  assert.equal(stored.flights.declutterEnabled, true);
  assert.equal(stored.flights.minAltitudeFt, 10000);
  assert.equal(stored.flights.maxAltitudeFt, 30000);
  await page.evaluate(() => {
    const app = window.__godsEyeView;
    app.dataManager.setLayerParams(
      'military',
      { displayFilters: { airborneOnly: true } },
      { origin: 'user' },
    );
  });
  assert.equal(
    await page.evaluate(
      () =>
        window.__godsEyeView.dataManager.layers
          .get('flights')
          .module.getParams().displayFilters.airborneOnly,
    ),
    false,
    'feed settings stay independent',
  );
  assert.deepEqual(errors, []);
  const summary = {
    automatic,
    unfiltered: 400,
    roster: {
      total: roster.total,
      matching: roster.matching,
      pages: roster.pages,
    },
    checks: results,
    selected: hidden.id,
  };
  await writeFile(`${output}/results.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  console.log(
    `PASS: row toggles, right-rail filters, full searchable list and hidden-flight selection. ${output}`,
  );
} finally {
  await browser.close();
}
