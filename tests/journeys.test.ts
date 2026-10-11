import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_JOURNEYS } from '@paanipath/data';
import { PROFILES, routeInput } from '@paanipath/domain';
import { emptyTrip, journeyTrip, matchesJourney, tripReady } from '../apps/web/src/trip.ts';
import { planner } from '../apps/web/src/views.ts';
import { state } from '../apps/web/src/state.ts';
import { API_MAP_METADATA } from '../apps/api/src/service.ts';

test('ten valid demo trips contain seven direct journeys, two one-stop and one two-stop journeys', () => {
  assert.equal(DEMO_JOURNEYS.length, 10);
  assert.equal(new Set(DEMO_JOURNEYS.map(journey => journey.id)).size, 10);
  assert.deepEqual(DEMO_JOURNEYS.map(journey => journey.locations.length), [2, 2, 2, 2, 2, 2, 2, 3, 3, 4]);
  const profile = PROFILES.find(candidate => candidate.type === 'car'); assert(profile);
  for (const journey of DEMO_JOURNEYS) {
    const request = routeInput({ locations: journey.locations, profile, detourFactor: 2, optimizeOrder: false });
    assert.equal(request.locations.length, journey.locations.length);
    assert(tripReady(request.locations, {}));
  }
});

test('blank startup and partially selected or uncommitted trips cannot request routing', () => {
  const locations = emptyTrip();
  assert.equal(locations.length, 2); assert(locations.every(place => place.name === ''));
  assert(!tripReady([], {})); assert(!tripReady(locations, {}));
  const journey = DEMO_JOURNEYS[0]; assert(journey);
  const origin = journey.locations[0]; assert(origin); locations[0] = origin;
  assert(!tripReady(locations, {}));
  assert(!tripReady(journey.locations, { 1: 'unselected typed address' }));
  assert(tripReady(journey.locations, { 1: journey.locations[1]?.name ?? '' }));
});

test('preset copies allow reversing and editing without mutating the catalogue', () => {
  const journey = DEMO_JOURNEYS[9]; assert(journey);
  const locations = journeyTrip(journey);
  assert(matchesJourney(locations, journey));
  assert.notEqual(locations[0], journey.locations[0]); assert.notEqual(locations[0]?.coords, journey.locations[0]?.coords);
  locations.reverse(); assert(!matchesJourney(locations, journey));
  assert.equal(journey.locations[0]?.id, 'cp');
  assert(!matchesJourney(locations.slice(0, 3), journey));
});

test('planner offers accessible Journey 1–10 above empty A/B searches and preserves a selected preset', () => {
  const previous = { ...state };
  try {
    state.bootstrap = { graph: { metadata: API_MAP_METADATA }, places: [], profiles: PROFILES, spots: [], revision: 1,
      demoMode: true, actorId: 'test', journeys: DEMO_JOURNEYS };
    state.view = 'planner'; state.locations = emptyTrip(); state.drafts = {}; state.selectedJourney = '';
    const html = planner();
    assert(html.indexOf('id="demo-journey"') < html.indexOf('id="stop-0"'));
    assert(html.includes('aria-describedby="journey-description"'));
    assert.equal((html.match(/value="journey-/g) ?? []).length, 10);
    assert(html.includes('Journey 10')); assert(html.includes('value="" placeholder="Search NCR'));
    state.selectedJourney = 'journey-8';
    assert(planner().includes('value="journey-8" selected'));
  } finally { Object.assign(state, previous); }
});
