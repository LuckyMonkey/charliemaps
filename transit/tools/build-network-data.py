#!/usr/bin/env python3
"""Build Charlie Maps' read-only map projection from an official MBTA GTFS zip.

Usage: build-network-data.py MBTA_GTFS.zip [out_dir]

Writes two files (default out_dir: ../web/public/data):
  network.json  the browser's map: every route (subway, light rail, Mattapan, Silver Line,
                Commuter Rail, bus, ferry), each typical route pattern with its real GTFS shape,
                and every station / stop those patterns call at.
  server.json   what the API needs to read the realtime feeds: child stop -> station,
                route pattern -> headsign, route+direction -> destination.

Geometry is the canonical source: GTFS shapes.txt, projected to metres around downtown
Boston (equirectangular, fine at this scale), simplified (Douglas-Peucker) and
delta-encoded as integers. Nothing is invented: a pattern with no shape falls back to
straight lines between its stops and is flagged `approx`.
Rail-replacement shuttles are left out (they come and go with diversions).
"""

import csv
import io
import json
import math
import sys
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ARCHIVE = Path(sys.argv[1])
OUT_DIR = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / "web" / "public" / "data"

LAT0, LON0 = 42.3555, -71.0605  # Downtown Crossing-ish: the map's origin
KX = 111_320.0 * math.cos(math.radians(LAT0))
KY = 110_574.0


def xy(lat: float, lon: float):
    return (lon - LON0) * KX, (LAT0 - lat) * KY  # y grows southwards, like the screen


def rows(zf: zipfile.ZipFile, name: str):
    with zf.open(name) as stream:
        yield from csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig"))


def mode_for(route):
    rt, net, rid = route.get("route_type"), route.get("network_id", ""), route["route_id"]
    if net == "rail_replacement_bus":
        return None
    if rid == "Mattapan":
        return "mattapan"
    if rt in {"0", "1"}:
        return "subway"
    if net == "sl_rapid_transit" or route.get("line_id", "").startswith("line-SL"):
        return "silver"  # SL1-3 + SLW, and SL4/SL5 (Washington St), by their Silver Line line_id
    if rt == "2":
        return "rail"
    if rt == "3":
        return "bus"
    if rt == "4":
        return "ferry"
    return None


