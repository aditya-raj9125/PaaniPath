import { randomUUID } from 'node:crypto';
import { AppError, assert, PROFILES, publicSpot, reportInput, routeInput, voteInput } from '@paanipath/domain';
import type { BootstrapResponse, ReportsResponse, RouteResponse, Spot } from '@paanipath/domain';
import { seedApiSpots, reconcileSeedSpots, SEED_VERSION, NCR_PLACES } from '@paanipath/data';
import type { Snapshot, Store, Photo } from '@paanipath/data';
import { distanceMetres } from '@paanipath/routing';
import type { RoutingExecutor } from './api-routing.ts';

export const API_MAP_METADATA = {
  source: 'openrouteservice' as const, attribution: '© OpenStreetMap contributors; routing by openrouteservice',
  fetchedAt: 'Provider-managed', bbox: [26.5, 75.5, 30.25, 78.75] as const,
  limitations: 'Online API routing. NCR is a search viewport, not a downloaded road graph. Report buffers are approximate; no safety or global optimality guarantee.',
};

export interface ServiceOptions { readonly demoMode: boolean; readonly graphVersion: string; readonly clock?: () => number; readonly seededMode?: boolean; readonly routing: RoutingExecutor }

export class PaaniPathService {
  private readonly clock: () => number;
  constructor(readonly store: Store, readonly options: ServiceOptions) {
    this.clock = options.clock ?? Date.now;
  }
  private visibleSpots(snapshot: Snapshot): readonly Spot[] {
    return this.options.demoMode || this.options.seededMode ? snapshot.spots : snapshot.spots.filter(spot => spot.source === 'community');
  }

