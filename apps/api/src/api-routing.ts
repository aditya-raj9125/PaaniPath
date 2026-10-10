import { AppError, assert, publicSpot, SAFETY_WARNING } from '@paanipath/domain';
import type { Coordinates, PublicSpot, RouteOption, RouteRequest, RouteResponse, Spot } from '@paanipath/domain';
import { distanceMetres, distanceToSegment } from '@paanipath/routing';

export interface RoutingExecutor {
  plan(request: RouteRequest, spots: readonly Spot[], now: number, revision: number): Promise<RouteResponse>;
}
type Transport = (url: string, init: RequestInit) => Promise<Response>;
type Json = Record<string, unknown>;
function record(value: unknown): Json {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'PROVIDER_RESPONSE', 'Routing provider returned an invalid response.', 502);
  return value as Json;
}
function positive(value: unknown): number {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= 0, 'PROVIDER_RESPONSE', 'Routing provider returned invalid travel estimates.', 502);
  return value;
}
function parseRoute(raw: unknown, order: readonly number[]): RouteOption {
  const body = record(raw);
  assert(Array.isArray(body.features) && body.features.length > 0, 'NO_ROUTE', 'The provider found no route connecting these stops.', 422);
  const feature = record(body.features[0]); const geometry = record(feature.geometry);
  assert(geometry.type === 'LineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2 && geometry.coordinates.length <= 200_000,
    'PROVIDER_RESPONSE', 'Routing provider returned invalid road geometry.', 502);
  const points: Coordinates[] = geometry.coordinates.map((point: unknown) => {
    assert(Array.isArray(point) && point.length >= 2, 'PROVIDER_RESPONSE', 'Invalid provider coordinate.', 502);
    const [lng, lat] = point;
    assert(typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180,
      'PROVIDER_RESPONSE', 'Invalid provider coordinate.', 502);
    return [lat, lng];
  });
  const summary = record(record(feature.properties).summary);
  return { id: '', geometry: points, order, edgeIds: [], spotIds: [], distanceMetres: positive(summary.distance),
    score: { damaging: 0, marginal: 0, worstDepth: 0, seconds: positive(summary.duration) },
    recommended: false, fastest: false, extraSeconds: 0, withinDetour: true };
}
function exposed(route: RouteOption, spots: readonly PublicSpot[]): RouteOption {
  const hits = spots.filter(spot => route.geometry.some((point, i) => {
    const next = route.geometry[i + 1];
    return next !== undefined && distanceToSegment(spot.coords, point, next) <= 85;
  }));
  return { ...route, spotIds: hits.map(spot => spot.id), score: { ...route.score,
    damaging: hits.filter(spot => spot.verdict === 'damaging').length,
    marginal: hits.filter(spot => spot.verdict === 'marginal' || spot.verdict === 'stale').length,
    worstDepth: Math.max(0, ...hits.map(spot => spot.depth)) } };
}
function compare(a: RouteOption, b: RouteOption): number {
  return a.score.damaging - b.score.damaging || a.score.marginal - b.score.marginal || a.score.worstDepth - b.score.worstDepth || a.score.seconds - b.score.seconds;
}
/** Approximate 60 m half-width buffers. They are not surveyed flood boundaries. */
export function avoidancePolygons(spots: readonly PublicSpot[]): Json {
  return { type: 'MultiPolygon', coordinates: spots.map(spot => {
    const [lat, lng] = spot.coords; const dy = 60 / 111_320; const dx = dy / Math.max(.01, Math.cos(lat * Math.PI / 180));
    return [[[lng - dx, lat - dy], [lng + dx, lat - dy], [lng + dx, lat + dy], [lng - dx, lat + dy], [lng - dx, lat - dy]]];
  }) };
}

/** Hosted road routing only: bounded requests, short-lived cache, no graph or mock fallback. */
export class ApiRouting implements RoutingExecutor {
  private active = 0;
  private calls: number[] = [];
  private readonly cache = new Map<string, { until: number; value: RouteResponse }>();
  constructor(private readonly key: string, private readonly endpoint = 'https://api.openrouteservice.org/v2/directions',
    private readonly transport: Transport = fetch) {}

  private async directions(request: RouteRequest, order: readonly number[], avoid: readonly PublicSpot[]): Promise<RouteOption> {
    const now = Date.now();
    this.calls = this.calls.filter(stamp => stamp > now - 60_000);
    assert(this.calls.length < 30, 'ROUTING_QUOTA', 'Application routing request budget reached. Wait one minute before retrying.', 429);
    this.calls.push(now);
    const options = avoid.length > 0 ? { avoid_polygons: avoidancePolygons(avoid) } : {};
    // ORS has no motorbike/auto profile. Driving-car is an explicitly disclosed approximation.
    const profile = request.profile.type === 'bus' ? 'driving-hgv' : 'driving-car';
    const vehicle = request.profile.type === 'bus' ? { vehicle_type: 'bus' } : {};
    let response: Response;
    try {
      response = await this.transport(`${this.endpoint.replace(/\/$/, '')}/${profile}/geojson`, {
        method: 'POST', headers: { Authorization: this.key.trim(), 'content-type': 'application/json' },
        signal: AbortSignal.timeout(8000), body: JSON.stringify({
          coordinates: order.map(index => { const place = request.locations[index]; assert(place, 'INVALID_STOPS', 'A stop is missing.'); return [place.coords[1], place.coords[0]]; }),
          instructions: false, preference: 'fastest', options: { ...options, ...vehicle } }) });
    } catch { throw new AppError('ROUTING_UNAVAILABLE', 'Routing API timed out or could not be reached. Check connectivity and retry.', 503); }
    if (response.status === 401 || response.status === 403) throw new AppError('ROUTING_CREDENTIALS', 'Routing API credentials were rejected. Check the server ORS_API_KEY.', 503);
    if (response.status === 429) throw new AppError('ROUTING_QUOTA', 'Routing provider quota reached. Wait before retrying or upgrade the provider plan.', 429);
    if (!response.ok) {
      // Only a documented no-route result is eligible for a visible avoidance fallback.
      let code: unknown;
      try { code = record(record(await response.json()).error).code; } catch { /* Do not expose provider payloads or credentials. */ }
      if (code === 2009 || code === 2010) throw new AppError('NO_ROUTE', 'No route connects these stops with these avoidance areas.', 422);
      if (code === 2004) throw new AppError('ROUTING_PROVIDER_LIMIT', 'This trip exceeds the provider plan limits. Public OpenRouteService limits routes with avoidance areas to 150 km. Use a suitable provider plan or a shorter trip.', 422);
      throw new AppError('ROUTING_PROVIDER', 'Routing provider rejected the request or is unavailable. Check provider limits and retry.', 502);
    }
    let raw: unknown;
    try { raw = await response.json(); } catch { throw new AppError('PROVIDER_RESPONSE', 'Routing provider returned unreadable data.', 502); }
    return parseRoute(raw, order);
  }

