# Engineering guide

This document consolidates architecture decisions, maps/NCR scope, seed research, security, testing and operations. See [README](../README.md) for diagrams, [Algorithms](ALGORITHMS.md) for implementation analysis, [API](API.md) for contracts and [Deployment](DEPLOYMENT.md) for the release workflow. These are the four tracked guides.

## Monorepo boundaries

| Workspace | Responsibility | Important boundaries |
| --- | --- | --- |
| `apps/api` | Application service, HTTP/Lambda adapters, sessions, directions and geocoding | Runtime validation at entry; trusted server configuration only; no browser credentials |
| `apps/web` | Search, trip state, tile projection, route/report overlays and interactions | Consumes shared contracts; does not call ORS directly |
| `apps/deploy` | AWS deployment configuration, identity checks, secrets, publication and smoke tests | Private settings ignored; CLI transports mocked in tests; no automatic deletion |
| `packages/domain` | Shared contracts, input validation, errors and safety policy | Pure domain functions; no transport/storage dependency |
| `packages/data` | Store interface, SQLite/DynamoDB/S3 adapters and labelled seeds | Revisioned snapshot contract; storage-specific implementation isolated |
| `packages/routing` | Reusable Haversine/segment geometry | No road graph, importer or network transport |
| `packages/ui` | Reusable icons and escaping helpers | No API credentials or backend state |

The root uses npm workspaces. Strict TypeScript path aliases resolve shared packages during development; the portable compiler rewrites aliases to relative ESM imports for browser and Lambda output. Typecheck precedes compilation because transpilation alone does not establish type correctness.

`Application.handle` is shared by the local Node HTTP server and the API Gateway payload-v2 Lambda adapter. `PaaniPathService` receives a Store and routing executor; provider adapters accept transports, and tests supply controlled clocks/responses. Module boundaries allow reuse without introducing a framework-specific domain layer.

## Architecture decisions

### API-only road routing

The offline importer/A* planner was removed in favor of server-side OpenRouteService. No Overpass chunks, worker, road snapshot or downloaded graph is required at startup. Consequence: faster setup and provider-managed road coverage, but mandatory connectivity, credentials and quota. Old offline benchmarks and optimality proofs no longer describe the app.

### Honest flood-aware comparison

Request provider baselines and approximate polygon-avoidance candidates, then rank unique report exposure under the chosen detour budget. Avoidance includes risky/stale reports within a 2 km corridor of any baseline, reducing irrelevant NCR-wide polygons; every returned route is scored against **all** reports. Detours outside that corridor may encounter hazards not supplied as avoidance polygons, which remain counted in ranking. Compare both intermediate orders only for four-stop trips. Only an explicit avoidance `NO_ROUTE` permits a warned baseline-only outcome; credential, quota, network and malformed-response failures cannot silently suppress avoidance. No global-optimality or flood-safety claim is made.

### Coordinate observations rather than road closures

Reports are stored by coordinates, not verified road-segment identity. Duplicate merging uses nearby community observations, not a local graph. Compatibility `segmentId` and metadata fields do not imply a road network exists. Report preservation and optional simulated seeds are independent of the removed importer.

### Online maps and server-only provider credentials

The browser displays online OSM raster tiles. Photon supplies address results through the backend; ORS supplies directions through the backend. The PWA caches the app shell and retains a small unsent-report queue, but neither maps nor routing is offline-capable.

## Judge-demo journeys

| Dropdown | Editable trip | Intermediate stops |
| --- | --- | --- |
| Journey 1 | Connaught Place → India Gate | 0 |
| Journey 2 | Hero Honda Chowk → Basai Chowk, Gurugram | 0 |
| Journey 3 | Sector 30 → Sector 40, Gurugram | 0 |
| Journey 4 | Noida Sector 18 → Sector 62 | 0 |
| Journey 5 | Greater Noida local road approach → road exit | 0 |
| Journey 6 | Indirapuram → Crossings Republik | 0 |
| Journey 7 | Connaught Place → ITO | 0 |
| Journey 8 | Hero Honda → Basai → Rajiv Chowk | 1 |
| Journey 9 | Connaught Place → ITO → India Gate | 1 |
| Journey 10 | Connaught Place → Minto Bridge → ITO → India Gate | 2 |

