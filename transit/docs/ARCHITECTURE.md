# Graph-native architecture and UI contract

## Doctrine

1. **Every first-class transit thing is a Neo4j node**, with canonical IDs and typed relationships. Keep source data/provenance on each object. No SQL database is part of this application.
2. Train is not Trip: `Route` = marketed service, `Trip` = timetable template, `ServiceRun` = dated instance, `Vehicle` = physical carriage/consist/bus, `VehicleObservation` = measurement. Never conflate.
3. `StopTime` = a scheduled call for a trip at a platform/stop. Predicted call = `Prediction` node joined to the dated run and call. Do not mutate scheduled time when a prediction changes.
4. `Stop` includes stations, child boarding platforms, entrance/egress nodes. Preserve GTFS `parent_station`, `location_type`, `level_id`, `pathways.txt`, `transfers.txt`, `lines.txt`, `route_patterns` where available.
5. Store schedule snapshots with version + import time; import into staged batch in chunks; validate counts/uniqueness/cross-refs, only then advance a single active pointer. Don't delete a known-good snapshot until replacement passes checks.
6. Realtime collector fetches bulk GTFS-RT enhanced JSON server-side with sane frequency, ETag/Last-Modified where supported, exponential backoff + jitter and one writer; no fanout of MBTA calls per browser. Batch MERGE/updates in bounded transactions; expire stale runs/observations by policy while preserving useful history.
7. Each public number specifies source and as-of timestamp: `live`, `scheduled`, `estimated`, `disrupted`, `unavailable`. Missing GPS is not a cancellation; stale realtime is not live.
8. Routing needs service calendar, direction, run dates, transfer walk/accessibility constraints, MBTA modes, and GTFS `HH:MM:SS` past 24. A basic shortestPath query on route graph cannot yield correct ETAs. Neo4j is persistent truth; bounded derived in-memory search indexes allowed for speed.
9. Commuter Rail is a first-class route type (GTFS 2), with all branches, station and platform behavior. Subway, light rail and Mattapan, buses and express buses also included. Do not infer route solely from color.
10. No browser Neo4j credentials and no location telemetry storage by default. Geolocation opt-in on HTTPS/localhost, compute nearest stops locally unless explicit routing request, provide clear location-off state.

## API contract (initial)

- `GET /api/health`: API + graph connectivity status; 503 if Neo4j is unavailable.
- `GET /api/network`: UI-friendly graph projection. Before import, returns `{mode:"uninitialized", lines:[], nodes:[]}`, never fabricated live data.
- `GET /api/events`: SSE endpoint; keepalive/protocol scaffold. Later emits graph-verified `vehicle`, `prediction`, `alert`, `snapshot` deltas.
- `GET /api/lines`, `/api/lines/:id`, `/api/stations/:id`, `/api/vehicles`, `/api/arrivals`, `/api/alerts`: live since 0.2.0 (see README); served from the GTFS projection + the realtime collector until the graph import lands.
- `GET /api/eta?from=...&to=...&departAt=...`: later, time-aware itinerary with uncertainty.
- Browser uses a **local deterministic design dataset** only until imported graph exists, with a conspicuous DEMO indicator.

## Layout

- Whole-network map = real GTFS geometry on canvas (0.2.0; SVG could not pan at 30 fps on Fridge's 2012 laptops), official route colours, Commuter Rail purple, buses yellow, ferries dashed teal. Complexity reduction is level-of-detail (simplification levels, culling, label collision), never deleting routes.
- Select line -> SVG morphs or transitions into vertical linear stop timeline. Selected vehicles move with route shape/position mapping.
- Select stop -> progressive fractal/branch panel displays intersecting routes and bus connections, transit pathways, transfers.
- Hover a destination -> pointer-anchored route ETA tooltip; touch -> tap-based equivalent. If no planner, show `Demo ETA` clearly rather than promise a real ETA.
- Back/Escape/overview button return to previous focus; never hijack scroll in a way that traps long station lists.
- High contrast, white background, 5-foot accessible view, reduced motion, keyboard and screen-reader labeling.
- `geographic` is the render mode now (GTFS shapes). A `schematic` mode can come later. Vehicles are drawn only at their reported GPS position, faded when the feed is stale; never interpolated.

## Performance and operational guardrails

- Shared backend collector, not N browser pollers.
- Graph projections cached by feed version + relevant event watermark. Avoid full node scans in hot routes.
- Streaming small diffs to SVG React state. Do not re-render all stop nodes at each animation frame.
- Bound Neo4j heap/page cache to what Fridge can actually afford; avoid memory-heavy nested traversals; profile Cypher queries.
- No auto-configuring Cloudflare, Caddy, Fridge IAM or production ports in this phase.
- No API keys, passwords, raw location traces, or full GTFS archives committed to GitHub.

## Known upstream references

GTFS static https://cdn.mbta.com/MBTA_GTFS.zip
GTFS RT docs https://github.com/mbta/gtfs-documentation/blob/master/reference/gtfs-realtime.md
MBTA V3 https://api-v3.mbta.com/
Original tracker https://github.com/LuckyMonkey/fridgeMbtaTracker
