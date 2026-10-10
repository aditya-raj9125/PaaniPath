import type { Coordinates } from './types.ts';

export type CoverageBounds = readonly [south: number, west: number, north: number, east: number];
// Search viewport only, not a surveyed administrative NCR boundary or a road download.
export const NCR_BOUNDS: CoverageBounds = [26.5, 75.5, 30.25, 78.75];
export const URBAN_NCR_BOUNDS: CoverageBounds = [28.12, 76.5, 29.15, 77.95];
export function withinBounds(coords: Coordinates, bounds: CoverageBounds): boolean {
  return coords[0] >= bounds[0] && coords[0] <= bounds[2] && coords[1] >= bounds[1] && coords[1] <= bounds[3];
}
