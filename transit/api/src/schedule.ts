// The schedule projection built from the official GTFS archive (tools/build-network-data.py).
// network.json is what the browser draws; server.json is the API's lookup index for the
// realtime feeds. Both are read once at start and are read-only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const dataDir = process.env.TRANSIT_DATA_DIR || (process.env.TRANSIT_WEB_ROOT && path.join(process.env.TRANSIT_WEB_ROOT, 'data'))
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/dist/data');

export type NetStation = { id: string; name: string; x: number; y: number; muni: string; acc: boolean; parent: boolean; lines: number[]; modes: string[] };
export type NetPattern = { id: string; name: string; dir: number; to: string; typical: boolean; stops: number[]; shape?: number[] };
export type NetLine = {
  id: string; name: string; short: string; desc: string; mode: string; net: string; frequent: boolean;
  group: string; groupName: string; color: string; text: string; dirs: string[]; patterns: NetPattern[];
};
export type Network = {
  version: number; source: string; generatedAt: string; feed: Record<string, string>;
  projection: { lat0: number; lon0: number; kx: number; ky: number }; bounds: number[];
  lines: NetLine[]; stations: NetStation[];
};
export type ServerIndex = {
  generatedAt: string; feed: Record<string, string>;
  stopParent: Record<string, string>; stopName: Record<string, string>; platform: Record<string, string>;
  patternHeadsign: Record<string, string>; directionDestination: Record<string, string>;
  routes: Record<string, { name: string; short: string; mode: string; color: string; text: string }>;
};

let network: Network | null = null;
let index: ServerIndex | null = null;
let stationById = new Map<string, number>();
let lineById = new Map<string, number>();

function load() {
  try {
    network = JSON.parse(readFileSync(path.join(dataDir, 'network.json'), 'utf8')) as Network;
    stationById = new Map(network.stations.map((s, i) => [s.id, i]));
    lineById = new Map(network.lines.map((l, i) => [l.id, i]));
  } catch (error) {
    console.error('schedule projection unavailable', error instanceof Error ? error.message : error);
  }
  try {
    index = JSON.parse(readFileSync(path.join(dataDir, 'server.json'), 'utf8')) as ServerIndex;
  } catch (error) {
    console.error('server index unavailable', error instanceof Error ? error.message : error);
  }
}
load();

export const scheduleNetwork = () => network;
export const serverIndex = () => index;

export function lineSummaries() {
  return (network?.lines ?? []).map(l => ({
    id: l.id, name: l.name, short: l.short, mode: l.mode, frequent: l.frequent, color: l.color, text: l.text,
    group: l.group, patterns: l.patterns.length,
  }));
}

export function lineDetail(id: string) {
  const i = lineById.get(id);
  if (i === undefined || !network) return null;
  const l = network.lines[i];
  return {
    id: l.id, name: l.name, short: l.short, desc: l.desc, mode: l.mode, color: l.color, text: l.text, dirs: l.dirs,
    patterns: l.patterns.map(p => ({
      id: p.id, name: p.name, dir: p.dir, to: p.to, typical: p.typical,
      stops: p.stops.map(si => ({ id: network!.stations[si].id, name: network!.stations[si].name })),
    })),
  };
}

export function stationDetail(id: string) {
  const i = stationById.get(index?.stopParent[id] ?? id);
  if (i === undefined || !network) return null;
  const s = network.stations[i];
  const p = network.projection;
  // Bus stops a short walk away (across the street, the busway, the next corner) and what calls there.
  const nearby: { id: string; name: string; meters: number; lines: { id: string; short: string; name: string; color: string; mode: string }[] }[] = [];
  for (const o of network.stations) {
    if (o === s) continue;
    const d = Math.hypot(o.x - s.x, o.y - s.y);
    if (d > 260 || !o.modes.includes('bus') && !o.modes.includes('silver')) continue;
    nearby.push({ id: o.id, name: o.name, meters: Math.round(d), lines: o.lines.map(li => network!.lines[li]).map(l => ({ id: l.id, short: l.short, name: l.name, color: l.color, mode: l.mode })) });
  }
  nearby.sort((a, b) => a.meters - b.meters);
  return {
    nearby: nearby.slice(0, 16),
    id: s.id, name: s.name, municipality: s.muni, accessible: s.acc,
    lat: +(p.lat0 - s.y / p.ky).toFixed(6), lon: +(p.lon0 + s.x / p.kx).toFixed(6),
    lines: s.lines.map(li => ({ id: network!.lines[li].id, name: network!.lines[li].name, short: network!.lines[li].short, mode: network!.lines[li].mode, color: network!.lines[li].color })),
    kind: s.modes.every(m => m === 'bus') || (s.modes[0] === 'silver' && !s.parent) ? 'stop' : 'station',
  };
}
