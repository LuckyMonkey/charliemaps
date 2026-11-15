#!/usr/bin/env python3
"""Build Charlie Maps' land/water backdrop from OpenStreetMap extracts.

Usage: build-basemap.py coast.json water.json [out_dir]

Inputs are Overpass API JSON (`out geom`), fetched by hand when the backdrop needs a refresh
(it rarely does; coastlines move slowly). The queries used on 2026-11-15:

  coast.json: [out:json][timeout:120];(way["natural"="coastline"](41.55,-71.95,42.95,-70.15););out geom;
  water.json: [out:json][timeout:200];(wr["natural"="water"]["water"~"^(river|reservoir|lake|basin|lagoon|harbour)$"]
              (42.15,-71.35,42.55,-70.85););out geom;

Output: basemap.json with `land` (polygons, even-odd) and `water` (inland water polygons), in
the same metre projection as network.json, simplified and delta-encoded.
OSM data is (c) OpenStreetMap contributors, ODbL: the app credits it on the map.
"""

import json
import math
import sys
from pathlib import Path

COAST, WATER = Path(sys.argv[1]), Path(sys.argv[2])
OUT_DIR = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).resolve().parents[1] / "web" / "public" / "data"

LAT0, LON0 = 42.3555, -71.0605
KX = 111_320.0 * math.cos(math.radians(LAT0))
KY = 110_574.0
# Clip box (lon/lat, y up): a little inside the Overpass query box, so every coastline that
# crosses it was returned whole.
W, S, E, N = -71.94, 41.56, -70.16, 42.94


def simplify(points, tol):
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack, tol2 = [(0, len(points) - 1)], tol * tol
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = points[a], points[b]
        dx, dy = bx - ax, by - ay
        den = dx * dx + dy * dy
        worst, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            t = 0.0 if den == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / den))
            d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > worst:
                worst, idx = d, i
        if worst > tol2:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(points, keep) if k]


def project(ring):
    return [((lon - LON0) * KX, (LAT0 - lat) * KY) for lon, lat in ring]


def encode(points):
    out, px, py = [], 0, 0
    for x, y in points:
        ix, iy = round(x), round(y)
        if out and ix == px and iy == py:
            continue
        out += [ix - px, iy - py]
        px, py = ix, iy
    return out


def area(ring):
    return 0.5 * sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]))


def merge_chains(chains):
    """Join polylines whose ends meet (exact coordinate match, same direction)."""
    chains = [list(c) for c in chains if len(c) >= 2]
    closed = [c for c in chains if c[0] == c[-1]]
    pool = {i: c for i, c in enumerate(chains) if c[0] != c[-1]}
    start = {c[0]: i for i, c in pool.items()}
    for i in list(pool):
        if i not in pool:
            continue
        c = pool[i]
        while True:
            j = start.get(c[-1])
            if j is None or j == i or j not in pool:
                break
            nxt = pool.pop(j)
            del start[nxt[0]]
            c = c + nxt[1:]
        pool[i] = c
        if c[0] == c[-1]:
            closed.append(pool.pop(i))
            del start[c[0]]
    return closed, list(pool.values())


def merge_any_direction(chains):
    """Multipolygon members may be reversed; join by either end."""
    pool = [list(c) for c in chains if len(c) >= 2]
    rings = []
    while pool:
        ring = pool.pop()
        grown = True
        while ring[0] != ring[-1] and grown:
            grown = False
            for i, c in enumerate(pool):
                if c[0] == ring[-1]:
                    ring += c[1:]
                elif c[-1] == ring[-1]:
                    ring += c[-2::-1]
                elif c[-1] == ring[0]:
                    ring = c[:-1] + ring
                elif c[0] == ring[0]:
                    ring = c[:0:-1] + ring
                else:
                    continue
                pool.pop(i)
                grown = True
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


# ---- coastline -> land polygons ----------------------------------------------------------------
def inside(p):
    return W <= p[0] <= E and S <= p[1] <= N


def clip_segment(p, q):
    """Liang-Barsky; returns the clipped segment or None."""
    (x0, y0), (x1, y1) = p, q
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for pk, qk in ((-dx, x0 - W), (dx, E - x0), (-dy, y0 - S), (dy, N - y0)):
        if pk == 0:
            if qk < 0:
                return None
        else:
            t = qk / pk
            if pk < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
    if t0 > t1:
        return None
    a = p if t0 == 0.0 else (x0 + t0 * dx, y0 + t0 * dy)
    b = q if t1 == 1.0 else (x0 + t1 * dx, y0 + t1 * dy)  # exact ends keep runs joined
    return a, b


def clip_chain(chain):
    runs, cur = [], []
    for p, q in zip(chain, chain[1:]):
        seg = clip_segment(p, q)
        if seg is None:
            if cur:
                runs.append(cur)
                cur = []
            continue
        a, b = seg
        if not cur:
            cur = [a]
        elif cur[-1] != a:
            runs.append(cur)
            cur = [a]
        cur.append(b)
        if b != q:  # left the box
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) >= 2]


