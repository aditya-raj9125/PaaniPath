/** Isolated HTTP integration checks. Provider responses are explicitly mocked; no user's DB is touched. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'paanipath-http-test-'));
assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
Object.assign(process.env, { HOST: '127.0.0.1', PORT: '0', STORE: 'sqlite', DEMO_MODE: 'true', SEED_MODE: 'true',
  DATA_DIR: directory, ORS_API_KEY: 'http-test-key', ORS_URL: 'https://mock-ors.test/directions' });
const realFetch = globalThis.fetch;
let providerStatus = 200; let providerCalls = 0;
globalThis.fetch = async (input, init) => {
  if (String(input).startsWith('https://mock-ors.test/')) {
    providerCalls++;
    if (providerStatus !== 200) return new Response('', { status: providerStatus });
    const body = JSON.parse(String(init.body));
    return Response.json({ features: [{ geometry: { type: 'LineString', coordinates: body.coordinates },
      properties: { summary: { distance: 2000, duration: 180 } } }] });
  }
  return realFetch(input, init);
};
let server; let application;
try {
  ({ server, application } = await import('../dist/modules/apps/api/src/server.js'));
  if (!server.listening) await once(server, 'listening');
  const address = server.address(); assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${base}/api/bootstrap`);
  assert.equal(response.status, 200); const bootstrap = await response.json();
  assert.equal(bootstrap.demoMode, true); assert.equal(bootstrap.seededMode, true);
  assert.equal(bootstrap.graph.nodes, undefined); assert.equal(bootstrap.coverage.nodes, 0); assert.equal(bootstrap.graph.metadata.source, 'openrouteservice');
  assert(bootstrap.spots.length > 100);
  const headers = { 'content-type': 'application/json', 'x-paanipath': '1' };
  for (const query of ['Noida', 'Greater Noida', 'Gurgaon', 'Ghaziabad']) {
    const response = await fetch(`${base}/api/places/search`, { method: 'POST', headers, body: JSON.stringify({ query, online: false }) });
    assert.equal(response.status, 200); assert((await response.json()).places.length > 0);
  }
  for (const count of [2, 3, 4]) {
    const response = await fetch(`${base}/api/routes`, { method: 'POST', headers,
      body: JSON.stringify({ locations: bootstrap.places.slice(0, count), profile: bootstrap.profiles[1], detourFactor: 2, optimizeOrder: true }) });
    assert.equal(response.status, 200); const result = await response.json();
    assert(result.routes.some(route => route.fastest)); assert(result.routes.some(route => route.recommended));
    assert.equal(result.stats.ordersEvaluated, count === 4 ? 2 : 1);
  }
  assert(providerCalls > 0);
  providerStatus = 429;
  const quota = await fetch(`${base}/api/routes`, { method: 'POST', headers,
    body: JSON.stringify({ locations: bootstrap.places.slice(1, 3), profile: bootstrap.profiles[1], detourFactor: 1.7 }) });
  assert.equal(quota.status, 429); assert.equal((await quota.json()).error.code, 'ROUTING_QUOTA');
  assert(!JSON.stringify(bootstrap).includes('http-test-key'));
  const malformed = await fetch(`${base}/api/places/search`, { method: 'POST', headers, body: JSON.stringify({ query: '' }) });
  assert.equal(malformed.status, 400);
  const page = await fetch(base); assert.equal(page.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  console.log('HTTP integration passed: lightweight bootstrap, 100+ labelled fixture seeds, NCR search, 2/3/4 stops, API provider dispatch, validation and tile referrers. Mocked provider only; not live-NCR acceptance.');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (application) application.service.store.close();
  globalThis.fetch = realFetch;
  await rm(directory, { recursive: true, force: true });
}
