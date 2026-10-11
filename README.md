# PaaniPath

Waterlogging-aware trip planning for Delhi NCR: **real online maps, real API directions, and transparent vehicle-dependent flood-exposure comparisons**.

PaaniPath helps road users compare routes against reported waterlogging instead of considering travel time alone. It covers Delhi, Gurugram/Gurgaon, Noida, Greater Noida, Ghaziabad, Faridabad and saved outer-NCR locations. Its white/light-blue interface supports searchable destinations, map selection and trips with up to two intermediate stops.

> Never enter standing water. Reports may be incomplete or outdated. Vehicle thresholds, approximate flood buffers and a recommended route do not establish that a road is safe.

## Explore the project

- [Data structures and algorithms](docs/ALGORITHMS.md): implemented algorithms, pseudocode, complexity, invariants, worked example, research context and evaluator walkthrough.
- [API contract](docs/API.md): endpoints, requests, responses, errors and session behavior.
- [Engineering guide](docs/ENGINEERING.md): monorepo boundaries, tests, security, AWS integration, seed provenance and design decisions.
- [AWS deployment](docs/DEPLOYMENT.md): one-command Northern Virginia release, private configuration, monitoring and recovery.

## What it does

| Capability | Implementation |
| --- | --- |
| Real street map | Online OpenStreetMap raster tiles, visible attribution and Web Mercator overlays |
| Address search | Photon geocoding with NCR bounds, saved-location suggestions and map-point selection |
| Multi-stop trips | 2–4 locations; add, remove, reorder or reverse; optionally compare both intermediate-stop orders |
| Flood-aware comparison | Provider baselines and polygon-avoidance candidates, exposure scoring and a user-selected detour budget |
| Vehicle assumptions | Scooter, motorbike, car, auto and bus depth classifications; configurable marginal/damaging thresholds |
| Community observations | Depth reports, proximity-based duplicate merging, nearby independent votes, freshness and optional photos |
| Map focus | Selecting a result centres the map; returned/selected routes fit their complete geometry |
| Hotspot intensity | Count-based blue density areas, zoom aggregation, count-only hover/focus and explicit View cases drill-down |
| Responsive experience | Desktop/mobile layouts, keyboard place selection, touch map interactions and visible error states |
| PWA shell | App-asset caching and a bounded pending-report queue; no offline maps or routing |

There are **no road datasets, Overpass chunk downloads, Python importers, local routing graphs or mock-route fallback**. OpenRouteService (ORS) supplies all road directions. Without a key, the map/reports can load but routing returns `ROUTING_KEY_REQUIRED`.

## Quick start

