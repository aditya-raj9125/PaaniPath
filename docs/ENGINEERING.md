# Engineering guide

This document consolidates architecture decisions, maps/NCR scope, seed research, security, testing and operations. See [README](../README.md) for diagrams, [Algorithms](ALGORITHMS.md) for implementation analysis and [API](API.md) for contracts. These are the three tracked documents; the deployment runbook remains local and ignored.

## Monorepo boundaries

| Workspace | Responsibility | Important boundaries |
| --- | --- | --- |
| `apps/api` | Application service, HTTP/Lambda adapters, sessions, directions and geocoding | Runtime validation at entry; trusted server configuration only; no browser credentials |
| `apps/web` | Search, trip state, tile projection, route/report overlays and interactions | Consumes shared contracts; does not call ORS directly |
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

Request provider baselines and approximate polygon-avoidance candidates, then rank unique report exposure under the chosen detour budget. Compare both intermediate orders only for four-stop trips. Only an explicit avoidance `NO_ROUTE` permits a warned baseline-only outcome; credential, quota, network and malformed-response failures cannot silently suppress avoidance. No global-optimality or flood-safety claim is made.

### Coordinate observations rather than road closures

Reports are stored by coordinates, not verified road-segment identity. Duplicate merging uses nearby community observations, not a local graph. Compatibility `segmentId` and metadata fields do not imply a road network exists. Report preservation and optional simulated seeds are independent of the removed importer.

### Online maps and server-only provider credentials

The browser displays online OSM raster tiles. Photon supplies address results through the backend; ORS supplies directions through the backend. The PWA caches the app shell and retains a small unsent-report queue, but neither maps nor routing is offline-capable.

## Maps and regional scope

The search viewport is `[south,west,north,east] = [26.5,75.5,30.25,78.75]`. It is a broad NCR rectangle, **not the legal administrative boundary or a downloaded coverage outline**. Saved shortcuts cover Delhi, Noida, Greater Noida, Gurugram, Ghaziabad, Faridabad and outer NCR. Their coordinates are approximate; use address search/map selection for an exact destination.

ORS GeoJSON coordinates are explicitly converted from longitude/latitude to the app's latitude/longitude convention. The map projects provider geometry into Web Mercator, chooses visible tile ranges and fits selected locations/routes. No invented streets replace tile failures; a visible warning describes failed tiles. Routing and map display can fail independently.

Respect attribution and [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/). Public Photon/OSM services have no project SLA. Production needs appropriately provisioned services and policy-compliant traffic; no tile prefetch/bulk downloading is implemented.

