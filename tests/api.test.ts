import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../apps/api/src/application.ts';
import { PaaniPathService } from '../apps/api/src/service.ts';
import { ApiRouting } from '../apps/api/src/api-routing.ts';
import { seedApiSpots } from '@paanipath/data';
import { MemoryStore, NOW } from './helpers.ts';

function fixture(demoMode = true): { service: PaaniPathService; app: Application; store: MemoryStore } {
  const store = new MemoryStore();
  const service = new PaaniPathService(store, { demoMode, graphVersion: 'test', clock: () => NOW, routing: new ApiRouting('') });
  return { store, service, app: new Application(service, 'test-secret-with-more-than-thirty-two-characters') };
}
test('bootstrap seeds honestly labelled simulated location reports', async () => {
  const { service } = fixture(); const bootstrap = await service.bootstrap('actor');
  assert.equal(bootstrap.spots.length, seedApiSpots(NOW).length); assert.equal(bootstrap.graph.metadata.source, 'openrouteservice');
  assert(bootstrap.spots.every(spot => spot.sourceLabel === 'Simulated seed'));
});
test('report polling returns current public observations without retransmitting the road graph', async () => {
  const { app, service } = fixture(false);
  await service.report({ name: 'Observed road', coords: [28.613, 77.202], depth: 2 }, 'alice');
  const response = await app.handle({ method: 'GET', path: '/api/reports', headers: {}, body: '' });
  assert.equal(response.status, 200);
  const body = JSON.parse(String(response.body)) as { revision: number; spots: unknown[]; graph?: unknown };
  assert.equal(body.revision, 2); assert.equal(body.spots.length, 1); assert.equal(body.graph, undefined);
  assert(!String(response.body).includes('reporterId'));
});

test('live-mode service starts empty and disables simulation', async () => {
  const { service } = fixture(false); assert.equal((await service.bootstrap('actor')).spots.length, 0);
  await assert.rejects(service.simulate({ action: 'reset' }, 'actor'), /disabled/);
});
test('reports persist, nearby duplicates merge conservatively, and owners cannot self-confirm', async () => {
  const { service } = fixture(false);
  const first = await service.report({ name: 'Test corner', coords: [28.613, 77.202], depth: 2 }, 'alice');
  const second = await service.report({ name: 'Same corner', coords: [28.613, 77.2021], depth: 3 }, 'bob');
  assert.equal(second.merged, true); assert.equal(second.spot.id, first.spot.id); assert.equal(second.spot.depth, 3);
  assert.equal((await service.snapshot()).spots.length, 1);
  await assert.rejects(service.vote(first.spot.id, { action: 'confirm', coords: first.spot.coords }, 'alice'), /Another road user/);
});
test('duplicate confirmations cannot refresh freshness or inflate confidence', async () => {
  const { service } = fixture(); const bootstrap = await service.bootstrap('actor'); const id = bootstrap.spots[0]?.id ?? '';
  await service.vote(id, { action: 'confirm', demo: true }, 'bob');
  await assert.rejects(service.vote(id, { action: 'confirm', demo: true }, 'bob'), /already voted/);
});
test('nearby checks apply to community spots even when demo bypass is requested', async () => {
  const { service } = fixture(false); const first = await service.report({ coords: [28.613, 77.202], depth: 3 }, 'alice');
  await assert.rejects(service.vote(first.spot.id, { action: 'confirm', demo: true, coords: [29, 78] }, 'bob'), /within 500 m/);
});
test('clearing requires independent dismissals and leaves last-confirmed time unchanged', async () => {
  const { service } = fixture(false); const first = await service.report({ coords: [28.613, 77.202], depth: 3 }, 'alice');
  await service.vote(first.spot.id, { action: 'dismiss', coords: first.spot.coords }, 'bob');
  assert.equal((await service.snapshot()).spots[0]?.cleared, false);
  await service.vote(first.spot.id, { action: 'dismiss', coords: first.spot.coords }, 'charlie');
  assert.equal((await service.snapshot()).spots[0]?.cleared, true);
  assert.equal((await service.snapshot()).spots[0]?.lastConfirmedAt, NOW);
});
test('per-session reporting rate limit is enforced', async () => {
  const { service } = fixture(false);
  for (let i = 0; i < 5; i++) await service.report({ coords: [28.613 + i * .004, 77.202], depth: 2 }, 'alice');
  await assert.rejects(service.report({ coords: [28.637, 77.202], depth: 2 }, 'alice'), /Too many/);
});
test('concurrent writes retry optimistic conflicts without losing a report', async () => {
  const { service } = fixture(false);
  await Promise.all([service.report({ coords: [28.613, 77.202], depth: 2 }, 'alice'), service.report({ coords: [28.617, 77.202], depth: 3 }, 'bob')]);
  assert.equal((await service.snapshot()).spots.length, 2);
});
test('demo reset preserves community reports', async () => {
  const { service } = fixture(); await service.report({ coords: [28.613, 77.252], depth: 2 }, 'alice');
  await service.simulate({ action: 'reset' }, 'bob'); assert.equal((await service.snapshot()).spots.length, seedApiSpots(NOW).length + 1);
});
test('API responds with structured errors for malformed JSON, wrong content type, and CSRF header', async () => {
  const { app } = fixture();
  const base = { method: 'POST', path: '/api/routes', headers: { 'content-type': 'application/json', 'x-paanipath': '1' }, body: '{bad' };
  assert.equal((await app.handle(base)).status, 400);
  assert.equal((await app.handle({ ...base, body: '{}', headers: {} })).status, 403);
  assert.equal((await app.handle({ ...base, headers: { 'x-paanipath': '1' } })).status, 415);
});
test('session cookie is opaque, HTTP-only, and survives verified reuse', async () => {
  const { app } = fixture();
  const first = await app.handle({ method: 'GET', path: '/api/bootstrap', headers: {}, body: '' });
  const cookie = first.headers['set-cookie']; assert(cookie?.includes('HttpOnly')); assert(cookie?.includes('SameSite=Strict'));
  const second = await app.handle({ method: 'GET', path: '/api/bootstrap', headers: { cookie: cookie?.split(';')[0] ?? '' }, body: '' });
  assert.equal(second.headers['set-cookie'], undefined);
});
test('disguised executable photos fail signature validation', async () => {
  const { service } = fixture(false);
  await assert.rejects(service.report({ coords: [28.613, 77.202], depth: 2, photo: 'data:image/png;base64,SGVsbG93b3JsZDEyMzQ1Ng==' }, 'alice'), /not a valid/);
});
test('API does not expose voter or reporter IDs in a public report', async () => {
  const { app } = fixture(); const response = await app.handle({ method: 'GET', path: '/api/bootstrap', headers: {}, body: '' });
  assert.equal(String(response.body).includes('reporterId'), false); assert.equal(String(response.body).includes('votes'), false);
});

test('existing observations remain readable regardless of their former offline graph version', async () => {
  const { service, store } = fixture(false);
  await service.report({ coords: [28.613, 77.202], depth: 2 }, 'alice');
  assert(store.state);
  store.state = { ...store.state, graphVersion: 'former-downloaded-road-snapshot' };
  assert.equal((await service.reports()).spots.length, 1);
});

test('community reports are not merged into simulated location seeds', async () => {
  const { service } = fixture(); const bootstrap = await service.bootstrap('actor');
  const seed = bootstrap.spots[0]; assert(seed);
  const result = await service.report({ coords: seed.coords, depth: 3 }, 'alice');
  assert.equal(result.merged, false); assert.equal(result.spot.source, 'community');
});
