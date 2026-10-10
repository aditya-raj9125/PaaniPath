import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRouting } from '../apps/api/src/api-routing.ts';
import { NCR_PLACES } from '@paanipath/data';
import { PROFILES } from '@paanipath/domain';
import type { RouteRequest } from '@paanipath/domain';
import { NOW, spot } from './helpers.ts';

function request(count = 2): RouteRequest {
  const profile = PROFILES[1]; assert(profile);
  return { locations: NCR_PLACES.slice(0, count), profile, optimizeOrder: true, detourFactor: 2 };
}
function response(coords: unknown = [[77.21, 28.62], [77.23, 28.62]], duration = 100): Response {
  return Response.json({ features: [{ geometry: { type: 'LineString', coordinates: coords }, properties: { summary: { distance: 1000, duration } } }] });
}
test('missing API key fails explicitly without making a request or substituting a route', async () => {
  const api = new ApiRouting('', undefined, async () => { throw new Error('Must not connect'); });
  await assert.rejects(api.plan(request(), [], NOW, 1), /ORS_API_KEY/);
});
test('2, 3 and 4 stops use real provider contracts and evaluate both intermediate orders', async () => {
  for (const count of [2, 3, 4]) {
    const bodies: Record<string, unknown>[] = [];
    const api = new ApiRouting('secret', 'https://example.test/directions', async (url, init) => {
      assert(url.endsWith('/driving-car/geojson')); assert.equal(new Headers(init.headers).get('Authorization'), 'secret');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>; bodies.push(body);
      return response(body.coordinates);
    });
    const result = await api.plan(request(count), [], NOW, 1);
    assert.equal(bodies.length, count === 4 ? 2 : 1); assert.equal(result.stats.ordersEvaluated, bodies.length);
    assert.deepEqual((bodies[0]?.coordinates as number[][])[0], [77.2167, 28.6315]);
    assert.deepEqual(result.routes[0]?.geometry[0], [28.6315, 77.2167]);
    assert(result.routes.some(route => route.fastest)); assert.equal(result.stats.optimal, false);
    assert.equal(result.graphSource, 'openrouteservice'); assert(result.warning.includes('not live traffic'));
  }
});
test('flood buffers request an avoiding route and rank it ahead of an exposed baseline', async () => {
  const bodies: Record<string, unknown>[] = [];
  const api = new ApiRouting('secret', undefined, async (_url, init) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>; bodies.push(body);
    return bodies.length === 1 ? response() : response([[77.21, 28.63], [77.23, 28.63]], 150);
  });
  const result = await api.plan(request(), [spot('point')], NOW, 1);
  assert.equal(result.routes[0]?.score.damaging, 0); assert.equal(result.routes[0]?.score.seconds, 150);
  assert.equal(result.routes.find(route => route.fastest)?.score.damaging, 1);
  const polygons = (bodies[1]?.options as Record<string, unknown>).avoid_polygons as Record<string, unknown>;
  assert.equal(polygons.type, 'MultiPolygon'); assert.equal((polygons.coordinates as unknown[]).length, 1);
});
test('detour budget rejects a safer candidate outside the allowance', async () => {
  let calls = 0;
  const api = new ApiRouting('secret', undefined, async () => ++calls === 1 ? response() : response([[77.21, 28.63], [77.23, 28.63]], 300));
  const result = await api.plan(request(), [spot('point')], NOW, 1);
  assert.equal(result.routes.length, 1); assert.equal(result.routes[0]?.score.damaging, 1);
  assert(result.routes.every(route => route.withinDetour));
});
test('cleared and archived reports are excluded; stale observations remain caution', async () => {
  let calls = 0;
  const api = new ApiRouting('secret', undefined, async () => { calls++; return response(); });
  const result = await api.plan(request(), [spot('cleared', 4, { cleared: true }), spot('archived', 4, { archived: true }),
    spot('stale', 4, { lastConfirmedAt: NOW - 3_600_000 })], NOW, 1);
  assert.equal(calls, 2); assert.equal(result.spots.length, 1); assert.equal(result.routes[0]?.score.marginal, 1);
  assert.equal(result.routes[0]?.score.damaging, 0);
});
test('a provider no-route avoidance result visibly retains the baseline, never a fabricated detour', async () => {
  let calls = 0;
  const api = new ApiRouting('secret', undefined, async () => ++calls === 1 ? response() : Response.json({ error: { code: 2009 } }, { status: 400 }));
  const result = await api.plan(request(), [spot('point')], NOW, 1);
  assert.equal(result.routes.length, 1); assert(result.warning.includes('baseline routes remain visible'));
});
test('credentials, quota, provider errors, network failure and corrupt data produce actionable errors', async () => {
  for (const [status, message] of [[401, /credentials/], [403, /credentials/], [429, /quota/], [500, /provider/i]] as const) {
    const api = new ApiRouting('secret', undefined, async () => new Response('', { status }));
    await assert.rejects(api.plan(request(), [], NOW, 1), message);
  }
  await assert.rejects(new ApiRouting('secret', undefined, async () => { throw new Error('private diagnostic'); }).plan(request(), [], NOW, 1), /timed out/);
  await assert.rejects(new ApiRouting('secret', undefined, async () => response([[999, 28], [77, 28]])).plan(request(), [], NOW, 1), /Invalid provider coordinate/);
  await assert.rejects(new ApiRouting('secret', undefined, async () => response(undefined, -1)).plan(request(), [], NOW, 1), /travel estimates/);
  await assert.rejects(new ApiRouting('secret', undefined, async () => new Response('bad json')).plan(request(), [], NOW, 1), /unreadable/);
  await assert.rejects(new ApiRouting('secret', undefined, async () => new Response('', { status: 404 })).plan(request(), [], NOW, 1), /provider/i);
  await assert.rejects(new ApiRouting('secret', undefined, async () => Response.json({ error: { code: 2004 } }, { status: 400 })).plan(request(), [], NOW, 1), /150 km/);
});
test('short-lived cache avoids duplicate upstream calls but respects report revision and freshness', async () => {
  let calls = 0;
  const api = new ApiRouting('secret', undefined, async () => { calls++; return response(); });
  const input = request();
  await api.plan(input, [], NOW, 1); await api.plan(input, [], NOW, 1); assert.equal(calls, 1);
  await api.plan(input, [], NOW, 2); assert.equal(calls, 2);
  const reports = [spot('point')];
  await api.plan(input, reports, NOW, 3); await api.plan(input, reports, NOW + 3_600_000, 3); assert.equal(calls, 6);
});
test('bus uses the provider bus profile and duplicate stops are rejected', async () => {
  const input = request(); const bus = PROFILES.find(profile => profile.type === 'bus'); assert(bus);
  const api = new ApiRouting('secret', undefined, async (url, init) => {
    assert(url.endsWith('/driving-hgv/geojson'));
    assert.equal(JSON.parse(String(init.body)).options.vehicle_type, 'bus'); return response();
  });
  await api.plan({ ...input, profile: bus }, [], NOW, 1);
  const place = input.locations[0]; assert(place);
  await assert.rejects(api.plan({ ...input, locations: [place, place] }, [], NOW, 1), /distinct stops/);
});
test('concurrency is bounded and capacity is released after failures', async () => {
  const releases: (() => void)[] = [];
  const api = new ApiRouting('secret', undefined, async () => {
    await new Promise<void>(resolve => releases.push(resolve)); return response();
  });
  const a = api.plan(request(), [], NOW, 1); const b = api.plan(request(), [], NOW, 2);
  await assert.rejects(api.plan(request(), [], NOW, 3), /busy/);
  releases.forEach(release => release()); await Promise.all([a, b]);
  assert((await api.plan(request(), [], NOW, 1)).routes.length > 0);
});