  async plan(request: RouteRequest, raw: readonly Spot[], now: number, revision: number): Promise<RouteResponse> {
    assert(this.key.trim().length > 0, 'ROUTING_KEY_REQUIRED', 'Set ORS_API_KEY in the server .env to enable real API routing. No road downloads are required.', 503);
    for (let i = 0; i < request.locations.length; i++) for (let j = i + 1; j < request.locations.length; j++) {
      const a = request.locations[i]; const b = request.locations[j];
      assert(a && b && distanceMetres(a.coords, b.coords) > 10, 'DUPLICATE_STOPS', 'Choose distinct stops at least 10 m apart.');
    }
    const spots = raw.filter(spot => !spot.cleared && !spot.archived).map(spot => publicSpot(spot, request.profile, now));
    const key = JSON.stringify([request, revision, spots.map(spot => [spot.id, spot.verdict, spot.depth])]);
    const cached = this.cache.get(key);
    if (cached !== undefined && cached.until > Date.now()) return cached.value;
    assert(this.active < 2, 'ROUTING_BUSY', 'Routing is busy. Retry shortly.', 503);
    this.active++;
    try {
      const value = await this.calculate(request, spots, revision);
      if (this.cache.size >= 64) { const first = this.cache.keys().next().value; if (first !== undefined) this.cache.delete(first); }
      this.cache.set(key, { until: Date.now() + 30_000, value });
      return value;
    } finally { this.active--; }
  }

  private async calculate(request: RouteRequest, spots: readonly PublicSpot[], revision: number): Promise<RouteResponse> {
    const started = performance.now(); const orders = [request.locations.map((_place, i) => i)];
    if (request.optimizeOrder && request.locations.length === 4) orders.push([0, 2, 1, 3]);
    const baselines = await Promise.all(orders.map(order => this.directions(request, order, [])));
    const fastest = baselines.reduce((a, b) => a.score.seconds <= b.score.seconds ? a : b);
    const avoid = spots.filter(spot => spot.verdict === 'damaging' || spot.verdict === 'marginal' || spot.verdict === 'stale');
    let unavailable = false;
    const detours = avoid.length === 0 ? [] : await Promise.all(orders.map(async order => {
      try { return await this.directions(request, order, avoid); }
      catch (error) { if (error instanceof AppError && error.code === 'NO_ROUTE') { unavailable = true; return undefined; } throw error; }
    }));
    const budget = fastest.score.seconds * request.detourFactor;
    const candidates = [...baselines, ...detours.filter((route): route is RouteOption => route !== undefined)]
      .filter(route => route.score.seconds <= budget + .001).map(route => exposed(route, spots)).sort(compare);
    const unique = candidates.filter((route, i) => candidates.findIndex(other => JSON.stringify(other.geometry) === JSON.stringify(route.geometry)) === i);
    const selected = unique.slice(0, 2);
    if (!selected.some(route => route === fastest || JSON.stringify(route.geometry) === JSON.stringify(fastest.geometry))) selected.push(exposed(fastest, spots));
    const routes = selected.map((route, i) => ({ ...route, id: `route-${i}`, recommended: i === 0,
      fastest: route.score.seconds === fastest.score.seconds && JSON.stringify(route.geometry) === JSON.stringify(fastest.geometry),
      extraSeconds: Math.max(0, route.score.seconds - fastest.score.seconds), withinDetour: route.score.seconds <= budget + .001 }));
    return { routes, spots, revision, graphSource: 'openrouteservice',
      stats: { expanded: 0, pruned: 0, labels: candidates.length, durationMs: Math.round(performance.now() - started), optimal: false,
        bounded: true, ordersEvaluated: orders.length, algorithm: 'OpenRouteService directions + flood buffers + candidate exposure ranking' },
      reason: `Best returned candidate within ${request.detourFactor}× the provider baseline; not a globally optimal or guaranteed-safe route.`,
      warning: `${SAFETY_WARNING} Flood buffers and proximity scoring are approximate. ${unavailable ? 'A flood-avoiding route was unavailable; baseline routes remain visible. ' : ''}` +
        'Car road-access rules approximate scooter, motorbike and auto routing; bus uses the HGV bus profile. Stops and avoidance areas are sent to OpenRouteService. Travel times are estimates, not live traffic.' };
  }
}
