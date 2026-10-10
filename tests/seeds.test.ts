import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GURUGRAM_HOTSPOTS, NCR_PLACES, reconcileSeedSpots, SEED_VERSION, seedApiSpots } from '@paanipath/data';
import { withinBounds, NCR_BOUNDS } from '@paanipath/domain';
import { PaaniPathService } from '../apps/api/src/service.ts';
import { ApiRouting } from '../apps/api/src/api-routing.ts';
import { MemoryStore, NOW, spot } from './helpers.ts';

test('320 distinct seeds include 96 source-linked Gurugram scenarios at 24 reported locations', () => {
  const seeds = seedApiSpots(NOW);
  assert.equal(seeds.length, 320); assert.equal(new Set(seeds.map(seed => seed.id)).size, 320);
  assert.equal(GURUGRAM_HOTSPOTS.length, 24); assert.equal(seeds.filter(seed => seed.evidence !== undefined).length, 96);
  assert(seeds.every(seed => withinBounds(seed.coords, NCR_BOUNDS)));
  assert(seeds.every(seed => seed.source === 'seeded'));
  assert(seeds.filter(seed => seed.evidence !== undefined).every(seed => seed.evidence?.url.startsWith('https://') && seed.evidence.scenario && seed.evidence.coordinates === 'approximate'));
  assert.deepEqual([...new Set(seeds.map(seed => seed.depth))].sort(), [1, 2, 3, 4]);
  assert(NCR_PLACES.some(place => place.id === 'ggn-hero-honda'));
});
test('catalogue upgrade preserves community observations, photos and existing scenario votes/freshness', () => {
  const community = spot('community', 2, { photoId: 'photo', votes: { bob: 'confirm' } });
  const initial = seedApiSpots(NOW)[0]; assert(initial);
  const oldSeed = { ...initial, confirms: 2, lastConfirmedAt: NOW - 100_000, votes: { carol: 'confirm' as const } };
  const upgraded = reconcileSeedSpots([community, oldSeed], NOW);
  assert.equal(upgraded.length, 321); assert.deepEqual(upgraded.find(seed => seed.id === community.id), community);
  assert.deepEqual(upgraded.find(seed => seed.id === oldSeed.id), oldSeed);
});
test('seed upgrades respect the 400 observation capacity without dropping community reports', () => {
  const community = Array.from({ length: 350 }, (_, i) => spot(`community-${i}`));
  const upgraded = reconcileSeedSpots(community, NOW);
  assert.equal(upgraded.length, 400); assert.equal(upgraded.filter(seed => seed.source === 'community').length, 350);
  assert(upgraded.filter(seed => seed.source === 'seeded').every(seed => seed.evidence !== undefined));
});
test('existing seed-enabled stores upgrade exactly once, live-only stores do not gain scenarios', async () => {
  const store = new MemoryStore();
  store.state = { revision: 2, graphVersion: 'previous', spots: [spot('community')], rateLimits: {} };
  const service = new PaaniPathService(store, { demoMode: false, seededMode: true, graphVersion: 'api', routing: new ApiRouting(''), clock: () => NOW });
  const first = await service.snapshot(); assert.equal(first.spots.length, 321); assert.equal(first.seedVersion, SEED_VERSION);
  assert.equal((await service.snapshot()).revision, first.revision);
  const liveStore = new MemoryStore(); liveStore.state = { revision: 2, graphVersion: 'previous', spots: [spot('community')], rateLimits: {} };
  const live = new PaaniPathService(liveStore, { demoMode: false, seededMode: false, graphVersion: 'api', routing: new ApiRouting('') });
  assert.equal((await live.snapshot()).spots.length, 1); assert.equal((await live.snapshot()).revision, 2);
});