def simplify(points, tol):
    """Iterative Douglas-Peucker."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    tol2 = tol * tol
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        den = dx * dx + dy * dy
        worst, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            if den == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / den))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > worst:
                worst, idx = d, i
        if worst > tol2:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(points, keep) if k]


def encode(points):
    out, px, py = [], 0, 0
    for x, y in points:
        ix, iy = round(x), round(y)
        out += [ix - px, iy - py]
        px, py = ix, iy
    return out


TOL = {"subway": 3, "mattapan": 3, "silver": 4, "rail": 8, "bus": 5, "ferry": 12}

with zipfile.ZipFile(ARCHIVE) as zf:
    feed = next(rows(zf, "feed_info.txt"), {})
    routes = [r for r in rows(zf, "routes.txt") if mode_for(r)]
    route_by_id = {r["route_id"]: r for r in routes}
    lines = {l["line_id"]: l for l in rows(zf, "lines.txt")}
    stops = {s["stop_id"]: s for s in rows(zf, "stops.txt")}
    directions = {(d["route_id"], d["direction_id"]): d for d in rows(zf, "directions.txt")}
    all_patterns = list(rows(zf, "route_patterns.txt"))

    # Patterns drawn: every typical (typicality 1) pattern, both directions, plus each
    # route's canonical patterns (the rail branches). Atypical patterns (short turns,
    # school trips) are not drawn but their stops still count for the station index.
    drawn, extra = [], []
    for p in all_patterns:
        if p["route_id"] not in route_by_id:
            continue
        if p.get("route_pattern_typicality") == "1" or p.get("canonical_route_pattern") == "1":
            drawn.append(p)
        else:
            extra.append(p)
    # A route with no typical pattern (e.g. a hospital shuttle) still gets its most typical one.
    have = {p["route_id"] for p in drawn}
    for p in sorted(extra, key=lambda p: (p.get("route_pattern_typicality") or "9", int(p.get("route_pattern_sort_order") or 0))):
        if p["route_id"] not in have:
            drawn.append(p)
            have.add(p["route_id"])
    extra = [p for p in extra if p not in drawn]
    rep_trips = {p["representative_trip_id"] for p in drawn + extra}

    trip_info = {}
    pattern_headsign = {}
    for t in rows(zf, "trips.txt"):
        if t["trip_id"] in rep_trips:
            trip_info[t["trip_id"]] = t
        pid = t.get("route_pattern_id")
        if pid and pid not in pattern_headsign and t.get("trip_headsign"):
            pattern_headsign[pid] = t["trip_headsign"]

    shape_ids = {t["shape_id"] for t in trip_info.values() if t.get("shape_id")}
    shapes = defaultdict(list)
    for s in rows(zf, "shapes.txt"):
        if s["shape_id"] in shape_ids:
            shapes[s["shape_id"]].append((int(s["shape_pt_sequence"]), float(s["shape_pt_lat"]), float(s["shape_pt_lon"])))

    calls = defaultdict(list)
    for c in rows(zf, "stop_times.txt"):
        if c["trip_id"] in rep_trips:
            calls[c["trip_id"]].append((int(c["stop_sequence"]), c["stop_id"]))

# ---- stations -----------------------------------------------------------------------------
def station_of(stop_id):
    s = stops.get(stop_id)
    if not s:
        return None
    return s.get("parent_station") or stop_id


station_index = {}
stations = []


def station_idx(sid):
    if sid in station_index:
        return station_index[sid]
    s = stops[sid]
    x, y = xy(float(s["stop_lat"]), float(s["stop_lon"]))
    station_index[sid] = len(stations)
    stations.append({
        "id": sid,
        "name": s["stop_name"],
        "x": round(x), "y": round(y),
        "muni": s.get("municipality", ""),
        "acc": s.get("wheelchair_boarding") == "1",
        "parent": s.get("location_type") == "1",
        "lines": [],
    })
    return station_index[sid]


# ---- lines and patterns ---------------------------------------------------------------------
MODE_ORDER = {"subway": 0, "mattapan": 1, "silver": 2, "rail": 3, "ferry": 4, "bus": 5}
patterns_by_route = defaultdict(list)
for p in drawn:
    patterns_by_route[p["route_id"]].append(p)

out_lines = []
approx = 0
for r in sorted(routes, key=lambda r: (MODE_ORDER[mode_for(r)], int(r.get("route_sort_order") or 0), r["route_id"])):
    mode = mode_for(r)
    pats = sorted(patterns_by_route.get(r["route_id"], []),
                  key=lambda p: (p["direction_id"], int(p.get("route_pattern_sort_order") or 0)))
    if not pats:
        continue
    li = len(out_lines)
    out_pats, seen_shapes = [], set()
    for p in pats:
        trip = trip_info.get(p["representative_trip_id"])
        seq = [sid for _, sid in sorted(calls.get(p["representative_trip_id"], []))]
        st = []
        for sid in seq:
            parent = station_of(sid)
            if parent and parent in stops:
                i = station_idx(parent)
                if not st or st[-1] != i:
                    st.append(i)
                if li not in stations[i]["lines"]:
                    stations[i]["lines"].append(li)
        if len(st) < 2:
            continue
        shape_id = trip.get("shape_id") if trip else ""
        pts = [xy(lat, lon) for _, lat, lon in sorted(shapes.get(shape_id, []))]
        is_approx = len(pts) < 2
        if is_approx:
            approx += 1
            pts = [(stations[i]["x"], stations[i]["y"]) for i in st]
        # Opposite-direction patterns usually share their track; draw a shape once.
        key = shape_id or ",".join(map(str, st))
        geom = None if key in seen_shapes else encode(simplify(pts, TOL[mode]))
        seen_shapes.add(key)
        d = directions.get((r["route_id"], p["direction_id"]), {})
        out_pats.append({
            "id": p["route_pattern_id"],
            "name": p["route_pattern_name"],
            "dir": int(p["direction_id"]),
            "to": pattern_headsign.get(p["route_pattern_id"]) or d.get("direction_destination", ""),
            "typical": p.get("route_pattern_typicality") == "1",
            "stops": st,
            **({"shape": geom} if geom else {}),
            **({"approx": True} if is_approx else {}),
        })
    if not out_pats:
        continue
    line = lines.get(r.get("line_id", ""), {})
    out_lines.append({
        "id": r["route_id"],
        "name": r.get("route_long_name") or r["route_id"],
        "short": r.get("route_short_name", ""),
        "desc": r.get("route_desc", ""),
        "mode": mode,
        "net": r.get("network_id", ""),
        "frequent": r.get("route_desc") == "Frequent Bus",
        "group": r.get("line_id", ""),
        "groupName": line.get("line_long_name", ""),
        "color": "#" + (r.get("route_color") or "7C878E"),
        "text": "#" + (r.get("route_text_color") or "FFFFFF"),
        "dirs": [directions.get((r["route_id"], d), {}).get("direction", "") + " · " +
                 directions.get((r["route_id"], d), {}).get("direction_destination", "") for d in ("0", "1")],
        "patterns": out_pats,
    })

# Stops served only by atypical patterns (short turns, school trips) are stations too.
line_of = {l["id"]: i for i, l in enumerate(out_lines)}
for p in extra:
    li = line_of.get(p["route_id"])
    if li is None:
        continue
    for _, sid in sorted(calls.get(p["representative_trip_id"], [])):
        parent = station_of(sid)
        if parent and parent in stops:
            i = station_idx(parent)
            if li not in stations[i]["lines"]:
                stations[i]["lines"].append(li)

# Every station knows the modes that call there (for level-of-detail drawing).
for s in stations:
    s["modes"] = sorted({out_lines[i]["mode"] for i in s["lines"]}, key=MODE_ORDER.get)

xs = [s["x"] for s in stations]
ys = [s["y"] for s in stations]
generated = datetime.now(timezone.utc).isoformat(timespec="seconds")
network = {
    "version": 2,
    "source": "MBTA_GTFS.zip",
    "feed": {"publisher": feed.get("feed_publisher_name", ""), "version": feed.get("feed_version", ""),
             "start": feed.get("feed_start_date", ""), "end": feed.get("feed_end_date", "")},
    "generatedAt": generated,
    "projection": {"lat0": LAT0, "lon0": LON0, "kx": KX, "ky": KY, "unit": "m"},
    "bounds": [min(xs), min(ys), max(xs), max(ys)],
    "lines": out_lines,
    "stations": stations,
}

child_to_station = {}
for sid, s in stops.items():
    parent = s.get("parent_station")
    if parent:
        child_to_station[sid] = parent
server = {
    "generatedAt": generated,
    "feed": network["feed"],
    "stopParent": child_to_station,
    "stopName": {sid: s["stop_name"] for sid, s in stops.items() if s.get("location_type") in ("0", "1", "")},
    "platform": {sid: s.get("platform_name") or s.get("platform_code") or "" for sid, s in stops.items()
                 if s.get("parent_station") and (s.get("platform_name") or s.get("platform_code"))},
    "patternHeadsign": pattern_headsign,
    "directionDestination": {f"{k[0]}|{k[1]}": v.get("direction_destination", "") for k, v in directions.items()},
    "routes": {l["id"]: {"name": l["name"], "short": l["short"], "mode": l["mode"], "color": l["color"], "text": l["text"]}
               for l in out_lines},
}

OUT_DIR.mkdir(parents=True, exist_ok=True)
(OUT_DIR / "network.json").write_text(json.dumps(network, separators=(",", ":")) + "\n")
(OUT_DIR / "server.json").write_text(json.dumps(server, separators=(",", ":")) + "\n")
by_mode = defaultdict(int)
for l in out_lines:
    by_mode[l["mode"]] += 1
print(f"network.json: {len(out_lines)} routes {dict(by_mode)}, "
      f"{sum(len(l['patterns']) for l in out_lines)} patterns ({approx} without a shape), {len(stations)} stations/stops")
print(f"size: network {(OUT_DIR / 'network.json').stat().st_size // 1024} KiB, server {(OUT_DIR / 'server.json').stat().st_size // 1024} KiB")
