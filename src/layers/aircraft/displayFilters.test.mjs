import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createAircraftDisplayFilters } from './displayFilters.js';

function fixture() {
  const flightState = {
    _billboards: new Map(),
    _models: new Map(),
    records: { data: new Map() },
    _viewer: {
      camera: {
        positionWC: new Cesium.Cartesian3(7000000, 0, 0),
        positionCartographic: { height: 500000 },
        frustum: { fovy: 1 },
      },
      scene: { canvas: { clientHeight: 900 } },
    },
  };
  for (let i = 0; i < 120; i++) {
    const id = `abc${i}`;
    flightState._billboards.set(id, {
      position: new Cesium.Cartesian3(6370000, i * 10, 0),
      show: true,
    });
    flightState.records.data.set(id, {
      callsign: `TEST${i}`,
      registration: `N${i}`,
      klass: i % 2 ? 'helicopter' : 'airliner',
      altitude: i * 100,
      onGround: i === 0,
    });
  }
  let ticks = 0;
  const parts = {
    rendering: {
      _fleetTick() {
        ticks++;
      },
    },
    motion: {
      _deadReckon(id, out) {
        const i = Number(id.slice(3));
        flightState._drCourseDeg = i;
        flightState._drSpeedMps = i + 1;
        flightState._drCourseHold = i === 0;
        return Cesium.Cartesian3.clone(
          flightState._billboards.get(id).position,
          out,
        );
      },
    },
  };
  const display = createAircraftDisplayFilters({
    flightState,
    parts,
    services: {},
    layer: { id: 'flights' },
  });
  return { display, flightState, ticks: () => ticks };
}

test('automatic thinning keeps all source rows searchable and paginates the complete matching list', () => {
  const { display, flightState } = fixture();
  display.prepare();
  const visible = [...flightState._billboards.keys()].filter((id) =>
    display.allows(id),
  );
  assert.ok(visible.length < 120);
  const first = display.methods.getFlightList();
  assert.equal(first.total, 120);
  assert.equal(first.matching, 120);
  assert.equal(first.rows.length, 50);
  assert.equal(first.pages, 3);
  assert.equal(display.methods.getFlightList({ page: 2 }).rows.length, 20);
  assert.equal(
    display.methods.getFlightList({ search: 'N119' }).rows[0].id,
    'abc119',
  );
  assert.equal(flightState.records.data.size, 120);
});

test('cached display motion preserves each aircraft course/speed rather than the last fleet sample', () => {
  const { display, flightState } = fixture();
  display.prepare();
  display.positionFor('abc7');
  assert.equal(flightState._drCourseDeg, 7);
  assert.equal(flightState._drSpeedMps, 8);
  display.positionFor('abc0');
  assert.equal(flightState._drCourseHold, true);
});

test('filter changes repaint immediately, retain type choices and keep the selected contact available', () => {
  const { display, flightState, ticks } = fixture();
  let notifications = 0;
  display.methods.setRowControlsListener(() => notifications++);
  display.set({
    typeFilterEnabled: true,
    classes: ['helicopter'],
    airborneOnly: true,
  });
  assert.equal(ticks(), 1);
  assert.equal(notifications, 1);
  assert.equal(display.methods.getFlightList().matching, 60);
  flightState._trackedIcao = 'abc0';
  assert.equal(display.allows('abc0'), true);
  assert.equal(display.methods.getFlightList().matching, 61);
  assert.equal(
    display.methods.getRowControls().chips.find((c) => c.id === 'flight-types')
      .active,
    true,
  );
  assert.equal(
    display.methods.getRowControls().chips.find((c) => c.id === 'flight-types')
      .params.displayFilters.typeFilterEnabled,
    false,
  );
});

test('the full list uses registration/identity when callsigns are blank and visual caches reset on teardown', () => {
  const { display, flightState } = fixture();
  const info = flightState.records.data.get('abc1');
  info.callsign = '   ';
  info.registration = ' N123 ';
  assert.equal(
    display.methods.getFlightList({ search: 'N123' }).rows[0].label,
    'N123',
  );
  info.registration = '';
  assert.equal(
    display.methods
      .getFlightList({ search: 'abc1' })
      .rows.find((row) => row.id === 'abc1').label,
    'abc1',
  );
  display.prepare();
  assert.ok(display.positionFor('abc1'));
  display.resetVisuals();
  assert.equal(display.positionFor('abc1'), null);
  assert.equal(
    display.get().declutterEnabled,
    true,
    'display preferences survive visual teardown',
  );
});