The catalogue in `packages/data/src/journeys.ts` contains **locations only**, not cached routes, incident claims or guaranteed exposure counts. Journey 5 uses two explicitly named demo road endpoints returned by the ORS driving-car snapping API, not invented POI names. On 11 October 2026, all ten final presets passed live-provider acceptance using the normal application timeout and a fresh 6,505-case seed catalogue: baselines encountered respectively **7, 15, 2, 14, 10, 20, 7, 33, 7 and 9 cases**, and each comparison returned an alternative with fewer damaging exposures. Point-in-time comparisons took approximately 0.7–3.6 seconds and selected 66–302 avoidance polygons, instead of sending all 3,540 risky/stale polygons across NCR. Longer trips that missed seeds or repeatedly stalled were excluded; corridor filtering addressed the catalogue-wide request overhead. Subsequent provider-map changes, cleared/aged reports, different profiles or edited stops can change results. Baseline-only outcomes remain valid when avoidance cannot connect the stops or exceeds the detour allowance; never fabricate alternatives.

Before judging, enable `SEED_MODE=true`, configure the server-only `ORS_API_KEY`, rebuild and restart. The initial planner leaves both locations blank and fits NCR without requesting directions. Choose a preset; it defaults to an editable car profile, 2× allowance and fixed stop order. Compare the fastest/returned lower-exposure route cards, hover/focus a hotspot for case count, then choose **View cases**. Journey 10 has two intermediate stops; enable **Optimize stop order** to compare both orders. The dropdown's **Plan your own trip** clears stops and restores NCR. Manual search routes only after every stop is explicitly selected; typing cancels stale requests and cannot route an unselected address.

For an aged demo store, optionally enable `DEMO_MODE=true` and use **How it works → Refresh seeds** before judging. This explicitly refreshes simulated depths/freshness without removing community reports; choosing a journey does not reset or forge incident freshness.

To repeat live acceptance (uses provider quota; not CI), first build, then run:

```powershell
node --env-file-if-exists=.env scripts/verify-journeys.mjs
```

Supply IDs such as `journey-5 journey-10` to verify a subset. The check uses the application's 8-second provider timeout; optional `--patient` permits 30 seconds for latency diagnosis, not proof of normal application availability. Live acceptance is a point-in-time check, not an SLA. No provider key is printed and no route geometry/database changes are saved. Automated tests separately validate trip counts, input contracts, blank startup readiness, preset-copy isolation, dropdown markup and camera cancellation/reduced motion.

Camera flights last approximately 850 ms, interpolate centres and logarithmic zoom, and fit all returned candidate geometry plus stops. A replacement flight, pan or zoom cancels the prior flight. Layer/tile refresh is throttled during animation; users requesting reduced motion get an immediate fit. Browser/device visual acceptance remains a separate manual gate.

## Maps and regional scope

### Route-scoped hotspot display

No hotspots are drawn on initial load, incomplete searches, failed routing or cleared trips. Once routes arrive, the map displays hotspots within **750 m of the selected route polyline**, not all candidate routes or a rectangle around the endpoints. A hotspot qualifies when its centre **or any active case** is within that distance, ensuring a case on the route cannot disappear because its group anchor is farther away. Complete qualifying groups retain their true counts/intensity; drill-down can therefore include a case just outside the corridor belonging to a qualifying hotspot. Cleared/archived cases do not qualify groups.

`routeHotspots` reuses the shared geographic point grid for candidate narrowing and exact segment distance filtering. Route-card changes, report refreshes and trip edits recompute visibility; out-of-scope selections/drill-down are cleared. Map summary counts describe visible groups/cases, not the full stored catalogue. The community reports list remains a catalogue; an out-of-corridor **View cases** action explains that a nearby route must first be planned/selected. No records are deleted or reseeded. This **750 m visualization radius** differs from the **2 km avoidance-candidate corridor** and **85 m route exposure distance**; backend scoring continues to consider all active reports.