India expansion does not require a local road import. It does require geocoding bounds/shortcuts changes, regional report queries, shared quota controls, contracted provider capacity and representative acceptance tests. Public-hosted avoidance routing is currently limited to 150 km and polygon extent to 20 km; see [ORS restrictions](https://openrouteservice.org/restrictions/). The current small individual buffers do not remove the route-distance restriction.

## Seed data and provenance

The current catalogue has **320 simulated observations**, comprising 224 general NCR examples and 96 around 24 researched Gurugram hotspots. They are not 320 verified incidents. Source-labelled metadata is implemented in [gurugram.ts](../packages/data/src/gurugram.ts).

Historical references:

- [ABP Live, 10 July 2025](https://news.abplive.com/cities/gurugram-comes-to-standstill-as-roads-flooded-offices-announce-work-from-home-video-1786690): reports Gurugram waterlogging and disruption at junctions/corridors/sectors.
- [Moneycontrol, 8 July 2026](https://www.moneycontrol.com/city/gurugram-advises-wfh-for-corporate-offices-as-heavy-rain-triggers-nh-48-cave-in-massive-traffic-chaos-article-13968420.html/amp): reports further disruption, including the Hero Honda Chowk area.

These articles establish reported historical locations, not precise pin coordinates, current flood state, individual offset incidents or depth estimates. Landmark/sector anchors are manually approximated; nearby offsets generate demonstration pins. Road snapping and field verification were not performed. Depth, age and freshness are simulation parameters. New scenarios have zero confirmations and `source=seeded`; detail cards expose available source links/dates. Set `SEED_MODE=false` for community-only visibility and routing.

### Existing-store reconciliation

On the next API read, a seed-enabled store with an old catalogue version receives a one-time CAS-protected upgrade. Community records/photos survive; matching seed IDs preserve votes, cleared state and timestamps. Obsolete seed IDs are replaced. There is no repeated freshness reset on polling or restart.

The snapshot remains capped at 400. Community records consume capacity first, and research-linked Gurugram scenarios are prioritized among seeds. Therefore 320 is the catalogue/new-store default, not a guaranteed count in every existing database. Seed-disabled stores do not receive the upgrade. Disabling seeds hides them; it does not delete stored community reports.

## Storage and concurrency

The Store contract exposes `read`, revisioned `compareAndSwap`, `putPhoto` and `getPhoto`. SQLite uses WAL and a single state row plus photo BLOB rows; DynamoDB uses a consistent `GetItem` and conditional `PutItem` on `pk=PILOT`. Service mutations retry at most five times. See [algorithm details](ALGORITHMS.md#8-reports-votes-and-optimistic-concurrency).

This bounded pilot caps observations at 400 and DynamoDB serialized payloads below 350,000 bytes. It reads/rewrites a global snapshot, which becomes a hot item and contention point. Votes/rate-limit metadata also consume payload space. There is no regional partitioning, distributed provider limiter or national-scale report query engine yet.

Photos are separate from the snapshot transaction; upload before a failed mutation may create an orphan. AWS photo expiration is 30 days, while report references can outlive objects. Retaining a bucket on stack deletion does not disable its lifecycle. SQLite records/photos do not automatically migrate to DynamoDB/S3.

## AWS integration and configuration

The [SAM template](../infra/template.json) declares 13 resources: report table, web/photo buckets, HTTP API, Lambda, log group, CloudFront OAC/cache/origin/header policies, distribution and web-bucket policy.

| Concern | Implemented configuration |
| --- | --- |
| Compute | Node.js 24 ARM64 Lambda, `index.handler`, 2,048 MB, 25-second timeout, reserved concurrency 5 |
| Gateway | HTTP API `$default`, `ANY /api/{proxy+}`, burst 20/rate 10 throttling |
| Static delivery | Private encrypted S3 web bucket read only through CloudFront OAC |
| API delivery | `/api/*` HTTPS-only origin path; cache TTLs zero; cookies/query strings and required JSON/application headers forwarded |
| Reports | Encrypted on-demand DynamoDB, PITR, deletion/update retention |
| Photos | Private encrypted S3, prefix-scoped runtime IAM, 30-day lifecycle, retention policies |
| Diagnostics | Lambda log group retention 14 days; no automatically configured alarm resources |
| Secrets | NoEcho parameters to server environment; managed lifecycle configured separately |
| Output | Website URL, web-bucket name, distribution ID, raw API URL |

The compiled Lambda artifact is `dist/lambda`, referenced relative to `infra/template.json`; frontend `dist/web` must be uploaded separately. The storage adapter uses AWS Signature V4 with temporary execution-role credentials. There is no runtime Secrets Manager read. Domain/ACM/Route53 resources, WAF, alarms and managed secrets are not created by the current template.

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
| HTTP integration | Real local endpoints with temporary SQLite and intercepted ORS; malformed input and error envelopes |

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
- `.env`, `.data`, generated output, private-key files, AWS/SAM local configuration and the deployment runbook stay outside Git.

## Release checklist

1. Run quality/HTTP tests and verify build artifacts; use staging for live provider/browser checks.
2. Review secrets/file inclusion and documentation links before staging.
3. Use focused conventional commits; do not squash unrelated app/data/infra/documentation into one initial commit.
4. Confirm remote history before first push; never force-push to bypass unrelated existing history.
5. Review template changes and SAM validation separately from automated structural checks.
6. Deploy matched backend/frontend revisions and verify provider/storage behavior.
7. Monitor request costs, provider quotas and polling load. Budget alerts are warnings, not hard caps.

Before public/national scale: partition storage, add durable shared quota controls, authentication/moderation, direct API protection, regional queries, provisioned tile/geocoding services and tested backup/privacy workflows. Do not claim guaranteed flood safety.
