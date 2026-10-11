# API contract

The frontend uses same-origin `/api/*` JSON requests. Shared types/validation live in [packages/domain](../packages/domain/src/types.ts); dispatch lives in [application.ts](../apps/api/src/application.ts). See [README](../README.md), [Algorithms](ALGORITHMS.md), [Engineering](ENGINEERING.md) and [Deployment](DEPLOYMENT.md) for architecture, constraints and operations.

## Headers, sessions and errors

Non-GET requests require `Content-Type: application/json` and `X-PaaniPath: 1`. The server issues an opaque signed `pp_session` cookie for anonymous ownership/vote identity. It is not account authentication. Preserve cookies between bootstrap and mutations. AWS cookies are Secure, HttpOnly and SameSite=Strict; local HTTP omits Secure.

JSON responses use `Cache-Control: no-store` and `X-Request-Id`. Errors have this envelope:

```json
{
  "error": {
    "code": "INVALID_STOPS",
    "message": "Choose an origin and one to three stops.",
    "requestId": "opaque-request-identifier"
  }
}
```

Unknown failures use `INTERNAL_ERROR` with a generic message. Credentials/provider payloads are not intentionally returned. Rate-limit responses include `Retry-After: 60`. Request body text is bounded to 1,500,000 characters; photos have separate byte limits.

## Endpoints

| Method/path | Purpose / input | Success |
| --- | --- | --- |
| `GET /api/health` | Process health; identifies `openrouteservice`, not upstream readiness | 200 |
| `GET /api/bootstrap` | Metadata, saved places, ten demo journeys, profiles, visible reports, revision and actor identity | 200 |
| `GET /api/reports` | Public reports and revision for polling | 200 |
| `POST /api/places/search` | `{query,online}`; 2–120 character text; `online:true` requests Photon | 200 |
| `POST /api/routes` | 2–4 locations, profile, detourFactor and optimizeOrder | 200 |
| `POST /api/reports` | Coordinates, depth 1–4, optional name/photo | 201, including duplicate merges |
| `POST /api/reports/:id/vote` | `{action:"confirm"|"dismiss",coords?,demo?}` | 200 |
| `GET /api/photos/:id` | UUID photo identifier | 200 JPEG/PNG bytes; private caching |
| `POST /api/demo` | `{action:"reset"}`; requires explicit `DEMO_MODE=true` | 200 |

### Demo journey catalogue

Bootstrap includes `journeys`, an array of `{id,title,locations}` using the shared `DemoJourney` contract. Seven entries have two locations, two have three, and one has four. The catalogue supplies only editable stop coordinates; it does not issue directions requests or contain route geometry. The browser starts with empty A/B fields, and selecting a preset submits the normal routing request. Catalogue presence does not imply seed mode is enabled or that reports remain fresh.

Avoidance candidates use risky/stale reports within 2 km of provider baseline geometry. Exposure scoring always checks every report, including hazards encountered by detours outside that corridor; warnings disclose this candidate-generation limitation.

### Report refresh protocol

`GET /api/reports` returns the complete public `{spots,revision}` body. It does not accept a route corridor, `since` revision or regional partition, and has no revision-only endpoint, ETag/304 response or incremental event stream. The frontend polls every five seconds while visible and uses `revision` to decide whether report changes require UI work, not to avoid downloading an unchanged response. Closed tabs no longer poll, and hidden tabs pause scheduled refreshes.

