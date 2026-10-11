import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraAnimation, interpolateCamera } from '../apps/web/src/map-camera.ts';
import type { ViewBox } from '../apps/web/src/map-geometry.ts';

const ncr: ViewBox = [0, 0, 1000, 760];
const route: ViewBox = [480, 360, 20, 15.2];

function frames(): { readonly camera: CameraAnimation; readonly step: (time: number) => void; readonly pending: () => number } {
  let id = 0;
  const callbacks = new Map<number, (time: number) => void>();
  return { camera: new CameraAnimation({ request: callback => { callbacks.set(++id, callback); return id; }, cancel: key => { callbacks.delete(key); } }),
    step: time => { const current = [...callbacks.values()]; callbacks.clear(); current.forEach(callback => callback(time)); }, pending: () => callbacks.size };
}

test('camera interpolation reaches exact bounds, keeps aspect ratio and zooms without negative dimensions', () => {
  assert.deepEqual(interpolateCamera(ncr, route, -1), ncr); assert.deepEqual(interpolateCamera(ncr, route, 2), route);
  let width = ncr[2];
  for (let step = 0; step <= 100; step++) {
    const next = interpolateCamera(ncr, route, step / 100);
    assert(next.every(Number.isFinite)); assert(next[2] > 0 && next[2] <= width); width = next[2];
    assert(Math.abs(next[3] / next[2] - .76) < 1e-10);
  }
});

test('camera flights refresh layers at bounded intervals and finish precisely on the route', () => {
  const scheduler = frames(); const updates: { box: ViewBox; refresh: boolean }[] = [];
  scheduler.camera.fly(ncr, route, (box, refresh) => updates.push({ box, refresh }));
  for (let time = 0; time <= 900; time += 15) scheduler.step(time);
  assert.deepEqual(updates.at(-1)?.box, route); assert.equal(scheduler.pending(), 0);
  assert(updates.length > 30); assert(updates.filter(update => update.refresh).length <= 7);
});

test('gestures and replacement flights cancel old frames; reduced motion fits immediately', () => {
  const scheduler = frames(); const old: ViewBox[] = []; const next: ViewBox[] = [];
  scheduler.camera.fly(ncr, route, box => old.push(box)); scheduler.step(0);
  scheduler.camera.cancel(); scheduler.step(400); assert.equal(old.length, 1);
  scheduler.camera.fly(ncr, route, box => old.push(box));
  scheduler.camera.fly(route, ncr, box => next.push(box));
  scheduler.step(0); scheduler.step(900); assert.equal(old.length, 1); assert.deepEqual(next.at(-1), ncr);
  scheduler.camera.fly(ncr, route, box => next.push(box), true);
  assert.deepEqual(next.at(-1), route); assert.equal(scheduler.pending(), 0);
});