def perimeter_t(p):
    """Position along the box edge, counter-clockwise from the south-west corner (y up)."""
    x, y = p
    eps = 1e-9
    if abs(y - S) < eps:
        return (x - W) / (E - W)
    if abs(x - E) < eps:
        return 1 + (y - S) / (N - S)
    if abs(y - N) < eps:
        return 2 + (E - x) / (E - W)
    return 3 + (N - y) / (N - S)


CORNERS = [(1, (E, S)), (2, (E, N)), (3, (W, N)), (4, (W, S))]

coast = json.loads(COAST.read_text())["elements"]
coast_chains = [[(g["lon"], g["lat"]) for g in e["geometry"]] for e in coast if e.get("geometry")]
closed, open_chains = merge_chains(coast_chains)

land_rings = []
for ring in closed:
    if all(inside(p) for p in ring):
        land_rings.append(ring)
    else:
        open_chains.append(ring)

runs = []
for chain in open_chains:
    runs += clip_chain(chain)
# Runs fully inside without touching the edge are unclosed coastline (data gaps): drop them.
EPS = 1e-7


def on_edge(p):
    x, y = p
    return abs(x - W) < EPS or abs(x - E) < EPS or abs(y - S) < EPS or abs(y - N) < EPS


edge_runs = [r for r in runs if on_edge(r[0]) and on_edge(r[-1])]
dropped = len(runs) - len(edge_runs)
# Land is on the left of a coastline. Leave a run at its end, walk the box edge counter-clockwise
# (land stays on the left) to the next run's start, follow it, repeat until back.
starts = sorted(((perimeter_t(r[0]), i) for i, r in enumerate(edge_runs)))
used = set()
for i0, r0 in enumerate(edge_runs):
    if i0 in used:
        continue
    ring, i = [], i0
    for _ in range(len(edge_runs) + 1):
        used.add(i)
        ring += edge_runs[i]
        t_end = perimeter_t(edge_runs[i][-1])
        # next start counter-clockwise from t_end
        cands = [(t - t_end) % 4 for t, _ in starts]
        k = min(range(len(starts)), key=lambda k: cands[k])
        t_next, j = starts[k]
        # corners passed on the way
        dist = (t_next - t_end) % 4
        passed = sorted(((c_t - t_end) % 4, c_p) for c_t, c_p in CORNERS if 0 < (c_t - t_end) % 4 < dist)
        ring += [p for _, p in passed]
        if j == i0:
            break
        i = j
    ring.append(ring[0])
    land_rings.append(ring)

if not edge_runs and not land_rings:
    land_rings.append([(W, S), (E, S), (E, N), (W, N), (W, S)])

land = []
for ring in land_rings:
    pts = simplify(project(ring), 12)
    if len(pts) >= 4 and abs(area(pts)) > 4_000:
        land.append(encode(pts))

# ---- inland water ----------------------------------------------------------------------------------
water = []
for e in json.loads(WATER.read_text())["elements"]:
    rings_outer, rings_inner = [], []
    if e["type"] == "way" and e.get("geometry"):
        ring = [(g["lon"], g["lat"]) for g in e["geometry"]]
        if ring[0] == ring[-1]:
            rings_outer.append(ring)
    elif e["type"] == "relation":
        outer = [[(g["lon"], g["lat"]) for g in m["geometry"]] for m in e.get("members", [])
                 if m.get("role") == "outer" and m.get("geometry")]
        inner = [[(g["lon"], g["lat"]) for g in m["geometry"]] for m in e.get("members", [])
                 if m.get("role") == "inner" and m.get("geometry")]
        rings_outer, rings_inner = merge_any_direction(outer), merge_any_direction(inner)
    polys = []
    for ring in rings_outer:
        pts = simplify(project(ring), 6)
        if len(pts) >= 4 and abs(area(pts)) > 25_000:
            polys.append(encode(pts))
    if not polys:
        continue
    for ring in rings_inner:
        pts = simplify(project(ring), 6)
        if len(pts) >= 4 and abs(area(pts)) > 10_000:
            polys.append(encode(pts))
    water.append(polys)

out = {
    "source": "OpenStreetMap contributors (ODbL), natural=coastline and natural=water",
    "land": land,
    "water": water,
}
OUT_DIR.mkdir(parents=True, exist_ok=True)
(OUT_DIR / "basemap.json").write_text(json.dumps(out, separators=(",", ":")) + "\n")
print(f"basemap.json: {len(land)} land polygons, {len(water)} water bodies, "
      f"{dropped} unclosed coastline runs dropped, {(OUT_DIR / 'basemap.json').stat().st_size // 1024} KiB")
