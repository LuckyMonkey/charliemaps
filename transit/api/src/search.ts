// Search over the schedule projection (stations, stops, routes), and the GeoJSON layers other
// fridge apps draw (WingMaps' Charlie Maps plugin). Pure functions over network.json.
import { scheduleNetwork, type NetLine, type NetStation } from './schedule.js';
import { nextByRoute } from './realtime.js';

export type SearchHit = {
  type: 'station' | 'stop' | 'route'; id: string; name: string; detail: string; mode: string;
  lines: { id: string; short: string; name: string; color: string; mode: string }[];
  lat: number | null; lon: number | null; score: number;
  next?: { route: string; short: string; color: string; mode: string; to: string; time: number }[];
};

const MODE_LABEL: Record<string, string> = { subway: 'Subway', mattapan: 'Mattapan Trolley', silver: 'Silver Line', rail: 'Commuter Rail', ferry: 'Ferry', bus: 'Bus' };
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9@/ ]+/g, ' ').replace(/\s+/g, ' ').trim();

let index: { s: NetStation; key: string; rank: number }[] | null = null;
let lineIndex: { l: NetLine; key: string; short: string }[] | null = null;

function build() {
  const net = scheduleNetwork();
  if (!net) return false;
  if (index) return true;
  const RANK: Record<string, number> = { subway: 0, mattapan: 0, silver: 1, rail: 1, ferry: 2, bus: 3 };
  index = net.stations.map(s => ({
    s, key: norm(s.name),
    rank: Math.min(...s.modes.map(m => (m === 'silver' && !s.parent ? 3 : RANK[m] ?? 3))),
  }));
  lineIndex = net.lines.map(l => ({ l, key: norm(`${l.short} ${l.name} ${l.groupName}`), short: norm(l.short || l.id) }));
  return true;
}

function latlon(x: number, y: number) {
  const p = scheduleNetwork()!.projection;
  return { lat: +(p.lat0 - y / p.ky).toFixed(6), lon: +(p.lon0 + x / p.kx).toFixed(6) };
}

