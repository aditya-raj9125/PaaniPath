import { AppError, NCR_BOUNDS, withinBounds } from '@paanipath/domain';
import type { Coordinates, Place, PlaceSearchResponse } from '@paanipath/domain';
import { NCR_PLACES } from '@paanipath/data';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const normalize = (value: string): string => value.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
interface PhotonFeature { readonly properties?: Record<string, unknown>; readonly geometry?: { readonly coordinates?: unknown } }

export function parsePlaces(raw: unknown): Place[] {
  if (raw === null || typeof raw !== 'object' || !('features' in raw) || !Array.isArray(raw.features)) return [];
  const result: Place[] = [];
  for (const value of raw.features as PhotonFeature[]) {
    if (value === null || typeof value !== 'object') continue;
    const coords = value.geometry?.coordinates; const properties = value.properties;
    if (!Array.isArray(coords) || typeof coords[0] !== 'number' || typeof coords[1] !== 'number' || properties === null || typeof properties !== 'object') continue;
    const point: Coordinates = [coords[1], coords[0]];
    if (!point.every(Number.isFinite) || !withinBounds(point, NCR_BOUNDS)) continue;
    const parts = ['name', 'housenumber', 'street', 'suburb', 'city', 'district', 'state'].map(key => properties[key]).filter((part): part is string => typeof part === 'string' && part.length > 0);
    const name = [...new Set(parts)].join(', ').slice(0, 100);
    if (!name) continue;
    result.push({ id: `osm-${String(properties.osm_type ?? 'place')}-${String(properties.osm_id ?? `${point[0]}-${point[1]}`)}`.slice(0, 100), name, coords: point });
  }
  return result;
}

/** Explicit user searches only. Local suggestions remain available if the provider is offline. */
export class PlaceSearch {
  private readonly cache = new Map<string, { until: number; value: PlaceSearchResponse }>();
  private readonly inFlight = new Map<string, Promise<PlaceSearchResponse>>();
  private lastRemote = 0;
  constructor(private readonly endpoint = 'https://photon.komoot.io/api/', private readonly fetcher: Fetcher = fetch, private readonly clock: () => number = Date.now) {}

  local(query: string): Place[] {
    const terms = normalize(query).split(' ');
    return NCR_PLACES.filter(place => terms.every(term => normalize(place.name).includes(term))).slice(0, 8);
  }
  async search(query: string, online: boolean): Promise<PlaceSearchResponse> {
    const text = query.trim();
    if (text.length < 2 || text.length > 120) throw new AppError('INVALID_SEARCH', 'Enter a location name between 2 and 120 characters.');
    const key = normalize(text);
    const local = this.local(text);
    if (!online) return { places: local, source: 'local' };
    const cached = this.cache.get(key);
    if (cached !== undefined && cached.until > this.clock()) return cached.value;
    const pending = this.inFlight.get(key);
    if (pending !== undefined) return pending;
    // Process-wide public-provider safeguard. Production should configure a provisioned/self-hosted service.
    if (this.clock() - this.lastRemote < 1100) return { places: local, source: 'local', warning: 'Search is busy. Retry shortly for address results, or select a saved location.' };
    this.lastRemote = this.clock();
    const promise = this.remote(text, local);
    this.inFlight.set(key, promise);
    try { return await promise; } finally { this.inFlight.delete(key); }
  }
  private async remote(query: string, local: readonly Place[]): Promise<PlaceSearchResponse> {
    const url = new URL(this.endpoint);
    url.searchParams.set('q', query); url.searchParams.set('limit', '8'); url.searchParams.set('lang', 'en');
    url.searchParams.set('bbox', `${NCR_BOUNDS[1]},${NCR_BOUNDS[0]},${NCR_BOUNDS[3]},${NCR_BOUNDS[2]}`);
    let result: PlaceSearchResponse;
    try {
      const response = await this.fetcher(url.toString(), { signal: AbortSignal.timeout(7000), headers: { 'user-agent': 'PaaniPath/1.0 NCR place search', accept: 'application/json' } });
      if (!response.ok) throw new Error('Provider unavailable');
      const remote = parsePlaces(await response.json());
      const seen = new Set<string>();
      const places = [...remote, ...local].filter(place => {
        const key = `${normalize(place.name)}:${place.coords.map(value => value.toFixed(4)).join(',')}`;
        if (seen.has(key)) return false; seen.add(key); return true;
      }).slice(0, 10);
      result = { places, source: local.length > 0 && remote.length > 0 ? 'mixed' : remote.length > 0 ? 'photon' : 'local' };
    } catch { result = { places: local, source: 'local', warning: 'Address search is unavailable. Saved NCR locations and map selection still work.' }; }
    if (this.cache.size >= 200) { const oldest = this.cache.keys().next().value; if (oldest !== undefined) this.cache.delete(oldest); }
    this.cache.set(normalize(query), { until: this.clock() + (result.warning ? 5000 : 300_000), value: result });
    return result;
  }
}
