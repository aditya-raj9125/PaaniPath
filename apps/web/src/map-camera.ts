import type { ViewBox } from './map-geometry.ts';

/** Smooth centre movement and logarithmic zoom preserve a positive, fixed-aspect viewport. */
export function interpolateCamera(from: ViewBox, to: ViewBox, progress: number): ViewBox {
  const t = Math.max(0, Math.min(1, progress));
  if (t === 0) return from;
  if (t === 1) return to;
  const eased = t * t * (3 - 2 * t);
  const width = Math.exp(Math.log(from[2]) + (Math.log(to[2]) - Math.log(from[2])) * eased);
  const height = width * to[3] / to[2];
  const cx = from[0] + from[2] / 2 + (to[0] + to[2] / 2 - from[0] - from[2] / 2) * eased;
  const cy = from[1] + from[3] / 2 + (to[1] + to[3] / 2 - from[1] - from[3] / 2) * eased;
  return [cx - width / 2, cy - height / 2, width, height];
}

export interface AnimationDriver {
  readonly request: (callback: (time: number) => void) => number;
  readonly cancel: (id: number) => void;
}

/** A new route or user gesture cancels the preceding flight without jumping to its destination. */
export class CameraAnimation {
  private frame: number | undefined;
  private generation = 0;
  constructor(private readonly driver: AnimationDriver) {}

  cancel(): void {
    this.generation++;
    if (this.frame !== undefined) this.driver.cancel(this.frame);
    this.frame = undefined;
  }

  fly(from: ViewBox, to: ViewBox, update: (box: ViewBox, refresh: boolean) => void, reducedMotion = false): void {
    this.cancel();
    if (reducedMotion) { update(to, true); return; }
    const generation = this.generation;
    let start: number | undefined;
    let lastRefresh = -Infinity;
    const tick = (time: number): void => {
      if (generation !== this.generation) return;
      start ??= time;
      const progress = Math.min(1, (time - start) / 850);
      // Limit tile requests / density recomputation while maintaining smooth geometry movement.
      const refresh = progress === 1 || time - lastRefresh >= 170;
      if (refresh) lastRefresh = time;
      update(interpolateCamera(from, to, progress), refresh);
      this.frame = progress < 1 ? this.driver.request(tick) : undefined;
    };
    this.frame = this.driver.request(tick);
  }
}
