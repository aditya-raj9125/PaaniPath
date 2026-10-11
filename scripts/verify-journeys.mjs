/** Explicit live acceptance check; not part of CI. Build first. Never prints API credentials. */
import { DEMO_JOURNEYS, seedApiSpots } from '../dist/modules/packages/data/src/index.js';
import { PROFILES } from '../dist/modules/packages/domain/src/index.js';
import { ApiRouting } from '../dist/modules/apps/api/src/api-routing.js';

const key = process.env.ORS_API_KEY;
if (!key?.trim()) throw new Error('Set ORS_API_KEY before verifying live demo journeys.');
const patient = process.argv.includes('--patient');
const ids = process.argv.slice(2).filter(argument => argument !== '--patient');
if (ids.some(id => !DEMO_JOURNEYS.some(journey => journey.id === id))) throw new Error('Unknown journey ID. Use journey-1 through journey-10.');
// Normally use the exact application timeout. Optional patient mode diagnoses upstream latency.
const calls = [];
const routing = new ApiRouting(key, undefined, (url, init) => {
  const body = JSON.parse(String(init.body));
  calls.push(body.options?.avoid_polygons?.coordinates.length ?? 0);
  return fetch(url, patient ? { ...init, signal: AbortSignal.timeout(30_000) } : init);
});
const profile = PROFILES.find(candidate => candidate.type === 'car');
if (!profile) throw new Error('Car profile is missing.');
const now = Date.now();
const spots = seedApiSpots(now);
for (const journey of DEMO_JOURNEYS) {
  if (ids.length > 0 && !ids.includes(journey.id)) continue;
  const start = calls.length;
  const result = await routing.plan({ locations: journey.locations, profile, detourFactor: 2, optimizeOrder: false }, spots, now, 1);
  const baseline = result.routes.find(route => route.fastest);
  const selected = result.routes.find(route => route.recommended);
  if (!baseline || !selected || baseline.spotIds.length === 0) throw new Error(`${journey.id}: no seeded exposure on the live baseline.`);
  const hits = new Set(baseline.spotIds);
  console.log(JSON.stringify({ journey: journey.id, stops: journey.locations.length, baselineCases: hits.size,
    hotspots: new Set(spots.filter(spot => hits.has(spot.id)).map(spot => spot.hotspot?.id)).size,
    baselineDamaging: baseline.score.damaging, recommendedDamaging: selected.score.damaging,
    candidates: result.routes.length, kilometres: Math.round(baseline.distanceMetres / 100) / 10,
    durationMs: result.stats.durationMs, avoidPolygons: Math.max(0, ...calls.slice(start)),
    avoidanceUnavailable: result.warning.includes('A flood-avoiding route was unavailable') }));
}
