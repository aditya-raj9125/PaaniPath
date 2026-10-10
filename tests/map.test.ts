import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitViewBox, mapBounds, project, unproject, visibleTiles } from '../apps/web/src/map-geometry.ts';
import type { Bounds } from '../apps/web/src/map-geometry.ts';

const delhi: Bounds = [28.59, 77.18, 28.67, 77.27];
test('selected search location is centred immediately and route fit contains every geometry point', () => {
  const bounds = mapBounds([26.5, 75.5, 30.25, 78.75]);
  const place = [28.4335, 77.0055] as const;
  const focus = fitViewBox([place], bounds); assert(focus);
  const [x, y] = project(place, bounds);
  assert(Math.abs(focus[0] + focus[2] / 2 - x) < 1e-8);
  assert(Math.abs(focus[1] + focus[3] / 2 - y) < 1e-8); assert.equal(focus[2], 3);
  const route = [place, [28.47, 77.12], [28.63, 77.21]] as const;
  const fit = fitViewBox(route, bounds); assert(fit);
  for (const point of route) {
    const [px, py] = project(point, bounds);
    assert(px > fit[0] && px < fit[0] + fit[2]); assert(py > fit[1] && py < fit[1] + fit[3]);
  }
  assert(Math.abs(fit[3] / fit[2] - .76) < 1e-8); assert.equal(fitViewBox([], bounds), undefined);
});
test('real map projection round-trips Delhi coordinates without shifting route overlays', () => {
  const bounds = mapBounds(delhi);
  for (const point of [[28.6315, 77.2167], [28.6284, 77.2415], [28.613, 77.2295]] as const) {
    const pixel = project(point, bounds); const actual = unproject(pixel[0], pixel[1], bounds);
    assert(Math.abs(actual[0] - point[0]) < 1e-10); assert(Math.abs(actual[1] - point[1]) < 1e-10);
  }
});
test('Mercator fit preserves square street tiles and contains the coverage bounds', () => {
  const bounds = mapBounds(delhi);
  assert(bounds[0] <= delhi[0]); assert(bounds[1] <= delhi[1]);
  assert(bounds[2] >= delhi[2]); assert(bounds[3] >= delhi[3]);
  const tiles = visibleTiles(bounds, [0, 0, 1000, 760], 1000);
  assert(tiles.length > 0 && tiles.length < 60);
  for (const tile of tiles) assert(Math.abs(tile.width - tile.height) < 1e-7);
});
test('pan and zoom request the visible area at changing resolution, not the full Delhi snapshot', () => {
  const bounds = mapBounds(delhi);
  const wide = visibleTiles(bounds, [0, 0, 1000, 760], 1000);
  const close = visibleTiles(bounds, [400, 300, 100, 76], 1000);
  assert(Number(close[0]?.key.split('/')[0]) > Number(wide[0]?.key.split('/')[0]));
  assert(close.length < 60);
  const pan = visibleTiles(bounds, [1400, 300, 100, 76], 1000);
  assert(!pan.some(tile => close.some(other => other.key === tile.key)));
  assert(close.every(tile => tile.url.startsWith('https://tile.openstreetmap.org/')));
});