The search viewport is `[south,west,north,east] = [26.5,75.5,30.25,78.75]`. It is a broad NCR rectangle, **not the legal administrative boundary or a downloaded coverage outline**. Saved shortcuts cover Delhi, Noida, Greater Noida, Gurugram, Ghaziabad, Faridabad and outer NCR. Their coordinates are approximate; use address search/map selection for an exact destination.

ORS GeoJSON coordinates are explicitly converted from longitude/latitude to the app's latitude/longitude convention. The map projects provider geometry into Web Mercator, chooses visible tile ranges and fits selected locations/routes. No invented streets replace tile failures; a visible warning describes failed tiles. Routing and map display can fail independently.

Respect attribution and [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/). Public Photon/OSM services have no project SLA. Production needs appropriately provisioned services and policy-compliant traffic; no tile prefetch/bulk downloading is implemented.

India expansion does not require a local road import. It does require geocoding bounds/shortcuts changes, regional report queries, shared quota controls, contracted provider capacity and representative acceptance tests. Public-hosted avoidance routing is currently limited to 150 km and polygon extent to 20 km; see [ORS restrictions](https://openrouteservice.org/restrictions/). The current small individual buffers do not remove the route-distance restriction.

## Seed data and provenance

The current catalogue has **500 hotspots and 6,505 simulated cases**, with irregular groups of 6–20 cases. Regional allocation: Gurugram 150, Delhi 130, Noida 70, Greater Noida 45, Ghaziabad 45, Faridabad/outer NCR 60. These are synthetic scenarios, not verified incidents. Provider-returned coordinates and metadata live in [road-hotspots.ts](../packages/data/src/road-hotspots.ts).

Historical references retained for landmark/search context, not evidence for the new synthetic cases:

- [ABP Live, 10 July 2025](https://news.abplive.com/cities/gurugram-comes-to-standstill-as-roads-flooded-offices-announce-work-from-home-video-1786690): reports Gurugram waterlogging and disruption at junctions/corridors/sectors.
- [Moneycontrol, 8 July 2026](https://www.moneycontrol.com/city/gurugram-advises-wfh-for-corporate-offices-as-heavy-rain-triggers-nh-48-cave-in-massive-traffic-chaos-article-13968420.html/amp): reports further disruption, including the Hero Honda Chowk area.

On 11 October 2026, [generate-hotspots.mjs](../scripts/generate-hotspots.mjs) curated separated road anchors and irregular nearby case candidates through the [ORS snap API](https://giscience.github.io/openrouteservice/api-reference/endpoints/snapping/). Candidate offsets are never persisted as final pins: only returned road-snapped coordinates survive, with null results, duplicate positions and excessive distances rejected. The provider's graph date is 21 September 2026. No local road graph or offline routing dependency was introduced. Provider map alignment is not a field survey or a guarantee of current physical road conditions; tile/provider map versions can differ.

Depth, age and case-count distribution are simulations. New cases have zero confirmations and `source=seeded`. The old four-offset generators were removed. At overview zoom, nearby hotspots aggregate; drilling in separates locations, then View cases reveals only the selected hotspot's pins. Hovering pins does not disclose case details; clicking a revealed case opens its details. Intensity scales monotonically with count (e.g. 16 cases > 6) and is explicitly not flood-depth severity. Set `SEED_MODE=false` for community-only visibility/routing.

### Existing-store reconciliation

On the next API read, a seed-enabled store with an old catalogue version receives a one-time CAS-protected upgrade. Community records/photos survive; matching seed IDs preserve votes, cleared state and timestamps. Obsolete seed IDs are replaced. There is no repeated freshness reset on polling or restart.

The snapshot is capped at 10,000. Community records consume capacity first, so 6,505 is the catalogue/new-store default, not a guaranteed count in an already busy store. An old seed version triggers replacement of old offset pins; matching new-catalogue IDs keep votes/freshness. Seed-disabled stores do not receive the upgrade. Disabling seeds hides them; it does not delete community reports.

## Storage and concurrency

The Store contract exposes `read`, revisioned `compareAndSwap`, `putPhoto` and `getPhoto`. SQLite uses WAL and a single state row plus photo BLOB rows; DynamoDB uses a consistent `GetItem` and conditional `PutItem` on `pk=PILOT`. Service mutations retry at most five times. See [algorithm details](ALGORITHMS.md#8-reports-votes-and-optimistic-concurrency).

This bounded pilot caps observations at 10,000 and gzip/base64 DynamoDB payloads below 350,000 bytes. Compression makes the larger catalogue fit the existing table; new items identify `encoding=gzip-base64`, and old plain-JSON items remain readable. Decompression has a 32 MB output bound. Actual compressed-byte capacity can be reached before the record-count cap as votes/rate-limit data grow. The implementation still reads/rewrites a global snapshot, which becomes a hot item and contention point. Compression is not regional partitioning or a national-scale storage architecture.

Photos are separate from the snapshot transaction; upload before a failed mutation may create an orphan. AWS photo expiration is 30 days, while report references can outlive objects. Retaining a bucket on stack deletion does not disable its lifecycle. SQLite records/photos do not automatically migrate to DynamoDB/S3.

## AWS integration and configuration

The [SAM template](../infra/template.json) declares 20 resources: application storage, API/compute and CloudFront resources plus SNS alert delivery, three Lambda alarms and an account-wide monthly budget. SAM creates additional supporting resources. The [deployment guide](DEPLOYMENT.md) covers the automated `us-east-1` release.

| Concern | Implemented configuration |
| --- | --- |
| Compute | Node.js 24 ARM64 Lambda, `index.handler`, configurable memory default 2,048 MB, 25-second timeout; reservation omitted by default |
| Gateway | HTTP API `$default`, `ANY /api/{proxy+}`, burst 20/rate 10 throttling |
| Static delivery | Private encrypted S3 web bucket read only through CloudFront OAC |
| API delivery | `/api/*` HTTPS-only origin path; cache TTLs zero; cookies/query strings and required JSON/application headers forwarded |
| Reports | Encrypted on-demand DynamoDB, PITR, deletion/update retention |
| Photos | Private encrypted S3, prefix-scoped runtime IAM, 30-day lifecycle, retention policies |
| Diagnostics | 14-day logs, errors/throttles/duration alarms, SNS email and account-wide budget warnings |
| Secrets | Script-managed Secrets Manager versions passed through NoEcho references to server environment |
| Output | Website URL, web-bucket name, distribution ID, raw API URL |

The compiled Lambda artifact is `dist/lambda`, referenced relative to `infra/template.json`. `apps/deploy` orchestrates dependency installation, quality gates, SAM lint/deployment, private `dist/web` uploads with explicit MIME types, invalidation and HTTPS smoke checks. Deployment runs with `npm run deploy:aws` using ignored `.env.deploy`; the blank example and guide are tracked. Tools, approved account permissions, login and email confirmation still require user setup.

The storage adapter uses AWS Signature V4 with temporary execution-role credentials. There is no runtime Secrets Manager read. The script creates/reuses a tagged secret outside CloudFormation and pins its version in the Lambda parameters, updating configuration when keys change. Blank session-secret configuration preserves the generated signing secret. Domain/ACM/Route53 and WAF resources are not created. Budget warnings do not prevent charges, and retained resources/managed secrets can continue costing money after stack deletion.

Structural checks verify repository assumptions, not complete CloudFormation schemas. Install SAM and run `sam validate --template-file infra/template.json --lint` before deploying. Fresh accounts may need regional Lambda quota changes. No live AWS acceptance was performed as part of the repository audit.

The raw API Gateway endpoint remains accessible; CloudFront alone is not an authorization boundary. No VPC is needed for this pilot; introducing private subnets without egress breaks provider calls. Use account-approved deployment credentials, never static browser/runtime keys.

## Testing and quality gates

```powershell
npm ci --ignore-scripts
npm run check
npm run test:http
```

`check` runs strict types, AST lint, unit tests, build, structural infrastructure validation and tracked-documentation validation. The lint's cyclomatic threshold is 25 per function; custom rules reject explicit `any`, non-null assertions, debugger, type suppressions and trailing whitespace. This is a focused custom lint, not a claim of complete ESLint/security/formatting coverage.

| Layer | Tested concerns |
| --- | --- |
| Domain | Coordinates, depth, vehicle thresholds, freshness, validation and typed errors |
| Routing contracts | Coordinate order; 2/3/4 stops; both intermediate orders; buffers; exposure rank; detour; no-route; profiles |
| Provider failures | Missing/rejected keys, quota, timeout/network, plan limits, malformed geometry/estimates |
| Cache/concurrency | Revision and freshness invalidation, bounded comparison count, upstream request budget |
| Reports/storage | Duplicate merging, independent/nearby votes, clearing, CAS conflict behavior, persistence and seed preservation |
| Search/map/UI helpers | Result parsing/filtering, projection/fit, tile selection, escaping and shared helpers |
| Hotspots | Variable counts, road-coordinate provenance, count-preserving zoom aggregation, monotonic intensity, click-only case drill-down |
| Larger snapshots | Full-catalogue compressed storage, legacy reads, conditional-write preservation and response-size bounds |
| HTTP integration | Real local endpoints with temporary SQLite and intercepted ORS; malformed input and error envelopes |
| Deployment | Configuration rejection, account/approval checks, secret-file cleanup/reuse, version references, output targeting and ordered mocked release failures |

GitHub Actions repeats automated gates on `ubuntu-latest` and `windows-latest` with Node 24. Transport mocks exist in tests only, and integration tests must not touch the user's `.data` store or call paid routing APIs.

### Acceptance not covered by mocks

`npm run test:e2e` targets a running server (`TEST_BASE_URL`, default `http://localhost:3000`) and calls real routing; it consumes provider quota. Configure the key first. Check inter-city NCR trips, 2–4 stops, order swapping, map focus, endpoint/bridge buffer behavior, provider failures and staging report/photo persistence.

Browser/device QA must separately cover keyboard combobox navigation, touch pan/zoom, responsive layouts, permissions, tile errors and PWA update/offline behavior. Mocked contracts, geometric unit tests and HTTP checks do not prove browser rendering, live road coverage, paid-provider capacity or AWS readiness. Do not advertise measured performance without a reproducible benchmark.

## Security and privacy

- Signed opaque cookies use HMAC-SHA256 and timing-safe signature comparison. Cookies are HttpOnly/SameSite=Strict; AWS enables Secure. Anonymous sessions are not verified accounts.
- Non-GET requests require JSON and `X-PaaniPath: 1`. Input lengths, finite coordinates, vehicle thresholds and photo format/size are checked. The custom header is not an API credential or proof of a trusted person.
- API errors return stable codes/messages/request IDs rather than provider payloads/credentials. Unexpected failures are logged privately; do not publish raw cookies, coordinates or secrets in troubleshooting exports.
- ORS keys stay server-side. Stops/avoidance polygons go to ORS, search text to Photon and viewed tile areas to the tile provider. No application route history is persisted; short-lived caches still contain transient trip data.
- JPEG/PNG uploads are limited to 1 MB and checked for signatures; this is not a full malware/content-moderation or EXIF-privacy pipeline. Add production controls deliberately.
- Independent nearby votes and persisted actor budgets discourage accidental repetition but do not defeat spoofed location or multiple identities.
- `.env`, `.env.deploy`, `.deploy`, `.data`, generated output, private-key files and AWS/SAM local configuration stay outside Git. The generic deployment guide and blank example are tracked.

## Release checklist

1. Run quality/HTTP tests and verify build artifacts; use staging for live provider/browser checks.
2. Review secrets/file inclusion and documentation links before staging.
3. Use focused conventional commits; do not squash unrelated app/data/infra/documentation into one initial commit.
4. Confirm remote history before first push; never force-push to bypass unrelated existing history.
5. Review template changes and SAM validation separately from automated structural checks.
6. Deploy matched backend/frontend revisions and verify provider/storage behavior.
7. Monitor request costs, provider quotas and polling load. Budget alerts are warnings, not hard caps.

Before public/national scale: partition storage, add durable shared quota controls, authentication/moderation, direct API protection, regional queries, provisioned tile/geocoding services and tested backup/privacy workflows. Do not claim guaranteed flood safety.
