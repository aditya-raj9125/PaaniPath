import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Photo, Snapshot, Store } from './store.ts';

/** WAL plus optimistic revisions protect against concurrent local request updates. */
export class SqliteStore implements Store {
  private readonly database: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.database = new DatabaseSync(join(directory, 'paanipath.sqlite'));
    this.database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, content_type TEXT NOT NULL, bytes BLOB NOT NULL);`);
  }
  read(): Promise<Snapshot | undefined> {
    const row = this.database.prepare('SELECT payload FROM state WHERE id=1').get();
    return Promise.resolve(row === undefined ? undefined : JSON.parse(String(row.payload)) as Snapshot);
  }
  compareAndSwap(previousRevision: number | undefined, next: Snapshot): Promise<boolean> {
    const payload = JSON.stringify(next);
    const statement = previousRevision === undefined ?
      this.database.prepare('INSERT OR IGNORE INTO state(id,revision,payload) VALUES(1,?,?)') :
      this.database.prepare('UPDATE state SET revision=?,payload=? WHERE id=1 AND revision=?');
    const result = previousRevision === undefined ? statement.run(next.revision, payload) : statement.run(next.revision, payload, previousRevision);
    return Promise.resolve(result.changes === 1);
  }
  putPhoto(id: string, photo: Photo): Promise<void> {
    this.database.prepare('INSERT INTO photos(id,content_type,bytes) VALUES(?,?,?)').run(id, photo.contentType, photo.bytes);
    return Promise.resolve();
  }
  getPhoto(id: string): Promise<Photo | undefined> {
    const row = this.database.prepare('SELECT content_type,bytes FROM photos WHERE id=?').get(id);
    if (row === undefined) return Promise.resolve(undefined);
    const bytes = row.bytes;
    if (!(bytes instanceof Uint8Array) || (row.content_type !== 'image/png' && row.content_type !== 'image/jpeg')) throw new Error('Invalid stored photo.');
    return Promise.resolve({ contentType: row.content_type, bytes });
  }
  close(): void { this.database.close(); }
}