export function search(q: string, limit = 12): SearchHit[] {
  if (!build()) return [];
  const net = scheduleNetwork()!;
  const n = norm(q).slice(0, 80);
  if (!n) return [];
  const words = n.split(' ');
  const out: SearchHit[] = [];
  for (const { l, key, short } of lineIndex!) {
    let score = -1;
    if (short === n) score = 100;
    else if (norm(l.name) === n) score = 95;
    else if (short.startsWith(n) && n.length >= 2) score = 70;
    else if (words.every(w => key.includes(w))) score = 50;
    if (score < 0) continue;
    if (l.mode !== 'bus') score += 8;
    out.push({
      type: 'route', id: l.id, name: l.mode === 'bus' ? `${l.short} ${l.name}` : l.mode === 'silver' ? `${l.short} ${l.name}` : l.name,
      detail: MODE_LABEL[l.mode] ?? l.mode, mode: l.mode,
      lines: [{ id: l.id, short: l.short, name: l.name, color: l.color, mode: l.mode }], lat: null, lon: null, score,
    });
  }
  if (n.length >= 2) {
    for (const { s, key, rank } of index!) {
      let score = -1;
      if (key === n) score = 90;
      else if (key.startsWith(n)) score = 75;
      else if (words.every(w => key.split(' ').some(k => k.startsWith(w)))) score = 60;
      else if (words.every(w => key.includes(w))) score = 40;
      if (score < 0) continue;
      score += (3 - rank) * 6 + (s.parent ? 4 : 0);
      const lines = s.lines.map(i => net.lines[i]);
      const stop = rank === 3;
      out.push({
        type: stop ? 'stop' : 'station', id: s.id, name: s.name,
        detail: `${stop ? 'Bus stop' : 'Station'}${s.muni ? ` · ${s.muni}` : ''}`,
        mode: s.modes[0] ?? 'bus',
        lines: lines.map(l => ({ id: l.id, short: l.short, name: l.name, color: l.color, mode: l.mode })),
        ...latlon(s.x, s.y), score,
      });
    }
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return out.slice(0, limit);
}

/** Search + the next departures (live) for the first few stations and stops. */
export function searchWithArrivals(q: string, limit = 12, withNext = 6) {
  const net = scheduleNetwork();
  const hits = search(q, limit);
  let n = 0;
  for (const h of hits) {
    if (h.type === 'route' || n >= withNext) continue;
    n++;
    h.next = nextByRoute(h.id, 4).map(a => {
      const l = net?.lines.find(x => x.id === a.route);
      return { route: a.route, short: l?.short || l?.name.replace(/ Line$/, '') || a.route, color: l?.color ?? '#7C878E', mode: l?.mode ?? 'bus', to: a.to, time: a.time };
    });
  }
  return hits;
}

/** A coloured circle per line, for places that only show text (go.fridge.run search). */
export function dotFor(color: string, mode: string) {
  if (mode === 'bus') return '🟡';
  if (mode === 'rail') return '🟣';
  if (mode === 'silver') return '⚪';
  const c = color.toUpperCase();
  if (c === '#DA291C') return '🔴';
  if (c === '#ED8B00') return '🟠';
  if (c === '#00843D') return '🟢';
  if (c === '#003DA5' || c === '#008EAA' || c === '#006595') return '🔵';
  return '⚫';
}

/** fridge.run search node answer (fridge-go src/search.php): {app, items:[{title,type,link,detail,path}]}. */
export function searchNode(q: string) {
  const mins = (t: number) => { const m = Math.round((t * 1000 - Date.now()) / 60000); return m <= 0 ? 'now' : `${m} min`; };
  const items = searchWithArrivals(q, 20, 8).map(h => {
    const link = h.type === 'route' ? `/transit/?line=${encodeURIComponent(h.id)}` : `/transit/?station=${encodeURIComponent(h.id)}`;
    const rapid = h.lines.filter(l => l.mode !== 'bus');
    const dots = h.type === 'route'
      ? dotFor(h.lines[0]?.color ?? '', h.mode)
      : [...new Set(rapid.map(l => dotFor(l.color, l.mode)))].join('') + (h.lines.some(l => l.mode === 'bus') ? '🟡' : '');
    const lines = rapid.map(l => l.short || l.name.replace(/ Line$/, '')).slice(0, 5);
    const buses = h.lines.filter(l => l.mode === 'bus').map(l => l.short).slice(0, 6);
    const next = (h.next ?? []).map(a => `${a.short} → ${a.to || '…'} ${mins(a.time)}`).join(' · ');
    return {
      title: `${dots || '⚫'} ${h.name}`, type: h.type, link,
      detail: h.type === 'route' ? h.detail
        : next ? `Next: ${next}` : [h.detail, lines.join(', '), buses.length ? `bus ${buses.join(' ')}` : ''].filter(Boolean).join(' · '),
      path: h.type === 'route' ? ['Routes', h.detail] : [h.type === 'stop' ? 'Bus stops' : 'Stations'],
    };
  });
  return { app: 'transit', items };
}

// ---- GeoJSON for other apps ---------------------------------------------------------------------
let geoLines: unknown = null;
let geoStations: unknown = null;

function decodeLatLon(delta: number[]): [number, number][] {
  const out: [number, number][] = [];
  let x = 0, y = 0;
  for (let i = 0; i < delta.length; i += 2) {
    x += delta[i]; y += delta[i + 1];
    const { lat, lon } = latlon(x, y);
    out.push([lon, lat]);
  }
  return out;
}

export function linesGeoJSON() {
  const net = scheduleNetwork();
  if (!net) return null;
  if (geoLines) return geoLines;
  geoLines = {
    type: 'FeatureCollection',
    features: net.lines.map(l => ({
      type: 'Feature', id: l.id,
      properties: { id: l.id, name: l.name, short: l.short, mode: l.mode, color: l.color, text: l.text, frequent: l.frequent, link: `/transit/?line=${encodeURIComponent(l.id)}` },
      geometry: { type: 'MultiLineString', coordinates: l.patterns.filter(p => p.shape).map(p => decodeLatLon(p.shape as number[])) },
    })),
  };
  return geoLines;
}

export function stationsGeoJSON() {
  const net = scheduleNetwork();
  if (!net) return null;
  if (geoStations) return geoStations;
  geoStations = {
    type: 'FeatureCollection',
    features: net.stations.map(s => {
      const { lat, lon } = latlon(s.x, s.y);
      return {
        type: 'Feature', id: s.id,
        properties: {
          id: s.id, name: s.name, modes: s.modes, accessible: s.acc, kind: s.modes.every(m => m === 'bus') || (s.modes[0] === 'silver' && !s.parent) ? 'stop' : 'station',
          lines: s.lines.map(i => net.lines[i].id), link: `/transit/?station=${encodeURIComponent(s.id)}`,
        },
        geometry: { type: 'Point', coordinates: [lon, lat] },
      };
    }),
  };
  return geoStations;
}
