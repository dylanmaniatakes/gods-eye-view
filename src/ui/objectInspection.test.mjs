import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  getContextStore,
  getSelectedEntityContext,
  selectTrackedSubjectContext,
} from '../data/contextStore.js';
import {
  registerPickOwner,
  unregisterPickOwner,
} from '../data/pickRegistry.js';
import {
  createObjectInspection,
  readInspection,
  inspectionFields,
} from './objectInspection.js';

function setup(t) {
  const context = getContextStore();
  context.entities.clear();
  context.selectedEntityId = null;
  let live = {
    icao24: 'abc123',
    latitude: 40,
    longitude: -75,
    altitudeM: 10000,
    velocityMps: 200,
  };
  selectTrackedSubjectContext({
    id: 'abc123',
    layerId: 'flights',
    label: 'QA FLIGHT',
    properties: { registration: 'N123' },
  });
  const manager = {
    layers: new Map([
      ['flights', { module: { name: 'Flights', getTrackedInfo: () => live } }],
    ]),
    isEnabled: () => true,
  };
  let picked = { id: 'abc123' };
  const actions = new Map();
  const pending = [];
  const models = [];
  const focused = [];
  const stock = () => {};
  let original = stock;
  let reveals = 0;
  registerPickOwner('flights', (id) => id === 'abc123');
  const owner = createObjectInspection({
    viewer: {
      scene: { canvas: {}, pick: () => picked },
      screenSpaceEventHandler: {
        getInputAction: () => original,
        removeInputAction: () => {
          original = undefined;
        },
        setInputAction: (fn) => {
          original = fn;
        },
      },
    },
    getManager: () => manager,
    publish: (model) => models.push(model),
    reveal: () => {
      reveals++;
    },
    focus: (model) => focused.push(model),
    restore() {},
    handlerFactory: () => ({
      setInputAction: (fn, type) => actions.set(type, fn),
      destroy() {},
    }),
    schedule: (fn) => pending.push(fn),
  });
  t.after(() => {
    owner.destroy();
    unregisterPickOwner('flights');
  });
  return {
    owner,
    manager,
    models,
    focused,
    actions,
    setLive: (value) => {
      live = value;
    },
    setPick: (value) => {
      picked = value;
    },
    flush: () => {
      while (pending.length) pending.shift()();
    },
    original: () => original,
    stock,
    reveals: () => reveals,
  };
}
test('single click opens live details without camera focus; double click focuses the selected tracked entity', (t) => {
  const s = setup(t);
  s.actions.get(Cesium.ScreenSpaceEventType.LEFT_CLICK)({
    position: { x: 1, y: 1 },
  });
  s.flush();
  assert.equal(s.models.at(-1).label, 'QA FLIGHT');
  assert.equal(s.focused.length, 0);
  assert.equal(s.reveals(), 1);
  s.setPick({
    id: { id: 'cesium-generated-id', gevTrackedId: 'flights:abc123' },
  });
  s.actions.get(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)({
    position: { x: 1, y: 1 },
  });
  s.flush();
  assert.equal(s.focused.at(-1).id, 'abc123');
  s.owner.destroy();
  assert.equal(s.original(), s.stock);
});
test('details read fresh telemetry and replacement/deselection cannot resurrect an old object', (t) => {
  const s = setup(t);
  const target = { layerId: 'flights', id: 'abc123', contextId: 'abc123' };
  s.setLive({
    icao24: 'abc123',
    latitude: 42,
    longitude: -73,
    altitudeM: 12000,
  });
  assert.equal(readInspection(s.manager, target).latitude, 42);
  s.setLive({ icao24: 'different', latitude: 43 });
  assert.equal(readInspection(s.manager, target), null);
  s.setPick(null);
  s.actions.get(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK)({
    position: {},
  });
  s.flush();
  assert.equal(s.focused.length, 0);
});
test('public nested details are escaped as text and bounded', () => {
  const fields = inspectionFields({
    units: [{ name: '<b>TEST</b>', status: 'Active' }],
    ignored: undefined,
  });
  assert.equal(fields[0].value, '<b>TEST</b>');
  assert.equal(fields[1].label, 'units · 0 · status');
  assert.equal(
    inspectionFields(
      Object.fromEntries(Array.from({ length: 300 }, (_, i) => [i, i])),
    ).length,
    200,
  );
});

test('static Cesium objects expose their public properties and live position', (t) => {
  const s = setup(t);
  const entity = new Cesium.Entity({
    id: 'earthquake:qa',
    position: Cesium.Cartesian3.fromDegrees(-75, 40, 0),
    properties: { mag: 5.2, place: 'Synthetic event' },
  });
  const model = readInspection(s.manager, {
    layerId: 'map-object',
    id: entity.id,
    entity,
  });
  assert.ok(Math.abs(model.latitude - 40) < 1e-8);
  assert.equal(model.label, 'Synthetic event');
  assert.ok(
    model.fields.some(
      (field) => field.label === 'mag' && field.value === '5.2',
    ),
  );
  entity.show = false;
  assert.equal(
    readInspection(s.manager, { layerId: 'map-object', id: entity.id, entity }),
    null,
  );
});
test('dragging over a selected object cannot open or focus its inspector', (t) => {
  const s = setup(t);
  const types = Cesium.ScreenSpaceEventType;
  s.actions.get(types.LEFT_DOWN)({ position: { x: 0, y: 0 } });
  s.actions.get(types.MOUSE_MOVE)({ endPosition: { x: 20, y: 20 } });
  s.actions.get(types.LEFT_UP)({ position: { x: 20, y: 20 } });
  s.actions.get(types.LEFT_CLICK)({ position: { x: 20, y: 20 } });
  s.flush();
  assert.equal(s.reveals(), 0);
  assert.equal(s.focused.length, 0);
});

test('PennDOT-only selection remains inspectable through the shared camera viewer', () => {
  const context = getContextStore();
  context.entities.clear();
  context.selectedEntityId = null;
  const camera = {
    id: '511pa-qa',
    name: 'SYNTHETIC PENNDOT CAMERA',
    lat: 40,
    lon: -75,
  };
  const sharedViewer = {
    name: 'Cameras',
    getUIState: () => ({ activeCamera: camera }),
  };
  const manager = {
    layers: new Map([
      ['cctv', { module: sharedViewer }],
      ['penndot-traffic-cams', { module: { cameraViewer: sharedViewer } }],
    ]),
    isEnabled: (id) => id === 'penndot-traffic-cams',
  };
  selectTrackedSubjectContext({
    id: camera.id,
    layerId: 'cctv',
    label: camera.name,
  });
  assert.equal(
    getSelectedEntityContext({ dataManager: manager }).id,
    camera.id,
    'shared selection remains available to voice/context callers',
  );
  const target = { layerId: 'cctv', id: camera.id };
  const model = readInspection(manager, target);
  assert.equal(model.id, camera.id);
  assert.equal(model.label, camera.name);
  assert.equal(model.latitude, camera.lat);
  manager.isEnabled = () => false;
  assert.equal(
    readInspection(manager, target),
    null,
    'both camera categories off dismiss inspection',
  );
  assert.equal(getSelectedEntityContext({ dataManager: manager }), null);
});
