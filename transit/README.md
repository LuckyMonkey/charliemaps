# Charlie Maps 🚇

**Boston is Charlie canon.** A schedule-first, graph-native MBTA explorer on Fridge.

> Status (0.2.0, 2026-11-15): the map draws **every** MBTA route on its real track geometry (GTFS
> `shapes.txt`): subway, light rail, Mattapan, Silver Line, all Commuter Rail branches (and the
> CapeFLYER), 146 bus routes, ferries, and all ~6,900 stations and stops, over an OpenStreetMap
> land/water backdrop. Live vehicles, departures and alerts come from the server's one MBTA collector
> (SSE to the browser). Neo4j graph import is still the next milestone; the API serves the GTFS
> projection until then.

## Fridge integration

Charlie Maps is a **Container app** at `/transit/`, using the shared Fridge web
network and the existing `gis-graph` Neo4j runtime. It is intentionally one
dedicated app container; it does not bring up a second Neo4j or web stack. Its
own writable state lives at `/srv/data/charliemaps-transit`, mounted as
`/data`; transit graph objects are namespaced by their graph labels and source
batch identifiers.
The route is protected by Fridge member authentication and registered in the
Go home folders, the Fridge app catalog, and the Go changelog.

## Architecture

- **Neo4j 5 Community is the ONLY persistent transit data store.** No SQLite, Postgres, PostGIS or MongoDB in the transit subproject.
- GTFS static becomes graph objects: Line, Route, Stop, Station, RoutePattern, ServiceCalendar, Trip, StopTime, Shape, Pathway, Transfer, FeedBatch.
- Runtime objects: ServiceRun, Vehicle, Prediction, VehicleObservation, Alert; relations preserve provenance and times.
- API: Node.js 22 + Express + TypeScript + official Neo4j driver.
- UI: React + TypeScript panels over one `<canvas>` map (`web/src/MapView.ts`). The canvas replaced the SVG
  map in 0.2.0: thousands of SVG nodes could not pan at 30 fps on the 2012 laptops. Geometry is the real
  GTFS track, styled like the official MBTA map (route colours, white stations with black rings,
  bigger rings at transfers, CR purple, buses yellow). Pan = drag / arrows; zoom = wheel, pinch, +/-,
  double-click. A raster cache makes a drag one `drawImage`; a sharp redraw follows when the map rests.
  Level of detail: 3 simplification levels, chunked culling, labels placed without overlap.
- Fridge frame: the server renders the house app bar (`Charlie Maps · fridge.run`, user chip, Sign out)
  from Caddy's `X-Fridge-*` headers into `web/index.html` at `<!--fridge-bar-->` (HIG Canvas layout).
- Schedule is authoritative for planned movements; realtime creates timestamped revisions/deltas, never silently overwrites timetable facts.
- Browser sees graph **projections**, not Neo4j credentials. The server polls MBTA realtime feeds once per minute with ETags; browsers never poll MBTA individually.

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

1. **Foundation**: graph schema, schedule-backed canonical rapid-transit projection, minimal interactive SVG, API status, documentation.
2. **Schedule ingestion**: fetch complete `MBTA_GTFS.zip`, parse every route, stop, trip, service, and stop-time, import incrementally with idempotency and snapshot swap. Include all buses, heavy/light rail, Mattapan and Commuter Rail.
3. **Realtime ingestion**: centrally poll the MBTA GTFS-RT enhanced JSON trip updates, vehicle positions and alerts with ETag/timeouts/backoff, preserve source timestamps, compute deltas; monitor freshness. The collector is now present; graph persistence and delta projection remain next.
4. **Routing**: time-dependent earliest-arrival graph algorithms (service calendars, transfers, walking edges, boarding constraints, cross-midnight and DST). Never use naive unweighted shortest path as journey time.
5. **Production UI**: use actual graph projections and live SSE, no demo labels; full schematic/line/station drilldown, ETA-at-pointer and touch equivalent, accessible 5-foot mode.
6. **Fridge integration**: Caddy routing and login are supplied by the Fridge deployment; production data ingestion remains a separate milestone.

