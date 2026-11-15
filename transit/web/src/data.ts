// Loads and decodes the schedule projection (network.json) and the land/water backdrop
// (basemap.json). Both are built offline from official sources; see tools/.

export type Mode = 'subway' | 'mattapan' | 'silver' | 'rail' | 'ferry' | 'bus';
export type Layer = 'subway' | 'rail' | 'bus' | 'ferry' | 'live';

export type Pattern = { id: string; name: string; dir: number; to: string; typical: boolean; stops: number[]; shape?: number[] };
export type Line = {
  id: string; name: string; short: string; desc: string; mode: Mode; net: string; frequent: boolean;
  group: string; groupName: string; color: string; text: string; dirs: string[]; patterns: Pattern[];
  index: number; paths: Float32Array[]; bbox: [number, number, number, number]; stationSet: Set<number>;
};
export type Station = {
  id: string; name: string; x: number; y: number; muni: string; acc: boolean; parent: boolean;
  lines: number[]; modes: Mode[]; index: number;
  /** 0 subway/light rail, 1 Silver Line, 2 Commuter Rail, 3 ferry, 4 bus stop */
  rank: number; transfer: boolean; sx: number; sy: number;
};
export type Network = {
  generatedAt: string; feed: { publisher: string; version: string; start: string; end: string };
  projection: { lat0: number; lon0: number; kx: number; ky: number };
  bounds: [number, number, number, number];
  lines: Line[]; stations: Station[];
  lineById: Map<string, Line>; stationById: Map<string, Station>;
};
export type Basemap = { land: Float32Array[]; water: Float32Array[][] };

export const BASE: string = import.meta.env.BASE_URL;

export const layerOf = (mode: Mode): Layer =>
  mode === 'bus' ? 'bus' : mode === 'rail' ? 'rail' : mode === 'ferry' ? 'ferry' : 'subway';

export function decode(delta: number[]): Float32Array {
  const out = new Float32Array(delta.length);
  let x = 0, y = 0;
  for (let i = 0; i < delta.length; i += 2) {
    x += delta[i]; y += delta[i + 1];
    out[i] = x; out[i + 1] = y;
  }
  return out;
}

const RANK: Record<Mode, number> = { subway: 0, mattapan: 0, silver: 1, rail: 2, ferry: 3, bus: 4 };

/** Nearest point on a polyline (squared distance, point). */
function nearestOn(path: Float32Array, px: number, py: number): [number, number, number] {
  let best = Infinity, bx = px, by = py;
  for (let i = 0; i + 3 < path.length; i += 2) {
    const ax = path[i], ay = path[i + 1], dx = path[i + 2] - ax, dy = path[i + 3] - ay;
    const den = dx * dx + dy * dy;
    const t = den ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / den)) : 0;
    const qx = ax + t * dx, qy = ay + t * dy;
    const d = (qx - px) ** 2 + (qy - py) ** 2;
    if (d < best) { best = d; bx = qx; by = qy; }
  }
  return [best, bx, by];
}

export async function loadNetwork(): Promise<Network> {
  const response = await fetch(`${BASE}data/network.json`);
  if (!response.ok) throw new Error(`The schedule map is unavailable (${response.status}).`);
  const raw = await response.json();
  const lines: Line[] = raw.lines.map((l: Omit<Line, 'index' | 'paths' | 'bbox' | 'stationSet'>, index: number) => {
    const paths = l.patterns.filter(p => p.shape).map(p => decode(p.shape as number[]));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of paths) for (let i = 0; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1];
    }
    return { ...l, index, paths, bbox: [x0, y0, x1, y1], stationSet: new Set(l.patterns.flatMap(p => p.stops)) };
  });
  const stations: Station[] = raw.stations.map((s: Station, index: number) => {
    const modes = s.modes as Mode[];
    // Silver Line street stops (SL4/SL5, airport curbs) look and behave like bus stops;
    // its real stations (Courthouse, World Trade Center...) are GTFS parent stations.
    const rank = Math.min(...modes.map(m => (m === 'silver' && !s.parent ? 4 : RANK[m])));
    const groups = new Set(s.lines.map(li => lines[li]).filter(l => l.mode !== 'bus').map(l => l.group || l.id));
    const transfer = groups.size > 1;
    return { ...s, modes, index, rank, transfer, sx: s.x, sy: s.y };
  });
  // Station dots sit on the track: snap rail/ferry stations onto their own line's shape
  // when it passes within 120 m (station coordinates are the building, not the platform).
  for (const s of stations) {
    if (s.rank > 3) continue;
    let best = 120 * 120, bx = s.x, by = s.y;
    for (const li of s.lines) {
      const line = lines[li];
      if (line.mode === 'bus') continue;
      for (const p of line.paths) {
        const [d, x, y] = nearestOn(p, s.x, s.y);
        if (d < best) { best = d; bx = x; by = y; }
      }
    }
    s.sx = bx; s.sy = by;
  }
  return {
    generatedAt: raw.generatedAt, feed: raw.feed, projection: raw.projection, bounds: raw.bounds,
    lines, stations,
    lineById: new Map(lines.map(l => [l.id, l])),
    stationById: new Map(stations.map(s => [s.id, s])),
  };
}

export async function loadBasemap(): Promise<Basemap | null> {
  try {
    const response = await fetch(`${BASE}data/basemap.json`);
    if (!response.ok) return null;
    const raw = await response.json();
    return { land: raw.land.map(decode), water: raw.water.map((w: number[][]) => w.map(decode)) };
  } catch {
    return null; // the map still works on a plain background
  }
}

export function project(net: Network, lat: number, lon: number): [number, number] {
  const p = net.projection;
  return [(lon - p.lon0) * p.kx, (p.lat0 - lat) * p.ky];
}

/** Display order for the line list (canon: Red, Mattapan, Orange, Green, Blue, Silver, CR, ferry, bus). */
export function lineSortKey(l: Line): number {
  return l.index;
}
