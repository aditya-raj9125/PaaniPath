import type { Coordinates } from '@paanipath/domain';

export type Bounds = readonly [number, number, number, number];
export type ViewBox = readonly [number, number, number, number];
export interface StreetTile { readonly key: string; readonly url: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
/** Shared fit for a selected place or full route, preserving map aspect ratio and padding. */
export function fitViewBox(coords: readonly Coordinates[], bounds: Bounds): ViewBox | undefined {
  if (coords.length === 0) return undefined;
  let left = Infinity; let right = -Infinity; let top = Infinity; let bottom = -Infinity;
  for (const coord of coords) {
    const [x, y] = project(coord, bounds);
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const width = Math.max(3, (right - left) * 1.4, (bottom - top) / .76 * 1.4);
  return [(left + right - width) / 2, (top + bottom - width * .76) / 2, width, width * .76];
}
const mercator = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));

/** Expand the coverage rectangle to an undistorted Web Mercator viewport. */
export function mapBounds(bounds: Bounds): Bounds {
  const [south, west, north, east] = bounds;
  const centreY = (mercator(north) + mercator(south)) / 2;
  const centreX = (west + east) / 2;
  const width = Math.max((east - west) * Math.PI / 180, (mercator(north) - mercator(south)) / .76) * (1 + 1e-10);
  const latitude = (y: number): number => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
  return [latitude(centreY - width * .76 / 2), centreX - width * 90 / Math.PI,
    latitude(centreY + width * .76 / 2), centreX + width * 90 / Math.PI];
}
export function project(coords: Coordinates, bounds: Bounds): readonly [number, number] {
  const [south, west, north, east] = bounds;
  return [(coords[1] - west) / (east - west) * 1000,
    (mercator(north) - mercator(coords[0])) / (mercator(north) - mercator(south)) * 760];
}
export function unproject(x: number, y: number, bounds: Bounds): Coordinates {
  const [south, west, north, east] = bounds;
  const value = mercator(north) - y / 760 * (mercator(north) - mercator(south));
  return [(2 * Math.atan(Math.exp(value)) - Math.PI / 2) * 180 / Math.PI, west + x / 1000 * (east - west)];
}

/** Request only visible tiles; zoom follows rendered resolution, not a fixed city-wide grid. */
export function visibleTiles(bounds: Bounds, box: ViewBox, pixelsWide: number): StreetTile[] {
  const [x, y, width, height] = box;
  const topLeft = unproject(x, y, bounds);
  const bottomRight = unproject(x + width, y + height, bounds);
  const degreesWide = bottomRight[1] - topLeft[1];
  const z = Math.max(8, Math.min(18, Math.floor(Math.log2(360 * Math.max(1, pixelsWide) / (256 * degreesWide)))));
  const n = 2 ** z;
  const tileX = (lng: number): number => (lng + 180) / 360 * n;
  const tileY = (lat: number): number => (1 - mercator(Math.max(-85, Math.min(85, lat))) / Math.PI) / 2 * n;
  const result: StreetTile[] = [];
  const left = Math.max(0, Math.floor(tileX(topLeft[1]))); const right = Math.min(n - 1, Math.floor(tileX(bottomRight[1])));
  const top = Math.max(0, Math.floor(tileY(topLeft[0]))); const bottom = Math.min(n - 1, Math.floor(tileY(bottomRight[0])));
  for (let tx = left; tx <= right; tx++) {
    for (let ty = top; ty <= bottom; ty++) {
      const lng = tx / n * 360 - 180;
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n))) * 180 / Math.PI;
      const [px, py] = project([lat, lng], bounds);
      const key = `${z}/${tx}/${ty}`;
      result.push({ key, url: `https://tile.openstreetmap.org/${key}.png`, x: px, y: py,
        width: 1000 / (tileX(bounds[3]) - tileX(bounds[1])), height: 760 / (tileY(bounds[0]) - tileY(bounds[2])) });
    }
  }
  return result;
}
