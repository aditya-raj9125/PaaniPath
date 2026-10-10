import type { Coordinates } from '@paanipath/domain';

const EARTH_RADIUS = 6_371_008.8;
const radians = (value: number): number => value * Math.PI / 180;
export function distanceMetres(a: Coordinates, b: Coordinates): number {
  const lat = radians(b[0] - a[0]);
  const lng = radians(b[1] - a[1]);
  const h = Math.sin(lat / 2) ** 2 + Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(lng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(Math.min(1, h)));
}
/** Local tangent-plane distance for proximity to short provider road-geometry segments. */
export function distanceToSegment(point: Coordinates, a: Coordinates, b: Coordinates): number {
  const scale = Math.cos(radians(point[0]));
  const ax = (a[1] - point[1]) * scale;
  const ay = a[0] - point[0];
  const bx = (b[1] - point[1]) * scale;
  const by = b[0] - point[0];
  const dx = bx - ax;
  const dy = by - ay;
  const denom = dx * dx + dy * dy;
  const t = denom === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denom));
  return Math.hypot(ax + t * dx, ay + t * dy) * Math.PI / 180 * EARTH_RADIUS;
}
