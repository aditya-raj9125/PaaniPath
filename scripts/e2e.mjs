/** HTTP end-to-end smoke check against a running local server. */
import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
const health = await fetch(`${base}/api/health`); assert.equal(health.status, 200);
const response = await fetch(`${base}/api/bootstrap`); assert.equal(response.status, 200);
const bootstrap = await response.json();
const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
const route = await fetch(`${base}/api/routes`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-paanipath': '1', cookie },
  body: JSON.stringify({ locations: [bootstrap.places[0], bootstrap.places[1]], profile: bootstrap.profiles[1], detourFactor: 2, optimizeOrder: true }) });
assert.equal(route.status, 200); const result = await route.json();
assert(result.routes.some(route => route.recommended)); assert(result.routes.some(route => route.fastest)); assert(result.warning.includes('standing water'));
for (const path of ['/', '/app.js', '/app.css', '/sw.js', '/manifest.webmanifest', '/modules/apps/web/src/app.js']) assert.equal((await fetch(base + path)).status, 200, path);
const manifest = await (await fetch(base + '/asset-manifest.json')).json();
for (const path of manifest) {
  const response = await fetch(base + path); assert.equal(response.status, 200, path);
  const code = await response.text(); assert(!code.includes("from '@paanipath/"), `Unresolved alias in ${path}`);
}
const malformed = await fetch(`${base}/api/routes`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-paanipath': '1' }, body: '{invalid' });
assert.equal(malformed.status, 400);
console.log(`HTTP E2E passed: shell, assets, session, routing, safety message, malformed input. Recommended=${result.routes[0].score.damaging} damaging; fastest=${result.routes.find(route => route.fastest).score.damaging}; search=${result.stats.durationMs}ms.`);