## Trips (0.3.0)

Click a line: the map folds into that line's vertical diagram (each station slides from its place on
the map into the straight line). Click a station: **Start here (A)** / **Go here (B)**, or one of the bus
stops next to it. Back on the map, do the same for B. Ctrl+K anywhere: type a station, stop or route;
Enter picks the first result. With A and B set, the plan is computed from the **timetable, now**
(`/api/plan`: Connection Scan over today's service, transfers with 90 s slack, footpaths up to 320 m,
walks from `transfers.txt`). Only after that does the page ask `/api/plan/live` about those exact trips
(delay, cancellation, the replacement vehicle MBTA added, the vehicle's position, alerts).

## Map data (rebuild when the feed changes)

```bash
# 1. the schedule projection: network.json (browser) + server.json (API lookup index)
python3 -I tools/build-network-data.py /path/to/MBTA_GTFS.zip
python3 -I tools/build-schedule.py /path/to/MBTA_GTFS.zip    # the planner's timetable (server only)
# 2. the land/water backdrop (rarely): Overpass queries are in the script's docstring
python3 -I tools/build-basemap.py coast.json water.json
```

Both write to `web/public/data/` and ship in the image. Rail-replacement shuttles are left out
(service alerts announce them).

## API

All JSON, `Cache-Control: no-store`, every realtime answer carries `asOf` (feed timestamp) and `live`
(false when the feed is older than 3 minutes; then no times are shown).

| Route | What |
|---|---|
| `GET /api/health` | API + Neo4j connectivity, schedule feed version, realtime feed states (503 if the graph is down) |
| `GET /api/network` | the full schedule projection (same as `data/network.json`) |
| `GET /api/lines` | every route: id, name, mode, colour, `alert` (highest active severity) |
| `GET /api/lines/:id` | one route: branches with stops in order, active alerts, live vehicles |
| `GET /api/stations/:id` | a station or stop: lines, next departures (MBTA predictions), alerts |
| `GET /api/vehicles[?route=]` | live vehicle positions (revenue service only) |
| `GET /api/arrivals?station=` | next departures at a station |
| `GET /api/alerts[?route=&station=]` | active alerts |
| `GET /api/search?q=` | stations, stops and routes by name or number |
| `GET /api/plan?from=&to=[&at=epoch]` | itineraries from the timetable (schedule only) |
| `GET /api/plan/live?legs=trip\|from\|to\|dep\|arr\|route,...` | realtime check of planned legs: delay, cancelled, replacement, vehicle, alerts |
| `GET /api/geo/{lines,stations,vehicles}.geojson` | GeoJSON for other fridge apps (WingMaps' Charlie Maps plugin) |
| `GET /__search?s=` | the fridge.run search node (go.fridge.run search) |
| `GET /api/events` | SSE: `vehicles` (every fresh snapshot, ~15 s), `alerts`, `predictions` pings |

The collector polls `VehiclePositions` every 15 s, `TripUpdates` every 30 s and `Alerts` every 60 s,
with ETags and exponential backoff; browsers never call MBTA.

## Source links

- Static GTFS: https://cdn.mbta.com/MBTA_GTFS.zip
- Enhanced RT: https://cdn.mbta.com/realtime/{TripUpdates,VehiclePositions,Alerts}_enhanced.json
- GTFS implementation: https://github.com/mbta/gtfs-documentation
- V3 API: https://api-v3.mbta.com/
- Original Suffolk Downs tracker: https://github.com/LuckyMonkey/fridgeMbtaTracker (archived, read-only reference)

MassDOT/MBTA data attribution and developer-license compliance are required for any published product.

The production deployment keeps the schedule projection read-only. The official
GTFS archive is stored in the dedicated data volume at `gtfs/MBTA_GTFS.zip` and
the browser consumes the generated `web/public/data/network.json` projection.
Realtime snapshots are server-side and delta-only; no fabricated vehicles or
ETAs are rendered.
