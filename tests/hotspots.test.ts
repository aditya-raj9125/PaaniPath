import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicSpot, PROFILES } from '@paanipath/domain';
import { seedApiSpots } from '@paanipath/data';
import { groupHotspots, routeHotspots, HOTSPOT_ROUTE_RADIUS_METRES, clusterHotspots, densityStyle, hotspotMarker, caseMarker, hotspotSummary } from '../apps/web/src/hotspots.ts';
import { spot, NOW } from './helpers.ts';

function observation(id: string, coords: readonly [number, number]): ReturnType<typeof publicSpot> {
  const profile = PROFILES[1]; assert(profile);
  return publicSpot(spot(id, 2, { coords, hotspot: { id, name: id, coords } }), profile, NOW);
}

test('map starts without hotspots and a corridor uses the full selected route, not just endpoints', () => {
  const route = [[28.62, 77.20], [28.62, 77.24]] as const;
  const observations = [observation('middle', [28.62, 77.22]), observation('near', [28.626, 77.22]), observation('far', [28.63, 77.22])];
  assert.equal(HOTSPOT_ROUTE_RADIUS_METRES, 750);
  for (const geometry of [undefined, [], [[28.62, 77.22]] as const]) assert.deepEqual(routeHotspots(observations, geometry), []);
  assert.deepEqual(routeHotspots(observations, route).map(hotspot => hotspot.id), ['middle', 'near']);
  const next = [[28.63, 77.20], [28.63, 77.24]] as const;
  assert.deepEqual(routeHotspots(observations, next).map(hotspot => hotspot.id), ['near', 'far']);
});

test('750 m boundary is inclusive and bends, repeated points and reversed geometry retain nearby hotspots', () => {
  const degreesPerMetre = 180 / (Math.PI * 6_371_008.8);
  const route = [[0, 0], [0, .02], [.02, .02]] as const;
  const observations = [observation('inside', [-749 * degreesPerMetre, .01]), observation('boundary', [-750 * degreesPerMetre, .01]),
    observation('outside', [-751 * degreesPerMetre, .01]), observation('bend', [.01, .02])];
  const ids = routeHotspots(observations, route).map(hotspot => hotspot.id);
  assert.deepEqual(ids, ['inside', 'boundary', 'bend']);
  assert.deepEqual(routeHotspots(observations, [...route].reverse()).map(hotspot => hotspot.id), ids);
  assert.deepEqual(routeHotspots(observations, [route[0], ...route]).map(hotspot => hotspot.id), ids);
});

test('nearby cases qualify an off-corridor anchor, preserve complete hotspot counts, and exclude cleared cases', () => {
  const route = [[28.62, 77.20], [28.62, 77.24]] as const;
  const anchor = [28.63, 77.22] as const;
  const near = { ...observation('near', [28.62, 77.22]), hotspot: { id: 'group', name: 'group', coords: anchor } };
  const far = { ...observation('far', anchor), hotspot: near.hotspot };
  const groups = routeHotspots([near, far], route);
  assert.equal(groups.length, 1); assert.equal(groups[0]?.spots.length, 2);
  assert.deepEqual(routeHotspots([{ ...near, cleared: true }, far], route), []);
  assert.deepEqual(routeHotspots([{ ...near, archived: true }, far], route), []);
});

test('overview groups cases, drops cleared/archived observations and increases intensity with count', () => {
  const profile = PROFILES[1]; assert(profile);
  const seeds = seedApiSpots(NOW).map(seed => publicSpot(seed, profile, NOW));
  const groups = groupHotspots(seeds); assert.equal(groups.length, 500);
  assert.equal(groups.reduce((n, group) => n + group.spots.length, 0), 6505);
  assert(densityStyle(16).radius > densityStyle(6).radius);
  assert(densityStyle(16).opacity > densityStyle(6).opacity);
  const first = seeds[0]; assert(first);
  const removed = groupHotspots([{ ...first, cleared: true }, { ...first, archived: true }]); assert.equal(removed.length, 0);
});
test('overview hover markup exposes case count but no individual details; cases require drill-down', () => {
  const profile = PROFILES[1]; assert(profile);
  const group = groupHotspots(seedApiSpots(NOW).map(seed => publicSpot(seed, profile, NOW)))[0]; assert(group);
  const marker = hotspotMarker(group, [10, 20]);
  assert(marker.includes('6 cases')); assert(!marker.includes('<title>')); assert(!marker.includes('data-spot='));
  const summary = hotspotSummary(group); assert(summary.includes('View 6 cases')); assert(!summary.includes('data-spot-id='));
  const expanded = hotspotSummary(group, true); assert.equal((expanded.match(/data-spot-id=/g) ?? []).length, 6);
  const first = group.spots[0]; assert(first); assert(!caseMarker(first, [10, 20], false).includes('<title>'));
});
test('community observations are separate from seed clusters and untrusted names are escaped', () => {
  const profile = PROFILES[1]; assert(profile);
  const community = publicSpot(spot('community', 2, { name: '<script>bad</script>' }), profile, NOW);
  const group = groupHotspots([community])[0]; assert(group && group.id.startsWith('community-'));
  const markup = hotspotSummary(group, true); assert(!markup.includes('<script>')); assert(markup.includes('&lt;script&gt;'));
});
test('zoom aggregation preserves case counts and drilling in separates nearby hotspots', () => {
  const profile = PROFILES[1]; assert(profile);
  const hotspots = groupHotspots(seedApiSpots(NOW).map(seed => publicSpot(seed, profile, NOW)));
  const projection = (coords: readonly [number, number]): readonly [number, number] => [coords[1], coords[0]];
  const overview = clusterHotspots(hotspots, projection, 100);
  assert(overview.length < hotspots.length);
  assert.equal(overview.reduce((sum, hotspot) => sum + hotspot.spots.length, 0), 6505);
  const close = clusterHotspots(hotspots, projection, 1_000_000); assert.equal(close.length, 500);
});
