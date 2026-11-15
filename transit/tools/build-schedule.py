#!/usr/bin/env python3
"""Build Charlie Maps' journey-planner timetable from an official MBTA GTFS zip.

Usage: build-schedule.py MBTA_GTFS.zip [out_dir]   (default out_dir: ../web/public/data)

Writes schedule.json, read only by the API (never sent to browsers whole). It keeps every trip of
every service in the feed, including rail-replacement shuttles (they are real service on the day),
at station level (child platforms fold into their parent station):

  stations   [[id, name, x, y, lat, lon], ...]   x/y in the same metre projection as network.json
  routes     {route_id: [name, short, mode, color, text_color]}
  services   {service_id: [weekday bits "1111100", start, end, [added dates], [removed dates]]}
  patterns   [[station index, ...], ...]          distinct stop sequences
  trips      columns: id, route, service, pattern, headsign, start (s after midnight, may pass 24 h)
  times      per trip: departure offsets from the trip start, delta-encoded, flat (tripTimesAt[i])
  walks      [[station a, station b, seconds], ...] footpaths: transfers.txt walks + anything <= 320 m
"""

import csv
import io
import json
import math
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ARCHIVE = Path(sys.argv[1])
OUT_DIR = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / "web" / "public" / "data"
LAT0, LON0 = 42.3555, -71.0605
KX = 111_320.0 * math.cos(math.radians(LAT0))
KY = 110_574.0
WALK_MPS = 1.2        # walking speed
WALK_DETOUR = 1.3     # streets are not straight lines
WALK_MAX_M = 320


def rows(zf, name):
    with zf.open(name) as stream:
        yield from csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig"))


def secs(t):
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def mode_for(r):
    rt, net = r.get("route_type"), r.get("network_id", "")
    if net == "rail_replacement_bus":
        return "shuttle"
    if r["route_id"] == "Mattapan":
        return "mattapan"
    if rt in {"0", "1"}:
        return "subway"
    if net == "sl_rapid_transit" or r.get("line_id", "").startswith("line-SL"):
        return "silver"
    return {"2": "rail", "3": "bus", "4": "ferry"}.get(rt, "other")


with zipfile.ZipFile(ARCHIVE) as zf:
    stops = {s["stop_id"]: s for s in rows(zf, "stops.txt")}
    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    services = {}
    for c in rows(zf, "calendar.txt"):
        days = "".join(c[d] for d in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"))
        services[c["service_id"]] = [days, c["start_date"], c["end_date"], [], []]
    for d in rows(zf, "calendar_dates.txt"):
        svc = services.setdefault(d["service_id"], ["0000000", d["date"], d["date"], [], []])
        svc[3 if d["exception_type"] == "1" else 4].append(d["date"])
    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt")}
    calls = defaultdict(list)
    for c in rows(zf, "stop_times.txt"):
        dep = c.get("departure_time") or c.get("arrival_time")
        if not dep:
            continue
        calls[c["trip_id"]].append((int(c["stop_sequence"]), c["stop_id"], secs(dep)))
    transfers = list(rows(zf, "transfers.txt"))

station_ids, station_idx = [], {}


def station(stop_id):
    s = stops.get(stop_id)
    if not s:
        return None
    sid = s.get("parent_station") or stop_id
    if sid not in station_idx:
        station_idx[sid] = len(station_ids)
        station_ids.append(sid)
    return station_idx[sid]


pattern_idx, patterns = {}, []
headsigns, headsign_idx = [], {}
cols = {k: [] for k in ("id", "route", "service", "pattern", "headsign", "start")}
times = []
used_routes = set()
for tid, t in trips.items():
    seq = sorted(calls.get(tid, []))
    if len(seq) < 2 or t["route_id"] not in routes:
        continue
    st, tm = [], []
    for _, stop_id, dep in seq:
        i = station(stop_id)
        if i is None:
            continue
        if st and st[-1] == i:      # two platforms of one station in a row
            continue
        st.append(i)
        tm.append(dep)
    if len(st) < 2:
        continue
    key = tuple(st)
    if key not in pattern_idx:
        pattern_idx[key] = len(patterns)
        patterns.append(st)
    hs = t.get("trip_headsign", "")
    if hs not in headsign_idx:
        headsign_idx[hs] = len(headsigns)
        headsigns.append(hs)
    cols["id"].append(tid)
    cols["route"].append(t["route_id"])
    cols["service"].append(t["service_id"])
    cols["pattern"].append(pattern_idx[key])
    cols["headsign"].append(headsign_idx[hs])
    cols["start"].append(tm[0])
    prev = tm[0]
    for x in tm[1:]:
        times.append(max(0, x - prev))
        prev = max(prev, x)
    used_routes.add(t["route_id"])


def xy(s):
    lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
    return round((lon - LON0) * KX), round((LAT0 - lat) * KY), lat, lon


out_stations = []
for sid in station_ids:
    s = stops[sid]
    x, y, lat, lon = xy(s)
    out_stations.append([sid, s["stop_name"], x, y, lat, lon])

# Footpaths: GTFS transfers that walk between two stations, plus anything close by.
walks = {}
for tr in transfers:
    a, b = station(tr["from_stop_id"]), station(tr["to_stop_id"])
    if a is None or b is None or a == b or tr["transfer_type"] == "3":
        continue
    t = tr.get("min_walk_time") or tr.get("min_transfer_time")
    if t:
        walks[(a, b)] = min(walks.get((a, b), 10**9), int(t))
grid = defaultdict(list)
CELL = WALK_MAX_M
for i, s in enumerate(out_stations):
    grid[(s[2] // CELL, s[3] // CELL)].append(i)
for i, s in enumerate(out_stations):
    gx, gy = s[2] // CELL, s[3] // CELL
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for j in grid.get((gx + dx, gy + dy), []):
                if j == i:
                    continue
                d = math.hypot(out_stations[j][2] - s[2], out_stations[j][3] - s[3])
                if d <= WALK_MAX_M:
                    t = round(d * WALK_DETOUR / WALK_MPS) + 30
                    if (i, j) not in walks:
                        walks[(i, j)] = t

out_routes = {}
for rid in sorted(used_routes):
    r = routes[rid]
    out_routes[rid] = [r.get("route_long_name") or rid, r.get("route_short_name", ""), mode_for(r),
                       "#" + (r.get("route_color") or "7C878E"), "#" + (r.get("route_text_color") or "FFFFFF")]

out = {
    "version": 1,
    "projection": {"lat0": LAT0, "lon0": LON0, "kx": KX, "ky": KY},
    "stations": out_stations,
    "routes": out_routes,
    "services": services,
    "patterns": patterns,
    "headsigns": headsigns,
    "trips": cols,
    "times": times,
    "walks": [[a, b, t] for (a, b), t in walks.items()],
}
OUT_DIR.mkdir(parents=True, exist_ok=True)
(OUT_DIR / "schedule.json").write_text(json.dumps(out, separators=(",", ":")) + "\n")
print(f"schedule.json: {len(cols['id'])} trips, {len(patterns)} patterns, {len(out_stations)} stations, "
      f"{len(walks)} footpaths, {len(times)} times, {(OUT_DIR / 'schedule.json').stat().st_size // 1024} KiB")
