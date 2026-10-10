import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaceSearch, parsePlaces } from '../apps/api/src/places.ts';
import { NCR_PLACES } from '@paanipath/data';
import { NCR_BOUNDS, withinBounds, routeInput, PROFILES } from '@paanipath/domain';
import { remapDrafts } from '../apps/web/src/trip.ts';

const feature = { properties: { name: 'Sector 62', city: 'Noida', state: 'Uttar Pradesh', osm_id: 123, osm_type: 'N' }, geometry: { coordinates: [77.3736, 28.6271] } };
test('NCR saved places include all requested cities and outer-region districts within the envelope', () => {
  for (const id of ['noida', 'greater-noida', 'gurugram', 'ghaziabad', 'faridabad', 'alwar', 'bharatpur', 'karnal']) assert(NCR_PLACES.some(place => place.id === id));
  assert(NCR_PLACES.every(place => withinBounds(place.coords, NCR_BOUNDS)));
});
test('provider features use lat/lng order and reject malformed or out-of-region coordinates', () => {
  const raw = { features: [feature, null, { geometry: { coordinates: [77, 28] }, properties: null },
    { ...feature, geometry: { coordinates: [0, 0] } }, { ...feature, geometry: { coordinates: [77, NaN] } }] };
  const places = parsePlaces(raw);
  assert.equal(places.length, 1); assert.deepEqual(places[0]?.coords, [28.6271, 77.3736]);
  assert.equal(places[0]?.name, 'Sector 62, Noida, Uttar Pradesh');
  assert.deepEqual(parsePlaces({}), []);
});
test('local search works offline, supports Gurgaon alias, and validates query lengths', async () => {
  const search = new PlaceSearch('https://example.test/api/', async () => { throw new Error('must not connect'); });
  assert((await search.search('Gurgaon', false)).places.some(place => place.id === 'gurugram'));
  assert((await search.search('Greater Noida', false)).places.some(place => place.id === 'greater-noida'));
  await assert.rejects(search.search('x', true), /between 2 and 120/);
  await assert.rejects(search.search('x'.repeat(121), true), /between 2 and 120/);
});
test('online search bounds results to NCR, deduplicates in-flight queries and caches results', async () => {
  let calls = 0; let clock = 10_000;
  const search = new PlaceSearch('https://example.test/api/', async url => {
    calls++; assert.equal(new URL(url).searchParams.get('bbox'), '75.5,26.5,78.75,30.25');
    return Response.json({ features: [feature] });
  }, () => clock);
  const [a, b] = await Promise.all([search.search('Sector 62 Noida', true), search.search('Sector 62 Noida', true)]);
  assert.deepEqual(a, b); assert.equal(calls, 1);
  assert.deepEqual(await search.search('Sector 62 Noida', true), a); assert.equal(calls, 1);
  assert((await search.search('Ghaziabad', true)).warning); assert.equal(calls, 1);
  clock += 1200; await search.search('Ghaziabad', true); assert.equal(calls, 2);
});
test('provider failure is visible and falls back only to labelled saved places', async () => {
  const search = new PlaceSearch('https://example.test/api/', async () => new Response('', { status: 503 }));
  const result = await search.search('Ghaziabad', true);
  assert.equal(result.source, 'local'); assert(result.warning?.includes('unavailable'));
  assert(result.places.some(place => place.id === 'ghaziabad'));
});
test('long provider addresses and IDs remain valid shared route inputs', () => {
  const places = parsePlaces({ features: [{ ...feature, properties: { ...feature.properties, name: 'Long address '.repeat(40), osm_type: 'N'.repeat(200) } }] });
  assert(places[0]); assert(places[0].name.length <= 100); assert(places[0].id.length <= 100);
  assert.doesNotThrow(() => routeInput({ locations: [places[0], NCR_PLACES[0]], profile: PROFILES[1] }));
});
test('stop edits preserve uncommitted searches through insertion, removal, movement and reversal', () => {
  const drafts = { 0: 'Delhi address', 2: 'Noida address' };
  assert.deepEqual(remapDrafts(drafts, [2, 1, 0]), { 0: 'Noida address', 2: 'Delhi address' });
  assert.deepEqual(remapDrafts(drafts, [0, -1, 1, 2]), { 0: 'Delhi address', 3: 'Noida address' });
  assert.deepEqual(remapDrafts(drafts, [0, 2]), { 0: 'Delhi address', 1: 'Noida address' });
  assert.deepEqual(drafts, { 0: 'Delhi address', 2: 'Noida address' });
});
