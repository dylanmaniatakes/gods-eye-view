import test from 'node:test';
import assert from 'node:assert/strict';
import { createSavedViews, validCamera } from './savedViews.js';
const camera = (lat = 40) => ({
  lat,
  lon: -75,
  alt: 24000,
  heading: 10,
  pitch: 0,
  roll: 0,
});
function setup() {
  let current = camera();
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key),
    setItem: (key, value) => data.set(key, value),
  };
  const create = () =>
    createSavedViews({
      storage,
      capture: () => ({ ...current }),
      restore: (value) => {
        current = value;
      },
    });
  return {
    create,
    storage,
    set: (value) => {
      current = value;
    },
    current: () => current,
  };
}
test('named views persist, restore exact orientation, update explicitly and undo', () => {
  const s = setup();
  const views = s.create();
  views.save('Home');
  assert.throws(() => views.save('Home'), /exists/);
  s.set(camera(30));
  views.restore('Home');
  assert.deepEqual(s.current(), camera());
  views.undo();
  assert.deepEqual(s.current(), camera(30));
  views.save('Home', true);
  assert.deepEqual(s.create().list(), [{ name: 'Home', camera: camera(30) }]);
  views.remove('Home');
  assert.deepEqual(s.create().list(), []);
});
test('corrupt storage, invalid cameras, limits and write failures are bounded', () => {
  assert.equal(validCamera({ ...camera(), alt: NaN }), false);
  const broken = createSavedViews({
    storage: {
      getItem: () => '{',
      setItem: () => {
        throw new Error('quota');
      },
    },
    capture: camera,
  });
  assert.deepEqual(broken.list(), []);
  assert.throws(() => broken.save('Home'), /quota/);
  assert.deepEqual(broken.list(), []);
  assert.throws(() => broken.save(' '), /name/);
  assert.throws(() => broken.restore('missing'), /not found/);
  const s = setup();
  const views = s.create();
  for (let i = 0; i < 50; i++) views.save(String(i));
  assert.throws(() => views.save('overflow'), /limit/);
});

test('tabs merge newly saved bookmarks instead of overwriting another tab library', () => {
  const s = setup();
  const first = s.create();
  const second = s.create();
  first.save('North');
  second.save('South');
  assert.deepEqual(
    first.list().map((row) => row.name),
    ['North', 'South'],
  );
  second.remove('North');
  assert.deepEqual(
    first.list().map((row) => row.name),
    ['South'],
  );
});
