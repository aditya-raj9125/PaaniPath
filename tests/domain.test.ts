import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySpot, PROFILES, publicSpot, reportInput, routeInput, voteInput } from '@paanipath/domain';
import { NCR_PLACES } from '@paanipath/data';
import { NOW, spot } from './helpers.ts';

test('confidence starts at 50 percent and stays calibrated after independent votes', () => {
  const profile = PROFILES[0]; if (profile === undefined) throw new Error('Missing fixture.');
  assert.equal(publicSpot(spot('a:b'), profile, NOW).confidence, 50);
  assert.equal(publicSpot(spot('a:b', 3, { confirms: 3, dismisses: 1 }), profile, NOW).confidence, 67);
});
test('public data omits reporter identity and voter identities', () => {
  const profile = PROFILES[0]; if (profile === undefined) throw new Error('Missing fixture.');
  const visible = publicSpot(spot('a:b'), profile, NOW);
  assert.equal('reporterId' in visible, false); assert.equal('votes' in visible, false);
});
test('profiles classify the same depth differently', () => {
  const scooter = PROFILES[0]; const car = PROFILES[2];
  if (scooter === undefined || car === undefined) throw new Error('Missing fixture.');
  assert.equal(classifySpot(spot('a:b', 3), scooter, NOW), 'damaging'); assert.equal(classifySpot(spot('a:b', 3), car, NOW), 'marginal');
});
test('route validation rejects reversed limits, unknown vehicles, invalid numbers and stop counts', () => {
  const valid = { locations: NCR_PLACES.slice(0, 2), profile: PROFILES[1], detourFactor: 2, optimizeOrder: true };
  assert.throws(() => routeInput({ ...valid, profile: { ...valid.profile, marginal: 4, damaging: 2 } }), /Marginal/);
  assert.throws(() => routeInput({ ...valid, profile: { type: 'submarine' } }), /vehicle/);
  assert.throws(() => routeInput({ ...valid, detourFactor: NaN }), /Detour/);
  assert.throws(() => routeInput({ ...valid, locations: [] }), /origin/);
  assert.throws(() => routeInput({ ...valid, locations: [{ coords: [Infinity, 77] }, valid.locations[1]] }), /finite/);
  assert.throws(() => routeInput({ ...valid, optimizeOrder: 'yes' }), /boolean/);
});
test('report validation rejects fractional depth and out-of-range coordinates', () => {
  assert.throws(() => reportInput({ coords: [28, 77], depth: 2.5 }), /whole level/);
  assert.throws(() => reportInput({ coords: [91, 77], depth: 2 }), /range/);
  assert.throws(() => reportInput({ coords: [28, 77], depth: 2, photo: 'data:image/svg+xml;base64,xxxx' }), /JPEG/);
});
test('votes validate actions and demo type', () => {
  assert.throws(() => voteInput({ action: 'like' }), /flooded or cleared/);
  assert.throws(() => voteInput({ action: 'confirm', demo: 'true' }), /boolean/);
});