  async snapshot(): Promise<Snapshot> {
    const seeded = this.options.seededMode || this.options.demoMode;
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await this.store.read();
      if (existing !== undefined) {
        if (!seeded || existing.seedVersion === SEED_VERSION) return existing;
        const upgraded: Snapshot = { ...existing, revision: existing.revision + 1, seedVersion: SEED_VERSION,
          spots: reconcileSeedSpots(existing.spots, this.clock()) };
        if (await this.store.compareAndSwap(existing.revision, upgraded)) return upgraded;
      } else {
        const initial: Snapshot = { revision: 1, graphVersion: this.options.graphVersion, seedVersion: SEED_VERSION,
          spots: seeded ? seedApiSpots(this.clock()) : [], rateLimits: {} };
        if (await this.store.compareAndSwap(undefined, initial)) return initial;
      }
    }
    throw new AppError('STORAGE_UNAVAILABLE', 'Could not initialize or upgrade the report store. Retry shortly.', 503);
  }

  private async update(transform: (current: Snapshot) => Snapshot): Promise<Snapshot> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const previous = await this.snapshot();
      const next = transform(previous);
      if (await this.store.compareAndSwap(previous.revision, { ...next, revision: previous.revision + 1 })) return { ...next, revision: previous.revision + 1 };
    }
    throw new AppError('CONCURRENT_UPDATE', 'Reports changed while saving. Please retry.', 409);
  }

  private rateLimit(snapshot: Snapshot, actor: string, action: string, maximum: number): Snapshot {
    const now = this.clock();
    const key = `${actor}:${action}`;
    const recent = (snapshot.rateLimits[key] ?? []).filter(stamp => stamp > now - 60_000);
    assert(recent.length < maximum, 'RATE_LIMIT', 'Too many updates. Wait one minute and retry.', 429);
    const rateLimits: Record<string, readonly number[]> = {};
    for (const [id, stamps] of Object.entries(snapshot.rateLimits)) {
      const active = stamps.filter(stamp => stamp > now - 60_000);
      if (active.length > 0) rateLimits[id] = active;
    }
    rateLimits[key] = [...recent, now];
    return { ...snapshot, rateLimits };
  }

  async bootstrap(actorId: string): Promise<BootstrapResponse> {
    const current = await this.snapshot();
    const profile = PROFILES[1];
    assert(profile, 'CONFIGURATION', 'Vehicle profiles are unavailable.', 500);
    // Only provider/search metadata is exposed; no downloaded road graph exists.
    const graph = { metadata: API_MAP_METADATA };
    return { graph, places: NCR_PLACES, profiles: PROFILES,
      spots: this.visibleSpots(current).map(spot => publicSpot(spot, profile, this.clock())), revision: current.revision,
      demoMode: this.options.demoMode, seededMode: this.options.seededMode === true, actorId,
      coverage: { nodes: 0, edges: 0, preview: false } };
  }

  /** Poll changing observations without retransmitting a potentially large OSM graph. */
  async reports(): Promise<ReportsResponse> {
    const current = await this.snapshot();
    const profile = PROFILES[1];
    assert(profile, 'CONFIGURATION', 'Vehicle profiles are unavailable.', 500);
    return { spots: this.visibleSpots(current).map(spot => publicSpot(spot, profile, this.clock())), revision: current.revision };
  }

  async routes(body: unknown): Promise<RouteResponse> {
    const request = routeInput(body);
    const current = await this.snapshot();
    return this.options.routing.plan(request, this.visibleSpots(current), this.clock(), current.revision);
  }

  async report(body: unknown, actor: string): Promise<{ spot: ReturnType<typeof publicSpot>; merged: boolean; revision: number }> {
    const input = reportInput(body);
    const segmentId = `location:${input.coords.map(value => value.toFixed(4)).join(':')}`;
    const now = this.clock();
    const id = randomUUID();
    let photoId: string | undefined;
    if (input.photo !== undefined) {
      const photo = decodePhoto(input.photo);
      photoId = randomUUID();
      await this.store.putPhoto(photoId, photo);
    }
    let saved: Spot | undefined;
    let merged = false;
    const next = await this.update(current => {
      const limited = this.rateLimit(current, actor, 'report', 5);
      assert(current.spots.length < 400, 'PILOT_CAPACITY', 'This pilot is full. Archive old reports before adding more.', 503);
      const duplicate = this.visibleSpots(current).find(spot => spot.source === 'community' && !spot.cleared && !spot.archived && distanceMetres(spot.coords, input.coords) < 65);
      if (duplicate !== undefined) {
        assert(duplicate.reporterId !== actor && duplicate.votes[actor] === undefined, 'ALREADY_REPORTED', 'You already reported or confirmed this spot.');
        merged = true;
        saved = { ...duplicate, depth: Math.max(duplicate.depth, input.depth) as Spot['depth'],
          confirms: duplicate.confirms + 1, lastConfirmedAt: now, votes: { ...duplicate.votes, [actor]: 'confirm' },
          ...(photoId === undefined ? {} : { photoId }) };
        return { ...limited, spots: current.spots.map(spot => spot.id === duplicate.id ? saved as Spot : spot) };
      }
      saved = { id, name: input.name, coords: input.coords, segmentId, depth: input.depth, source: 'community',
        createdAt: now, lastConfirmedAt: now, confirms: 0, dismisses: 0, cleared: false, reporterId: actor, votes: {},
        ...(photoId === undefined ? {} : { photoId }) };
      return { ...limited, spots: [...current.spots, saved] };
    });
    assert(saved, 'STORAGE_UNAVAILABLE', 'Report was not saved.', 503);
    return { spot: publicSpot(saved, PROFILES[1] as NonNullable<typeof PROFILES[1]>, now), merged, revision: next.revision };
  }

  async vote(id: string, body: unknown, actor: string): Promise<{ revision: number }> {
    const input = voteInput(body);
    const next = await this.update(current => {
      const limited = this.rateLimit(current, actor, 'vote', 30);
      const spot = current.spots.find(candidate => candidate.id === id);
      assert(spot, 'NOT_FOUND', 'That report no longer exists.', 404);
      assert(!spot.cleared, 'CLEARED', 'That report has already been marked cleared.');
      assert(spot.reporterId !== actor, 'OWN_REPORT', 'Another road user must confirm your report.');
      assert(spot.votes[actor] === undefined, 'ALREADY_VOTED', 'You have already voted on this report.');
      const demoBypass = this.options.demoMode && input.demo && spot.source === 'seeded';
      assert(demoBypass || (input.coords !== undefined && distanceMetres(input.coords, spot.coords) <= 500), 'NEARBY_REQUIRED', 'Be within 500 m of the spot to confirm its current condition.');
      const confirms = spot.confirms + Number(input.action === 'confirm');
      const dismisses = spot.dismisses + Number(input.action === 'dismiss');
      const updated: Spot = { ...spot, confirms, dismisses,
        lastConfirmedAt: input.action === 'confirm' ? this.clock() : spot.lastConfirmedAt,
        cleared: dismisses >= 2 && dismisses > confirms,
        votes: { ...spot.votes, [actor]: input.action } };
      return { ...limited, spots: current.spots.map(candidate => candidate.id === id ? updated : candidate) };
    });
    return { revision: next.revision };
  }

  async simulate(body: unknown, actor: string): Promise<{ revision: number; message: string }> {
    assert(this.options.demoMode, 'DEMO_DISABLED', 'Simulation is disabled on this deployment.', 403);
    const input = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
    assert(input.action === 'reset', 'DEMO_DISABLED', 'Only labelled seed refresh is supported with API routing.');
    const next = await this.update(current => {
      const limited = this.rateLimit(current, actor, 'demo', 10);
      return { ...limited, seedVersion: SEED_VERSION, spots: reconcileSeedSpots(current.spots.filter(spot => spot.source !== 'seeded'), this.clock()) };
    });
    return { revision: next.revision, message: 'Simulated location reports refreshed. Community reports kept.' };
  }
}

function decodePhoto(data: string): Photo {
  const split = data.indexOf(',');
  const bytes = Buffer.from(data.slice(split + 1), 'base64');
  const png = data.startsWith('data:image/png;');
  const signature = png ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  assert(bytes.length > 12 && bytes.length <= 1_048_576 && signature, 'INVALID_PHOTO', 'The file is not a valid JPEG or PNG under 1 MB.');
  return { contentType: png ? 'image/png' : 'image/jpeg', bytes };
}
