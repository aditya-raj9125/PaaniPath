import type { Coordinates } from '@paanipath/domain';

/** Conservative geographic grid; exact proximity is always checked by the caller. */
export class PointIndex<T extends { readonly coords: Coordinates }> {
  private readonly cells = new Map<string, T[]>();
  private readonly cell = .005;
  constructor(private readonly values: readonly T[]) {
    for (const value of values) {
      const key = this.key(Math.floor(value.coords[0] / this.cell), Math.floor(value.coords[1] / this.cell));
      const bucket = this.cells.get(key) ?? []; bucket.push(value); this.cells.set(key, bucket);
    }
  }
  private key(y: number, x: number): string { return `${y}:${x}`; }
  nearSegment(a: Coordinates, b: Coordinates, metres: number): readonly T[] {
    const dy = metres / 111_000;
    const latitude = Math.max(Math.abs(a[0]), Math.abs(b[0])) + dy;
    const dx = dy / Math.max(.001, Math.cos(Math.min(89.99, latitude) * Math.PI / 180));
    const bottom = Math.floor((Math.min(a[0], b[0]) - dy) / this.cell);
    const top = Math.floor((Math.max(a[0], b[0]) + dy) / this.cell);
    const left = Math.floor((Math.min(a[1], b[1]) - dx) / this.cell);
    const right = Math.floor((Math.max(a[1], b[1]) + dx) / this.cell);
    // Very long segments/polar cases fall back, rather than losing observations.
    if ((top - bottom + 1) * (right - left + 1) > 10_000) return this.values;
    const result: T[] = [];
    for (let y = bottom; y <= top; y++) for (let x = left; x <= right; x++) result.push(...(this.cells.get(this.key(y, x)) ?? []));
    return result;
  }
}
