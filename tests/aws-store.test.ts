import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { DynamoStore, seedApiSpots } from '@paanipath/data';
import type { Snapshot } from '@paanipath/data';
import { NOW } from './helpers.ts';

test('DynamoDB compression fits the full catalogue and reads old/new snapshots without lost CAS semantics', async () => {
  const access = process.env.AWS_ACCESS_KEY_ID; const secret = process.env.AWS_SECRET_ACCESS_KEY;
  process.env.AWS_ACCESS_KEY_ID = 'test-access'; process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
  const legacy: Snapshot = { revision: 1, graphVersion: 'legacy', spots: [], rateLimits: {} };
  let item: Record<string, { S?: string; N?: string }> = { payload: { S: JSON.stringify(legacy) } };
  let expected: unknown;
  const transport: typeof fetch = (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { Item?: typeof item; ConditionExpression?: string; ExpressionAttributeValues?: unknown };
    if (body.Item) { item = body.Item; expected = body.ExpressionAttributeValues; return Promise.resolve(Response.json({})); }
    return Promise.resolve(Response.json({ Item: item }));
  };
  try {
    const store = new DynamoStore('table', 'bucket', 'ap-south-1', transport);
    assert.deepEqual(await store.read(), legacy);
    const next: Snapshot = { ...legacy, revision: 2, spots: seedApiSpots(NOW) };
    assert(await store.compareAndSwap(1, next)); assert.equal(item.encoding?.S, 'gzip-base64');
    const payload = item.payload?.S; assert(payload); assert(Buffer.byteLength(payload) < 350_000);
    assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(payload, 'base64')).toString('utf8')), next);
    assert.deepEqual(expected, { ':previous': { N: '1' } }); assert.deepEqual(await store.read(), next);
  } finally {
    if (access === undefined) delete process.env.AWS_ACCESS_KEY_ID; else process.env.AWS_ACCESS_KEY_ID = access;
    if (secret === undefined) delete process.env.AWS_SECRET_ACCESS_KEY; else process.env.AWS_SECRET_ACCESS_KEY = secret;
  }
});
