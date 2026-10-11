import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Coordinates } from '@paanipath/domain';
import { PointIndex, distanceToSegment } from '@paanipath/routing';

test('grid proximity matches exhaustive scans across boundaries and repeated/long segments', () => {
  const values = Array.from({ length: 1500 }, (_, id) => ({ id, coords: [28.4 + (id % 50) * .001, 77 + Math.floor(id / 50) * .001] as Coordinates }));
  const index = new PointIndex(values);
  const segments: readonly (readonly [Coordinates, Coordinates])[] = [
    [[28.405, 77.005], [28.43, 77.025]], [[28.42, 77.01], [28.42, 77.01]], [[-80, -170], [80, 170]],
    [[28.4001, 77.00499], [28.442, 77.01501]],
  ];
  for (const [a, b] of segments) {
    const exact = values.filter(value => distanceToSegment(value.coords, a, b) <= 85).map(value => value.id).sort((a, b) => a - b);
    const indexed = index.nearSegment(a, b, 85).filter(value => distanceToSegment(value.coords, a, b) <= 85).map(value => value.id).sort((a, b) => a - b);
    assert.deepEqual(indexed, exact);
  }
  assert(index.nearSegment([28.405, 77.005], [28.406, 77.006], 85).length < values.length / 4);
});
