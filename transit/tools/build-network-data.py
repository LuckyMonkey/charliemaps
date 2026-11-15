#!/usr/bin/env python3
"""Build the small, read-only map projection from an official MBTA GTFS zip.

The full archive remains the schedule source. This artifact is only the UI's
canonical network projection: rail lines, route-pattern station order, and
station identity/coordinates. It is regenerated when the baked feed changes.
"""

import csv
import io
import json
import zipfile
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = Path(__import__("sys").argv[1])
OUT = ROOT / "web" / "public" / "data" / "network.json"


def rows(zf: zipfile.ZipFile, name: str):
    with zf.open(name) as stream:
        return list(csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig")))


with zipfile.ZipFile(ARCHIVE) as zf:
    routes = rows(zf, "routes.txt")
    patterns = rows(zf, "route_patterns.txt")
    trips = rows(zf, "trips.txt")
    stops = rows(zf, "stops.txt")

stop_by_id = {s["stop_id"]: s for s in stops}
parent_name = {s["stop_id"]: s["stop_name"] for s in stops if s.get("location_type") == "1"}
def mode_for(route):
    route_type = route.get("route_type")
    network_id = route.get("network_id")
    if route_type in {"0", "1"} and network_id in {"rapid_transit", "m_rapid_transit"}:
        return "mattapan" if route["route_id"] == "Mattapan" else "rapid-transit"
    if route_type == "2":
        return "commuter-rail"
    if route_type == "3" and route.get("route_id") != "rail_replacement_bus":
        return "bus"
    if route_type == "4":
        return "ferry"
    return None


eligible_routes = [r for r in routes if mode_for(r)]
route_by_id = {r["route_id"]: r for r in eligible_routes}

patterns_by_route = defaultdict(list)
for p in patterns:
    if p.get("route_id") in route_by_id and p.get("canonical_route_pattern") == "1" and p.get("direction_id") == "0":
        patterns_by_route[p["route_id"]].append(p)

# Select the exact representative trips before touching stop_times. The full MBTA
# archive has millions of calls; the map only needs one trip for each visible pattern.
selected_patterns_by_route = {}
representative_trip_ids = set()
for route in eligible_routes:
    candidates = sorted(patterns_by_route[route["route_id"]], key=lambda p: int(p.get("route_pattern_sort_order") or 0))
    selected = candidates if mode_for(route) in {"rapid-transit", "mattapan", "commuter-rail"} else candidates[:1]
    selected_patterns_by_route[route["route_id"]] = selected
    representative_trip_ids.update(p.get("representative_trip_id", "") for p in selected)

trip_stops = defaultdict(list)
with zipfile.ZipFile(ARCHIVE) as zf:
    with zf.open("stop_times.txt") as stream:
        for call in csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig")):
            if call.get("trip_id") in representative_trip_ids:
                trip_stops[call["trip_id"]].append(call)
for calls in trip_stops.values():
    calls.sort(key=lambda c: int(c.get("stop_sequence") or 0))

result_routes = []
all_stations = {}
for route in sorted(eligible_routes, key=lambda r: (mode_for(r), int(r.get("route_sort_order") or 0), r["route_id"])):
    candidates = selected_patterns_by_route[route["route_id"]]
    if not candidates:
        continue
    # Rail patterns are meaningful branches (Red: Braintree and Ashmont; Green: B/C/D/E).
    # Bus and ferry routes stay compact: one canonical pattern is enough until a route is opened.
    for pattern in candidates:
        calls = trip_stops.get(pattern.get("representative_trip_id", ""), [])
        seen = set()
        stations = []
        for call in calls:
            stop = stop_by_id.get(call.get("stop_id"))
            if not stop:
                continue
            station_id = stop.get("parent_station") or stop["stop_id"]
            station = stop_by_id.get(station_id, stop)
            if station_id in seen:
                continue
            seen.add(station_id)
            name = parent_name.get(station_id, station.get("stop_name", ""))
            item = {
                "id": station_id,
                "name": name,
                "lat": float(station["stop_lat"]),
                "lon": float(station["stop_lon"]),
                "accessible": station.get("wheelchair_boarding") in {"1", "2"},
            }
            stations.append(item)
            all_stations[station_id] = item
        if len(stations) >= 2:
            mode = mode_for(route)
            pattern_id = pattern.get("route_pattern_id") or pattern.get("route_pattern_name") or "default"
            result_routes.append({
                "id": f'{route["route_id"]}:{pattern_id}',
                "routeId": route["route_id"],
                "name": route.get("route_long_name") or route["route_id"],
                "shortName": route.get("route_short_name", ""),
                "groupId": route.get("network_id") or mode,
                "color": "#" + route.get("route_color", "616161"),
                "textColor": "#" + route.get("route_text_color", "FFFFFF"),
                "mode": mode,
                "pattern": pattern.get("route_pattern_name", ""),
                "stations": stations,
            })

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({
    "source": "MBTA_GTFS.zip",
    "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    "routes": result_routes,
    "stations": list(all_stations.values()),
}, indent=2) + "\n")
print(f"wrote {OUT}: {len(result_routes)} routes, {len(all_stations)} stations")
