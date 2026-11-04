/** Live raster-reference acceptance; no credentials or display-persistence dependency. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:4187';
const output = process.env.QA_SCREENSHOT_DIR || 'qa-shots/satellite-labels';
await mkdir(output, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  args:
    process.platform === 'darwin'
      ? ['--use-angle=metal', '--enable-gpu']
      : ['--use-gl=angle', '--use-angle=swiftshader'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [],
    tiles = new Set();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (
      response.ok() &&
      /Reference\/World_(Transportation|Boundaries_and_Places)\/MapServer\/tile\//.test(
        response.url(),
      )
    )
      tiles.add(response.url());
  });
  console.log('Loading satellite labels test');
  await page.goto(`${base}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(
    () =>
      window.__godsEyeView?.styleManager &&
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 60000 },
  );
  await page.evaluate(() => {
    const manager = window.__godsEyeView.styleManager;
    manager.setHudLayout('minimal');
    manager.setStyle('normal');
    manager.viewer.camera.setView({
      destination: manager.viewer.scene.globe.ellipsoid.cartographicToCartesian(
        { longitude: -1.31, latitude: 0.7, height: 150000 },
      ),
    });
    manager.setPanelCollapsed('control-panel', false, { explicit: true });
  });
  await page.waitForSelector('[data-stack-id="esri-hybrid"]', {
    visible: true,
  });
  await page.click('[data-stack-id="esri-hybrid"]');
  await page.waitForFunction(
    () =>
      window.__godsEyeView.styleManager.mapStackController.getActiveId() ===
      'esri-hybrid',
    { timeout: 60000 },
  );
  const inspect = () =>
    page.evaluate(() => {
      const manager = window.__godsEyeView.styleManager;
      return {
        active: manager.mapStackController.getActiveId(),
        imagery: Array.from(
          { length: manager.viewer.imageryLayers.length },
          (_, i) =>
            manager.viewer.imageryLayers.get(i).imageryProvider.url || '',
        ),
      };
    });
  const hybrid = await inspect();
  assert.equal(
    hybrid.imagery.filter((url) => url.includes('/Reference/')).length,
    2,
  );
  console.log('Hybrid selected; waiting for live tiles');
  await page.waitForFunction(
    () => window.__godsEyeView.styleManager.viewer.scene.globe.tilesLoaded,
    { timeout: 60000 },
  );
  assert.ok(
    [...tiles].some((url) => url.includes('World_Transportation')),
    'live road tiles loaded',
  );
  assert.ok(
    [...tiles].some((url) => url.includes('World_Boundaries_and_Places')),
    'live place tiles loaded',
  );
  await page.screenshot({ path: `${output}/satellite-labels.png` });
  await page.evaluate(() => {
    const manager = window.__godsEyeView.styleManager;
    manager.viewer.camera.cancelFlight();
    manager.viewer.camera.setView({
      destination: manager.viewer.scene.globe.ellipsoid.cartographicToCartesian(
        { longitude: -1.31, latitude: 0.7, height: 450000 },
      ),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    manager.viewer.scene.requestRender();
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await page.waitForFunction(
    () => window.__godsEyeView.styleManager.viewer.scene.globe.tilesLoaded,
    { timeout: 60000 },
  );
  await page.screenshot({ path: `${output}/city-labels.png` });
  await page.evaluate(() =>
    window.__godsEyeView.styleManager._setMapStack('osm'),
  );
  const plain = await inspect();
  assert.equal(
    plain.imagery.filter((url) => url.includes('/Reference/')).length,
    0,
  );
  await writeFile(
    `${output}/result.json`,
    JSON.stringify(
      {
        passed: true,
        hybrid,
        plain,
        liveReferenceTileCount: tiles.size,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      liveReferenceTileCount: tiles.size,
      errors,
    }),
  );
} finally {
  await browser.close();
}
