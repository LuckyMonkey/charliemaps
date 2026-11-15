# Charlie Maps 🚇

**Boston is Charlie canon.** A schedule-first, graph-native MBTA explorer on Fridge.

> Status: isolated transit app on `main`. The existing CharlieMaps PostGIS/photo project in the repository root is preserved unchanged. UI starts in **DEMO** mode; no real timetable import or live vehicle feed is represented as implemented yet.

## Fridge integration

Charlie Maps is a **Container app** at `/transit/`, using the shared Fridge web
network and the existing `gis-graph` Neo4j runtime. It is intentionally one
dedicated app container; it does not bring up a second Neo4j or web stack.
The route is protected by Fridge member authentication and registered in the
Go home folders, the Fridge app catalog, and the Go changelog.

## Architecture

- **Neo4j 5 Community is the ONLY persistent transit data store.** No SQLite, Postgres, PostGIS or MongoDB in the transit subproject.
- GTFS static becomes graph objects: Line, Route, Stop, Station, RoutePattern, ServiceCalendar, Trip, StopTime, Shape, Pathway, Transfer, FeedBatch.
- Runtime objects: ServiceRun, Vehicle, Prediction, VehicleObservation, Alert; relations preserve provenance and times.
- API: Node.js 22 + Express + TypeScript + official Neo4j driver.
- UI: React + TypeScript + SVG; white background, thick subway rails, road-style bus edges, purple Commuter Rail, keyboard and touch controls.
- Schedule is authoritative for planned movements; realtime creates timestamped revisions/deltas, never silently overwrites timetable facts.
- Browser sees graph **projections**, not Neo4j credentials. A shared collector is planned; browsers never poll MBTA individually.

## Local development

```bash
cd transit
cp .env.example .env  # supply a strong NEO4J_PASSWORD, never commit .env
docker compose -f compose.yml up --build
# The compose file expects an existing Neo4j runtime named `gis-graph` and
# an existing Fridge web network. For an isolated local run, provide those
# external networks or use a local Neo4j endpoint in `.env`.
# App/API: http://localhost:4100
```

`/api/health` reports whether the driver can connect; UI's sample graph is intentionally clearly labeled. Initialize indexes/constraints once against the shared Neo4j runtime with an administrator-approved `cypher-shell` session.

## Stages

1. **Foundation** (this branch): safe standalone scaffold, graph schema, responsive interactive SVG *demo*, API status, documentation.
2. **Schedule ingestion**: fetch complete `MBTA_GTFS.zip`, parse every route, stop, trip, service, and stop-time, import incrementally with idempotency and snapshot swap. Include all buses, heavy/light rail, Mattapan and Commuter Rail.
3. **Realtime ingestion**: centrally poll the MBTA GTFS-RT enhanced JSON trip updates, vehicle positions and alerts with ETag/timeouts/backoff, preserve source timestamps, compute deltas; monitor freshness.
4. **Routing**: time-dependent earliest-arrival graph algorithms (service calendars, transfers, walking edges, boarding constraints, cross-midnight and DST). Never use naive unweighted shortest path as journey time.
5. **Production UI**: use actual graph projections and live SSE, no demo labels; full schematic/line/station drilldown, ETA-at-pointer and touch equivalent, accessible 5-foot mode.
6. **Fridge integration**: Caddy routing and login are supplied by the Fridge deployment; production data ingestion remains a separate milestone.

## Source links

- Static GTFS: https://cdn.mbta.com/MBTA_GTFS.zip
- Enhanced RT: https://cdn.mbta.com/realtime/{TripUpdates,VehiclePositions,Alerts}_enhanced.json
- GTFS implementation: https://github.com/mbta/gtfs-documentation
- V3 API: https://api-v3.mbta.com/
- Original Suffolk Downs tracker: https://github.com/LuckyMonkey/fridgeMbtaTracker (archived, read-only reference)

MassDOT/MBTA data attribution and developer-license compliance are required for any published product.

The production deployment is deliberately read-only/demo-first: the API health
endpoint verifies Neo4j connectivity, while the browser labels its sample
network as demo data until GTFS ingestion and routing are shipped.
