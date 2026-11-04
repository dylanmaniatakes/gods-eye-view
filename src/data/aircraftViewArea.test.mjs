import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createRendering as civilRendering } from '../layers/flights/rendering.js';
import { createRendering as militaryRendering } from '../layers/military/rendering.js';

for (const [name, createRendering] of [
  ['civil', civilRendering],
  ['military', militaryRendering],
]) {
  test(`${name}: off-screen contacts skip visual work and re-enter from current motion without a poll`, () => {
    const position = new Cesium.Cartesian3(7000000, 0, 0);
    const camera = {
      positionWC: position,
      directionWC: new Cesium.Cartesian3(-1, 0, 0),
      upWC: new Cesium.Cartesian3(0, 0, 1),
      heading: 0,
      pitch: 0,
      roll: 0,
      frustum: new Cesium.PerspectiveFrustum({
        fov: Math.PI / 3,
        aspectRatio: 1,
        near: 1,
        far: 1e8,
      }),
    };
    const offscreen = new Cesium.Cartesian3(6900000, 1000000, 0);
    let estimate = offscreen;
    let writes = 0,
      floors = 0,
      treatments = 0;
    let displayed = offscreen;
    const bb = {
      show: true,
      scale: 1,
      width: 20,
      height: 20,
      rotation: 0,
      get position() {
        return displayed;
      },
      set position(value) {
        writes++;
        displayed = value;
      },
    };
    const state = {
      _viewer: { camera, scene: { camera } },
      _billboardCollection: { show: true },
      _billboards: new Map([['plane', bb]]),
      _models: new Map(),
      _modelPending: new Set(),
      _models3dEnabled: false,
      _lastFleetTickMs: 0,
      _scratchFleetRenderTime: new Cesium.JulianDate(),
      _scratchFleetPos: new Cesium.Cartesian3(),
      _cullPositions: new Map(),
      _billboardLimbScale: new WeakMap(),
      _displayCourse: new Map([['plane', 90]]),
      records: { data: new Map([['plane', {}]]), missingPolls: new Map() },
    };
    const services = {
      militaryRegistry: { isMilitaryIcao: () => false },
      aircraftPresentation: { isTr3b: () => false },
      camera: {},
      focus: {
        focusNowMs: () => 10000,
        getFocusTarget: () => null,
        nearFarScalarValueAtDistance: () => 1,
        advanceProjectedSpriteFocus: () => ({ factor: 1 }),
      },
      recession: {
        applyAircraftBillboardTreatment() {
          treatments++;
          return { alpha: 1, factors: { scale: 1 } };
        },
      },
    };
    const parts = {
      motion: {
        _deadReckon: () => estimate,
        _floorGroundedDisplayPosition(id, info, dr) {
          floors++;
          return dr;
        },
      },
    };
    const rendering = createRendering({ flightState: state, services, parts });
    rendering._fleetTick();
    assert.equal(bb.show, false);
    assert.equal(writes, 0);
    assert.equal(floors, 0);
    assert.equal(treatments, 0);
    assert.equal(state._displayCourse.has('plane'), false);
    // No source poll or billboard position change: only the live estimate moves.
    estimate = new Cesium.Cartesian3(6900000, 0, 0);
    state._lastFleetTickMs = 0;
    rendering._fleetTick();
    assert.equal(
      writes,
      1,
      'moving into view immediately resumes visual position writes',
    );
    assert.equal(bb.show, true);
    assert.equal(treatments, 1);
    assert.equal(floors, name === 'civil' ? 1 : 0);
    assert.equal(
      state._displayCourse.get('plane'),
      0,
      'reentry uses current course without slewing from stale offscreen state',
    );
    // The tracked contact belongs to a separate full-rate rendering path.
    state._trackedIcao = 'plane';
    estimate = offscreen;
    state._lastFleetTickMs = 0;
    rendering._fleetTick();
    assert.equal(bb.show, true);
    assert.equal(writes, 1);
  });
}