Route-scoped hotspots are a client display filter only. Backend route scoring still considers all active reports. API caching remains disabled to avoid stale observations/session responses. See [the current operating-cost boundary](ENGINEERING.md#polling-and-operating-cost-boundary) before estimating production traffic.

## Routing request

```json
{
  "locations": [
    { "id": "origin", "name": "Connaught Place", "coords": [28.6315, 77.2167] },
    { "id": "destination", "name": "India Gate", "coords": [28.613, 77.2295] }
  ],
  "profile": { "type": "car", "marginal": 3, "damaging": 4 },
  "detourFactor": 2,
  "optimizeOrder": true
}
```

App coordinates are `[latitude,longitude]`; the backend converts them to provider `[longitude,latitude]`. Stops must be finite, in geographic range and more than 10 m apart. Location names/IDs are bounded strings. Profiles are scooter, motorbike, car, auto or bus; omitted thresholds use the selected preset. Thresholds are integer levels 1–4 with marginal ≤ damaging. `detourFactor` defaults to 2 and must be 1–3; `optimizeOrder` defaults true.

For four locations, origin/destination remain fixed while the two intermediate orders may be compared. There is no general arbitrary-waypoint optimizer.

### Response semantics

`RouteResponse` contains `routes`, public `spots`, report `revision`, `graphSource`, `stats`, `reason` and `warning`. Each route includes provider geometry, duration in `score.seconds`, `distanceMetres`, unique exposed `spotIds`, order, score, flags, extra time and detour status. The top-level warning must remain visible to users.

- `recommended` identifies the first ranked eligible returned candidate, not a guaranteed-safe path.
- `fastest` identifies the quickest returned baseline geometry/estimate, not a global/live-traffic proof.
- `edgeIds` is empty; no former local road-graph edges exist.
- `graphSource="openrouteservice"`, `stats.optimal=false`, `expanded=0`, `pruned=0`.
- `labels` counts eligible provider candidates, not graph-search labels; `durationMs` measures local comparison execution, not user-visible end-to-end latency.
- Bootstrap's `graph.metadata` is a compatibility envelope with no road graph. Coverage counters are zero and `preview=false`.

Up to three distinct geometries are returned: best two plus fastest baseline if missing. See [exact ranking and invariants](ALGORITHMS.md#3-candidate-planning-algorithm).

## Provider errors

| Code | Typical status | Meaning |
| --- | --- | --- |
| `ROUTING_KEY_REQUIRED` | 503 | Server ORS key missing |
| `ROUTING_CREDENTIALS` | 503 | Upstream rejected credentials |
| `ROUTING_QUOTA` | 429 | Provider quota or application's per-process call budget reached |
| `ROUTING_BUSY` | 503 | Comparison concurrency cap reached |
| `ROUTING_UNAVAILABLE` | 503 | Transport timeout/network failure |
| `ROUTING_PROVIDER` | 502 | Other provider rejection/unavailability |
| `PROVIDER_RESPONSE` | 502 | Invalid JSON/geometry/travel estimates |
| `ROUTING_PROVIDER_LIMIT` | 422 | Provider plan/options/distance limit |
| `NO_ROUTE` | 422 | Provider cannot connect the trip |

Only documented avoidance no-route outcomes may produce a successful response retaining baselines **with a visible warning**. Baseline no-route fails comparison. Credential/quota/timeout/other provider failures never invent routes or silently drop avoidance.

## Reports, votes and photos

Report example: `{ "coords":[28.63,77.22], "depth":2, "name":"Test observation" }`. Names are at most 80 characters. An optional `photo` is a JPEG/PNG base64 data URL under 1 MB decoded with a matching signature. Use staging for synthetic community test submissions.

Reports within 65 m of active community observations may merge, preserving the maximum depth and adding an independent confirmation. An actor cannot merge its own report or confirm the same report twice. At current capacity, submissions fail before merge processing. Votes require nearby coordinates (≤500 m), except a labelled seeded-demo bypass when explicitly enabled. Clearing requires at least two dismissals and more dismissals than confirmations. Confirmations refresh freshness; stale means at least one hour since last confirmation.

Public observations omit private reporter IDs/vote maps. Seeded observations retain simulated labels and provider-placement provenance; do not display them as live incidents. Mutation conflicts, unavailable storage, capacity, invalid photos, own/duplicate votes and proximity violations return typed errors. Storage uses bounded optimistic retries, not multi-resource photo/report transactions.

Road-curated seed cases include optional `hotspot:{id,name,coords}` and `roadPlacement:{provider:"openrouteservice",graphDate,snapped:true}`. The current catalogue is 500 hotspots/6,505 cases; old offset pins are removed through a versioned upgrade. These fields document provider road placement, not verified flood conditions. Hotspot intensity/count and drill-down are client-side views of active observations, not additional API endpoints. DynamoDB snapshots now use gzip/base64 with legacy JSON read compatibility; the same revision/conditional-write contract remains.

## Search behavior

Search returns `places`, `source` (`local`, `photon` or `mixed`) and an optional warning. Remote results are filtered to the NCR viewport and merged with saved shortcuts. Public-provider failure returns labelled local suggestions and a warning; this is **search degradation**, not permission to fabricate road routing. The server uses short-lived caches, in-flight deduplication and a per-process request-spacing safeguard.

## Integration verification

Run `npm run test:http` for isolated endpoints against temporary SQLite and mocked ORS. Run `npm run test:e2e` against a configured running server for real directions/asset smoke testing, optionally setting `TEST_BASE_URL`. The latter consumes provider quota; neither command alone verifies browser layout or a live AWS deployment.
