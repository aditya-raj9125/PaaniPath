import { record, string } from './commands.ts';
import type { DeploymentOutputs } from './workflow.ts';

async function response(base: string, path: string, init?: RequestInit): Promise<Response> {
  const result = await fetch(base + path, { ...init, signal: AbortSignal.timeout(25_000), redirect: 'error' });
  if (!result.ok) throw new Error(`Deployment smoke check failed at ${path} (HTTP ${result.status}). Resources remain deployed; inspect AWS and retry.`);
  return result;
}

export async function smokeDeployment(outputs: DeploymentOutputs, route: boolean): Promise<void> {
  const base = outputs.website;
  const health = record(await (await response(base, '/api/health')).json());
  if (health.graphSource !== 'openrouteservice') throw new Error('Deployed health response does not identify hosted routing.');
  const bootstrapResponse = await response(base, '/api/bootstrap');
  const bootstrap = record(await bootstrapResponse.json());
  if (!Array.isArray(bootstrap.journeys) || bootstrap.journeys.length !== 10) throw new Error('Deployed API is missing the ten demo journeys.');
  for (const path of ['/', '/app.js', '/app.css', '/sw.js', '/asset-manifest.json', '/modules/packages/routing/src/spatial.js']) {
    const asset = await response(base, path);
    const type = asset.headers.get('content-type') ?? '';
    if ((path.endsWith('.js') && !/javascript/.test(type)) || (path.endsWith('.css') && !type.includes('text/css'))) throw new Error(`Unexpected deployed asset MIME type at ${path}.`);
  }
  if (!route) return;
  const journey = record(bootstrap.journeys[0]);
  const profiles = Array.isArray(bootstrap.profiles) ? bootstrap.profiles.map(record) : [];
  const profile = profiles.find(candidate => candidate.type === 'car');
  if (!profile) throw new Error('Deployed vehicle profiles are unavailable.');
  const cookie = bootstrapResponse.headers.get('set-cookie')?.split(';')[0] ?? '';
  const routes = record(await (await response(base, '/api/routes', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paanipath': '1', cookie },
    body: JSON.stringify({ locations: journey.locations, profile, detourFactor: 2, optimizeOrder: false }) })).json());
  const candidates = Array.isArray(routes.routes) ? routes.routes.map(record) : [];
  if (!candidates.some(candidate => candidate.recommended) || !candidates.some(candidate => candidate.fastest) ||
      !string(routes.warning, 'warning').includes('standing water')) throw new Error('Deployed routing did not return a valid comparison.');
}
