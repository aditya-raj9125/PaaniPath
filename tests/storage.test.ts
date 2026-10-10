import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { SqliteStore } from '@paanipath/data';

test('SQLite persists across reopen and rejects stale revision writes', async () => {
  const root = resolve('.data/test-storage'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'case-'));
  const first = new SqliteStore(directory);
  try {
    assert.equal(await first.compareAndSwap(undefined, { revision: 1, graphVersion: 'test', spots: [], rateLimits: {} }), true);
    assert.equal(await first.compareAndSwap(undefined, { revision: 1, graphVersion: 'test', spots: [], rateLimits: {} }), false);
    assert.equal(await first.compareAndSwap(0, { revision: 2, graphVersion: 'test', spots: [], rateLimits: {} }), false);
    await first.putPhoto('test-image', { contentType: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
  } finally { first.close(); }
  const second = new SqliteStore(directory);
  try { assert.equal((await second.read())?.revision, 1); assert.deepEqual((await second.getPhoto('test-image'))?.bytes, new Uint8Array([1, 2, 3])); }
  finally { second.close(); await rm(directory, { recursive: true }); }
});
