# TERMINAL AI HANDOFF — Charlie Maps transit

Read in order: `transit/README.md`, `transit/docs/ARCHITECTURE.md`, `transit/graph/schema.cypher`, existing root `README.md`, then inspect Fridge's actual Docker networks and `fridge-gis/compose.yml`. **Do not confuse this with WingMaps.**

Project and branch: `LuckyMonkey/charliemaps`, branch `feat/transit-neo4j`. This repo's **master** contains the older Leaflet/PostGIS neighborhood map. DO NOT alter/delete it or migrate its data. All new work is under `transit/`.

## Non-negotiables
- Call it **Charlie Maps**, not Fridge Transit or WingMaps.
- Neo4j is the only database: no SQLite/PostgreSQL/PostGIS/MongoDB/Redis for this transit app.
- Every GTFS object, vehicle, run, stop-time, forecast, alert, transfer and schedule is an identifiable node/edge.
- All lines, every bus and every Commuter Rail branch, including commuter purple, in the graph import. Don't prototype only Blue Line at persistence layer.
- One shared collector and timetable-first UI; no browser fanout to MBTA.
- No guessed live position/ETA. Label mock UI clearly until data engine and planner are ready.
- Separate volume and Neo4j instance from WingMaps/Body Atlas.
- Follow Fridge current HIG and production Caddy patterns when later integrating, but obtain an explicit deployment review first.
- Keep credentials out of git, don't auto-push deploy and don't mutate running infrastructure without approval.

## First sprint checklist
1. Run `docker compose -f transit/compose.yml config` (after env set). Start local stack. Confirm DB health and React demo.
2. Inspect/create Neo4j constraints from schema (idempotently). Avoid wiping the database.
3. Implement full GTFS static importer with feed versioning and batched transactional `UNWIND`: agency, lines, routes, stops, stop hierarchy, calendars, calendar exceptions, trips, stop_times, shapes, transfer/pathway, route patterns. Test actual MBTA CSV edge cases; preserve GTFS route types and Purple.
4. Add strict coverage test for buses, subway, Green branches, Mattapan and each Commuter Rail route, and missing foreign-key/parent relations.
5. Connect `/api/network` to graph projections, keeping clear demo/data-empty state.
6. Add central GTFS-RT collector and source timestamps; only mark live when fresh. Do not write static GTFS times from RT.
7. Add itinerary engine and tooltip ETA after schedule import actually works.
8. Make the zoom-to-line → station expansion interaction accessible and smooth; reduce SVG nodes in zoomed-out mode.

## Acceptance conditions
- Read-only or feature-branch changes to legacy files; base master works as before.
- No SQLite or SQL store in `transit/`.
- `GET /api/health` distinguishes DB down vs ready; no fake success.
- All MBTA routes represented in Neo4j, including purple routes and buses; import checksum + counts.
- A stale or unavailable realtime feed never renders fabricated LIVE badge.
- Browser geolocation off until opt-in; location not stored.
- Basic desktop, mobile, keyboard, 5-foot mode and reduced-motion checks pass.
- Build/typecheck passes; Caddy remains unchanged.

## Original legacy tracker
`LuckyMonkey/fridgeMbtaTracker` has reusable MBTA client logic and prediction-cache ideas, but its pinned-stop polling and old Traefik/Mongo architecture MUST NOT be transplanted unchanged. Treat it as reference.

When finishing, report files changed, demo vs real coverage, tests run, precise remaining blockers, and next small action.
