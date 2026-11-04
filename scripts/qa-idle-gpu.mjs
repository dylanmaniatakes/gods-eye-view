/** Idle compositor, active voice and camera responsiveness acceptance.
 * QA_BASE_URL=http://localhost:4173 node scripts/qa-idle-gpu.mjs
 * Optional QA_BASELINE_CSS=/absolute/path/to/old/cyber.css compares the old skin.
 * Browser draw counts and surface sizes are proxies, not native GPU utilization.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const output = process.env.QA_OUTPUT_DIR || '/tmp/gev-idle-gpu';
await mkdir(output, { recursive: true });
const baseline = process.env.QA_BASELINE_CSS
  ? await readFile(process.env.QA_BASELINE_CSS, 'utf8')
  : null;
const current = await readFile(
  new URL('../src/ui/styles/cyber.css', import.meta.url),
  'utf8',
);
const results = { visual: [], profiles: [] };
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});
try {
  // Compare the complete sweep, including glow, at wide/narrow sectors and
  // multiple rotations. Freeze its epoch so animation timing cannot hide a diff.
  if (baseline) {
    const visual = await browser.newPage();
    await visual.setViewport({ width: 1000, height: 1000 });
    for (const sector of [8, 60]) {
      for (const time of [0, 1300, 3250]) {
        const screenshots = [];
        for (const [label, css] of [
          ['before', baseline],
          ['after', current],
        ]) {
          await visual.setContent(`<html data-ui-theme="cyber"><style>
            body { margin: 0; background: #101d24; }
            :root { --cyber-accent-rgb: 105,203,209; --cyber-accent-bright-rgb: 211,247,248;
              --cyber-sonar-size-vw: 80vw; --cyber-sonar-size-vh: 80vh;
              --cyber-sonar-sector-width: ${sector}deg; --cyber-sonar-sector-quarter: ${sector / 4}deg;
              --cyber-sonar-sector-middle: ${sector * 0.6}deg; }
            ${css}</style><body><div id="intel-hud" data-variant="cyber"><div class="hud-sonar"></div></div></body></html>`);
          await visual.evaluate((ms) => {
            for (const animation of document.getAnimations()) {
              animation.pause();
              animation.currentTime = ms;
            }
          }, time);
          const png = await visual.screenshot();
          screenshots.push(await sharp(png).removeAlpha().raw().toBuffer());
          await writeFile(
            path.join(output, `sonar-${sector}-${time}-${label}.png`),
            png,
          );
        }
        let delta = 0,
          maxDelta = 0;
        for (let i = 0; i < screenshots[0].length; i++) {
          const d = Math.abs(screenshots[0][i] - screenshots[1][i]);
          delta += d;
          maxDelta = Math.max(maxDelta, d);
        }
        const meanDelta = delta / screenshots[0].length;
        results.visual.push({ sector, time, meanDelta, maxDelta });
        assert.ok(
          meanDelta < 0.1,
          `sonar appearance changed: ${JSON.stringify(results.visual.at(-1))}`,
        );
      }
    }
    await visual.close();
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(
    `${process.env.QA_BASE_URL || 'http://localhost:4173'}/?welcome=0#v=2&lat=39.5729&lon=-76.3545&alt=708746&pitch=-88&style=normal&hud=cyber&hv=1&dm=DENSE&map=osm&l=`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForFunction(() => !!window.__godsEyeView?.viewer, {
    timeout: 90000,
  });
  await page.evaluate(async () => {
    const gev = window.__godsEyeView;
    for (const [id, entry] of gev.dataManager.layers)
      if (entry.enabled)
        await gev.dataManager.setEnabled(id, false, { origin: 'user' });
    gev.viewer.camera.cancelFlight();
  });
  await new Promise((resolve) => setTimeout(resolve, 20000));
  const profile = async (name) => {
    await page.tracing.start({
      categories: ['cc', 'viz', 'devtools.timeline'],
    });
    const rendered = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let renders = 0;
          const off =
            window.__godsEyeView.viewer.scene.postRender.addEventListener(
              () => renders++,
            );
          setTimeout(() => {
            off();
            resolve(renders);
          }, 4000);
        }),
    );
    const trace = JSON.parse(Buffer.from(await page.tracing.stop()).toString());
    const drawFrames = trace.traceEvents.filter(
      (event) => event.name === 'Display::DrawAndSwap',
    ).length;
    const layouts = trace.traceEvents.filter(
      (event) => event.name === 'Layout',
    ).length;
    const state = await page.evaluate(() => {
      const sonar = document.querySelector('.hud-sonar');
      const sweep = getComputedStyle(sonar, '::after');
      return {
        governor: window.__godsEyeView.getRenderGovernorDiagnostics().mode,
        targetFrameRate: window.__godsEyeView.viewer.targetFrameRate,
        sweepArea: parseFloat(sweep.width) * parseFloat(sweep.height),
        circleArea: sonar.clientWidth * sonar.clientHeight,
        animations: document
          .getAnimations()
          .filter((a) => a.playState === 'running')
          .map((a) => a.animationName),
      };
    });
    const result = {
      name,
      drawFrames,
      layouts,
      rendered,
      seconds: 4,
      ...state,
    };
    results.profiles.push(result);
    console.log(JSON.stringify(result));
    return result;
  };
  if (baseline) {
    // Reset properties introduced by this change before restoring the old rules.
    const old = await page.addStyleTag({
      content: `${baseline}\n#intel-hud[data-variant='cyber'] .hud-sonar::after { inset: 0; border-radius: inherit; }`,
    });
    await profile('before-sonar-on');
    await page.evaluate(() =>
      window.__godsEyeView.styleManager._setCyberSonarEnabled(false),
    );
    await profile('before-sonar-off');
    await old.evaluate((element) => element.remove());
  }
  await page.evaluate(() =>
    window.__godsEyeView.styleManager._setCyberSonarEnabled(true),
  );
  const sonar = await profile('after-sonar-on');
  assert.ok(
    sonar.sweepArea / sonar.circleArea < 0.3,
    'the rotating surface should occupy less than 30% of the full square',
  );
  assert.ok(sonar.drawFrames >= 120, 'the sonar animation must remain smooth');
  assert.equal(sonar.targetFrameRate, 60);
  assert.equal(
    sonar.animations.includes('gev-cyber-voice-scan'),
    false,
    'offline voice must not animate',
  );
  await page.evaluate(() =>
    window.__godsEyeView.styleManager._setCyberSonarEnabled(false),
  );
  const idle = await profile('after-sonar-off');
  assert.equal(idle.governor, 'idle');
  assert.ok(idle.rendered <= 4, 'parked globe should stop rendering');
  assert.ok(
    idle.drawFrames < 40,
    'idle chrome should not continuously composite',
  );

  for (const status of [
    'connecting',
    'listening',
    'executing',
    'idle',
    'error',
  ]) {
    const animated = await page.evaluate((value) => {
      const control = document.getElementById('gev-voice-control');
      control.dataset.status = value;
      return (
        getComputedStyle(
          control.querySelector('.gev-voice-visualizer'),
          '::after',
        ).animationName !== 'none'
      );
    }, status);
    assert.equal(
      animated,
      ['connecting', 'listening', 'executing'].includes(status),
      `voice feedback for ${status}`,
    );
  }
  await page.evaluate(() => {
    document.getElementById('gev-voice-control').dataset.status = 'listening';
  });
  await profile('after-active-voice');
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ]);
  assert.equal(
    await page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector('.gev-voice-visualizer'),
          '::after',
        ).animationName,
    ),
    'none',
  );
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'no-preference' },
  ]);
  results.camera = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const viewer = window.__godsEyeView.viewer;
        const started = performance.now();
        const off = viewer.scene.postRender.addEventListener(() => {
          off();
          resolve({ firstFrameMs: performance.now() - started });
        });
        viewer.camera.moveForward(100);
      }),
  );
  assert.ok(
    results.camera.firstFrameMs < 200,
    'camera input must wake rendering promptly',
  );
  console.log(
    JSON.stringify({ camera: results.camera, visual: results.visual }),
  );
} finally {
  await browser.close();
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(results, null, 2),
  );
}
console.log(`Idle GPU checks passed. Artifacts: ${output}`);
