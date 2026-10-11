import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { ROAD_HOTSPOTS, ROAD_SEED_PROVENANCE, NCR_PLACES, reconcileSeedSpots, SEED_VERSION, seedApiSpots } from '@paanipath/data';
import { withinBounds, NCR_BOUNDS, REPORT_CAPACITY } from '@paanipath/domain';
import { PaaniPathService } from '../apps/api/src/service.ts';
import { ApiRouting } from '../apps/api/src/api-routing.ts';
import { MemoryStore, NOW, spot } from './helpers.ts';

test('500 irregular hotspots contain 6505 road-snapped cases with 6–20 cases per hotspot', () => {
  const seeds = seedApiSpots(NOW);
  assert.equal(seeds.length, 6505); assert.equal(new Set(seeds.map(seed => seed.id)).size, 6505);
  assert.equal(ROAD_HOTSPOTS.length, 500);
  assert.equal(ROAD_HOTSPOTS.filter(hotspot => hotspot.region === 'Gurugram').length, 150);
  assert.equal(new Set(ROAD_HOTSPOTS.map(hotspot => hotspot.cases.length)).size, 15);
  assert(ROAD_HOTSPOTS.every(hotspot => hotspot.cases.length >= 6 && hotspot.cases.length <= 20));
  assert(ROAD_HOTSPOTS.every(hotspot => new Set(hotspot.cases.map(coords => coords.join(','))).size === hotspot.cases.length));
  assert(seeds.every(seed => withinBounds(seed.coords, NCR_BOUNDS) && seed.source === 'seeded' && seed.roadPlacement?.snapped));
  assert.deepEqual([...new Set(seeds.map(seed => seed.depth))].sort(), [1, 2, 3, 4]);
  assert(NCR_PLACES.some(place => place.id === 'ggn-hero-honda'));
  assert(ROAD_SEED_PROVENANCE.provider.includes('snap')); assert(ROAD_SEED_PROVENANCE.graphDate);
});
test('catalogue upgrade removes old offset seeds and preserves community and matching scenario state', () => {
  const community = spot('community', 2, { photoId: 'photo', votes: { bob: 'confirm' } });
  const initial = seedApiSpots(NOW)[0]; assert(initial);
  const oldSeed = { ...initial, confirms: 2, lastConfirmedAt: NOW - 100_000, votes: { carol: 'confirm' as const } };
  const legacy = spot('old-offset', 2, { id: 'api-seed-0-0', source: 'seeded' });
  const upgraded = reconcileSeedSpots([community, oldSeed, legacy], NOW);
  assert.equal(upgraded.length, 6506); assert.deepEqual(upgraded.find(seed => seed.id === community.id), community);
  assert.deepEqual(upgraded.find(seed => seed.id === oldSeed.id), oldSeed);
  assert(!upgraded.some(seed => seed.id === legacy.id));
});
test('seed upgrades respect capacity without dropping community reports', () => {
  const community = Array.from({ length: REPORT_CAPACITY - 20 }, (_, i) => spot(`community-${i}`));
  const upgraded = reconcileSeedSpots(community, NOW);
  assert.equal(upgraded.length, REPORT_CAPACITY); assert.equal(upgraded.filter(seed => seed.source === 'community').length, community.length);
});
test('existing stores upgrade exactly once; disabled seeds remain hidden without changing community data', async () => {
  const store = new MemoryStore();
  store.state = { revision: 2, graphVersion: 'previous', spots: [spot('community')], rateLimits: {} };
  const service = new PaaniPathService(store, { demoMode: false, seededMode: true, graphVersion: 'api', routing: new ApiRouting(''), clock: () => NOW });
  const first = await service.snapshot(); assert.equal(first.spots.length, 6506); assert.equal(first.seedVersion, SEED_VERSION);
  assert.equal((await service.snapshot()).revision, first.revision);
  const live = new PaaniPathService(store, { demoMode: false, seededMode: false, graphVersion: 'api', routing: new ApiRouting(''), clock: () => NOW });
  assert.equal((await live.bootstrap('actor')).spots.length, 1);
});
test('full catalogue fits compressed DynamoDB payload and Lambda response budgets', () => {
  const payload = JSON.stringify({ revision: 1, graphVersion: 'api', spots: seedApiSpots(NOW), rateLimits: {} });
  assert(Buffer.byteLength(gzipSync(payload).toString('base64')) < 350_000);
  assert(Buffer.byteLength(payload) < 5_500_000);
});
