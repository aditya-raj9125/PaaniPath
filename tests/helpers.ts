import type { Depth, Spot } from '@paanipath/domain';
import type { Photo, Snapshot, Store } from '@paanipath/data';

export const NOW = 1_800_000_000_000;
export function spot(segmentId: string, depth: Depth = 3, overrides: Partial<Spot> = {}): Spot {
  return { id: `spot-${segmentId}`, name: 'Test water', coords: [28.62, 77.22], segmentId, depth, source: 'community',
    createdAt: NOW, lastConfirmedAt: NOW, confirms: 0, dismisses: 0, cleared: false, reporterId: 'reporter', votes: {}, ...overrides };
}
export class MemoryStore implements Store {
  state: Snapshot | undefined;
  readonly photos = new Map<string, Photo>();
  read(): Promise<Snapshot | undefined> { return Promise.resolve(this.state === undefined ? undefined : structuredClone(this.state)); }
  compareAndSwap(previous: number | undefined, next: Snapshot): Promise<boolean> {
    if (this.state?.revision !== previous) return Promise.resolve(false);
    this.state = structuredClone(next); return Promise.resolve(true);
  }
  putPhoto(id: string, photo: Photo): Promise<void> { this.photos.set(id, photo); return Promise.resolve(); }
  getPhoto(id: string): Promise<Photo | undefined> { return Promise.resolve(this.photos.get(id)); }
}
