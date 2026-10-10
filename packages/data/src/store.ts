import type { Spot } from '@paanipath/domain';

export interface Snapshot {
  readonly revision: number;
  readonly graphVersion: string;
  readonly spots: readonly Spot[];
  readonly rateLimits: Readonly<Record<string, readonly number[]>>;
  readonly seedVersion?: string;
}
export interface Photo { readonly contentType: 'image/png' | 'image/jpeg'; readonly bytes: Uint8Array }
export interface Store {
  read(): Promise<Snapshot | undefined>;
  compareAndSwap(previousRevision: number | undefined, next: Snapshot): Promise<boolean>;
  putPhoto(id: string, photo: Photo): Promise<void>;
  getPhoto(id: string): Promise<Photo | undefined>;
}