Requires **Node.js 24+**, npm, internet access and your own [OpenRouteService API key](https://openrouteservice.org/).

```powershell
npm ci --ignore-scripts
Copy-Item .env.example .env
```

Only copy the example if `.env` does not already exist; preserve existing settings and storage paths. Open `.env` privately and set `ORS_API_KEY` to your key. Then:

```powershell
npm run build
npm start
```

Open **http://localhost:3000**. For rebuild/watch development, use `npm run dev`. On POSIX shells, use `cp .env.example .env` for the copy step.

### Configuration

| Variable | Local example / purpose |
| --- | --- |
| `ORS_API_KEY` | Required server-only directions key; never sent to the browser |
| `ORS_URL` | Trusted directions base URL, default `https://api.openrouteservice.org/v2/directions` |
| `PHOTON_URL` | Geocoding endpoint, default `https://photon.komoot.io/api/` |
| `PORT`, `HOST` | `3000`, `127.0.0.1` locally |
| `STORE` | `sqlite` locally; `dynamodb` in Lambda |
| `DATA_DIR` | `.data/api-seeded` in the example; keep stable to retain local reports/photos/session secret |
| `SEED_MODE` | `true` for labelled demo observations; `false` for community-only visibility/routing |
| `DEMO_MODE` | `false` normally; explicitly enables labelled seed-reset controls when true |
| `SESSION_SECRET` | Shared stable signing secret required in AWS (32+ characters); generated/persisted locally if absent |
| `TABLE_NAME`, `PHOTO_BUCKET`, `AWS_REGION` | AWS storage configuration populated by the SAM template/runtime |

`.env`, `.data`, generated builds, credentials and machine-specific configuration are excluded from Git. Local SQLite records are not automatically migrated to AWS.

### Demo data is not live incident data

Seed mode initializes **500 irregular hotspots with 6,505 simulated cases**, varying from 6–20 cases per hotspot; 150 hotspots are in Gurugram. Every case coordinate was returned by OpenRouteService's road-snapping API (driving-car graph dated 21 September 2026), rather than created by off-road coordinate offsets. Counts, depths and freshness are simulated—not actual incident evidence. After a route is selected, the map shows nearby case-density hotspots; hover/focus shows the count, and **View cases** reveals individual road-positioned pins. Zoomed-out aggregation prevents marker overlap. Higher intensity means more cases, not greater flood depth or guaranteed risk. A one-time seed-version upgrade replaces old offset seeds while preserving community records and matching new-catalogue votes/freshness. See [provenance and upgrade behavior](docs/ENGINEERING.md#seed-data-and-provenance).

### Judge-demo journeys

The map is **hotspot-free until a route is ready**. It then shows only hotspots whose centre or an active case lies within **750 m of the selected route**. Switching route cards updates this corridor; editing/clearing the trip hides hotspots again. Full hotspot counts are preserved for intensity and drill-down. This display filter does not remove reports or limit routing risk evaluation.

The planner starts with **empty A/B fields and the full NCR map**; it makes no automatic directions request. Above search, choose **Journey 1–10**: seven direct trips, two trips with one intermediate stop, and one trip with two stops. Selecting a journey fills editable locations and requests real API routes using the car profile, a 2× detour allowance and fixed stop order. Complete a manual trip to route automatically, or use the compare button to retry. Choosing **Plan your own trip** clears the fields and returns to NCR.

The map smoothly pans/zooms to fit both candidate routes and all stops, with cancellable animation and reduced-motion support. Avoidance requests include risky reports within 2 km of baseline routes; every candidate is still scored against all reports, including outside that corridor. Seeds must be enabled to demonstrate simulated hotspots; routes remain live and depend on credentials, quota, current reports and provider availability. See the [journey catalogue and demo checklist](docs/ENGINEERING.md#judge-demo-journeys).

## Architecture

### Application responsibilities

```mermaid
flowchart TB
  Web[apps/web: map, trip editor, reports] --> HTTP[apps/api: HTTP or Lambda adapter]
  Web --> Tiles[Online OSM tiles]
  HTTP --> Service[Report application service]
  HTTP --> Search[Photon search adapter]
  Service --> Planner[ORS adapter and candidate ranking]
  Planner --> ORS[OpenRouteService directions]
  Planner --> Geometry[packages/routing: proximity geometry]
  Service --> Store[packages/data: Store interface]
  Store --> Local[SQLite: local hosting]
  Store --> Cloud[DynamoDB and private S3: AWS]
  Domain[packages/domain: contracts, validation, safety policy] -. shared .-> Web
  Domain -. shared .-> Service
  UI[packages/ui: icons and escaping] --> Web
```

The API boundary validates untrusted requests. A reusable service coordinates reports and revisioned writes; storage adapters implement the same interface. Hosted-routing and geocoding transports are injectable for isolated tests. Shared domain types prevent client/server contract drift, while runtime validation protects the network boundary.

### Route request lifecycle

```mermaid
sequenceDiagram
  participant U as Browser
  participant A as API / domain validation
  participant S as Report store
  participant P as Candidate planner
  participant R as OpenRouteService
  U->>A: 2–4 stops, vehicle, detour factor
  A->>S: Read consistent report revision
  A->>P: Validated trip and visible observations
  P->>P: Classify active reports and enumerate 1-2 orders
  P->>R: Fastest baseline for each order
  R-->>P: Provider geometry and travel estimates
  P->>R: Avoidance directions using approximate flood polygons
  R-->>P: Candidate geometry or explicit no-route
  P->>P: Score exposure, enforce detour, deduplicate and rank
  P-->>A: Up to 3 routes, revision, limitations
  A-->>U: Recommendation and fastest baseline
  U->>U: Fit full route geometry on map
```

Credential/quota/timeout/malformed-response failures return actionable errors, never invented routes. Only documented avoidance no-route outcomes permit retaining baseline routes with an explicit warning.

### Report model and writes

```mermaid
classDiagram
  class Snapshot {
    revision: number
    graphVersion: string
    seedVersion: string
    spots: Spot[]
    rateLimits: Record
  }
  class Spot {
    id: string
    coords: latitude_longitude
    depth: 1_to_4
    source: seeded_or_community
    lastConfirmedAt: timestamp
    confirms: number
    dismisses: number
    cleared: boolean
    votes: Record
    photoId: optional_string
  }
  class Store {
    read()
    compareAndSwap(previousRevision, next)
    putPhoto(id, photo)
    getPhoto(id)
  }
  Snapshot "1" --> "0..10000" Spot
  Store --> Snapshot
  SqliteStore ..|> Store
  DynamoStore ..|> Store
```

Updates use optimistic revision checks and up to five retries to avoid silently losing simultaneous edits. A signed opaque session provides an anonymous actor identity; it is not account authentication or a strong defense against identity farming.

## AWS integration

[infra/template.json](infra/template.json) declares the serverless pilot stack through AWS SAM/CloudFormation. No AWS resources are required for local use.

```mermaid
flowchart LR
  Browser[Browser] --> CDN[CloudFront: HTTPS and security headers]
  CDN -->|Web assets via OAC| WebBucket[Private S3 web bucket]
  CDN -->|/api/* with caching disabled| API[API Gateway HTTP API]
  API --> Lambda[Node.js 24 ARM64 Lambda]
  Lambda --> Table[DynamoDB: conditional snapshot writes]
  Lambda --> Photos[Private S3 photos]
  Lambda --> ORS[ORS directions API]
  Lambda --> Photon[Photon API]
  Lambda --> Logs[CloudWatch: 14-day logs]
  Role[IAM execution role] -. scoped access .-> Lambda
```

| AWS service | How this project uses it |
| --- | --- |
| CloudFront | Same-origin website/API access, web caching, API cache TTLs zero, HTTPS and response security headers |
| S3 web bucket | Compiled `dist/web` assets; private origin access control, no public website bucket |
| API Gateway | HTTP API `$default` stage; `ANY /api/{proxy+}` to Lambda, rate/burst throttling |
| Lambda | Shared application through `apps/api/src/lambda.ts`; configurable memory (default 2,048 MB), 25 s timeout, optional reserved concurrency |
| DynamoDB | On-demand encrypted table, consistent reads and conditional writes; PITR and retention policies |
| S3 photo bucket | Server-mediated JPEG/PNG storage under `photos/`; private, encrypted, 30-day expiration |
| IAM | Function-scoped DynamoDB item access, photo-prefix object access and logging permissions |
| CloudWatch / SNS | 14-day Lambda logs, errors/throttles/duration alarms and email subscription |
| AWS Budgets | Account-wide monthly cost budget and email warnings, not a spending cap |
| Secrets Manager | Deployment script creates/reuses a tagged runtime secret with version-pinned references |

AWS runtime credentials come from the Lambda execution role. The storage adapter signs requests with AWS Signature V4 and does not ship AWS credentials to the browser. The deployment script passes version-pinned Secrets Manager references through `NoEcho` parameters into Lambda environment variables. The managed secret exists outside the application stack and is retained independently; custom-domain certificates are not provisioned.

The automated release targets **Northern Virginia (`us-east-1`)**: checks and SAM deployment, then private web uploads, CloudFront invalidation and public smoke checks. The template outputs `WebsiteUrl`, `WebBucketName`, `DistributionId` and `ApiUrl`. Install AWS CLI v2/SAM and configure an approved AWS profile first, then:

```powershell
if (-not (Test-Path -LiteralPath .env.deploy)) {
  Copy-Item -LiteralPath .env.deploy.example -Destination .env.deploy
}
# Fill account ID, profile, alert email and ORS key privately.
# Set DEPLOY_APPROVED=true after reviewing costs and permissions.
npm run deploy:aws -- --plan
npm run deploy:aws
```

The [complete deployment guide](docs/DEPLOYMENT.md) is tracked; `.env.deploy` and generated `.deploy` files are ignored. Confirm the SNS email subscription and perform browser/mobile acceptance after deployment. Local SQLite data is not migrated automatically.

## Routing and algorithms

The application implements **bounded candidate comparison**, not a local Dijkstra/A* road-network engine:

1. Validate distinct stops; keep origin/destination fixed and compare at most two intermediate orders.
2. Classify active reports by vehicle thresholds and one-hour freshness.
3. Build approximate 60 m half-width polygons for damaging, marginal and stale reports.
4. Request provider baselines and avoidance candidates.
5. Count each observation once if within 85 m of any candidate segment.
6. Keep candidates within `fastestReturnedBaseline × detourFactor`; rank by damaging count, caution count, worst depth, then estimated duration.
7. Deduplicate identical geometry; return the best two candidates plus the baseline if not already represented.

The fastest baseline means fastest **returned** provider baseline, not a proved globally fastest route. `stats.optimal` is always `false`. Exact evaluation of two intermediate orders is not a general traveling-salesperson solver. The algorithm writeup includes a worked example, complexity bounds, data-structure choices and proof boundaries: [ALGORITHMS.md](docs/ALGORITHMS.md).

ORS car access rules approximate scooter/motorbike/auto requests; bus requests use its HGV bus profile without measured dimensions. Travel estimates are not live traffic. Public-hosted avoidance routing is limited to 150 km under the current [provider restrictions](https://openrouteservice.org/restrictions/); increasing the viewport alone cannot enable national flood-aware trips.

## Repository structure

```text
PaaniPath/
├── apps/
│   ├── api/                 Application, sessions, providers, local/Lambda adapters
│   ├── web/                 Map, trip editor, search, reporting, styles, PWA shell
│   └── deploy/              Typed AWS release orchestration, secrets and smoke checks
├── packages/
│   ├── domain/              Types, input validation, safety/freshness policy
│   ├── data/                NCR seeds, Store interface, SQLite/DynamoDB/S3 adapters
│   ├── routing/             Haversine and point-to-segment geometry
│   └── ui/                  Reusable SVG icons and safe HTML helpers
├── tests/                   Domain, provider, storage, map, UI and API tests
├── scripts/                 Portable build, lint, testing and validation tools
├── infra/                   AWS SAM template
├── docs/                    Algorithms, API, Engineering and Deployment (four docs)
├── .github/workflows/       Linux/Windows quality gates
├── .env.example             Blank-key local configuration example
├── .env.deploy.example      Blank private AWS deployment settings template
├── Dockerfile               Non-root local/container hosting
└── package.json             npm workspaces and project commands
```

`dist/`, `node_modules/`, `.data/`, `.env.deploy` and `.deploy/` are intentionally untracked. No obsolete UI/mockup/problem-statement/backend folder is required by the build.

## Quality and verification

```powershell
npm run check
npm run test:http
```

| Command | What it verifies |
| --- | --- |
| `npm run typecheck` | Strict TypeScript, unchecked indexing, optional-property accuracy, unused code checks |
| `npm run lint` | AST rules: no explicit `any`, non-null assertions, type suppressions or debugger; function complexity limit 25 |
| `npm test` | Unit/contract tests with deterministic transports and clocks |
| `npm run build` | Portable ESM compilation, workspace alias resolution, web assets and Lambda artifact |
| `npm run check` | Types, lint, unit tests, build, structural infrastructure and tracked-documentation validation |
| `npm run test:http` | Isolated real local HTTP integration with a temporary SQLite store and mocked ORS transport |
| `npm run test:e2e` | Running-server smoke test; requires configured real routing and consumes provider quota |

GitHub Actions runs automated checks on Linux and Windows using Node 24. Mocks exist in tests, not production routing. Structural AWS checks are not full SAM schema validation or cloud acceptance. No live provider, cloud deployment or browser/device acceptance is inferred from unit tests. See [verification details](docs/ENGINEERING.md#testing-and-quality-gates).

For a deployed smoke test, set `TEST_BASE_URL` to its HTTPS hostname before `npm run test:e2e`. Avoid modifying real incident data during acceptance tests; use staging for report/photo submissions.

## Security, privacy and scale boundaries

- ORS receives stops and avoidance polygons; Photon receives search text; tile requests reveal the viewed map area to the tile service.
- Reports/photos are stored; route histories are not persisted by the application. The 30-second per-process route cache is transient.
- Mutations require JSON and `X-PaaniPath: 1`; signed cookies, validation, bounded payloads and nearby-vote checks reduce accidental misuse but do not replace production authentication/moderation.
- Current report storage is capped at 10,000 observations; gzip/base64 DynamoDB payloads must remain below 350,000 bytes. Legacy uncompressed snapshots remain readable. This single-snapshot pilot must be partitioned for larger deployments.
- Provider calls have deadlines, bounded comparison concurrency and per-process budgets/caches. Multiple Lambda instances require a durable shared quota limiter.
- Point buffers may block parallel roads or bridges; proximity scoring cannot distinguish elevation/road-level topology. Missing reports mean unknown conditions, not dry roads.
- Public tile/geocoding services provide no application SLA. Respect [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) and provision appropriate production services.

## Contributing and release hygiene

Use focused conventional commits such as `feat(api): ...`, `fix(routing): ...`, `test(storage): ...` and `docs(project): ...`. Run both quality commands before proposing changes. Include tests for behavioral changes and update the relevant one of the four docs. Keep unrelated modifications separate; never commit `.env`, reports/photos, private keys, generated builds or account-specific deployment settings.

This repository does not currently declare an open-source license. Do not infer redistribution permission from public hosting; the owner should choose a license deliberately.
